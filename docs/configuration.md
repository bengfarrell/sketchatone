# Configuration Reference

This document describes all JSON configuration options for Sketchatone.

## Overview

Sketchatone uses two main configuration files:

1. **Tablet Config** - Defines HID device settings for your graphics tablet
2. **Strummer Config** - Defines musical settings, parameter mappings, and MIDI backend options

---

## Tablet Configuration

The tablet config file defines how to interpret raw HID data from your graphics tablet.

### Example

```json
{
  "name": "XP Pen Deco 640",
  "manufacturer": "XP Pen",
  "model": "Deco 640",
  "vendorId": "0x28bd",
  "productId": "0x2904",
  "deviceInfo": {
    "vendor_id": 10429,
    "product_id": 10500,
    "usage_page": 65290,
    "usage": 1
  },
  "capabilities": {
    "hasButtons": true,
    "buttonCount": 8,
    "hasPressure": true,
    "pressureLevels": 16384,
    "hasTilt": true,
    "resolution": { "x": 31998, "y": 17998 }
  },
  "byteCodeMappings": { ... }
}
```

### Top-Level Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Display name for the tablet |
| `manufacturer` | string | Tablet manufacturer |
| `model` | string | Tablet model name |
| `vendorId` | string | USB vendor ID (hex string) |
| `productId` | string | USB product ID (hex string) |
| `deviceInfo` | object | HID device identification |
| `reportId` | number | HID report ID (usually 0) |
| `digitizerUsagePage` | number | HID usage page for digitizer |
| `stylusModeStatusByte` | number | Status byte indicating stylus mode |
| `capabilities` | object | Tablet capabilities |
| `byteCodeMappings` | object | Byte-to-value mappings |

### deviceInfo

| Property | Type | Description |
|----------|------|-------------|
| `vendor_id` | number | USB vendor ID (decimal) |
| `product_id` | number | USB product ID (decimal) |
| `product_string` | string | Product name string |
| `usage_page` | number | HID usage page |
| `usage` | number | HID usage |

### capabilities

| Property | Type | Description |
|----------|------|-------------|
| `hasButtons` | boolean | Whether tablet has buttons |
| `buttonCount` | number | Number of tablet buttons |
| `hasPressure` | boolean | Whether stylus has pressure sensitivity |
| `pressureLevels` | number | Number of pressure levels |
| `hasTilt` | boolean | Whether stylus has tilt detection |
| `resolution` | object | Tablet resolution `{ x, y }` |

### byteCodeMappings

Defines how to extract values from raw HID report bytes.

#### Mapping Types

**multi-byte-range** - Multi-byte value with range
```json
{
  "x": {
    "byteIndex": [2, 3],
    "max": 31998,
    "type": "multi-byte-range"
  }
}
```

**bipolar-range** - Signed value (e.g., tilt)
```json
{
  "tiltX": {
    "byteIndex": [8],
    "positiveMax": 60,
    "negativeMin": 196,
    "negativeMax": 255,
    "type": "bipolar-range"
  }
}
```

**code** - Discrete status codes
```json
{
  "status": {
    "byteIndex": [1],
    "type": "code",
    "values": {
      "160": { "state": "hover" },
      "161": { "state": "contact" }
    }
  }
}
```

---

## Strummer Configuration

The strummer config file defines musical settings and can optionally include MIDI backend settings.

### Full Example

```json
{
  "note_duration": { ... },
  "pitch_bend": { ... },
  "note_velocity": { ... },
  "strumming": { ... },
  "note_repeater": { ... },
  "transpose": { ... },
  "stylus_buttons": { ... },
  "strum_release": { ... },
  "tablet_buttons": { ... },
  "midi": { ... },
  "server": { ... }
}
```

---

### Parameter Mappings

Parameter mappings control how tablet inputs (pressure, tilt, position) map to musical parameters.

#### Common Structure

