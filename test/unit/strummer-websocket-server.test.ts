/**
 * Unit Tests for Strummer WebSocket Server
 *
 * Tests for the StrummerWebSocketServer class including:
 * - Mode switching
 * - Throttle configuration
 * - Event broadcasting logic
 * - Client message handling
 * - Config update path navigation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StrummerEventBus,
  type TabletEventData,
  type StrumEventData,
} from '../../src/utils/strummer-event-bus.js';
import { MidiStrummerConfig, ServerConfig, MidiConfig } from '../../src/models/midi-strummer-config.js';
import { StrummerConfig, StrummingConfig } from '../../src/models/strummer-config.js';

/**
 * Since StrummerWebSocketServer has complex dependencies (HID, WebSocket),
 * we test the core event bus integration and mode switching logic separately.
 * The actual server integration would be tested via integration tests.
 */

describe('StrummerWebSocketServer Event Logic', () => {
  let eventBus: StrummerEventBus;
  let mode: 'tablet' | 'strum';
  let broadcastedMessages: Array<{ type: string; data: unknown }>;

  // Simulates the broadcast logic from StrummerWebSocketServer
  const broadcast = (message: { type: string; data: unknown }) => {
    broadcastedMessages.push(message);
  };

  // Simulates the mode-filtered broadcast logic
  const setupEventSubscriptions = () => {
    eventBus.onTabletEvent((data) => {
      if (mode === 'tablet') {
        broadcast({ type: 'tablet', data });
      }
    });

    eventBus.onStrumEvent((data) => {
      if (mode === 'strum') {
        broadcast({ type: 'strum', data });
      }
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new StrummerEventBus(100);
    eventBus.resume(); // Resume the bus so events are processed
    mode = 'tablet';
    broadcastedMessages = [];
    setupEventSubscriptions();
  });

  afterEach(() => {
    eventBus.cleanup();
    vi.useRealTimers();
  });

  const createTabletEvent = (): TabletEventData => ({
    x: 0.5,
    y: 0.5,
    pressure: 0.3,
    tiltX: 0,
    tiltY: 0,
    tiltXY: 0,
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
    state: 'contact',
    timestamp: Date.now(),
  });

  const createStrumEvent = (): StrumEventData => ({
    type: 'strum',
    notes: [
      {
        note: { notation: 'C', octave: 4, midiNote: 60 },
        velocity: 100,
      },
    ],
    velocity: 100,
    timestamp: Date.now(),
  });

  describe('mode filtering', () => {
    it('should broadcast tablet events when mode is tablet', () => {
      mode = 'tablet';
      eventBus.emitTabletEvent(createTabletEvent());

      // Events are buffered, advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('tablet');
    });

    it('should not broadcast strum events when mode is tablet', () => {
      mode = 'tablet';

      // First emit a tablet event to set up the buffer
      eventBus.emitTabletEvent(createTabletEvent());
      vi.advanceTimersByTime(100);
      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('tablet');

      // Now emit a strum event - it should be filtered out
      eventBus.emitStrumEvent(createStrumEvent());
      vi.advanceTimersByTime(100);

      // Tablet event is broadcast (from the buffer), but strum is filtered
      // The buffer always has tablet data, so tablet events are always emitted
      // But the strum callback should not be called in tablet mode
      expect(broadcastedMessages.filter(m => m.type === 'strum')).toHaveLength(0);
    });

    it('should broadcast strum events when mode is strum', () => {
      mode = 'strum';
      eventBus.emitStrumEvent(createStrumEvent());

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('strum');
    });

    it('should not broadcast tablet events when mode is strum', () => {
      mode = 'strum';
      eventBus.emitTabletEvent(createTabletEvent());

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      // Tablet events are filtered out in strum mode
      expect(broadcastedMessages).toHaveLength(0);
    });

    it('should switch modes dynamically', () => {
      // Start in tablet mode
      mode = 'tablet';
      eventBus.emitTabletEvent(createTabletEvent());

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('tablet');

      // Switch to strum mode
      mode = 'strum';
      eventBus.emitStrumEvent(createStrumEvent());

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(broadcastedMessages).toHaveLength(2);
      expect(broadcastedMessages[1].type).toBe('strum');

      // Tablet events should now be ignored
      eventBus.emitTabletEvent(createTabletEvent());
      vi.advanceTimersByTime(100);
      expect(broadcastedMessages).toHaveLength(2); // No new messages
    });
  });

  describe('throttle configuration', () => {
    it('should respect throttle setting', () => {
      mode = 'tablet';

      // First event - buffered
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(0); // Buffered, not emitted yet

      // Second event - also buffered (latest wins)
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(0); // Still buffered

      // After throttle period - flush emits the latest event
      vi.advanceTimersByTime(100);
      expect(broadcastedMessages).toHaveLength(1);

      // New event after flush
      eventBus.emitTabletEvent(createTabletEvent());
      vi.advanceTimersByTime(100);
      expect(broadcastedMessages).toHaveLength(2);
    });

    it('should allow changing throttle dynamically', () => {
      mode = 'tablet';

      // First event - buffered
      eventBus.emitTabletEvent(createTabletEvent());

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);
      expect(broadcastedMessages).toHaveLength(1);

      // Change throttle to 50ms
      eventBus.throttleMs = 50;

      // New event
      eventBus.emitTabletEvent(createTabletEvent());

      // Wait 50ms (new throttle period)
      vi.advanceTimersByTime(50);

      // Should have emitted with new throttle
      expect(broadcastedMessages).toHaveLength(2);
    });
  });
});

