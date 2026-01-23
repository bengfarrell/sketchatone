/**
 * RtMidi Backend
 *
 * MIDI output backend using @julusian/midi for cross-platform MIDI support.
 * This is a Node.js wrapper around the RtMidi C++ library.
 */

import type { MidiBackendProtocol, MidiBackendOptions } from './protocol.js';
import type { NoteObject } from '../models/note.js';
import { Note } from '../models/note.js';

// Dynamic import for midi - it's a native module
let midi: typeof import('@julusian/midi') | null = null;

async function loadMidi(): Promise<typeof import('@julusian/midi')> {
  if (!midi) {
    midi = await import('@julusian/midi');
  }
  return midi;
}

/**
 * Timer info for tracking active note timers
 */
interface NoteTimer {
  timer: ReturnType<typeof setTimeout>;
  channels: number[];
}

/**
 * MIDI backend using @julusian/midi (RtMidi wrapper).
 *
 * Works on macOS, Windows, and Linux with ALSA.
 *
 * @example
 * ```typescript
 * const backend = new RtMidiBackend({ channel: 0 });
 * await backend.connect();
 * backend.sendNote(note, 100, 1.0);
 * backend.disconnect();
 * ```
 */
export class RtMidiBackend implements MidiBackendProtocol {
  private _midiOut: InstanceType<typeof import('@julusian/midi').Output> | null = null;
  private _channel: number;
  private _isConnected = false;
  private _useVirtualPorts: boolean;
  private _virtualPortName: string;

  // Track active note timers for cleanup
  private _activeNoteTimers: Map<string, NoteTimer> = new Map();

