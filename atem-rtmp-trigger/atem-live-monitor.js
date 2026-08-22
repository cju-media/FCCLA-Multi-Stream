#!/usr/bin/env node
/**
 * atem-live-monitor.js
 *
 * Standalone CLI companion to atem-rtmp-trigger.maxpat's [shell] object.
 * Runs as an ordinary child process under the SYSTEM Node install (not
 * Node for Max / node.script / max-api) - Max spawns it once via:
 *
 *   shell /usr/local/bin/node /absolute/path/atem-live-monitor.js \
 *         <atemIp> [windowStartHr] [windowEndHr] [controlPort]
 *
 * e.g.  shell /usr/local/bin/node
 *       /Users/c/.../atem-rtmp-trigger/atem-live-monitor.js
 *       192.168.112.23 9.5 11 7415
 *
 * It connects to the ATEM directly, watches its built-in streaming state,
 * and prints simple line-based messages to stdout. [shell] forwards each
 * stdout line into Max as a message, so the patch can [route] on it:
 *
 *   start                      -> ATEM went live inside the allowed window
 *   stop                       -> ATEM stopped streaming
 *   status connected
 *   status disconnected
 *   status atem_live
 *   status atem_stopped
 *   log <free text>            -> informational only, not meant to trigger anything
 *
 * Because it's genuinely unclear whether your particular [shell] external
 * forwards further inlet messages into this process's stdin once it's
 * running, runtime control does NOT depend on that. Instead this process
 * also opens a plain UDP socket on 127.0.0.1:<controlPort> (default 7415)
 * and accepts the same commands as text datagrams - drive it from Max with
 * a vanilla [udpsend 127.0.0.1 7415] object:
 *
 *   setwindow <startHr> <endHr>   e.g. "setwindow 9.5 11" = 9:30am-11:00am
 *   arm 0 / arm 1                 disarm/arm triggering without disconnecting
 *   status                        posts current state as a "log" line
 *   debugstate                    posts the raw atem.state.streaming object
 *   test                          forces a "start" line, bypassing the ATEM
 *                                 and the time window - wiring checks only
 *
 * (The same commands are also accepted one-per-line on stdin, in case your
 * [shell] does forward it - harmless either way.)
 */

const dgram = require('dgram');
const readline = require('readline');
const { Atem, Enums } = require('atem-connection');

const [, , atemIpArg, windowStartArg, windowEndArg, controlPortArg] = process.argv;

function out(line) {
  process.stdout.write(`${line}\n`);
}

if (!atemIpArg) {
  out('log usage: node atem-live-monitor.js <atem-ip> [windowStartHr] [windowEndHr] [controlPort]');
  process.exit(1);
}

let windowStartMinutes = (windowStartArg !== undefined ? Number(windowStartArg) : 9.5) * 60;
let windowEndMinutes = (windowEndArg !== undefined ? Number(windowEndArg) : 11) * 60;
const controlPort = Number(controlPortArg) || 7415;

let armed = true;
let wasStreaming = false;
let connectedOnce = false;

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
const atem = new Atem();

atem.on('error', (err) => out(`log [atem] error: ${err}`));

atem.on('connected', () => {
  connectedOnce = true;
  out(`log [atem] connected to ${atemIpArg}`);
  out('status connected');
});

atem.on('disconnected', () => {
  out('log [atem] disconnected (will auto-reconnect)');
  out('status disconnected');
});

atem.on('stateChanged', (state, pathToChange) => {
  if (!pathToChange.some((p) => p.startsWith('streaming'))) return;

  // state.streaming.status.state is a bitmask (atem-connection's Enums.StreamingStatus:
  // Idle=1, Connecting=2, Streaming=4, Stopping=32) - bitwise-check the Streaming bit.
  const streamState = state.streaming && state.streaming.status && state.streaming.status.state;
  const isStreaming = typeof streamState === 'number' && (streamState & Enums.StreamingStatus.Streaming) !== 0;

  if (isStreaming && !wasStreaming) onAtemWentLive();
  else if (!isStreaming && wasStreaming) onAtemStopped();
  wasStreaming = isStreaming;
});

function onAtemWentLive() {
  const now = new Date();
  out('status atem_live');

  if (!armed) {
    out('log [trigger] ATEM went live, but trigger is disarmed - ignoring');
    return;
  }

  if (inWindow(now)) {
    out(
      `log [trigger] ATEM went live at ${now.toLocaleTimeString()} (inside ${fmt(windowStartMinutes)}-${fmt(
        windowEndMinutes
      )} window) -> starting`
    );
    out('start');
  } else {
    out(
      `log [trigger] ATEM went live at ${now.toLocaleTimeString()} - outside the ${fmt(windowStartMinutes)}-${fmt(
        windowEndMinutes
      )} window -> NOT starting`
    );
  }
}

function onAtemStopped() {
  out('log [trigger] ATEM stopped streaming');
  out('status atem_stopped');
  out('stop');
}

out(`log [trigger] connecting to ATEM at ${atemIpArg} ...`);
atem.connect(atemIpArg);

// ---- Runtime control: shared handler for stdin lines and UDP datagrams ----
function handleCommand(line) {
  const [cmd, a, b] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'setwindow': {
      const s = Number(a);
      const e = Number(b);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        windowStartMinutes = s * 60;
        windowEndMinutes = e * 60;
        out(`log [trigger] window set to ${fmt(windowStartMinutes)} - ${fmt(windowEndMinutes)}`);
      } else {
        out('log [trigger] usage: setwindow <startHour> <endHour>');
      }
      break;
    }
    case 'arm':
      armed = a === '1' || a === 'true';
      out(`log [trigger] ${armed ? 'armed' : 'disarmed'}`);
      break;
    case 'status':
      out(
        `log [trigger] connected=${connectedOnce} streaming=${wasStreaming} armed=${armed} window=${fmt(
          windowStartMinutes
        )}-${fmt(windowEndMinutes)}`
      );
      break;
    case 'debugstate':
      out(`log [trigger] raw streaming state: ${JSON.stringify(atem.state && atem.state.streaming)}`);
      break;
    case 'test':
      out('log [trigger] TEST: forcing "start"');
      out('start');
      break;
    default:
      if (cmd) out(`log [trigger] unknown command: ${line.trim()}`);
  }
}

// UDP control channel (loopback only) - this is the reliable path regardless
// of whether your [shell] external forwards inlet input to stdin.
const controlSocket = dgram.createSocket('udp4');
controlSocket.on('message', (msg) => handleCommand(msg.toString()));
controlSocket.on('error', (err) => out(`log [control] udp error: ${err}`));
controlSocket.bind(controlPort, '127.0.0.1', () => {
  out(`log [control] listening for commands on udp 127.0.0.1:${controlPort}`);
});

// Optional stdin path too, in case your [shell] does forward it - harmless either way.
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', handleCommand);

function shutdown() {
  controlSocket.close();
  atem.disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
