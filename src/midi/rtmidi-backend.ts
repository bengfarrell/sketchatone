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
  private _channel: number | undefined;
  private _isConnected = false;
  private _useVirtualPorts: boolean;
  private _virtualPortName: string;
  private _currentOutputName: string | null = null;
  private _interMessageDelay: number;

  // Track active note timers for cleanup
  private _activeNoteTimers: Map<string, NoteTimer> = new Map();

  // State Guard: Track active notes to prevent "Note Shadowing"
  private _activeNotes: Set<number> = new Set();
  private _lastSendTime: number = 0;

  // Device monitoring
  private _deviceMonitoring: number | false;
  private _monitoringTimer: ReturnType<typeof setInterval> | null = null;
  private _lastRequestedPort: string | number | null | undefined = undefined;
  private _lastAvailablePorts: string[] = [];

  constructor(options: MidiBackendOptions = {}) {
    this._channel = options.channel; // undefined = omni mode (all 16 channels)
    this._useVirtualPorts = options.useVirtualPorts ?? false;
    this._virtualPortName = options.virtualPortName ?? 'Sketchatone';
    this._interMessageDelay = options.interMessageDelay ?? 0;

    // Handle device_monitoring: number (interval in ms), 0 (disabled), false (disabled), or undefined (default 2000)
    const monitoring = options.device_monitoring ?? 2000;
    this._deviceMonitoring = (monitoring === false || monitoring === 0) ? false : monitoring;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get channel(): number | undefined {
    return this._channel;
  }

  /** Get the name of the currently connected output port */
  get currentOutputName(): string | null {
    return this._currentOutputName;
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
      // Store the requested port for reconnection
      this._lastRequestedPort = outputPort;

      const midiModule = await loadMidi();
      this._midiOut = new midiModule.Output();

      if (this._useVirtualPorts) {
        // Create a virtual port
        this._midiOut.openVirtualPort(this._virtualPortName);
        console.log(`[RtMidi] Opened virtual port: ${this._virtualPortName}`);
        this._currentOutputName = this._virtualPortName;
        this._isConnected = true;
        this._startHotSwapMonitoring();
        return true;
      }

      const portCount = this._midiOut.getPortCount();
      if (portCount === 0) {
        console.error('[RtMidi] No MIDI output ports available');
        // Start monitoring even if no ports available (for hot-plug)
        this._startHotSwapMonitoring();
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
            this._startHotSwapMonitoring();
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
            this._startHotSwapMonitoring();
            return false;
          }
        }
      }

      const portName = this._midiOut.getPortName(portIndex);
      this._midiOut.openPort(portIndex);
      console.log(`[RtMidi] Connected to port ${portIndex}: ${portName}`);
      this._currentOutputName = portName;
      this._isConnected = true;

      // Update available ports list
      this._lastAvailablePorts = this.getAvailablePorts();

      // Start hot-swap monitoring
      this._startHotSwapMonitoring();

      return true;
    } catch (error) {
      console.error('[RtMidi] Failed to connect:', error);
      this._currentOutputName = null;
      this._startHotSwapMonitoring();
      return false;
    }
  }

  /**
   * Disconnect from MIDI output
   */
  disconnect(): void {
    // Stop hot-swap monitoring
    this._stopHotSwapMonitoring();

    // Cancel all active note timers
    for (const [, timerInfo] of Array.from(this._activeNoteTimers)) {
      clearTimeout(timerInfo.timer);
    }
    this._activeNoteTimers.clear();
    this._activeNotes.clear();

    if (this._midiOut) {
      this._midiOut.closePort();
      this._midiOut = null;
    }
    this._isConnected = false;
    console.log('[RtMidi] Disconnected');
  }

  /**
   * Set the default MIDI channel (0-15) or undefined for omni (all channels)
   */
  setChannel(channel?: number): void {
    this._channel = channel;
  }

  /**
   * Get channels to send to
   */
  private _getChannels(channel?: number): number[] {
    if (channel !== undefined) {
      return [channel];
    }
    if (this._channel !== undefined) {
      return [this._channel];
    }
    // undefined = omni mode (all 16 channels)
    return Array.from({ length: 16 }, (_, i) => i);
  }

  /**
   * Create a unique key for a note+channels combination
   */
  private _getNoteKey(midiNote: number, channels: number[]): string {
    return `${midiNote}:${channels.join(',')}`;
  }

  /**
   * Send a MIDI message with optional inter-message delay throttling.
   * This helps prevent buffer overflow on some hardware synths during busy strumming.
   */
  private async _send(message: number[]): Promise<void> {
    if (!this._midiOut) {
      return;
    }

    if (this._interMessageDelay > 0) {
      const now = Date.now();
      const wait = (this._lastSendTime + this._interMessageDelay * 1000) - now;
      if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }

    this._midiOut.sendMessage(message);
    this._lastSendTime = Date.now();
  }

  /**
   * Send a MIDI note-on message with State Guard protection.
   *
   * If the note is already on, kills it first to prevent "Note Shadowing".
   */
  async sendNoteOn(note: NoteObject, velocity: number, channel?: number): Promise<void> {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
    const channels = this._getChannels(channel);

    // If the note is already on, kill it first
    if (this._activeNotes.has(midiNote)) {
      for (const ch of channels) {
        await this._send([0x90 + ch, midiNote, 0]);
      }
    }

    // Now play the new note
    for (const ch of channels) {
      await this._send([0x90 + ch, midiNote, velocity]);
    }
    this._activeNotes.add(midiNote);
  }

  /**
   * Send a MIDI note-off message with State Guard protection.
   *
   * Only sends Note Off if the note is actually active.
   */
  async sendNoteOff(note: NoteObject, channel?: number): Promise<void> {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
    const channels = this._getChannels(channel);

    if (this._activeNotes.has(midiNote)) {
      for (const ch of channels) {
        // Send 0x90 velocity 0 (Note ON with velocity 0)
        await this._send([0x90 + ch, midiNote, 0]);
      }
      this._activeNotes.delete(midiNote);
    }
  }

  /**
   * Send a MIDI note with automatic note-off after duration.
   *
   * Uses State Guard to prevent Note Shadowing during rapid strumming.
   */
  async sendNote(note: NoteObject, velocity: number, duration = 1.5, channel?: number): Promise<void> {
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

    // Send note-on with State Guard protection
    // If the note is already on, kill it first (prevents orphaned notes)
    if (this._activeNotes.has(midiNote)) {
      for (const ch of channels) {
        await this._send([0x90 + ch, midiNote, 0]);
      }
    }

    // Now play the new note
    for (const ch of channels) {
      await this._send([0x90 + ch, midiNote, velocity]);
    }
    this._activeNotes.add(midiNote);

    // Schedule note-off
    const timer = setTimeout(async () => {
      if (this._isConnected && this._midiOut) {
        if (this._activeNotes.has(midiNote)) {
          for (const ch of channels) {
            await this._send([0x90 + ch, midiNote, 0]);
          }
          this._activeNotes.delete(midiNote);
        }
      }
      this._activeNoteTimers.delete(noteKey);
    }, duration * 1000);

    this._activeNoteTimers.set(noteKey, { timer, channels });
  }

  /**
   * Send a raw MIDI note number with automatic note-off after duration.
   * Used for features like strum release where we need to send a specific
   * MIDI note number rather than a NoteObject.
   *
   * Uses State Guard to prevent Note Shadowing during rapid strumming.
   *
   * @param midiNote - MIDI note number (0-127)
   * @param velocity - MIDI velocity (0-127)
   * @param duration - Duration in seconds before note-off
   * @param channel - MIDI channel (0-15), or undefined to use default
   */
  async sendRawNote(midiNote: number, velocity: number, duration = 1.5, channel?: number): Promise<void> {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    const channels = this._getChannels(channel);
    const noteKey = this._getNoteKey(midiNote, channels);

    // Cancel existing timer for this note
    const existingTimer = this._activeNoteTimers.get(noteKey);
    if (existingTimer) {
      clearTimeout(existingTimer.timer);
      this._activeNoteTimers.delete(noteKey);
    }

    // Send note-on with State Guard protection
    // If the note is already on, kill it first (prevents orphaned notes)
    if (this._activeNotes.has(midiNote)) {
      for (const ch of channels) {
        await this._send([0x90 + ch, midiNote, 0]);
      }
    }

    // Now play the new note
    for (const ch of channels) {
      await this._send([0x90 + ch, midiNote, velocity]);
    }
    this._activeNotes.add(midiNote);

    // Schedule note-off
    const timer = setTimeout(async () => {
      if (this._isConnected && this._midiOut) {
        if (this._activeNotes.has(midiNote)) {
          for (const ch of channels) {
            await this._send([0x90 + ch, midiNote, 0]);
          }
          this._activeNotes.delete(midiNote);
        }
      }
      this._activeNoteTimers.delete(noteKey);
    }, duration * 1000);

    this._activeNoteTimers.set(noteKey, { timer, channels });
  }

  /**
   * Immediately release specific notes with State Guard protection.
   */
  async releaseNotes(notes: NoteObject[]): Promise<void> {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    for (const note of notes) {
      const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);

      // Cancel any pending timer for this note
      for (const [key, timerInfo] of Array.from(this._activeNoteTimers)) {
        if (key.startsWith(`${midiNote}:`)) {
          clearTimeout(timerInfo.timer);
          this._activeNoteTimers.delete(key);

          // Send note-off only if note is active
          if (this._activeNotes.has(midiNote)) {
            for (const ch of timerInfo.channels) {
              await this._send([0x90 + ch, midiNote, 0]);
            }
            this._activeNotes.delete(midiNote);
          }
        }
      }
    }
  }

  /**
   * Release all currently playing notes with State Guard protection.
   */
  async releaseAll(): Promise<void> {
    if (!this._isConnected || !this._midiOut) {
      return;
    }

    // Cancel all timers and send note-off for each active note
    for (const [key, timerInfo] of Array.from(this._activeNoteTimers)) {
      clearTimeout(timerInfo.timer);
      const midiNote = parseInt(key.split(':')[0], 10);

      if (this._activeNotes.has(midiNote)) {
        for (const ch of timerInfo.channels) {
          await this._send([0x90 + ch, midiNote, 0]);
        }
        this._activeNotes.delete(midiNote);
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
    const channel = this._channel ?? 0;
    this._midiOut.sendMessage([0xe0 + channel, lsb, msb]);
  }

  /**
   * Start device monitoring for device changes
   */
  private _startHotSwapMonitoring(): void {
    if (this._deviceMonitoring === false) {
      return;
    }

    // Stop any existing monitoring
    this._stopHotSwapMonitoring();

    // Start periodic scanning
    this._monitoringTimer = setInterval(() => {
      this._checkDeviceChanges();
    }, this._deviceMonitoring);

    console.log(`[RtMidi] Device monitoring started (interval: ${this._deviceMonitoring}ms)`);
  }

  /**
   * Stop device monitoring
   */
  private _stopHotSwapMonitoring(): void {
    if (this._monitoringTimer) {
      clearInterval(this._monitoringTimer);
      this._monitoringTimer = null;
      console.log('[RtMidi] Device monitoring stopped');
    }
  }

  /**
   * Check for device changes and attempt reconnection if needed
   */
  private async _checkDeviceChanges(): Promise<void> {
    if (!this._midiOut) {
      return;
    }

    try {
      // Get current available ports
      const currentPorts = this.getAvailablePorts();

      // Check if our current device is still connected
      if (this._isConnected && this._currentOutputName) {
        const stillConnected = currentPorts.some(port => port === this._currentOutputName);

        if (!stillConnected) {
          console.log(`[RtMidi] Device disconnected: ${this._currentOutputName}`);
          this._isConnected = false;
          this._currentOutputName = null;

          // Clear active notes since device is gone
          this._activeNotes.clear();

          // Try to reconnect
          await this._attemptReconnection(currentPorts);
        }
      } else if (!this._isConnected) {
        // Not connected, check if we can reconnect
        await this._attemptReconnection(currentPorts);
      }

      // Update the last known ports list
      this._lastAvailablePorts = currentPorts;
    } catch (error) {
      console.error('[RtMidi] Error checking device changes:', error);
    }
  }

  /**
   * Attempt to reconnect to a MIDI device
   */
  private async _attemptReconnection(availablePorts: string[]): Promise<void> {
    if (availablePorts.length === 0) {
      return;
    }

    // Check if there are new ports available
    const newPorts = availablePorts.filter(port => !this._lastAvailablePorts.includes(port));

    if (newPorts.length > 0) {
      console.log(`[RtMidi] New device(s) detected: ${newPorts.join(', ')}`);
    }

    // Try to reconnect using the last requested port
    if (this._lastRequestedPort !== undefined) {
      console.log(`[RtMidi] Attempting to reconnect to: ${this._lastRequestedPort ?? 'first available'}`);

      // Temporarily disable monitoring to avoid recursion
      const wasMonitoring = this._monitoringTimer !== null;
      this._stopHotSwapMonitoring();

      const success = await this.connect(this._lastRequestedPort);

      if (success) {
        console.log(`[RtMidi] Successfully reconnected to: ${this._currentOutputName}`);
      } else if (wasMonitoring) {
        // Restart monitoring if it was running
        this._startHotSwapMonitoring();
      }
    }
  }
}
