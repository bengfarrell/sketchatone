---
title: Settings File
description: Complete reference for all configuration options
---

# Configuration Settings Reference

This document describes all JSON configuration options for Sketchatone.

## Parameter Mappings

Parameter mappings control how tablet inputs (pressure, tilt, position) map to musical parameters.

### Common Structure

All parameter mappings (`note_duration`, `pitch_bend`, `note_velocity`) share this structure:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `min` | number | 0.0 | Minimum output value |
| `max` | number | 1.0 | Maximum output value |
| `multiplier` | number | 1.0 | Scale factor applied to output |
| `curve` | number | 1.0 | Response curve (1.0=linear, >1=exponential) |
| `spread` | string | "direct" | How input maps to output range |
| `control` | string | "none" | Input source |
| `default` | number | 0.5 | Value when control is "none" |

### Control Sources

| Value | Description |
|-------|-------------|
| `"pressure"` | Pen pressure (0-1) |
| `"tiltX"` | Pen tilt X axis |
| `"tiltY"` | Pen tilt Y axis |
| `"tiltXY"` | Combined tilt magnitude |
| `"xaxis"` | X position (normalized 0-1) |
| `"yaxis"` | Y position (normalized 0-1) |
| `"velocity"` | Movement velocity |
| `"none"` | No control (use default value) |

### Spread Types

| Value | Description |
|-------|-------------|
| `"direct"` | Linear: 0→min, 1→max |
| `"inverse"` | Inverse: 0→max, 1→min |
| `"central"` | Central: 0.5→center, edges→min/max |
| `"none"` | No spread, use default |

---

## strumming

Core strumming configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pluck_velocity_scale` | number | 4.0 | Scale factor for pluck velocity |
| `pressure_threshold` | number | 0.1 | Minimum pressure to trigger strum |
| `midi_channel` | number\|null | null | MIDI channel (0-15), null for omni |
| `initial_notes` | string[] | ["C4","E4","G4"] | List of note strings |
| `chord` | string\|null | null | Chord notation (e.g., "Am", "Gmaj7") |
| `upper_note_spread` | number | 3 | Notes to add above chord |
| `lower_note_spread` | number | 3 | Notes to add below chord |

---

## midi

MIDI backend configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `midi_output_backend` | string | "rtmidi" | Backend: "rtmidi" or "jack" |
| `midi_output_id` | number\|string\|null | null | Output port (index or name) |
| `midi_input_id` | number\|string\|null | null | Input port (index or name) |
| `jack_client_name` | string | "sketchatone" | JACK client name |
| `jack_auto_connect` | string\|null | "chain0" | JACK auto-connect target |
| `note_duration` | number | 1.5 | Default note duration (seconds) |

---

## server

Server configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `http_port` | number\|null | null | HTTP server port (null = disabled) |
| `ws_port` | number\|null | null | WebSocket server port (null = disabled) |
| `ws_message_throttle` | number | 150 | WebSocket throttle interval (ms) |
| `device_finding_poll_interval` | number\|null | null | Device poll interval (ms) |
