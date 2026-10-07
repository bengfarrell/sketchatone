---
title: CLI Flags Reference
description: All command-line flags across the Node.js and Python implementations
---

# CLI Flags Reference

Sketchatone has two implementations — Node.js/TypeScript and Python — each with several CLI tools. This page lists every flag, which tools support it, and what it does.

**Legend:** ✓ supported &nbsp; — not available

---

## server / server.ts

The main WebSocket server that reads from the tablet and streams events to clients.

| Flag | Short | Type | Python | Node.js | Description |
|---|---|---|:---:|:---:|---|
| `--config` | `-c` | path | ✓ | ✓ | Combined config file (strummer, MIDI, server). Device path is in the `server.device` field. |
| `--tablet-config` | `-t` | path | — | ✓ | Tablet config JSON path (Node.js splits tablet/strummer configs) |
| `--strummer-config` | `-s` | path | — | ✓ | Strummer config JSON path (Node.js splits tablet/strummer configs) |
| `--ws-port` | | int | ✓ | ✓ | WebSocket server port (default: 8081) |
| `--wss-port` | | int | ✓ | — | Secure WebSocket port (WSS with SSL) |
| `--http-port` | | int | ✓ | ✓ | HTTP server port for serving the web dashboard |
| `--https-port` | | int | ✓ | — | HTTPS server port for captive portal support |
| `--no-http` | | flag | ✓ | — | Disable HTTP server regardless of config (used internally by the Kivy bridge) |
| `--no-https` | | flag | ✓ | — | Disable HTTPS server regardless of config (used internally by the Kivy bridge) |
| `--throttle` | `-t` | ms | ✓ | ✓ | Event throttle interval in milliseconds (default: 150) |
| `--poll` | | ms | ✓ | ✓ | Poll interval for device detection; server waits for tablet instead of exiting (default: exit if no device) |
| `--dev` | | flag | ✓ | ✓ | Dev mode: skip tablet detection entirely, run server without hardware |
| `--jack` | `-j` | flag | ✓ | — | Use JACK MIDI backend instead of rtmidi |
| `--channel` | | 1–16 | ✓ | — | MIDI channel override |
| `--port` | `-p` | str/int | ✓ | — | MIDI output port name or index override |
| `--duration` | `-d` | seconds | ✓ | — | Note duration override |
| `--jack-client-name` | | string | ✓ | — | JACK client name |
| `--jack-auto-connect` | | string | ✓ | — | JACK auto-connect target port |
| `--dump-config` | | flag | ✓ | — | Load config, print as JSON, and exit (for debugging) |

---

## midi-strummer / midi_strummer

Converts tablet input to MIDI output directly, without a WebSocket server. Useful for standalone use or low-latency testing.

| Flag | Short | Type | Python | Node.js | Description |
|---|---|---|:---:|:---:|---|
| `--config` | `-c` | path | ✓ | — | Combined config file path |
| `--tablet-config` | `-t` | path | — | ✓ | Tablet config JSON path |
| `--strummer-config` | `-s` | path | — | ✓ | Strummer config JSON path |
| `--jack` | `-j` | flag | ✓ | — | Use JACK MIDI backend instead of rtmidi |
| `--channel` | | 1–16 | ✓ | ✓ | MIDI channel override |
| `--port` | `-p` | str/int | ✓ | ✓ | MIDI output port name or index override |
| `--duration` | `-d` | seconds | ✓ | ✓ | Note duration override |
| `--jack-client-name` | | string | ✓ | — | JACK client name |
| `--jack-auto-connect` | | string | ✓ | — | JACK auto-connect target port |
| `--live` | `-l` | flag | ✓ | ✓ | Live dashboard mode (terminal UI, updates in place) |

---

## ui (Python only)

Native Kivy dashboard for the Raspberry Pi appliance. Runs the server as a subprocess and connects over a local WebSocket.

| Flag | Short | Type | Description |
|---|---|---|---|
| `--config` | `-c` | path | Combined config file path |
| `--enable-ws` | | flag | Also expose the server's WebSocket publicly (for browser dashboard or LAN access) |
| `--ws-port` | | int | WebSocket port when `--enable-ws` is set (default: 8081) |
| `--throttle` | | ms | Event throttle interval in milliseconds (default: 150) |
| `--poll` | | ms | Device poll interval; waits for tablet if not connected (default: 2000) |
| `--fps` | | int | Kivy render framerate cap (default: 15). Lower values free more CPU for the audio path. |
| `--dev` | | flag | Dev mode: skip tablet detection entirely |
| `--fullscreen` | | flag | Launch fullscreen (recommended on the device) |
| `--hot-reload` | | flag | Watch `sketchatone/ui/` and rebuild widget tree on save (requires `pip install -e ".[hotreload]"`) |
| `--shell` | | flag | Debug: run a blank 1 fps Kivy window with the server subprocess active but no UI panels loaded. Useful for isolating whether stutters come from Kivy or the server. |
| `--dry-run` | | flag | Parse arguments and exit without opening a window |

---

## strum-events / strum_event_viewer

Debug tool for inspecting strum events without sending MIDI output.

| Flag | Short | Type | Python | Node.js | Description |
|---|---|---|:---:|:---:|---|
| `--config` | `-c` | path | ✓ | ✓ | Config file path |
| `--strummer-config` | `-s` | path | ✓ | ✓ | Strummer config JSON path (Python uses `--config` for combined config) |
| `--live` | `-l` | flag | ✓ | ✓ | Live dashboard mode |

---

## Environment variables

These apply to the Python server and are never set in production.

| Variable | Description |
|---|---|
| `SKETCHATONE_STRUM_PERF=1` | Enable per-30-second `[PERF]` timing summaries for tablet gap, HID reads, GC pauses, and strum path. See **[Performance](/about/performance/)**. |
| `SKETCHATONE_GC_DISABLE=1` | Disable cyclic GC entirely. Zero pauses; memory grows over time. Use for A/B testing whether a hitch is GC-related. |
| `SKETCHATONE_GC_IDLE_DISABLE=1` | Disable the cooperative idle GC scheduler. Auto-GC still runs on raised thresholds. |
| `SKETCHATONE_GC_THRESHOLDS=a,b,c` | Override GC thresholds (e.g. `700,10,10` restores Python defaults). |
