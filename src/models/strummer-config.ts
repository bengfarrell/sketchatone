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
  StrumReleaseConfig,
  StrumReleaseConfigData,
  SliderConfig,
  SliderConfigData,
} from './strummer-features.js';
import {
  ActionRulesConfig,
  ActionRulesConfigData,
  DEFAULT_ACTION_RULES_CONFIG,
} from './action-rules.js';

/**
 * Core strumming configuration data
 */
export interface StrummingConfigData {
  /** Minimum pressure to trigger a strum (0-1) */
  pressureThreshold: number;
  /** Number of pressure samples to buffer before triggering initial note (higher = more velocity, more latency) */
  pressureBufferSize: number;
  /** MIDI channel (stored internally as 0-15, but 1-16 in config files and CLI, null for channel 1 (default)) */
  midiChannel: number | null;
  /** List of note strings for the strum (e.g., ["C4", "E4", "G4"]) */
  initialNotes: string[];
  /** Optional chord notation (e.g., "Am", "Gmaj7") */
  chord?: string;
  /** Number of notes to add above the chord */
  upperNoteSpread: number;
  /** Number of notes to add below the chord */
  lowerNoteSpread: number;
  /** Invert X axis for left-handed use (flips which notes are on which side) */
  invertX: boolean;
}

/**
 * Default strumming configuration values
 */
export const DEFAULT_STRUMMING_CONFIG: StrummingConfigData = {
  pressureThreshold: 0.1,
  pressureBufferSize: 10,
  midiChannel: null,
  initialNotes: ['C4', 'E4', 'G4'],
  chord: undefined,
  upperNoteSpread: 3,
  lowerNoteSpread: 3,
  invertX: false,
};

/**
 * Core strumming configuration class
 */
export class StrummingConfig implements StrummingConfigData {
  pressureThreshold: number;
  pressureBufferSize: number;
  midiChannel: number | null;
  initialNotes: string[];
  chord?: string;
  upperNoteSpread: number;
  lowerNoteSpread: number;
  invertX: boolean;

