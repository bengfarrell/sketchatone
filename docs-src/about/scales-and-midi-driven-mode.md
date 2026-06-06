---
title: Scales & MIDI-Driven Mode
description: Use musical scales (instead of chord notes) as the tablet's strings, either via buttons, at startup, or driven by a MIDI keyboard
---

# Scales and MIDI-Driven Mode

By default Sketchatone lays out the tablet's "strings" from a chord (e.g. `Am` → A, C, E). You can instead use any scale's notes — major, minor, modes, pentatonic, blues, etc. — as the strings. Scales can be selected in three ways:

1. **At startup**, via a startup action rule (use this when you just want a fixed scale instead of a chord). Works everywhere.
2. **From a button**, via the `set-strum-scale` action (switch scales live while playing). Works everywhere.
3. **From a connected MIDI keyboard**, via the [MIDI Input Mode](#midi-input-mode) selector (the strings follow the notes you hold, optionally expanded into a major/minor scale).

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

## MIDI Input Mode

When a MIDI keyboard is connected, the **MIDI Input Mode** selector controls how the notes you hold are translated into the strummer's strings. The selector lives on the **MIDI Input** panel in both the dashboard and the standalone webapp, and is also available headlessly as `midi.inputMode` in the config. It works in the browser webapp, the Node.js CLI server, and the Python CLI server.

In every mode, the resulting base notes are then expanded by your `upperNoteSpread` / `lowerNoteSpread` settings, the same as chord notes are.

### Modes

| Mode | Behavior |
|---|---|
| `direct` *(default)* | 1:1 mapping — the held MIDI notes become the strings, sorted by pitch. |
| `majorScale` | Always builds a major scale rooted at the lowest held note. Additional held notes are ignored. |
| `minorScale` | Always builds a natural minor scale rooted at the lowest held note. Additional held notes are ignored. |
| `autoScale` | Picks a scale from what you're holding: see below. |

**Auto Scale logic:**

- **1 note held** → neutral set `[root, 2nd, 4th, 5th]` (no 3rd, no 6th, no 7th — tonality stays ambiguous).
- **2 notes held** → if the interval is a minor 3rd, build a minor scale from the lower note; otherwise build a major scale from the lower note.
- **More than 2 notes held** → falls back to `direct` (your chord voicing becomes the strings).

**Common rules across all modes:**

- The **lowest** held note is always treated as the root.
- When **no** notes are held, the current strings are left in place — nothing changes until you press a new note.

### Enabling

**In the Web UI:**

1. Connect a MIDI keyboard (MIDI input).
2. Open the **MIDI Input** panel.
3. Use the **Input Mode** picker to choose `Direct`, `Major Scale`, `Minor Scale`, or `Auto Scale`.

**In a configuration file (TypeScript / browser / Node):**

```json
{
  "midi": {
    "inputMode": "autoScale"
  }
}
```

**In a configuration file (Python CLI):**

```json
{
  "midi": {
    "input_mode": "autoScale"
  }
}
```

### Usage Examples

**Direct mode — chord voicings as strings:**
- Hold C, E, G on your MIDI keyboard.
- Strum the tablet → plays C, E, G (in pitch order).

**Major Scale mode — fixed quality:**
- Hold C on your MIDI keyboard.
- Strum the tablet → plays the C major scale.
- Move to D → plays the D major scale, regardless of what else you hold.

**Minor Scale mode — fixed quality:**
- Hold A on your MIDI keyboard.
- Strum the tablet → plays the A natural minor scale.

**Auto Scale mode — let the interval decide:**
- Hold C alone → neutral set (C, D, F, G) — works over major or minor backing.
- Hold A + C (minor 3rd) → A minor scale.
- Hold C + E (major 3rd) → C major scale.
- Hold C + E + G → falls back to direct (C, E, G as strings).

### Tips

- Works great with one hand on the MIDI keyboard and one hand strumming the tablet.
- `autoScale` is good for exploration; `majorScale` / `minorScale` are good when you've already committed to a key.
- Combines well with `upperNoteSpread` / `lowerNoteSpread` to build a rich, multi-octave string layout from just one or two held notes.
- The MIDI keyboard only controls which notes are on the strings — strumming still happens on the tablet.

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
    "lowerNoteSpread": 2
  },
  "midi": {
    "inputMode": "autoScale"
  }
}
```

This creates a 2-octave+ range that follows your MIDI keyboard input.
