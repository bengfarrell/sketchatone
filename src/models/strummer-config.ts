/**
 * Strummer Config Model
 *
 * Configuration model for strummer-specific settings.
 * Based on midi-strummer's configuration format.
 */

import * as fs from 'fs';
import {
  ParameterMapping,
  ParameterMappingData,
  defaultNoteDuration,
  defaultPitchBend,
  defaultNoteVelocity,
} from './parameter-mapping.js';
import {
  NoteRepeaterConfig,
  NoteRepeaterConfigData,
  TransposeConfig,
  TransposeConfigData,
  StylusButtonsConfig,
  StylusButtonsConfigData,
  StrumReleaseConfig,
  StrumReleaseConfigData,
} from './strummer-features.js';

/**
 * Core strumming configuration data
 */
export interface StrummingConfigData {
  /** Scale factor for pluck velocity calculation */
  pluckVelocityScale: number;
  /** Minimum pressure to trigger a strum (0-1) */
  pressureThreshold: number;
  /** MIDI channel (0-15, null for omni) */
  midiChannel: number | null;
  /** List of note strings for the strum (e.g., ["C4", "E4", "G4"]) */
  initialNotes: string[];
  /** Optional chord notation (e.g., "Am", "Gmaj7") */
  chord?: string;
  /** Number of notes to add above the chord */
  upperNoteSpread: number;
  /** Number of notes to add below the chord */
  lowerNoteSpread: number;
}

/**
 * Default strumming configuration values
 */
export const DEFAULT_STRUMMING_CONFIG: StrummingConfigData = {
  pluckVelocityScale: 4.0,
  pressureThreshold: 0.1,
  midiChannel: null,
  initialNotes: ['C4', 'E4', 'G4'],
  chord: undefined,
  upperNoteSpread: 3,
  lowerNoteSpread: 3,
};

/**
 * Core strumming configuration class
 */
export class StrummingConfig implements StrummingConfigData {
  pluckVelocityScale: number;
  pressureThreshold: number;
  midiChannel: number | null;
  initialNotes: string[];
  chord?: string;
  upperNoteSpread: number;
  lowerNoteSpread: number;

