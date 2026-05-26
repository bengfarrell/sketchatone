---
title: Slide Mode (Experimental)
description: Trombone-style continuous pitch bend across the tablet — hold a single note and slide
---

# Slide Mode (Experimental)

> **Experimental.** Slide mode is a new controller mode and the configuration surface may change. It depends on your destination synth respecting a wide pitch-bend range; if yours can't, the audible bend will saturate before reaching the next string.

Slide mode (sometimes called "trombone mode") is an alternative to the default Strum mode. Instead of triggering a new note each time the pen crosses a string boundary, the pen-down event triggers a **single** note that's held for the entire stroke. As you slide the pen across the tablet, the pitch bends continuously between the strings' pitches via piecewise linear interpolation, reaching each neighbouring string's exact pitch when the pen is over its center.

The result is a single, glissando-like sustained note — closer to a trombone or a fretless instrument than to a guitar strum.

## Enabling Slide Mode

Slide mode is selected by the top-level `mode` field in your strummer config:

```json
{
  "mode": "slide",
  "strumming": {
    "chord": "Am",
    "upper_note_spread": 2,
    "lower_note_spread": 1
  },
  "slide": {
    "pressure_threshold": 0.1,
    "max_bend_semitones": 24.0,
    "pressure_modulation": {
      "type": "aftertouch",
      "cc_number": 11,
      "min_value": 0,
      "max_value": 127
    }
  }
}
```

Valid values are `"strum"` (default) and `"slide"`. The string layout (notes/chord/scale, spreads, channel, `invert_x`) comes from your existing `strumming` block — slide mode only changes how the pen interacts with those strings.

In the web dashboard, the same switch is exposed as a **Mode** picker in the Strumming Settings panel.

## How It Works

| Phase | Behavior |
|---|---|
| Pen down on string *i* | `pitch_bend(0)` + `note_on(notes[i])`. That note is the **anchor** for the entire stroke. |
| Pen moves while held | `pitch_bend` updates only — the anchor note is never released until pen-up. |
| Pen up | `note_off(anchor)` + `pitch_bend(0)`. |

The bend is computed by **piecewise-linear interpolation** between the MIDI values of adjacent strings:

- When the pen sits exactly on a string's center, the bend equals that string's MIDI value minus the anchor's MIDI value, so the sounding pitch is correct at every string position.
- Between two string centers, the bend interpolates linearly between the two endpoint bends.
- Past the outermost string centers, the bend is clamped to those endpoint values.

The reported bend is also clamped to `±max_bend_semitones`, so if the layout asks for more bend than your synth supports, the slide will saturate at the edge of its range.

## Configuration Reference

The slide config lives in a top-level `slide` block.

| Property | Type | Default | Description |
|---|---|---|---|
| `pressure_threshold` | number | 0.1 | Minimum pressure to register pen-down (0–1). Same idea as the strumming threshold. |
| `max_bend_semitones` | number | 24.0 | Maximum signed bend in semitones. **Must match the synth's pitch-bend range** for the interpolation to reach exact neighbour pitches. |
| `pressure_modulation` | object | (see below) | Routes held-note pressure to channel aftertouch or a CC. |

### `pressure_modulation`

While a slide note is held, pressure changes can be sent as continuous MIDI to modulate timbre/volume on the synth.

| Property | Type | Default | Description |
|---|---|---|---|
| `type` | `"none"` \| `"aftertouch"` \| `"cc"` | `"aftertouch"` | What to send. `"none"` disables it. |
| `cc_number` | int | 11 | CC number used when `type` is `"cc"` (11 = Expression). |
| `min_value` | int | 0 | MIDI value at `pressure_threshold` (0–127). |
| `max_value` | int | 127 | MIDI value at pressure 1.0 (0–127). |

## Setting the Synth's Pitch Bend Range

Pitch bend over MIDI is a 14-bit value that gets scaled by the receiving instrument's bend-range setting. For the slide's interpolation to land exactly on each neighbouring string's pitch, **the synth's bend range must equal `max_bend_semitones`**. With the default of 24, your synth needs to be set to ±24 semitones.

Bend range is per-instrument/per-patch on most platforms and **rarely** defaults to a value this wide:

- **Ableton Live built-in instruments** (Operator, Wavetable, Sampler, Analog): set the per-instrument **PB Range** knob to 24.
- **MPC One+ / MPC Live**: set the program's **Pitch Bend Range** to 24.
- **VST/AU plugins inside any DAW** (Serum, Diva, Pianoteq, etc.): set the plugin's own pitch-bend range to 24. Defaults are usually 2.
- **Hardware synths**: consult the manual; many synths only let you set this per-patch.

If your synth caps out lower (e.g. ±12 or ±2), set `max_bend_semitones` in the slide config to match. You'll only get continuous bend up to that range and further pen movement will saturate at the edge.

> **Note:** Sketchatone does **not** automatically send a pitch-bend-range RPN message on note-on. Many DAWs and plugins ignore that message, so it's safer to configure the destination instrument manually.

## Pressure Modulation Examples

**Aftertouch (default)** — sends channel pressure as you press harder during a held slide:

```json
"pressure_modulation": { "type": "aftertouch", "min_value": 0, "max_value": 127 }
```

**CC 11 (Expression)** — useful for orchestral patches that map expression to volume/timbre:

```json
"pressure_modulation": { "type": "cc", "cc_number": 11, "min_value": 20, "max_value": 127 }
```

**Disabled** — held pressure does nothing:

```json
"pressure_modulation": { "type": "none" }
```

## Limitations & Notes

- Only one note sounds per stroke. To trigger different notes you must lift and re-strike.
- The visualizer still shows all string positions; sliding over them does not retrigger.
- Switching `mode` at runtime (via the dashboard) releases any held notes and resets both controllers.
- The slide config has no `midi_channel` of its own — it shares `strumming.midi_channel`.
- Scale-based string layouts (see [Scales & MIDI-Driven Mode](/about/scales-and-midi-driven-mode/)) work in slide mode too; the slide interpolation uses whatever notes are currently assigned as the strings.

## See Also

- **[Strumming](/about/strumming/)** — the default mode and how the string layout is built
- **[Scales & MIDI-Driven Mode](/about/scales-and-midi-driven-mode/)** — using scales as the string layout
- **[Pitch Bend](/about/pitch-bend/)** — pitch bend in the default Strum mode (a separate, per-note mapping)
- **[Configuration](/about/configuration-settings/)** — full config reference
