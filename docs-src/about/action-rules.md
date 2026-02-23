---
title: Action Rules
description: Map tablet and stylus buttons to actions
---

# Action Rules

The Action Rules system is Sketchatone's unified button-to-action mapping system. It allows you to map stylus buttons, tablet hardware buttons, and even startup behaviors to various musical actions like transpose, note repeater, chord changes, and more.

## Overview

Action Rules replace the older `stylus_buttons` and `tablet_buttons` configuration systems with a more flexible and powerful approach:

- **Unified System**: One configuration format for all buttons
- **Flexible Mapping**: Map any button to any action
- **Button Groups**: Create groups of buttons for chord progressions
- **Startup Rules**: Execute actions automatically on startup
- **Custom Names**: Give buttons human-readable names
- **Multiple Triggers**: Press, release, or hold triggers

## Configuration Structure

The `action_rules` section has five main parts:

```json
{
  "action_rules": {
    "button_names": { /* Human-readable button names */ },
    "rules": [ /* Individual button-to-action mappings */ ],
    "groups": [ /* Button groups (collections) */ ],
    "group_rules": [ /* Actions for button groups */ ],
    "startup_rules": [ /* Actions that run on startup */ ]
  }
}
```

---

## Button IDs

Buttons are identified by standardized IDs:

| Button ID | Description |
|-----------|-------------|
| `button:primary` | Primary stylus button (barrel button 1) |
| `button:secondary` | Secondary stylus button (barrel button 2) |
| `button:1` | First tablet hardware button |
| `button:2` | Second tablet hardware button |
| `button:3` | Third tablet hardware button |
| `button:N` | Nth tablet hardware button |

---

## Button Names

Give buttons human-readable names for better organization:

```json
{
  "action_rules": {
    "button_names": {
      "button:primary": "Primary Stylus",
      "button:secondary": "Secondary Stylus",
      "button:1": "Button 1",
      "button:2": "Button 2",
      "button:3": "Button 3",
      "button:4": "Button 4"
    }
  }
}
```

---

## Action Rules

Individual button-to-action mappings.

### Rule Format

