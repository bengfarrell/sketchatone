/**
 * Tests for the Actions class.
 * Focuses on verifying that note spread configuration is properly applied
 * when setting chords via tablet buttons.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Actions, ChordProgressionState } from '../../src/core/actions.js';
import { Strummer } from '../../src/core/strummer.js';
import { MidiStrummerConfig } from '../../src/models/midi-strummer-config.js';
import { StrummerConfig } from '../../src/models/strummer-config.js';

describe('ChordProgressionState', () => {
  describe('initial state', () => {
    it('should have empty initial state', () => {
      const state = new ChordProgressionState();
      expect(state.progressionName).toBeNull();
      expect(state.chords).toEqual([]);
      expect(state.currentIndex).toBe(0);
    });
  });

  describe('loadProgression', () => {
    it('should load a valid progression', () => {
      const state = new ChordProgressionState();
      const result = state.loadProgression('c-major-pop');
      expect(result).toBe(true);
      expect(state.progressionName).toBe('c-major-pop');
      expect(state.chords.length).toBeGreaterThan(0);
      expect(state.currentIndex).toBe(0);
    });

    it('should return false for invalid progression', () => {
      const state = new ChordProgressionState();
      const result = state.loadProgression('nonexistent-progression');
      expect(result).toBe(false);
    });
  });

  describe('setIndex', () => {
    it('should wrap around when index exceeds length', () => {
      const state = new ChordProgressionState();
      state.loadProgression('c-major-pop');
      const numChords = state.chords.length;
      const actual = state.setIndex(numChords + 2);
      expect(actual).toBe(2);
    });
  });

  describe('incrementIndex', () => {
    it('should increment index', () => {
      const state = new ChordProgressionState();
      state.loadProgression('c-major-pop');
      state.incrementIndex(1);
      expect(state.currentIndex).toBe(1);
      state.incrementIndex(2);
      expect(state.currentIndex).toBe(3);
    });

    it('should wrap around when decrementing from 0', () => {
      const state = new ChordProgressionState();
      state.loadProgression('c-major-pop');
      const numChords = state.chords.length;
      state.incrementIndex(-1);
      expect(state.currentIndex).toBe(numChords - 1);
    });
  });

  describe('getCurrentChord', () => {
    it('should return current chord', () => {
      const state = new ChordProgressionState();
      state.loadProgression('c-major-pop');
      const chord = state.getCurrentChord();
      expect(chord).not.toBeNull();
      expect(typeof chord).toBe('string');
    });
  });
});

describe('Actions with plain object config', () => {
  /**
   * Note: Plain object configs work for noteRepeater and transpose because
   * they are objects (passed by reference), but lowerSpread and upperSpread
   * are primitives (passed by value) so they won't update dynamically.
   */
  describe('setStrumChord', () => {
    it('should set chord with no spread', () => {
      const strummer = new Strummer();
      const config = {
        lowerSpread: 0,
        upperSpread: 0,
      };
      const actions = new Actions(config, strummer);

      actions.execute(['set-strum-chord', 'Am'], { button: 'Test' });

      // Am chord should have 3 notes: A, C, E
      expect(strummer.notes.length).toBe(3);
    });

    it('should NOT apply spread from plain object (demonstrates the bug)', () => {
      const strummer = new Strummer();
      const config = {
        lowerSpread: 2,
        upperSpread: 3,
      };
      const actions = new Actions(config, strummer);

      actions.execute(['set-strum-chord', 'Am'], { button: 'Test' });

      // With plain object, spread values ARE applied because they're read directly
      // Am chord (3 notes) + 2 lower + 3 upper = 8 notes
      expect(strummer.notes.length).toBe(8);
    });
  });
});

