import { describe, it, expect } from 'vitest';
import {
  StrummingConfig,
  DEFAULT_STRUMMING_CONFIG,
  StrummerConfig,
} from '../../src/models/strummer-config';

describe('StrummingConfig', () => {
  it('should have correct default values', () => {
    const config = new StrummingConfig();
    expect(config.pluckVelocityScale).toBe(4.0);
    expect(config.pressureThreshold).toBe(0.1);
    expect(config.midiChannel).toBeNull();
    expect(config.initialNotes).toEqual(['C4', 'E4', 'G4']);
    expect(config.chord).toBeUndefined();
    expect(config.upperNoteSpread).toBe(3);
    expect(config.lowerNoteSpread).toBe(3);
  });

  it('should create from dictionary with snake_case', () => {
    const config = StrummingConfig.fromDict({
      pluck_velocity_scale: 2.0,
      pressure_threshold: 0.2,
      midi_channel: 5,
      initial_notes: ['D4', 'F#4', 'A4'],
      chord: 'Dm',
      upper_note_spread: 2,
      lower_note_spread: 1,
    });
    expect(config.pluckVelocityScale).toBe(2.0);
    expect(config.pressureThreshold).toBe(0.2);
    expect(config.midiChannel).toBe(5);
    expect(config.initialNotes).toEqual(['D4', 'F#4', 'A4']);
    expect(config.chord).toBe('Dm');
    expect(config.upperNoteSpread).toBe(2);
    expect(config.lowerNoteSpread).toBe(1);
  });

  it('should create from dictionary with camelCase', () => {
    const config = StrummingConfig.fromDict({
      pluckVelocityScale: 3.0,
      pressureThreshold: 0.15,
      midiChannel: 3,
      initialNotes: ['E4', 'G#4', 'B4'],
      chord: 'E',
      upperNoteSpread: 4,
      lowerNoteSpread: 2,
    });
    expect(config.pluckVelocityScale).toBe(3.0);
    expect(config.pressureThreshold).toBe(0.15);
    expect(config.midiChannel).toBe(3);
    expect(config.initialNotes).toEqual(['E4', 'G#4', 'B4']);
    expect(config.chord).toBe('E');
    expect(config.upperNoteSpread).toBe(4);
    expect(config.lowerNoteSpread).toBe(2);
  });

  it('should convert to dictionary', () => {
    const config = new StrummingConfig({
      pluckVelocityScale: 5.0,
      pressureThreshold: 0.25,
      midiChannel: 7,
      initialNotes: ['A4', 'C#5', 'E5'],
      chord: 'A',
      upperNoteSpread: 5,
      lowerNoteSpread: 4,
    });
    const dict = config.toDict();
    expect(dict.pluckVelocityScale).toBe(5.0);
    expect(dict.pressureThreshold).toBe(0.25);
    expect(dict.midiChannel).toBe(7);
    expect(dict.initialNotes).toEqual(['A4', 'C#5', 'E5']);
    expect(dict.chord).toBe('A');
    expect(dict.upperNoteSpread).toBe(5);
    expect(dict.lowerNoteSpread).toBe(4);
  });
});

describe('StrummerConfig', () => {
  describe('New Format', () => {
    it('should have correct default values', () => {
      const config = new StrummerConfig();
      // Check strumming defaults
      expect(config.strumming.pressureThreshold).toBe(0.1);
      expect(config.strumming.initialNotes).toEqual(['C4', 'E4', 'G4']);
      // Check parameter mapping defaults
      expect(config.noteDuration.control).toBe('tiltXY');
      expect(config.pitchBend.control).toBe('yaxis');
      expect(config.noteVelocity.control).toBe('pressure');
      // Check feature defaults
      expect(config.noteRepeater.active).toBe(false);
      expect(config.transpose.active).toBe(false);
      expect(config.stylusButtons.active).toBe(true);
      expect(config.strumRelease.active).toBe(false);
    });

    it('should create from dictionary with new format', () => {
      const config = StrummerConfig.fromDict({
        strumming: {
          pressureThreshold: 0.2,
          initialNotes: ['D4', 'F#4', 'A4'],
          chord: 'D',
        },
        noteDuration: {
          min: 0.1,
          max: 2.0,
          control: 'pressure',
        },
        noteRepeater: {
          active: true,
          pressureMultiplier: 2.0,
        },
      });
      expect(config.strumming.pressureThreshold).toBe(0.2);
      expect(config.strumming.initialNotes).toEqual(['D4', 'F#4', 'A4']);
      expect(config.strumming.chord).toBe('D');
      expect(config.noteDuration.min).toBe(0.1);
      expect(config.noteDuration.max).toBe(2.0);
      expect(config.noteDuration.control).toBe('pressure');
      expect(config.noteRepeater.active).toBe(true);
      expect(config.noteRepeater.pressureMultiplier).toBe(2.0);
    });

    it('should convert to dictionary', () => {
      const config = new StrummerConfig();
      const dict = config.toDict();
      expect(dict.strumming).toBeDefined();
      expect(dict.noteDuration).toBeDefined();
      expect(dict.pitchBend).toBeDefined();
      expect(dict.noteVelocity).toBeDefined();
      expect(dict.noteRepeater).toBeDefined();
      expect(dict.transpose).toBeDefined();
      expect(dict.stylusButtons).toBeDefined();
      expect(dict.strumRelease).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should provide pressureThreshold property', () => {
      const config = new StrummerConfig({
        strumming: new StrummingConfig({ pressureThreshold: 0.25 }),
      });
      expect(config.pressureThreshold).toBe(0.25);
    });

    it('should provide velocityScale property', () => {
      const config = new StrummerConfig({
        strumming: new StrummingConfig({ pluckVelocityScale: 5.0 }),
      });
      expect(config.velocityScale).toBe(5.0);
    });

    it('should provide notes property', () => {
      const config = new StrummerConfig({
        strumming: new StrummingConfig({ initialNotes: ['F4', 'A4', 'C5'] }),
      });
      expect(config.notes).toEqual(['F4', 'A4', 'C5']);
    });

    it('should provide chord property', () => {
      const config = new StrummerConfig({
        strumming: new StrummingConfig({ chord: 'Fmaj7' }),
      });
      expect(config.chord).toBe('Fmaj7');
    });

    it('should provide spread properties', () => {
      const config = new StrummerConfig({
        strumming: new StrummingConfig({
          lowerNoteSpread: 2,
          upperNoteSpread: 4,
        }),
      });
      expect(config.lowerSpread).toBe(2);
      expect(config.upperSpread).toBe(4);
    });

    it('should provide channel property', () => {
      const config = new StrummerConfig({
        strumming: new StrummingConfig({ midiChannel: 9 }),
      });
      expect(config.channel).toBe(9);
    });
  });
});