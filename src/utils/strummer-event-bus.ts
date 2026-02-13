/**
 * Strummer Event Bus
 *
 * Event bus for communicating HID tablet events and strum events.
 * Supports optional throttling for WebSocket use cases.
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
  // Tablet hardware buttons
  tabletButtons?: number;
  button1?: boolean;
  button2?: boolean;
  button3?: boolean;
  button4?: boolean;
  button5?: boolean;
  button6?: boolean;
  button7?: boolean;
  button8?: boolean;
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
 */
export interface CombinedEventData extends TabletEventData {
  strum?: StrumEventData;
}

/**
 * Event types emitted by the strummer event bus
 */
export type StrummerEventType = 'tablet' | 'strum' | 'combined';

/**
 * Event emitter for strummer events.
 * When throttleMs is 0, events emit immediately.
 * When throttleMs > 0, events are buffered and emitted on an interval.
 */
export class StrummerEventBus extends EventEmitter {
  private _throttleMs: number;
  private throttleTimer: ReturnType<typeof setInterval> | null = null;
  private buffer: CombinedEventData | null = null;
  private hasNewData: boolean = false;
  private _paused: boolean = true;

  /**
   * Create a new strummer event bus.
   * @param throttleMs - Throttle interval in ms. 0 = no throttling (default).
   */
  constructor(throttleMs = 0) {
    super();
    this._throttleMs = throttleMs;
  }

  get paused(): boolean {
    return this._paused;
  }

  get throttleMs(): number {
    return this._throttleMs;
  }

  set throttleMs(value: number) {
    this._throttleMs = Math.max(0, value);
    this.stopInterval();
    if (this._throttleMs > 0 && !this._paused) {
      this.startInterval();
    }
  }

  private startInterval(): void {
    if (this.throttleTimer || this._throttleMs === 0) return;
    this.throttleTimer = setInterval(() => this.flush(), this._throttleMs);
  }

  private stopInterval(): void {
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  pause(): void {
    this._paused = true;
    this.stopInterval();
    this.buffer = null;
    this.hasNewData = false;
  }

  resume(): void {
    this._paused = false;
    if (this._throttleMs > 0) {
      this.startInterval();
    }
  }

  private flush(): void {
    if (!this.buffer || !this.hasNewData) return;
    this.emit<CombinedEventData>('combined', this.buffer);
    this.emit<TabletEventData>('tablet', this.buffer);
    if (this.buffer.strum) {
      this.emit<StrumEventData>('strum', this.buffer.strum);
    }
    this.buffer.strum = undefined;
    this.hasNewData = false;
  }

  emitTabletEvent(data: TabletEventData): void {
    if (this._paused) return;

    // No throttling - emit immediately
    if (this._throttleMs === 0) {
      const eventData: CombinedEventData = { ...data };
      this.emit<CombinedEventData>('combined', eventData);
      this.emit<TabletEventData>('tablet', eventData);
      return;
    }

    // Throttled - buffer data
    this.hasNewData = true;
    if (!this.buffer) {
      this.buffer = { ...data };
    } else {
      const strum = this.buffer.strum;
      Object.assign(this.buffer, data);
      if (strum) this.buffer.strum = strum;
    }
  }

  emitStrumEvent(data: StrumEventData): void {
    if (this._paused) return;

    // No throttling - emit immediately
    if (this._throttleMs === 0) {
      this.emit<StrumEventData>('strum', data);
      return;
    }

    // Throttled - buffer data
    this.hasNewData = true;
    if (!this.buffer) {
      this.buffer = {
        x: 0, y: 0, pressure: 0, tiltX: 0, tiltY: 0, tiltXY: 0,
        primaryButtonPressed: false, secondaryButtonPressed: false,
        state: 'out-of-range', timestamp: Date.now(), strum: data,
      };
    } else {
      this.buffer.strum = data;
    }
  }

  onCombinedEvent(callback: (data: CombinedEventData) => void): () => void {
    this.on<CombinedEventData>('combined', callback);
    return () => this.off('combined', callback as never);
  }

  onTabletEvent(callback: (data: TabletEventData) => void): () => void {
    this.on<TabletEventData>('tablet', callback);
    return () => this.off('tablet', callback as never);
  }

  onStrumEvent(callback: (data: StrumEventData) => void): () => void {
    this.on<StrumEventData>('strum', callback);
    return () => this.off('strum', callback as never);
  }

  cleanup(): void {
    this.stopInterval();
    this.buffer = null;
    this.clear();
  }
}

/**
 * Global singleton instance of the strummer event bus.
 */
export const strummerEventBus = new StrummerEventBus();
