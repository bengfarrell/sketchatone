---
title: Changelog
description: Release notes and version history
---

# Changelog

## v0.3.0

### Installation
- **Dropped choice of MIDI backend from install**: Given there was only one option needed to support Zynthian (the Jack backend), remove the installation choice

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

- **HTTPS server**: Added HTTPS support alongside HTTP for Android 10+ captive portal compatibility (both Python and Node.js)
- **Self-signed certificates**: Automatic generation and storage of SSL certificates in `~/.sketchatone/ssl/` or `/opt/sketchatone/ssl/`
- **Captive portal detection endpoint**: `/generate_204` endpoint responds to Android connectivity checks
- **Secure WebSocket (WSS)**: WSS (WebSocket Secure) support on separate port for encrypted connections (both Python and Node.js)
- **Configuration**: New `https_port` and `wss_port` settings in server config

### Development Mode

- **Tablet-optional operation**: Run server without physical tablet connected using `--dev-mode` flag
- **Testing without hardware**: Test button actions, MIDI output, and keyboard input without tablet
- **Graceful degradation**: Server handles missing tablet device and continues running other features

### MIDI Improvements

- **MIDI Octave Standardization** (Critical Fix): Fixed critical MIDI octave calculation bug affecting all note output
  - **C4 = MIDI note 60** is now the immutable standard across the entire codebase (matching General MIDI specification)
  - Fixed Python implementation where C4 was incorrectly mapped to MIDI note 48 (one octave too low)
  - Fixed TypeScript implementation where middle C calculation was inconsistent
  - All chords, scales, and note calculations now use the correct octave mapping
  - Added comprehensive unit tests (643 tests total) to prevent future regressions
  - **Impact**: All MIDI output is now one octave higher than in previous versions. Users may need to adjust their configurations
- **Expanded MIDI Test Coverage**: Comprehensive test suite for MIDI configuration and channel routing
  - 24 unit tests per language (100% parity between TypeScript and Python)
  - Configuration option tests: channel assignment, dynamic channel switching, inter-message delay, device monitoring
  - Channel routing edge case tests: rapid channel switching, per-channel active note tracking, multi-channel scheduled notes
  - Mock backends updated to accept all `MidiBackendOptions` for consistent testing
- **MIDI Passthrough**: Forward MIDI messages from input devices directly to output devices in real-time, allowing a MIDI keyboard to control both Sketchatone and external devices (e.g., MPC One+) simultaneously
  - Full parity between Python and Node.js implementations
  - Supports both RtMidi and JACK backends (Python only has JACK)
  - Minimal latency - messages forwarded before note processing
  - Configure via UI toggle for each input device when output is connected
  - Hot-swapping support - automatically re-registers on device changes
- **ALSA Client Leak Fix** (Python): Fixed critical ALSA sequencer client leak in RtMidi backend that caused MIDI failure after ~100 port queries on Raspberry Pi
  - Added explicit cleanup with `try/finally` blocks and `.delete()` calls
  - Prevents "Cannot create RtMidi input object" errors during long-running sessions
- **Multiple input ports**: Support for connecting to multiple MIDI input ports simultaneously (array of port IDs)
- **Explicit input disable**: Empty array explicitly disables all MIDI inputs
- **Enhanced JACK support** (Python): Improved JACK MIDI input implementation
- **Better port exclusion**: Improved logic for excluding internal ports to prevent feedback loops

### Server Management

- **Service restart support**: New "Restart Service" button in Server Settings panel to restart systemd service from UI
- **Server settings panel**: New dashboard panel for configuring MIDI backend and HTTP/HTTPS/WS/WSS ports
- **Runtime backend switching**: Change MIDI backend (ALSA/JACK) through UI (requires service restart)
- **Configuration UI**: All server-level settings now accessible through the dashboard

### Improved Shutdown

- **Better cleanup**: More reliable resource cleanup on shutdown in both Python and Node.js
- **Proper server termination**: HTTP, HTTPS, WebSocket, and WSS servers all shut down gracefully with timeouts
- **No hanging shutdowns**: Added 2-second timeouts to all server close operations to prevent process hangs
- **MIDI port cleanup**: Proper closing of MIDI connections
- **Keyboard listener cleanup**: Keyboard input handlers are properly removed on shutdown

### Configuration Changes

- **New `keyboard` section**: Optional configuration for keyboard input mappings
- **New `https_port` setting**: HTTPS server port for captive portal support (default: 443)
- **New `wss_port` setting**: Secure WebSocket port (default: 8082)
- **Allow new system config**: Add a service restart button which works for systemctl as we add UI config for HTTP(s) and web socket ports as well as MIDI backend (restart for these to take effect after saving)
- **Removed sample configs**: Consolidated to single `public/configs/default.json` with all settings

### Breaking Changes

- **Chord progressions required in config**: Old configs without `chordProgressions` section will have no progressions available. Users must add chord progressions to their config files (see `public/configs/default.json` for examples)
- **Removed sample config files**: Users should use `public/configs/default.json` as a template
- **Removed choice of MIDI backend from install**: Given there was only one option needed to support Zynthian (the Jack backend), remove the installation choice and allow it to be configurable in UI (or JSON as always)


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
