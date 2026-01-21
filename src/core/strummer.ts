/**
 * Strummer
 *
 * Strummer class for detecting strum events from tablet input.
 * Ported from Python sketchatone/strummer/strummer.py
 */

import { EventEmitter } from '../utils/event-emitter.js';
import type { NoteObject } from '../models/note.js';

/**
 * Strum event data for a single note
 */
export interface StrumNoteData {
  note: NoteObject;
  velocity: number;
}

/**
 * Strum event data
 */
export interface StrumEvent {
  type: 'strum';
  notes: StrumNoteData[];
}

/**
 * Release event data
 */
export interface ReleaseEvent {
  type: 'release';
  velocity: number;
}

/**
 * Notes state for broadcasting
 */
export interface NotesState {
  type: 'notes';
  notes: NoteObject[];
  stringCount: number;
  baseNotes: NoteObject[];
  timestamp: number;
}

export type StrummerEvent = StrumEvent | ReleaseEvent;

/**
 * Strummer class for detecting strum events from tablet input.
 *
 * The strummer divides the tablet width into "strings" based on the number of notes.
 * When the pen moves across strings with sufficient pressure, it triggers strum events.
 *
 * Events emitted:
 *   - 'strum': When notes are strummed (data: StrumEvent)
 *   - 'release': When pressure is released (data: ReleaseEvent)
 *   - 'notes_changed': When the notes list changes
 */
export class Strummer extends EventEmitter {
  private _width = 1.0;
  private _height = 1.0;
  private _notes: NoteObject[] = [];

  lastX = -1.0;
  lastStrummedIndex = -1;
  lastPressure = 0.0;
  lastTimestamp = 0.0;
  pressureVelocity = 0.0; // Rate of pressure change
  pressureThreshold = 0.1; // Minimum pressure to trigger a strum
  velocityScale = 4.0; // Scale factor for pressure velocity to MIDI velocity
  lastStrumVelocity = 0; // Last calculated velocity for release event

  // Pressure buffering for accurate velocity sensing on quick taps
  pressureBuffer: Array<{ pressure: number; timestamp: number }> = [];
  bufferMaxSamples = 3; // Number of samples to collect before triggering
  pendingTapIndex = -1; // Index of pending tap waiting for buffer

  constructor() {
    super();
  }

  get notes(): NoteObject[] {
    return this._notes;
  }

  set notes(notes: NoteObject[]) {
    this._notes = notes;
    this.updateBounds(this._width, this._height);
    // Emit event when notes change
    this.emit('notes_changed');
  }

  /**
   * Get the current notes state as a dictionary for broadcasting.
   */
  getNotesState(): NotesState {
    // Get base notes (non-secondary) as NoteObject instances for recalculation
    const baseNotes = this._notes.filter((note) => !note.secondary);

    return {
      type: 'notes',
      notes: [...this._notes],
      stringCount: this._notes.length,
      baseNotes: [...baseNotes],
      timestamp: Date.now() / 1000,
    };
  }

