/**
 * MIDI Backend Protocol
 *
 * Defines the interface that all MIDI backends must implement.
 */

import type { NoteObject } from '../models/note.js';

/**
 * Abstract interface defining the MIDI backend interface.
 *
 * All MIDI backends (rtmidi, Web MIDI, etc.) must implement this interface
 * to be compatible with MidiStrummerBridge.
 */
export interface MidiBackendProtocol {
  /**
   * Check if the backend is connected and ready to send MIDI.
   */
  readonly isConnected: boolean;

  /**
   * Connect to MIDI output.
   *
   * @param outputPort - Optional port identifier (name or index)
   * @returns True if connection successful, False otherwise
   */
  connect(outputPort?: string | number | null): Promise<boolean>;

  /**
   * Disconnect from MIDI output and clean up resources.
   */
  disconnect(): void;

  /**
   * Send a MIDI note-on message.
   *
   * @param note - The note to play
   * @param velocity - MIDI velocity (0-127)
   * @param channel - MIDI channel (0-15), or undefined to use default
   */
  sendNoteOn(note: NoteObject, velocity: number, channel?: number): void;

  /**
   * Send a MIDI note-off message.
   *
   * @param note - The note to stop
   * @param channel - MIDI channel (0-15), or undefined to use default
   */
  sendNoteOff(note: NoteObject, channel?: number): void;

  /**
   * Send a MIDI note with automatic note-off after duration.
   *
   * @param note - The note to play
   * @param velocity - MIDI velocity (0-127)
   * @param duration - Duration in seconds before note-off
   * @param channel - MIDI channel (0-15), or undefined to use default
   */
  sendNote(note: NoteObject, velocity: number, duration?: number, channel?: number): void;

  /**
   * Immediately release specific notes.
   *
   * @param notes - List of notes to release
   */
  releaseNotes(notes: NoteObject[]): void;

  /**
   * Release all currently playing notes.
   */
  releaseAll(): void;

  /**
   * Set the default MIDI channel.
   *
   * @param channel - MIDI channel (0-15), or undefined for omni/all channels
   */
  setChannel(channel?: number): void;

  /**
   * Send a pitch bend message (optional).
   *
   * @param bendValue - Float between -1.0 (full down) and 1.0 (full up), 0 is center
   */
  sendPitchBend?(bendValue: number): void;

  /**
   * Get list of available MIDI output ports.
   *
   * @returns List of port names
   */
  getAvailablePorts(): string[];
}

/**
 * Options for creating a MIDI backend
 */
export interface MidiBackendOptions {
  /**
   * Default MIDI channel (0-15)
   */
  channel?: number;

  /**
   * Whether to create virtual ports (if supported)
   */
  useVirtualPorts?: boolean;

  /**
   * Name for virtual port (if using virtual ports)
   */
  virtualPortName?: string;
}