All parameter mappings (`note_duration`, `pitch_bend`, `note_velocity`) share this structure:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `min` | number | 0.0 | Minimum output value |
| `max` | number | 1.0 | Maximum output value |
| `multiplier` | number | 1.0 | Scale factor applied to output |
| `curve` | number | 1.0 | Response curve (1.0=linear, >1=exponential, <1=logarithmic) |
| `spread` | string | "direct" | How input maps to output range |
| `control` | string | "none" | Input source |
| `default` | number | 0.5 | Value when control is "none" |

#### Control Sources

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

#### Spread Types

| Value | Description |
|-------|-------------|
| `"direct"` | Linear: 0→min, 1→max |
| `"inverse"` | Inverse: 0→max, 1→min |
| `"central"` | Central: 0.5→center, edges→min/max |
| `"none"` | No spread, use default |

#### note_duration

Controls how long notes sustain.

```json
{
  "note_duration": {
    "min": 0.15,
    "max": 1.5,
    "multiplier": 1.0,
    "curve": 1.0,
    "spread": "inverse",
    "control": "tiltXY",
    "default": 1.0
  }
}
```

#### pitch_bend

Controls pitch bend amount.

```json
{
  "pitch_bend": {
    "min": -1.0,
    "max": 1.0,
    "multiplier": 1.0,
    "curve": 4.0,
    "spread": "central",
    "control": "yaxis",
    "default": 0.0
  }
}
```

#### note_velocity

Controls MIDI velocity (0-127).

```json
{
  "note_velocity": {
    "min": 0,
    "max": 127,
    "multiplier": 1.0,
    "curve": 4.0,
    "spread": "direct",
    "control": "pressure",
    "default": 64
  }
}
```

---

### strumming

