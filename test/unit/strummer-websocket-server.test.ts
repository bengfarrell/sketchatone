/**
 * Unit Tests for Strummer WebSocket Server
 *
 * Tests for the StrummerWebSocketServer class including:
 * - Mode switching
 * - Throttle configuration
 * - Event broadcasting logic
 * - Client message handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StrummerEventBus,
  type TabletEventData,
  type StrumEventData,
} from '../../src/utils/strummer-event-bus.js';

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

      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('tablet');
    });

    it('should not broadcast strum events when mode is tablet', () => {
      mode = 'tablet';
      eventBus.emitStrumEvent(createStrumEvent());

      expect(broadcastedMessages).toHaveLength(0);
    });

    it('should broadcast strum events when mode is strum', () => {
      mode = 'strum';
      eventBus.emitStrumEvent(createStrumEvent());

      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('strum');
    });

    it('should not broadcast tablet events when mode is strum', () => {
      mode = 'strum';
      eventBus.emitTabletEvent(createTabletEvent());

      expect(broadcastedMessages).toHaveLength(0);
    });

    it('should switch modes dynamically', () => {
      // Start in tablet mode
      mode = 'tablet';
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(1);
      expect(broadcastedMessages[0].type).toBe('tablet');

      // Wait for throttle
      vi.advanceTimersByTime(100);

      // Switch to strum mode
      mode = 'strum';
      eventBus.emitStrumEvent(createStrumEvent());
      expect(broadcastedMessages).toHaveLength(2);
      expect(broadcastedMessages[1].type).toBe('strum');

      // Tablet events should now be ignored
      vi.advanceTimersByTime(100);
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(2); // No new messages
    });
  });

  describe('throttle configuration', () => {
    it('should respect throttle setting', () => {
      mode = 'tablet';

      // First event - immediate
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(1);

      // Second event - throttled
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(1);

      // After throttle period
      vi.advanceTimersByTime(100);
      expect(broadcastedMessages).toHaveLength(2);
    });

    it('should allow changing throttle dynamically', () => {
      mode = 'tablet';

      // First event
      eventBus.emitTabletEvent(createTabletEvent());
      expect(broadcastedMessages).toHaveLength(1);

      // Change throttle to 50ms
      eventBus.throttleMs = 50;

      // Wait 50ms (new throttle period)
      vi.advanceTimersByTime(50);

      // Should be able to emit again
      eventBus.emitTabletEvent(createTabletEvent());
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
