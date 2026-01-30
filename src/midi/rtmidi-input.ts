/**
 * RtMidi Input Backend
 *
 * MIDI input backend using @julusian/midi for cross-platform MIDI support.
 * Listens to MIDI input from external devices (keyboards, controllers).
 */

import { Note, type NoteObject } from '../models/note.js';
import { EventEmitter } from '../utils/event-emitter.js';

// Dynamic import for midi - it's a native module
let midi: typeof import('@julusian/midi') | null = null;

async function loadMidi(): Promise<typeof import('@julusian/midi')> {
  if (!midi) {
    midi = await import('@julusian/midi');
  }
  return midi;
}

/** MIDI input port info */
export interface MidiInputPort {
  id: number;
  name: string;
}

/** MIDI note event data */
export interface MidiInputNoteEvent {
  /** Currently held notes as strings (e.g., ['C4', 'E4', 'G4']) */
  notes: string[];
  /** Note that was just added (if any) */
  added?: string;
  /** Note that was just removed (if any) */
  removed?: string;
  /** Name of the port that sent this event */
  portName?: string;
}

/** MIDI connection event data */
export interface MidiInputConnectionEvent {
  /** Whether connected to a MIDI input */
  connected: boolean;
  /** Name of the connected input port */
  inputPort?: string;
}

/** Event types for MIDI input */
export const MIDI_INPUT_NOTE_EVENT = 'note';
export const MIDI_INPUT_CONNECTION_EVENT = 'connection';

/**
 * MIDI input backend using @julusian/midi (RtMidi wrapper).
 *
 * Listens to MIDI input and emits events when notes are pressed/released.
 * Can connect to a single port or listen to ALL available ports.
 *
 * @example
 * ```typescript
 * const input = new RtMidiInput();
 * input.on('note', (event) => {
 *   console.log('Notes held:', event.notes);
 * });
 * // Connect to specific port
 * await input.connect('My MIDI Keyboard');
 * // Or listen to all ports
 * await input.connectAll();
 * ```
 */
export class RtMidiInput extends EventEmitter {
  private _midiInputs: Map<number, InstanceType<typeof import('@julusian/midi').Input>> = new Map();
  private _isConnected = false;
  private _currentInputName: string | null = null;
  private _notes: string[] = [];
  private _connectedPorts: MidiInputPort[] = [];

