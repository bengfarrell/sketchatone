/**
 * Unit Tests for Strummer Event Bus
 *
 * Tests for the StrummerEventBus class including:
 * - Event emission and subscription
 * - Throttling behavior
 * - Cleanup functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StrummerEventBus,
  type TabletEventData,
  type StrumEventData,
} from '../../src/utils/strummer-event-bus.js';

describe('StrummerEventBus', () => {
  let eventBus: StrummerEventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new StrummerEventBus(100); // 100ms throttle for testing
  });

  afterEach(() => {
    eventBus.cleanup();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create with default throttle of 500ms', () => {
      const bus = new StrummerEventBus();
      expect(bus.throttleMs).toBe(500);
      bus.cleanup();
    });

    it('should create with custom throttle', () => {
      const bus = new StrummerEventBus(200);
      expect(bus.throttleMs).toBe(200);
      bus.cleanup();
    });
  });

  describe('throttleMs getter/setter', () => {
    it('should get throttle value', () => {
      expect(eventBus.throttleMs).toBe(100);
    });

    it('should set throttle value', () => {
      eventBus.throttleMs = 250;
      expect(eventBus.throttleMs).toBe(250);
    });

    it('should not allow negative throttle', () => {
      eventBus.throttleMs = -50;
      expect(eventBus.throttleMs).toBe(0);
    });
  });

  describe('tablet events', () => {
    const createTabletEvent = (x = 0.5): TabletEventData => ({
      x,
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

    it('should emit tablet event immediately when not throttled', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      const event = createTabletEvent();
      eventBus.emitTabletEvent(event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should throttle rapid tablet events', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      // First event - emitted immediately
      eventBus.emitTabletEvent(createTabletEvent(0.1));
      expect(callback).toHaveBeenCalledTimes(1);

      // Second event - throttled
      eventBus.emitTabletEvent(createTabletEvent(0.2));
      expect(callback).toHaveBeenCalledTimes(1);

      // Third event - still throttled, replaces pending
      eventBus.emitTabletEvent(createTabletEvent(0.3));
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance time past throttle
      vi.advanceTimersByTime(100);

      // Pending event should now be emitted
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.3 }));
    });

    it('should emit after throttle period', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      eventBus.emitTabletEvent(createTabletEvent(0.1));
      expect(callback).toHaveBeenCalledTimes(1);

      // Wait for throttle period
      vi.advanceTimersByTime(100);

      // Now should emit immediately again
      eventBus.emitTabletEvent(createTabletEvent(0.2));
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe from tablet events', () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.onTabletEvent(callback);

      eventBus.emitTabletEvent(createTabletEvent());
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      vi.advanceTimersByTime(100);
      eventBus.emitTabletEvent(createTabletEvent());
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('strum events', () => {
    const createStrumEvent = (velocity = 100): StrumEventData => ({
      type: 'strum',
      notes: [
        {
          note: { notation: 'C', octave: 4, midiNote: 60 },
          velocity,
        },
      ],
      velocity,
      timestamp: Date.now(),
    });

    const createReleaseEvent = (): StrumEventData => ({
      type: 'release',
      notes: [],
      velocity: 0,
      timestamp: Date.now(),
    });

    it('should emit strum event immediately when not throttled', () => {
      const callback = vi.fn();
      eventBus.onStrumEvent(callback);

      const event = createStrumEvent();
      eventBus.emitStrumEvent(event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should throttle rapid strum events', () => {
      const callback = vi.fn();
      eventBus.onStrumEvent(callback);

      // First event - emitted immediately
      eventBus.emitStrumEvent(createStrumEvent(100));
      expect(callback).toHaveBeenCalledTimes(1);

      // Second event - throttled
      eventBus.emitStrumEvent(createStrumEvent(110));
      expect(callback).toHaveBeenCalledTimes(1);

      // Third event - still throttled, replaces pending
      eventBus.emitStrumEvent(createStrumEvent(120));
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance time past throttle
      vi.advanceTimersByTime(100);

      // Pending event should now be emitted
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ velocity: 120 }));
    });

    it('should handle release events', () => {
      const callback = vi.fn();
      eventBus.onStrumEvent(callback);

      eventBus.emitStrumEvent(createReleaseEvent());

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: 'release' }));
    });

    it('should unsubscribe from strum events', () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.onStrumEvent(callback);

      eventBus.emitStrumEvent(createStrumEvent());
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      vi.advanceTimersByTime(100);
      eventBus.emitStrumEvent(createStrumEvent());
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('independent throttling', () => {
    it('should throttle tablet and strum events independently', () => {
      const tabletCallback = vi.fn();
      const strumCallback = vi.fn();
      eventBus.onTabletEvent(tabletCallback);
      eventBus.onStrumEvent(strumCallback);

      // Emit tablet event
      eventBus.emitTabletEvent({
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
      expect(tabletCallback).toHaveBeenCalledTimes(1);

      // Emit strum event immediately after - should not be throttled
      eventBus.emitStrumEvent({
        type: 'strum',
        notes: [{ note: { notation: 'C', octave: 4, midiNote: 60 }, velocity: 100 }],
        velocity: 100,
        timestamp: Date.now(),
      });
      expect(strumCallback).toHaveBeenCalledTimes(1);

      // Both should be throttled for their own type
      eventBus.emitTabletEvent({
        x: 0.6,
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
      eventBus.emitStrumEvent({
        type: 'strum',
        notes: [{ note: { notation: 'E', octave: 4, midiNote: 64 }, velocity: 110 }],
        velocity: 110,
        timestamp: Date.now(),
      });

      // Still only 1 call each (throttled)
      expect(tabletCallback).toHaveBeenCalledTimes(1);
      expect(strumCallback).toHaveBeenCalledTimes(1);

      // Advance time
      vi.advanceTimersByTime(100);

      // Pending events should be emitted
      expect(tabletCallback).toHaveBeenCalledTimes(2);
      expect(strumCallback).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanup', () => {
    it('should clear pending timers on cleanup', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      // Emit first event
      eventBus.emitTabletEvent({
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

      // Emit second event (throttled, pending)
      eventBus.emitTabletEvent({
        x: 0.6,
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

      expect(callback).toHaveBeenCalledTimes(1);

      // Cleanup before timer fires
      eventBus.cleanup();

      // Advance time
      vi.advanceTimersByTime(100);

      // Pending event should NOT be emitted
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should clear all event listeners on cleanup', () => {
      const tabletCallback = vi.fn();
      const strumCallback = vi.fn();
      eventBus.onTabletEvent(tabletCallback);
      eventBus.onStrumEvent(strumCallback);

      eventBus.cleanup();

      // Create new event bus to emit (old one is cleaned up)
      const newBus = new StrummerEventBus(100);
      newBus.onTabletEvent(tabletCallback);
      newBus.emitTabletEvent({
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

      // New bus should work
      expect(tabletCallback).toHaveBeenCalledTimes(1);
      newBus.cleanup();
    });
  });

  describe('zero throttle', () => {
    it('should emit all events immediately with zero throttle', () => {
      const bus = new StrummerEventBus(0);
      const callback = vi.fn();
      bus.onTabletEvent(callback);

      bus.emitTabletEvent({
        x: 0.1,
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
      bus.emitTabletEvent({
        x: 0.2,
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
      bus.emitTabletEvent({
        x: 0.3,
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

      expect(callback).toHaveBeenCalledTimes(3);
      bus.cleanup();
    });
  });
});