  /**
   * Process strumming input and return event data if triggered.
   *
   * @param x - X position on the tablet (0 to width)
   * @param pressure - Pen pressure (0 to 1)
   * @returns Strum or release event data, or null if no event triggered
   */
  strum(x: number, pressure: number): StrummerEvent | null {
    if (this._notes.length > 0) {
      const stringWidth = this._width / this._notes.length;
      const index = Math.min(Math.floor(x / stringWidth), this._notes.length - 1);

      // Calculate time delta and pressure velocity
      const currentTime = Date.now() / 1000;
      const timeDelta = this.lastTimestamp > 0 ? currentTime - this.lastTimestamp : 0.001;

      // Calculate pressure velocity (rate of change)
      const pressureDelta = pressure - this.lastPressure;
      this.pressureVelocity = timeDelta > 0 ? pressureDelta / timeDelta : 0.0;

      // Check if we have sufficient pressure (used in multiple places)
      const hasSufficientPressure = pressure >= this.pressureThreshold;

      // Detect pressure transitions (pen down/up)
      const pressureDown =
        this.lastPressure < this.pressureThreshold && pressure >= this.pressureThreshold;
      const pressureUp =
        this.lastPressure >= this.pressureThreshold && pressure < this.pressureThreshold;

      // Handle pressure release - return release event with last velocity
      if (pressureUp) {
        // Store the last velocity before resetting
        const releaseVelocity = this.lastStrumVelocity;

        // Reset strummed index and buffer when pressure is released
        this.lastStrummedIndex = -1;
        this.lastPressure = pressure;
        this.lastTimestamp = currentTime;
        this.pressureVelocity = 0.0;
        this.pressureBuffer = [];
        this.pendingTapIndex = -1;
        this.lastStrumVelocity = 0;

        // Return release event if we had a previous strum
        if (releaseVelocity > 0) {
          return { type: 'release', velocity: releaseVelocity };
        }

        return null;
      }

      // Handle new tap - start buffering
      if (pressureDown && (this.lastStrummedIndex === -1 || this.lastStrummedIndex !== index)) {
        // Include the previous pressure (before threshold) to capture the initial velocity spike
        // Store the initial low pressure to measure from the beginning
        this.pressureBuffer = [
          { pressure: this.lastPressure, timestamp: this.lastTimestamp },
          { pressure, timestamp: currentTime },
        ];
        this.pendingTapIndex = index;
        this.lastX = x;
        this.lastPressure = pressure;
        this.lastTimestamp = currentTime;
        return null; // Don't trigger yet, need to buffer
      }

      // Handle case where pressure is already high on first sample (timing issue)
      // If we have sufficient pressure but no previous strum, treat this as an initial tap
      if (hasSufficientPressure && this.lastStrummedIndex === -1 && this.pendingTapIndex === -1) {
        // Start buffering with current sample
        this.pressureBuffer = [{ pressure, timestamp: currentTime }];
        this.pendingTapIndex = index;
        this.lastX = x;
        this.lastPressure = pressure;
        this.lastTimestamp = currentTime;
        return null; // Start buffering
      }

      // Continue buffering if we have a pending tap
      if (this.pendingTapIndex !== -1 && this.pressureBuffer.length < this.bufferMaxSamples) {
        this.pressureBuffer.push({ pressure, timestamp: currentTime });
        this.lastX = x;
        this.lastPressure = pressure;
        this.lastTimestamp = currentTime;

        // Once buffer is full, trigger the note with calculated velocity
        if (this.pressureBuffer.length >= this.bufferMaxSamples) {
          // Use current pressure as the main velocity indicator
          // This is more intuitive - harder press = louder note
          // Map pressure (0.0-1.0) to MIDI velocity (20-127)
          const currentPressure = pressure;

          // Apply velocity scaling and map to MIDI range
          // Pressure range: 0.1 (threshold) to 1.0 → Velocity: 20 to 127
          let normalizedPressure =
            (currentPressure - this.pressureThreshold) / (1.0 - this.pressureThreshold);
          normalizedPressure = Math.max(0.0, Math.min(1.0, normalizedPressure));

          // Scale to velocity range (20-127)
          let midiVelocity = Math.floor(20 + normalizedPressure * 107);
          midiVelocity = Math.max(20, Math.min(127, midiVelocity));

          // Store velocity for potential release event
          this.lastStrumVelocity = midiVelocity;

          const note = this._notes[this.pendingTapIndex];
          this.lastStrummedIndex = this.pendingTapIndex;
          this.pendingTapIndex = -1;
          this.pressureBuffer = [];

          return { type: 'strum', notes: [{ note, velocity: midiVelocity }] };
        }

        return null; // Still buffering
      }

      this.lastX = x;
      this.lastPressure = pressure;
      this.lastTimestamp = currentTime;

      // Handle strumming across strings (index changed while pressure maintained)
      if (
        hasSufficientPressure &&
        this.lastStrummedIndex !== -1 &&
        this.lastStrummedIndex !== index
      ) {
        // Strumming across strings - use current pressure
        // Minimum velocity of 20 for audibility
        const midiVelocity = Math.max(20, Math.floor(pressure * 127));
        const notesToPlay: StrumNoteData[] = [];

        // Determine direction for proper ordering
        let indices: number[];
        if (this.lastStrummedIndex < index) {
          // Moving right/forward
          indices = [];
          for (let i = this.lastStrummedIndex + 1; i <= index; i++) {
            indices.push(i);
          }
        } else {
          // Moving left/backward
          indices = [];
          for (let i = this.lastStrummedIndex - 1; i >= index; i--) {
            indices.push(i);
          }
        }

        for (const i of indices) {
          const note = this._notes[i];
          notesToPlay.push({
            note,
            velocity: midiVelocity,
          });
        }

        // Store velocity for potential release event
        this.lastStrumVelocity = midiVelocity;

        this.lastStrummedIndex = index;
        return notesToPlay.length > 0 ? { type: 'strum', notes: notesToPlay } : null;
      }
    }

    return null;
  }

  /**
   * Clear the last strummed index and pressure
   */
  clearStrum(): void {
    this.lastStrummedIndex = -1;
    this.lastPressure = 0.0;
    this.lastTimestamp = 0.0;
    this.pressureVelocity = 0.0;
    this.lastStrumVelocity = 0;
    this.pressureBuffer = [];
    this.pendingTapIndex = -1;
  }

  /**
   * Configure strummer parameters
   */
  configure(pluckVelocityScale = 4.0, pressureThreshold = 0.1): void {
    this.velocityScale = pluckVelocityScale;
    this.pressureThreshold = pressureThreshold;
  }

  /**
   * Update the bounds of the strummer
   */
  updateBounds(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }
}
