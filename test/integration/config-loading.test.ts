/**
 * Integration tests for config loading via CLI
 * 
 * These tests verify that config files are correctly loaded and parsed
 * by running the CLI with --dump-config and checking the output.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

const CLI_PATH = path.resolve(__dirname, '../../dist/cli/server.js');
const FIXTURES_PATH = path.resolve(__dirname, '../fixtures');

/**
 * Run the CLI with --dump-config and return parsed JSON
 */
function dumpConfig(configPath: string): Record<string, unknown> {
  const output = execSync(`node ${CLI_PATH} -s ${configPath} --dump-config`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '../..'),
  });
  return JSON.parse(output);
}

describe('Config Loading Integration Tests', () => {
  describe('Flat format config (snake_case keys)', () => {
    const configPath = path.join(FIXTURES_PATH, 'config-flat-format.json');
    let config: Record<string, unknown>;

    it('should load config without errors', () => {
      config = dumpConfig(configPath);
      expect(config).toBeDefined();
      expect(config.strummer).toBeDefined();
      expect(config.midi).toBeDefined();
      expect(config.server).toBeDefined();
    });

    it('should correctly load noteDuration settings', () => {
      config = dumpConfig(configPath);
      const noteDuration = (config.strummer as Record<string, unknown>).noteDuration as Record<string, unknown>;
      expect(noteDuration.min).toBe(0.2);
      expect(noteDuration.max).toBe(2);
      expect(noteDuration.multiplier).toBe(1.5);
      expect(noteDuration.curve).toBe(2.5);
      expect(noteDuration.spread).toBe('inverse');
      expect(noteDuration.control).toBe('tiltXY');
      expect(noteDuration.default).toBe(0.8);
    });

    it('should correctly load pitchBend settings', () => {
      config = dumpConfig(configPath);
      const pitchBend = (config.strummer as Record<string, unknown>).pitchBend as Record<string, unknown>;
      expect(pitchBend.min).toBe(-0.5);
      expect(pitchBend.max).toBe(0.5);
      expect(pitchBend.multiplier).toBe(0.8);
      expect(pitchBend.curve).toBe(3);
      expect(pitchBend.spread).toBe('central');
      expect(pitchBend.control).toBe('yaxis');
    });

    it('should correctly load noteVelocity settings', () => {
      config = dumpConfig(configPath);
      const noteVelocity = (config.strummer as Record<string, unknown>).noteVelocity as Record<string, unknown>;
      expect(noteVelocity.min).toBe(10);
      expect(noteVelocity.max).toBe(100);
      expect(noteVelocity.multiplier).toBe(1.2);
      expect(noteVelocity.curve).toBe(2);
      expect(noteVelocity.spread).toBe('direct');
    });

    it('should correctly load strumming settings', () => {
      config = dumpConfig(configPath);
      const strumming = (config.strummer as Record<string, unknown>).strumming as Record<string, unknown>;
      expect(strumming.pluckVelocityScale).toBe(3.5);
      expect(strumming.pressureThreshold).toBe(0.15);
      expect(strumming.midiChannel).toBe(2);
      expect(strumming.initialNotes).toEqual(['D4', 'F#4', 'A4']);
      expect(strumming.chord).toBe('Dm');
      expect(strumming.upperNoteSpread).toBe(4);
      expect(strumming.lowerNoteSpread).toBe(2);
    });

    it('should correctly load noteRepeater settings', () => {
      config = dumpConfig(configPath);
      const noteRepeater = (config.strummer as Record<string, unknown>).noteRepeater as Record<string, unknown>;
      expect(noteRepeater.active).toBe(true);
      expect(noteRepeater.pressureMultiplier).toBe(2);
      expect(noteRepeater.frequencyMultiplier).toBe(1.5);
    });

    it('should correctly load transpose settings', () => {
      config = dumpConfig(configPath);
      const transpose = (config.strummer as Record<string, unknown>).transpose as Record<string, unknown>;
      expect(transpose.active).toBe(true);
      expect(transpose.semitones).toBe(7);
    });

    it('should correctly load stylusButtons settings', () => {
      config = dumpConfig(configPath);
      const stylusButtons = (config.strummer as Record<string, unknown>).stylusButtons as Record<string, unknown>;
      expect(stylusButtons.active).toBe(false);
      expect(stylusButtons.primaryButtonAction).toBe('toggle-repeater');
      expect(stylusButtons.secondaryButtonAction).toBe('toggle-transpose');
    });

    it('should correctly load strumRelease settings', () => {
      config = dumpConfig(configPath);
      const strumRelease = (config.strummer as Record<string, unknown>).strumRelease as Record<string, unknown>;
      expect(strumRelease.active).toBe(true);
      expect(strumRelease.midiNote).toBe(42);
      expect(strumRelease.midiChannel).toBe(3);
      expect(strumRelease.maxDuration).toBe(0.5);
      expect(strumRelease.velocityMultiplier).toBe(0.8);
    });

    it('should correctly load tabletButtons settings', () => {
      config = dumpConfig(configPath);
      const tabletButtons = (config.strummer as Record<string, unknown>).tabletButtons as Record<string, unknown>;
      expect(tabletButtons.preset).toBe('jazz-standards');
      expect(tabletButtons.chords).toEqual(['Dm7', 'G7', 'Cmaj7', 'Fmaj7']);
      expect(tabletButtons.currentIndex).toBe(2);
    });

    it('should correctly load midi settings', () => {
      config = dumpConfig(configPath);
      const midi = config.midi as Record<string, unknown>;
      expect(midi.outputPort).toBe('Test Port');
      expect(midi.inputPort).toBeNull();
      expect(midi.channel).toBe(5);
      expect(midi.useVirtualPorts).toBe(true);
    });

    it('should correctly load server settings', () => {
      config = dumpConfig(configPath);
      const server = config.server as Record<string, unknown>;
      expect(server.httpPort).toBe(3000);
      expect(server.wsPort).toBe(9000);
      expect(server.wsMessageThrottle).toBe(200);
      expect(server.deviceFindingPollInterval).toBe(3000);
    });
  });

  describe('Nested format config (camelCase keys with strummer wrapper)', () => {
    const configPath = path.join(FIXTURES_PATH, 'config-nested-format.json');
    let config: Record<string, unknown>;

    it('should load config without errors', () => {
      config = dumpConfig(configPath);
      expect(config).toBeDefined();
      expect(config.strummer).toBeDefined();
    });

    it('should correctly load noteDuration settings', () => {
      config = dumpConfig(configPath);
      const noteDuration = (config.strummer as Record<string, unknown>).noteDuration as Record<string, unknown>;
      expect(noteDuration.min).toBe(0.3);
      expect(noteDuration.max).toBe(1.8);
      expect(noteDuration.curve).toBe(1.5);
      expect(noteDuration.spread).toBe('direct');
      expect(noteDuration.control).toBe('pressure');
    });

    it('should correctly load noteRepeater settings', () => {
      config = dumpConfig(configPath);
      const noteRepeater = (config.strummer as Record<string, unknown>).noteRepeater as Record<string, unknown>;
      expect(noteRepeater.active).toBe(false);
      expect(noteRepeater.pressureMultiplier).toBe(3);
      expect(noteRepeater.frequencyMultiplier).toBe(2);
    });

    it('should correctly load transpose settings', () => {
      config = dumpConfig(configPath);
      const transpose = (config.strummer as Record<string, unknown>).transpose as Record<string, unknown>;
      expect(transpose.active).toBe(false);
      expect(transpose.semitones).toBe(-5);
    });

    it('should correctly load stylusButtons settings', () => {
      config = dumpConfig(configPath);
      const stylusButtons = (config.strummer as Record<string, unknown>).stylusButtons as Record<string, unknown>;
      expect(stylusButtons.active).toBe(true);
      expect(stylusButtons.primaryButtonAction).toBe('none');
      expect(stylusButtons.secondaryButtonAction).toBe('toggle-repeater');
    });

    it('should correctly load midi settings', () => {
      config = dumpConfig(configPath);
      const midi = config.midi as Record<string, unknown>;
      expect(midi.outputPort).toBe('Virtual MIDI');
      expect(midi.inputPort).toBe('Input Port');
      expect(midi.channel).toBe(8);
      expect(midi.useVirtualPorts).toBe(false);
    });

    it('should correctly load server settings', () => {
      config = dumpConfig(configPath);
      const server = config.server as Record<string, unknown>;
      expect(server.httpPort).toBe(4000);
      expect(server.wsPort).toBe(9500);
      expect(server.wsMessageThrottle).toBe(100);
      expect(server.deviceFindingPollInterval).toBe(5000);
    });
  });
});
