import { describe, it, expect } from 'vitest';
import {
  NoteRepeaterConfig,
  DEFAULT_NOTE_REPEATER_CONFIG,
  TransposeConfig,
  DEFAULT_TRANSPOSE_CONFIG,
  StylusButtonsConfig,
  DEFAULT_STYLUS_BUTTONS_CONFIG,
  StrumReleaseConfig,
  DEFAULT_STRUM_RELEASE_CONFIG,
} from '../../src/models/strummer-features';

describe('NoteRepeaterConfig', () => {
  it('should have correct default values', () => {
    const config = new NoteRepeaterConfig();
    expect(config.active).toBe(false);
    expect(config.pressureMultiplier).toBe(1.0);
    expect(config.frequencyMultiplier).toBe(1.0);
  });

  it('should create from dictionary with snake_case', () => {
    const config = NoteRepeaterConfig.fromDict({
      active: true,
      pressure_multiplier: 2.0,
      frequency_multiplier: 1.5,
    });
    expect(config.active).toBe(true);
    expect(config.pressureMultiplier).toBe(2.0);
    expect(config.frequencyMultiplier).toBe(1.5);
  });

  it('should create from dictionary with camelCase', () => {
    const config = NoteRepeaterConfig.fromDict({
      active: true,
      pressureMultiplier: 2.0,
      frequencyMultiplier: 1.5,
    });
    expect(config.active).toBe(true);
    expect(config.pressureMultiplier).toBe(2.0);
    expect(config.frequencyMultiplier).toBe(1.5);
  });

  it('should convert to dictionary', () => {
    const config = new NoteRepeaterConfig({
      active: true,
      pressureMultiplier: 3.0,
      frequencyMultiplier: 2.0,
    });
    const dict = config.toDict();
    expect(dict.active).toBe(true);
    expect(dict.pressureMultiplier).toBe(3.0);
    expect(dict.frequencyMultiplier).toBe(2.0);
  });

  it('should roundtrip through dictionary', () => {
    const original = new NoteRepeaterConfig({
      active: true,
      pressureMultiplier: 2.5,
      frequencyMultiplier: 1.8,
    });
    const dict = original.toDict();
    const restored = NoteRepeaterConfig.fromDict(dict);
    expect(restored.active).toBe(original.active);
    expect(restored.pressureMultiplier).toBe(original.pressureMultiplier);
    expect(restored.frequencyMultiplier).toBe(original.frequencyMultiplier);
  });
});

describe('TransposeConfig', () => {
  it('should have correct default values', () => {
    const config = new TransposeConfig();
    expect(config.active).toBe(false);
    expect(config.semitones).toBe(12);
  });

  it('should create from dictionary', () => {
    const config = TransposeConfig.fromDict({
      active: true,
      semitones: -7,
    });
    expect(config.active).toBe(true);
    expect(config.semitones).toBe(-7);
  });

  it('should convert to dictionary', () => {
    const config = new TransposeConfig({
      active: true,
      semitones: 5,
    });
    const dict = config.toDict();
    expect(dict.active).toBe(true);
    expect(dict.semitones).toBe(5);
  });

  it('should roundtrip through dictionary', () => {
    const original = new TransposeConfig({
      active: true,
      semitones: -12,
    });
    const dict = original.toDict();
    const restored = TransposeConfig.fromDict(dict);
    expect(restored.active).toBe(original.active);
    expect(restored.semitones).toBe(original.semitones);
  });
});

