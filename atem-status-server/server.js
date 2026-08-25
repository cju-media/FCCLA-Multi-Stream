/**
 * atem-status-server
 *
 * Standalone Node/Express server. Connects to a Blackmagic ATEM, watches its
 * built-in streaming state, and exposes:
 *
 *   GET    /status       -> plain text "1" or "0"                     <-- point Max's [maxurl] here
 *   GET    /url1         -> plain text full "url/key" for output #1   <-- one [maxurl] per output
 *   GET    /url2         -> plain text full "url/key" for output #2, etc.
 *   GET    /outputs      -> JSON, list of configured outputs (for the web UI)
 *   POST   /outputs      -> { name, streamUrl, streamKey } - add a new output, assigns it the next /urlN
 *   PUT    /outputs/:id  -> { name, streamUrl, streamKey } - update an existing output (partial)
 *   DELETE /outputs/:id  -> remove an output (its /urlN slot is retired, never reused)
 *   GET    /state        -> JSON, full state (for the web UI)
 *   GET    /debug        -> JSON, raw atem.state.streaming (for diagnosing enum drift)
 *   POST   /config       -> { atemIp, windowStart, windowEnd, windowDays, armed } - update + persist
 *   POST   /override     -> { mode: "auto" | "on" | "off" } - manual override
 *   GET    /             -> the configuration web UI
 *
 * "1" means: the ATEM went live (built-in streaming) while the current day
 * was one of windowDays (0=Sun ... 6=Sat, default Sunday only) and the time
 * was inside [windowStart, windowEnd), and it hasn't stopped since. It
 * latches - if the window closes while the ATEM is still streaming, it
 * stays "1" until the ATEM actually stops. If the ATEM goes live outside
 * the window, it stays "0". Disarming forces "0" immediately. This one
 * decision is shared by every output - all outputs start/stop together.
 *
 * Each output gets a permanent numbered endpoint (/url1, /url2, ...)
 * assigned the moment it's created, based on an ever-increasing counter -
 * not its position in the list - so deleting an earlier output never
 * shifts what a later one's URL means.
 *
 * This process is meant to run on its own machine ("elsewhere"), reachable
 * over the network from wherever Max is running.
 */

const crypto = require('crypto');
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
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_CONFIG = {
  atemIp: '',
  windowStart: '09:00',
  windowEnd: '11:00',
  windowDays: [0], // days of week the window applies on - 0=Sun ... 6=Sat (Date#getDay()); default Sunday only
  armed: true,
  outputs: [], // [{ id, slot, name, streamUrl, streamKey }, ...]
  nextSlot: 1, // ever-increasing - never reused, even after deletes
};

function fmtDays(days) {
  if (!Array.isArray(days) || days.length === 0) return '(no days selected)';
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d])
    .join(', ');
}

// Never write a stream key to a log line in full - it's a credential.
function redactedConfig(c) {
  return {
    ...c,
    outputs: (c.outputs || []).map((o) => ({
      ...o,
      streamKey: o.streamKey ? `(set, ${o.streamKey.length} chars)` : '',
    })),
  };
}

function loadConfig() {
  let loaded;
  try {
    loaded = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    loaded = { ...DEFAULT_CONFIG };
  }

  // Migrate the old single-output shape (streamUrl/streamKey at the config
  // root, from before multi-output support) into outputs[0].
  if ((!loaded.outputs || loaded.outputs.length === 0) && (loaded.streamUrl || loaded.streamKey)) {
    loaded.outputs = [
      {
        id: crypto.randomUUID(),
        slot: loaded.nextSlot || 1,
        name: 'Stream 1',
        streamUrl: loaded.streamUrl || '',
        streamKey: loaded.streamKey || '',
      },
    ];
    loaded.nextSlot = (loaded.nextSlot || 1) + 1;
  }
  delete loaded.streamUrl;
  delete loaded.streamKey;

  return loaded;
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let config = loadConfig();
saveConfig(); // idempotent - also flushes the legacy-config migration to disk immediately

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

function dayAllowed(d = new Date()) {
  return Array.isArray(config.windowDays) && config.windowDays.includes(d.getDay());
}

function inTimeRange(d = new Date()) {
  const startMin = parseHM(config.windowStart);
  const endMin = parseHM(config.windowEnd);
  if (startMin === null || endMin === null) return false;
  const nowMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return nowMin >= startMin && nowMin <= endMin;
}

function inWindow(d = new Date()) {
  return dayAllowed(d) && inTimeRange(d);
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

  const now = new Date();
  const when = `${DAY_NAMES[now.getDay()]} ${now.toLocaleTimeString()}`;
  const windowDesc = `${fmtDays(config.windowDays)} ${config.windowStart}-${config.windowEnd}`;

  if (inWindow(now)) {
    runtime.shouldStream = true;
    runtime.lastReason = `ATEM went live at ${when} (inside ${windowDesc}) -> streaming ON`;
  } else if (!dayAllowed(now)) {
    runtime.lastReason = `ATEM went live at ${when}, but that day isn't in the allowed window (${windowDesc}) -> ignoring`;
  } else {
    runtime.lastReason = `ATEM went live at ${when}, outside the ${config.windowStart}-${config.windowEnd} time range -> ignoring`;
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
    outputs: config.outputs.map((o) => ({
      ...o,
      endpoint: outputEndpoint(o),
      fullRtmpUrl: fullRtmpUrl(o.streamUrl, o.streamKey),
    })),
  });
});

