---
title: Getting Started
description: Install and run Sketchatone for the first time
---

# Getting Started

This guide will help you get Sketchatone running with your graphics tablet.

## Prerequisites

- A graphics tablet (Wacom, XP-Pen, Huion, etc.)
- A MIDI-capable application (DAW, synthesizer, virtual instrument)

## Choose Your Implementation

### Node.js/TypeScript

Best for macOS and Windows users, or if you want web integration.

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone

# Install dependencies
npm install

# Build the CLI tools
npm run build:cli
```

### Python

Best for Linux users, Zynthian, or if you need JACK MIDI support.

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone/python

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install the package
pip install -e .
```

## Quick Start

### 1. Connect Your Tablet

Plug in your graphics tablet. Sketchatone will auto-detect supported tablets from the config files in `public/configs/`.

### 2. Set Up MIDI Output

Make sure you have a MIDI destination ready:
- **macOS**: Use IAC Driver (built-in virtual MIDI) or a DAW
- **Windows**: Use loopMIDI or a DAW
- **Linux**: Use JACK MIDI or ALSA

### 3. Run Sketchatone

**Node.js:**
```bash
npm run midi-strummer
```

**Python:**
```bash
python -m sketchatone.cli.midi_strummer
```

### 4. Start Strumming!

Draw across your tablet surface to strum notes. By default, you'll hear a C major chord (C, E, G).

## Next Steps

- **[Configuration Overview](/about/configuration-overview/)** - Customize your setup
- **[Strumming](/about/strumming/)** - Learn how strumming works
- **[Node.js CLI](/about/node-cli/)** or **[Python CLI](/about/python-cli/)** - Full CLI reference
