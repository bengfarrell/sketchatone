---
title: Chord Modes
description: Consistent harmonic layouts for keypad-based chord control
---

# Chord Modes

Chord modes solve a specific problem: when each song maps different chords to the same physical buttons, you build no muscle memory and have to re-learn the layout for every song.

The alternative is to assign each button a **harmonic function** — a Roman numeral scale degree — and let a **transpose control** handle the key. The physical gesture for a I–V–vi–IV progression is then the same whether you're playing in C, G, or Eb. The chords change; your fingers don't.

`chordModes` defines what chord *quality* plays at each scale degree for a given mode. The transpose setting determines the actual root.

## How It Works

Each mode is an array of 9 objects, one per button. Each object has a `degree` (Roman numeral) and a `quality` (the chord suffix used in [Chord Notation](/about/chords-and-progressions/#chord-notation)):

```json
"chordModes": {
  "major": [
    { "degree": "vi",  "quality": "m"  },
    { "degree": "ii",  "quality": "m"  },
    { "degree": "V/V", "quality": "7"  },
    { "degree": "IV",  "quality": ""   },
    { "degree": "I",   "quality": ""   },
    { "degree": "bVII","quality": ""   },
    { "degree": "iii", "quality": "m"  },
    { "degree": "V",   "quality": ""   },
    { "degree": "vii", "quality": "dim"}
  ]
}
```

**Array position = button number.** Index 0 is button 1, index 1 is button 2, and so on up to index 8 = button 9. This makes the keypad layout explicit and readable directly from the config.

In C with `major` mode: button 5 (index 4, degree `I`, quality `""`) produces a C major triad. Transposing to G, the same button produces G major. The finger movement never changes.

## 3×3 Keypad Layout

All diatonic modes (major, minor, jazz) follow the same positional logic, placing the tonic at center and dominant tension above it. This mirrors a standard numeric keypad:

```
[ 7 ]  [ 8 ]  [ 9 ]
[ 4 ]  [ 5 ]  [ 6 ]
[ 1 ]  [ 2 ]  [ 3 ]
```

- **Button 5 is always home** (I or i). Anchor your hand here.
- **Button 8 is always dominant** (V or v). Moving 8 → 5 is the universal tension-to-resolution gesture, in any key, in any song.
- **Buttons 6 and 3 are extension slots** — the two positions reserved for the most common chords that fall outside the diatonic seven.

The I–V–vi–IV pop progression (the basis of hundreds of songs) is always **5 → 8 → 1 → 4**, regardless of key or mode.

## Modes

### Major

```
[ 7 ] iii    [ 8 ] V      [ 9 ] vii°
[ 4 ] IV     [ 5 ] I      [ 6 ] ♭VII
[ 1 ] vi     [ 2 ] ii     [ 3 ] V/V
```

| Button | Degree | Quality | In C  | Notes |
|--------|--------|---------|-------|-------|
| 1 | vi   | minor | Am   | Submediant / relative minor |
| 2 | ii   | minor | Dm   | Supertonic |
| 3 | V/V  | dom7  | D7   | Secondary dominant — pulls toward V |
| 4 | IV   | major | F    | Subdominant |
| 5 | I    | major | C    | Tonic — home |
| 6 | ♭VII | major | B♭   | Borrowed from parallel minor — ubiquitous in rock |
| 7 | iii  | minor | Em   | Mediant |
| 8 | V    | major | G    | Dominant |
| 9 | vii° | dim   | Bdim | Leading tone |

`♭VII` at button 6 appears so often in rock and pop it earns a permanent slot rather than being treated as a breakout. `V/V` at button 3 adds unexpected momentum toward the dominant — common in gospel and classic pop.

### Minor

Natural minor scale. The two extension slots cover the most common departures from natural minor:

```
[ 7 ] III    [ 8 ] v      [ 9 ] VII
[ 4 ] iv     [ 5 ] i      [ 6 ] V
[ 1 ] VI     [ 2 ] ii°    [ 3 ] IV
```

| Button | Degree | Quality | In Am | Notes |
|--------|--------|---------|-------|-------|
| 1 | VI  | major | F    | Submediant |
| 2 | ii° | dim   | Bdim | Supertonic diminished |
| 3 | IV  | major | D    | Dorian borrowed IV — major subdominant, adds brightness |
| 4 | iv  | minor | Dm   | Subdominant |
| 5 | i   | minor | Am   | Tonic — home |
| 6 | V   | major | E    | Harmonic minor dominant — raised leading tone |
| 7 | III | major | C    | Mediant |
| 8 | v   | minor | Em   | Natural minor dominant (no leading tone) |
| 9 | VII | major | G    | Subtonic |

Button 6 (`V`) is the harmonic minor dominant: the raised 7th degree creates a leading tone that pulls back to the tonic. It's the `E` chord you'll notice at the end of minor progressions in the default config. Button 3 (`IV`) borrows the major subdominant from the parallel major — the Dorian brightness common in soul and R&B.

### Jazz

Same button positions as major, all chords voiced as 7ths:

```
[ 7 ] iii7      [ 8 ] V7       [ 9 ] vii7
[ 4 ] IVmaj7    [ 5 ] Imaj7    [ 6 ] ♭VIImaj7
[ 1 ] vi7       [ 2 ] ii7      [ 3 ] V/V7
```

| Button | Degree | Quality | In C     |
|--------|--------|---------|----------|
| 1 | vi   | m7   | Am7    |
| 2 | ii   | m7   | Dm7    |
| 3 | V/V  | 7    | D7     |
| 4 | IV   | maj7 | Fmaj7  |
| 5 | I    | maj7 | Cmaj7  |
| 6 | ♭VII | maj7 | B♭maj7 |
| 7 | iii  | m7   | Em7    |
| 8 | V    | 7    | G7     |
| 9 | vii  | m7   | Bm7    |

The same physical layout as major — switching between major and jazz modes changes the chord quality at each button without moving your hand. Note: button 9 uses `m7` (Bm7 in C) rather than the strictly correct `m7♭5` — consistent with the existing progressions in this project.

### Blues

Blues doesn't follow the diatonic degree model — all three core chords use dominant 7ths regardless of scale position. The layout keeps I7 at center and clusters the core three chords ergonomically, with 9th extensions adjacent and minor-color chords at the corners:

```
[ 7 ] V9     [ 8 ] V7     [ 9 ] ♭VII
[ 4 ] IV7    [ 5 ] I7     [ 6 ] I9
[ 1 ] i      [ 2 ] IV9    [ 3 ] iv
```

| Button | Degree | Quality | In C | Notes |
|--------|--------|---------|------|-------|
| 1 | i    | minor | Cm | Minor tonic color |
| 2 | IV   | 9     | F9 | Subdominant 9th |
| 3 | iv   | minor | Fm | Minor subdominant color |
| 4 | IV   | 7     | F7 | Core subdominant |
| 5 | I    | 7     | C7 | Core tonic — home |
| 6 | I    | 9     | C9 | Tonic 9th extension |
| 7 | V    | 9     | G9 | Dominant 9th extension |
| 8 | V    | 7     | G7 | Core dominant |
| 9 | ♭VII | major | B♭ | Turnaround / passing chord |

The 12-bar core (I7 → IV7 → V7) is always buttons **5 → 4 → 8**. The minor tonic and minor subdominant at the bottom corners add the darker, more plaintive character of minor blues.

### Power

Power chords (5ths only, no thirds) don't follow diatonic rules — any chromatic root is valid. The layout arranges the 9 most common positions ascending from the root, making the physical movement predictable:

```
[ 7 ] ♭VI5   [ 8 ] ♭VII5   [ 9 ] VII5
[ 4 ] ♭III5  [ 5 ] IV5     [ 6 ] V5
[ 1 ] I5     [ 2 ] ♭II5    [ 3 ] II5
```

| Button | Degree | In C  |
|--------|--------|-------|
| 1 | I    | C5  |
| 2 | ♭II  | D♭5 |
| 3 | II   | D5  |
| 4 | ♭III | E♭5 |
| 5 | IV   | F5  |
| 6 | V    | G5  |
| 7 | ♭VI  | A♭5 |
| 8 | ♭VII | B♭5 |
| 9 | VII  | B5  |

Pitch ascends left-to-right and bottom-to-top. The common rock move I → IV → V is **1 → 5 → 6**. The flat degrees (♭III, ♭VI, ♭VII) are the backbone of rock and metal riffing. ♭II appears in Phrygian-influenced metal and flamenco-influenced rock.

## Why Not Just Use Chord Progressions?

Chord progressions (see [Chords & Progressions](/about/chords-and-progressions/)) remain fully supported and are the right tool for song-specific sequences. Chord modes address a different need:

- **Progressions** = a fixed ordered list of chords for a specific song or section
- **Chord modes** = a positional layout where each button always means the same harmonic thing, and you choose the sequence while playing

Use progressions when you want to lock in a song's exact chord order. Use chord modes when you want the freedom to play any chord at any time without re-mapping buttons between songs.

## See Also

- **[Chords & Progressions](/about/chords-and-progressions/)** — Song-specific chord lists
- **[Action Rules](/about/action-rules/)** — Mapping buttons to chord changes
