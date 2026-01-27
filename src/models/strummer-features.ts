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

/**
 * Chord progression presets
 * Maps preset names to arrays of chord names for tablet buttons
 */
export const CHORD_PROGRESSION_PRESETS: Record<string, string[]> = {
  'c-major-pop': ['C', 'G', 'Am', 'F'], // I-V-vi-IV
  'c-major-50s': ['C', 'Am', 'F', 'G'], // I-vi-IV-V
  'g-major-pop': ['G', 'D', 'Em', 'C'], // I-V-vi-IV in G
  'd-major-pop': ['D', 'A', 'Bm', 'G'], // I-V-vi-IV in D
  'a-major-pop': ['A', 'E', 'F#m', 'D'], // I-V-vi-IV in A
  'e-major-pop': ['E', 'B', 'C#m', 'A'], // I-V-vi-IV in E
  'f-major-pop': ['F', 'C', 'Dm', 'Bb'], // I-V-vi-IV in F
  'am-minor': ['Am', 'F', 'C', 'G'], // i-VI-III-VII (Aeolian)
  'em-minor': ['Em', 'C', 'G', 'D'], // i-VI-III-VII in Em
  'dm-minor': ['Dm', 'Bb', 'F', 'C'], // i-VI-III-VII in Dm
};

/**
 * Get list of available preset names
 */
export function getChordProgressionPresetNames(): string[] {
  return Object.keys(CHORD_PROGRESSION_PRESETS);
}

/**
 * Tablet buttons configuration data
 */
export interface TabletButtonsConfigData {
  /** Preset name (e.g., 'c-major-pop') or 'custom' for custom chords */
  preset: string;
  /** Chord names for each button (derived from preset or custom) */
  chords: string[];
  /** Currently active chord index (0-based) */
  currentIndex: number;
}

/**
 * Default tablet buttons configuration
 */
export const DEFAULT_TABLET_BUTTONS_CONFIG: TabletButtonsConfigData = {
  preset: 'c-major-pop',
  chords: ['C', 'G', 'Am', 'F'],
  currentIndex: 0,
};

/**
 * Configuration for tablet button chord progression.
 * Maps tablet buttons to chords in a progression.
 */
export class TabletButtonsConfig implements TabletButtonsConfigData {
  preset: string;
  chords: string[];
  currentIndex: number;

  constructor(data: Partial<TabletButtonsConfigData> = {}) {
    this.preset = data.preset ?? DEFAULT_TABLET_BUTTONS_CONFIG.preset;
    // If preset is provided and valid, use its chords; otherwise use provided chords or default
    if (this.preset !== 'custom' && CHORD_PROGRESSION_PRESETS[this.preset]) {
      this.chords = CHORD_PROGRESSION_PRESETS[this.preset];
    } else {
      this.chords = data.chords ?? DEFAULT_TABLET_BUTTONS_CONFIG.chords;
    }
    this.currentIndex = data.currentIndex ?? DEFAULT_TABLET_BUTTONS_CONFIG.currentIndex;
  }

  /**
   * Create from dictionary or preset string
   * Supports both object format and simple string preset format
   */
  static fromDict(data: Record<string, unknown> | string): TabletButtonsConfig {
    // Handle simple string preset format (e.g., "c-major-pop")
    if (typeof data === 'string') {
      const preset = data;
      const chords = CHORD_PROGRESSION_PRESETS[preset] ?? DEFAULT_TABLET_BUTTONS_CONFIG.chords;
      return new TabletButtonsConfig({
        preset,
        chords,
        currentIndex: 0,
      });
    }

    // Handle object format
    return new TabletButtonsConfig({
      preset: data.preset as string | undefined,
      chords: data.chords as string[] | undefined,
      currentIndex: (data.current_index ?? data.currentIndex) as number | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): TabletButtonsConfigData {
    return {
      preset: this.preset,
      chords: this.chords,
      currentIndex: this.currentIndex,
    };
  }

  /**
   * Get the currently active chord
   */
  getCurrentChord(): string {
    return this.chords[this.currentIndex] ?? this.chords[0];
  }

  /**
   * Advance to the next chord in the progression
   */
  nextChord(): string {
    this.currentIndex = (this.currentIndex + 1) % this.chords.length;
    return this.getCurrentChord();
  }

  /**
   * Go to the previous chord in the progression
   */
  prevChord(): string {
    this.currentIndex = (this.currentIndex - 1 + this.chords.length) % this.chords.length;
    return this.getCurrentChord();
  }

  /**
   * Set chord by button index (1-based, like tablet buttons)
   */
  setChordByButton(buttonNumber: number): string {
    const index = buttonNumber - 1;
    if (index >= 0 && index < this.chords.length) {
      this.currentIndex = index;
    }
    return this.getCurrentChord();
  }
}
