---
title: Actions Reference
description: Complete list of available button actions
---

# Actions Reference

This page lists all available actions that can be assigned to stylus buttons.

## Button Actions

| Action | Type | Description |
|--------|------|-------------|
| `"toggle-transpose"` | Toggle | Turn transpose on/off |
| `"toggle-repeater"` | Toggle | Turn note repeater on/off |
| `"momentary-transpose"` | Momentary | Transpose while button held |
| `"momentary-repeater"` | Momentary | Repeater while button held |
| `"octave-up"` | Instant | Shift transpose +12 semitones |
| `"octave-down"` | Instant | Shift transpose -12 semitones |
| `"none"` | - | No action |

## Action Types

### Toggle Actions

Toggle actions switch a feature on or off each time the button is pressed.

```json
{
  "stylus_buttons": {
    "primary_button_action": "toggle-transpose"
  }
}
```

### Momentary Actions

Momentary actions are active only while the button is held down.

```json
{
  "stylus_buttons": {
    "primary_button_action": "momentary-transpose"
  }
}
```

### Instant Actions

Instant actions take effect immediately and don't have an on/off state.

```json
{
  "stylus_buttons": {
    "primary_button_action": "octave-up",
    "secondary_button_action": "octave-down"
  }
}
```

## Configuration Example

```json
{
  "stylus_buttons": {
    "active": true,
    "primary_button_action": "toggle-transpose",
    "secondary_button_action": "toggle-repeater"
  },
  "transpose": {
    "active": false,
    "semitones": 12
  },
  "note_repeater": {
    "active": false,
    "pressure_multiplier": 1.0
  }
}
```

## See Also

- **[Stylus Buttons](/about/stylus-buttons/)** - Button configuration
- **[Transpose](/about/transpose/)** - Transpose settings
- **[Note Repeater](/about/note-repeater/)** - Repeater settings
