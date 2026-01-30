---
title: Stylus Buttons
description: Map pen buttons to actions
---

# Stylus Buttons

Most graphics tablet pens have one or two buttons on the barrel. Sketchatone can map these to various actions.

## Configuration

```json
{
  "stylus_buttons": {
    "active": true,
    "primary_button_action": "toggle-transpose",
    "secondary_button_action": "toggle-repeater"
  }
}
```

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | true | Enable stylus button handling |
| `primary_button_action` | string | "toggle-transpose" | Action for primary button |
| `secondary_button_action` | string | "toggle-repeater" | Action for secondary button |

## Available Actions

| Action | Description |
|--------|-------------|
| `"toggle-transpose"` | Toggle transpose on/off |
| `"toggle-repeater"` | Toggle note repeater on/off |
| `"momentary-transpose"` | Transpose while button held |
| `"momentary-repeater"` | Repeater while button held |
| `"octave-up"` | Shift transpose up 12 semitones |
| `"octave-down"` | Shift transpose down 12 semitones |
| `"none"` | No action |

## Example Configurations

### Performance Setup

Quick access to transpose and repeater:

```json
{
  "stylus_buttons": {
    "active": true,
    "primary_button_action": "momentary-transpose",
    "secondary_button_action": "momentary-repeater"
  }
}
```

### Octave Navigation

Jump between octaves:

```json
{
  "stylus_buttons": {
    "active": true,
    "primary_button_action": "octave-up",
    "secondary_button_action": "octave-down"
  }
}
```

### Disabled

Turn off button handling:

```json
{
  "stylus_buttons": {
    "active": false
  }
}
```

## See Also

- **[Actions Reference](/about/actions-reference/)** - Complete action list
- **[Transpose](/about/transpose/)** - Transpose configuration
- **[Note Repeater](/about/note-repeater/)** - Repeater configuration
