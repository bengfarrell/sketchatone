---
title: Scales & MIDI-Driven Mode
description: Use musical scales (instead of chord notes) as the tablet's strings, either via buttons, at startup, or driven by a MIDI keyboard
---

# Scales and MIDI-Driven Mode

By default Sketchatone lays out the tablet's "strings" from a chord (e.g. `Am` → A, C, E). You can instead use any scale's notes — major, minor, modes, pentatonic, blues, etc. — as the strings. Scales can be selected in three ways:

1. **At startup**, via a startup action rule (use this when you just want a fixed scale instead of a chord).
2. **From a button**, via the `set-strum-scale` action (switch scales live while playing).
3. **From a connected MIDI keyboard**, via [MIDI-Driven Scales](#midi-driven-scales-mode) (the scale follows the notes you hold).

In all three cases the strings are the scale's notes, expanded by your `upperNoteSpread` / `lowerNoteSpread` settings just like chord notes are.

## Scale Support

### Available Scales

Sketchatone includes a comprehensive set of scales:

**Common Scales:**
- `major` - Major scale (Ionian mode)
- `minor` - Natural minor scale (Aeolian mode)
- `harmonic-minor` - Harmonic minor scale
- `melodic-minor` - Melodic minor scale (ascending)

**Pentatonic Scales:**
- `major-pentatonic` - Major pentatonic
- `minor-pentatonic` - Minor pentatonic

**Modes:**
- `ionian` - Ionian mode (same as major)
- `dorian` - Dorian mode
- `phrygian` - Phrygian mode
- `lydian` - Lydian mode
- `mixolydian` - Mixolydian mode
- `aeolian` - Aeolian mode (same as natural minor)
- `locrian` - Locrian mode

**Other Scales:**
- `chromatic` - Chromatic scale (all 12 notes)
- `whole-tone` - Whole tone scale
- `blues` - Blues scale

### Scale Notation

Scales use the format: `root:scale-type`

Examples:
- `C:major` - C major scale
- `A:minor` - A minor scale
- `G:dorian` - G dorian mode
- `D:major-pentatonic` - D major pentatonic

Legacy format without colon is also supported: `Cmajor`, `Aminor`

---

## Setting a Scale Instead of a Chord

The strumming config (`strumming.chord` / `strumming.initial_notes`) has no `scale` field — scales are applied by running the `set-strum-scale` action. The simplest way to use a scale as your default string layout is to put `set-strum-scale` in `action_rules.startup_rules`, so it runs once on startup:

```json
{
  "strumming": {
    "midi_channel": 1,
    "upper_note_spread": 2,
    "lower_note_spread": 0
  },
  "action_rules": {
    "startup_rules": [
      {
        "id": "default-scale",
        "name": "C Major as default strings",
        "action": ["set-strum-scale", "C:major", 4]
      }
    ]
  }
}
```

When the server starts, this replaces the default chord-based strings with the C major scale, expanded by your `upper_note_spread` / `lower_note_spread`. Any `chord` or `initial_notes` set in `strumming` is overwritten by the startup action and is effectively ignored.

To change scales while playing, map `set-strum-scale` to buttons (see below).

---

## Manual Scale Selection

### Using the set-strum-scale Action

Map scales to buttons using action rules:

```json
{
  "action_rules": {
    "rules": [
      {
        "id": "c-major-scale",
        "name": "C Major",
        "button": "button:1",
        "action": ["set-strum-scale", "C:major", 4],
        "trigger": "press"
      },
      {
        "id": "a-minor-scale",
        "name": "A Minor",
        "button": "button:2",
        "action": ["set-strum-scale", "A:minor", 4],
        "trigger": "press"
      },
      {
        "id": "d-dorian",
        "name": "D Dorian",
        "button": "button:3",
        "action": ["set-strum-scale", "D:dorian", 4],
        "trigger": "press"
      }
    ]
  }
}
```

The action parameters are:
1. Scale notation (e.g., `"C:major"`)
2. Octave (optional, defaults to 4)

---

## MIDI-Driven Scales Mode

MIDI-Driven Scales mode automatically changes scales based on notes you hold on a connected MIDI keyboard.

### How It Works

When enabled, Sketchatone analyzes the notes held on your MIDI keyboard and automatically selects the appropriate scale:

- **1 note held** → Major scale at that root note
- **2+ notes with minor 3rd** → Minor scale at the root note
- **2+ notes with major 3rd** → Major scale at the root note

The lowest note held is always used as the root.

### Enabling MIDI-Driven Scales

**In the Web UI:**

1. Connect a MIDI keyboard (MIDI input)
2. In the Strumming Configuration section, find "MIDI-Driven Scales"
3. Toggle the switch to enable

**In Configuration File:**

```json
{
  "strumming": {
    "midiDrivenScales": true
  }
}
```

### Usage Examples

**Play C major scale:**
- Hold down C on your MIDI keyboard
- Strum the tablet → plays C major scale notes

**Play A minor scale:**
- Hold down A and C on your MIDI keyboard (A is root, C is the minor 3rd)
- Strum the tablet → plays A minor scale notes

**Switch scales on the fly:**
- While strumming, change which notes you hold
- The scale instantly adapts to your MIDI input

### Tips

- Works great with one hand on MIDI keyboard, one hand strumming the tablet
- Perfect for improvisation and exploration
- Combines well with note spread settings to create rich, full scales
- The MIDI keyboard only controls which scale is active - strumming still happens on the tablet

---

## Configuration Options

All scale features respect your global strumming configuration:

- **Note Spread** - Upper and lower spreads apply to scale notes
- **MIDI Channel** - Output channel for strummed notes
- **Note Duration** - Duration mapping applies to scale notes
- **Pitch Bend** - Y-axis pitch bend works with scales

Example configuration combining features:

```json
{
  "strumming": {
    "upperNoteSpread": 3,
    "lowerNoteSpread": 2,
    "midiDrivenScales": true
  }
}
```

This creates a 2-octave+ range that follows your MIDI keyboard input.
