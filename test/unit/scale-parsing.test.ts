/**
 * Tests for scale parsing and MIDI-driven scale detection
 */

import { describe, it, expect } from 'vitest';
import { Note, createNote } from '../../src/models/note.js';

describe('Note.parseScale', () => {
  it('should parse C major scale', () => {
    const notes = Note.parseScale('C:major', 4);
    expect(notes).toHaveLength(7);
    expect(notes.map(n => n.notation)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(notes.every(n => n.octave === 4 || n.octave === 5)).toBe(true);
  });

  it('should parse A minor scale', () => {
    const notes = Note.parseScale('A:minor', 4);
    expect(notes).toHaveLength(7);
    expect(notes.map(n => n.notation)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('should parse G dorian scale', () => {
    const notes = Note.parseScale('G:dorian', 4);
    expect(notes).toHaveLength(7);
    expect(notes[0].notation).toBe('G');
  });

  it('should parse major pentatonic scale', () => {
    const notes = Note.parseScale('C:major-pentatonic', 4);
    expect(notes).toHaveLength(5);
    expect(notes.map(n => n.notation)).toEqual(['C', 'D', 'E', 'G', 'A']);
  });

  it('should default to major scale if type not specified', () => {
    const notes = Note.parseScale('C', 4);
    expect(notes).toHaveLength(7);
    expect(notes.map(n => n.notation)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('should handle sharps and flats', () => {
    const notes = Note.parseScale('F#:major', 4);
    expect(notes).toHaveLength(7);
    expect(notes[0].notation).toBe('F#');
  });
});

describe('Note.analyzeNotesForScale', () => {
  it('should return null for empty array', () => {
    const result = Note.analyzeNotesForScale([]);
    expect(result).toBeNull();
  });

  it('should detect major scale from single note', () => {
    const notes = [createNote('C', 4)];
    const result = Note.analyzeNotesForScale(notes);
    expect(result).toEqual({
      root: 'C',
      scaleType: 'major',
      octave: 4
    });
  });

  it('should detect minor scale from root + minor third', () => {
    const notes = [
      createNote('A', 4),  // Root
      createNote('C', 5)   // Minor third (3 semitones up)
    ];
    const result = Note.analyzeNotesForScale(notes);
    expect(result).toEqual({
      root: 'A',
      scaleType: 'minor',
      octave: 4
    });
  });

  it('should detect major scale from root + major third', () => {
    const notes = [
      createNote('C', 4),  // Root
      createNote('E', 4)   // Major third (4 semitones up)
    ];
    const result = Note.analyzeNotesForScale(notes);
    expect(result).toEqual({
      root: 'C',
      scaleType: 'major',
      octave: 4
    });
  });

  it('should use lowest note as root', () => {
    const notes = [
      createNote('E', 4),
      createNote('C', 4),  // Lowest - should be root
      createNote('G', 4)
    ];
    const result = Note.analyzeNotesForScale(notes);
    expect(result?.root).toBe('C');
  });

  it('should detect minor from Am chord (A-C-E)', () => {
    const notes = [
      createNote('A', 4),
      createNote('C', 5),
      createNote('E', 5)
    ];
    const result = Note.analyzeNotesForScale(notes);
    expect(result?.scaleType).toBe('minor');
  });

  it('should detect major from C chord (C-E-G)', () => {
    const notes = [
      createNote('C', 4),
      createNote('E', 4),
      createNote('G', 4)
    ];
    const result = Note.analyzeNotesForScale(notes);
    expect(result?.scaleType).toBe('major');
  });
});
