---
title: Changelog
description: Release notes and version history
---

# Changelog

## v0.3.0

### Custom Chord Progressions

- **Visual chord progression creator** (Node.js/Dashboard): New UI component for creating and managing chord progressions with root note selection, accidentals, qualities, and extensions
- **Config-based progressions**: Both Node.js and Python now use configuration file for chord progressions instead of hardcoded presets
- **Removed hardcoded presets**: Chord progressions are now defined entirely in the config file (`chordProgressions` section), providing full flexibility for users
- **Default progressions included**: The default config file includes all standard progressions (pop, jazz, blues, gospel, etc.) previously hardcoded

### Keyboard Input Support

- **Computer keyboard as button controller**: Map computer keyboard keys to tablet button actions for testing and development without physical tablet hardware
- **Configurable key mappings**: Define keyboard-to-button mappings in config file (`keyboard.mappings` section)
- **Full parity**: Identical implementation in both Node.js and Python
- **Event simulation**: Keyboard events emit synthetic tablet events for full integration with action rules system

### HTTPS & Captive Portal Support

- **HTTPS server**: Added HTTPS support alongside HTTP for Android 10+ captive portal compatibility
- **Self-signed certificates**: Automatic generation and storage of SSL certificates in `~/.sketchatone/ssl/` or `/opt/sketchatone/ssl/`
- **Captive portal detection endpoint**: `/generate_204` endpoint responds to Android connectivity checks
- **Secure WebSocket**: WSS (WebSocket Secure) support on separate port
- **Configuration**: New `https_port` and `wss_port` settings in server config

### Development Mode

- **Tablet-optional operation**: Run server without physical tablet connected using `--dev-mode` flag
- **Testing without hardware**: Test button actions, MIDI output, and keyboard input without tablet
- **Graceful degradation**: Server handles missing tablet device and continues running other features

### MIDI Improvements

- **Multiple input ports**: Support for connecting to multiple MIDI input ports simultaneously (array of port IDs)
- **Explicit input disable**: Empty array explicitly disables all MIDI inputs
- **Enhanced JACK support** (Python): Improved JACK MIDI input implementation
- **Better port exclusion**: Improved logic for excluding internal ports to prevent feedback loops

### Improved Shutdown

- **Better cleanup**: More reliable resource cleanup on shutdown
- **Proper server termination**: HTTP, HTTPS, WebSocket, and WSS servers all shut down gracefully
- **MIDI port cleanup**: Proper closing of MIDI connections
- **Keyboard listener cleanup**: Keyboard input handlers are properly removed on shutdown

### Configuration Changes

- **New `keyboard` section**: Optional configuration for keyboard input mappings
- **New `https_port` setting**: HTTP server port for HTTPS support (default: 443)
- **New `wss_port` setting**: Secure WebSocket port (default: 8082)
- **Removed sample configs**: Consolidated to single `public/configs/default.json` with all settings

### Breaking Changes

- **Chord progressions required in config**: Old configs without `chordProgressions` section will have no progressions available. Users must add chord progressions to their config files (see `public/configs/default.json` for examples)
- **Removed sample config files**: Users should use `public/configs/default.json` as a template

---

## v0.2.0

### Strumming Improvements

- **Configurable pressure buffer size** (`pressure_buffer_size`): Controls how many pressure samples are collected before the initial note fires. A larger buffer gives the pressure sensor more time to register strike force, producing louder and more consistent velocity on taps and initial strum contact. Configurable via the dashboard UI or config file (default: 10, range: 2-40).
- **Peak pressure velocity**: The initial note velocity is now based on the highest pressure seen during the buffer window, rather than the last sample. This prevents velocity from dropping on quick hard taps where pressure peaks early then declines.
- **Tap-on-release**: If the pen is lifted before the pressure buffer fills (a quick tap), the note fires immediately on release using the peak pressure from whatever samples were collected. Quick taps are never silently dropped regardless of buffer size.
- **Fixed tiltXY calculation** (Python): The combined tilt value used for note duration control now uses the correct magnitude formula (`sqrt(tiltX² + tiltY²)`) matching the Node.js implementation, instead of a simple average that produced shorter durations.

### Shutdown Fixes

- **Graceful shutdown reliability**: Fixed an issue where the process would hang on Ctrl+C or `systemctl stop`. The signal handler no longer calls blocking cleanup from the signal context — instead it cancels asyncio tasks and lets the event loop's `finally` block handle cleanup in the correct order.
- **WebSocket shutdown timeout**: Added 2-second timeouts to WebSocket client close and server `wait_closed()` calls to prevent hanging when clients disconnect uncleanly.
- **Note scheduler shutdown**: The `NoteScheduler` thread (`daemon=False`) is now explicitly stopped during shutdown, preventing the process from blocking on exit.
- **systemd `TimeoutStopSec`**: Added `TimeoutStopSec=10` to both ALSA and Zynthian service files so systemd force-kills after 10 seconds instead of the default 90.

### MIDI Device Management

- **Removed automatic device monitoring**: Background MIDI port scanning has been replaced with manual refresh via the dashboard UI. This eliminates race conditions and reduces system complexity.
- **Manual device refresh**: New "Refresh Devices" button in the dashboard for updating the MIDI device list.
- **Removed "omni mode"**: Removed Omnimode, or sending notes on all MIDI channels. There was some weird behavior on Python that made the strum sound bad, and it's not clear we actually need this feature anyway. It'll be a future improvement if we do
### Bug Fixes

- **MIDI channel off-by-one**: Standardized MIDI channels to be 0-indexed internally and 1-indexed in user-facing config files and UI.
- **XP Deco button handling**: Fixed button handling in Blankslate for the XP Deco tablet.
- **Removed button names feature**: Removed custom button naming from action rules configuration. Button labels now use system defaults.
