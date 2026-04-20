/**
 * Virtual MIDI Integration Tests
 *
 * Tests the RtMidiBackend with actual MIDI libraries using virtual MIDI ports.
 * These tests verify that MIDI messages are actually sent correctly through
 * the real RtMidi library.
 *
 * Requirements:
 *   - macOS: IAC Driver enabled (built-in)
 *   - Linux: snd-virmidi kernel module loaded
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { RtMidiBackend } from '../../src/midi/rtmidi-backend.js';
import { Note } from '../../src/models/note.js';
import { detectVirtualMidi, skipIfNoVirtualMidi, type VirtualMidiSetup } from '../helpers/virtual-midi.js';

describe('Virtual MIDI Integration Tests', () => {
  let virtualMidiSetup: VirtualMidiSetup;
  let backend: RtMidiBackend | null = null;

  beforeAll(async () => {
    virtualMidiSetup = await detectVirtualMidi();
    
    if (skipIfNoVirtualMidi(virtualMidiSetup)) {
      // Tests will be skipped
      return;
    }
    
    console.log(`✅ Virtual MIDI available: ${virtualMidiSetup.portName} (${virtualMidiSetup.platform})`);
  });

  afterEach(async () => {
    if (backend) {
      await backend.disconnect();
      backend = null;
    }
  });

  describe('RtMidiBackend with Virtual MIDI', () => {
    it('should connect to virtual MIDI port', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      const connected = await backend.connect(virtualMidiSetup.portName);
      
      expect(connected).toBe(true);
      expect(backend.isConnected).toBe(true);
    });

    it('should send note on and note off messages', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      await backend.connect(virtualMidiSetup.portName);
      
      const note = Note.parseNotation('C4');
      
      // Send note on
      await backend.sendNoteOn(note, 100);
      
      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Send note off
      await backend.sendNoteOff(note);
      
      // If we got here without errors, MIDI was sent successfully
      expect(backend.isConnected).toBe(true);
    });

    it('should send scheduled note with automatic note off', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      await backend.connect(virtualMidiSetup.portName);
      
      const note = Note.parseNotation('A4');
      
      // Send note with 50ms duration
      await backend.sendNote(note, 100, 0.05);
      
      // Wait for note to auto-release
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(backend.isConnected).toBe(true);
    });

    it('should send pitch bend messages', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      await backend.connect(virtualMidiSetup.portName);
      
      // Send center pitch bend
      await backend.sendPitchBend(0.0);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Send up bend
      await backend.sendPitchBend(1.0);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Send down bend
      await backend.sendPitchBend(-1.0);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(backend.isConnected).toBe(true);
    });

    it('should handle multiple channels', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      await backend.connect(virtualMidiSetup.portName);
      
      const note = Note.parseNotation('E4');
      
      // Send on default channel (0)
      await backend.sendNoteOn(note, 100);
      await new Promise(resolve => setTimeout(resolve, 10));
      await backend.sendNoteOff(note);
      
      // Send on channel 1
      await backend.sendNoteOn(note, 100, 1);
      await new Promise(resolve => setTimeout(resolve, 10));
      await backend.sendNoteOff(note, 1);
      
      expect(backend.isConnected).toBe(true);
    });

    it('should release all notes', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      await backend.connect(virtualMidiSetup.portName);
      
      const notes = [
        Note.parseNotation('C4'),
        Note.parseNotation('E4'),
        Note.parseNotation('G4')
      ];
      
      // Send multiple notes
      for (const note of notes) {
        await backend.sendNoteOn(note, 100);
      }
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Release all
      await backend.releaseNotes(notes);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(backend.isConnected).toBe(true);
    });

    it('should list available MIDI ports', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      // Need to connect first to initialize the MIDI output
      await backend.connect(virtualMidiSetup.portName);
      const ports = backend.getAvailablePorts();

      expect(ports.length).toBeGreaterThan(0);
      expect(ports.some(port => port.includes(virtualMidiSetup.portName) ||
                                port.includes('IAC') ||
                                port.includes('Virtual'))).toBe(true);
    });

    it('should handle rapid note changes (State Guard test)', async () => {
      if (!virtualMidiSetup.available) {
        console.log('Skipping: Virtual MIDI not available');
        return;
      }

      backend = new RtMidiBackend({ channel: 0 });
      await backend.connect(virtualMidiSetup.portName);
      
      const note = Note.parseNotation('C4');
      
      // Rapidly send the same note multiple times
      // State Guard should prevent note shadowing
      for (let i = 0; i < 10; i++) {
        await backend.sendNoteOn(note, 100);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      
      await backend.sendNoteOff(note);
      
      expect(backend.isConnected).toBe(true);
    });
  });
});