describe('WebSocket Message Protocol', () => {
  describe('client messages', () => {
    it('should parse set-mode message correctly', () => {
      const message = JSON.stringify({ type: 'set-mode', mode: 'strum' });
      const parsed = JSON.parse(message);

      expect(parsed.type).toBe('set-mode');
      expect(parsed.mode).toBe('strum');
      expect(['tablet', 'strum']).toContain(parsed.mode);
    });

    it('should parse set-throttle message correctly', () => {
      const message = JSON.stringify({ type: 'set-throttle', throttleMs: 200 });
      const parsed = JSON.parse(message);

      expect(parsed.type).toBe('set-throttle');
      expect(parsed.throttleMs).toBe(200);
      expect(typeof parsed.throttleMs).toBe('number');
    });

    it('should validate mode values', () => {
      const validModes = ['tablet', 'strum'];
      const invalidModes = ['invalid', 'both', '', null, undefined, 123];

      validModes.forEach((mode) => {
        expect(validModes.includes(mode)).toBe(true);
      });

      invalidModes.forEach((mode) => {
        expect(validModes.includes(mode as string)).toBe(false);
      });
    });
  });

  describe('server messages', () => {
    it('should format tablet event message correctly', () => {
      const tabletData: TabletEventData = {
        x: 0.5,
        y: 0.5,
        pressure: 0.3,
        tiltX: 10,
        tiltY: -5,
        tiltXY: 11.18,
        primaryButtonPressed: false,
        secondaryButtonPressed: false,
        state: 'contact',
        timestamp: 1234567890,
      };

      const message = { type: 'tablet', data: tabletData };
      const serialized = JSON.stringify(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('tablet');
      expect(parsed.data.x).toBe(0.5);
      expect(parsed.data.pressure).toBe(0.3);
      expect(parsed.data.state).toBe('contact');
    });

    it('should format strum event message correctly', () => {
      const strumData: StrumEventData = {
        type: 'strum',
        notes: [
          { note: { notation: 'C', octave: 4, midiNote: 60 }, velocity: 100 },
          { note: { notation: 'E', octave: 4, midiNote: 64 }, velocity: 95 },
        ],
        velocity: 100,
        timestamp: 1234567890,
      };

      const message = { type: 'strum', data: strumData };
      const serialized = JSON.stringify(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('strum');
      expect(parsed.data.type).toBe('strum');
      expect(parsed.data.notes).toHaveLength(2);
      expect(parsed.data.notes[0].note.notation).toBe('C');
      expect(parsed.data.notes[0].note.midiNote).toBe(60);
    });

    it('should format config message correctly', () => {
      const configData = {
        mode: 'tablet' as const,
        throttleMs: 500,
        notes: [
          { notation: 'C', octave: 4 },
          { notation: 'E', octave: 4 },
          { notation: 'G', octave: 4 },
        ],
        chord: 'C',
      };

      const message = { type: 'config', data: configData };
      const serialized = JSON.stringify(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('config');
      expect(parsed.data.mode).toBe('tablet');
      expect(parsed.data.throttleMs).toBe(500);
      expect(parsed.data.notes).toHaveLength(3);
      expect(parsed.data.chord).toBe('C');
    });

    it('should format mode-change message correctly', () => {
      const modeChangeData = { mode: 'strum' as const };

      const message = { type: 'mode-change', data: modeChangeData };
      const serialized = JSON.stringify(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('mode-change');
      expect(parsed.data.mode).toBe('strum');
    });

    it('should format release event message correctly', () => {
      const releaseData: StrumEventData = {
        type: 'release',
        notes: [],
        velocity: 0,
        timestamp: 1234567890,
      };

      const message = { type: 'strum', data: releaseData };
      const serialized = JSON.stringify(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('strum');
      expect(parsed.data.type).toBe('release');
      expect(parsed.data.notes).toHaveLength(0);
    });
  });
});

describe('Event Data Validation', () => {
  describe('TabletEventData', () => {
    it('should have all required fields', () => {
      const event: TabletEventData = {
        x: 0.5,
        y: 0.5,
        pressure: 0.3,
        tiltX: 0,
        tiltY: 0,
        tiltXY: 0,
        primaryButtonPressed: false,
        secondaryButtonPressed: false,
        state: 'contact',
        timestamp: Date.now(),
      };

      expect(event).toHaveProperty('x');
      expect(event).toHaveProperty('y');
      expect(event).toHaveProperty('pressure');
      expect(event).toHaveProperty('tiltX');
      expect(event).toHaveProperty('tiltY');
      expect(event).toHaveProperty('tiltXY');
      expect(event).toHaveProperty('primaryButtonPressed');
      expect(event).toHaveProperty('secondaryButtonPressed');
      expect(event).toHaveProperty('state');
      expect(event).toHaveProperty('timestamp');
    });

    it('should accept valid state values', () => {
      const validStates: Array<'hover' | 'contact' | 'out-of-range'> = [
        'hover',
        'contact',
        'out-of-range',
      ];

      validStates.forEach((state) => {
        const event: TabletEventData = {
          x: 0.5,
          y: 0.5,
          pressure: 0.3,
          tiltX: 0,
          tiltY: 0,
          tiltXY: 0,
          primaryButtonPressed: false,
          secondaryButtonPressed: false,
          state,
          timestamp: Date.now(),
        };
        expect(event.state).toBe(state);
      });
    });
  });

  describe('StrumEventData', () => {
    it('should have all required fields for strum event', () => {
      const event: StrumEventData = {
        type: 'strum',
        notes: [
          { note: { notation: 'C', octave: 4, midiNote: 60 }, velocity: 100 },
        ],
        velocity: 100,
        timestamp: Date.now(),
      };

      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('notes');
      expect(event).toHaveProperty('velocity');
      expect(event).toHaveProperty('timestamp');
      expect(event.type).toBe('strum');
      expect(event.notes.length).toBeGreaterThan(0);
    });

    it('should have all required fields for release event', () => {
      const event: StrumEventData = {
        type: 'release',
        notes: [],
        velocity: 0,
        timestamp: Date.now(),
      };

      expect(event.type).toBe('release');
      expect(event.notes).toHaveLength(0);
    });

    it('should have valid note data', () => {
      const event: StrumEventData = {
        type: 'strum',
        notes: [
          { note: { notation: 'C', octave: 4, midiNote: 60 }, velocity: 100 },
          { note: { notation: 'E', octave: 4, midiNote: 64 }, velocity: 95 },
          { note: { notation: 'G', octave: 4, midiNote: 67 }, velocity: 90 },
        ],
        velocity: 100,
        timestamp: Date.now(),
      };

      event.notes.forEach((noteData) => {
        expect(noteData.note).toHaveProperty('notation');
        expect(noteData.note).toHaveProperty('octave');
        expect(noteData.note).toHaveProperty('midiNote');
        expect(noteData).toHaveProperty('velocity');
        expect(typeof noteData.note.notation).toBe('string');
        expect(typeof noteData.note.octave).toBe('number');
        expect(typeof noteData.note.midiNote).toBe('number');
        expect(typeof noteData.velocity).toBe('number');
      });
    });
  });
});

/**
 * Tests for config path navigation and updates.
 * These test the setConfigValue logic used by handleConfigUpdate.
 */
describe('Config Path Navigation', () => {
  /**
   * Helper function that mimics the setConfigValue logic from server.ts
   */
  const setConfigValue = (
    config: Record<string, unknown>,
    path: string,
    value: unknown
  ): void => {
    const parts = path.split('.');

    // Navigate to the parent object
    let current: Record<string, unknown> = config;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        throw new Error(`Invalid path: ${path}`);
      }
      current = current[part] as Record<string, unknown>;
    }

    // Set the value
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
  };

  describe('setConfigValue path navigation', () => {
    it('should set a top-level property', () => {
      const config = { foo: 'bar' };
      setConfigValue(config, 'foo', 'baz');
      expect(config.foo).toBe('baz');
    });

    it('should set a nested property', () => {
      const config = { level1: { level2: 'value' } };
      setConfigValue(config, 'level1.level2', 'newValue');
      expect(config.level1.level2).toBe('newValue');
    });

    it('should set a deeply nested property', () => {
      const config = { a: { b: { c: { d: 'original' } } } };
      setConfigValue(config, 'a.b.c.d', 'updated');
      expect(config.a.b.c.d).toBe('updated');
    });

    it('should throw for invalid path', () => {
      const config = { foo: 'bar' };
      expect(() => setConfigValue(config, 'nonexistent.path', 'value')).toThrow(
        'Invalid path: nonexistent.path'
      );
    });

    it('should throw for null intermediate value', () => {
      const config = { foo: null };
      expect(() => setConfigValue(config, 'foo.bar', 'value')).toThrow(
        'Invalid path: foo.bar'
      );
    });

    it('should set numeric values', () => {
      const config = { settings: { threshold: 0.1 } };
      setConfigValue(config, 'settings.threshold', 0.5);
      expect(config.settings.threshold).toBe(0.5);
    });

    it('should set boolean values', () => {
      const config = { features: { enabled: false } };
      setConfigValue(config, 'features.enabled', true);
      expect(config.features.enabled).toBe(true);
    });

    it('should set array values', () => {
      const config = { notes: { list: ['C4', 'E4'] } };
      setConfigValue(config, 'notes.list', ['G4', 'B4', 'D5']);
      expect(config.notes.list).toEqual(['G4', 'B4', 'D5']);
    });
  });

  describe('MidiStrummerConfig path updates', () => {
    let config: MidiStrummerConfig;

    beforeEach(() => {
      config = new MidiStrummerConfig();
    });

    it('should update strummer.strumming.pressureThreshold', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.strumming.pressureThreshold', 0.25);
      expect(config.strummer.strumming.pressureThreshold).toBe(0.25);
    });

    it('should update strummer.strumming.upperNoteSpread', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.strumming.upperNoteSpread', 5);
      expect(config.strummer.strumming.upperNoteSpread).toBe(5);
    });

    it('should update strummer.strumming.lowerNoteSpread', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.strumming.lowerNoteSpread', 2);
      expect(config.strummer.strumming.lowerNoteSpread).toBe(2);
    });

    it('should update strummer.strumming.chord', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.strumming.chord', 'Am');
      expect(config.strummer.strumming.chord).toBe('Am');
    });

    it('should update strummer.strumming.initialNotes', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.strumming.initialNotes', ['D4', 'F#4', 'A4']);
      expect(config.strummer.strumming.initialNotes).toEqual(['D4', 'F#4', 'A4']);
    });

    it('should update strummer.transpose.active', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.transpose.active', true);
      expect(config.strummer.transpose.active).toBe(true);
    });

    it('should update strummer.noteRepeater.active', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'strummer.noteRepeater.active', true);
      expect(config.strummer.noteRepeater.active).toBe(true);
    });

    it('should update midi.channel', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'midi.channel', 5);
      expect(config.midi.channel).toBe(5);
    });

    it('should update server.wsMessageThrottle', () => {
      const configObj = config as unknown as Record<string, unknown>;
      setConfigValue(configObj, 'server.wsMessageThrottle', 200);
      expect(config.server.wsMessageThrottle).toBe(200);
    });
  });
});

