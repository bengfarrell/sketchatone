---
title: Configuration
description: Understanding Sketchatone's configuration files and settings
---

# Configuration

This document describes Sketchatone's configuration system and all available settings.

## MIDI Channel Indexing

**Important:** MIDI channels use the standard **1-16** numbering (matching MIDI hardware) in all user-facing interfaces:

- **CLI arguments** (e.g., `--channel`): Use **1-16**
- **Configuration files** (JSON): Use **1-16**
- **CLI display output**: Shows **1-16**

Example: To use MIDI channel 1, specify `--channel 1` in CLI, or set `"midi_channel": 1` in config files.

*Note: Internally, the code uses 0-15 (MIDI protocol), but this conversion is handled automatically.*

## Configuration Methods

Sketchatone can be configured via the **[Web Dashboard](/about/dashboard/)** (live, visual interface) or **JSON configuration files** (version-controlled, headless). Changes made in the dashboard apply immediately, while JSON file changes require a restart.

---

## Configuration Files

Sketchatone uses two types of configuration files:

### 1. Tablet Configuration

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

### 2. Strummer Configuration

Defines musical settings, parameter mappings, and MIDI backend options.

**Example:** `strummer-config.json`

```json
{
  "strumming": {
    "chord": "Am",
    "midi_channel": 1
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

## Configuration Presets

You can create multiple JSON configuration files for different use cases and switch between them:

### Use Cases for Multiple Configurations

**Song-Specific Settings:**
```
configs/
  ballad.json       # Slow, expressive, wide pitch bend
  rock.json         # Fast, aggressive, minimal bend
  jazz.json         # Complex chords, note repeater
  drums.json        # Strum release for percussive hits
```

**Instrument-Specific Settings:**
```
configs/
  piano.json        # Velocity-sensitive, no pitch bend
  strings.json      # Pitch bend on Y-axis, legato
  synth-lead.json   # Aggressive bend, short notes
```

### Switching Configurations

**Via Dashboard:**
1. Click "Load Configuration"
2. Select JSON file
3. Settings apply immediately

**Via Command Line:**
```bash
# Node.js
npm run server -- -s configs/ballad.json

