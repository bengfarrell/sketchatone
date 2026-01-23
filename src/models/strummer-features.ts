/**
 * Strummer Feature Config Models
 *
 * Configuration models for optional strummer features.
 * Based on midi-strummer's feature configuration system.
 */

/**
 * Stylus button actions
 */
export type ButtonAction =
  | 'toggle-transpose'
  | 'toggle-repeater'
  | 'momentary-transpose'
  | 'momentary-repeater'
  | 'octave-up'
  | 'octave-down'
  | 'none';

/**
 * Note repeater configuration data
 */
export interface NoteRepeaterConfigData {
  /** Whether the repeater is enabled */
  active: boolean;
  /** Scale factor for pressure-to-frequency mapping */
  pressureMultiplier: number;
  /** Base frequency multiplier */
  frequencyMultiplier: number;
}

/**
 * Default note repeater configuration
 */
export const DEFAULT_NOTE_REPEATER_CONFIG: NoteRepeaterConfigData = {
  active: false,
  pressureMultiplier: 1.0,
  frequencyMultiplier: 1.0,
};

/**
 * Configuration for the note repeater feature.
 * When active, notes are repeated at a frequency controlled by pressure.
 */
export class NoteRepeaterConfig implements NoteRepeaterConfigData {
  active: boolean;
  pressureMultiplier: number;
  frequencyMultiplier: number;

