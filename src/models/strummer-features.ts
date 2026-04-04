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
 * Get all chord progression names from config.
 * If no progressions provided, returns empty array.
 *
 * @param chordProgressions - Chord progressions from config
 * @returns Array of all progression names
 */
export function getAllChordProgressionNames(chordProgressions?: Record<string, string[]>): string[] {
  return Object.keys(chordProgressions ?? {});
}
