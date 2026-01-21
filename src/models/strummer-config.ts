/**
 * Strummer Config Model
 *
 * Configuration model for strummer-specific settings.
 * Ported from Python sketchatone/models/strummer_config.py
 */

import * as fs from 'fs';

/**
 * Configuration for the strummer.
 */
export interface StrummerConfigData {
  /** Minimum pressure to trigger a strum (0-1) */
  pressureThreshold: number;
  /** Scale factor for velocity (0-1) */
  velocityScale: number;
  /** List of note strings for the strum (e.g., ["C4", "E4", "G4"]) */
  notes: string[];
  /** Optional chord notation (e.g., "Am", "Gmaj7") */
  chord?: string;
  /** Number of notes to add below the chord */
  lowerSpread: number;
  /** Number of notes to add above the chord */
  upperSpread: number;
  /** Default strum direction ("up" or "down") */
  strumDirection: 'up' | 'down';
  /** Speed of strum in ms between notes */
  strumSpeed: number;
  /** How long notes sustain in ms */
  sustainTime: number;
  /** MIDI channel (0-15) */
  channel: number;
}

/**
 * Default strummer configuration values
 */
export const DEFAULT_STRUMMER_CONFIG: StrummerConfigData = {
  pressureThreshold: 0.1,
  velocityScale: 1.0,
  notes: ['C4', 'E4', 'G4', 'C5'],
  chord: undefined,
  lowerSpread: 0,
  upperSpread: 0,
  strumDirection: 'down',
  strumSpeed: 20.0,
  sustainTime: 500.0,
  channel: 0,
};

/**
 * StrummerConfig class for managing strummer configuration
 */
export class StrummerConfig implements StrummerConfigData {
  pressureThreshold: number;
  velocityScale: number;
  notes: string[];
  chord?: string;
  lowerSpread: number;
  upperSpread: number;
  strumDirection: 'up' | 'down';
  strumSpeed: number;
  sustainTime: number;
  channel: number;

  constructor(data: Partial<StrummerConfigData> = {}) {
    this.pressureThreshold = data.pressureThreshold ?? DEFAULT_STRUMMER_CONFIG.pressureThreshold;
    this.velocityScale = data.velocityScale ?? DEFAULT_STRUMMER_CONFIG.velocityScale;
    this.notes = data.notes ?? [...DEFAULT_STRUMMER_CONFIG.notes];
    this.chord = data.chord;
    this.lowerSpread = data.lowerSpread ?? DEFAULT_STRUMMER_CONFIG.lowerSpread;
    this.upperSpread = data.upperSpread ?? DEFAULT_STRUMMER_CONFIG.upperSpread;
    this.strumDirection = data.strumDirection ?? DEFAULT_STRUMMER_CONFIG.strumDirection;
    this.strumSpeed = data.strumSpeed ?? DEFAULT_STRUMMER_CONFIG.strumSpeed;
    this.sustainTime = data.sustainTime ?? DEFAULT_STRUMMER_CONFIG.sustainTime;
    this.channel = data.channel ?? DEFAULT_STRUMMER_CONFIG.channel;
  }

  /**
   * Create a StrummerConfig from a dictionary (snake_case keys supported)
   */
  static fromDict(data: Record<string, unknown>): StrummerConfig {
    return new StrummerConfig({
      pressureThreshold: (data.pressure_threshold ?? data.pressureThreshold) as number | undefined,
      velocityScale: (data.velocity_scale ?? data.velocityScale) as number | undefined,
      notes: (data.notes as string[] | undefined),
      chord: (data.chord as string | undefined),
      lowerSpread: (data.lower_spread ?? data.lowerSpread) as number | undefined,
      upperSpread: (data.upper_spread ?? data.upperSpread) as number | undefined,
      strumDirection: (data.strum_direction ?? data.strumDirection) as 'up' | 'down' | undefined,
      strumSpeed: (data.strum_speed ?? data.strumSpeed) as number | undefined,
      sustainTime: (data.sustain_time ?? data.sustainTime) as number | undefined,
      channel: (data.channel as number | undefined),
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
      pressureThreshold: this.pressureThreshold,
      velocityScale: this.velocityScale,
      notes: this.notes,
      chord: this.chord,
      lowerSpread: this.lowerSpread,
      upperSpread: this.upperSpread,
      strumDirection: this.strumDirection,
      strumSpeed: this.strumSpeed,
      sustainTime: this.sustainTime,
      channel: this.channel,
    };
  }

  /**
   * Save the config to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}
