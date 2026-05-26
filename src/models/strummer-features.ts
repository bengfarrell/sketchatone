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
 * Slider (trombone-style) configuration data.
 *
 * Tuning parameters specific to the Slider; the note layout (initialNotes,
 * chord, spreads, midiChannel, invertX) is shared with StrummingConfig.
 */
export type PressureModulationType = 'none' | 'aftertouch' | 'cc';

export const VALID_PRESSURE_MODULATION_TYPES: readonly PressureModulationType[] = [
  'none', 'aftertouch', 'cc',
] as const;

export const DEFAULT_PRESSURE_MODULATION_TYPE: PressureModulationType = 'aftertouch';

/**
 * Common Control Change presets surfaced in slide-mode pressure modulation UIs.
 */
export interface PressureModulationCcPreset {
  readonly label: string;
  readonly ccNumber: number;
}

export const PRESSURE_MODULATION_CC_PRESETS: readonly PressureModulationCcPreset[] = [
  { label: 'CC1 Mod Wheel', ccNumber: 1 },
  { label: 'CC2 Breath', ccNumber: 2 },
  { label: 'CC7 Volume', ccNumber: 7 },
  { label: 'CC11 Expression', ccNumber: 11 },
  { label: 'CC74 Brightness', ccNumber: 74 },
] as const;

/**
 * Configuration for routing held-note pressure in slide mode.
 */
export interface PressureModulationConfigData {
  /** 'none' (disabled), 'aftertouch' (channel pressure), or 'cc' */
  type: PressureModulationType;
  /** CC number to send when type === 'cc' (default 11 = Expression) */
  ccNumber: number;
  /** MIDI value at pressure == pressureThreshold (0-127) */
  minValue: number;
  /** MIDI value at pressure == 1.0 (0-127) */
  maxValue: number;
}

export const DEFAULT_PRESSURE_MODULATION_CONFIG: PressureModulationConfigData = {
  type: DEFAULT_PRESSURE_MODULATION_TYPE,
  ccNumber: 11,
  minValue: 0,
  maxValue: 127,
};

export class PressureModulationConfig implements PressureModulationConfigData {
  type: PressureModulationType;
  ccNumber: number;
  minValue: number;
  maxValue: number;

  constructor(data: Partial<PressureModulationConfigData> = {}) {
    const rawType = data.type ?? DEFAULT_PRESSURE_MODULATION_CONFIG.type;
    this.type = (VALID_PRESSURE_MODULATION_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : DEFAULT_PRESSURE_MODULATION_CONFIG.type;
    this.ccNumber = data.ccNumber ?? DEFAULT_PRESSURE_MODULATION_CONFIG.ccNumber;
    this.minValue = data.minValue ?? DEFAULT_PRESSURE_MODULATION_CONFIG.minValue;
    this.maxValue = data.maxValue ?? DEFAULT_PRESSURE_MODULATION_CONFIG.maxValue;
  }

  static fromDict(data: Record<string, unknown>): PressureModulationConfig {
    return new PressureModulationConfig({
      type: (data.type ?? undefined) as PressureModulationType | undefined,
      ccNumber: (data.cc_number ?? data.ccNumber) as number | undefined,
      minValue: (data.min_value ?? data.minValue) as number | undefined,
      maxValue: (data.max_value ?? data.maxValue) as number | undefined,
    });
  }

  toDict(): PressureModulationConfigData {
    return {
      type: this.type,
      ccNumber: this.ccNumber,
      minValue: this.minValue,
      maxValue: this.maxValue,
    };
  }
}

export interface SliderConfigData {
  /** Minimum pressure to register pen-down (0-1) */
  pressureThreshold: number;
  /**
   * Maximum signed pitch bend in semitones. Should match the synth's
   * configured pitch-bend range so the interpolation between adjacent
   * strings reaches exactly the neighbor's pitch.
   */
  maxBendSemitones: number;
  /** How held-note pressure is routed to MIDI. */
  pressureModulation: PressureModulationConfigData;
}

/**
 * Default slider configuration
 */
export const DEFAULT_SLIDER_CONFIG: SliderConfigData = {
  pressureThreshold: 0.1,
  maxBendSemitones: 24.0,
  pressureModulation: { ...DEFAULT_PRESSURE_MODULATION_CONFIG },
};

/**
 * Configuration for the slider (trombone-style) mode.
 */
export class SliderConfig implements SliderConfigData {
  pressureThreshold: number;
  maxBendSemitones: number;
  pressureModulation: PressureModulationConfig;

  constructor(data: Partial<SliderConfigData> = {}) {
    this.pressureThreshold = data.pressureThreshold ?? DEFAULT_SLIDER_CONFIG.pressureThreshold;
    this.maxBendSemitones = data.maxBendSemitones ?? DEFAULT_SLIDER_CONFIG.maxBendSemitones;
    this.pressureModulation = data.pressureModulation instanceof PressureModulationConfig
      ? data.pressureModulation
      : new PressureModulationConfig(data.pressureModulation ?? {});
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): SliderConfig {
    const modData = (data.pressure_modulation ?? data.pressureModulation) as
      Record<string, unknown> | undefined;
    return new SliderConfig({
      pressureThreshold: (data.pressure_threshold ?? data.pressureThreshold) as number | undefined,
      maxBendSemitones: (data.max_bend_semitones ?? data.maxBendSemitones) as number | undefined,
      pressureModulation: modData ? PressureModulationConfig.fromDict(modData) : undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): SliderConfigData {
    return {
      pressureThreshold: this.pressureThreshold,
      maxBendSemitones: this.maxBendSemitones,
      pressureModulation: this.pressureModulation.toDict(),
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
