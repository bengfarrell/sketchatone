---
title: Note Duration
description: Control how long notes sustain
---

# Note Duration

Note duration controls how long each note sustains before the note-off message is sent.

## Configuration

```json
{
  "note_duration": {
    "control": "tiltXY",
    "min": 0.15,
    "max": 1.5,
    "curve": 1.0,
    "spread": "inverse",
    "default": 1.0
  }
}
```

## Common Setups

### Tilt-Controlled Duration

Tilt your pen for longer or shorter notes:

```json
{
  "note_duration": {
    "control": "tiltXY",
    "min": 0.1,
    "max": 2.0,
    "spread": "inverse"
  }
}
```

With `"inverse"` spread, holding the pen upright gives longer notes, tilting gives shorter staccato notes.

### Fixed Duration

All notes the same length:

```json
{
  "note_duration": {
    "control": "none",
    "default": 0.5
  }
}
```

### Pressure-Controlled Duration

Press harder for longer notes:

```json
{
  "note_duration": {
    "control": "pressure",
    "min": 0.1,
    "max": 1.0,
    "spread": "direct"
  }
}
```

## Duration Range

- **min**: Shortest possible note (in seconds)
- **max**: Longest possible note (in seconds)

Typical ranges:
- Staccato: 0.05 - 0.2 seconds
- Normal: 0.2 - 1.0 seconds
- Legato: 0.5 - 2.0 seconds

## See Also

- **[Note Velocity](/about/note-velocity/)** - Control note loudness
- **[Pitch Bend](/about/pitch-bend/)** - Control pitch
