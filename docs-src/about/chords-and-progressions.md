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

## Using Chords in Configuration

### In Strumming Config

Set the chord to strum:

```json
{
  "strumming": {
    "chord": "Am7",
    "midi_channel": 0
  }
}
```

### With Action Rules

Map buttons to change chords:

```json
{
  "action_rules": {
    "rules": [
      {
        "id": "set-dm7",
        "name": "Set Dm7",
        "button": "button:1",
        "action": ["set-chord", "Dm7", 4],
        "trigger": "press"
      }
    ]
  }
}
```

### With Chord Progressions

Map button groups to progressions:

```json
{
  "action_rules": {
    "groups": [
      {
        "id": "chord-buttons",
        "name": "Chord Buttons",
        "buttons": ["button:1", "button:2", "button:3", "button:4"]
      }
    ],
    "group_rules": [
      {
        "id": "progression",
        "name": "C Major Pop",
        "group_id": "chord-buttons",
        "trigger": "press",
        "action": {
          "type": "chord-progression",
          "progression": "c-major-pop",
          "octave": 4
        }
      }
    ]
  }
}
```

## Custom Chord Progressions

You can define your own chord progressions in the configuration file using the `customChordProgressions` field. Custom progressions can be used anywhere a preset progression is used, and they take precedence over built-in presets if they share the same name.

### Defining Custom Progressions

Add a `customChordProgressions` object at the root level of your configuration:

```json
{
  "customChordProgressions": {
    "my-custom-song": ["Am", "F", "C", "G"],
    "my-jazz-tune": ["Cmaj7", "Am7", "Dm7", "G7"],
    "my-blues": ["A7", "D7", "E7", "A7"]
  }
}
```

### Using Custom Progressions

Reference your custom progressions by name in action rules:

```json
{
  "action_rules": {
    "groups": [
      {
        "id": "chord-buttons",
        "name": "Chord Buttons",
        "buttons": ["button:1", "button:2", "button:3", "button:4"]
      }
    ],
    "group_rules": [
      {
        "id": "my-song-progression",
        "name": "My Custom Song",
        "group_id": "chord-buttons",
        "trigger": "press",
        "action": {
          "type": "chord-progression",
          "progression": "my-custom-song",
          "octave": 4
        }
      }
    ]
  }
}
```

### Notes

- Custom progression names can use any string (e.g., `"my-song"`, `"verse-1"`, `"chorus"`)
- Each progression is an array of chord notations
- Custom progressions override built-in presets with the same name
- You can have any number of chords in a progression
- All standard chord notations are supported (see [Chord Notation](#chord-notation) above)

## See Also

- **[Action Rules](/about/action-rules/)** - Button-to-chord mapping
- **[Strumming](/about/strumming/)** - Strummer configuration
