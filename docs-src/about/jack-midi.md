---
title: JACK MIDI
description: Using Sketchatone with JACK Audio Connection Kit for Zynthian and professional audio systems
---

# JACK MIDI Support

Sketchatone supports **JACK MIDI** output for integration with professional audio systems, particularly the **Zynthian** open synthesizer platform.

## What is JACK MIDI?

**JACK Audio Connection Kit** is a professional sound server that provides real-time, low-latency connections for audio and MIDI data between applications.

## When to Use JACK MIDI

Use JACK MIDI if you:

- ✅ Run Sketchatone on **Zynthian** (highly recommended)
- ✅ Use JACK-based audio systems on Linux
- ✅ Need advanced MIDI routing capabilities
- ✅ Want lowest possible latency

Use standard rtmidi if you:

- ✅ Run Sketchatone on macOS or Windows
- ✅ Use a DAW without JACK integration
- ✅ Need simple MIDI output to one device

## Installation

### Install JACK Server

**On Zynthian:**
JACK is pre-installed. No additional setup needed.

**On Linux:**
```bash
sudo apt install jackd2 qjackctl
```

### Install Python JACK Library

```bash
pip install JACK-Client
```

## Configuration

### Basic JACK MIDI Setup

```json
{
  "midi": {
    "midi_output_backend": "jack",
    "jack_client_name": "sketchatone",
    "jack_auto_connect": "chain0"
  }
}
```

### Configuration Options

#### `midi_output_backend`

**Values:** `"rtmidi"` (default) or `"jack"`

#### `jack_client_name`

**Default:** `"sketchatone"`

Sets the JACK client name. The MIDI output port will appear as `{clientName}:midi_out`.

#### `jack_auto_connect`

**Values:** `"chain0"` (default), `"all-chains"`, or `"none"`

> **⚠️ ZYNTHIAN-SPECIFIC:** Auto-connection is designed specifically for Zynthian's `ZynMidiRouter` architecture.

**Options:**
- **`"chain0"`** - Connect to Zynthian Chain 0 (first instrument)
- **`"all-chains"`** - Connect to all Zynthian chains
- **`"none"`** - No auto-connection; manually connect

## Zynthian Quick Start

1. **Install Sketchatone** on your Zynthian device

2. **Create config** with JACK backend:

```json
{
  "midi": {
    "midi_output_backend": "jack",
    "jack_client_name": "sketchatone",
    "jack_auto_connect": "chain0"
  },
  "strumming": {
    "midi_channel": 10,
    "chord": "Am"
  }
}
```

3. **Run Sketchatone:**

```bash
python -m sketchatone.cli.midi_strummer --jack
```

4. **Start playing!**

## Manual Connection (Non-Zynthian)

For generic JACK systems, use `"none"` and connect manually:

```json
{
  "midi": {
    "midi_output_backend": "jack",
    "jack_auto_connect": "none"
  }
}
```

Connect with:

```bash
jack_connect sketchatone:midi_out your_synth:midi_in
```

## Verification

```bash
# List all JACK clients
jack_lsp

# Check connections
jack_lsp -c
```

## Comparison: JACK vs rtmidi

| Feature | rtmidi | JACK |
|---------|--------|------|
| Setup | Simple | Requires JACK server |
| Zynthian Integration | Limited | Full integration |
| Latency | Low | Very low |
| macOS/Windows | Native | Requires JACK install |

## See Also

- **[Python CLI](/about/python-cli/)** - Python CLI reference
- **[Builds & Installers](/about/builds/)** - Linux/Zynthian setup
