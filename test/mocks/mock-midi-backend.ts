/**
 * Mock MIDI Backend for Unit Testing
 *
 * Provides a fake MIDI backend that records all MIDI messages
 * without requiring actual MIDI hardware or virtual ports.
 */

import type { MidiBackendProtocol, MidiBackendOptions } from '../../src/midi/protocol.js';
import type { NoteObject } from '../../src/models/note.js';

export interface MidiMessage {
  type: 'note_on' | 'note_off' | 'pitch_bend' | 'raw';
  timestamp: number;
  note?: NoteObject;
  velocity?: number;
  channel?: number;
  bendValue?: number;
  rawBytes?: number[];
}

/**
 * Mock MIDI backend that records all sent messages for testing
 */
export class MockMidiBackend implements MidiBackendProtocol {
  private _isConnected = false;
  private _currentOutputName: string | null = null;
  private _channel: number = 0;
  private _messages: MidiMessage[] = [];
  private _activeNotes: Set<string> = new Set();
  private _availablePorts: string[] = ['Mock Port 1', 'Mock Port 2', 'Mock Virtual Port'];

  constructor(options: MidiBackendOptions = {}) {
    this._channel = options.channel ?? 0;
    // Mock accepts but ignores: interMessageDelay, device_monitoring, useVirtualPorts, virtualPortName
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get currentOutputName(): string | null {
    return this._currentOutputName;
  }

  async connect(outputPort?: string | number | null): Promise<boolean> {
    this._isConnected = true;
    if (typeof outputPort === 'string') {
      this._currentOutputName = outputPort;
    } else if (typeof outputPort === 'number') {
      this._currentOutputName = this._availablePorts[outputPort] || null;
    } else {
      this._currentOutputName = this._availablePorts[0];
    }
    return true;
  }

  disconnect(): void {
    this._isConnected = false;
    this._currentOutputName = null;
    this._activeNotes.clear();
  }

  sendNoteOn(note: NoteObject, velocity: number, channel?: number): void {
    // Store note as string: "notation_octave_channel" (e.g., "C_4_0")
    const noteKey = `${note.notation}_${note.octave}_${channel ?? this._channel}`;
    this._activeNotes.add(noteKey);
    this._messages.push({
      type: 'note_on',
      timestamp: Date.now(),
      note,
      velocity,
      channel: channel ?? this._channel,
    });
  }

  sendNoteOff(note: NoteObject, channel?: number): void {
    const noteKey = `${note.notation}_${note.octave}_${channel ?? this._channel}`;
    this._activeNotes.delete(noteKey);
    this._messages.push({
      type: 'note_off',
      timestamp: Date.now(),
      note,
      channel: channel ?? this._channel,
    });
  }

  sendNote(note: NoteObject, velocity: number, duration: number = 1.5, channel?: number): void {
    this.sendNoteOn(note, velocity, channel);
    setTimeout(() => {
      this.sendNoteOff(note, channel);
    }, duration * 1000);
  }

  releaseNotes(notes: NoteObject[]): void {
    for (const note of notes) {
      this.sendNoteOff(note);
    }
  }

  releaseAll(): void {
    this._activeNotes.clear();
  }

  setChannel(channel?: number): void {
    this._channel = channel ?? 0;
  }

  sendPitchBend(bendValue: number): void {
    this._messages.push({
      type: 'pitch_bend',
      timestamp: Date.now(),
      bendValue,
      channel: this._channel,
    });
  }

  getAvailablePorts(): string[] {
    return [...this._availablePorts];
  }

  // Test helper methods
  getMessages(): MidiMessage[] {
    return [...this._messages];
  }

  clearMessages(): void {
    this._messages = [];
  }

  getActiveNotes(): string[] {
    return Array.from(this._activeNotes);
  }

  setAvailablePorts(ports: string[]): void {
    this._availablePorts = ports;
  }

  // Simulate a raw MIDI message being sent (for passthrough testing)
  sendRawMessage(bytes: number[]): void {
    this._messages.push({
      type: 'raw',
      timestamp: Date.now(),
      rawBytes: bytes,
    });
  }
}

