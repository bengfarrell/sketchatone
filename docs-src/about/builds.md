---
title: Builds & Installers
description: Pre-built packages and installers for different platforms
---

# Builds & Installers

Pre-built packages are available for various platforms.

## macOS

*Coming soon* - Standalone application bundle

## Windows

*Coming soon* - Windows installer

## Linux / Zynthian

For Linux systems, especially Zynthian, we recommend running from source with the Python implementation:

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone/python

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install the package
pip install -e .

# For JACK MIDI support
pip install JACK-Client
```

### Zynthian Setup

Zynthian users should use the JACK MIDI backend for best integration:

```bash
python -m sketchatone.cli.midi_strummer --jack
```

See **[JACK MIDI](/about/jack-midi/)** for detailed Zynthian configuration.

## Running from Source

Both implementations can be run directly from source:

### Node.js

```bash
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone
npm install
npm run build:cli
npm run midi-strummer
```

### Python

```bash
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone/python
python -m venv venv
source venv/bin/activate
pip install -e .
python -m sketchatone.cli.midi_strummer
```
