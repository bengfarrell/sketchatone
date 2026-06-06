"""
MIDI Input Mapper

Translates a set of currently-held MIDI notes into the base note set that
the strummer should play, according to the configured input mode.

This module owns the music-theory logic for MIDI -> strummer note mapping
and is intentionally isolated so the rule set can evolve without touching
the call sites in the CLI server or any other consumer.

The returned notes are *base* notes (pre-spread). Callers are responsible
for applying ``Note.fill_note_spread`` (or equivalent) before assigning to
the strummer/slider, since spread is a layout concern, not a mapping one.

Mirror of src/core/midi-input-mapper.ts - keep in sync.
"""

from typing import List, Optional, Sequence

from ..models.note import Note, NoteObject
from ..models.midi_config import MidiInputMode


# Neutral 1-note scale used by ``autoScale`` when only a single note is held.
# Intervals from the root: root, whole tone, perfect 4th, perfect 5th.
# No 3rd, 6th, or 7th - avoids committing to a major or minor tonality.
_AUTO_SCALE_NEUTRAL_INTERVALS: Sequence[int] = (0, 2, 5, 7)


def map_midi_input_to_strummer_notes(
    midi_notes: List[NoteObject],
    mode: MidiInputMode,
) -> Optional[List[NoteObject]]:
    """
    Map a list of held MIDI notes to the strummer's base notes.

    Behavior:
      - 0 notes held -> returns None (caller should leave current notes unchanged)
      - 'direct'     -> returns the held notes as-is (sorted by pitch)
      - 'majorScale' -> 7-note major scale rooted at the lowest held note
      - 'minorScale' -> 7-note natural minor scale rooted at the lowest held note
      - 'autoScale'  -> 1 note  : neutral [1, 2, 4, 5] from the held note
                        2 notes : major or minor scale (minor 3rd interval -> minor)
                        >2 notes: falls back to 'direct'

    Args:
        midi_notes: Currently held MIDI notes (parsed NoteObjects).
        mode: Mapping mode from ``config.midi.input_mode``.

    Returns:
        Base notes (pre-spread), or None when no change should be applied.
    """
    if not midi_notes:
        return None

    # Always work from a pitch-sorted copy so "lowest" is well-defined.
    sorted_notes = sorted(midi_notes, key=lambda n: n.to_midi())
    root = sorted_notes[0]

    if mode == 'direct':
        return sorted_notes

    if mode == 'majorScale':
        return Note.parse_scale(f'{root.notation}:major', root.octave)

    if mode == 'minorScale':
        return Note.parse_scale(f'{root.notation}:minor', root.octave)

    if mode == 'autoScale':
        return _map_auto_scale(sorted_notes, root)

    # Unknown mode - fail safe to direct rather than raising.
    return sorted_notes


def _map_auto_scale(sorted_notes: List[NoteObject], root: NoteObject) -> List[NoteObject]:
    """
    autoScale branch:
      1 note  -> neutral 4-note set [root, +2, +5, +7] (no 3rd)
      2 notes -> major or minor scale, decided by the interval from the root
      >2 notes -> fall back to direct mapping
    """
    if len(sorted_notes) == 1:
        return _build_interval_set(root, _AUTO_SCALE_NEUTRAL_INTERVALS)

    if len(sorted_notes) == 2:
        scale_type = _detect_scale_type_from_interval(root, sorted_notes[1])
        return Note.parse_scale(f'{root.notation}:{scale_type}', root.octave)

    return sorted_notes


def _detect_scale_type_from_interval(root: NoteObject, other: NoteObject) -> str:
    """
    Decide major vs. minor from the interval between root and the second note.

    Uses the same rule as ``Note.analyze_notes_for_scale``: an interval of 3
    semitones (a minor 3rd) implies minor. Any other interval (including
    intervals that are not thirds at all, e.g. a 5th) defaults to major.

    Note: this is intentionally simple. A perfect 5th, for example, does not
    really commit to either tonality - extending this with a "still neutral"
    fallback can happen here without touching call sites.
    """
    root_index = Note.index_of_notation(root.notation)
    other_index = Note.index_of_notation(other.notation)
    interval = other_index - root_index
    if interval < 0:
        interval += 12
    return 'minor' if interval == 3 else 'major'


def _build_interval_set(root: NoteObject, intervals: Sequence[int]) -> List[NoteObject]:
    """
    Build a list of NoteObjects from a root and a list of semitone intervals.
    Handles octave wrap when an interval crosses the 12-semitone boundary.
    """
    root_index = Note.index_of_notation(root.notation)
    result: List[NoteObject] = []
    for interval in intervals:
        note_index = (root_index + interval) % 12
        octave = root.octave + (root_index + interval) // 12
        result.append(NoteObject(
            notation=Note.sharp_notations[note_index],
            octave=octave,
        ))
    return result