# Python
python -m sketchatone.cli.server -s configs/ballad.json
```

**Via File System (Raspberry Pi):**
```bash
# Copy preset to active config location
cp /opt/sketchatone/configs/presets/rock.json /opt/sketchatone/configs/config.json
sudo systemctl restart sketchatone
```

### Creating Presets

1. **Configure in dashboard** - Adjust all settings visually
2. **Export configuration** - Click "Export Configuration" button
3. **Save with descriptive name** - e.g., `my-song-verse.json`
4. **Version control** - Commit to git for tracking changes

---

## Configuration Sections

| Section | Purpose |
|---------|---------|
| `strumming` | Core strummer settings (chord, notes, channel) |
| `note_velocity` | Velocity parameter mapping |
| `note_duration` | Duration parameter mapping |
| `pitch_bend` | Pitch bend parameter mapping |
| `strum_release` | Release trigger settings (drum sounds on pen lift) |
| `action_rules` | Button-to-action mappings (stylus & tablet buttons) |
| `chordProgressions` | Chord progressions (required for progression actions) |
| `keyboard` | Keyboard input mappings (optional) |
| `midi` | MIDI backend settings (ports, backend selection, JACK config) |
| `server` | Server settings (HTTP/HTTPS/WS/WSS ports) |

---

# Configuration Settings Reference

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
| `pressure_threshold` | number | 0.1 | Minimum pressure to trigger strum |
| `pressure_buffer_size` | number | 10 | Number of pressure samples to buffer before triggering the initial note (see below) |
| `midi_channel` | number\|null | null | MIDI channel (1-16), null for channel 1 (default) |
| `initial_notes` | string[] | ["C4","E4","G4"] | List of note strings |
| `chord` | string\|null | null | Chord notation (e.g., "Am", "Gmaj7") |
| `upper_note_spread` | number | 3 | Notes to add above chord |
| `lower_note_spread` | number | 3 | Notes to add below chord |
| `invert_x` | boolean | false | Invert X axis for left-handed use |

### Pressure Buffer Size

The `pressure_buffer_size` setting controls how many pressure samples are collected before the first note of a strum fires. The velocity of that note is based on the **peak pressure** seen during the buffer window.

A larger buffer gives the pressure sensor more time to register the full force of a pen strike, resulting in more accurate and louder velocity on taps and initial strum contact. However, it also introduces a small amount of latency before the first note sounds (each sample is roughly 10ms at typical tablet report rates).

If the pen is lifted before the buffer fills (a quick tap), the note fires immediately on release using the peak pressure from whatever samples were collected. This means quick taps are never silently dropped regardless of buffer size.

| Buffer Size | Approx. Latency | Best For |
|-------------|-----------------|----------|
| 2-5 | ~20-50ms | Minimal latency, lower initial velocity |
| 10 (default) | ~100ms | Good balance of responsiveness and velocity |
| 15-40 | ~150-400ms | Maximum velocity accuracy, noticeable latency |

---

## strum_release

Strum release feature - triggers a MIDI note when pen is lifted.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Whether strum release is enabled |
| `midi_note` | number | 38 | MIDI note to send on release (38 = snare) |
| `midi_channel` | number\|null | null | MIDI channel (null = same as strumming) |
| `max_duration` | number | 0.25 | Maximum duration of release note (seconds) |
| `velocity_multiplier` | number | 1.0 | Scale factor for release velocity |

**Use case:** Trigger drum sounds (e.g., snare) when lifting the pen after a strum.

---

## action_rules

Button-to-action mapping configuration. Maps tablet buttons and stylus buttons to actions.

### Structure

| Property | Type | Description |
|----------|------|-------------|
| `button_names` | object | Human-readable names for buttons |
| `rules` | array | Individual button-to-action mappings |
| `groups` | array | Button groups (collections of buttons) |
| `group_rules` | array | Actions assigned to button groups |
| `startup_rules` | array | Actions that execute on startup |

### Button IDs

| Button ID | Description |
|-----------|-------------|
| `button:primary` | Primary stylus button |
| `button:secondary` | Secondary stylus button |
| `button:1` through `button:N` | Tablet hardware buttons |

### Action Rule Format

```json
{
  "id": "unique-id",
  "name": "Human Readable Name",
  "button": "button:primary",
  "action": "toggle-transpose",
  "trigger": "press"
}
```

### Available Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `toggle-transpose` | Toggle transpose on/off | `semitones` (number, default: 12) |
| `toggle-repeater` | Toggle note repeater on/off | `pressureMultiplier` (number), `frequencyMultiplier` (number) |
| `transpose` | Transpose notes | `semitones` (number) |
| `set-chord` | Set chord | Chord notation string |
| `set-strum-notes` | Set specific notes | Array of note strings |
| `chord-progression` | Cycle through chord progression | Progression name, octave |

**Note:** Transpose and repeater state is managed entirely by the Actions system. The `note_repeater` and `transpose` config sections that may appear in older config files are **ignored** by the CLI/server. Use `action_rules` to configure these features instead.

### Group Rule Format

Used for chord progressions mapped to multiple buttons:

```json
{
  "id": "chord-progression-rule",
  "name": "C Major Pop Progression",
  "group_id": "chord-buttons",
  "trigger": "press",
  "action": {
    "type": "chord-progression",
    "progression": "c-major-pop",
    "octave": 4
  }
}
```

See **[Action Rules](/about/action-rules/)** for complete action documentation.

---

## chordProgressions

Define chord progressions that can be used in action rules. **Required** if using chord progression actions.

Starting in v0.3.0, chord progressions are no longer hardcoded. All progressions must be defined in the configuration file. The `public/configs/default.json` includes standard progressions (pop, jazz, blues, gospel, etc.) that you can copy or customize.

### Format

```json
{
  "chordProgressions": {
    "progression-name": ["Chord1", "Chord2", "Chord3", ...],
    "another-progression": ["Am", "F", "C", "G"]
  }
}
```

### Example

```json
{
  "chordProgressions": {
    "my-song-verse": ["Am", "F", "C", "G"],
    "my-song-chorus": ["C", "G", "Am", "F"],
    "my-jazz-tune": ["Cmaj7", "Am7", "Dm7", "G7"],
    "c-major-pop": ["C", "G", "Am", "F"],
    "blues-e": ["E7", "A7", "B7"]
  }
}
```

### Usage

Reference custom progressions by name in action rules:

```json
{
  "action_rules": {
    "group_rules": [
      {
        "id": "verse-progression",
        "name": "Verse",
        "group_id": "chord-buttons",
        "trigger": "press",
        "action": {
          "type": "chord-progression",
          "progression": "my-song-verse",
          "octave": 4
        }
      }
    ]
  }
}
```

**Notes:**
- Progression names can be any string
- Each progression is an array of chord notation strings
- See **[Chords & Progressions](/about/chords-and-progressions/)** for supported chord notation
- If no progressions are defined and you use chord progression actions, those actions will fail
- The default config file (`public/configs/default.json`) includes standard progressions you can use as a reference

---

## keyboard

Keyboard input configuration for testing without physical tablet hardware. Maps computer keyboard keys to tablet button actions.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | boolean | false | Whether keyboard input is enabled |
| `mappings` | object | {} | Key-to-button mappings |

### Keyboard Mappings Format

The `mappings` object maps keyboard keys to button IDs:

```json
{
  "keyboard": {
    "enabled": true,
    "mappings": {
      "1": "button:1",
      "2": "button:2",
      "3": "button:3",
      "4": "button:4",
      "q": "button:primary",
      "w": "button:secondary"
    }
  }
}
```

### Key Names

- **Alphanumeric**: `"a"` through `"z"`, `"0"` through `"9"`
- **Function Keys**: `"f1"` through `"f12"` (lowercase)
- **Special Keys**: `"space"`, `"enter"`, `"tab"`, `"escape"`, etc.

### Button IDs

- `"button:primary"` - Primary stylus button
- `"button:secondary"` - Secondary stylus button
- `"button:1"` through `"button:N"` - Tablet hardware buttons

### Platform Notes

- **macOS**: Requires Accessibility permissions or sudo
- **Linux**: Requires root or input group membership
- **Windows**: Should work without special permissions

### Use Cases

- **Testing without tablet**: Develop and test action rules without physical hardware
- **Hardware-free demos**: Show Sketchatone functionality without tablet
- **Development mode**: Combined with `--dev-mode` flag to run entirely without tablet

**Example:**
```json
{
  "keyboard": {
    "enabled": true,
    "mappings": {
      "1": "button:1",
      "2": "button:2",
      "3": "button:3",
      "4": "button:4"
    }
  },
  "action_rules": {
    "groups": [
      {
        "id": "chord-buttons",
        "buttons": ["button:1", "button:2", "button:3", "button:4"]
      }
    ],
    "group_rules": [
      {
        "id": "chord-progression",
        "group_id": "chord-buttons",
        "action": {
          "type": "chord-progression",
          "progression": "a-minor-pop",
          "octave": 4
        }
      }
    ]
  }
}
```

With this configuration, pressing keys `1`, `2`, `3`, or `4` on your computer keyboard will trigger the chord progression action as if you pressed the physical tablet buttons.

---

## midi

MIDI backend configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `midi_output_backend` | string | "rtmidi" | Backend: "rtmidi" (ALSA) or "jack" |
| `midi_output_id` | number\|string\|null | null | Output port (index or name) |
| `midi_input_id` | number\|string\|array\|null | null | Input port (index, name, or array of ports) |
| `midi_input_exclude` | string[] | [...] | Port name patterns to exclude from input |
| `jack_client_name` | string | "sketchatone" | JACK client name |
| `jack_auto_connect` | string\|null | "chain0" | JACK auto-connect target |
| `default_note_duration` | number | 1.5 | Default note duration (seconds) |
| `midi_inter_message_delay` | number | 0 | Delay between MIDI messages (seconds) |

### midi_output_backend

Selects which MIDI system to use:

- **`"rtmidi"`** (default): Uses ALSA on Linux, CoreMIDI on macOS, Windows MIDI on Windows. Best for general use.
- **`"jack"`**: Uses JACK Audio Connection Kit. Required for Zynthian and other JACK-based systems. Only available in Python server.

**Note:** The Node.js server only supports `"rtmidi"`. If using JACK, you must use the Python server.

### midi_output_id and midi_input_id

MIDI port selection supports multiple formats:

- **`null`** (default): Auto-select first available port for output; auto-connect all ports for input
- **Port index** (number): `0`, `1`, `2`, etc.
- **Port name** (string): Full or partial port name, e.g., `"USB MIDI"`, `"IAC Driver"`
- **Array of ports** (input only): `[0, 2]` or `["Keyboard 1", "Keyboard 2"]` to connect multiple input devices
- **Empty array** (input only): `[]` explicitly disables MIDI input

### jack_client_name

Name used when registering with JACK Audio Connection Kit. Default is `"sketchatone"`.

**Example:**
```json
"midi": {
  "midi_output_backend": "jack",
  "jack_client_name": "my-strummer"
}
```

### jack_auto_connect

JACK auto-connect mode determines how Sketchatone connects to other JACK clients:

- **`"chain0"`** (default): Auto-connect to first available MIDI device in JACK graph
- **`null`**: Disable auto-connect (manually connect via JACK patchbay)
- **Port name**: Connect to specific JACK port, e.g., `"ZynMidiRouter:midi_in"`

**Note:** Only used when `midi_output_backend` is `"jack"`.

### MIDI Device Detection

After connecting or disconnecting a MIDI device:

- **Via Dashboard:** Click the "Refresh Devices" button to update the device list
- **Via CLI:** Restart the server to detect new devices

### midi_inter_message_delay

Adds a delay (in seconds) between consecutive MIDI messages to prevent buffer overflow on some hardware synthesizers during rapid strumming.

**When to use:**
- Set to `0.002` (2ms) if notes stick or sustain indefinitely during busy strumming on Raspberry Pi with direct USB connections
- Set to `0.02` (20ms) for particularly slow hardware synths
- Particularly useful with direct USB MIDI connections to hardware synths with slow CPUs (e.g., Roland Juno DS on Raspberry Pi)
- Works with both RtMidi (ALSA) and JACK backends

**Example:**
```json
"midi": {
  "midi_inter_message_delay": 0.002
}
```

**Note:** This adds latency to MIDI output. Only use if experiencing stuck notes.

---

## server

Server configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `device` | string | "devices" | Device config directory path |
| `http_port` | number\|null | null | HTTP server port (null = disabled) |
| `https_port` | number\|null | null | HTTPS server port (null = disabled) |
| `ws_port` | number\|null | null | WebSocket server port (null = disabled) |
| `wss_port` | number\|null | null | Secure WebSocket port (null = disabled) |
| `ws_message_throttle` | number | 150 | WebSocket throttle interval (ms) |
| `device_finding_poll_interval` | number\|null | null | Device poll interval (ms) |

### HTTPS and WSS Support

HTTPS and secure WebSocket (WSS) support is provided for **Android 10+ captive portal detection**. When a device connects to a WiFi hotspot, Android checks for internet connectivity by requesting specific endpoints. Sketchatone responds to these requests to prevent the device from switching to mobile data.

**HTTPS Configuration:**
```json
{
  "server": {
    "http_port": 3000,
    "https_port": 443,
    "ws_port": 8081,
    "wss_port": 8082
  }
}
```

**SSL Certificates:**
- Self-signed certificates are automatically generated on first run
- Stored in `~/.sketchatone/ssl/` (user install) or `/opt/sketchatone/ssl/` (system install)
- Valid for 10 years
- Browser warnings are expected (self-signed)

**Captive Portal Endpoints:**
The server responds to the following endpoints with `204 No Content`:
- `/generate_204` (Android)
- `/gen_204` (Alternative Android)
- `/connecttest.txt` (Windows)
- `/success.txt` (iOS)

**Use Cases:**
- **Raspberry Pi WiFi Hotspot**: Enable HTTPS/WSS to prevent Android devices from using mobile data
- **Development**: Use HTTP/WS only (simpler, no certificate warnings)
- **Production Hotspot**: Use HTTPS/WSS for better Android compatibility

**Note:**
- Setting ports to `null` disables that server
- HTTPS requires port 443 or a custom port (certificate warnings on non-standard ports)
- WSS requires a separate port from WS (both can run simultaneously)
