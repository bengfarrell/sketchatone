/**
 * Unit Tests for Strum Event Viewer CLI
 *
 * Tests for the strum_event_viewer module including:
 * - Helper functions (createBar, formatNote, printStrummerInfo)
 * - StrumEventViewer class initialization and configuration
 * - Packet handling and strum event processing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createBar, formatNote, printStrumEvent } from '../../src/cli/strum-event-viewer.js';
import { Note, createNote, type NoteObject } from '../../src/models/note.js';
import { StrummerConfig } from '../../src/models/strummer-config.js';
import { Strummer, type StrumEvent, type ReleaseEvent } from '../../src/core/strummer.js';

describe('createBar', () => {
  it('should create empty bar with zero value', () => {
    const bar = createBar(0, 100, 10);
    // Should have no filled blocks, all empty
    expect(bar).not.toContain('█');
    expect(bar).toContain('░');
  });

  it('should create full bar with max value', () => {
    const bar = createBar(100, 100, 10);
    // Should have all filled blocks
    expect(bar).toContain('█');
    // Count actual block characters (ignoring ANSI codes)
    const filledCount = (bar.match(/█/g) || []).length;
    expect(filledCount).toBe(10);
  });

  it('should create half-filled bar with half value', () => {
    const bar = createBar(50, 100, 10);
    const filledCount = (bar.match(/█/g) || []).length;
    const emptyCount = (bar.match(/░/g) || []).length;
    expect(filledCount).toBe(5);
    expect(emptyCount).toBe(5);
  });

  it('should handle zero max value gracefully', () => {
    const bar = createBar(50, 0, 10);
    // Should handle gracefully with no filled blocks
    const filledCount = (bar.match(/█/g) || []).length;
    expect(filledCount).toBe(0);
  });

  it('should cap at max width when value exceeds max', () => {
    const bar = createBar(150, 100, 10);
    // Should cap at max width
    const filledCount = (bar.match(/█/g) || []).length;
    expect(filledCount).toBe(10);
  });

  it('should handle negative value gracefully', () => {
    const bar = createBar(-10, 100, 10);
    // Should handle gracefully
    const filledCount = (bar.match(/█/g) || []).length;
    expect(filledCount).toBe(0);
  });
});

describe('formatNote', () => {
  it('should format a basic note', () => {
    const note: NoteObject = createNote('C', 4, false);
    const result = formatNote(note);
    expect(result).toContain('C4');
    expect(result).not.toContain('*');
  });

  it('should format a note with sharp', () => {
    const note: NoteObject = createNote('C#', 4, false);
    const result = formatNote(note);
    expect(result).toContain('C#4');
  });

  it('should format a secondary note with asterisk', () => {
    const note: NoteObject = createNote('E', 4, true);
    const result = formatNote(note);
    expect(result).toContain('E4');
    expect(result).toContain('*');
  });
});

describe('printStrumEvent', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should print a strum event', () => {
    const note: NoteObject = createNote('C', 4, false);
    const event: StrumEvent = {
      type: 'strum',
      notes: [{ note, velocity: 100 }],
    };
    printStrumEvent(event);

    const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('STRUM');
    expect(output).toContain('C4');
    expect(output).toContain('100');
  });

  it('should print a release event', () => {
    const event: ReleaseEvent = {
      type: 'release',
      velocity: 80,
    };
    printStrumEvent(event);

    const output = consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('RELEASE');
    expect(output).toContain('80');
  });
});

describe('StrummerConfig', () => {
  it('should create default config', () => {
    const config = new StrummerConfig();
    expect(config.pressureThreshold).toBe(0.1);
    expect(config.velocityScale).toBe(4.0); // New default pluckVelocityScale
    expect(config.notes).toEqual(['C4', 'E4', 'G4']); // New default notes
  });

  it('should create config from partial data', () => {
    // Use the new nested format for creating configs
    const config = StrummerConfig.fromDict({
      strumming: {
        pressureThreshold: 0.2,
        initialNotes: ['D4', 'F#4', 'A4'],
      },
    });
    expect(config.pressureThreshold).toBe(0.2);
    expect(config.notes).toEqual(['D4', 'F#4', 'A4']);
    expect(config.velocityScale).toBe(4.0); // default pluckVelocityScale
  });

  it('should load config from JSON file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strummer-test-'));
    const configPath = path.join(tmpDir, 'strummer.json');

    const configData = {
      strumming: {
        pressure_threshold: 0.15,
        pluck_velocity_scale: 0.8,
        initial_notes: ['E4', 'G#4', 'B4'],
        chord: 'E',
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(configData));

    const config = StrummerConfig.fromJsonFile(configPath);
    expect(config.pressureThreshold).toBe(0.15);
    expect(config.velocityScale).toBe(0.8);
    expect(config.notes).toEqual(['E4', 'G#4', 'B4']);
    expect(config.chord).toBe('E');

    // Cleanup
    fs.unlinkSync(configPath);
    fs.rmdirSync(tmpDir);
  });
});

describe('Strummer', () => {
  it('should initialize with default values', () => {
    const strummer = new Strummer();
    expect(strummer.pressureThreshold).toBe(0.1);
    expect(strummer.velocityScale).toBe(4.0);
    expect(strummer.notes).toEqual([]);
  });

  it('should configure with custom values', () => {
    const strummer = new Strummer();
    strummer.configure(2.0, 0.2);
    expect(strummer.velocityScale).toBe(2.0);
    expect(strummer.pressureThreshold).toBe(0.2);
  });

  it('should set notes and emit event', () => {
    const strummer = new Strummer();
    const callback = vi.fn();
    strummer.on('notes_changed', callback);

    const notes: NoteObject[] = [createNote('C', 4), createNote('E', 4), createNote('G', 4)];
    strummer.notes = notes;

    expect(strummer.notes).toHaveLength(3);
    expect(callback).toHaveBeenCalled();
  });

  it('should return null when no notes are set', () => {
    const strummer = new Strummer();
    const result = strummer.strum(0.5, 0.5);
    expect(result).toBeNull();
  });

  it('should detect strum when pressure exceeds threshold', () => {
    const strummer = new Strummer();
    strummer.notes = [createNote('C', 4), createNote('E', 4), createNote('G', 4), createNote('C', 5)];
    strummer.updateBounds(1.0, 1.0);

    // First touch - starts buffering
    strummer.strum(0.1, 0.05); // Below threshold
    strummer.strum(0.1, 0.15); // Above threshold - starts buffer

    // Fill buffer (need more iterations to fill the pressure buffer)
    let result = null;
    for (let i = 0; i < 10; i++) {
      result = strummer.strum(0.1, 0.2 + i * 0.01);
      if (result && result.type === 'strum') break;
    }

    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe('strum');
      if (result.type === 'strum') {
        expect(result.notes.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('should detect release when pressure drops below threshold', () => {
    const strummer = new Strummer();
    strummer.notes = [createNote('C', 4), createNote('E', 4), createNote('G', 4), createNote('C', 5)];
    strummer.updateBounds(1.0, 1.0);

    // Trigger a strum first
    strummer.strum(0.1, 0.05);
    strummer.strum(0.1, 0.15);
    strummer.strum(0.1, 0.2);
    strummer.strum(0.1, 0.25);

    // Now release
    const result = strummer.strum(0.1, 0.05);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe('release');
    }
  });

  it('should clear strum state', () => {
    const strummer = new Strummer();
    strummer.notes = [createNote('C', 4)];
    strummer.updateBounds(1.0, 1.0);

    // Trigger a strum
    strummer.strum(0.1, 0.05);
    strummer.strum(0.1, 0.15);
    strummer.strum(0.1, 0.2);
    strummer.strum(0.1, 0.25);

    // Clear
    strummer.clearStrum();

    expect(strummer.lastStrummedIndex).toBe(-1);
    expect(strummer.lastPressure).toBe(0.0);
    expect(strummer.pressureBuffer).toHaveLength(0);
  });

  it('should get notes state', () => {
    const strummer = new Strummer();
    strummer.notes = [createNote('C', 4), createNote('E', 4, true)];

    const state = strummer.getNotesState();

    expect(state.type).toBe('notes');
    expect(state.stringCount).toBe(2);
    expect(state.notes).toHaveLength(2);
    expect(state.baseNotes).toHaveLength(1); // Only non-secondary
    expect(state.timestamp).toBeGreaterThan(0);
  });
});

describe('Note', () => {
  it('should parse notation correctly', () => {
    const note = Note.parseNotation('C4');
    expect(note.notation).toBe('C');
    expect(note.octave).toBe(4);
  });

  it('should parse notation with sharp', () => {
    const note = Note.parseNotation('C#4');
    expect(note.notation).toBe('C#');
    expect(note.octave).toBe(4);
  });

  it('should parse notation with flat', () => {
    const note = Note.parseNotation('Bb3');
    expect(note.notation).toBe('Bb');
    expect(note.octave).toBe(3);
  });

  it('should default to octave 4 when not specified', () => {
    const note = Note.parseNotation('G');
    expect(note.notation).toBe('G');
    expect(note.octave).toBe(4);
  });

  it('should parse major chord', () => {
    const notes = Note.parseChord('C');
    expect(notes).toHaveLength(3);
    expect(notes[0].notation).toBe('C');
    expect(notes[1].notation).toBe('E');
    expect(notes[2].notation).toBe('G');
  });

  it('should parse minor chord', () => {
    const notes = Note.parseChord('Am');
    expect(notes).toHaveLength(3);
    expect(notes[0].notation).toBe('A');
    expect(notes[1].notation).toBe('C');
    expect(notes[2].notation).toBe('E');
  });

  it('should parse seventh chord', () => {
    const notes = Note.parseChord('G7');
    expect(notes).toHaveLength(4);
    expect(notes[0].notation).toBe('G');
    expect(notes[1].notation).toBe('B');
    expect(notes[2].notation).toBe('D');
    expect(notes[3].notation).toBe('F');
  });

  it('should fill note spread with upper notes', () => {
    const baseNotes = [createNote('C', 4), createNote('E', 4), createNote('G', 4)];
    const filled = Note.fillNoteSpread(baseNotes, 0, 3);

    expect(filled).toHaveLength(6); // 3 base + 3 upper
    expect(filled[3].octave).toBe(5); // First upper note
    expect(filled[3].secondary).toBe(true);
  });

  it('should fill note spread with lower notes', () => {
    const baseNotes = [createNote('C', 4), createNote('E', 4), createNote('G', 4)];
    const filled = Note.fillNoteSpread(baseNotes, 3, 0);

    expect(filled).toHaveLength(6); // 3 lower + 3 base
    expect(filled[0].octave).toBe(3); // First lower note
    expect(filled[0].secondary).toBe(true);
  });

  it('should transpose note up', () => {
    const note = createNote('C', 4);
    const transposed = Note.transpose(note, 2);
    expect(transposed.notation).toBe('D');
    expect(transposed.octave).toBe(4);
  });

  it('should transpose note down', () => {
    const note = createNote('C', 4);
    const transposed = Note.transpose(note, -2);
    expect(transposed.notation).toBe('A#');
    expect(transposed.octave).toBe(3);
  });

  it('should convert note to MIDI', () => {
    const note = createNote('C', 4);
    const midi = Note.noteToMidi(note);
    expect(midi).toBe(48); // C4 = 48
  });

  it('should convert note to string', () => {
    const note = createNote('C#', 4);
    const str = Note.noteToString(note);
    expect(str).toBe('C#4');
  });
});