```json
{
  "id": "unique-rule-id",
  "name": "Human Readable Name",
  "button": "button:primary",
  "action": "action-name",
  "trigger": "press"
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for this rule |
| `name` | string | No | Human-readable name |
| `button` | string | Yes | Button ID (e.g., `button:primary`) |
| `action` | string or array | Yes | Action to execute |
| `trigger` | string | No | When to trigger: `press`, `release`, `hold` (default: `release`) |

### Trigger Types

| Trigger | Description |
|---------|-------------|
| `press` | Action fires when button is pressed down |
| `release` | Action fires when button is released (default) |
| `hold` | Action fires continuously while button is held |

---

## Available Actions

### Toggle Transpose

Toggle transpose on/off. When active, all notes are shifted by the specified number of semitones.

**Action:** `toggle-transpose`

**Parameters:** `[semitones]`
- `semitones` (number, default: 12) - Number of semitones to transpose

**Example:**

```json
{
  "id": "toggle-transpose-octave",
  "name": "Toggle Transpose (Octave Up)",
  "button": "button:primary",
  "action": ["toggle-transpose", 12],
  "trigger": "press"
}
```

**Common Values:**
- `12` - Octave up
- `-12` - Octave down
- `7` - Perfect fifth up
- `-7` - Perfect fifth down
- `5` - Perfect fourth up

---

### Toggle Repeater

Toggle note repeater on/off. When active, notes are automatically re-triggered while the pen is pressed, creating tremolo effects.

**Action:** `toggle-repeater`

**Parameters:** `[pressureMultiplier, frequencyMultiplier]`
- `pressureMultiplier` (number, default: 1.0) - How much pressure affects repeat speed
- `frequencyMultiplier` (number, default: 1.0) - Base repeat frequency

**Example:**

```json
{
  "id": "toggle-repeater",
  "name": "Toggle Note Repeater",
  "button": "button:secondary",
  "action": ["toggle-repeater", 2.0, 1.5],
  "trigger": "press"
}
```

**Parameter Guide:**
- **Pressure Multiplier:**
  - `0.5` - Gentle, less pressure-sensitive
  - `1.0` - Default, moderate response
  - `2.0` - Aggressive, very pressure-sensitive
- **Frequency Multiplier:**
  - `0.5` - Slow tremolo
  - `1.0` - Default speed
  - `1.5` - Fast strumming
  - `2.0` - Very fast repetition

---

### Transpose

Set a specific transpose value (doesn't toggle).

**Action:** `transpose`

**Parameters:** `[semitones]`
- `semitones` (number) - Number of semitones to transpose

**Example:**

```json
{
  "id": "transpose-octave-up",
  "name": "Transpose Octave Up",
  "button": "button:1",
  "action": ["transpose", 12],
  "trigger": "press"
}
```

---

### Set Chord

Set the strummer to play a specific chord.

**Action:** `set-chord`

**Parameters:** `[chordNotation, octave]`
- `chordNotation` (string) - Chord notation (e.g., "Cmaj7", "Am", "G7")
- `octave` (number, optional) - Base octave (default: 4)

**Example:**

```json
{
  "id": "set-chord-cmaj",
  "name": "Set Chord to C Major",
  "button": "button:1",
  "action": ["set-chord", "C", 4],
  "trigger": "press"
}
```

---

### Set Strum Notes

Set specific notes for the strummer (not based on a chord).

**Action:** `set-strum-notes`

**Parameters:** `[noteArray]`
- `noteArray` (array of strings) - Note names (e.g., ["C4", "E4", "G4"])

**Example:**

```json
{
  "id": "set-custom-notes",
  "name": "Set Custom Notes",
  "button": "button:2",
  "action": ["set-strum-notes", ["C4", "E4", "G4", "B4"]],
  "trigger": "press"
}
```

---

## Button Groups

Button groups allow you to assign multiple buttons to work together, typically for chord progressions.

### Group Format

```json
{
  "id": "group-id",
  "name": "Group Name",
  "buttons": ["button:1", "button:2", "button:3", "button:4"]
}
```

### Example

```json
{
  "action_rules": {
    "groups": [
      {
        "id": "chord-buttons",
        "name": "Chord Buttons",
        "buttons": ["button:1", "button:2", "button:3", "button:4"]
      }
    ]
  }
}
```

---

## Group Rules

Group rules assign actions to button groups, typically for chord progressions.

### Group Rule Format

```json
{
  "id": "rule-id",
  "name": "Rule Name",
  "group_id": "group-id",
  "trigger": "press",
  "action": {
    "type": "chord-progression",
    "progression": "c-major-pop",
    "octave": 4
  }
}
```

### Chord Progression Action

**Action Type:** `chord-progression`

**Properties:**
- `progression` (string) - Progression name (see **[Chords & Progressions](/about/chords-and-progressions/)** for full list)
- `octave` (number, default: 4) - Base octave

**Example:**

```json
{
  "action_rules": {
    "groups": [
      {
        "id": "chord-buttons",
        "name": "Chord Buttons",
        "buttons": ["button:1", "button:2", "button:3", "button:4"]
      }
    ],
    "group_rules": [
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
    ]
  }
}
```

This maps:
- Button 1 → C major
- Button 2 → G major
- Button 3 → A minor
- Button 4 → F major

---

## Startup Rules

Startup rules execute actions automatically when Sketchatone starts.

### Startup Rule Format

```json
{
  "id": "rule-id",
  "name": "Rule Name",
  "action": "action-definition"
}
```

### Example: Enable Transpose on Startup

```json
{
  "action_rules": {
    "startup_rules": [
      {
        "id": "startup-transpose",
        "name": "Enable Transpose on Startup",
        "action": ["toggle-transpose", 12]
      }
    ]
  }
}
```

### Example: Set Initial Chord

```json
{
  "action_rules": {
    "startup_rules": [
      {
        "id": "startup-chord",
        "name": "Set Initial Chord to Am",
        "action": ["set-chord", "Am", 4]
      }
    ]
  }
}
```

---

## Complete Example

Here's a complete action rules configuration:

```json
{
  "action_rules": {
    "button_names": {
      "button:primary": "Primary Stylus",
      "button:secondary": "Secondary Stylus",
      "button:1": "C Major",
      "button:2": "G Major",
      "button:3": "A Minor",
      "button:4": "F Major"
    },
    "rules": [
      {
        "id": "stylus-primary-transpose",
        "name": "Toggle Transpose (Octave Up)",
        "button": "button:primary",
        "action": ["toggle-transpose", 12],
        "trigger": "press"
      },
      {
        "id": "stylus-secondary-repeater",
        "name": "Toggle Note Repeater",
        "button": "button:secondary",
        "action": ["toggle-repeater", 2.0, 1.5],
        "trigger": "press"
      }
    ],
    "groups": [
      {
        "id": "chord-buttons",
        "name": "Chord Buttons",
        "buttons": ["button:1", "button:2", "button:3", "button:4"]
      }
    ],
    "group_rules": [
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
    ],
    "startup_rules": []
  }
}
```

This configuration:
- Maps primary stylus button to toggle transpose (octave up)
- Maps secondary stylus button to toggle note repeater
- Maps tablet buttons 1-4 to C major pop progression (C, G, Am, F)

---

## See Also

- **[Configuration Settings](/about/configuration-settings/#action_rules)** - Complete config reference
- **[Chords & Progressions](/about/chords-and-progressions/)** - Chord notation reference
- **[Strumming](/about/strumming/)** - Strummer configuration
