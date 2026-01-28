/**
 * Unit Tests for Strummer Event Bus
 *
 * Tests for the StrummerEventBus class including:
 * - Event emission and subscription
 * - Throttling behavior (buffer-based with interval timer)
 * - Pause/resume functionality
 * - Cleanup functionality
 *
 * Note: The StrummerEventBus uses a buffer-based approach:
 * - Events are buffered and only emitted when the interval timer fires
 * - The bus starts paused and must be resumed before events are processed
 * - Tablet data overwrites (latest wins), strum data is preserved until sent
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
    eventBus.resume(); // Resume the bus so events are processed
  });

  afterEach(() => {
    eventBus.cleanup();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create with default throttle of 150ms', () => {
      const bus = new StrummerEventBus();
      expect(bus.throttleMs).toBe(150);
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

    it('should emit tablet event after interval fires', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      const event = createTabletEvent();
      eventBus.emitTabletEvent(event);

      // Event is buffered, not emitted immediately
      expect(callback).toHaveBeenCalledTimes(0);

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ x: event.x }));
    });

    it('should throttle rapid tablet events (latest wins)', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      // Multiple events before interval fires - latest wins
      eventBus.emitTabletEvent(createTabletEvent(0.1));
      eventBus.emitTabletEvent(createTabletEvent(0.2));
      eventBus.emitTabletEvent(createTabletEvent(0.3));

      // No events emitted yet
      expect(callback).toHaveBeenCalledTimes(0);

      // Advance time past throttle
      vi.advanceTimersByTime(100);

      // Only one event emitted with latest value
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.3 }));
    });

    it('should emit on each interval when new data arrives', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      eventBus.emitTabletEvent(createTabletEvent(0.1));
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      // Send new data
      eventBus.emitTabletEvent(createTabletEvent(0.2));
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe from tablet events', () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.onTabletEvent(callback);

      eventBus.emitTabletEvent(createTabletEvent());
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.emitTabletEvent(createTabletEvent());
      vi.advanceTimersByTime(100);
      // Still only 1 call since we unsubscribed
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

    it('should emit strum event after interval fires', () => {
      const callback = vi.fn();
      eventBus.onStrumEvent(callback);

      const event = createStrumEvent();
      eventBus.emitStrumEvent(event);

      // Event is buffered, not emitted immediately
      expect(callback).toHaveBeenCalledTimes(0);

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ velocity: event.velocity }));
    });

    it('should throttle rapid strum events (latest wins)', () => {
      const callback = vi.fn();
      eventBus.onStrumEvent(callback);

      // Multiple events before interval fires - latest wins
      eventBus.emitStrumEvent(createStrumEvent(100));
      eventBus.emitStrumEvent(createStrumEvent(110));
      eventBus.emitStrumEvent(createStrumEvent(120));

      // No events emitted yet
      expect(callback).toHaveBeenCalledTimes(0);

      // Advance time past throttle
      vi.advanceTimersByTime(100);

      // Only one event emitted with latest value
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ velocity: 120 }));
    });

    it('should handle release events', () => {
      const callback = vi.fn();
      eventBus.onStrumEvent(callback);

      eventBus.emitStrumEvent(createReleaseEvent());

      // Event is buffered
      expect(callback).toHaveBeenCalledTimes(0);

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ type: 'release' }));
    });

    it('should unsubscribe from strum events', () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.onStrumEvent(callback);

      eventBus.emitStrumEvent(createStrumEvent());
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      eventBus.emitStrumEvent(createStrumEvent());
      vi.advanceTimersByTime(100);
      // Still only 1 call since we unsubscribed
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('combined events', () => {
    it('should emit tablet and strum together on interval', () => {
      const tabletCallback = vi.fn();
      // Capture the strum data at call time (since buffer is mutated after flush)
      let capturedStrum: any = null;
      const strumCallback = vi.fn((data) => {
        capturedStrum = { ...data };
      });
      let capturedCombined: any = null;
      const combinedCallback = vi.fn((data) => {
        capturedCombined = { ...data, strum: data.strum ? { ...data.strum } : undefined };
      });
      eventBus.onTabletEvent(tabletCallback);
      eventBus.onStrumEvent(strumCallback);
      eventBus.onCombinedEvent(combinedCallback);

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

      // Emit strum event
      eventBus.emitStrumEvent({
        type: 'strum',
        notes: [{ note: { notation: 'C', octave: 4, midiNote: 60 }, velocity: 100 }],
        velocity: 100,
        timestamp: Date.now(),
      });

      // Nothing emitted yet (buffered)
      expect(tabletCallback).toHaveBeenCalledTimes(0);
      expect(strumCallback).toHaveBeenCalledTimes(0);
      expect(combinedCallback).toHaveBeenCalledTimes(0);

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      // All events emitted together
      expect(tabletCallback).toHaveBeenCalledTimes(1);
      expect(strumCallback).toHaveBeenCalledTimes(1);
      expect(combinedCallback).toHaveBeenCalledTimes(1);

      // Combined event should have both tablet and strum data
      // (captured at call time since buffer is mutated after flush)
      expect(capturedCombined.x).toBe(0.5);
      expect(capturedCombined.strum).toBeDefined();
      expect(capturedCombined.strum.velocity).toBe(100);
      expect(capturedStrum.velocity).toBe(100);
    });

    it('should emit tablet without strum when no strum data', () => {
      const tabletCallback = vi.fn();
      const strumCallback = vi.fn();
      eventBus.onTabletEvent(tabletCallback);
      eventBus.onStrumEvent(strumCallback);

      // Emit only tablet event
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

      vi.advanceTimersByTime(100);

      // Tablet emitted, strum not emitted
      expect(tabletCallback).toHaveBeenCalledTimes(1);
      expect(strumCallback).toHaveBeenCalledTimes(0);
    });
  });

  describe('cleanup', () => {
    it('should clear pending timers on cleanup', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      // Emit events (buffered)
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

      // No events emitted yet (buffered)
      expect(callback).toHaveBeenCalledTimes(0);

      // Cleanup before timer fires
      eventBus.cleanup();

      // Advance time
      vi.advanceTimersByTime(100);

      // Pending event should NOT be emitted (cleanup cleared the timer)
      expect(callback).toHaveBeenCalledTimes(0);
    });

    it('should clear all event listeners on cleanup', () => {
      const tabletCallback = vi.fn();
      const strumCallback = vi.fn();
      eventBus.onTabletEvent(tabletCallback);
      eventBus.onStrumEvent(strumCallback);

      eventBus.cleanup();

      // Create new event bus to emit (old one is cleaned up)
      const newBus = new StrummerEventBus(100);
      newBus.resume(); // Must resume before events are processed
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

      // Advance time to trigger flush
      vi.advanceTimersByTime(100);

      // New bus should work
      expect(tabletCallback).toHaveBeenCalledTimes(1);
      newBus.cleanup();
    });
  });

  describe('pause/resume', () => {
    it('should not emit events when paused', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      // Pause the bus
      eventBus.pause();

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

      vi.advanceTimersByTime(100);

      // No events emitted when paused
      expect(callback).toHaveBeenCalledTimes(0);
    });

    it('should emit events after resume', () => {
      const callback = vi.fn();
      eventBus.onTabletEvent(callback);

      // Pause and then resume
      eventBus.pause();
      eventBus.resume();

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

      vi.advanceTimersByTime(100);

      // Events emitted after resume
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('very low throttle', () => {
    it('should emit events quickly with very low throttle', () => {
      const bus = new StrummerEventBus(1); // 1ms throttle
      bus.resume();
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

      // With 1ms throttle, interval fires very quickly
      vi.advanceTimersByTime(1);

      // Event should be emitted
      expect(callback).toHaveBeenCalledTimes(1);

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

      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(2);

      bus.cleanup();
    });
  });
});