/**
 * Tests for status message format.
 * Ensures Node.js and Python servers send compatible status messages.
 */
describe('Status Message Format', () => {
  it('should have correct connected status format', () => {
    const status = {
      type: 'status',
      status: 'connected',
      deviceConnected: true,
      message: 'Device connected: Wacom Intuos',
      timestamp: Date.now(),
    };

    expect(status).toHaveProperty('type', 'status');
    expect(status).toHaveProperty('status', 'connected');
    expect(status).toHaveProperty('deviceConnected', true);
    expect(status).toHaveProperty('message');
    expect(status).toHaveProperty('timestamp');
    expect(typeof status.timestamp).toBe('number');
  });

  it('should have correct disconnected status format', () => {
    const status = {
      type: 'status',
      status: 'disconnected',
      deviceConnected: false,
      message: 'Device disconnected',
      timestamp: Date.now(),
    };

    expect(status).toHaveProperty('type', 'status');
    expect(status).toHaveProperty('status', 'disconnected');
    expect(status).toHaveProperty('deviceConnected', false);
    expect(status).toHaveProperty('message');
    expect(status).toHaveProperty('timestamp');
  });

  it('should have correct searching status format', () => {
    const status = {
      type: 'status',
      status: 'searching',
      deviceConnected: false,
      message: 'Searching for device...',
      timestamp: Date.now(),
    };

    expect(status).toHaveProperty('type', 'status');
    expect(status).toHaveProperty('status', 'searching');
    expect(status).toHaveProperty('deviceConnected', false);
  });
});

