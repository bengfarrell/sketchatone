---
title: Transpose
description: Shift all notes up or down by semitones
---

# Transpose

Transpose shifts all notes up or down by a specified number of semitones.

## Configuration

```json
{
  "transpose": {
    "active": false,
    "semitones": 12
  }
}
```

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Enable/disable transpose |
| `semitones` | number | 12 | Semitones to shift (+/-) |

## Common Uses

### Octave Up

```json
{
  "transpose": {
    "active": true,
    "semitones": 12
  }
}
```

### Octave Down

```json
{
  "transpose": {
    "active": true,
    "semitones": -12
  }
}
```

### Fifth Up

```json
{
  "transpose": {
    "active": true,
    "semitones": 7
  }
}
```

## Toggling Transpose

You can toggle transpose on/off using stylus buttons:

```json
{
  "stylus_buttons": {
    "active": true,
    "primary_button_action": "toggle-transpose"
  }
}
```

Or use momentary mode (active only while button held):

```json
{
  "stylus_buttons": {
    "primary_button_action": "momentary-transpose"
  }
}
```

## Octave Shift Actions

For quick octave changes, use the octave actions:

```json
{
  "stylus_buttons": {
    "primary_button_action": "octave-up",
    "secondary_button_action": "octave-down"
  }
}
```

These permanently shift the transpose value by ±12 semitones.

## See Also

- **[Stylus Buttons](/about/stylus-buttons/)** - Button actions
- **[Actions Reference](/about/actions-reference/)** - All available actions