  constructor(data: Partial<StrummingConfigData> = {}) {
    this.pluckVelocityScale = data.pluckVelocityScale ?? DEFAULT_STRUMMING_CONFIG.pluckVelocityScale;
    this.pressureThreshold = data.pressureThreshold ?? DEFAULT_STRUMMING_CONFIG.pressureThreshold;
    this.midiChannel = data.midiChannel ?? DEFAULT_STRUMMING_CONFIG.midiChannel;
    this.initialNotes = data.initialNotes ?? [...DEFAULT_STRUMMING_CONFIG.initialNotes];
    this.chord = data.chord;
    this.upperNoteSpread = data.upperNoteSpread ?? DEFAULT_STRUMMING_CONFIG.upperNoteSpread;
    this.lowerNoteSpread = data.lowerNoteSpread ?? DEFAULT_STRUMMING_CONFIG.lowerNoteSpread;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): StrummingConfig {
    return new StrummingConfig({
      pluckVelocityScale: (data.pluck_velocity_scale ?? data.pluckVelocityScale) as number | undefined,
      pressureThreshold: (data.pressure_threshold ?? data.pressureThreshold) as number | undefined,
      midiChannel: (data.midi_channel ?? data.midiChannel) as number | null | undefined,
      initialNotes: (data.initial_notes ?? data.initialNotes) as string[] | undefined,
      chord: data.chord as string | undefined,
      upperNoteSpread: (data.upper_note_spread ?? data.upperNoteSpread) as number | undefined,
      lowerNoteSpread: (data.lower_note_spread ?? data.lowerNoteSpread) as number | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): StrummingConfigData {
    return {
      pluckVelocityScale: this.pluckVelocityScale,
      pressureThreshold: this.pressureThreshold,
      midiChannel: this.midiChannel,
      initialNotes: this.initialNotes,
      chord: this.chord,
      upperNoteSpread: this.upperNoteSpread,
      lowerNoteSpread: this.lowerNoteSpread,
    };
  }
}

/**
 * Full strummer configuration data interface
 */
export interface StrummerConfigData {
  noteDuration: ParameterMappingData;
  pitchBend: ParameterMappingData;
  noteVelocity: ParameterMappingData;
  strumming: StrummingConfigData;
  noteRepeater: NoteRepeaterConfigData;
  transpose: TransposeConfigData;
  stylusButtons: StylusButtonsConfigData;
  strumRelease: StrumReleaseConfigData;
}

/**
 * Full configuration for the strummer.
 *
 * This follows the midi-strummer configuration format with:
 * - Parameter mappings for note duration, pitch bend, and velocity
 * - Core strumming settings
 * - Optional features (repeater, transpose, stylus buttons, strum release)
 */
export class StrummerConfig {
  noteDuration: ParameterMapping;
  pitchBend: ParameterMapping;
  noteVelocity: ParameterMapping;
  strumming: StrummingConfig;
  noteRepeater: NoteRepeaterConfig;
  transpose: TransposeConfig;
  stylusButtons: StylusButtonsConfig;
  strumRelease: StrumReleaseConfig;

  constructor(data: {
    noteDuration?: ParameterMapping;
    pitchBend?: ParameterMapping;
    noteVelocity?: ParameterMapping;
    strumming?: StrummingConfig;
    noteRepeater?: NoteRepeaterConfig;
    transpose?: TransposeConfig;
    stylusButtons?: StylusButtonsConfig;
    strumRelease?: StrumReleaseConfig;
  } = {}) {
    this.noteDuration = data.noteDuration ?? defaultNoteDuration();
    this.pitchBend = data.pitchBend ?? defaultPitchBend();
    this.noteVelocity = data.noteVelocity ?? defaultNoteVelocity();
    this.strumming = data.strumming ?? new StrummingConfig();
    this.noteRepeater = data.noteRepeater ?? new NoteRepeaterConfig();
    this.transpose = data.transpose ?? new TransposeConfig();
    this.stylusButtons = data.stylusButtons ?? new StylusButtonsConfig();
    this.strumRelease = data.strumRelease ?? new StrumReleaseConfig();
  }

  // Convenience properties for backward compatibility
  get pressureThreshold(): number {
    return this.strumming.pressureThreshold;
  }

  get velocityScale(): number {
    return this.strumming.pluckVelocityScale;
  }

  get notes(): string[] {
    return this.strumming.initialNotes;
  }

  get chord(): string | undefined {
    return this.strumming.chord;
  }

  get lowerSpread(): number {
    return this.strumming.lowerNoteSpread;
  }

  get upperSpread(): number {
    return this.strumming.upperNoteSpread;
  }

  get channel(): number | null {
    return this.strumming.midiChannel;
  }

  /**
   * Create a StrummerConfig from a dictionary.
   */
  static fromDict(data: Record<string, unknown>): StrummerConfig {
    const noteDurationData = (data.note_duration ?? data.noteDuration ?? {}) as Record<string, unknown>;
    const pitchBendData = (data.pitch_bend ?? data.pitchBend ?? {}) as Record<string, unknown>;
    const noteVelocityData = (data.note_velocity ?? data.noteVelocity ?? {}) as Record<string, unknown>;
    const strummingData = (data.strumming ?? {}) as Record<string, unknown>;
    const noteRepeaterData = (data.note_repeater ?? data.noteRepeater ?? {}) as Record<string, unknown>;
    const transposeData = (data.transpose ?? {}) as Record<string, unknown>;
    const stylusButtonsData = (data.stylus_buttons ?? data.stylusButtons ?? {}) as Record<string, unknown>;
    const strumReleaseData = (data.strum_release ?? data.strumRelease ?? {}) as Record<string, unknown>;

    return new StrummerConfig({
      noteDuration: Object.keys(noteDurationData).length > 0
        ? ParameterMapping.fromDict(noteDurationData)
        : defaultNoteDuration(),
      pitchBend: Object.keys(pitchBendData).length > 0
        ? ParameterMapping.fromDict(pitchBendData)
        : defaultPitchBend(),
      noteVelocity: Object.keys(noteVelocityData).length > 0
        ? ParameterMapping.fromDict(noteVelocityData)
        : defaultNoteVelocity(),
      strumming: Object.keys(strummingData).length > 0
        ? StrummingConfig.fromDict(strummingData)
        : new StrummingConfig(),
      noteRepeater: Object.keys(noteRepeaterData).length > 0
        ? NoteRepeaterConfig.fromDict(noteRepeaterData)
        : new NoteRepeaterConfig(),
      transpose: Object.keys(transposeData).length > 0
        ? TransposeConfig.fromDict(transposeData)
        : new TransposeConfig(),
      stylusButtons: Object.keys(stylusButtonsData).length > 0
        ? StylusButtonsConfig.fromDict(stylusButtonsData)
        : new StylusButtonsConfig(),
      strumRelease: Object.keys(strumReleaseData).length > 0
        ? StrumReleaseConfig.fromDict(strumReleaseData)
        : new StrumReleaseConfig(),
    });
  }

  /**
   * Load a StrummerConfig from a JSON file
   */
  static fromJsonFile(path: string): StrummerConfig {
    const content = fs.readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    return StrummerConfig.fromDict(data);
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): StrummerConfigData {
    return {
      noteDuration: this.noteDuration.toDict(),
      pitchBend: this.pitchBend.toDict(),
      noteVelocity: this.noteVelocity.toDict(),
      strumming: this.strumming.toDict(),
      noteRepeater: this.noteRepeater.toDict(),
      transpose: this.transpose.toDict(),
      stylusButtons: this.stylusButtons.toDict(),
      strumRelease: this.strumRelease.toDict(),
    };
  }

  /**
   * Save the config to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}