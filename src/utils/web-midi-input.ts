/**
 * WebMIDI Input Handler
 *
 * Handles MIDI input from external devices using the WebMIDI API.
 * Listens for note-on/note-off messages and maintains a list of currently held notes.
 */

import { EventEmitter } from './event-emitter.js';
import { Note, type NoteObject } from '../models/note.js';

// Event types
export const MIDI_NOTE_EVENT = 'note';
export const MIDI_CONNECTION_EVENT = 'connection';

/**
 * Event emitted when notes change
 */
export interface MidiNoteEvent {
  /** Current list of held notes as strings (e.g., "C4", "E4") */
  notes: string[];
  /** Note that was just added (if any) */
  added?: string;
  /** Note that was just removed (if any) */
  removed?: string;
}

/**
 * Event emitted when MIDI connection state changes
 */
export interface MidiConnectionEvent {
  /** Whether MIDI is connected */
  connected: boolean;
  /** Name of the connected input port (if any) */
  inputPort?: string;
  /** Name of the connected output port (if any) */
  outputPort?: string;
}

/**
 * Information about a MIDI input device
 */
export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
}

/**
 * WebMIDI Input class - handles MIDI input from external devices
 */
export class WebMidiInput extends EventEmitter {
  private midiAccess: MIDIAccess | null = null;
  private midiIn: MIDIInput | null = null;
  private _notes: string[] = [];
  private _isConnected = false;
  private _currentInputName: string | null = null;

  constructor() {
    super();
  }

  /**
   * Check if WebMIDI is supported in this browser
   */
  static isSupported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  /**
   * Get the current input device
   */
  get currentInput(): MIDIInput | null {
    return this.midiIn;
  }

  /**
   * Get the current input device name
   */
  get currentInputName(): string | null {
    return this._currentInputName;
  }

  /**
   * Get the list of currently held notes
   */
  get notes(): string[] {
    return [...this._notes];
  }

  /**
   * Check if MIDI is connected
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get list of available MIDI input devices
   */
  async getAvailableInputs(): Promise<MidiInputInfo[]> {
    if (!WebMidiInput.isSupported()) {
      console.warn('[WebMidiInput] WebMIDI not supported in this browser');
      return [];
    }

    try {
      if (!this.midiAccess) {
        this.midiAccess = await navigator.requestMIDIAccess();
      }

      const inputs: MidiInputInfo[] = [];
      for (const input of this.midiAccess.inputs.values()) {
        inputs.push({
          id: input.id,
          name: input.name ?? 'Unknown Device',
          manufacturer: input.manufacturer ?? 'Unknown',
        });
      }
      return inputs;
    } catch (error) {
      console.error('[WebMidiInput] Failed to get MIDI access:', error);
      return [];
    }
  }

  /**
   * Initialize MIDI access and optionally connect to a specific input
   *
   * @param inputId - Optional input device ID or name to connect to
   */
  async connect(inputId?: string): Promise<boolean> {
    if (!WebMidiInput.isSupported()) {
      console.warn('[WebMidiInput] WebMIDI not supported in this browser');
      this.emitConnectionEvent(false);
      return false;
    }

    try {
      // Request MIDI access
      this.midiAccess = await navigator.requestMIDIAccess();

      // Get available inputs
      const inputs = Array.from(this.midiAccess.inputs.values());

      if (inputs.length === 0) {
        console.warn('[WebMidiInput] No MIDI input ports available');
        this.emitConnectionEvent(false);
        return false;
      }

      console.log(
        '[WebMidiInput] Available input ports:',
        inputs.map((i) => i.name)
      );

      // Find the input to use
      let selectedInput: MIDIInput | null = null;

      if (inputId) {
        // Try to find by ID first
        selectedInput = inputs.find((i) => i.id === inputId) ?? null;

        // If not found by ID, try by name
        if (!selectedInput) {
          selectedInput =
            inputs.find(
              (i) => i.name === inputId || i.name?.includes(inputId)
            ) ?? null;
        }

        if (!selectedInput) {
          console.warn(
            `[WebMidiInput] Input '${inputId}' not found, using first available`
          );
        }
      }

      // Default to first input if none specified or not found
      if (!selectedInput) {
        selectedInput = inputs[0];
      }

      // Connect to the selected input
      this.midiIn = selectedInput;
      this._currentInputName = selectedInput.name ?? 'Unknown Device';
      this.midiIn.onmidimessage = this.handleMidiMessage.bind(this);
      this._isConnected = true;

      console.log(`[WebMidiInput] Connected to: ${this._currentInputName}`);

      // Listen for device changes
      this.midiAccess.onstatechange = this.handleStateChange.bind(this);

      this.emitConnectionEvent(true, this._currentInputName);
      return true;
    } catch (error) {
      console.error('[WebMidiInput] Failed to connect:', error);
      this._isConnected = false;
      this.emitConnectionEvent(false);
      return false;
    }
  }

