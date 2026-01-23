/**
 * Parameter Mapping Model
 *
 * Configuration model for mapping tablet inputs to output values.
 * Based on midi-strummer's parameter mapping system.
 */

/**
 * Control sources from tablet input
 */
export type ControlSource =
  | 'pressure'    // Pen pressure (0-1)
  | 'tiltX'       // Pen tilt X axis
  | 'tiltY'       // Pen tilt Y axis
  | 'tiltXY'      // Combined tilt magnitude
  | 'xaxis'       // X position (normalized 0-1)
  | 'yaxis'       // Y position (normalized 0-1)
  | 'velocity'    // Movement velocity
  | 'none';       // No control (use default)

/**
 * Spread types for how values are distributed
 */
export type SpreadType =
  | 'direct'      // Linear mapping: 0→min, 1→max
  | 'inverse'     // Inverse mapping: 0→max, 1→min
  | 'central'     // Central mapping: 0.5→0, edges→±max
  | 'none';       // No spread, use default

/**
 * Parameter mapping data interface
 */
export interface ParameterMappingData {
  /** Minimum output value */
  min: number;
  /** Maximum output value */
  max: number;
  /** Scale factor applied to the mapped value */
  multiplier: number;
  /** Curve exponent (1.0=linear, >1=exponential, <1=logarithmic) */
  curve: number;
  /** How the input range maps to output */
  spread: SpreadType;
  /** Input source */
  control: ControlSource;
  /** Default value when control is "none" or input is unavailable */
  default: number;
}

/**
 * Default parameter mapping values
 */
export const DEFAULT_PARAMETER_MAPPING: ParameterMappingData = {
  min: 0.0,
  max: 1.0,
  multiplier: 1.0,
  curve: 1.0,
  spread: 'direct',
  control: 'none',
  default: 0.5,
};

/**
 * Maps a tablet input control to an output parameter value.
 *
 * The mapping applies:
 * 1. Control source selection (pressure, tilt, position, etc.)
 * 2. Curve shaping (exponential/logarithmic response)
 * 3. Range mapping (min/max with multiplier)
 * 4. Spread type (direct, inverse, central)
 */
export class ParameterMapping implements ParameterMappingData {
  min: number;
  max: number;
  multiplier: number;
  curve: number;
  spread: SpreadType;
  control: ControlSource;
  default: number;

  constructor(data: Partial<ParameterMappingData> = {}) {
    this.min = data.min ?? DEFAULT_PARAMETER_MAPPING.min;
    this.max = data.max ?? DEFAULT_PARAMETER_MAPPING.max;
    this.multiplier = data.multiplier ?? DEFAULT_PARAMETER_MAPPING.multiplier;
    this.curve = data.curve ?? DEFAULT_PARAMETER_MAPPING.curve;
    this.spread = data.spread ?? DEFAULT_PARAMETER_MAPPING.spread;
    this.control = data.control ?? DEFAULT_PARAMETER_MAPPING.control;
    this.default = data.default ?? DEFAULT_PARAMETER_MAPPING.default;
  }

  /**
   * Map an input value (0-1) to the output range.
   *
   * @param inputValue - Normalized input value (0.0 to 1.0)
   * @returns Mapped output value within [min, max] range
   */
  mapValue(inputValue: number): number {
    if (this.control === 'none') {
      return this.default * this.multiplier;
    }

    // Clamp input to 0-1
    let value = Math.max(0.0, Math.min(1.0, inputValue));

    // Apply spread type
    if (this.spread === 'inverse') {
      value = 1.0 - value;
    } else if (this.spread === 'central') {
      // Map 0.5 to 0, edges to ±1
      value = (value - 0.5) * 2.0;
    }

    // Apply curve (power function)
    if (this.curve !== 1.0) {
      if (this.spread === 'central') {
        // Preserve sign for central spread
        const sign = value >= 0 ? 1.0 : -1.0;
        value = sign * Math.pow(Math.abs(value), this.curve);
      } else {
        value = Math.pow(value, this.curve);
      }
    }

    // Map to output range
    let output: number;
    if (this.spread === 'central') {
      // Central: map -1 to 1 → min to max (with 0 at center)
      const center = (this.min + this.max) / 2.0;
      const halfRange = (this.max - this.min) / 2.0;
      output = center + value * halfRange;
    } else {
      // Direct/Inverse: map 0 to 1 → min to max
      output = this.min + value * (this.max - this.min);
    }

    // Apply multiplier
    return output * this.multiplier;
  }

  /**
   * Create a ParameterMapping from a dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): ParameterMapping {
    return new ParameterMapping({
      min: data.min as number | undefined,
      max: data.max as number | undefined,
      multiplier: data.multiplier as number | undefined,
      curve: data.curve as number | undefined,
      spread: data.spread as SpreadType | undefined,
      control: data.control as ControlSource | undefined,
      default: data.default as number | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): ParameterMappingData {
    return {
      min: this.min,
      max: this.max,
      multiplier: this.multiplier,
      curve: this.curve,
      spread: this.spread,
      control: this.control,
      default: this.default,
    };
  }
}

/**
 * Default note duration mapping (tilt controls duration)
 */
export function defaultNoteDuration(): ParameterMapping {
  return new ParameterMapping({
    min: 0.15,
    max: 1.5,
    multiplier: 1.0,
    curve: 1.0,
    spread: 'inverse',
    control: 'tiltXY',
    default: 1.0,
  });
}

/**
 * Default pitch bend mapping (Y axis controls bend)
 */
export function defaultPitchBend(): ParameterMapping {
  return new ParameterMapping({
    min: -1.0,
    max: 1.0,
    multiplier: 1.0,
    curve: 4.0,
    spread: 'central',
    control: 'yaxis',
    default: 0.0,
  });
}

/**
 * Default note velocity mapping (pressure controls velocity)
 */
export function defaultNoteVelocity(): ParameterMapping {
  return new ParameterMapping({
    min: 0,
    max: 127,
    multiplier: 1.0,
    curve: 4.0,
    spread: 'direct',
    control: 'pressure',
    default: 64,
  });
}
