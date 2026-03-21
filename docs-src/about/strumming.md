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
    "pressure_buffer_size": 10,
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
| `pressure_buffer_size` | number | 10 | Pressure samples to buffer before first note triggers |
| `upper_note_spread` | number | 3 | Octave notes above chord |
| `lower_note_spread` | number | 3 | Octave notes below chord |

### Pressure Buffer Size

The `pressure_buffer_size` controls how many samples are collected before the initial note of a strum fires. Increasing this value allows the pressure sensor to register more of the pen strike force, producing louder and more accurate velocity on taps and the first note of a strum. The tradeoff is a small increase in latency before the first note sounds.

If the pen is lifted before the buffer fills (a quick tap), the note fires immediately on release using the peak pressure from whatever samples were collected — quick taps are never dropped.

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
- **[Action Rules](/about/action-rules/)** - Configure button actions to switch chords
