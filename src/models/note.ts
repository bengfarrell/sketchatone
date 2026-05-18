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

  // Scale intervals (semitones from root)
  static scaleIntervals: Record<string, number[]> = {
    // Common scales
    major: [0, 2, 4, 5, 7, 9, 11], // Major scale (Ionian mode)
    minor: [0, 2, 3, 5, 7, 8, 10], // Natural minor scale (Aeolian mode)
    'harmonic-minor': [0, 2, 3, 5, 7, 8, 11], // Harmonic minor scale
    'melodic-minor': [0, 2, 3, 5, 7, 9, 11], // Melodic minor scale (ascending)

    // Pentatonic scales
    'major-pentatonic': [0, 2, 4, 7, 9], // Major pentatonic
    'minor-pentatonic': [0, 3, 5, 7, 10], // Minor pentatonic

    // Modes
    ionian: [0, 2, 4, 5, 7, 9, 11], // Ionian (same as major)
    dorian: [0, 2, 3, 5, 7, 9, 10], // Dorian mode
    phrygian: [0, 1, 3, 5, 7, 8, 10], // Phrygian mode
    lydian: [0, 2, 4, 6, 7, 9, 11], // Lydian mode
    mixolydian: [0, 2, 4, 5, 7, 9, 10], // Mixolydian mode
    aeolian: [0, 2, 3, 5, 7, 8, 10], // Aeolian (same as natural minor)
    locrian: [0, 1, 3, 5, 6, 8, 10], // Locrian mode

    // Other scales
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // Chromatic scale
    'whole-tone': [0, 2, 4, 6, 8, 10], // Whole tone scale
    blues: [0, 3, 5, 6, 7, 10], // Blues scale
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
   * Uses standard MIDI convention where C4 (middle C) = 60
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
    // Standard MIDI: C-1 = 0, C0 = 12, C1 = 24, ..., C4 (middle C) = 60
    return (noteObj.octave + 1) * this.sharpNotations.length + noteIndex;
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
   * Parse a scale notation into a list of notes.
   *
   * @param scaleNotation - Scale notation in format "root:scale-type" (e.g., "C:major", "Am:minor", "G:dorian")
   *                        Also accepts legacy format without colon (e.g., "Cmajor", "Aminor")
   * @param octave - Base octave for the root note (default: 4)
   * @returns List of NoteObject instances representing the scale
   */
  static parseScale(scaleNotation: string, octave = 4): NoteObject[] {
    // Parse the root note and scale type
    let root: string;
    let scaleType: string;

    // Check for colon separator first (preferred format: "C:major")
    if (scaleNotation.includes(':')) {
      const parts = scaleNotation.split(':');
      root = parts[0];
      scaleType = parts[1] || 'major';
    } else {
      // Legacy format without colon - extract root note (first 1-2 characters)
      if (scaleNotation.length >= 2 && ['#', 'b'].includes(scaleNotation[1])) {
        root = scaleNotation.slice(0, 2);
        scaleType = scaleNotation.slice(2);
      } else {
        root = scaleNotation[0];
        scaleType = scaleNotation.slice(1);
      }
    }

    // Default to major scale if no scale type specified
    if (!scaleType) {
      scaleType = 'major';
    }

    // Get the intervals for this scale type
    let intervals = this.scaleIntervals[scaleType];
    if (!intervals) {
      // Unknown scale type, default to major scale
      console.warn(`Unknown scale type '${scaleType}', defaulting to major scale`);
      intervals = this.scaleIntervals['major'];
    }

    // Parse the root note
    const rootNote = this.parseNotation(root + octave);
    const rootIndex = this.indexOfNotation(rootNote.notation);

    // Build the scale notes
    const scaleNotes: NoteObject[] = [];
    for (const interval of intervals) {
      const noteIndex = (rootIndex + interval) % 12;
      // Calculate which octave this note should be in
      const noteOctave = octave + Math.floor((rootIndex + interval) / 12);

      const notation = this.sharpNotations[noteIndex];
      scaleNotes.push(createNote(notation, noteOctave));
    }

    return scaleNotes;
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
   * Uses standard MIDI convention where C4 (middle C) = 60
   */
  static noteToMidi(note: NoteObject): number {
    let noteIndex = this.sharpNotations.indexOf(note.notation);
    if (noteIndex === -1) {
      noteIndex = this.flatNotations.indexOf(note.notation);
      if (noteIndex === -1) {
        noteIndex = 0;
      }
    }
    // Standard MIDI: C-1 = 0, C0 = 12, C1 = 24, ..., C4 (middle C) = 60
    return (note.octave + 1) * 12 + noteIndex;
  }

  /**
   * Convert a note to string representation
   */
  static noteToString(note: NoteObject): string {
    return `${note.notation}${note.octave}`;
  }

  /**
   * Analyze held MIDI notes and determine the appropriate scale.
   *
   * @param notes - Array of NoteObject instances representing currently held MIDI notes
   * @returns Object with root note and scale type, or null if no notes held
   */
  static analyzeNotesForScale(notes: NoteObject[]): { root: string; scaleType: string; octave: number } | null {
    if (notes.length === 0) {
      return null;
    }

    // Use the lowest note as the root
    const sortedNotes = [...notes].sort((a, b) => {
      const midiA = this.noteToMidi(a);
      const midiB = this.noteToMidi(b);
      return midiA - midiB;
    });

    const root = sortedNotes[0];
    const rootIndex = this.indexOfNotation(root.notation);

    // Single note - default to major scale
    if (notes.length === 1) {
      return {
        root: root.notation,
        scaleType: 'major',
        octave: root.octave
      };
    }

    // Multiple notes - analyze intervals to determine major or minor
    // Calculate semitone intervals from root
    const intervals: number[] = [];
    for (const note of sortedNotes) {
      const noteIndex = this.indexOfNotation(note.notation);
      let interval = noteIndex - rootIndex;
      if (interval < 0) interval += 12; // Wrap around
      intervals.push(interval);
    }

    // Check if we have a minor third (3 semitones) - indicates minor scale
    const hasMinorThird = intervals.includes(3);

    // Check if we have a major third (4 semitones) - indicates major scale
    const hasMajorThird = intervals.includes(4);

    // Determine scale type based on intervals
    let scaleType = 'major'; // Default
    if (hasMinorThird && !hasMajorThird) {
      scaleType = 'minor';
    } else if (hasMajorThird && !hasMinorThird) {
      scaleType = 'major';
    } else if (hasMinorThird && hasMajorThird) {
      // Both thirds present - could be a complex chord
      // Default to minor if minor third is closer to root in the sorted list
      const minorThirdIndex = sortedNotes.findIndex(n => {
        const noteIndex = this.indexOfNotation(n.notation);
        let interval = noteIndex - rootIndex;
        if (interval < 0) interval += 12;
        return interval === 3;
      });
      const majorThirdIndex = sortedNotes.findIndex(n => {
        const noteIndex = this.indexOfNotation(n.notation);
        let interval = noteIndex - rootIndex;
        if (interval < 0) interval += 12;
        return interval === 4;
      });
      scaleType = minorThirdIndex < majorThirdIndex ? 'minor' : 'major';
    }

    return {
      root: root.notation,
      scaleType,
      octave: root.octave
    };
  }
}
