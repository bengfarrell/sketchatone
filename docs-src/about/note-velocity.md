---
title: Note Velocity
description: Control MIDI velocity with tablet input
---

# Note Velocity

Note velocity controls how loud each note plays. Sketchatone can map various tablet inputs to velocity.

## Configuration

```json
{
  "note_velocity": {
    "control": "pressure",
    "min": 0,
    "max": 127,
    "curve": 4.0,
    "spread": "direct",
    "default": 64
  }
}
```

## Common Setups

### Pressure-Controlled Velocity

Press harder for louder notes:

```json
{
  "note_velocity": {
    "control": "pressure",
    "min": 20,
    "max": 127,
    "curve": 2.0,
    "spread": "direct"
  }
}
```

### Fixed Velocity

All notes at the same volume:

```json
{
  "note_velocity": {
    "control": "none",
    "default": 100
  }
}
```

### Tilt-Controlled Velocity

Angle your pen for dynamics:

```json
{
  "note_velocity": {
    "control": "tiltXY",
    "min": 40,
    "max": 127,
    "spread": "direct"
  }
}
```

## Response Curve

The `curve` parameter shapes the response:

- `1.0` - Linear response
- `2.0` - Gentle exponential (more control at low end)
- `4.0` - Strong exponential (dramatic dynamics)
- `0.5` - Logarithmic (more control at high end)

## See Also

- **[Note Duration](/about/note-duration/)** - Control note length
- **[Pitch Bend](/about/pitch-bend/)** - Control pitch
