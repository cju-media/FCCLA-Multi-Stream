/**
 * atem-status-server
 *
 * Standalone Node/Express server. Connects to a Blackmagic ATEM, watches its
 * built-in streaming state, and exposes:
 *
 *   GET  /status      -> plain text "1" or "0"        <-- point Max's [maxurl] here
 *   GET  /rtmp-url    -> plain text full "url/key"    <-- and this [maxurl] for jit.rtmp.send~'s @url
 *   GET  /stream-url  -> plain text RTMP base URL only (optional, if you need it separately)
 *   GET  /stream-key  -> plain text stream key only   (optional, if you need it separately)
 *   GET  /state       -> JSON, full state (for the web UI)
 *   GET  /debug       -> JSON, raw atem.state.streaming (for diagnosing enum drift)
 *   POST /config      -> { atemIp, windowStart, windowEnd, armed, streamUrl, streamKey } - update + persist
 *   POST /override    -> { mode: "auto" | "on" | "off" } - manual override
 *   GET  /            -> the configuration web UI
 *
 * "1" means: the ATEM went live (built-in streaming) while the current time
 * was inside [windowStart, windowEnd), and it hasn't stopped since. It
 * latches - if the window closes while the ATEM is still streaming, it
 * stays "1" until the ATEM actually stops. If the ATEM goes live outside
 * the window, it stays "0". Disarming forces "0" immediately.
 *
 * This process is meant to run on its own machine ("elsewhere"), reachable
 * over the network from wherever Max is running.
 */

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cron = require('node-cron');
const { Atem, Enums } = require('atem-connection');

// Weekly safety-net reset: every Sunday 6:00am US Pacific time, force the
// manual override back to "auto" no matter what it was set to - so a
// forgotten "Force ON"/"Force OFF" from testing can't stick around
// indefinitely. Uses the America/Los_Angeles zone (not a fixed UTC-8
// offset) so it stays correct across the PST/PDT switch.
const WEEKLY_RESET_CRON = '0 6 * * 0';
const WEEKLY_RESET_TZ = 'America/Los_Angeles';

const PORT = process.env.PORT || 4200;
const CONFIG_PATH = path.join(__dirname, 'config.json');

// ---- Config (persisted to disk) ----
const DEFAULT_CONFIG = {
  atemIp: '',
  windowStart: '09:30',
  windowEnd: '11:00',
  armed: true,
  streamUrl: '',
  streamKey: '',
};

