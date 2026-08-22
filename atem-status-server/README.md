# atem-status-server

A standalone Node/Express server that watches a Blackmagic ATEM's
**built-in streaming state** and serves a plain `1`/`0` for Max's
`[maxurl]` to poll — instead of trying to run the ATEM connection inside
Max itself (both the `node.script`/`max-api` and `[shell]` approaches
turned out to be more fragile than just running a normal server).

Runs on its own machine, reachable over the network. Has a small web UI to
configure it.

## Run it

```bash
cd atem-status-server
npm install
npm start          # or: PORT=8080 npm start
```

On startup it logs the URLs to use, e.g.:

```
web UI:            http://localhost:4200/
maxurl status:     http://localhost:4200/status
maxurl rtmp-url:   http://localhost:4200/rtmp-url
(optional separate: /stream-url, /stream-key)
  reachable on this network at http://192.168.5.63:4200/status
```

Open the web UI in a browser (from any machine on the network, using its
real IP/hostname) and set:

- **ATEM IP address**
- **Window start / end** (defaults to 9:30am–11:00am)
- **Armed** — uncheck to make the server ignore the ATEM entirely (forces `0`)
- **Stream URL** — the base RTMP destination (e.g. `rtmp://a.rtmp.youtube.com/live2`)
- **Stream key** — masked by default (click Show to reveal)

There's a live, read-only preview under those two fields showing exactly
what `/rtmp-url` will serve (key masked to match the Show/Hide toggle),
so you can eyeball it before saving.

Click **Save**. The page shows live connection/streaming/window status and
a log of every decision, refreshing every second.

## What Max talks to

You only need **two** `[maxurl]` objects:

```
http://<server-host>:4200/status    -> plain text "1" or "0"
http://<server-host>:4200/rtmp-url  -> plain text full RTMP URL, key already joined in
```

Both respond with plain text — nothing else, no JSON — so they're trivial
to parse on the Max side, and `/rtmp-url` needs no string construction in
the patch: it's already `url + "/" + key`, which is what RTMP ingest
endpoints (YouTube, Twitch, Facebook, most custom RTMP servers) actually
expect as a single URL. Just send `url $1` straight into `jit.rtmp.send~`
with whatever `/rtmp-url` returns.

Poll `/status` on a `[metro]` (e.g. every 500ms–1s) and drive
`jit.rtmp.send~` off **changes** in the value — e.g. `[change]` → route the
bang from a 0→1 transition to a `start` message and a 1→0 transition to a
`stop` message — so you're not re-sending `start` every single poll.
`/rtmp-url` doesn't need constant polling — fetch it once (e.g. on patch
load, or right before you send `start`) since the URL only changes when
you edit it in the web UI.

If you ever need the base URL or key apart from each other, `/stream-url`
and `/stream-key` are still there too.

## How the 1/0 decision is made

- `runtime.atemStreaming` mirrors the ATEM's actual built-in streaming
  state (`state.streaming.status.state`, bitmask-checked against
  `Enums.StreamingStatus.Streaming` from `atem-connection`).
- When the ATEM transitions into streaming (**goes live**) and the current
  time is inside `[windowStart, windowEnd)` and the server is armed, the
  effective value **latches to `1`**.
- It stays `1` even if the window closes while the ATEM is still streaming
  — the window only gates the *start*, not an ongoing stream, matching "if
  it goes live in the window, let it run."
- If the ATEM goes live outside the window, the value stays `0`.
- The moment the ATEM actually stops streaming, the value drops to `0`.
- Unchecking **Armed** forces `0` immediately, regardless of ATEM state.
- The **Manual Override** buttons (Auto / Force ON / Force OFF) bypass all
  of the above — useful for testing the Max wiring without touching the
  real ATEM.
- **Every Sunday at 6:00am Pacific time, the override is force-reset to
  Auto no matter what it was set to** — a safety net so a forgotten Force
  ON/Force OFF from testing can't linger indefinitely. This uses the
  `America/Los_Angeles` timezone (via `node-cron`), so it correctly stays
  at 6am local time across the PST/PDT switch rather than drifting by an
  hour. It only resets the override mode — it does not touch the ATEM IP,
  window, or armed setting.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /status` | plain text `1` or `0` — point `[maxurl]` here |
| `GET /rtmp-url` | plain text full RTMP URL (base URL + key already joined) — and this `[maxurl]` |
| `GET /stream-url` | plain text base RTMP URL only (optional, if you need it separately) |
| `GET /stream-key` | plain text stream key only (optional, if you need it separately) |
| `GET /state` | JSON — full state, used by the web UI |
| `GET /debug` | JSON — raw `atem.state.streaming`, for checking `atem-connection`'s field names if a future version changes them |
| `POST /config` | body `{ atemIp, windowStart, windowEnd, armed, streamUrl, streamKey }` — update settings (persisted to `config.json`, reconnects to the ATEM if the IP changed) |
| `POST /override` | body `{ mode: "auto" \| "on" \| "off" }` — manual override |

## Notes

- Config (including the stream key) persists in plaintext to `config.json`
  next to `server.js` (gitignored) so settings survive a restart.
- No authentication is built in — this is fine given it's LAN-only, per
  your call. `/stream-key` serves the key in plaintext to anyone who can
  reach the server, same as `/status`; if that trust boundary ever changes
  (exposed beyond the LAN), put it behind your own auth/reverse proxy
  first — `POST /config`, `POST /override`, and `GET /stream-key` are all
  unauthenticated.
- The previous two approaches (`node.script`/`max-api`, and `[shell]` +
  `atem-connection` run as a child process) are still on disk in
  `../atem-rtmp-trigger/` for reference but are superseded by this.
