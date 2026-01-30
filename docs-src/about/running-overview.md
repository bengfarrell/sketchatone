---
title: Running Overview
description: Different ways to run Sketchatone
---

# Running the Application

Sketchatone can be run in several ways depending on your needs.

## CLI Tools

Both Node.js and Python implementations provide command-line tools:

| Tool | Purpose |
|------|---------|
| `midi-strummer` | Main tool - converts tablet input to MIDI |
| `strum-events` | Debug tool - view strum events without MIDI |
| `server` | WebSocket/HTTP server for web clients |

## Quick Reference

### Node.js

```bash
# Main strummer
npm run midi-strummer

# With config file
npm run midi-strummer -- -s config.json

# Debug mode
npm run strum-events

# Server mode
npm run server
```

### Python

```bash
# Main strummer
python -m sketchatone.cli.midi_strummer

# With config file
python -m sketchatone.cli.midi_strummer -s config.json

# Debug mode
python -m sketchatone.cli.strum_event_viewer

# Server mode
python -m sketchatone.cli.server
```

## Auto-Detection

When no tablet config is specified, Sketchatone automatically searches for a matching config file in `public/configs/` based on connected USB devices.

## See Also

- **[Node.js CLI](/about/node-cli/)** - Full Node.js CLI reference
- **[Python CLI](/about/python-cli/)** - Full Python CLI reference
- **[Builds & Installers](/about/builds/)** - Pre-built packages
