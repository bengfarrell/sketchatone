import { describe, it, expect } from 'vitest';
import {
  MidiConfig,
  DEFAULT_MIDI_CONFIG,
  MidiStrummerConfig,
} from '../../src/models/midi-strummer-config';
import { StrummerConfig, StrummingConfig } from '../../src/models/strummer-config';

describe('MidiConfig', () => {
  it('should have correct default values', () => {
    const config = new MidiConfig();
    expect(config.outputPort).toBeNull();
    expect(config.inputPort).toBeNull();
    expect(config.channel).toBe(0);
    expect(config.useVirtualPorts).toBe(false);
  });

  it('should create from dictionary with snake_case', () => {
    const config = MidiConfig.fromDict({
      output_port: 'IAC Driver Bus 1',
      input_port: 'IAC Driver Bus 2',
      channel: 5,
      use_virtual_ports: true,
    });
    expect(config.outputPort).toBe('IAC Driver Bus 1');
    expect(config.inputPort).toBe('IAC Driver Bus 2');
    expect(config.channel).toBe(5);
    expect(config.useVirtualPorts).toBe(true);
  });

  it('should create from dictionary with camelCase', () => {
    const config = MidiConfig.fromDict({
      outputPort: 'USB MIDI',
      inputPort: null,
      channel: 10,
      useVirtualPorts: false,
    });
    expect(config.outputPort).toBe('USB MIDI');
    expect(config.inputPort).toBeNull();
    expect(config.channel).toBe(10);
    expect(config.useVirtualPorts).toBe(false);
  });

  it('should convert to dictionary', () => {
    const config = new MidiConfig({
      outputPort: 'Virtual Port',
      inputPort: 'Feedback Port',
      channel: 3,
      useVirtualPorts: true,
    });
    const dict = config.toDict();
    expect(dict.outputPort).toBe('Virtual Port');
    expect(dict.inputPort).toBe('Feedback Port');
    expect(dict.channel).toBe(3);
    expect(dict.useVirtualPorts).toBe(true);
  });
});

describe('MidiStrummerConfig', () => {
  describe('Basic', () => {
    it('should have correct default values', () => {
      const config = new MidiStrummerConfig();
      // Strummer defaults
      expect(config.strummer.strumming.pressureThreshold).toBe(0.1);
      expect(config.strummer.strumming.initialNotes).toEqual(['C4', 'E4', 'G4']);
      // MIDI defaults
      expect(config.midi.outputPort).toBeNull();
      expect(config.midi.channel).toBe(0);
    });

    it('should create from separate configs', () => {
      const strummer = new StrummerConfig({
        strumming: new StrummingConfig({
          pressureThreshold: 0.2,
          initialNotes: ['D4', 'F#4', 'A4'],
        }),
      });
      const midi = new MidiConfig({
        outputPort: 'Test Port',
        channel: 5,
      });
      const config = MidiStrummerConfig.fromSeparateConfigs(strummer, midi);
      expect(config.strummer.strumming.pressureThreshold).toBe(0.2);
      expect(config.midi.outputPort).toBe('Test Port');
    });

    it('should return strummer config', () => {
      const config = new MidiStrummerConfig();
      const strummer = config.toStrummerConfig();
      expect(strummer).toBeInstanceOf(StrummerConfig);
      expect(strummer.strumming.initialNotes).toEqual(['C4', 'E4', 'G4']);
    });

    it('should return MIDI config', () => {
      const config = new MidiStrummerConfig();
      const midi = config.toMidiConfig();
      expect(midi).toBeInstanceOf(MidiConfig);
      expect(midi.channel).toBe(0);
    });
  });

  describe('New Format', () => {
    it('should create from dictionary with new format', () => {
      const config = MidiStrummerConfig.fromDict({
        strummer: {
          strumming: {
            pressureThreshold: 0.15,
            initialNotes: ['E4', 'G4', 'B4'],
          },
          noteRepeater: {
            active: true,
          },
        },
        midi: {
          outputPort: 'IAC Driver',
          channel: 3,
        },
      });
      expect(config.strummer.strumming.pressureThreshold).toBe(0.15);
      expect(config.strummer.strumming.initialNotes).toEqual(['E4', 'G4', 'B4']);
      expect(config.strummer.noteRepeater.active).toBe(true);
      expect(config.midi.outputPort).toBe('IAC Driver');
      expect(config.midi.channel).toBe(3);
    });

    it('should convert to dictionary', () => {
      const config = new MidiStrummerConfig();
      const dict = config.toDict();
      expect(dict.strummer).toBeDefined();
      expect(dict.midi).toBeDefined();
      expect(dict.strummer.strumming).toBeDefined();
      expect(dict.midi.channel).toBe(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should provide strummer properties', () => {
      const config = new MidiStrummerConfig({
        strummer: new StrummerConfig({
          strumming: new StrummingConfig({
            pressureThreshold: 0.3,
            pluckVelocityScale: 4.0,
            initialNotes: ['G4', 'B4', 'D5'],
            chord: 'G',
          }),
        }),
      });
      expect(config.pressureThreshold).toBe(0.3);
      expect(config.velocityScale).toBe(4.0);
      expect(config.notes).toEqual(['G4', 'B4', 'D5']);
      expect(config.chord).toBe('G');
    });

    it('should provide MIDI properties', () => {
      const config = new MidiStrummerConfig({
        midi: new MidiConfig({
          outputPort: 'Test Output',
          inputPort: 'Test Input',
          channel: 8,
          useVirtualPorts: true,
        }),
      });
      expect(config.outputPort).toBe('Test Output');
      expect(config.inputPort).toBe('Test Input');
      expect(config.channel).toBe(8);
      expect(config.useVirtualPorts).toBe(true);
    });
  });

  describe('Roundtrip', () => {
    it('should roundtrip through new format dictionary', () => {
      const original = new MidiStrummerConfig({
        strummer: new StrummerConfig({
          strumming: new StrummingConfig({
            pressureThreshold: 0.18,
            pluckVelocityScale: 3.5,
            initialNotes: ['C4', 'E4', 'G4', 'B4'],
            chord: 'Cmaj7',
            midiChannel: 2,
          }),
        }),
        midi: new MidiConfig({
          outputPort: 'Roundtrip Port',
          channel: 4,
          useVirtualPorts: true,
        }),
      });
      const dict = original.toDict();
      const restored = MidiStrummerConfig.fromDict(dict);
      expect(restored.strummer.strumming.pressureThreshold).toBe(0.18);
      expect(restored.strummer.strumming.pluckVelocityScale).toBe(3.5);
      expect(restored.strummer.strumming.initialNotes).toEqual(['C4', 'E4', 'G4', 'B4']);
      expect(restored.strummer.strumming.chord).toBe('Cmaj7');
      expect(restored.midi.outputPort).toBe('Roundtrip Port');
      expect(restored.midi.channel).toBe(4);
      expect(restored.midi.useVirtualPorts).toBe(true);
    });
  });
});