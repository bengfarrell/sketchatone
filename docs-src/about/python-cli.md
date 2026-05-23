---
title: Python CLI
description: Command-line tools for the Python implementation
---

# Python CLI Tools

This document describes the command-line tools available in the Sketchatone Python package.

## Installation

If you don't already have a virtual environment set up, create one and install the package:

```bash
cd python
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools
pip install -e .
```

> **Note:** The `pip install --upgrade pip setuptools` step is required if your venv ships with an older pip (< 21.3). Editable installs of this project need pip ≥ 21.3 and setuptools ≥ 64, since the project uses `pyproject.toml` without a `setup.py`.
>
> The `pip install -e .` step will also fetch and build [blankslate](https://github.com/bengfarrell/blankslate) from GitHub, since it's declared as a git dependency in `pyproject.toml`. No separate clone is required.

### Optional: JACK MIDI backend

The default rtmidi backend works on macOS, Windows, and Linux without extra setup. If you want to use the JACK backend instead (typically on Linux/Zynthian), install the `[jack]` extra:

```bash
pip install -e ".[jack]"
```

This requires the JACK system library and daemon (`jackd`) to be installed first — e.g. `sudo apt install jackd2 libjack-jackd2-dev` on Debian/Pi OS, or `brew install jack` on macOS. See [JACK MIDI](/about/jack-midi/) for backend configuration.

Otherwise, just activate the existing venv before running any of the commands below:

```bash
cd python
source venv/bin/activate
```

See [Building from Source](/about/builds/) for more details.

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
| `--config` | `-c` | path | Combined config file path (strummer, MIDI, and server settings). Device path is specified in the `server.device` field. |
| `--jack` | `-j` | flag | Use JACK MIDI backend instead of rtmidi (overrides config) |
| `--channel` | | 1-16 | MIDI channel (overrides config) |
| `--port` | `-p` | string/int | MIDI output port name or index (overrides config) |
| `--duration` | `-d` | seconds | Note duration in seconds (overrides config) |
| `--jack-client-name` | | string | JACK client name (overrides config) |
| `--jack-auto-connect` | | string | JACK auto-connect target (overrides config) |
| `--live` | `-l` | flag | Live dashboard mode (updates in place) |

### Examples

```bash
# Basic usage with defaults
python -m sketchatone.cli.midi_strummer

# With combined config file
python -m sketchatone.cli.midi_strummer -c public/configs/default.json

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

```bash
python -m sketchatone.cli.server -c public/configs/default.json
```

> **Note:** If you serve the webapp via `--http-port` and get a `Not Found` page (or `[List Configs] Failed to list configs: [Errno 2] No such file or directory: '.../dist/public/configs'` in the terminal), it means the webapp hasn't been built yet. The HTTP server reads from `dist/public/`, which is produced by Vite. Run `npm run build` once from the repo root to generate it:
>
> ```bash
> npm install   # if you haven't already
> npm run build
> ```
>
> For active frontend development, run `npm run dev` in a separate terminal instead and browse to `http://localhost:3000` — the Vite dev server will hot-reload while the Python server handles the WebSocket on 8081.

> **Note:** If your config has a `keyboard.mappings` section (the default config does), the server enables a system-level keyboard listener so that keyboard keys can simulate tablet buttons. This requires elevated permissions because it reads from the OS input layer:
>
> - **Linux:** reads `/dev/input/event*` via `evdev`. Run with `sudo`, or add your user to the `input` group (`sudo usermod -a -G input $USER`, then log out/in). The Pi `.deb` installer sets up udev rules so this isn't needed when running as a systemd service.
> - **macOS:** uses `pynput` for global key hooks. Either run with `sudo`, or grant your terminal Accessibility permissions in System Settings → Privacy & Security → Accessibility.
> - **No mappings = no listener:** to skip the requirement entirely, remove the `keyboard.mappings` from your config (or leave it empty).
>
> Symptoms when permissions are missing: terminal logs `[Keyboard] ERROR: Permission denied` or `[Keyboard] ERROR: evdev not installed` followed by sudo/group instructions.

### Optional Arguments

| Argument | Short | Type | Description |
|----------|-------|------|-------------|
| `--config` | `-c` | path | Combined config file path (strummer, MIDI, and server settings). Device path is specified in the `server.device` field. |
| `--ws-port` | | int | WebSocket server port (default: 8081) |
| `--wss-port` | | int | Secure WebSocket server port with SSL (optional) |
| `--http-port` | | int | HTTP server port for serving webapps (optional) |
| `--https-port` | | int | HTTPS server port for captive portal detection on Android 10+ (optional) |
| `--throttle` | `-t` | ms | Event throttle interval in milliseconds (default: 150) |
| `--poll` | | ms | Poll interval in ms for waiting for a device. If not set, quit if no device found. |
| `--dev` | | flag | Development mode: run without a tablet device (UI only, no tablet input) |
| `--jack` | `-j` | flag | Use JACK MIDI backend instead of rtmidi |
| `--channel` | | 1-16 | MIDI channel (overrides config) |
| `--port` | `-p` | string/int | MIDI output port name or index (overrides config) |
| `--duration` | `-d` | seconds | Note duration in seconds (overrides config) |
| `--jack-client-name` | | string | JACK client name |
| `--jack-auto-connect` | | string | JACK auto-connect target |
| `--dump-config` | | flag | Load config, print as JSON, and exit (for testing) |

---

## Running Tests

Run the test suite to verify your changes:

```bash
cd python
source venv/bin/activate
pytest tests/
```

Or with coverage:

```bash
pytest tests/ --cov=sketchatone
```

---

## Differences from Node.js CLI

| Feature | Python | Node.js |
|---------|--------|---------|
| JACK MIDI backend | ✓ (via `--jack` flag) | ✗ (rtmidi only) |
| Auto-detect tablet | ✓ | ✓ |
| Default config dir | `../public/configs` | `./public/configs` |
