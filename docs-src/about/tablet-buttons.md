---
title: Tablet Buttons
description: Map tablet hardware buttons to chord progressions
---

# Tablet Buttons

Many graphics tablets have hardware buttons along the edge. Sketchatone can map these to chord changes, letting you switch chords while playing.

## Configuration

```json
{
  "tablet_buttons": {
    "preset": "c-major-pop",
    "chords": ["C", "G", "Am", "F"],
    "current_index": 0
  }
}
```

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `preset` | string | "c-major-pop" | Preset name or "custom" |
| `chords` | string[] | ["C","G","Am","F"] | Chord names for each button |
| `current_index` | number | 0 | Currently active chord index |

## Available Presets

| Preset | Chords | Description |
|--------|--------|-------------|
| `"c-major-pop"` | C, G, Am, F | I-V-vi-IV in C |
| `"c-major-50s"` | C, Am, F, G | I-vi-IV-V in C |
| `"g-major-pop"` | G, D, Em, C | I-V-vi-IV in G |
| `"d-major-pop"` | D, A, Bm, G | I-V-vi-IV in D |
| `"a-major-pop"` | A, E, F#m, D | I-V-vi-IV in A |
| `"a-minor-pop"` | Am, F, C, G | i-VI-III-VII in Am |
| `"e-minor-pop"` | Em, C, G, D | i-VI-III-VII in Em |

## Custom Progressions

Use `"custom"` preset with your own chords:

```json
{
  "tablet_buttons": {
    "preset": "custom",
    "chords": ["Dm7", "G7", "Cmaj7", "Fmaj7"]
  }
}
```

## How It Works

1. Press a tablet button (1-8)
2. The corresponding chord becomes active
3. Strumming now plays that chord

Button 1 = first chord, Button 2 = second chord, etc.

## See Also

- **[Chords & Progressions](/about/chords-and-progressions/)** - Chord reference
- **[Strumming](/about/strumming/)** - Strummer configuration