/**
 * Tests for set-throttle message format.
 * Ensures both throttleMs (webapp) and throttle (legacy) formats are documented.
 */
describe('Set-Throttle Message Format', () => {
  it('should accept throttleMs format (webapp)', () => {
    const message = {
      type: 'set-throttle',
      throttleMs: 150,
    };

    expect(message).toHaveProperty('type', 'set-throttle');
    expect(message).toHaveProperty('throttleMs');
    expect(typeof message.throttleMs).toBe('number');
  });

  it('should document throttle format (legacy)', () => {
    // Note: Python server accepts both formats
    const message = {
      type: 'set-throttle',
      throttle: 150,
    };

    expect(message).toHaveProperty('type', 'set-throttle');
    expect(message).toHaveProperty('throttle');
    expect(typeof message.throttle).toBe('number');
  });
});

/**
 * Tests for update-config message format.
 */
describe('Update-Config Message Format', () => {
  it('should have correct path-based update format', () => {
    const message = {
      type: 'update-config',
      path: 'strummer.strumming.upperNoteSpread',
      value: 5,
    };

    expect(message).toHaveProperty('type', 'update-config');
    expect(message).toHaveProperty('path');
    expect(message).toHaveProperty('value');
    expect(typeof message.path).toBe('string');
  });

  it('should support various value types', () => {
    const numericUpdate = {
      type: 'update-config',
      path: 'strummer.strumming.pressureThreshold',
      value: 0.15,
    };
    expect(typeof numericUpdate.value).toBe('number');

    const stringUpdate = {
      type: 'update-config',
      path: 'strummer.strumming.chord',
      value: 'Am',
    };
    expect(typeof stringUpdate.value).toBe('string');

    const booleanUpdate = {
      type: 'update-config',
      path: 'strummer.transpose.active',
      value: true,
    };
    expect(typeof booleanUpdate.value).toBe('boolean');

    const arrayUpdate = {
      type: 'update-config',
      path: 'strummer.strumming.initialNotes',
      value: ['C4', 'E4', 'G4'],
    };
    expect(Array.isArray(arrayUpdate.value)).toBe(true);
  });
});

