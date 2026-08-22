/**
 * atem-live-trigger.js
 *
 * Runs inside a Max [node.script] object. Watches a Blackmagic ATEM's
 * built-in streaming state (e.g. ATEM Mini Pro / Extreme / Constellation HD
 * "Start Streaming"). When the ATEM transitions from not-streaming to
 * streaming ("goes live") AND the current local time is inside the allowed
 * window (default 9:30am-11:00am), it outputs a "start" message. When the
 * ATEM stops streaming, it outputs a "stop" message. Everything else (route
 * this to jit.rtmp.send~, wire your a/v chain, etc.) happens in the Max
 * patch.
 *
 * All outbound Max messages go out the single outlet (declare the object as
 * `node.script atem-live-trigger.js @outlets 1`) as [selector args...]
 * lists, meant to be split with [route start stop status] in the patch:
 *   - "start"                     -> ATEM went live inside the window
 *   - "stop"                      -> ATEM stopped streaming
 *   - "status connected"          -> socket connected to the ATEM
 *   - "status disconnected"       -> socket dropped (will auto-reconnect)
 *   - "status atem_live"          -> ATEM went live, window info follows in console
 *   - "status atem_stopped"       -> ATEM stopped
 *
 * Inbound messages (send these to the node.script inlet):
 *   - "connect <ip>"              e.g. "connect 192.168.1.240"
 *   - "disconnect"
 *   - "setwindow <startHr> <endHr>"  decimal hours, e.g. "setwindow 9.5 11"
 *   - "arm 0" / "arm 1"           disable/enable triggering without disconnecting
 *   - "status"                    posts current state to the Max console
 *   - "debugstate"                posts the raw ATEM streaming state (for
 *                                 checking this library version's field names)
 *   - "test"                      forces a "start" out the outlet, bypassing
 *                                 the ATEM and the time window - wiring/debug only
 */

const maxApi = require('max-api');
const { Atem, Enums } = require('atem-connection');

// ---- Config (overridable at runtime via Max messages) ----
let atemIp = null;
let windowStartMinutes = 9 * 60 + 30; // 9:30am
let windowEndMinutes = 11 * 60; // 11:00am
let armed = true;

let wasStreaming = false;
let connectedOnce = false;

const atem = new Atem();

function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function inWindow(d = new Date()) {
  const m = nowMinutes(d);
  return m >= windowStartMinutes && m <= windowEndMinutes;
}

function fmt(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

// ---- ATEM connection lifecycle ----
atem.on('error', (err) => {
  maxApi.post(`[atem] error: ${err}`);
});

atem.on('connected', () => {
  connectedOnce = true;
  maxApi.post(`[atem] connected to ${atemIp}`);
  maxApi.outlet('status', 'connected');
});

atem.on('disconnected', () => {
  maxApi.post('[atem] disconnected (will auto-reconnect)');
  maxApi.outlet('status', 'disconnected');
});

atem.on('stateChanged', (state, pathToChange) => {
  if (!pathToChange.some((p) => p.startsWith('streaming'))) return;

  // state.streaming.status.state is a bitmask (see atem-connection's Enums.StreamingStatus:
  // Idle=1, Connecting=2, Streaming=4, Stopping=32). Bitwise-check for the Streaming bit
  // rather than hardcoding a value, so this survives future library changes.
  const streamState = state.streaming && state.streaming.status && state.streaming.status.state;
  const isStreaming = typeof streamState === 'number' && (streamState & Enums.StreamingStatus.Streaming) !== 0;

  if (isStreaming && !wasStreaming) {
    onAtemWentLive();
  } else if (!isStreaming && wasStreaming) {
    onAtemStopped();
  }
  wasStreaming = isStreaming;
});

function onAtemWentLive() {
  const now = new Date();
  maxApi.outlet('status', 'atem_live');

  if (!armed) {
    maxApi.post('[trigger] ATEM went live, but trigger is disarmed - ignoring');
    return;
  }

  if (inWindow(now)) {
    maxApi.post(
      `[trigger] ATEM went live at ${now.toLocaleTimeString()} (inside ${fmt(windowStartMinutes)}-${fmt(
        windowEndMinutes
      )} window) -> starting jit.rtmp.send~`
    );
    maxApi.outlet('start');
  } else {
    maxApi.post(
      `[trigger] ATEM went live at ${now.toLocaleTimeString()} - outside the ${fmt(windowStartMinutes)}-${fmt(
        windowEndMinutes
      )} window -> NOT starting stream`
    );
  }
}

function onAtemStopped() {
  maxApi.post('[trigger] ATEM stopped streaming');
  maxApi.outlet('status', 'atem_stopped');
  maxApi.outlet('stop');
}

// ---- Messages from the Max patch ----
maxApi.addHandler('connect', (ip) => {
  if (!ip) {
    maxApi.post('[trigger] usage: connect <atem-ip-address>');
    return;
  }
  atemIp = String(ip);
  maxApi.post(`[trigger] connecting to ATEM at ${atemIp} ...`);
  atem.connect(atemIp);
});

maxApi.addHandler('disconnect', () => {
  atem.disconnect();
});

maxApi.addHandler('setwindow', (start, end) => {
  if (typeof start !== 'number' || typeof end !== 'number') {
    maxApi.post('[trigger] usage: setwindow <startHour> <endHour>  e.g. "setwindow 9.5 11" for 9:30am-11:00am');
    return;
  }
  windowStartMinutes = start * 60;
  windowEndMinutes = end * 60;
  maxApi.post(`[trigger] window set to ${fmt(windowStartMinutes)} - ${fmt(windowEndMinutes)}`);
});

maxApi.addHandler('arm', (v) => {
  armed = !!v;
  maxApi.post(`[trigger] ${armed ? 'armed' : 'disarmed'}`);
});

maxApi.addHandler('status', () => {
  maxApi.post(
    `[trigger] connected=${connectedOnce} streaming=${wasStreaming} armed=${armed} window=${fmt(
      windowStartMinutes
    )}-${fmt(windowEndMinutes)}`
  );
});

maxApi.addHandler('debugstate', () => {
  maxApi.post(`[trigger] raw streaming state: ${JSON.stringify(atem.state && atem.state.streaming)}`);
});

// Manual test hook - bypasses the ATEM and the time window entirely, for
// verifying the Max wiring (route -> jit.rtmp.send~) without a live device.
maxApi.addHandler('test', () => {
  maxApi.post('[trigger] TEST: forcing "start" out the outlet');
  maxApi.outlet('start');
});

maxApi.post('[trigger] atem-live-trigger.js loaded. Send "connect <ip>" to begin.');
