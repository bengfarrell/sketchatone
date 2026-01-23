import { describe, it, expect } from 'vitest';
import {
  ParameterMapping,
  DEFAULT_PARAMETER_MAPPING,
  defaultNoteDuration,
  defaultPitchBend,
  defaultNoteVelocity,
} from '../../src/models/parameter-mapping';

describe('ParameterMapping', () => {
  describe('Basic', () => {
    it('should have correct default values', () => {
      const mapping = new ParameterMapping();
      expect(mapping.min).toBe(0.0);
      expect(mapping.max).toBe(1.0);
      expect(mapping.multiplier).toBe(1.0);
      expect(mapping.curve).toBe(1.0);
      expect(mapping.spread).toBe('direct');
      expect(mapping.control).toBe('none');
      expect(mapping.default).toBe(0.5);
    });

    it('should create from dictionary', () => {
      const mapping = ParameterMapping.fromDict({
        min: 0.2,
        max: 0.8,
        multiplier: 2.0,
        curve: 2.0,
        spread: 'inverse',
        control: 'pressure',
        default: 0.7,
      });
      expect(mapping.min).toBe(0.2);
      expect(mapping.max).toBe(0.8);
      expect(mapping.multiplier).toBe(2.0);
      expect(mapping.curve).toBe(2.0);
      expect(mapping.spread).toBe('inverse');
      expect(mapping.control).toBe('pressure');
      expect(mapping.default).toBe(0.7);
    });

    it('should convert to dictionary', () => {
      const mapping = new ParameterMapping({
        min: 0.1,
        max: 0.9,
        multiplier: 1.5,
        curve: 3.0,
        spread: 'central',
        control: 'tiltX',
        default: 0.3,
      });
      const dict = mapping.toDict();
      expect(dict.min).toBe(0.1);
      expect(dict.max).toBe(0.9);
      expect(dict.multiplier).toBe(1.5);
      expect(dict.curve).toBe(3.0);
      expect(dict.spread).toBe('central');
      expect(dict.control).toBe('tiltX');
      expect(dict.default).toBe(0.3);
    });

    it('should roundtrip through dictionary', () => {
      const original = new ParameterMapping({
        min: 0.25,
        max: 0.75,
        multiplier: 1.2,
        curve: 2.5,
        spread: 'inverse',
        control: 'velocity',
        default: 0.6,
      });
      const dict = original.toDict();
      const restored = ParameterMapping.fromDict(dict);
      expect(restored.min).toBe(original.min);
      expect(restored.max).toBe(original.max);
      expect(restored.multiplier).toBe(original.multiplier);
      expect(restored.curve).toBe(original.curve);
      expect(restored.spread).toBe(original.spread);
      expect(restored.control).toBe(original.control);
      expect(restored.default).toBe(original.default);
    });
  });

  describe('mapValue', () => {
    it('should return default when control is none', () => {
      const mapping = new ParameterMapping({
        control: 'none',
        default: 0.5,
        multiplier: 2.0,
      });
      expect(mapping.mapValue(0.7)).toBe(1.0); // 0.5 * 2.0
    });

    it('should map direct spread linearly', () => {
      const mapping = new ParameterMapping({
        min: 0.0,
        max: 100.0,
        multiplier: 1.0,
        curve: 1.0,
        spread: 'direct',
        control: 'pressure',
      });
      expect(mapping.mapValue(0.0)).toBe(0.0);
      expect(mapping.mapValue(0.5)).toBe(50.0);
      expect(mapping.mapValue(1.0)).toBe(100.0);
    });

    it('should map inverse spread', () => {
      const mapping = new ParameterMapping({
        min: 0.0,
        max: 100.0,
        multiplier: 1.0,
        curve: 1.0,
        spread: 'inverse',
        control: 'pressure',
      });
      expect(mapping.mapValue(0.0)).toBe(100.0);
      expect(mapping.mapValue(0.5)).toBe(50.0);
      expect(mapping.mapValue(1.0)).toBe(0.0);
    });

    it('should map central spread', () => {
      const mapping = new ParameterMapping({
        min: -100.0,
        max: 100.0,
        multiplier: 1.0,
        curve: 1.0,
        spread: 'central',
        control: 'yaxis',
      });
      expect(mapping.mapValue(0.5)).toBe(0.0); // Center
      expect(mapping.mapValue(0.0)).toBe(-100.0); // Left edge
      expect(mapping.mapValue(1.0)).toBe(100.0); // Right edge
    });

    it('should apply exponential curve', () => {
      const mapping = new ParameterMapping({
        min: 0.0,
        max: 1.0,
        multiplier: 1.0,
        curve: 2.0, // Exponential
        spread: 'direct',
        control: 'pressure',
      });
      expect(mapping.mapValue(0.0)).toBe(0.0);
      expect(mapping.mapValue(0.5)).toBe(0.25); // 0.5^2 = 0.25
      expect(mapping.mapValue(1.0)).toBe(1.0);
    });

    it('should apply logarithmic curve', () => {
      const mapping = new ParameterMapping({
        min: 0.0,
        max: 1.0,
        multiplier: 1.0,
        curve: 0.5, // Logarithmic
        spread: 'direct',
        control: 'pressure',
      });
      expect(mapping.mapValue(0.0)).toBe(0.0);
      expect(mapping.mapValue(0.25)).toBeCloseTo(0.5); // 0.25^0.5 = 0.5
      expect(mapping.mapValue(1.0)).toBe(1.0);
    });

    it('should apply multiplier', () => {
      const mapping = new ParameterMapping({
        min: 0.0,
        max: 10.0,
        multiplier: 2.0,
        curve: 1.0,
        spread: 'direct',
        control: 'pressure',
      });
      expect(mapping.mapValue(0.5)).toBe(10.0); // 5.0 * 2.0
    });

    it('should clamp input to 0-1', () => {
      const mapping = new ParameterMapping({
        min: 0.0,
        max: 100.0,
        multiplier: 1.0,
        curve: 1.0,
        spread: 'direct',
        control: 'pressure',
      });
      expect(mapping.mapValue(-0.5)).toBe(0.0);
      expect(mapping.mapValue(1.5)).toBe(100.0);
    });

    it('should handle central spread with curve', () => {
      const mapping = new ParameterMapping({
        min: -100.0,
        max: 100.0,
        multiplier: 1.0,
        curve: 2.0,
        spread: 'central',
        control: 'yaxis',
      });
      // At 0.75: (0.75 - 0.5) * 2 = 0.5, then 0.5^2 = 0.25
      // Output: 0 + 0.25 * 100 = 25
      expect(mapping.mapValue(0.75)).toBe(25.0);
      // At 0.25: (0.25 - 0.5) * 2 = -0.5, then -1 * 0.5^2 = -0.25
      // Output: 0 + (-0.25) * 100 = -25
      expect(mapping.mapValue(0.25)).toBe(-25.0);
    });
  });

  describe('Default Mappings', () => {
    it('should create default note duration mapping', () => {
      const mapping = defaultNoteDuration();
      expect(mapping.min).toBe(0.15);
      expect(mapping.max).toBe(1.5);
      expect(mapping.spread).toBe('inverse');
      expect(mapping.control).toBe('tiltXY');
    });

    it('should create default pitch bend mapping', () => {
      const mapping = defaultPitchBend();
      expect(mapping.min).toBe(-1.0);
      expect(mapping.max).toBe(1.0);
      expect(mapping.curve).toBe(4.0);
      expect(mapping.spread).toBe('central');
      expect(mapping.control).toBe('yaxis');
    });

    it('should create default note velocity mapping', () => {
      const mapping = defaultNoteVelocity();
      expect(mapping.min).toBe(0);
      expect(mapping.max).toBe(127);
      expect(mapping.curve).toBe(4.0);
      expect(mapping.spread).toBe('direct');
      expect(mapping.control).toBe('pressure');
    });
  });
});