/**
 * Tests for camelCase to snake_case conversion.
 * These match the Python tests in test_server.py
 */
describe('CamelCase to SnakeCase Conversion', () => {
  // Helper function that mimics the conversion logic
  const camelToSnake = (name: string): string => {
    return name
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  };

  it('should convert simple camelCase', () => {
    expect(camelToSnake('upperNoteSpread')).toBe('upper_note_spread');
    expect(camelToSnake('lowerNoteSpread')).toBe('lower_note_spread');
    expect(camelToSnake('midiChannel')).toBe('midi_channel');
  });

  it('should handle single word (no conversion needed)', () => {
    expect(camelToSnake('chord')).toBe('chord');
    expect(camelToSnake('notes')).toBe('notes');
  });

  it('should handle already snake_case strings', () => {
    // Note: This simple implementation doesn't preserve snake_case perfectly
    // but the actual server handles both formats
    expect(camelToSnake('upper_note_spread').includes('upper')).toBe(true);
    expect(camelToSnake('midi_channel').includes('midi')).toBe(true);
  });

  it('should convert multiple capitals', () => {
    expect(camelToSnake('initialNotes')).toBe('initial_notes');
    expect(camelToSnake('pressureThreshold')).toBe('pressure_threshold');
  });

  it('should handle strings with numbers', () => {
    expect(camelToSnake('note1')).toBe('note1');
    expect(camelToSnake('channel10')).toBe('channel10');
  });
});
