/**
 * MIDI Strummer Config Model
 *
 * Combined configuration model for strummer + MIDI settings.
 * Based on midi-strummer's configuration format.
 */

import * as fs from 'fs';
import {
  StrummerConfig,
  StrummerConfigData,
  StrummingConfig,
} from './strummer-config.js';
import {
  ParameterMapping,
  defaultNoteDuration,
  defaultPitchBend,
  defaultNoteVelocity,
} from './parameter-mapping.js';
import {
  NoteRepeaterConfig,
  TransposeConfig,
  StylusButtonsConfig,
  StrumReleaseConfig,
} from './strummer-features.js';

/**
 * MIDI configuration data
 */
export interface MidiConfigData {
  /** MIDI output port name or index */
  outputPort: string | number | null;
  /** MIDI input port name or index (for feedback) */
  inputPort: string | number | null;
  /** Default MIDI channel (0-15) */
  channel: number;
  /** Whether to use virtual MIDI ports */
  useVirtualPorts: boolean;
}

/**
 * Default MIDI configuration
 */
export const DEFAULT_MIDI_CONFIG: MidiConfigData = {
  outputPort: null,
  inputPort: null,
  channel: 0,
  useVirtualPorts: false,
};

/**
 * MIDI configuration class
 */
export class MidiConfig implements MidiConfigData {
  outputPort: string | number | null;
  inputPort: string | number | null;
  channel: number;
  useVirtualPorts: boolean;

  constructor(data: Partial<MidiConfigData> = {}) {
    this.outputPort = data.outputPort ?? DEFAULT_MIDI_CONFIG.outputPort;
    this.inputPort = data.inputPort ?? DEFAULT_MIDI_CONFIG.inputPort;
    this.channel = data.channel ?? DEFAULT_MIDI_CONFIG.channel;
    this.useVirtualPorts = data.useVirtualPorts ?? DEFAULT_MIDI_CONFIG.useVirtualPorts;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): MidiConfig {
    return new MidiConfig({
      outputPort: (data.output_port ?? data.outputPort) as string | number | null | undefined,
      inputPort: (data.input_port ?? data.inputPort) as string | number | null | undefined,
      channel: data.channel as number | undefined,
      useVirtualPorts: (data.use_virtual_ports ?? data.useVirtualPorts) as boolean | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): MidiConfigData {
    return {
      outputPort: this.outputPort,
      inputPort: this.inputPort,
      channel: this.channel,
      useVirtualPorts: this.useVirtualPorts,
    };
  }
}

/**
 * Full MIDI strummer configuration data interface
 */
export interface MidiStrummerConfigData {
  strummer: StrummerConfigData;
  midi: MidiConfigData;
}

/**
 * Combined configuration for MIDI strummer.
 *
 * This combines:
 * - Full strummer configuration (notes, mappings, features)
 * - MIDI configuration (ports, channels)
 */
export class MidiStrummerConfig {
  private _strummer: StrummerConfig;
  private _midi: MidiConfig;

  constructor(data: {
    strummer?: StrummerConfig;
    midi?: MidiConfig;
  } = {}) {
    this._strummer = data.strummer ?? new StrummerConfig();
    this._midi = data.midi ?? new MidiConfig();
  }

  // Strummer config accessors
  get strummer(): StrummerConfig {
    return this._strummer;
  }

  get noteDuration(): ParameterMapping {
    return this._strummer.noteDuration;
  }

  get pitchBend(): ParameterMapping {
    return this._strummer.pitchBend;
  }

  get noteVelocity(): ParameterMapping {
    return this._strummer.noteVelocity;
  }

  get strumming(): StrummingConfig {
    return this._strummer.strumming;
  }

  get noteRepeater(): NoteRepeaterConfig {
    return this._strummer.noteRepeater;
  }

  get transpose(): TransposeConfig {
    return this._strummer.transpose;
  }

  get stylusButtons(): StylusButtonsConfig {
    return this._strummer.stylusButtons;
  }

  get strumRelease(): StrumReleaseConfig {
    return this._strummer.strumRelease;
  }

  // MIDI config accessors
  get midi(): MidiConfig {
    return this._midi;
  }

  get outputPort(): string | number | null {
    return this._midi.outputPort;
  }

  get inputPort(): string | number | null {
    return this._midi.inputPort;
  }

  get channel(): number {
    return this._midi.channel;
  }

  get useVirtualPorts(): boolean {
    return this._midi.useVirtualPorts;
  }

  // Backward compatibility properties
  get pressureThreshold(): number {
    return this._strummer.pressureThreshold;
  }

  get velocityScale(): number {
    return this._strummer.velocityScale;
  }

  get notes(): string[] {
    return this._strummer.notes;
  }

  get chord(): string | undefined {
    return this._strummer.chord;
  }

  /**
   * Create from separate strummer and MIDI configs
   */
  static fromSeparateConfigs(strummer: StrummerConfig, midi: MidiConfig): MidiStrummerConfig {
    return new MidiStrummerConfig({ strummer, midi });
  }

  /**
   * Get the strummer config portion
   */
  toStrummerConfig(): StrummerConfig {
    return this._strummer;
  }

  /**
   * Get the MIDI config portion
   */
  toMidiConfig(): MidiConfig {
    return this._midi;
  }

  /**
   * Create from dictionary.
   */
  static fromDict(data: Record<string, unknown>): MidiStrummerConfig {
    const strummerData = (data.strummer ?? {}) as Record<string, unknown>;
    const midiData = (data.midi ?? {}) as Record<string, unknown>;

    return new MidiStrummerConfig({
      strummer: Object.keys(strummerData).length > 0
        ? StrummerConfig.fromDict(strummerData)
        : new StrummerConfig(),
      midi: Object.keys(midiData).length > 0
        ? MidiConfig.fromDict(midiData)
        : new MidiConfig(),
    });
  }

  /**
   * Load from a JSON file
   */
  static fromJsonFile(path: string): MidiStrummerConfig {
    const content = fs.readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    return MidiStrummerConfig.fromDict(data);
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): MidiStrummerConfigData {
    return {
      strummer: this._strummer.toDict(),
      midi: this._midi.toDict(),
    };
  }

  /**
   * Save to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}