  constructor(data: Partial<StrummingConfigData> = {}) {
    this.pressureThreshold = data.pressureThreshold ?? DEFAULT_STRUMMING_CONFIG.pressureThreshold;
    this.pressureBufferSize = data.pressureBufferSize ?? DEFAULT_STRUMMING_CONFIG.pressureBufferSize;
    this.midiChannel = data.midiChannel ?? DEFAULT_STRUMMING_CONFIG.midiChannel;
    this.initialNotes = data.initialNotes ?? [...DEFAULT_STRUMMING_CONFIG.initialNotes];
    this.chord = data.chord;
    this.upperNoteSpread = data.upperNoteSpread ?? DEFAULT_STRUMMING_CONFIG.upperNoteSpread;
    this.lowerNoteSpread = data.lowerNoteSpread ?? DEFAULT_STRUMMING_CONFIG.lowerNoteSpread;
    this.invertX = data.invertX ?? DEFAULT_STRUMMING_CONFIG.invertX;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   * Note: Converts MIDI channel from 1-16 (user-facing in config files) to 0-15 (internal).
   */
  static fromDict(data: Record<string, unknown>): StrummingConfig {
    // Get channel from config (1-16) and convert to internal (0-15)
    const channelFromConfig = (data.midi_channel ?? data.midiChannel) as number | null | undefined;
    let midiChannel: number | null | undefined;
    if (channelFromConfig !== null && channelFromConfig !== undefined) {
      midiChannel = channelFromConfig - 1; // Convert 1-16 to 0-15
    } else {
      midiChannel = channelFromConfig;
    }

    return new StrummingConfig({
      pressureThreshold: (data.pressure_threshold ?? data.pressureThreshold) as number | undefined,
      pressureBufferSize: (data.pressure_buffer_size ?? data.pressureBufferSize) as number | undefined,
      midiChannel,
      initialNotes: (data.initial_notes ?? data.initialNotes) as string[] | undefined,
      chord: data.chord as string | undefined,
      upperNoteSpread: (data.upper_note_spread ?? data.upperNoteSpread) as number | undefined,
      lowerNoteSpread: (data.lower_note_spread ?? data.lowerNoteSpread) as number | undefined,
      invertX: (data.invert_x ?? data.invertX) as boolean | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   * Note: Converts MIDI channel from 0-15 (internal) to 1-16 (user-facing in config files).
   */
  toDict(): StrummingConfigData {
    // Convert channel from internal (0-15) to config file format (1-16)
    let midiChannelForConfig: number | null = null;
    if (this.midiChannel !== null && this.midiChannel !== undefined) {
      midiChannelForConfig = this.midiChannel + 1; // Convert 0-15 to 1-16
    }

    return {
      pressureThreshold: this.pressureThreshold,
      pressureBufferSize: this.pressureBufferSize,
      midiChannel: midiChannelForConfig,
      initialNotes: this.initialNotes,
      chord: this.chord,
      upperNoteSpread: this.upperNoteSpread,
      lowerNoteSpread: this.lowerNoteSpread,
      invertX: this.invertX,
    };
  }
}

/**
 * Top-level controller mode. 'strum' uses the Strummer (pluck on cross);
 * 'slide' uses the Slider (trombone: hold + pitch-bend between strings).
 */
export type StrummerMode = 'strum' | 'slide';

export const VALID_STRUMMER_MODES: readonly StrummerMode[] = ['strum', 'slide'];
export const DEFAULT_STRUMMER_MODE: StrummerMode = 'strum';

/**
 * Full strummer configuration data interface
 */
export interface StrummerConfigData {
  mode: StrummerMode;
  noteDuration: ParameterMappingData;
  pitchBend: ParameterMappingData;
  noteVelocity: ParameterMappingData;
  strumming: StrummingConfigData;
  slide: SliderConfigData;
  strumRelease: StrumReleaseConfigData;
  actionRules: ActionRulesConfigData;
  chordProgressions?: Record<string, string[]>;
  harmonicContext?: { root: string; octave: number; major: boolean; mode: string };
  chordModes?: Record<string, Array<{ degree: string; quality: string }>>;
}

/**
 * Full configuration for the strummer.
 *
 * This follows the midi-strummer configuration format with:
 * - Parameter mappings for note duration, pitch bend, and velocity
 * - Core strumming settings
 * - Optional features (strum release)
 * - Action rules for button-to-action mapping
 *
 * Note: Repeater and transpose state is now managed by the Actions class,
 * not by config. Use action rules to configure these features.
 */
export class StrummerConfig {
  mode: StrummerMode;
  noteDuration: ParameterMapping;
  pitchBend: ParameterMapping;
  noteVelocity: ParameterMapping;
  strumming: StrummingConfig;
  slide: SliderConfig;
  strumRelease: StrumReleaseConfig;
  actionRules: ActionRulesConfig;
  chordProgressions: Record<string, string[]>;
  harmonicContext: { root: string; octave: number; major: boolean; mode: string } | undefined;
  chordModes: Record<string, Array<{ degree: string; quality: string }>> | undefined;

  constructor(data: {
    mode?: StrummerMode;
    noteDuration?: ParameterMapping;
    pitchBend?: ParameterMapping;
    noteVelocity?: ParameterMapping;
    strumming?: StrummingConfig;
    slide?: SliderConfig;
    strumRelease?: StrumReleaseConfig;
    actionRules?: ActionRulesConfig;
    chordProgressions?: Record<string, string[]>;
    harmonicContext?: { root: string; octave: number; major: boolean; mode: string };
    chordModes?: Record<string, Array<{ degree: string; quality: string }>>;
  } = {}) {
    this.mode = data.mode ?? DEFAULT_STRUMMER_MODE;
    this.noteDuration = data.noteDuration ?? defaultNoteDuration();
    this.pitchBend = data.pitchBend ?? defaultPitchBend();
    this.noteVelocity = data.noteVelocity ?? defaultNoteVelocity();
    this.strumming = data.strumming ?? new StrummingConfig();
    this.slide = data.slide ?? new SliderConfig();
    this.strumRelease = data.strumRelease ?? new StrumReleaseConfig();
    this.actionRules = data.actionRules ?? new ActionRulesConfig();
    this.chordProgressions = data.chordProgressions ?? {};
    this.harmonicContext = data.harmonicContext;
    this.chordModes = data.chordModes;
  }

  // Convenience properties for backward compatibility
  get pressureThreshold(): number {
    return this.strumming.pressureThreshold;
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
   * Note: note_repeater and transpose fields are ignored as they are now managed by Actions.
   */
  static fromDict(data: Record<string, unknown>): StrummerConfig {
    const noteDurationData = (data.note_duration ?? data.noteDuration ?? {}) as Record<string, unknown>;
    const pitchBendData = (data.pitch_bend ?? data.pitchBend ?? {}) as Record<string, unknown>;
    const noteVelocityData = (data.note_velocity ?? data.noteVelocity ?? {}) as Record<string, unknown>;
    const strummingData = (data.strumming ?? {}) as Record<string, unknown>;
    const slideData = (data.slide ?? {}) as Record<string, unknown>;
    const strumReleaseData = (data.strum_release ?? data.strumRelease ?? {}) as Record<string, unknown>;
    const actionRulesData = (data.action_rules ?? data.actionRules ?? {}) as Record<string, unknown>;
    const chordProgressionsData = (data.chordProgressions ?? data.chord_progressions ?? {}) as Record<string, string[]>;
    const harmonicContextData = (data.harmonicContext ?? data.harmonic_context) as { root: string; octave: number; major: boolean; mode: string } | undefined;
    const chordModesData = (data.chordModes ?? data.chord_modes) as Record<string, Array<{ degree: string; quality: string }>> | undefined;

    const rawMode = data.mode as string | undefined;
    const mode: StrummerMode = VALID_STRUMMER_MODES.includes(rawMode as StrummerMode)
      ? (rawMode as StrummerMode)
      : DEFAULT_STRUMMER_MODE;

    return new StrummerConfig({
      mode,
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
      slide: Object.keys(slideData).length > 0
        ? SliderConfig.fromDict(slideData)
        : new SliderConfig(),
      strumRelease: Object.keys(strumReleaseData).length > 0
        ? StrumReleaseConfig.fromDict(strumReleaseData)
        : new StrumReleaseConfig(),
      actionRules: Object.keys(actionRulesData).length > 0
        ? ActionRulesConfig.fromDict(actionRulesData)
        : new ActionRulesConfig(),
      chordProgressions: chordProgressionsData,
      harmonicContext: harmonicContextData,
      chordModes: chordModesData,
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
    const result: StrummerConfigData = {
      mode: this.mode,
      noteDuration: this.noteDuration.toDict(),
      pitchBend: this.pitchBend.toDict(),
      noteVelocity: this.noteVelocity.toDict(),
      strumming: this.strumming.toDict(),
      slide: this.slide.toDict(),
      strumRelease: this.strumRelease.toDict(),
      actionRules: this.actionRules.toDict(),
    };

    if (Object.keys(this.chordProgressions).length > 0) {
      result.chordProgressions = this.chordProgressions;
    }
    if (this.harmonicContext) {
      result.harmonicContext = this.harmonicContext;
    }
    if (this.chordModes) {
      result.chordModes = this.chordModes;
    }

    return result;
  }

  /**
   * Save the config to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}