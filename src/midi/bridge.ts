/**
 * MIDI Strummer Bridge
 *
 * Connects Strummer events to MIDI output backends.
 */

import type { MidiBackendProtocol } from './protocol.js';
import type { Strummer, StrummerEvent, StrumNoteData } from '../core/strummer.js';
import type { NoteObject } from '../models/note.js';

/**
 * Options for the MIDI Strummer Bridge
 */
export interface MidiStrummerBridgeOptions {
  /**
   * Default note duration in seconds
   */
  noteDuration?: number;

  /**
   * Whether to automatically connect to strummer events
   */
  autoConnect?: boolean;
}

/**
 * Bridge that connects Strummer events to a MIDI backend.
 *
 * Listens for strum and release events from the Strummer and
 * sends corresponding MIDI note-on/note-off messages through
 * the configured backend.
 *
 * @example
 * ```typescript
 * import { Strummer } from '../core/strummer.js';
 * import { MidiStrummerBridge, RtMidiBackend } from '../midi/index.js';
 *
 * // Create strummer and backend
 * const strummer = new Strummer();
 * const backend = new RtMidiBackend({ channel: 0 });
 * await backend.connect();
 *
 * // Create bridge - automatically connects events
 * const bridge = new MidiStrummerBridge(strummer, backend);
 *
 * // Configure note duration
 * bridge.noteDuration = 2.0;
 *
 * // Now strummer.strum() calls will send MIDI notes
 * strummer.notes = [noteObject1, noteObject2];
 * const event = strummer.strum(0.5, 0.8);
 * // MIDI notes are automatically sent!
 *
 * // Clean up
 * bridge.disconnect();
 * backend.disconnect();
 * ```
 */
export class MidiStrummerBridge {
  private _strummer: Strummer;
  private _backend: MidiBackendProtocol;
  private _noteDuration: number;
  private _isConnected = false;
  private _boundEventHandler: ((event: StrummerEvent) => void) | null = null;

  // Track currently playing notes for release
  private _activeNotes: NoteObject[] = [];

  constructor(
    strummer: Strummer,
    backend: MidiBackendProtocol,
    options: MidiStrummerBridgeOptions = {}
  ) {
    this._strummer = strummer;
    this._backend = backend;
    this._noteDuration = options.noteDuration ?? 1.5;

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  /**
   * Get the note duration
   */
  get noteDuration(): number {
    return this._noteDuration;
  }

  /**
   * Set the note duration
   */
  set noteDuration(value: number) {
    this._noteDuration = value;
  }

  /**
   * Check if the bridge is connected to strummer events
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Connect to strummer events
   */
  connect(): void {
    if (this._isConnected) {
      return;
    }

    this._boundEventHandler = this._handleStrummerEvent.bind(this);
    this._strummer.on('strum', this._boundEventHandler);
    this._strummer.on('release', this._boundEventHandler);
    this._isConnected = true;
  }

  /**
   * Disconnect from strummer events
   */
  disconnect(): void {
    if (!this._isConnected || !this._boundEventHandler) {
      return;
    }

    this._strummer.off('strum', this._boundEventHandler as (data: unknown) => void);
    this._strummer.off('release', this._boundEventHandler as (data: unknown) => void);
    this._boundEventHandler = null;
    this._isConnected = false;
  }

  /**
   * Release all currently playing notes
   */
  releaseAll(): void {
    if (this._activeNotes.length > 0) {
      this._backend.releaseNotes(this._activeNotes);
      this._activeNotes = [];
    }
    this._backend.releaseAll();
  }

  /**
   * Handle strummer events
   */
  private _handleStrummerEvent(event: StrummerEvent): void {
    if (!this._backend.isConnected) {
      return;
    }

    if (event.type === 'strum') {
      this._handleStrum(event.notes);
    } else if (event.type === 'release') {
      this._handleRelease();
    }
  }

  /**
   * Handle strum event - send MIDI notes
   */
  private _handleStrum(notes: StrumNoteData[]): void {
    // Track active notes
    this._activeNotes = notes.map((n) => n.note);

    // Send each note
    for (const noteData of notes) {
      this._backend.sendNote(noteData.note, noteData.velocity, this._noteDuration);
    }
  }

  /**
   * Handle release event
   */
  private _handleRelease(): void {
    // Release active notes
    if (this._activeNotes.length > 0) {
      this._backend.releaseNotes(this._activeNotes);
      this._activeNotes = [];
    }
  }

  /**
   * Manually send a note through the bridge
   */
  sendNote(note: NoteObject, velocity: number, duration?: number): void {
    if (!this._backend.isConnected) {
      return;
    }
    this._backend.sendNote(note, velocity, duration ?? this._noteDuration);
  }

  /**
   * Send pitch bend through the bridge
   */
  sendPitchBend(bendValue: number): void {
    if (!this._backend.isConnected || !this._backend.sendPitchBend) {
      return;
    }
    this._backend.sendPitchBend(bendValue);
  }
}