---
title: Pitch Bend
description: Control pitch bend with tablet input
---

# Pitch Bend

Pitch bend allows you to smoothly bend the pitch of notes up or down using tablet input.

## Configuration

```json
{
  "pitch_bend": {
    "control": "yaxis",
    "min": -1.0,
    "max": 1.0,
    "curve": 4.0,
    "spread": "central",
    "default": 0.0
  }
}
```

## Common Setups

### Y-Axis Pitch Bend

Move up/down on the tablet to bend pitch:

```json
{
  "pitch_bend": {
    "control": "yaxis",
    "min": -1.0,
    "max": 1.0,
    "spread": "central",
    "curve": 4.0
  }
}
```

With `"central"` spread, the center of the tablet is neutral (no bend), moving up bends up, moving down bends down.

### Tilt-Controlled Pitch Bend

Tilt your pen to bend pitch:

```json
{
  "pitch_bend": {
    "control": "tiltX",
    "min": -1.0,
    "max": 1.0,
    "spread": "central"
  }
}
```

### No Pitch Bend

Disable pitch bend:

```json
{
  "pitch_bend": {
    "control": "none",
    "default": 0.0
  }
}
```

## Spread Types for Pitch Bend

- **`"central"`** - Center position = no bend, edges = full bend (recommended)
- **`"direct"`** - 0 = min bend, 1 = max bend
- **`"inverse"`** - 0 = max bend, 1 = min bend

## Response Curve

Higher `curve` values create a "dead zone" in the center, making it easier to stay in tune while still allowing dramatic bends at the extremes.

## See Also

- **[Note Velocity](/about/note-velocity/)** - Control note loudness
- **[Note Duration](/about/note-duration/)** - Control note length
