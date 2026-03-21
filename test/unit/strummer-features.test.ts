import { describe, it, expect } from 'vitest';
import {
  StrumReleaseConfig,
  DEFAULT_STRUM_RELEASE_CONFIG,
} from '../../src/models/strummer-features';

// Note: NoteRepeaterConfig and TransposeConfig have been removed.
// Repeater and transpose state is now managed by the Actions class.

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
    const restored = StrumReleaseConfig.fromDict(dict as unknown as Record<string, unknown>);
    expect(restored.active).toBe(original.active);
    expect(restored.midiNote).toBe(original.midiNote);
    expect(restored.midiChannel).toBe(original.midiChannel);
    expect(restored.maxDuration).toBe(original.maxDuration);
    expect(restored.velocityMultiplier).toBe(original.velocityMultiplier);
  });
});
