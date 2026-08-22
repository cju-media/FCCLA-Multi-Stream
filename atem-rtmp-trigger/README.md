# ATEM live → jit.rtmp.send~ trigger

Watches a Blackmagic ATEM's **built-in streaming state** (the "Start
Streaming" feature on models like ATEM Mini Pro, Mini Extreme, and
Constellation HD) and, only when it goes live **between 9:30am and 11:00am
local time**, sends a start message into `jit.rtmp.send~`. When the ATEM
stops streaming, it sends a stop message.

## Architecture (v2 — via `[shell]`, not Node for Max)

The first version of this ran `atem-connection` inside Max's `node.script`
(Node for Max). That turned out not to work reliably, so this now runs as a
**plain standalone Node.js process spawned by Max's classic `[shell]`
external**, using your system Node install instead of Max's embedded one:

- Max's `[shell]` object spawns [`atem-live-monitor.js`](atem-live-monitor.js)
  once, as a long-running child process, and streams its stdout back into
  the patch line-by-line as messages (`start`, `stop`, `status ...`, `log ...`).
- Runtime control (arm/disarm, change the window, force a test, ask for
  status) does **not** go back through `[shell]` — it's genuinely unclear
  whether a given `[shell]` build forwards further inlet input to the
  child's stdin, so that path isn't relied on. Instead the monitor script
  also opens a plain **UDP socket on `127.0.0.1:7415`**, and the patch talks
  to it with a vanilla `[udpsend 127.0.0.1 7415]` object. No ambiguity, no
  dependency on `[shell]`'s exact semantics.

## Requirements

- Max with the classic `[shell]` external available (CNMAT's `shell`, or
  equivalent) — the patch will error loading `[shell]` if you don't have
  one installed
- A system Node.js install reachable at a known path (this was built
  against `/usr/local/bin/node` — run `which node` and update the path in
  the patch's `shell ...` message if yours differs)
- An ATEM model with built-in streaming, on the same network as the Max
  machine, with its IP address known

## Setup

```bash
cd atem-rtmp-trigger
npm install
```

Then open `atem-rtmp-trigger.maxpat` in Max.

1. Edit the big `shell /usr/local/bin/node .../atem-live-monitor.js <ip> <startHr> <endHr> <controlPort>`
   message box: check the `node` path is right for your machine, set your
   ATEM's real IP, and the window (decimal hours — `9.5 11` = 9:30am–11:00am).
   Click it to spawn the monitor.
   - To respawn with different settings, click the bare `shell` message
     first (kills the running child), then click the spawn message again.
2. Edit the `jit.rtmp.send~ @url ... @streamkey ...` object with your real
   RTMP destination and stream key, and patch your actual audio/video
   signal chain into it — this patch only wires the *start/stop control
   messages*, same as before.
3. Watch the Max console: the script posts every connect/disconnect and
   every live/stop decision, including *why* it did or didn't fire (e.g.
   "outside the 9:30am-11:00am window"), via `[print atem-status]`. The
   spawned process itself exiting unexpectedly shows up via
   `[print atem-shell-exit]`.

## Runtime control (via UDP, not `[shell]`)

Send these into `[udpsend 127.0.0.1 7415]`:

| Message | Effect |
|---|---|
| `setwindow <startHr> <endHr>` | change the allowed window without respawning, e.g. `setwindow 9.5 11` |
| `arm 0` / `arm 1` | disarm/arm triggering without disconnecting from the ATEM |
| `status` | posts connected/streaming/armed/window state to the console (as a `log` line) |
| `debugstate` | posts the raw `atem.state.streaming` object — useful if a future `atem-connection` version renames fields |
| `test` | forces a `start` line, bypassing the ATEM and the time window — for checking the `route → jit.rtmp.send~` wiring only |

## How "goes live" is detected

`atem-connection` exposes `state.streaming.status.state`, a bitmask
(`Enums.StreamingStatus`: `Idle=1, Connecting=2, Streaming=4, Stopping=32`).
The script bitwise-checks the `Streaming` bit rather than hardcoding a raw
number, and watches for the transition into that state — only emitting
`start` if `Date()` at that instant falls inside the configured window. It
uses whatever local timezone the machine running the script is set to.

If a future `atem-connection` release changes these field names, send
`debugstate` (over UDP) after connecting while the ATEM is live to see the
actual shape and adjust the `isStreaming` check in
[`atem-live-monitor.js`](atem-live-monitor.js) accordingly.

## Files

- [`atem-live-monitor.js`](atem-live-monitor.js) — the standalone Node CLI, spawned via `[shell]`
- [`atem-rtmp-trigger.maxpat`](atem-rtmp-trigger.maxpat) — the Max patch
- [`package.json`](package.json) — declares `atem-connection` (no `max-api` — that's not used anymore)
- `atem-live-trigger.js` — **superseded**, the old `node.script`/`max-api` version; left in place for reference only, not wired into the current patch
