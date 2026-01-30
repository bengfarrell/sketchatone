---
title: Introduction
description: Transform your graphics tablet into an expressive MIDI strumming controller
---

# Sketchatone

**Sketchatone** turns your graphics tablet into a MIDI strumming controller. Draw across the tablet surface to strum chords, with pressure, tilt, and position controlling velocity, pitch bend, and note duration.

## What is Sketchatone?

Sketchatone reads raw HID data from your graphics tablet and converts your pen movements into MIDI events. It's designed for musicians who want an expressive, tactile way to trigger and control notes.

### Key Features

- **Strum chords** by drawing across the tablet surface
- **Pressure-sensitive velocity** - press harder for louder notes
- **Tilt-controlled parameters** - angle your pen to control pitch bend or note duration
- **Note repeater** - create tremolo effects with pressure-controlled speed
- **Chord progressions** - map tablet buttons to different chords
- **Stylus button actions** - toggle transpose, repeater, and more
- **Hot-plug support** - connect/disconnect your tablet without restarting

## Architecture

Sketchatone is built on top of [**blankslate**](https://github.com/bengfarrell/blankslate), a universal HID tablet configuration toolkit. Blankslate handles:

- HID device detection and reading
- Hot-plug detection
- Byte-to-value mapping
- Device auto-detection from config files

Sketchatone adds the musical layer:

- Strummer logic (converting position to note triggers)
- MIDI output (rtmidi and JACK backends)
- Parameter mappings (pressure → velocity, tilt → pitch bend, etc.)
- Note repeater and transpose features

## Implementations

Sketchatone is available in two implementations:

| Implementation | Best For |
|----------------|----------|
| **Node.js/TypeScript** | macOS, Windows, web integration |
| **Python** | Linux, Zynthian, JACK MIDI |

Both implementations share the same configuration format and feature set, with Python additionally supporting JACK MIDI for professional Linux audio systems.

## Getting Started

Ready to turn your tablet into a musical instrument?

1. **[Getting Started](/about/getting-started/)** - Installation and first run
2. **[Configuration Overview](/about/configuration-overview/)** - Understanding config files
3. **[Strumming](/about/strumming/)** - How strumming works

## Requirements

- A graphics tablet with HID support (Wacom, XP-Pen, Huion, etc.)
- Node.js 18+ (for TypeScript version) or Python 3.10+ (for Python version)
- A MIDI-capable application (DAW, synthesizer, etc.)
