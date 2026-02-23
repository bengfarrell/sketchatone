---
title: Getting Started
description: Install and run Sketchatone for the first time
---

# Getting Started

This guide will help you get Sketchatone running with your graphics tablet.

## Prerequisites

- A graphics tablet (Wacom, XP-Pen, Huion, etc.)
- A MIDI-capable application (DAW, synthesizer, virtual instrument)

## Installation

Choose the installer for your platform:

### macOS

**[Download from GitHub Releases](https://github.com/bengfarrell/sketchatone/releases/latest)**

Download `Sketchatone-macOS.zip`, unzip, drag to Applications, and run.

See **[macOS Installation Guide](/about/builds/#macos)** for details.

### Raspberry Pi / Zynthian

**[Download from GitHub Releases](https://github.com/bengfarrell/sketchatone/releases/latest)**

Download `sketchatone-debian-installer.tar.gz` for simple installation with automatic USB auto-start configuration.

**Quick install:**
```bash
# Download and extract
tar xzf sketchatone-debian-installer.tar.gz

# Run installer
sudo ./install-sketchatone.sh
```

See **[Raspberry Pi Installation Guide](/about/builds/#linux-raspberry-pi-zynthian)** for details.

### Windows

**Coming soon** - Windows installer in development

### From Source

For developers or other platforms, see **[Building from Source](/about/builds/)**.

## Quick Start

### 1. Connect Your Tablet

Plug in your graphics tablet. Sketchatone will auto-detect supported tablets based on USB vendor/product IDs.

**Supported tablets include:**
- Wacom (Intuos, Cintiq, etc.)
- XP-Pen (Deco, Artist, etc.)
- Huion (Inspiroy, Kamvas, etc.)
- And many others

If your tablet isn't recognized, you may need to create a device configuration file. See **[Configuration](/about/configuration-settings/)**.

### 2. Set Up MIDI Output

Make sure you have a MIDI destination ready:

- **macOS**: Enable IAC Driver in Audio MIDI Setup (built-in virtual MIDI)
- **Windows**: Install loopMIDI or use a DAW
- **Linux/Raspberry Pi**: Connect a USB MIDI device or use ALSA virtual ports
- **Zynthian**: JACK MIDI is configured automatically

### 3. Start Sketchatone

**macOS:** Launch the Sketchatone app - the dashboard opens automatically in your browser

**Raspberry Pi/Zynthian:** Plug in your tablet (auto-starts by default, no dashboard)

**From source:**
```bash
# With dashboard (recommended for configuration)
npm run server
# or
python -m sketchatone.cli.server

# Without dashboard (MIDI only)
npm run midi-strummer
# or
python -m sketchatone.cli.midi_strummer
```

### 4. Configure with the Dashboard

**macOS/Development:** The web dashboard opens automatically at `http://localhost:8080`

The dashboard lets you:
- ✅ **Configure settings visually** - No JSON editing required
- ✅ **See live tablet input** - Watch pressure, tilt, and position in real-time
- ✅ **Adjust parameters instantly** - Changes apply immediately without restart
- ✅ **Load/save presets** - Switch between configurations for different songs

See **[Web Dashboard](/about/dashboard/)** for complete documentation.

**Raspberry Pi/Zynthian:** Dashboard is typically disabled for performance. Configure via JSON files (see **[Configuration](/about/configuration-settings/)**).

### 5. Start Strumming!

Draw across your tablet surface to strum notes. By default, you'll hear a C major chord (C, E, G).

**Try adjusting settings in the dashboard:**
- Change the chord
- Adjust pressure sensitivity
- Enable pitch bend with pen tilt
- Map stylus buttons to transpose or note repeater

### 6. Optional: Configure MIDI Input

If you want to use an external MIDI keyboard to change the notes being strummed, see **[Post-Installation Configuration](/about/troubleshooting/#post-installation-configuration)**.

## What's Next?

### Learn the Basics

- **[Strumming](/about/strumming/)** - How strumming works
- **[Pitch Bend](/about/pitch-bend/)** - Control pitch with pen tilt
- **[Note Velocity](/about/note-velocity/)** - Control volume with pressure
- **[Chords and Progressions](/about/chords-and-progressions/)** - Play different chords

### Customize Your Setup

- **[Configuration](/about/configuration-settings/)** - Understanding config files and settings
- **[Action Rules](/about/action-rules/)** - Configure stylus and tablet button actions

### Troubleshooting

- **[Troubleshooting Guide](/about/troubleshooting/)** - Common issues and solutions
- **[JACK MIDI](/about/jack-midi/)** - Zynthian-specific configuration

### Advanced

- **[Node.js CLI](/about/node-cli/)** - Command-line reference (Node.js)
- **[Python CLI](/about/python-cli/)** - Command-line reference (Python)
- **[Action Rules](/about/action-rules/)** - Button action system
