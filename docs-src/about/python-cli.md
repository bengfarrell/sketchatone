---
title: Python CLI
description: Command-line tools for the Python implementation
---

# Python CLI Tools

This document describes the command-line tools available in the Sketchatone Python package.

## Installation

Make sure you have the virtual environment activated:

```bash
source python/venv/bin/activate
```

---

## midi_strummer

Converts tablet input to MIDI output. This is the main tool for using a graphics tablet as a musical strumming controller.

### Usage

```bash
python -m sketchatone.cli.midi_strummer [options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--tablet-config` | `-t` | path | Path to tablet config JSON file |
| `--strummer-config` | `-s` | path | Path to strummer/MIDI config JSON file |
| `--jack` | `-j` | flag | Use JACK MIDI backend instead of rtmidi |
| `--channel` | | 0-15 | MIDI channel (overrides config) |
| `--port` | `-p` | string/int | MIDI output port name or index |
| `--duration` | `-d` | float | Note duration in seconds |
| `--jack-client-name` | | string | JACK client name |
| `--jack-auto-connect` | | string | JACK auto-connect target |
| `--live` | `-l` | flag | Live dashboard mode |

### Examples

```bash
# Basic usage with defaults
python -m sketchatone.cli.midi_strummer

# With combined strummer+MIDI config file
python -m sketchatone.cli.midi_strummer -s strummer.json

# Use JACK MIDI backend
python -m sketchatone.cli.midi_strummer --jack

# Override MIDI channel
python -m sketchatone.cli.midi_strummer --channel 1

# Live dashboard mode
python -m sketchatone.cli.midi_strummer --live
```

---

## strum_event_viewer

Debug tool for viewing strum events from tablet input without sending MIDI.

### Usage

```bash
python -m sketchatone.cli.strum_event_viewer [options]
```

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--config` | `-c` | path | Path to tablet config JSON file |
| `--strummer-config` | `-s` | path | Path to strummer config JSON file |
| `--live` | `-l` | flag | Live dashboard mode |

---

## server

WebSocket and HTTP server for streaming tablet/strummer events to web clients.

### Usage

```bash
python -m sketchatone.cli.server [options]
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

---

## Differences from Node.js CLI

| Feature | Python | Node.js |
|---------|--------|---------|
| JACK MIDI backend | ✓ (via `--jack` flag) | ✗ (rtmidi only) |
| Auto-detect tablet | ✓ | ✓ |
| Default config dir | `../public/configs` | `./public/configs` |