// Never write the stream key to a log line in full - it's a credential.
function redactedConfig(c) {
  return { ...c, streamKey: c.streamKey ? `(set, ${c.streamKey.length} chars)` : '' };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// ---- Runtime state ----
const runtime = {
  connected: false,
  atemStreaming: false, // raw state reported by the ATEM
  shouldStream: false, // latched decision from the auto logic
  mode: 'auto', // 'auto' | 'on' | 'off'
  lastReason: 'starting up',
  lastEventAt: new Date().toISOString(),
  log: [], // last ~50 lines, newest first, for the UI
};

function logLine(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  runtime.log.unshift(line);
  runtime.log = runtime.log.slice(0, 50);
  console.log(msg);
}

cron.schedule(
  WEEKLY_RESET_CRON,
  () => {
    runtime.mode = 'auto';
    logLine(`[schedule] weekly reset (Sun 6:00am ${WEEKLY_RESET_TZ}) -> override forced to auto`);
  },
  { timezone: WEEKLY_RESET_TZ }
);

function parseHM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function inWindow(d = new Date()) {
  const startMin = parseHM(config.windowStart);
  const endMin = parseHM(config.windowEnd);
  if (startMin === null || endMin === null) return false;
  const nowMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return nowMin >= startMin && nowMin <= endMin;
}

function effectiveValue() {
  if (runtime.mode === 'on') return 1;
  if (runtime.mode === 'off') return 0;
  return runtime.shouldStream ? 1 : 0;
}

// Joins the base RTMP URL and stream key into the single URL most RTMP
// ingest endpoints (YouTube, Twitch, Facebook, custom nginx-rtmp, etc.)
// actually expect - the key as the final path segment - so Max can hand
// the whole thing straight to jit.rtmp.send~'s @url with no string work.
function fullRtmpUrl(streamUrl, streamKey) {
  const url = String(streamUrl || '').trim();
  const key = String(streamKey || '').trim();
  if (!url) return '';
  if (!key) return url;
  return `${url.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

// ---- ATEM connection management ----
let atem = new Atem();
let currentAtemIp = null;

function wireAtemEvents(instance) {
  instance.on('error', (err) => logLine(`[atem] error: ${err}`));

  instance.on('connected', () => {
    runtime.connected = true;
    logLine(`[atem] connected to ${currentAtemIp}`);
  });

  instance.on('disconnected', () => {
    runtime.connected = false;
    logLine('[atem] disconnected (will auto-reconnect)');
  });

  instance.on('stateChanged', (state, pathToChange) => {
    if (!pathToChange.some((p) => p.startsWith('streaming'))) return;

    // state.streaming.status.state is a bitmask (Enums.StreamingStatus:
    // Idle=1, Connecting=2, Streaming=4, Stopping=32) - check the Streaming bit.
    const streamState = state.streaming && state.streaming.status && state.streaming.status.state;
    const isStreaming = typeof streamState === 'number' && (streamState & Enums.StreamingStatus.Streaming) !== 0;

    if (isStreaming && !runtime.atemStreaming) {
      onAtemWentLive();
    } else if (!isStreaming && runtime.atemStreaming) {
      onAtemStopped();
    }
    runtime.atemStreaming = isStreaming;
  });
}

function onAtemWentLive() {
  runtime.lastEventAt = new Date().toISOString();
  if (!config.armed) {
    runtime.lastReason = 'ATEM went live, but disarmed - ignoring';
    logLine(`[trigger] ${runtime.lastReason}`);
    return;
  }
  if (inWindow()) {
    runtime.shouldStream = true;
    runtime.lastReason = `ATEM went live at ${new Date().toLocaleTimeString()} inside ${config.windowStart}-${config.windowEnd} -> streaming ON`;
  } else {
    runtime.lastReason = `ATEM went live at ${new Date().toLocaleTimeString()} outside ${config.windowStart}-${config.windowEnd} -> ignoring`;
  }
  logLine(`[trigger] ${runtime.lastReason}`);
}

function onAtemStopped() {
  runtime.shouldStream = false;
  runtime.lastEventAt = new Date().toISOString();
  runtime.lastReason = 'ATEM stopped streaming -> streaming OFF';
  logLine(`[trigger] ${runtime.lastReason}`);
}

function connectAtem(ip) {
  if (ip === currentAtemIp) return;
  if (atem) {
    try {
      atem.disconnect();
    } catch {
      /* ignore */
    }
  }
  runtime.connected = false;
  runtime.atemStreaming = false;
  currentAtemIp = ip || null;
  atem = new Atem();
  wireAtemEvents(atem);
  if (currentAtemIp) {
    logLine(`[trigger] connecting to ATEM at ${currentAtemIp} ...`);
    atem.connect(currentAtemIp);
  } else {
    logLine('[trigger] no ATEM IP configured yet');
  }
}

connectAtem(config.atemIp);

// ---- HTTP server ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/status', (req, res) => {
  res.type('text/plain').send(String(effectiveValue()));
});

app.get('/state', (req, res) => {
  res.json({
    config,
    runtime: {
      connected: runtime.connected,
      atemStreaming: runtime.atemStreaming,
      shouldStream: runtime.shouldStream,
      mode: runtime.mode,
      lastReason: runtime.lastReason,
      lastEventAt: runtime.lastEventAt,
      log: runtime.log,
    },
    effective: effectiveValue(),
    inWindowNow: inWindow(),
    fullRtmpUrl: fullRtmpUrl(config.streamUrl, config.streamKey),
  });
});

app.get('/debug', (req, res) => {
  res.json({ streaming: (atem.state && atem.state.streaming) || null });
});

app.get('/rtmp-url', (req, res) => {
  res.type('text/plain').send(fullRtmpUrl(config.streamUrl, config.streamKey));
});

app.get('/stream-url', (req, res) => {
  res.type('text/plain').send(config.streamUrl || '');
});

app.get('/stream-key', (req, res) => {
  res.type('text/plain').send(config.streamKey || '');
});

app.post('/config', (req, res) => {
  const { atemIp, windowStart, windowEnd, armed, streamUrl, streamKey } = req.body || {};

  if (windowStart !== undefined && parseHM(windowStart) === null) {
    return res.status(400).json({ error: 'windowStart must be HH:MM' });
  }
  if (windowEnd !== undefined && parseHM(windowEnd) === null) {
    return res.status(400).json({ error: 'windowEnd must be HH:MM' });
  }

  const prevIp = config.atemIp;
  config = {
    atemIp: atemIp !== undefined ? String(atemIp).trim() : config.atemIp,
    windowStart: windowStart !== undefined ? windowStart : config.windowStart,
    windowEnd: windowEnd !== undefined ? windowEnd : config.windowEnd,
    armed: armed !== undefined ? !!armed : config.armed,
    streamUrl: streamUrl !== undefined ? String(streamUrl).trim() : config.streamUrl,
    streamKey: streamKey !== undefined ? String(streamKey).trim() : config.streamKey,
  };
  saveConfig();
  logLine(`[config] updated: ${JSON.stringify(redactedConfig(config))}`);

  if (!config.armed) {
    runtime.shouldStream = false;
  }
  if (config.atemIp !== prevIp) {
    connectAtem(config.atemIp);
  }

  res.json({ config });
});

app.post('/override', (req, res) => {
  const { mode } = req.body || {};
  if (!['auto', 'on', 'off'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be auto, on, or off' });
  }
  runtime.mode = mode;
  logLine(`[override] mode set to ${mode}`);
  res.json({ mode: runtime.mode });
});

app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addrs = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  logLine(`atem-status-server listening on port ${PORT}`);
  logLine(`web UI:            http://localhost:${PORT}/`);
  logLine(`maxurl status:     http://localhost:${PORT}/status`);
  logLine(`maxurl rtmp-url:   http://localhost:${PORT}/rtmp-url`);
  logLine(`(optional separate: /stream-url, /stream-key)`);
  addrs.forEach((a) => {
    logLine(`  reachable on this network at http://${a}:${PORT}/status`);
  });
});