  constructor(options: MidiBackendOptions = {}) {
    this._channel = options.channel ?? 0;
    this._useVirtualPorts = options.useVirtualPorts ?? false;
    this._virtualPortName = options.virtualPortName ?? 'Sketchatone';
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get channel(): number {
    return this._channel;
  }

  /**
   * Get list of available MIDI output ports
   */
  getAvailablePorts(): string[] {
    if (!this._midiOut) {
      return [];
    }

    const ports: string[] = [];
    const portCount = this._midiOut.getPortCount();
    for (let i = 0; i < portCount; i++) {
      ports.push(this._midiOut.getPortName(i));
    }
    return ports;
  }

  /**
   * Connect to MIDI output
   *
   * @param outputPort - Port name (string) or index (number), or null for first available
   */
  async connect(outputPort?: string | number | null): Promise<boolean> {
    try {
      const midiModule = await loadMidi();
      this._midiOut = new midiModule.Output();

      if (this._useVirtualPorts) {
        // Create a virtual port
        this._midiOut.openVirtualPort(this._virtualPortName);
        console.log(`[RtMidi] Opened virtual port: ${this._virtualPortName}`);
        this._isConnected = true;
        return true;
      }

      const portCount = this._midiOut.getPortCount();
      if (portCount === 0) {
        console.error('[RtMidi] No MIDI output ports available');
        return false;
      }

      let portIndex = 0;

      if (outputPort !== undefined && outputPort !== null) {
        if (typeof outputPort === 'number') {
          // Use port index directly
          if (outputPort >= 0 && outputPort < portCount) {
            portIndex = outputPort;
          } else {
            console.error(`[RtMidi] Invalid port index: ${outputPort}`);
            return false;
          }
        } else if (typeof outputPort === 'string') {
          // Find port by name
          let found = false;
          for (let i = 0; i < portCount; i++) {
            const name = this._midiOut.getPortName(i);
            if (name.includes(outputPort)) {
              portIndex = i;
              found = true;
              break;
            }
          }
          if (!found) {
            console.error(`[RtMidi] Port not found: ${outputPort}`);
            console.log('[RtMidi] Available ports:');
            for (let i = 0; i < portCount; i++) {
              console.log(`  ${i}: ${this._midiOut.getPortName(i)}`);
            }
            return false;
          }
        }
      }

      const portName = this._midiOut.getPortName(portIndex);
      this._midiOut.openPort(portIndex);
      console.log(`[RtMidi] Connected to port ${portIndex}: ${portName}`);
      this._isConnected = true;
      return true;
    } catch (error) {
      console.error('[RtMidi] Failed to connect:', error);
      return false;
    }
  }

  /**
   * Disconnect from MIDI output
   */
  disconnect(): void {
    // Cancel all active note timers
    for (const [, timerInfo] of this._activeNoteTimers) {
      clearTimeout(timerInfo.timer);
    }
    this._activeNoteTimers.clear();

    if (this._midiOut) {
      this._midiOut.closePort();
      this._midiOut = null;
    }
    this._isConnected = false;
    console.log('[RtMidi] Disconnected');
  }

  /**
   * Set the default MIDI channel
   */
  setChannel(channel?: number): void {
    this._channel = channel ?? 0;
  }

  /**
   * Get channels to send to
   */
  private _getChannels(channel?: number): number[] {
    if (channel !== undefined) {
      return [channel];
    }
    return [this._channel];
  }

  /**
   * Create a unique key for a note+channels combination
   */
  private _getNoteKey(midiNote: number, channels: number[]): string {
    return `${midiNote}:${channels.join(',')}`;
  }

  /**
   * Send a MIDI note-on message
   */
  sendNoteOn(note: NoteObject, velocity: number, channel?: number): void {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
    const channels = this._getChannels(channel);

    for (const ch of channels) {
      // Note On: 0x90 + channel, note, velocity
      this._midiOut.sendMessage([0x90 + ch, midiNote, velocity]);
    }
  }

  /**
   * Send a MIDI note-off message
   */
  sendNoteOff(note: NoteObject, channel?: number): void {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
    const channels = this._getChannels(channel);

    for (const ch of channels) {
      // Note Off: 0x80 + channel, note, velocity (usually 64)
      this._midiOut.sendMessage([0x80 + ch, midiNote, 0x40]);
    }
  }

  /**
   * Send a MIDI note with automatic note-off after duration
   */
  sendNote(note: NoteObject, velocity: number, duration = 1.5, channel?: number): void {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
    const channels = this._getChannels(channel);
    const noteKey = this._getNoteKey(midiNote, channels);

    // Cancel existing timer for this note
    const existingTimer = this._activeNoteTimers.get(noteKey);
    if (existingTimer) {
      clearTimeout(existingTimer.timer);
      this._activeNoteTimers.delete(noteKey);
    }

    // Send note-on
    for (const ch of channels) {
      this._midiOut.sendMessage([0x90 + ch, midiNote, velocity]);
    }

    // Schedule note-off
    const timer = setTimeout(() => {
      if (this._isConnected && this._midiOut) {
        for (const ch of channels) {
          this._midiOut.sendMessage([0x80 + ch, midiNote, 0x40]);
        }
      }
      this._activeNoteTimers.delete(noteKey);
    }, duration * 1000);

    this._activeNoteTimers.set(noteKey, { timer, channels });
  }

  /**
   * Immediately release specific notes
   */
  releaseNotes(notes: NoteObject[]): void {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    for (const note of notes) {
      const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);

      // Cancel any pending timer for this note
      for (const [key, timerInfo] of this._activeNoteTimers) {
        if (key.startsWith(`${midiNote}:`)) {
          clearTimeout(timerInfo.timer);
          this._activeNoteTimers.delete(key);

          // Send note-off for all channels this note was playing on
          for (const ch of timerInfo.channels) {
            this._midiOut.sendMessage([0x80 + ch, midiNote, 0x40]);
          }
        }
      }
    }
  }

  /**
   * Release all currently playing notes
   */
  releaseAll(): void {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    // Cancel all timers and send note-off for each
    for (const [key, timerInfo] of this._activeNoteTimers) {
      clearTimeout(timerInfo.timer);
      const midiNote = parseInt(key.split(':')[0], 10);

      for (const ch of timerInfo.channels) {
        this._midiOut.sendMessage([0x80 + ch, midiNote, 0x40]);
      }
    }
    this._activeNoteTimers.clear();
  }

  /**
   * Send a pitch bend message
   *
   * @param bendValue - Float between -1.0 and 1.0, 0 is center
   */
  sendPitchBend(bendValue: number): void {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    // Convert -1.0 to 1.0 range to 0-16383 (14-bit value)
    // Center (0.0) = 8192
    const value = Math.round((bendValue + 1.0) * 8191.5);
    const clamped = Math.max(0, Math.min(16383, value));

    // Split into LSB and MSB (7 bits each)
    const lsb = clamped & 0x7f;
    const msb = (clamped >> 7) & 0x7f;

    // Pitch Bend: 0xE0 + channel, LSB, MSB
    this._midiOut.sendMessage([0xe0 + this._channel, lsb, msb]);
  }
}
