/**
 * Strummer Event Bus
 *
 * Global event bus for communicating HID tablet events and strum events.
 * Designed to be consumed by WebSocket servers for frontend visualization.
 *
 * Event formats match blankslate's tablet-websocket-server for compatibility.
 * Strum data is merged into tablet events when both occur within the throttle window.
 */

import { EventEmitter } from './event-emitter.js';

/**
 * HID tablet event data - matches blankslate's format
 */
export interface TabletEventData {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  tiltXY: number;
  primaryButtonPressed: boolean;
  secondaryButtonPressed: boolean;
  state: 'hover' | 'contact' | 'out-of-range';
  timestamp: number;
}

/**
 * Strum event note data
 */
export interface StrumNoteEventData {
  note: {
    notation: string;
    octave: number;
    midiNote: number;
  };
  velocity: number;
}

/**
 * Strum event data
 */
export interface StrumEventData {
  type: 'strum' | 'release';
  notes: StrumNoteEventData[];
  velocity: number;
  timestamp: number;
}

/**
 * Combined event data - tablet data with optional strum data merged in.
 * This is the primary event format sent over WebSocket.
 * Blankslate can read the tablet fields directly, while sketchatone
 * can also read the strum field when present.
 */
export interface CombinedEventData extends TabletEventData {
  strum?: StrumEventData;
}

/**
 * Event types emitted by the strummer event bus
 */
export type StrummerEventType = 'tablet' | 'strum' | 'combined';

/**
 * Throttled event emitter for strummer events.
 *
 * Uses a buffer-based approach: maintains a single outgoing message that
 * accumulates data between sends. Tablet data overwrites (latest wins),
 * but strum data is preserved until the buffer is sent.
 */
export class StrummerEventBus extends EventEmitter {
  private _throttleMs: number;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  // Buffer for outgoing message - accumulates between sends
  private buffer: CombinedEventData | null = null;

  // Track if new data has arrived since last flush
  private hasNewData: boolean = false;

  // Track if the event bus is paused (no clients connected)
  private _paused: boolean = true;

  /**
   * Create a new strummer event bus.
   * @param throttleMs - Minimum time between events in milliseconds (default: 150ms)
   */
  constructor(throttleMs = 150) {
    super();
    this._throttleMs = throttleMs;
  }

  /**
   * Check if the event bus is paused.
   */
  get paused(): boolean {
    return this._paused;
  }

  /**
   * Get the current throttle interval in milliseconds.
   */
  get throttleMs(): number {
    return this._throttleMs;
  }

  /**
   * Set the throttle interval in milliseconds.
   */
  set throttleMs(value: number) {
    this._throttleMs = Math.max(0, value);
    // Restart the interval with new timing
    this.stopInterval();
    this.startInterval();
  }

  /**
   * Start the throttle interval timer.
   */
  private startInterval(): void {
    if (this.throttleTimer) return;

    this.throttleTimer = setInterval(() => {
      this.flush();
    }, this._throttleMs);
  }

  /**
   * Stop the throttle interval timer.
   */
  private stopInterval(): void {
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  /**
   * Pause the event bus. Stops the interval and clears the buffer.
   * Call this when no clients are connected to minimize processing.
   */
  pause(): void {
    this._paused = true;
    this.stopInterval();
    this.buffer = null;
    this.hasNewData = false;
  }

  /**
   * Resume the event bus. The interval will start on the next event.
   * Call this when a client connects.
   */
  resume(): void {
    this._paused = false;
  }

  /**
   * Flush the buffer - send accumulated data and clear strum.
   * Only sends if new data has arrived since last flush.
   */
  private flush(): void {
    if (!this.buffer || !this.hasNewData) return;

    // Emit the combined event
    this.emit<CombinedEventData>('combined', this.buffer);

    // Also emit individual events for backward compatibility
    this.emit<TabletEventData>('tablet', this.buffer);
    if (this.buffer.strum) {
      this.emit<StrumEventData>('strum', this.buffer.strum);
    }

    // Clear strum from buffer (it's been sent), but keep tablet data
    // so next flush has something if no new tablet data arrives
    this.buffer.strum = undefined;
    this.hasNewData = false;
  }

  /**
   * Update tablet event data. Overwrites existing tablet fields in buffer.
   */
  emitTabletEvent(data: TabletEventData): void {
    // Skip if paused (no clients connected)
    if (this._paused) return;

    // Start interval on first event
    if (!this.throttleTimer) {
      this.startInterval();
    }

    this.hasNewData = true;

    if (!this.buffer) {
      // First event - initialize buffer
      this.buffer = { ...data };
    } else {
      // Update tablet fields (preserve strum if present)
      const strum = this.buffer.strum;
      Object.assign(this.buffer, data);
      if (strum) {
        this.buffer.strum = strum;
      }
    }
  }

  /**
   * Update strum event data. Added to buffer, preserved until next send.
   */
  emitStrumEvent(data: StrumEventData): void {
    // Skip if paused (no clients connected)
    if (this._paused) return;

    // Start interval on first event
    if (!this.throttleTimer) {
      this.startInterval();
    }

    this.hasNewData = true;

    if (!this.buffer) {
      // No tablet data yet - create minimal buffer with strum
      // This shouldn't normally happen since tablet events come constantly
      this.buffer = {
        x: 0,
        y: 0,
        pressure: 0,
        tiltX: 0,
        tiltY: 0,
        tiltXY: 0,
        primaryButtonPressed: false,
        secondaryButtonPressed: false,
        state: 'out-of-range',
        timestamp: Date.now(),
        strum: data,
      };
    } else {
      // Add strum to existing buffer
      this.buffer.strum = data;
    }
  }

  /**
   * Subscribe to combined events (tablet + optional strum merged).
   */
  onCombinedEvent(callback: (data: CombinedEventData) => void): () => void {
    this.on<CombinedEventData>('combined', callback);
    return () => this.off('combined', callback as any);
  }

  /**
   * Subscribe to tablet events (backward compatibility).
   */
  onTabletEvent(callback: (data: TabletEventData) => void): () => void {
    this.on<TabletEventData>('tablet', callback);
    return () => this.off('tablet', callback as any);
  }

  /**
   * Subscribe to strum events (backward compatibility).
   */
  onStrumEvent(callback: (data: StrumEventData) => void): () => void {
    this.on<StrumEventData>('strum', callback);
    return () => this.off('strum', callback as any);
  }

  /**
   * Clean up timers and buffer.
   */
  cleanup(): void {
    this.stopInterval();
    this.buffer = null;
    this.clear();
  }
}

/**
 * Global singleton instance of the strummer event bus.
 * Use this for communication between the midi-strummer and websocket server.
 */
export const strummerEventBus = new StrummerEventBus();
