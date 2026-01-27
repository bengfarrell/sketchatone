/**
 * Note Model
 *
 * Note utilities for chord parsing and music theory operations.
 * Ported from Python sketchatone/models/note.py
 */

/**
 * Represents a single note with notation, octave, and secondary flag
 */
export interface NoteObject {
  notation: string;
  octave: number;
  secondary: boolean;
}

/**
 * Create a new NoteObject
 */
export function createNote(
  notation: string,
  octave: number,
  secondary = false
): NoteObject {
  return { notation, octave, secondary };
}

/**
 * Note static class for music theory operations
 */
export class Note {
  // Cached key signature lookup table
  static keys: Record<string, unknown> = {};

  static commonNotations = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Incremental tones as sharp notation
  static sharpNotations = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Incremental tones as flat notation
  static flatNotations = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Odd notations
  static oddNotations = ['B#', 'Cb', 'E#', 'Fb'];

  // Corrected notations
  static correctedNotations = ['C', 'C', 'F', 'F'];

  // Chord intervals (semitones from root)
  static chordIntervals: Record<string, number[]> = {
    // Triads
    maj: [0, 4, 7], // Major triad
    min: [0, 3, 7], // Minor triad
    m: [0, 3, 7], // Minor triad (short form)
    dim: [0, 3, 6], // Diminished triad
    aug: [0, 4, 8], // Augmented triad
    sus2: [0, 2, 7], // Suspended 2nd
    sus4: [0, 5, 7], // Suspended 4th
    '5': [0, 7], // Power chord (root + fifth)

    // Seventh chords
    '7': [0, 4, 7, 10], // Dominant 7th
    maj7: [0, 4, 7, 11], // Major 7th
    min7: [0, 3, 7, 10], // Minor 7th
    m7: [0, 3, 7, 10], // Minor 7th (short form)
    dim7: [0, 3, 6, 9], // Diminished 7th
    aug7: [0, 4, 8, 10], // Augmented 7th
    maj9: [0, 4, 7, 11, 14], // Major 9th
    min9: [0, 3, 7, 10, 14], // Minor 9th
    m9: [0, 3, 7, 10, 14], // Minor 9th (short form)
    '9': [0, 4, 7, 10, 14], // Dominant 9th

    // Extended chords
    add9: [0, 4, 7, 14], // Major add 9
    '6': [0, 4, 7, 9], // Major 6th
    min6: [0, 3, 7, 9], // Minor 6th
    m6: [0, 3, 7, 9], // Minor 6th (short form)
  };

  /**
   * Get notation index when notation is either flat or sharp
   */
  static indexOfNotation(notation: string): number {
    let index = this.sharpNotations.indexOf(notation);
    if (index === -1) {
      index = this.flatNotations.indexOf(notation);
    }
    return index;
  }

  /**
   * Get notation given an index
   */
  static notationAtIndex(index: number, preferFlat = false): string {
    const normalizedIndex = index % this.sharpNotations.length;
    return preferFlat
      ? this.flatNotations[normalizedIndex]
      : this.sharpNotations[normalizedIndex];
  }

  /**
   * Translate index from MIDI to notation
   */
  static midiToNotation(index: number): string {
    const position = index % this.sharpNotations.length;
    return this.sharpNotations[position];
  }

  /**
   * Translate notation and octave to MIDI index
   */
  static notationToMidi(notation: string): number {
    const noteObj = this.parseNotation(notation);
    let noteIndex = this.sharpNotations.indexOf(noteObj.notation);
    if (noteIndex === -1) {
      noteIndex = this.flatNotations.indexOf(noteObj.notation);
      if (noteIndex === -1) {
        noteIndex = 0;
      }
    }
    return noteObj.octave * this.sharpNotations.length + noteIndex;
  }

  /**
   * Sort notes by octave and then by notation
   */
  static sort(notes: string[]): string[] {
    return [...notes].sort((a, b) => {
      const aOctave = a.slice(-1).match(/\d/) ? parseInt(a.slice(-1)) : 4;
      const bOctave = b.slice(-1).match(/\d/) ? parseInt(b.slice(-1)) : 4;
      const aNotation = a.slice(-1).match(/\d/) ? a.slice(0, -1) : a;
      const bNotation = b.slice(-1).match(/\d/) ? b.slice(0, -1) : b;

      let aIndex = this.sharpNotations.indexOf(aNotation);
      if (aIndex === -1) aIndex = 0;
      let bIndex = this.sharpNotations.indexOf(bNotation);
      if (bIndex === -1) bIndex = 0;

      if (aOctave !== bOctave) return aOctave - bOctave;
      return aIndex - bIndex;
    });
  }

  /**
   * Parse notation to notation and octave
   */
  static parseNotation(notation: string): NoteObject {
    // Only supports one digit octaves
    const octaveChar = notation.slice(-1);
    let octave: number;
    let noteNotation: string;

    if (/\d/.test(octaveChar)) {
      octave = parseInt(octaveChar);
      if (notation.length === 3) {
        noteNotation = notation.slice(0, 2);
      } else {
        noteNotation = notation[0];
      }
    } else {
      octave = 4; // default
      noteNotation = notation;
    }

    return createNote(noteNotation, octave);
  }