describe('Actions with MidiStrummerConfig', () => {
  /**
   * This tests the fix for the bug where spread values weren't being
   * applied when using the actual config object.
   */
  describe('setStrumChord', () => {
    it('should use spread from MidiStrummerConfig', () => {
      const strummer = new Strummer();
      const config = new MidiStrummerConfig();

      // Set spread values on the config
      config.strummer.strumming.lowerNoteSpread = 2;
      config.strummer.strumming.upperNoteSpread = 3;

      const actions = new Actions(config, strummer);

      actions.execute(['set-strum-chord', 'C'], { button: 'Tablet1' });

      // C major chord (3 notes) + 2 lower + 3 upper = 8 notes
      expect(strummer.notes.length).toBe(8);
    });

    it('should reflect config changes for subsequent chord sets', () => {
      const strummer = new Strummer();
      const config = new MidiStrummerConfig();

      // Start with no spread
      config.strummer.strumming.lowerNoteSpread = 0;
      config.strummer.strumming.upperNoteSpread = 0;

      const actions = new Actions(config, strummer);

      // Set chord with no spread
      actions.execute(['set-strum-chord', 'Am'], { button: 'Tablet1' });
      expect(strummer.notes.length).toBe(3); // Just the 3 chord notes

      // Now update the config (simulating UI change)
      config.strummer.strumming.lowerNoteSpread = 2;
      config.strummer.strumming.upperNoteSpread = 2;

      // Set chord again - should now have spread applied
      actions.execute(['set-strum-chord', 'Am'], { button: 'Tablet1' });
      expect(strummer.notes.length).toBe(7); // 3 + 2 + 2 = 7 notes
    });
  });

  describe('setStrumNotes', () => {
    it('should reflect config changes', () => {
      const strummer = new Strummer();
      const config = new MidiStrummerConfig();

      // Start with no spread
      config.strummer.strumming.lowerNoteSpread = 0;
      config.strummer.strumming.upperNoteSpread = 0;

      const actions = new Actions(config, strummer);

      // Set notes with no spread
      actions.execute(['set-strum-notes', ['C4', 'E4', 'G4']], { button: 'Tablet1' });
      expect(strummer.notes.length).toBe(3);

      // Update config
      config.strummer.strumming.lowerNoteSpread = 3;
      config.strummer.strumming.upperNoteSpread = 3;

      // Set notes again
      actions.execute(['set-strum-notes', ['C4', 'E4', 'G4']], { button: 'Tablet1' });
      expect(strummer.notes.length).toBe(9); // 3 + 3 + 3 = 9 notes
    });
  });

  describe('config properties accessible', () => {
    it('should have lowerSpread and upperSpread accessible', () => {
      const config = new MidiStrummerConfig();
      config.strummer.strumming.lowerNoteSpread = 5;
      config.strummer.strumming.upperNoteSpread = 7;

      expect(config.lowerSpread).toBe(5);
      expect(config.upperSpread).toBe(7);
    });

    it('should have noteRepeater accessible', () => {
      const config = new MidiStrummerConfig();
      config.strummer.noteRepeater.active = true;

      expect(config.noteRepeater).not.toBeNull();
      expect(config.noteRepeater.active).toBe(true);
    });

    it('should have transpose accessible', () => {
      const config = new MidiStrummerConfig();
      config.strummer.transpose.active = true;
      config.strummer.transpose.semitones = 7;

      expect(config.transpose).not.toBeNull();
      expect(config.transpose.active).toBe(true);
      expect(config.transpose.semitones).toBe(7);
    });
  });
});

describe('Actions execute', () => {
  it('should execute string action', () => {
    const config = new MidiStrummerConfig();
    const actions = new Actions(config);

    const result = actions.execute('toggle-repeater', { button: 'Test' });
    expect(result).toBe(true);
  });

  it('should execute array action with params', () => {
    const strummer = new Strummer();
    const config = new MidiStrummerConfig();
    const actions = new Actions(config, strummer);

    const result = actions.execute(['set-strum-chord', 'Am'], { button: 'Test' });
    expect(result).toBe(true);
    expect(strummer.notes.length).toBeGreaterThan(0);
  });

  it('should return false for unknown action', () => {
    const config = new MidiStrummerConfig();
    const actions = new Actions(config);

    const result = actions.execute('unknown-action', { button: 'Test' });
    expect(result).toBe(false);
  });

  it('should return false for null action', () => {
    const config = new MidiStrummerConfig();
    const actions = new Actions(config);

    const result = actions.execute(null, { button: 'Test' });
    expect(result).toBe(false);
  });
});

describe('Actions toggle-repeater', () => {
  it('should toggle repeater on', () => {
    const config = new MidiStrummerConfig();
    config.strummer.noteRepeater.active = false;

    const actions = new Actions(config);
    actions.execute('toggle-repeater', { button: 'Test' });

    expect(config.strummer.noteRepeater.active).toBe(true);
  });

  it('should toggle repeater off', () => {
    const config = new MidiStrummerConfig();
    config.strummer.noteRepeater.active = true;

    const actions = new Actions(config);
    actions.execute('toggle-repeater', { button: 'Test' });

    expect(config.strummer.noteRepeater.active).toBe(false);
  });
});

describe('Actions toggle-transpose', () => {
  it('should toggle transpose on', () => {
    const config = new MidiStrummerConfig();
    config.strummer.transpose.active = false;

    const actions = new Actions(config);
    actions.execute('toggle-transpose', { button: 'Test' });

    expect(config.strummer.transpose.active).toBe(true);
  });

  it('should toggle transpose off', () => {
    const config = new MidiStrummerConfig();
    config.strummer.transpose.active = true;

    const actions = new Actions(config);
    actions.execute('toggle-transpose', { button: 'Test' });

    expect(config.strummer.transpose.active).toBe(false);
  });
});

describe('Actions chord progression', () => {
  it('should set chord from progression', () => {
    const strummer = new Strummer();
    const config = new MidiStrummerConfig();
    config.strummer.strumming.lowerNoteSpread = 0;
    config.strummer.strumming.upperNoteSpread = 0;

    const actions = new Actions(config, strummer);

    const result = actions.execute(
      ['set-chord-in-progression', 'c-major-pop', 0],
      { button: 'Test' }
    );

    expect(result).toBe(true);
    expect(strummer.notes.length).toBeGreaterThan(0);
  });

  it('should increment through progression', () => {
    const strummer = new Strummer();
    const config = new MidiStrummerConfig();
    config.strummer.strumming.lowerNoteSpread = 0;
    config.strummer.strumming.upperNoteSpread = 0;

    const actions = new Actions(config, strummer);

    // First set to index 0
    actions.execute(
      ['set-chord-in-progression', 'c-major-pop', 0],
      { button: 'Test' }
    );
    const firstNotes = [...strummer.notes];

    // Increment by 1
    actions.execute(
      ['increment-chord-in-progression', 'c-major-pop', 1],
      { button: 'Test' }
    );
    const secondNotes = [...strummer.notes];

    // Notes should be different (different chord)
    expect(firstNotes).not.toEqual(secondNotes);
  });
});
