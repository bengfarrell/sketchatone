---
title: Strum Release
description: Trigger a MIDI note when releasing a strum
---

# Strum Release

The strum release feature triggers a specific MIDI note when you lift the pen after a quick strum. This is useful for adding percussive hits or accents.

## Configuration

```json
{
  "strum_release": {
    "active": false,
    "midi_note": 38,
    "midi_channel": null,
    "max_duration": 0.25,
    "velocity_multiplier": 1.0
  }
}
```

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `active` | boolean | false | Enable strum release |
| `midi_note` | number | 38 | MIDI note to send (38 = snare drum) |
| `midi_channel` | number\|null | null | Channel (null = same as strummer) |
| `max_duration` | number | 0.25 | Max strum duration to trigger (seconds) |
| `velocity_multiplier` | number | 1.0 | Velocity scale factor |

## How It Works

1. Touch the tablet and strum
2. Lift the pen within `max_duration` seconds
3. The configured MIDI note is triggered
4. Velocity is based on your strum pressure × `velocity_multiplier`

If you hold the pen down longer than `max_duration`, no release note is sent. This prevents accidental triggers during sustained playing.

## Example: Snare Accent

Add a snare hit on quick strums:

```json
{
  "strum_release": {
    "active": true,
    "midi_note": 38,
    "max_duration": 0.2,
    "velocity_multiplier": 0.8
  }
}
```

## Example: Hi-Hat

Trigger a hi-hat on release:

```json
{
  "strum_release": {
    "active": true,
    "midi_note": 42,
    "midi_channel": 9,
    "max_duration": 0.15
  }
}
```

## Common MIDI Drum Notes

| Note | Drum |
|------|------|
| 35 | Acoustic Bass Drum |
| 36 | Bass Drum 1 |
| 38 | Acoustic Snare |
| 42 | Closed Hi-Hat |
| 46 | Open Hi-Hat |
| 49 | Crash Cymbal |

## See Also

- **[Strumming](/about/strumming/)** - Core strumming configuration
- **[Note Velocity](/about/note-velocity/)** - Velocity control