  /**
   * Parse a chord notation into a list of notes.
   *
   * @param chordNotation - Chord notation (e.g., "C", "Gm", "Am7", "Fmaj7", "Ddim", "Esus4")
   * @param octave - Base octave for the root note (default: 4)
   * @returns List of NoteObject instances representing the chord
   */
  static parseChord(chordNotation: string, octave = 4): NoteObject[] {
    // Parse the root note and chord type
    // Extract root note (first 1-2 characters)
    let root: string;
    let chordType: string;

    if (chordNotation.length >= 2 && ['#', 'b'].includes(chordNotation[1])) {
      root = chordNotation.slice(0, 2);
      chordType = chordNotation.slice(2);
    } else {
      root = chordNotation[0];
      chordType = chordNotation.slice(1);
    }

    // Default to major triad if no chord type specified
    if (!chordType) {
      chordType = 'maj';
    }

    // Get the intervals for this chord type
    let intervals = this.chordIntervals[chordType];
    if (!intervals) {
      // Unknown chord type, default to major triad
      intervals = this.chordIntervals['maj'];
    }

    // Parse the root note
    const rootNote = this.parseNotation(root + octave);
    const rootIndex = this.indexOfNotation(rootNote.notation);

    // Build the chord notes
    const chordNotes: NoteObject[] = [];
    for (const interval of intervals) {
      const noteIndex = (rootIndex + interval) % 12;
      // Calculate which octave this note should be in
      const noteOctave = octave + Math.floor((rootIndex + interval) / 12);

      const notation = this.sharpNotations[noteIndex];
      chordNotes.push(createNote(notation, noteOctave));
    }

    return chordNotes;
  }

  /**
   * Fill note spread with upper and lower notes
   */
  static fillNoteSpread(
    notes: NoteObject[],
    lowerSpread = 0,
    upperSpread = 0
  ): NoteObject[] {
    // If no notes provided, return empty list
    if (!notes.length) {
      return [];
    }

    const upper: NoteObject[] = [];
    for (let c = 0; c < upperSpread; c++) {
      const noteIndex = c % notes.length;
      const octaveIncrease = Math.floor(c / notes.length);
      upper.push(
        createNote(
          notes[noteIndex].notation,
          notes[noteIndex].octave + octaveIncrease + 1,
          true
        )
      );
    }

    const lower: NoteObject[] = [];
    for (let c = 0; c < lowerSpread; c++) {
      const noteIndex = c % notes.length;
      const octaveDecrease = Math.floor(c / notes.length);
      const reverseIndex = notes.length - 1 - noteIndex;
      lower.push(
        createNote(
          notes[reverseIndex].notation,
          notes[reverseIndex].octave - octaveDecrease - 1,
          true
        )
      );
    }

    // Combine and sort by pitch (MIDI note number)
    const combined = [...lower, ...notes, ...upper];
    combined.sort((a, b) => Note.noteToMidi(a) - Note.noteToMidi(b));
    return combined;
  }

  /**
   * Transpose a note by a given number of semitones
   */
  static transpose(note: NoteObject, semitones: number): NoteObject {
    if (semitones === 0) {
      return { ...note };
    }

    // Convert to MIDI note number
    let noteIndex = this.sharpNotations.indexOf(note.notation);
    if (noteIndex === -1) {
      noteIndex = this.flatNotations.indexOf(note.notation);
      if (noteIndex === -1) {
        noteIndex = 0;
      }
    }

    const midiNumber = note.octave * 12 + noteIndex;

    // Add semitones
    const transposedMidi = midiNumber + semitones;

    // Convert back to notation and octave
    const newOctave = Math.floor(transposedMidi / 12);
    const newNoteIndex = transposedMidi % 12;

    // Prefer to use the same notation style (sharp vs flat) as the original
    let newNotation: string;
    if (note.notation.includes('#')) {
      newNotation = this.sharpNotations[newNoteIndex];
    } else if (note.notation.includes('b')) {
      newNotation = this.flatNotations[newNoteIndex];
    } else {
      newNotation = this.sharpNotations[newNoteIndex];
    }

    return createNote(newNotation, newOctave, note.secondary);
  }

  /**
   * Convert a note to MIDI note number
   */
  static noteToMidi(note: NoteObject): number {
    let noteIndex = this.sharpNotations.indexOf(note.notation);
    if (noteIndex === -1) {
      noteIndex = this.flatNotations.indexOf(note.notation);
      if (noteIndex === -1) {
        noteIndex = 0;
      }
    }
    return note.octave * 12 + noteIndex;
  }

  /**
   * Convert a note to string representation
   */
  static noteToString(note: NoteObject): string {
    return `${note.notation}${note.octave}`;
  }
}