  /**
   * Switch to a different MIDI input device
   *
   * @param inputId - Input device ID or name to switch to
   */
  async switchInput(inputId: string): Promise<boolean> {
    if (!this.midiAccess) {
      return this.connect(inputId);
    }

    // Disconnect current input
    if (this.midiIn) {
      this.midiIn.onmidimessage = null;
    }

    // Clear held notes when switching
    this._notes = [];

    // Find and connect to new input
    const inputs = Array.from(this.midiAccess.inputs.values());
    let selectedInput =
      inputs.find((i) => i.id === inputId) ??
      inputs.find((i) => i.name === inputId || i.name?.includes(inputId)) ??
      null;

    if (!selectedInput) {
      console.warn(`[WebMidiInput] Input '${inputId}' not found`);
      this._isConnected = false;
      this.emitConnectionEvent(false);
      return false;
    }

    this.midiIn = selectedInput;
    this._currentInputName = selectedInput.name ?? 'Unknown Device';
    this.midiIn.onmidimessage = this.handleMidiMessage.bind(this);
    this._isConnected = true;

    console.log(`[WebMidiInput] Switched to: ${this._currentInputName}`);
    this.emitConnectionEvent(true, this._currentInputName);
    return true;
  }

  /**
   * Disconnect from MIDI
   */
  disconnect(): void {
    if (this.midiIn) {
      this.midiIn.onmidimessage = null;
      this.midiIn = null;
    }

    this._notes = [];
    this._isConnected = false;
    this._currentInputName = null;

    this.emitConnectionEvent(false);
    console.log('[WebMidiInput] Disconnected');
  }

  /**
   * Handle incoming MIDI messages
   */
  private handleMidiMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;

    const command = data[0] & 0xf0; // Strip channel from status byte
    const midiNote = data[1];
    const velocity = data[2];

    // Convert MIDI note number to notation
    const notation = Note.sharpNotations[midiNote % 12];
    const octave = Math.floor(midiNote / 12) - 1;

    if (command === 0x90 && velocity > 0) {
      // Note On
      this.onNoteDown(notation, octave);
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      // Note Off (or Note On with velocity 0)
      this.onNoteUp(notation, octave);
    }
  }

  /**
   * Handle note down event
   */
  private onNoteDown(notation: string, octave: number): void {
    const noteStr = `${notation}${octave}`;
    if (!this._notes.includes(noteStr)) {
      this._notes.push(noteStr);
      this._notes = Note.sort(this._notes);

      this.emit<MidiNoteEvent>(MIDI_NOTE_EVENT, {
        notes: [...this._notes],
        added: noteStr,
      });
    }
  }

  /**
   * Handle note up event
   */
  private onNoteUp(notation: string, octave: number): void {
    const noteStr = `${notation}${octave}`;
    const index = this._notes.indexOf(noteStr);
    if (index !== -1) {
      this._notes.splice(index, 1);
      this._notes = Note.sort(this._notes);

      this.emit<MidiNoteEvent>(MIDI_NOTE_EVENT, {
        notes: [...this._notes],
        removed: noteStr,
      });
    }
  }

  /**
   * Handle MIDI state changes (device connect/disconnect)
   */
  private handleStateChange(event: MIDIConnectionEvent): void {
    const port = event.port;
    console.log(
      `[WebMidiInput] MIDI port ${port.name} ${port.state} (${port.connection})`
    );

    // If our current input was disconnected, try to reconnect
    if (
      port.type === 'input' &&
      port.state === 'disconnected' &&
      this.midiIn?.id === port.id
    ) {
      console.log('[WebMidiInput] Current input disconnected');
      this._isConnected = false;
      this._currentInputName = null;
      this._notes = [];
      this.emitConnectionEvent(false);
    }
  }

  /**
   * Emit a connection event
   */
  private emitConnectionEvent(connected: boolean, inputPort?: string): void {
    this.emit<MidiConnectionEvent>(MIDI_CONNECTION_EVENT, {
      connected,
      inputPort,
    });
  }

  /**
   * Convert current notes to NoteObject array
   */
  getNotesAsObjects(): NoteObject[] {
    return this._notes.map((noteStr) => Note.parseNotation(noteStr));
  }
}
