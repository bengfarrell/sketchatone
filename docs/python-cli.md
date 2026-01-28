# Python CLI Tools

This document describes the command-line tools available in the Sketchatone Python package.

## Installation

All CLI tools are part of the `sketchatone` Python package. Make sure you have the virtual environment activated:

```bash
source python/venv/bin/activate
```

---

## midi_strummer

Converts tablet input to MIDI output. This is the main tool for using a graphics tablet as a musical strumming controller.

### Usage

```bash
python -m sketchatone.cli.midi_strummer -t <tablet-config> [options]
```

### Required Arguments

| Argument | Short | Description |
|----------|-------|-------------|
| `--tablet-config` | `-t` | Path to tablet config JSON file (HID device settings) |

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--strummer-config` | `-s` | path | Path to strummer/MIDI config JSON file (can contain both strummer and MIDI settings) |
| `--jack` | `-j` | flag | Use JACK MIDI backend instead of rtmidi (overrides config) |
| `--channel` | | 0-15 | MIDI channel (overrides config) |
| `--port` | `-p` | string/int | MIDI output port name or index (overrides config) |
| `--duration` | `-d` | float | Note duration in seconds (overrides config) |
| `--jack-client-name` | | string | JACK client name (overrides config) |
| `--jack-auto-connect` | | string | JACK auto-connect target (overrides config) |
| `--live` | `-l` | flag | Live dashboard mode (updates in place) |

### Examples

```bash
# Basic usage with defaults
python -m sketchatone.cli.midi_strummer -t tablet.json

# With combined strummer+MIDI config file
python -m sketchatone.cli.midi_strummer -t tablet.json -s strummer.json

# Override backend via CLI (use JACK instead of rtmidi)
python -m sketchatone.cli.midi_strummer -t tablet.json --jack

# Override MIDI channel
python -m sketchatone.cli.midi_strummer -t tablet.json --channel 1

# Specify MIDI port by index
python -m sketchatone.cli.midi_strummer -t tablet.json -p 2

# Specify MIDI port by name
python -m sketchatone.cli.midi_strummer -t tablet.json -p "IAC Driver"

# Live dashboard mode
python -m sketchatone.cli.midi_strummer -t tablet.json --live
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

## strum_event_viewer

Debug tool for viewing strum events from tablet input without sending MIDI. Useful for testing tablet configuration and strummer settings.

### Usage

```bash
python -m sketchatone.cli.strum_event_viewer -c <tablet-config> [options]
```

### Required Arguments

| Argument | Short | Description |
|----------|-------|-------------|
| `--config` | `-c` | Path to tablet config JSON file |

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--live` | `-l` | flag | Live dashboard mode (updates in place) |

### Examples

```bash
# Basic usage with tablet config
python -m sketchatone.cli.strum_event_viewer -c tablet-config.json

# With custom strummer config
python -m sketchatone.cli.strum_event_viewer -c tablet-config.json -s strummer-config.json

# Live dashboard mode
python -m sketchatone.cli.strum_event_viewer -c tablet-config.json --live
```

---

## server

WebSocket and HTTP server for streaming tablet/strummer events to web clients and serving the bundled webapps.

### Usage

```bash
python -m sketchatone.cli.server [options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--tablet-config` | `-t` | path | Path to tablet config JSON file or directory (auto-detects from ../public/configs if not provided) |
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--ws-port` | | int | WebSocket server port (default: 8081) |
| `--http-port` | | int | HTTP server port for serving webapps (optional) |
| `--throttle` | | int | Event throttle interval in milliseconds (default: 150) |
| `--poll` | | int | Poll interval in milliseconds for waiting for device. If not set, quit if no device found. |

### Examples

```bash
# Start WebSocket server only (default port 8081)
python -m sketchatone.cli.server

# Start both WebSocket and HTTP servers
python -m sketchatone.cli.server --ws-port 8081 --http-port 3000

# With device polling (hot-plug support)
python -m sketchatone.cli.server --poll 2000
```

### Building Webapps

Before using the HTTP server to serve webapps, build them using the Node.js build:

```bash
npm run build
```

This outputs the bundled webapps to `dist/public/`.

---

## Config Files

### Tablet Config

The tablet config file defines the HID device settings for your graphics tablet. Example location: `public/configs/tablet.json`

### Strummer Config

The strummer config file defines musical settings (chord, notes, velocity, etc.) and optionally MIDI backend settings. Example location: `public/configs/midi-strummer.json`