  constructor() {
    super();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get currentInputName(): string | null {
    return this._currentInputName;
  }

  /** Get the list of currently held notes as strings */
  get notes(): string[] {
    return [...this._notes];
  }

  /** Get the list of connected ports */
  get connectedPorts(): MidiInputPort[] {
    return [...this._connectedPorts];
  }

  /** Get the list of currently held notes as NoteObjects */
  getNotesAsObjects(): NoteObject[] {
    return this._notes.map((noteStr) => Note.parseNotation(noteStr));
  }

  /**
   * Get list of available MIDI input ports
   */
  async getAvailablePorts(): Promise<MidiInputPort[]> {
    try {
      const midiModule = await loadMidi();
      const tempInput = new midiModule.Input();
      
      const ports: MidiInputPort[] = [];
      const portCount = tempInput.getPortCount();
      for (let i = 0; i < portCount; i++) {
        ports.push({ id: i, name: tempInput.getPortName(i) });
      }
      
      tempInput.closePort();
      return ports;
    } catch (error) {
      console.error('[RtMidiInput] Failed to get available ports:', error);
      return [];
    }
  }

  /**
   * Connect to ALL available MIDI input ports
   * Useful for discovering which device the user is playing
   *
   * @param excludePorts - List of port name substrings to exclude (e.g., to avoid feedback loops)
   */
  async connectAll(excludePorts: string[] = []): Promise<boolean> {
    try {
      const midiModule = await loadMidi();

      // Close existing connections
      this.disconnect();

      // Get available ports
      const tempInput = new midiModule.Input();
      const portCount = tempInput.getPortCount();
      tempInput.closePort();

      if (portCount === 0) {
        console.log('[RtMidiInput] No MIDI input ports available');
        return false;
      }

      let connectedCount = 0;

      // Connect to each port
      for (let i = 0; i < portCount; i++) {
        const input = new midiModule.Input();
        const portName = input.getPortName(i);

        // Check if this port should be excluded
        const shouldExclude = excludePorts.some(
          (pattern) => pattern && portName.toLowerCase().includes(pattern.toLowerCase())
        );

        if (shouldExclude) {
          console.log(`[RtMidiInput] Skipping port ${i}: ${portName} (matches exclude pattern)`);
          input.closePort();
          continue;
        }

        // Set up message callback with port info
        input.on('message', (_deltaTime: number, message: number[]) => {
          this.handleMidiMessage(message, portName);
        });

        input.openPort(i);
        this._midiInputs.set(i, input);
        this._connectedPorts.push({ id: i, name: portName });
        connectedCount++;

        console.log(`[RtMidiInput] Connected to port ${i}: ${portName}`);
      }

      if (connectedCount === 0) {
        console.log('[RtMidiInput] No MIDI input ports available after exclusions');
        return false;
      }

      this._isConnected = true;
      this._currentInputName = `All ports (${connectedCount})`;
      this._notes = [];

      // Emit connection event
      this.emit<MidiInputConnectionEvent>(MIDI_INPUT_CONNECTION_EVENT, {
        connected: true,
        inputPort: this._currentInputName,
      });

      return true;
    } catch (error) {
      console.error('[RtMidiInput] Failed to connect to all ports:', error);
      return false;
    }
  }

  /**
   * Connect to a specific MIDI input port
   *
   * @param inputPort - Port name (string) or index (number)
   */
  async connect(inputPort: string | number): Promise<boolean> {
    try {
      const midiModule = await loadMidi();
      
      // Close existing connections
      this.disconnect();
      
      const input = new midiModule.Input();
      const portCount = input.getPortCount();
      
      if (portCount === 0) {
        console.log('[RtMidiInput] No MIDI input ports available');
        input.closePort();
        return false;
      }

      let portIndex = 0;

      if (typeof inputPort === 'number') {
        // Use port index directly
        if (inputPort >= 0 && inputPort < portCount) {
          portIndex = inputPort;
        } else {
          console.error(`[RtMidiInput] Invalid port index: ${inputPort}`);
          input.closePort();
          return false;
        }
      } else if (typeof inputPort === 'string') {
        // Find port by name (partial match)
        let found = false;
        for (let i = 0; i < portCount; i++) {
          const name = input.getPortName(i);
          if (name === inputPort || name.includes(inputPort)) {
            portIndex = i;
            found = true;
            break;
          }
        }
        if (!found) {
          console.error(`[RtMidiInput] Port not found: ${inputPort}`);
          console.log('[RtMidiInput] Available ports:');
          for (let i = 0; i < portCount; i++) {
            console.log(`  ${i}: ${input.getPortName(i)}`);
          }
          input.closePort();
          return false;
        }
      }

      const portName = input.getPortName(portIndex);
      
      // Set up message callback before opening port
      input.on('message', (_deltaTime: number, message: number[]) => {
        this.handleMidiMessage(message, portName);
      });
      
      input.openPort(portIndex);
      
      this._midiInputs.set(portIndex, input);
      this._connectedPorts.push({ id: portIndex, name: portName });
      this._isConnected = true;
      this._currentInputName = portName;
      this._notes = [];
      
      console.log(`[RtMidiInput] Connected to port ${portIndex}: ${portName}`);
      
      // Emit connection event
      this.emit<MidiInputConnectionEvent>(MIDI_INPUT_CONNECTION_EVENT, {
        connected: true,
        inputPort: portName,
      });
      
      return true;
    } catch (error) {
      console.error('[RtMidiInput] Failed to connect:', error);
      return false;
    }
  }

  /**
   * Disconnect from all MIDI inputs
   */
  disconnect(): void {
    for (const [, input] of this._midiInputs) {
      input.closePort();
    }
    this._midiInputs.clear();
    this._connectedPorts = [];
    
    this._isConnected = false;
    this._currentInputName = null;
    this._notes = [];
    
    console.log('[RtMidiInput] Disconnected');
    
    // Emit disconnection event
    this.emit<MidiInputConnectionEvent>(MIDI_INPUT_CONNECTION_EVENT, {
      connected: false,
    });
  }

  /**
   * Handle incoming MIDI messages
   */
  private handleMidiMessage(message: number[], portName: string): void {
    if (message.length < 3) return;

    const command = message[0];
    const noteNumber = message[1];
    const velocity = message[2];

    // Convert MIDI note number to notation
    const notationList = [...Note.sharpNotations];
    const notation = notationList[noteNumber % 12];
    const octave = Math.floor(noteNumber / 12) - 1;

    // Note On: 0x90-0x9F (144-159)
    if (command >= 0x90 && command <= 0x9f) {
      if (velocity > 0) {
        this.onNoteDown(notation, octave, portName);
      } else {
        // Note On with velocity 0 is treated as Note Off
        this.onNoteUp(notation, octave, portName);
      }
    }
    // Note Off: 0x80-0x8F (128-143)
    else if (command >= 0x80 && command <= 0x8f) {
      this.onNoteUp(notation, octave, portName);
    }
  }

  /**
   * Handle note down event
   */
  private onNoteDown(notation: string, octave: number, portName: string): void {
    const noteStr = `${notation}${octave}`;
    if (!this._notes.includes(noteStr)) {
      this._notes.push(noteStr);
      this._notes = Note.sort(this._notes);

      // Emit event
      this.emit<MidiInputNoteEvent>(MIDI_INPUT_NOTE_EVENT, {
        notes: [...this._notes],
        added: noteStr,
        portName,
      });
    }
  }

  /**
   * Handle note up event
   */
  private onNoteUp(notation: string, octave: number, portName: string): void {
    const noteStr = `${notation}${octave}`;
    const index = this._notes.indexOf(noteStr);
    if (index !== -1) {
      this._notes.splice(index, 1);
      this._notes = Note.sort(this._notes);

      // Emit event
      this.emit<MidiInputNoteEvent>(MIDI_INPUT_NOTE_EVENT, {
        notes: [...this._notes],
        removed: noteStr,
        portName,
      });
    }
  }
}
