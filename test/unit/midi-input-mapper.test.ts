/**
 * Tests for the MIDI input mapper.
 *
 * Verifies the 4-way midi.inputMode mapping (direct / majorScale / minorScale /
 * autoScale) used to translate held MIDI notes into the strummer's base
 * note set. Mirror of python/tests/unit/test_midi_input_mapper.py - keep in sync.
 */

import { describe, it, expect } from 'vitest';
import { mapMidiInputToStrummerNotes } from '../../src/core/midi-input-mapper.js';
import { Note, type NoteObject } from '../../src/models/note.js';

const parse = (s: string): NoteObject => Note.parseNotation(s);
const names = (notes: NoteObject[]): string[] =>
  notes.map((n) => `${n.notation}${n.octave}`);

describe('mapMidiInputToStrummerNotes', () => {
  describe('empty input', () => {
    it.each(['direct', 'majorScale', 'minorScale', 'autoScale'] as const)(
      'returns null for 0 notes in mode %s',
      (mode) => {
        expect(mapMidiInputToStrummerNotes([], mode)).toBeNull();
      }
    );
  });

  describe('direct mode', () => {
    it('returns the held notes as a pitch-sorted copy', () => {
      const result = mapMidiInputToStrummerNotes(
        [parse('G4'), parse('C4'), parse('E4')],
        'direct'
      );
      expect(result).not.toBeNull();
      expect(names(result!)).toEqual(['C4', 'E4', 'G4']);
    });

    it('returns a single held note', () => {
      const result = mapMidiInputToStrummerNotes([parse('A3')], 'direct');
      expect(names(result!)).toEqual(['A3']);
    });
  });

  describe('majorScale mode', () => {
    it('builds C major from lowest held note', () => {
      const result = mapMidiInputToStrummerNotes([parse('C4')], 'majorScale');
      expect(names(result!)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    });

    it('ignores additional held notes (uses only the lowest)', () => {
      const result = mapMidiInputToStrummerNotes(
        [parse('C4'), parse('Eb4'), parse('G4')],
        'majorScale'
      );
      expect(names(result!)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    });
  });

  describe('minorScale mode', () => {
    it('builds A natural minor from lowest held note', () => {
      const result = mapMidiInputToStrummerNotes([parse('A3')], 'minorScale');
      expect(names(result!)).toEqual(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4']);
    });

    it('ignores additional held notes (uses only the lowest)', () => {
      const result = mapMidiInputToStrummerNotes(
        [parse('A3'), parse('C4'), parse('E4')],
        'minorScale'
      );
      expect(names(result!)).toEqual(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4']);
    });
  });

  describe('autoScale mode', () => {
    it('1 note -> neutral [1, 2, 4, 5] from root (no 3rd)', () => {
      const result = mapMidiInputToStrummerNotes([parse('C4')], 'autoScale');
      // C, D, F, G
      expect(names(result!)).toEqual(['C4', 'D4', 'F4', 'G4']);
    });

    it('1 note neutral set crosses octaves correctly', () => {
      // A4 + intervals 0, 2, 5, 7 -> A4, B4, D5, E5
      const result = mapMidiInputToStrummerNotes([parse('A4')], 'autoScale');
      expect(names(result!)).toEqual(['A4', 'B4', 'D5', 'E5']);
    });

    it('2 notes with minor 3rd interval -> minor scale', () => {
      // C + Eb = minor 3rd -> C minor (C, D, Eb, F, G, Ab, Bb)
      const result = mapMidiInputToStrummerNotes(
        [parse('C4'), parse('Eb4')],
        'autoScale'
      );
      expect(names(result!)).toEqual(['C4', 'D4', 'D#4', 'F4', 'G4', 'G#4', 'A#4']);
    });

    it('2 notes with major 3rd interval -> major scale', () => {
      // C + E = major 3rd -> C major
      const result = mapMidiInputToStrummerNotes(
        [parse('C4'), parse('E4')],
        'autoScale'
      );
      expect(names(result!)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    });

    it('2 notes with non-3rd interval (5th) -> defaults to major', () => {
      // C + G = perfect 5th -> default major (current behavior; documented as
      // ambiguous in the mapper).
      const result = mapMidiInputToStrummerNotes(
        [parse('C4'), parse('G4')],
        'autoScale'
      );
      expect(names(result!)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    });

    it('uses lowest note as root regardless of input order', () => {
      const result = mapMidiInputToStrummerNotes(
        [parse('Eb4'), parse('C4')],
        'autoScale'
      );
      // C minor (lowest = C, interval to Eb = 3 semis)
      expect(names(result!)).toEqual(['C4', 'D4', 'D#4', 'F4', 'G4', 'G#4', 'A#4']);
    });

    it('>2 notes falls back to direct mapping', () => {
      const held = [parse('C4'), parse('Eb4'), parse('G4'), parse('Bb4')];
      const result = mapMidiInputToStrummerNotes(held, 'autoScale');
      // Falls back to direct -> sorted held notes verbatim (notation preserved)
      expect(names(result!)).toEqual(['C4', 'Eb4', 'G4', 'Bb4']);
    });
  });

  describe('unknown mode', () => {
    it('falls back to direct mapping rather than throwing', () => {
      const result = mapMidiInputToStrummerNotes(
        [parse('C4'), parse('E4')],
        // @ts-expect-error - exercising defensive default
        'someUnknownMode'
      );
      expect(names(result!)).toEqual(['C4', 'E4']);
    });
  });
});
