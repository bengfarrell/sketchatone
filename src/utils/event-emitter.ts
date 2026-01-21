/**
 * Event Emitter
 *
 * TypeScript event emitter using callback lists.
 * Ported from Python sketchatone/utils/event_emitter.py
 */

export type EventCallback<T = unknown> = (data: T) => void;

/**
 * TypeScript event emitter using callback lists.
 *
 * @example
 * const emitter = new EventEmitter();
 *
 * // Register callback
 * emitter.on('note', (event) => console.log(event));
 *
 * // Emit event
 * emitter.emit('note', eventData);
 */
export class EventEmitter {
  private callbacks: Map<string, Set<EventCallback>> = new Map();

  /**
   * Register an event callback.
   *
   * @param eventType - The type of event to listen for
   * @param callback - Callback function
   * @returns The callback function (for chaining)
   */
  on<T = unknown>(eventType: string, callback: EventCallback<T>): EventCallback<T> {
    if (!this.callbacks.has(eventType)) {
      this.callbacks.set(eventType, new Set());
    }
    this.callbacks.get(eventType)!.add(callback as EventCallback);
    return callback;
  }

  /**
   * Register a callback that only fires once.
   *
   * @param eventType - The type of event to listen for
   * @param callback - Callback function
   * @returns The callback function
   */
  once<T = unknown>(eventType: string, callback: EventCallback<T>): EventCallback<T> {
    const wrapper: EventCallback<T> = (data: T) => {
      this.off(eventType, wrapper as EventCallback);
      callback(data);
    };
    this.on(eventType, wrapper);
    return callback;
  }

  /**
   * Unregister an event callback.
   *
   * @param eventType - The type of event
   * @param callback - The callback function to remove
   */
  off(eventType: string, callback: EventCallback): void {
    const callbacks = this.callbacks.get(eventType);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  /**
   * Emit an event, calling all registered callbacks.
   *
   * @param eventType - The type of event to emit
   * @param data - Data to pass to callbacks
   */
  emit<T = unknown>(eventType: string, data?: T): void {
    const callbacks = this.callbacks.get(eventType);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(data);
      }
    }
  }

  /**
   * Clear all callbacks for an event type, or all callbacks if no type specified.
   *
   * @param eventType - Optional event type to clear. If undefined, clears all.
   */
  clear(eventType?: string): void {
    if (eventType) {
      this.callbacks.delete(eventType);
    } else {
      this.callbacks.clear();
    }
  }

  /**
   * Get the number of listeners for an event type.
   *
   * @param eventType - The event type to check
   * @returns Number of registered listeners
   */
  listenerCount(eventType: string): number {
    return this.callbacks.get(eventType)?.size ?? 0;
  }
}
