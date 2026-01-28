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

Or directly:

```bash
node ./dist/cli/strum-event-viewer.js
node ./dist/cli/midi-strummer.js
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
| `--tablet-config` | `-t` | path | Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided) |
| `--strummer-config` | `-s` | path | Path to strummer/MIDI config JSON file (can contain both strummer and MIDI settings) |
| `--channel` | | 0-15 | MIDI channel (overrides config) |
| `--port` | `-p` | string/int | MIDI output port name or index (overrides config) |
| `--duration` | `-d` | float | Note duration in seconds (overrides config) |
| `--live` | `-l` | flag | Live dashboard mode (updates in place) |

### Examples

```bash
# Auto-detect tablet from default config directory
npm run midi-strummer

# Auto-detect tablet from specific directory
npm run midi-strummer -- -t ./configs/

# Basic usage with specific config file
npm run midi-strummer -- -t tablet.json

# With combined strummer+MIDI config file
npm run midi-strummer -- -t tablet.json -s strummer.json

# Override MIDI channel
npm run midi-strummer -- -t tablet.json --channel 1

# Specify MIDI port by index
npm run midi-strummer -- -t tablet.json -p 2

# Specify MIDI port by name
npm run midi-strummer -- -t tablet.json -p "IAC Driver"

# Live dashboard mode
npm run midi-strummer -- -t tablet.json --live
```

### Config File Format

The strummer config file uses a nested format with a `strumming` section for core settings and optional `midi` section:

```json
{
  "strumming": {
    "chord": "Am7",
    "pressure_threshold": 0.1,
    "pluck_velocity_scale": 4.0,
    "initial_notes": [],
    "lower_note_spread": 2,
    "upper_note_spread": 2,
    "midi_channel": 0
  },
  "midi": {
    "midi_output_backend": "rtmidi",
    "midi_output_id": 2
  }
}
```

---

## strum-events

Debug tool for viewing strum events from tablet input without sending MIDI. Useful for testing tablet configuration and strummer settings.

### Usage

```bash
npm run strum-events [-- options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--config` | `-c` | path | Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided) |
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--live` | `-l` | flag | Live dashboard mode (updates in place) |

### Examples

```bash
# Auto-detect tablet from default config directory
npm run strum-events

# Auto-detect tablet from specific directory
npm run strum-events -- -c ./configs/

# Basic usage with tablet config
npm run strum-events -- -c tablet-config.json

# With custom strummer config
npm run strum-events -- -c tablet-config.json -s strummer-config.json

# Live dashboard mode
npm run strum-events -- -c tablet-config.json --live
```

---

## server

WebSocket and HTTP server for streaming tablet/strummer events to web clients and serving the bundled webapps.

### Usage

```bash
npm run server [-- options]
```

Or directly:

```bash
node ./dist/cli/server.js [options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--tablet-config` | `-t` | path | Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided) |
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--ws-port` | | int | WebSocket server port (default: 8081) |
| `--http-port` | | int | HTTP server port for serving webapps (optional) |
| `--throttle` | | int | Event throttle interval in milliseconds (default: 150) |
| `--poll` | | int | Poll interval in milliseconds for waiting for device. If not set, quit if no device found. |

### Examples

```bash
# Start WebSocket server only (default port 8081)
npm run server

# Start both WebSocket and HTTP servers
npm run server -- --ws-port 8081 --http-port 3000

# With device polling (hot-plug support)
npm run server -- --poll 2000
```

### Building Webapps

Before using the HTTP server to serve webapps, build them first:

```bash
npm run build
```

This outputs the bundled webapps to `dist/public/`.

---

## Config Files

### Tablet Config

The tablet config file defines the HID device settings for your graphics tablet. Example location: `public/configs/tablet.json`

When no config is specified, the CLI tools will automatically search `./public/configs/` for a config file matching a connected tablet device.

### Strummer Config

The strummer config file defines musical settings (chord, notes, velocity, etc.) and optionally MIDI backend settings. Example location: `public/configs/midi-strummer.json`

---

## Differences from Python CLI

| Feature | Python | Node.js |
|---------|--------|---------|
| JACK MIDI backend | ✓ (via `--jack` flag) | ✗ (rtmidi only) |
| Auto-detect tablet | ✓ | ✓ |
| Default config dir | `../public/configs` | `./public/configs` |
| Command prefix | `python -m sketchatone.cli.` | `npm run ` |