  constructor(data: Partial<NoteRepeaterConfigData> = {}) {
    this.active = data.active ?? DEFAULT_NOTE_REPEATER_CONFIG.active;
    this.pressureMultiplier = data.pressureMultiplier ?? DEFAULT_NOTE_REPEATER_CONFIG.pressureMultiplier;
    this.frequencyMultiplier = data.frequencyMultiplier ?? DEFAULT_NOTE_REPEATER_CONFIG.frequencyMultiplier;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): NoteRepeaterConfig {
    return new NoteRepeaterConfig({
      active: data.active as boolean | undefined,
      pressureMultiplier: (data.pressure_multiplier ?? data.pressureMultiplier) as number | undefined,
      frequencyMultiplier: (data.frequency_multiplier ?? data.frequencyMultiplier) as number | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): NoteRepeaterConfigData {
    return {
      active: this.active,
      pressureMultiplier: this.pressureMultiplier,
      frequencyMultiplier: this.frequencyMultiplier,
    };
  }
}

/**
 * Transpose configuration data
 */
export interface TransposeConfigData {
  /** Whether transpose is enabled */
  active: boolean;
  /** Number of semitones to transpose (positive=up, negative=down) */
  semitones: number;
}

/**
 * Default transpose configuration
 */
export const DEFAULT_TRANSPOSE_CONFIG: TransposeConfigData = {
  active: false,
  semitones: 12,
};

/**
 * Configuration for the transpose feature.
 * When active, all notes are transposed by the specified number of semitones.
 */
export class TransposeConfig implements TransposeConfigData {
  active: boolean;
  semitones: number;

  constructor(data: Partial<TransposeConfigData> = {}) {
    this.active = data.active ?? DEFAULT_TRANSPOSE_CONFIG.active;
    this.semitones = data.semitones ?? DEFAULT_TRANSPOSE_CONFIG.semitones;
  }

  /**
   * Create from dictionary
   */
  static fromDict(data: Record<string, unknown>): TransposeConfig {
    return new TransposeConfig({
      active: data.active as boolean | undefined,
      semitones: data.semitones as number | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): TransposeConfigData {
    return {
      active: this.active,
      semitones: this.semitones,
    };
  }
}

/**
 * Stylus buttons configuration data
 */
export interface StylusButtonsConfigData {
  /** Whether stylus button handling is enabled */
  active: boolean;
  /** Action for primary button */
  primaryButtonAction: ButtonAction;
  /** Action for secondary button */
  secondaryButtonAction: ButtonAction;
}

/**
 * Default stylus buttons configuration
 */
export const DEFAULT_STYLUS_BUTTONS_CONFIG: StylusButtonsConfigData = {
  active: true,
  primaryButtonAction: 'toggle-transpose',
  secondaryButtonAction: 'toggle-repeater',
};

/**
 * Configuration for stylus button actions.
 * Maps the primary and secondary stylus buttons to actions.
 */
export class StylusButtonsConfig implements StylusButtonsConfigData {
  active: boolean;
  primaryButtonAction: ButtonAction;
  secondaryButtonAction: ButtonAction;

  constructor(data: Partial<StylusButtonsConfigData> = {}) {
    this.active = data.active ?? DEFAULT_STYLUS_BUTTONS_CONFIG.active;
    this.primaryButtonAction = data.primaryButtonAction ?? DEFAULT_STYLUS_BUTTONS_CONFIG.primaryButtonAction;
    this.secondaryButtonAction = data.secondaryButtonAction ?? DEFAULT_STYLUS_BUTTONS_CONFIG.secondaryButtonAction;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): StylusButtonsConfig {
    return new StylusButtonsConfig({
      active: data.active as boolean | undefined,
      primaryButtonAction: (data.primary_button_action ?? data.primaryButtonAction) as ButtonAction | undefined,
      secondaryButtonAction: (data.secondary_button_action ?? data.secondaryButtonAction) as ButtonAction | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): StylusButtonsConfigData {
    return {
      active: this.active,
      primaryButtonAction: this.primaryButtonAction,
      secondaryButtonAction: this.secondaryButtonAction,
    };
  }
}

/**
 * Strum release configuration data
 */
export interface StrumReleaseConfigData {
  /** Whether strum release is enabled */
  active: boolean;
  /** MIDI note number to send on release (e.g., 38 for snare) */
  midiNote: number;
  /** MIDI channel for release note (null = same as strummer) */
  midiChannel: number | null;
  /** Maximum duration of the release note in seconds */
  maxDuration: number;
  /** Scale factor for release velocity */
  velocityMultiplier: number;
}

/**
 * Default strum release configuration
 */
export const DEFAULT_STRUM_RELEASE_CONFIG: StrumReleaseConfigData = {
  active: false,
  midiNote: 38,
  midiChannel: null,
  maxDuration: 0.25,
  velocityMultiplier: 1.0,
};

/**
 * Configuration for the strum release feature.
 * When active, a release event triggers a specific MIDI note (e.g., for drum sounds).
 */
export class StrumReleaseConfig implements StrumReleaseConfigData {
  active: boolean;
  midiNote: number;
  midiChannel: number | null;
  maxDuration: number;
  velocityMultiplier: number;

  constructor(data: Partial<StrumReleaseConfigData> = {}) {
    this.active = data.active ?? DEFAULT_STRUM_RELEASE_CONFIG.active;
    this.midiNote = data.midiNote ?? DEFAULT_STRUM_RELEASE_CONFIG.midiNote;
    this.midiChannel = data.midiChannel ?? DEFAULT_STRUM_RELEASE_CONFIG.midiChannel;
    this.maxDuration = data.maxDuration ?? DEFAULT_STRUM_RELEASE_CONFIG.maxDuration;
    this.velocityMultiplier = data.velocityMultiplier ?? DEFAULT_STRUM_RELEASE_CONFIG.velocityMultiplier;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): StrumReleaseConfig {
    return new StrumReleaseConfig({
      active: data.active as boolean | undefined,
      midiNote: (data.midi_note ?? data.midiNote) as number | undefined,
      midiChannel: (data.midi_channel ?? data.midiChannel) as number | null | undefined,
      maxDuration: (data.max_duration ?? data.maxDuration) as number | undefined,
      velocityMultiplier: (data.velocity_multiplier ?? data.velocityMultiplier) as number | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): StrumReleaseConfigData {
    return {
      active: this.active,
      midiNote: this.midiNote,
      midiChannel: this.midiChannel,
      maxDuration: this.maxDuration,
      velocityMultiplier: this.velocityMultiplier,
    };
  }
}
