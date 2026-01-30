---
title: Note Repeater
description: Create tremolo effects with automatic note repetition
---

# Note Repeater

The note repeater automatically re-triggers notes while you hold the pen down, creating tremolo or strumming effects.

## Configuration

```json
{
  "note_repeater": {
    "active": false,
    "pressure_multiplier": 1.0,
    "frequency_multiplier": 1.0
  }
}
```

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Enable/disable the repeater |
| `pressure_multiplier` | number | 1.0 | How much pressure affects repeat speed |
| `frequency_multiplier` | number | 1.0 | Base repeat frequency multiplier |

## How It Works

When enabled, the note repeater:

1. Triggers notes when you first touch the tablet
2. Continues re-triggering notes at a rate controlled by pressure
3. Stops when you lift the pen

Higher pressure = faster repetition.

## Example Configurations

### Gentle Tremolo

```json
{
  "note_repeater": {
    "active": true,
    "pressure_multiplier": 0.5,
    "frequency_multiplier": 0.5
  }
}
```

### Aggressive Strumming

```json
{
  "note_repeater": {
    "active": true,
    "pressure_multiplier": 2.0,
    "frequency_multiplier": 1.5
  }
}
```

## Toggling the Repeater

You can toggle the repeater on/off using stylus buttons:

```json
{
  "stylus_buttons": {
    "active": true,
    "secondary_button_action": "toggle-repeater"
  }
}
```

Or use momentary mode (active only while button held):

```json
{
  "stylus_buttons": {
    "secondary_button_action": "momentary-repeater"
  }
}
```

## See Also

- **[Stylus Buttons](/about/stylus-buttons/)** - Button actions
- **[Actions Reference](/about/actions-reference/)** - All available actions