Core strumming configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pluck_velocity_scale` | number | 4.0 | Scale factor for pluck velocity |
| `pressure_threshold` | number | 0.1 | Minimum pressure to trigger strum (0-1) |
| `midi_channel` | number\|null | null | MIDI channel (0-15), null for omni |
| `initial_notes` | string[] | ["C4","E4","G4"] | List of note strings |
| `chord` | string\|null | null | Chord notation (e.g., "Am", "Gmaj7") |
| `upper_note_spread` | number | 3 | Notes to add above chord |
| `lower_note_spread` | number | 3 | Notes to add below chord |

```json
{
  "strumming": {
    "pluck_velocity_scale": 4.0,
    "pressure_threshold": 0.1,
    "midi_channel": null,
    "initial_notes": [],
    "chord": "Am",
    "upper_note_spread": 2,
    "lower_note_spread": 2
  }
}
```

**Note:** If `chord` is specified, it takes precedence over `initial_notes`.

---

### note_repeater

Repeats notes at a frequency controlled by pressure.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Enable note repeater |
| `pressure_multiplier` | number | 1.0 | Scale for pressure-to-frequency |
| `frequency_multiplier` | number | 1.0 | Base frequency multiplier |

```json
{
  "note_repeater": {
    "active": false,
    "pressure_multiplier": 1.0,
    "frequency_multiplier": 1.0
  }
}
```

---

### transpose

Transposes all notes by semitones.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Enable transpose |
| `semitones` | number | 12 | Semitones to transpose (+/-) |

```json
{
  "transpose": {
    "active": false,
    "semitones": 12
  }
}
```

---

### stylus_buttons

Maps stylus buttons to actions.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | true | Enable stylus button handling |
| `primary_button_action` | string | "toggle-transpose" | Primary button action |
| `secondary_button_action` | string | "toggle-repeater" | Secondary button action |

#### Button Actions

| Value | Description |
|-------|-------------|
| `"toggle-transpose"` | Toggle transpose on/off |
| `"toggle-repeater"` | Toggle note repeater on/off |
| `"momentary-transpose"` | Transpose while held |
| `"momentary-repeater"` | Repeater while held |
| `"octave-up"` | Shift octave up |
| `"octave-down"` | Shift octave down |
| `"none"` | No action |

```json
{
  "stylus_buttons": {
    "active": true,
    "primary_button_action": "toggle-transpose",
    "secondary_button_action": "toggle-repeater"
  }
}
```

---

### strum_release

Triggers a MIDI note on strum release (e.g., for drum sounds).

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Enable strum release |
| `midi_note` | number | 38 | MIDI note to send (38=snare) |
| `midi_channel` | number\|null | null | Channel (null=same as strummer) |
| `max_duration` | number | 0.25 | Max note duration in seconds |
| `velocity_multiplier` | number | 1.0 | Velocity scale factor |

```json
{
  "strum_release": {
    "active": false,
    "midi_note": 38,
    "midi_channel": null,
    "max_duration": 0.25,
    "velocity_multiplier": 1.0
  }
}
```

---

### midi

MIDI backend configuration.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `midi_output_backend` | string | "rtmidi" | Backend: "rtmidi" or "jack" |
| `midi_output_id` | number\|string\|null | null | Output port (index or name) |
| `midi_input_id` | number\|string\|null | null | Input port (index or name) |
| `jack_client_name` | string | "sketchatone" | JACK client name |
| `jack_auto_connect` | string\|null | "chain0" | JACK auto-connect target |
| `note_duration` | number | 1.5 | Default note duration (seconds) |

```json
{
  "midi": {
    "midi_output_backend": "rtmidi",
    "midi_output_id": 2,
    "midi_input_id": null,
    "jack_client_name": "sketchatone",
    "jack_auto_connect": "chain0",
    "note_duration": 1.5
  }
}
```

#### midi_output_id

Can be specified as:
- **Integer**: Port index (e.g., `2` for the third port)
- **String**: Port name or partial match (e.g., `"IAC Driver"`)
- **null**: Use first available port

#### jack_auto_connect

JACK auto-connect modes:
- `"chain0"` - Connect to Zynthian Chain 0
- `"all-chains"` - Connect to all Zynthian chains
- `null` - No auto-connect

---

### tablet_buttons

Maps tablet hardware buttons to chord progressions.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `preset` | string | "c-major-pop" | Preset name or "custom" |
| `chords` | string[] | ["C","G","Am","F"] | Chord names for each button |
| `current_index` | number | 0 | Currently active chord index |

#### Available Presets

| Preset | Chords | Description |
|--------|--------|-------------|
| `"c-major-pop"` | C, G, Am, F | I-V-vi-IV in C |
| `"c-major-50s"` | C, Am, F, G | I-vi-IV-V in C |
| `"g-major-pop"` | G, D, Em, C | I-V-vi-IV in G |
| `"d-major-pop"` | D, A, Bm, G | I-V-vi-IV in D |
| `"a-major-pop"` | A, E, F#m, D | I-V-vi-IV in A |
| `"a-minor-pop"` | Am, F, C, G | i-VI-III-VII in Am |
| `"e-minor-pop"` | Em, C, G, D | i-VI-III-VII in Em |

```json
{
  "tablet_buttons": {
    "preset": "c-major-pop",
    "chords": ["C", "G", "Am", "F"],
    "current_index": 0
  }
}
```

**Note:** If `preset` is set to a valid preset name, the `chords` array is automatically populated from the preset. Use `"custom"` preset to specify your own chord progression.

---

### server

Server configuration for HTTP and WebSocket servers.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `http_port` | number\|null | null | HTTP server port for serving webapps (null = disabled) |
| `ws_port` | number\|null | null | WebSocket server port (null = disabled) |
| `ws_message_throttle` | number | 150 | WebSocket message throttle interval in milliseconds |
| `device_finding_poll_interval` | number\|null | null | Poll interval in ms for device detection (null = quit if no device) |

```json
{
  "server": {
    "http_port": 8080,
    "ws_port": 8081,
    "ws_message_throttle": 150,
    "device_finding_poll_interval": 2000
  }
}
```

**Note:** When `device_finding_poll_interval` is set, the server will poll for a tablet device at the specified interval instead of quitting when no device is found. This enables hot-plug support.
