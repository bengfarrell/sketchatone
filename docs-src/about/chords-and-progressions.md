---
title: Chords & Progressions
description: Supported chord types and common progressions
---

# Chords & Progressions

Sketchatone supports a wide variety of chord types and includes preset progressions for common musical styles.

## Chord Notation

Chords are specified using standard notation:

```
[Root][Quality][Extensions]
```

### Examples

| Notation | Name | Notes |
|----------|------|-------|
| `C` | C Major | C, E, G |
| `Am` | A Minor | A, C, E |
| `G7` | G Dominant 7th | G, B, D, F |
| `Dmaj7` | D Major 7th | D, F#, A, C# |
| `Em7` | E Minor 7th | E, G, B, D |
| `F#m` | F# Minor | F#, A, C# |
| `Bb` | Bb Major | Bb, D, F |

## Supported Chord Types

### Triads

| Quality | Suffix | Example |
|---------|--------|---------|
| Major | (none) | `C`, `G`, `D` |
| Minor | `m` | `Am`, `Em`, `Dm` |
| Diminished | `dim` | `Bdim` |
| Augmented | `aug` | `Caug` |

### Seventh Chords

| Quality | Suffix | Example |
|---------|--------|---------|
| Dominant 7th | `7` | `G7`, `D7` |
| Major 7th | `maj7` | `Cmaj7`, `Fmaj7` |
| Minor 7th | `m7` | `Am7`, `Em7` |
| Diminished 7th | `dim7` | `Bdim7` |
| Half-Diminished | `m7b5` | `Bm7b5` |

### Extended Chords

| Quality | Suffix | Example |
|---------|--------|---------|
| Add 9 | `add9` | `Cadd9` |
| Suspended 2 | `sus2` | `Dsus2` |
| Suspended 4 | `sus4` | `Asus4` |

## Preset Progressions

### Pop/Rock

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `c-major-pop` | C | C, G, Am, F | I-V-vi-IV |
| `g-major-pop` | G | G, D, Em, C | I-V-vi-IV |
| `d-major-pop` | D | D, A, Bm, G | I-V-vi-IV |
| `a-major-pop` | A | A, E, F#m, D | I-V-vi-IV |

### Minor Key

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `a-minor-pop` | Am | Am, F, C, G | i-VI-III-VII |
| `e-minor-pop` | Em | Em, C, G, D | i-VI-III-VII |

### Classic

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `c-major-50s` | C | C, Am, F, G | I-vi-IV-V |

## Custom Progressions

Create your own progression:

```json
{
  "tablet_buttons": {
    "preset": "custom",
    "chords": ["Dm7", "G7", "Cmaj7", "Am7"]
  }
}
```

## See Also

- **[Tablet Buttons](/about/tablet-buttons/)** - Button-to-chord mapping
- **[Strumming](/about/strumming/)** - Strummer configuration
