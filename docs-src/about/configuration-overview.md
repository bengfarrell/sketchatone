---
title: Configuration Overview
description: Understanding Sketchatone's configuration files
---

# Configuration Overview

Sketchatone uses two types of configuration files:

## 1. Tablet Configuration

Defines how to read HID data from your graphics tablet. These files are typically provided in `public/configs/` and matched automatically based on USB vendor/product IDs.

**Example:** `xp-pen-deco-640.json`

```json
{
  "name": "XP Pen Deco 640",
  "vendorId": "0x28bd",
  "productId": "0x2904",
  "capabilities": {
    "hasPressure": true,
    "pressureLevels": 16384,
    "hasTilt": true
  },
  "byteCodeMappings": { ... }
}
```

## 2. Strummer Configuration

Defines musical settings, parameter mappings, and MIDI backend options.

**Example:** `strummer-config.json`

```json
{
  "strumming": {
    "chord": "Am",
    "midi_channel": 0
  },
  "note_velocity": {
    "control": "pressure",
    "min": 0,
    "max": 127
  },
  "midi": {
    "midi_output_backend": "rtmidi",
    "midi_output_id": 2
  }
}
```

## Configuration Sections

| Section | Purpose |
|---------|---------|
| `strumming` | Core strummer settings (chord, notes, channel) |
| `note_velocity` | Velocity parameter mapping |
| `note_duration` | Duration parameter mapping |
| `pitch_bend` | Pitch bend parameter mapping |
| `note_repeater` | Tremolo/repeat settings |
| `transpose` | Transpose settings |
| `stylus_buttons` | Pen button actions |
| `strum_release` | Release trigger settings |
| `tablet_buttons` | Chord progression mapping |
| `midi` | MIDI backend settings |
| `server` | Server settings |

## See Also

- **[Settings File](/about/configuration-settings/)** - Complete settings reference
- **[Strumming](/about/strumming/)** - Strummer configuration
- **[Actions Reference](/about/actions-reference/)** - Button action reference
