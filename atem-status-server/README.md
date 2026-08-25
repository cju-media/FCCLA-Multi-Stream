# atem-status-server

A standalone Node/Express server that watches a Blackmagic ATEM's
**built-in streaming state** and serves a plain `1`/`0` for Max's
`[maxurl]` to poll, plus one full RTMP URL per named stream output —
instead of trying to run the ATEM connection inside Max itself (both the
`node.script`/`max-api` and `[shell]` approaches turned out to be more
fragile than just running a normal server).

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
web UI:         http://localhost:4200/
maxurl status:  http://localhost:4200/status
maxurl YouTube Main: http://localhost:4200/url1
maxurl Twitch Backup: http://localhost:4200/url2
  reachable on this network at http://192.168.5.63:4200/status
```

Open the web UI in a browser (from any machine on the network, using its
real IP/hostname) and set:

- **ATEM IP address**
- **Window start / end** (defaults to 9:00am–11:00am)
- **Days active** — which days of the week the window applies on, as toggle
  buttons (defaults to **Sunday only**); the ATEM going live on any other
  day is ignored regardless of the time
- **Armed** — uncheck to make the server ignore the ATEM entirely (forces `0`)
- **Stream Outputs** — add as many named RTMP destinations as you want; each
  gets its own Name, Stream URL, Stream key (masked, click Show to reveal),
  and a permanent `/urlN` endpoint. Edit or remove any of them any time.

Each output row shows a live, read-only preview of exactly what its `/urlN`
endpoint will serve (key masked to match that row's Show/Hide toggle), so
you can eyeball it before saving.

The page shows live connection/streaming/window status and a log of every
decision, refreshing every second.

## What Max talks to

One `[maxurl]` for the shared on/off signal, plus one more per output:

```
http://<server-host>:4200/status  -> plain text "1" or "0" - shared by every output
http://<server-host>:4200/url1    -> plain text full RTMP URL for output #1
http://<server-host>:4200/url2    -> plain text full RTMP URL for output #2
...
```

Every response is plain text — nothing else, no JSON — and each `/urlN`
already has the stream key joined onto the base URL (`url + "/" + key`,
which is what RTMP ingest endpoints - YouTube, Twitch, Facebook, most
custom RTMP servers - actually expect as a single URL). Just send `url $1`
straight into that output's `jit.rtmp.send~` with whatever `/urlN` returns
— no string construction needed in the patch.

Poll `/status` on a `[metro]` (e.g. every 500ms–1s) and drive every output's
`jit.rtmp.send~` off **changes** in that one shared value — e.g. `[change]`
→ route the bang from a 0→1 transition to a `start` message (fanned out to
all your `jit.rtmp.send~` objects) and a 1→0 transition to a `stop`
message — so you're not re-sending `start` every single poll. `/urlN`
endpoints don't need constant polling — fetch each once (e.g. on patch
load, or right before you send `start`) since a URL only changes when you
edit that output in the web UI.

### Endpoint numbers are permanent, not positional

Each output's `/urlN` is assigned once, when it's created, from an
ever-increasing counter — not from its position in the list. Deleting an
earlier output never renumbers the ones after it, and a deleted slot is
never reused. So once you've wired `[maxurl]` → `/url2` in your Max patch
for a specific destination, that mapping stays valid even if you delete
`/url1` or add new outputs later. A deleted output's endpoint just starts
returning an empty string.

## How the 1/0 decision is made

- `runtime.atemStreaming` mirrors the ATEM's actual built-in streaming
  state (`state.streaming.status.state`, bitmask-checked against
  `Enums.StreamingStatus.Streaming` from `atem-connection`).
- When the ATEM transitions into streaming (**goes live**) and the current
  day is one of **Days active** (default: Sunday only) and the time is
  inside `[windowStart, windowEnd)` and the server is armed, the effective
  value **latches to `1`**. This one decision is shared by every configured
  output — they all start and stop together.
- It stays `1` even if the window closes while the ATEM is still streaming
  — the window only gates the *start*, not an ongoing stream, matching "if
  it goes live in the window, let it run."
- If the ATEM goes live on the wrong day, or on the right day but outside
  the time range, the value stays `0`. The log distinguishes the two so
  it's obvious which one happened.
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
  window, armed setting, or any output.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /status` | plain text `1` or `0` — point `[maxurl]` here, shared by every output |
| `GET /url1`, `/url2`, ... | plain text full RTMP URL for that output — one `[maxurl]` per output |
| `GET /outputs` | JSON — list of configured outputs, used by the web UI |
| `POST /outputs` | body `{ name, streamUrl, streamKey }` — add a new output, assigns it the next `/urlN` |
| `PUT /outputs/:id` | body `{ name, streamUrl, streamKey }` (partial) — update an existing output |
| `DELETE /outputs/:id` | remove an output (its `/urlN` is retired, never reused) |
| `GET /state` | JSON — full state, used by the web UI |
| `GET /debug` | JSON — raw `atem.state.streaming`, for checking `atem-connection`'s field names if a future version changes them |
| `POST /config` | body `{ atemIp, windowStart, windowEnd, windowDays, armed }` — update settings (persisted to `config.json`, reconnects to the ATEM if the IP changed); `windowDays` is an array of integers 0-6, `0`=Sunday ... `6`=Saturday |
| `POST /override` | body `{ mode: "auto" \| "on" \| "off" }` — manual override |

## Notes

- Config (including every output's stream key) persists in plaintext to
  `config.json` next to `server.js` (gitignored) so settings survive a
  restart.
- No authentication is built in — this is fine given it's LAN-only, per
  your call. Any `/urlN` serves that output's key in plaintext to anyone
  who can reach the server, same as `/status`; if that trust boundary ever
  changes (exposed beyond the LAN), put it behind your own auth/reverse
  proxy first — `POST`/`PUT`/`DELETE /outputs`, `POST /config`, and
  `POST /override` are all unauthenticated.
- Upgrading from an earlier version whose `config.json` predates **Days
  active**: it has no `windowDays` field, so it picks up the default
  (Sunday only) automatically — it does **not** retroactively change your
  saved `windowStart`/`windowEnd`, only fills in the missing day
  restriction. Check the web UI once after upgrading if you want every day
  active, or a different day, instead of Sunday.
- Upgrading from the earlier single-output version: the old
  `streamUrl`/`streamKey` config fields are migrated automatically into a
  single output (assigned `/url1`) the first time the server starts up
  with the new code, and written back to `config.json` immediately. The
  old `/rtmp-url`, `/stream-url`, and `/stream-key` endpoints no longer
  exist — repoint any `[maxurl]` still using them at `/url1`.
- The previous two approaches (`node.script`/`max-api`, and `[shell]` +
  `atem-connection` run as a child process) are still on disk in
  `../atem-rtmp-trigger/` for reference but are superseded by this.
