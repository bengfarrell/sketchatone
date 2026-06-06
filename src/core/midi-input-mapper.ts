/**
 * MIDI Input Mapper
 *
 * Translates a set of currently-held MIDI notes into the base note set that
 * the strummer should play, according to the configured input mode.
 *
 * This module owns the music-theory logic for MIDI -> strummer note mapping
 * and is intentionally isolated so the rule set can evolve without touching
 * the call sites in the browser, the Node CLI server, or any other consumer.
 *
 * The returned notes are *base* notes (pre-spread). Callers are responsible
 * for applying `Note.fillNoteSpread` (or equivalent) before assigning to
 * the strummer/slider, since spread is a layout concern, not a mapping one.
 *
 * Mirror of python/sketchatone/strummer/midi_input_mapper.py - keep in sync.
 */

import { Note, NoteObject } from '../models/note.js';
import type { MidiInputMode } from '../models/midi-strummer-config.js';

/**
 * Neutral 1-note scale used by `autoScale` when only a single note is held.
 * Intervals from the root: 1, 2, 4, 5 (root, whole tone, perfect 4th, perfect 5th).
 * No 3rd, 6th, or 7th — avoids committing to a major or minor tonality.
 */
const AUTO_SCALE_NEUTRAL_INTERVALS: readonly number[] = [0, 2, 5, 7];

/**
 * Map a list of held MIDI notes to the strummer's base notes.
 *
 * Behavior:
 *  - 0 notes held -> returns null (caller should leave current notes unchanged)
 *  - 'direct'     -> returns the held notes as-is (sorted by pitch)
 *  - 'majorScale' -> 7-note major scale rooted at the lowest held note
 *  - 'minorScale' -> 7-note natural minor scale rooted at the lowest held note
 *  - 'autoScale'  -> 1 note  : neutral [1, 2, 4, 5] from the held note
 *                    2 notes : major or minor scale (minor 3rd interval -> minor)
 *                    >2 notes: falls back to 'direct'
 *
 * @param midiNotes Currently held MIDI notes (parsed NoteObjects).
 * @param mode      Mapping mode from `config.midi.inputMode`.
 * @returns         Base notes (pre-spread), or null when no change should be applied.
 */
export function mapMidiInputToStrummerNotes(
  midiNotes: NoteObject[],
  mode: MidiInputMode,
): NoteObject[] | null {
  if (midiNotes.length === 0) {
    return null;
  }

  // Always work from a pitch-sorted copy so "lowest" is well-defined.
  const sorted = [...midiNotes].sort((a, b) => Note.noteToMidi(a) - Note.noteToMidi(b));
  const root = sorted[0];

  switch (mode) {
    case 'direct':
      return sorted;

    case 'majorScale':
      return Note.parseScale(`${root.notation}:major`, root.octave);

    case 'minorScale':
      return Note.parseScale(`${root.notation}:minor`, root.octave);

    case 'autoScale':
      return mapAutoScale(sorted, root);

    default:
      // Unknown mode - fail safe to direct rather than throwing
      return sorted;
  }
}

/**
 * autoScale branch:
 *   1 note  -> neutral 4-note set [root, +2, +5, +7] (no 3rd)
 *   2 notes -> major or minor scale, decided by the interval from the root
 *   >2 notes -> fall back to direct mapping
 */
function mapAutoScale(sorted: NoteObject[], root: NoteObject): NoteObject[] {
  if (sorted.length === 1) {
    return buildIntervalSet(root, AUTO_SCALE_NEUTRAL_INTERVALS);
  }

  if (sorted.length === 2) {
    const scaleType = detectScaleTypeFromInterval(root, sorted[1]);
    return Note.parseScale(`${root.notation}:${scaleType}`, root.octave);
  }

  return sorted;
}

/**
 * Decide major vs. minor from the interval between root and the second note.
 *
 * Uses the same rule as `Note.analyzeNotesForScale`: an interval of 3
 * semitones (a minor 3rd) implies minor. Any other interval (including
 * intervals that are not thirds at all, e.g. a 5th) defaults to major.
 *
 * Note: this is intentionally simple. A perfect 5th, for example, does not
 * really commit to either tonality — extending this with a "still neutral"
 * fallback can happen here without touching call sites.
 */
function detectScaleTypeFromInterval(root: NoteObject, other: NoteObject): 'major' | 'minor' {
  const rootIndex = Note.indexOfNotation(root.notation);
  const otherIndex = Note.indexOfNotation(other.notation);
  let interval = otherIndex - rootIndex;
  if (interval < 0) interval += 12;
  return interval === 3 ? 'minor' : 'major';
}

/**
 * Build a list of NoteObjects from a root and a list of semitone intervals.
 * Handles octave wrap when an interval crosses the 12-semitone boundary.
 */
function buildIntervalSet(root: NoteObject, intervals: readonly number[]): NoteObject[] {
  const rootIndex = Note.indexOfNotation(root.notation);
  const result: NoteObject[] = [];
  for (const interval of intervals) {
    const noteIndex = (rootIndex + interval) % 12;
    const octave = root.octave + Math.floor((rootIndex + interval) / 12);
    result.push({
      notation: Note.sharpNotations[noteIndex],
      octave,
      secondary: false,
    });
  }
  return result;
}