app.get('/debug', (req, res) => {
  res.json({ streaming: (atem.state && atem.state.streaming) || null });
});

app.post('/config', (req, res) => {
  const { atemIp, windowStart, windowEnd, windowDays, armed } = req.body || {};

  if (windowStart !== undefined && parseHM(windowStart) === null) {
    return res.status(400).json({ error: 'windowStart must be HH:MM' });
  }
  if (windowEnd !== undefined && parseHM(windowEnd) === null) {
    return res.status(400).json({ error: 'windowEnd must be HH:MM' });
  }
  if (
    windowDays !== undefined &&
    (!Array.isArray(windowDays) || windowDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  ) {
    return res.status(400).json({ error: 'windowDays must be an array of integers 0-6 (0=Sun ... 6=Sat)' });
  }

  const prevIp = config.atemIp;
  config = {
    ...config,
    atemIp: atemIp !== undefined ? String(atemIp).trim() : config.atemIp,
    windowStart: windowStart !== undefined ? windowStart : config.windowStart,
    windowEnd: windowEnd !== undefined ? windowEnd : config.windowEnd,
    windowDays: windowDays !== undefined ? [...new Set(windowDays)].sort((a, b) => a - b) : config.windowDays,
    armed: armed !== undefined ? !!armed : config.armed,
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

// ---- Stream outputs (multiple named RTMP destinations) ----
function outputEndpoint(o) {
  return `/url${o.slot}`;
}

app.get('/outputs', (req, res) => {
  res.json({ outputs: config.outputs.map((o) => ({ ...o, endpoint: outputEndpoint(o) })) });
});

app.post('/outputs', (req, res) => {
  const { name, streamUrl, streamKey } = req.body || {};
  const output = {
    id: crypto.randomUUID(),
    slot: config.nextSlot,
    name: name !== undefined ? String(name).trim() : `Stream ${config.nextSlot}`,
    streamUrl: streamUrl !== undefined ? String(streamUrl).trim() : '',
    streamKey: streamKey !== undefined ? String(streamKey).trim() : '',
  };
  config = { ...config, outputs: [...config.outputs, output], nextSlot: config.nextSlot + 1 };
  saveConfig();
  logLine(`[outputs] added "${output.name}" -> ${outputEndpoint(output)}`);
  res.status(201).json({ output: { ...output, endpoint: outputEndpoint(output) } });
});

app.put('/outputs/:id', (req, res) => {
  const idx = config.outputs.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'no output with that id' });

  const { name, streamUrl, streamKey } = req.body || {};
  const existing = config.outputs[idx];
  const updated = {
    ...existing,
    name: name !== undefined ? String(name).trim() : existing.name,
    streamUrl: streamUrl !== undefined ? String(streamUrl).trim() : existing.streamUrl,
    streamKey: streamKey !== undefined ? String(streamKey).trim() : existing.streamKey,
  };
  const outputs = [...config.outputs];
  outputs[idx] = updated;
  config = { ...config, outputs };
  saveConfig();
  logLine(`[outputs] updated "${updated.name}" (${outputEndpoint(updated)})`);
  res.json({ output: { ...updated, endpoint: outputEndpoint(updated) } });
});

app.delete('/outputs/:id', (req, res) => {
  const existing = config.outputs.find((o) => o.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'no output with that id' });

  config = { ...config, outputs: config.outputs.filter((o) => o.id !== req.params.id) };
  saveConfig();
  logLine(`[outputs] removed "${existing.name}" (${outputEndpoint(existing)} retired, will not be reused)`);
  res.json({ ok: true });
});

// Matches /url1, /url2, ... - one per configured output, permanently
// assigned by slot number regardless of the output's position in the list.
app.get(/^\/url(\d+)$/, (req, res) => {
  const slot = Number(req.params[0]);
  const output = config.outputs.find((o) => o.slot === slot);
  res.type('text/plain').send(output ? fullRtmpUrl(output.streamUrl, output.streamKey) : '');
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
  logLine(`web UI:         http://localhost:${PORT}/`);
  logLine(`maxurl status:  http://localhost:${PORT}/status`);
  if (config.outputs.length === 0) {
    logLine('no stream outputs configured yet - add one in the web UI');
  } else {
    config.outputs.forEach((o) => {
      logLine(`maxurl ${o.name}: http://localhost:${PORT}${outputEndpoint(o)}`);
    });
  }
  addrs.forEach((a) => {
    logLine(`  reachable on this network at http://${a}:${PORT}/status`);
  });
});
