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
   * Get the name of the currently connected output port (if any).
   */
  readonly currentOutputName: string | null;

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
   * @param channel - MIDI channel (0-15), or undefined for channel 1 (default)
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
   * Default MIDI channel (0-15 internal representation, displayed as 1-16 to users)
   * or undefined to default to channel 1.
   * Note: CLI and user-facing interfaces use 1-16
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

  /**
   * Delay in seconds after each MIDI message (default: 0)
   * Use e.g. 0.002 (2 ms) on systems where notes stick during busy strumming.
   * Works with both RtMidi and JACK backends.
   */
  interMessageDelay?: number;

  /**
   * Device monitoring interval in milliseconds (default: 2000)
   * Set to a number to enable monitoring and specify scan interval
   * Set to 0 or false to disable device monitoring
   * When enabled, automatically detects device disconnections and reconnects when available
   */
  device_monitoring?: number | false;
}
