---
title: Node.js CLI
description: Command-line tools for the Node.js/TypeScript implementation
---

# Node.js CLI Tools

This document describes the command-line tools available in the Sketchatone Node.js/TypeScript package.

## Installation

Build the CLI tools first:

```bash
npm run build:cli
```

Then run via npm scripts:

```bash
npm run strum-events
npm run midi-strummer
```

---

## midi-strummer

Converts tablet input to MIDI output. This is the main tool for using a graphics tablet as a musical strumming controller.

### Usage

```bash
npm run midi-strummer [-- options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--tablet-config` | `-t` | path | Path to tablet config JSON file or directory |
| `--strummer-config` | `-s` | path | Path to strummer/MIDI config JSON file |
| `--channel` | | 0-15 | MIDI channel (overrides config) |
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
npm run dev-server [-- options]  # With automatic rebuild
```

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
