---
title: Strumming
description: How strumming works and how to configure it
---

# Strumming

Strumming is the core feature of Sketchatone. It converts horizontal pen movement across your tablet into MIDI note triggers.

## How It Works

1. **Touch the tablet** with your pen (pressure above threshold)
2. **Draw horizontally** across the surface
3. **Notes trigger** as you cross invisible "string" boundaries
4. **Lift the pen** to stop strumming

The tablet surface is divided into virtual "strings" based on your chord configuration. Moving left-to-right or right-to-left triggers notes in sequence, like strumming a guitar.

## Configuration

```json
{
  "strumming": {
    "chord": "Am",
    "midi_channel": 0,
    "pressure_threshold": 0.1,
    "pluck_velocity_scale": 4.0,
    "upper_note_spread": 2,
    "lower_note_spread": 2
  }
}
```

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `chord` | string | null | Chord name (e.g., "Am", "Gmaj7", "C") |
| `initial_notes` | string[] | ["C4","E4","G4"] | Explicit note list (used if no chord) |
| `midi_channel` | number | null | MIDI channel (0-15), null for omni |
| `pressure_threshold` | number | 0.1 | Minimum pressure to trigger (0-1) |
| `pluck_velocity_scale` | number | 4.0 | Velocity multiplier for plucks |
| `upper_note_spread` | number | 3 | Octave notes above chord |
| `lower_note_spread` | number | 3 | Octave notes below chord |

## Chord vs Initial Notes

You can specify notes in two ways:

### Using `chord`

```json
{
  "strumming": {
    "chord": "Am7"
  }
}
```

The chord is automatically expanded to notes (A, C, E, G for Am7).

### Using `initial_notes`

```json
{
  "strumming": {
    "initial_notes": ["C4", "E4", "G4", "B4"]
  }
}
```

Explicit note list gives you full control.

**Note:** If both are specified, `chord` takes precedence.

## Note Spread

The `upper_note_spread` and `lower_note_spread` properties add octave copies of your chord notes above and below the base chord:

```json
{
  "strumming": {
    "chord": "C",
    "upper_note_spread": 2,
    "lower_note_spread": 1
  }
}
```

This creates a wider range of notes to strum across.

## See Also

- **[Note Velocity](/about/note-velocity/)** - Control note loudness
- **[Chords & Progressions](/about/chords-and-progressions/)** - Chord reference
- **[Tablet Buttons](/about/tablet-buttons/)** - Switch chords with buttons
