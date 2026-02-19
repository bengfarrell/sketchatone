---
title: Stylus Buttons
description: Map pen buttons to actions
---

# Stylus Buttons

Most graphics tablet pens have one or two buttons on the barrel. Sketchatone can map these to various actions using the **Action Rules** system.

## Configuration

Stylus buttons are configured through the `action_rules` section. The primary and secondary stylus buttons are identified as `button:primary` and `button:secondary`:

```json
{
  "action_rules": {
    "button_names": {
      "button:primary": "Primary Stylus",
      "button:secondary": "Secondary Stylus"
    },
    "rules": [
      {
        "id": "stylus-primary-transpose",
        "name": "Toggle Transpose",
        "button": "button:primary",
        "action": "toggle-transpose",
        "trigger": "press"
      },
      {
        "id": "stylus-secondary-repeater",
        "name": "Toggle Repeater",
        "button": "button:secondary",
        "action": "toggle-repeater",
        "trigger": "press"
      }
    ]
  }
}
```

## Available Actions

| Action | Description |
|--------|-------------|
| `"toggle-transpose"` | Toggle transpose on/off |
| `"toggle-repeater"` | Toggle note repeater on/off |
| `"momentary-transpose"` | Transpose while button held |
| `"momentary-repeater"` | Repeater while button held |
| `"octave-up"` | Shift transpose up 12 semitones |
| `"octave-down"` | Shift transpose down 12 semitones |

## Trigger Types

| Trigger | Description |
|---------|-------------|
| `"press"` | Action fires when button is pressed |
| `"release"` | Action fires when button is released |
| `"hold"` | Action fires while button is held (for momentary actions) |

## Example: Momentary Actions

For actions that should only be active while the button is held:

```json
{
  "rules": [
    {
      "id": "stylus-primary-momentary",
      "button": "button:primary",
      "action": "momentary-transpose",
      "trigger": "press"
    }
  ]
}
```

## See Also

- **[Action Rules](/about/action-rules/)** - Complete action rules documentation
- **[Transpose](/about/transpose/)** - Transpose configuration
- **[Note Repeater](/about/note-repeater/)** - Repeater configuration
