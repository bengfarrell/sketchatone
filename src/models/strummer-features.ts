/**
 * Strummer Feature Config Models
 *
 * Configuration models for optional strummer features.
 * Based on midi-strummer's feature configuration system.
 */

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
 * Based on midi-strummer's chord_progressions.json
 */
export const CHORD_PROGRESSION_PRESETS: Record<string, string[]> = {
  // Major key progressions
  'c-major-basic': ['C', 'F', 'G', 'Am'],
  'c-major-pop': ['C', 'G', 'Am', 'F'], // I-V-vi-IV
  'c-major-jazz': ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7'],
  'c-major-50s': ['C', 'Am', 'F', 'G'], // I-vi-IV-V
  'g-major-basic': ['G', 'C', 'D', 'Em'],
  'g-major-pop': ['G', 'D', 'Em', 'C'], // I-V-vi-IV in G
  'g-major-jazz': ['Gmaj7', 'Am7', 'Bm7', 'Cmaj7', 'D7', 'Em7', 'F#m7'],
  'd-major-basic': ['D', 'G', 'A', 'Bm'],
  'd-major-pop': ['D', 'A', 'Bm', 'G'], // I-V-vi-IV in D
  'd-major-jazz': ['Dmaj7', 'Em7', 'F#m7', 'Gmaj7', 'A7', 'Bm7', 'C#m7'],
  'a-major-basic': ['A', 'D', 'E', 'F#m'],
  'a-major-pop': ['A', 'E', 'F#m', 'D'], // I-V-vi-IV in A
  'e-major-basic': ['E', 'A', 'B', 'C#m'],
  'e-major-pop': ['E', 'B', 'C#m', 'A'], // I-V-vi-IV in E
  'f-major-basic': ['F', 'Bb', 'C', 'Dm'],
  'f-major-pop': ['F', 'C', 'Dm', 'Bb'], // I-V-vi-IV in F

  // Minor key progressions
  'a-minor-basic': ['Am', 'Dm', 'Em', 'F', 'E'],
  'a-minor-pop': ['Am', 'F', 'C', 'G', 'E'], // i-VI-III-VII
  'a-minor-sad': ['Am', 'Em', 'F', 'C', 'G', 'Dm', 'E'],
  'e-minor-basic': ['Em', 'Am', 'Bm', 'C', 'B'],
  'e-minor-pop': ['Em', 'C', 'G', 'D', 'B'], // i-VI-III-VII in Em
  'd-minor-basic': ['Dm', 'Gm', 'Am', 'Bb', 'A'],
  'd-minor-pop': ['Dm', 'Bb', 'F', 'C', 'A'], // i-VI-III-VII in Dm

  // Blues progressions
  'blues-e': ['E7', 'A7', 'B7'],
  'blues-a': ['A7', 'D7', 'E7'],
  'blues-g': ['G7', 'C7', 'D7'],

  // Rock progressions
  'rock-classic': ['E', 'A', 'D', 'B'],
  'rock-power': ['E5', 'G5', 'A5', 'C5', 'D5'],

  // Jazz progressions
  'jazz-251-c': ['Dm7', 'G7', 'Cmaj7', 'Em7', 'A7'],
  'jazz-251-f': ['Gm7', 'C7', 'Fmaj7', 'Am7', 'D7'],

  // Gospel progressions
  'gospel-c': ['C', 'Am7', 'Dm7', 'G7', 'F'],
  'gospel-g': ['G', 'Em7', 'Am7', 'D7', 'C'],
};

/**
 * Get list of available preset names
 */
export function getChordProgressionPresetNames(): string[] {
  return Object.keys(CHORD_PROGRESSION_PRESETS);
}