describe('StylusButtonsConfig', () => {
  it('should have correct default values', () => {
    const config = new StylusButtonsConfig();
    expect(config.active).toBe(true);
    expect(config.primaryButtonAction).toBe('toggle-transpose');
    expect(config.secondaryButtonAction).toBe('toggle-repeater');
  });

  it('should create from dictionary with snake_case', () => {
    const config = StylusButtonsConfig.fromDict({
      active: false,
      primary_button_action: 'octave-up',
      secondary_button_action: 'octave-down',
    });
    expect(config.active).toBe(false);
    expect(config.primaryButtonAction).toBe('octave-up');
    expect(config.secondaryButtonAction).toBe('octave-down');
  });

  it('should create from dictionary with camelCase', () => {
    const config = StylusButtonsConfig.fromDict({
      active: false,
      primaryButtonAction: 'momentary-transpose',
      secondaryButtonAction: 'momentary-repeater',
    });
    expect(config.active).toBe(false);
    expect(config.primaryButtonAction).toBe('momentary-transpose');
    expect(config.secondaryButtonAction).toBe('momentary-repeater');
  });

  it('should convert to dictionary', () => {
    const config = new StylusButtonsConfig({
      active: true,
      primaryButtonAction: 'none',
      secondaryButtonAction: 'toggle-transpose',
    });
    const dict = config.toDict();
    expect(dict.active).toBe(true);
    expect(dict.primaryButtonAction).toBe('none');
    expect(dict.secondaryButtonAction).toBe('toggle-transpose');
  });

  it('should roundtrip through dictionary', () => {
    const original = new StylusButtonsConfig({
      active: false,
      primaryButtonAction: 'octave-up',
      secondaryButtonAction: 'octave-down',
    });
    const dict = original.toDict();
    const restored = StylusButtonsConfig.fromDict(dict);
    expect(restored.active).toBe(original.active);
    expect(restored.primaryButtonAction).toBe(original.primaryButtonAction);
    expect(restored.secondaryButtonAction).toBe(original.secondaryButtonAction);
  });
});

describe('StrumReleaseConfig', () => {
  it('should have correct default values', () => {
    const config = new StrumReleaseConfig();
    expect(config.active).toBe(false);
    expect(config.midiNote).toBe(38);
    expect(config.midiChannel).toBeNull();
    expect(config.maxDuration).toBe(0.25);
    expect(config.velocityMultiplier).toBe(1.0);
  });

  it('should create from dictionary with snake_case', () => {
    const config = StrumReleaseConfig.fromDict({
      active: true,
      midi_note: 42,
      midi_channel: 9,
      max_duration: 0.5,
      velocity_multiplier: 0.8,
    });
    expect(config.active).toBe(true);
    expect(config.midiNote).toBe(42);
    expect(config.midiChannel).toBe(9);
    expect(config.maxDuration).toBe(0.5);
    expect(config.velocityMultiplier).toBe(0.8);
  });

  it('should create from dictionary with camelCase', () => {
    const config = StrumReleaseConfig.fromDict({
      active: true,
      midiNote: 36,
      midiChannel: 10,
      maxDuration: 0.3,
      velocityMultiplier: 1.2,
    });
    expect(config.active).toBe(true);
    expect(config.midiNote).toBe(36);
    expect(config.midiChannel).toBe(10);
    expect(config.maxDuration).toBe(0.3);
    expect(config.velocityMultiplier).toBe(1.2);
  });

  it('should convert to dictionary', () => {
    const config = new StrumReleaseConfig({
      active: true,
      midiNote: 40,
      midiChannel: 5,
      maxDuration: 0.4,
      velocityMultiplier: 0.9,
    });
    const dict = config.toDict();
    expect(dict.active).toBe(true);
    expect(dict.midiNote).toBe(40);
    expect(dict.midiChannel).toBe(5);
    expect(dict.maxDuration).toBe(0.4);
    expect(dict.velocityMultiplier).toBe(0.9);
  });

  it('should roundtrip through dictionary', () => {
    const original = new StrumReleaseConfig({
      active: true,
      midiNote: 44,
      midiChannel: 8,
      maxDuration: 0.35,
      velocityMultiplier: 1.1,
    });
    const dict = original.toDict();
    const restored = StrumReleaseConfig.fromDict(dict);
    expect(restored.active).toBe(original.active);
    expect(restored.midiNote).toBe(original.midiNote);
    expect(restored.midiChannel).toBe(original.midiChannel);
    expect(restored.maxDuration).toBe(original.maxDuration);
    expect(restored.velocityMultiplier).toBe(original.velocityMultiplier);
  });
});
