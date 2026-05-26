/**
 * String Layout
 *
 * Shared geometry/notes/bounds helper used by Strummer and Slider.
 * Owns the tablet bounds and the list of notes ("strings"), and exposes
 * helpers to translate an x position into a string index.
 *
 * Ported from Python sketchatone/strummer/string_layout.py
 */

import { EventEmitter } from '../utils/event-emitter.js';
import type { NoteObject } from '../models/note.js';

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

/**
 * Holds tablet bounds and the note list, and computes string geometry.
 *
 * The tablet width is divided evenly into N "strings" based on the number
 * of notes. `indexAt(x)` returns the string index for a given x.
 *
 * Events emitted:
 *   - 'notes_changed': When the notes list is replaced
 */
export class StringLayout extends EventEmitter {
  private _width = 1.0;
  private _height = 1.0;
  private _notes: NoteObject[] = [];

  get notes(): NoteObject[] {
    return this._notes;
  }

  set notes(notes: NoteObject[]) {
    this._notes = notes;
    this.emit('notes_changed');
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  /**
   * Update the tablet bounds.
   */
  updateBounds(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  /**
   * Width of a single string slot, or 0 if there are no notes.
   */
  get stringWidth(): number {
    if (this._notes.length === 0) {
      return 0.0;
    }
    return this._width / this._notes.length;
  }

  /**
   * Return the string index at x, or -1 if there are no notes.
   */
  indexAt(x: number): number {
    if (this._notes.length === 0) {
      return -1;
    }
    const sw = this.stringWidth;
    if (sw <= 0) {
      return -1;
    }
    return Math.min(Math.floor(x / sw), this._notes.length - 1);
  }

  /**
   * Return the current notes state for broadcasting.
   */
  getNotesState(): NotesState {
    const baseNotes = this._notes.filter((n) => !n.secondary);
    return {
      type: 'notes',
      notes: [...this._notes],
      stringCount: this._notes.length,
      baseNotes: [...baseNotes],
      timestamp: Date.now() / 1000,
    };
  }
}
