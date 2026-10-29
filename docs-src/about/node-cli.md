---
title: Node.js CLI
description: Manually launched Node.js tools for core musical behavior and diagnostics
---

# Node.js CLI Tools

The Node.js/TypeScript implementation is a limited, manually launched alternative
for core musical use and diagnostics. Python is the primary backend for packaged
desktop installations and Raspberry Pi appliances.

### Scope and maintenance

Keep shared musical behavior synchronized with Python: tablet-to-strum processing,
chord changes and progressions, note mapping, velocity, pitch bend, action rules,
and common configuration semantics. Shared musical changes and bug fixes should
include corresponding updates and regression coverage in both implementations.
Node.js remains an alternate utility, not a frozen or deprecated reference.

Appliance features do not need Node.js equivalents. Managed Wi-Fi, fallback
hotspots, USB tethering management, guided appliance setup, system-service
integration, and the native Pi UI belong to the Python appliance. Node's server
can still serve the browser dashboard over networking managed by the OS; its
Network panel reports device networking management as unsupported. JACK MIDI
is also Python-only; Node uses rtmidi.

Use the existing npm CLI commands below when you want to run Node manually.
The release installers do not select it as a backend. See the
[Python CLI](/about/python-cli/) for the primary runtime and
[CLI Flags](/about/cli-flags/) for per-tool differences.

## Installation

From the repository root, install dependencies and build the CLI tools:

```bash
npm install
npm run build:cli
```

Then run via npm scripts:

```bash
npm run strum-events
npm run midi-strummer
```

---

## midi-strummer

Converts tablet input to MIDI output without the web server.

### Usage

```bash
npm run midi-strummer [-- options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--tablet-config` | `-t` | path | Path to tablet config JSON file or directory |
| `--strummer-config` | `-s` | path | Path to strummer/MIDI config JSON file |
| `--channel` | | 1-16 | MIDI channel (overrides config) |
| `--port` | `-p` | string/int | MIDI output port name or index |
| `--duration` | `-d` | float | Note duration in seconds |
| `--live` | `-l` | flag | Live dashboard mode |

### Examples

```bash
# Auto-detect tablet from default config directory
npm run midi-strummer

# With combined strummer+MIDI config file
npm run midi-strummer -- -t tablet.json -s strummer.json

# Override MIDI channel
npm run midi-strummer -- --channel 1

# Specify MIDI port by name
npm run midi-strummer -- -p "IAC Driver"

# Live dashboard mode
npm run midi-strummer -- --live
```

---

## strum-events

Debug tool for viewing strum events from tablet input without sending MIDI.

### Usage

```bash
npm run strum-events [-- options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--config` | `-c` | path | Path to tablet config JSON file or directory |
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--live` | `-l` | flag | Live dashboard mode |

---

## server

WebSocket and HTTP server for streaming tablet/strummer events to web clients.

### Usage

```bash
npm run server [-- options]
npm run dev-server [-- options]  # Rebuild once before launching
```

Run `npm run build` instead of just `build:cli` when you also need to build the
web dashboard assets.

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--tablet-config` | `-t` | path | Path to tablet config JSON file or directory |
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--ws-port` | | int | WebSocket server port (default: 8081) |
| `--http-port` | | int | HTTP server port for webapps |
| `--throttle` | | int | Event throttle interval in ms (default: 150) |
| `--poll` | | int | Poll interval for device detection |

### Examples

```bash
# Start WebSocket server only
npm run server

# Start both WebSocket and HTTP servers
npm run server -- --ws-port 8081 --http-port 3000

# With device polling (hot-plug support)
npm run server -- --poll 2000
```

---

## Running Tests

Run the test suite to verify your changes:

```bash
npm test
```
