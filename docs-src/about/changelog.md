---
title: Changelog
description: Release notes and version history
---

# Changelog

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

### Bug Fixes

- **MIDI channel off-by-one**: Standardized MIDI channels to be 0-indexed internally and 1-indexed in user-facing config files and UI.
- **XP Deco button handling**: Fixed button handling in Blankslate for the XP Deco tablet.
- **Removed button names feature**: Removed custom button naming from action rules configuration. Button labels now use system defaults.
