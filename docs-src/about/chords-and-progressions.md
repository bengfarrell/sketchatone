---
title: Chords & Progressions
description: Supported chord types and common progressions
---

# Chords & Progressions

Sketchatone supports a wide variety of chord types. Chord progressions are defined in the configuration file (`chordProgressions` section).

**Note:** Starting in v0.3.0, chord progressions are no longer hardcoded. All progressions must be defined in your configuration file. See `public/configs/default.json` for standard progressions.

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

## Standard Progressions

The default configuration (`public/configs/default.json`) includes these standard progressions:

### Pop/Rock

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `c-major-pop` | C | C, G, Am, F | I-V-vi-IV |
| `g-major-pop` | G | G, D, Em, C | I-V-vi-IV |
| `d-major-pop` | D | D, A, Bm, G | I-V-vi-IV |
| `a-major-pop` | A | A, E, F#m, D | I-V-vi-IV |
| `rock-classic` | E | E, A, D, B | Classic rock |
| `rock-power` | E | E5, G5, A5, C5, D5 | Power chords |

### Minor Key

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `a-minor-pop` | Am | Am, F, C, G | i-VI-III-VII |
| `e-minor-pop` | Em | Em, C, G, D | i-VI-III-VII |
| `a-minor-sad` | Am | Am, Em, F, C, G, Dm, E | Extended minor |
| `d-minor-pop` | Dm | Dm, Bb, F, C, A | i-VI-III-VII |

### Jazz

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `c-major-jazz` | C | Cmaj7, Dm7, Em7, Fmaj7, G7, Am7, Bm7 | Diatonic 7ths |
| `jazz-251-c` | C | Dm7, G7, Cmaj7, Em7, A7 | II-V-I in C |
| `jazz-251-f` | F | Gm7, C7, Fmaj7, Am7, D7 | II-V-I in F |

### Blues

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `blues-e` | E | E7, A7, B7 | 12-bar blues |
| `blues-a` | A | A7, D7, E7 | 12-bar blues |
| `blues-g` | G | G7, C7, D7 | 12-bar blues |

### Gospel

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `gospel-c` | C | C, Am7, Dm7, G7, F | Gospel progression |
| `gospel-g` | G | G, Em7, Am7, D7, C | Gospel progression |

### Classic

| Preset | Key | Chords | Progression |
|--------|-----|--------|-------------|
| `c-major-50s` | C | C, Am, F, G | I-vi-IV-V |

**Note:** These progressions are examples from `public/configs/default.json`. You can customize, remove, or add your own progressions in your configuration file.

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

## Defining Chord Progressions

Define chord progressions in the configuration file using the `chordProgressions` field. All progressions must be defined in the config - there are no built-in presets.

### Adding Progressions

Add a `chordProgressions` object at the root level of your configuration:

```json
{
  "chordProgressions": {
    "my-custom-song": ["Am", "F", "C", "G"],
    "my-jazz-tune": ["Cmaj7", "Am7", "Dm7", "G7"],
    "my-blues": ["A7", "D7", "E7", "A7"],
    "c-major-pop": ["C", "G", "Am", "F"]
  }
}
```

You can start with the progressions from `public/configs/default.json` and customize them for your needs.

### Using Progressions

Reference your progressions by name in action rules:

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

- Progression names can use any string (e.g., `"my-song"`, `"verse-1"`, `"chorus"`)
- Each progression is an array of chord notations
- You can have any number of chords in a progression
- All standard chord notations are supported (see [Chord Notation](#chord-notation) above)
- If a progression used in an action rule is not defined, the action will fail
- Copy progressions from `public/configs/default.json` as a starting point

## See Also

- **[Action Rules](/about/action-rules/)** - Button-to-chord mapping
- **[Strumming](/about/strumming/)** - Strummer configuration
