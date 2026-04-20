/**
 * Unit tests for MIDI backend functionality using mocks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockMidiBackend } from '../mocks/mock-midi-backend.js';
import { Note } from '../../src/models/note.js';

describe('MockMidiBackend', () => {
  let backend: MockMidiBackend;

  beforeEach(() => {
    backend = new MockMidiBackend();
  });

  describe('Connection', () => {
    it('should start disconnected', () => {
      expect(backend.isConnected).toBe(false);
      expect(backend.currentOutputName).toBeNull();
    });

    it('should connect to default port', async () => {
      await backend.connect();
      expect(backend.isConnected).toBe(true);
      expect(backend.currentOutputName).toBe('Mock Port 1');
    });

    it('should connect to specific port by name', async () => {
      await backend.connect('Mock Port 2');
      expect(backend.isConnected).toBe(true);
      expect(backend.currentOutputName).toBe('Mock Port 2');
    });

    it('should connect to specific port by index', async () => {
      await backend.connect(1);
      expect(backend.isConnected).toBe(true);
      expect(backend.currentOutputName).toBe('Mock Port 2');
    });

    it('should disconnect', async () => {
      await backend.connect();
      backend.disconnect();
      expect(backend.isConnected).toBe(false);
      expect(backend.currentOutputName).toBeNull();
    });
  });

  describe('MIDI Messages', () => {
    beforeEach(async () => {
      await backend.connect();
      backend.clearMessages();
    });

    it('should send note on message', () => {
      const note = Note.parseNotation('C4');
      backend.sendNoteOn(note, 100, 0);

      const messages = backend.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('note_on');
      expect(Note.noteToMidi(messages[0].note!)).toBe(60); // C4 (middle C) = MIDI 60
      expect(messages[0].velocity).toBe(100);
      expect(messages[0].channel).toBe(0);
    });

    it('should send note off message', () => {
      const note = Note.parseNotation('D4');
      backend.sendNoteOff(note, 0);

      const messages = backend.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('note_off');
      expect(Note.noteToMidi(messages[0].note!)).toBe(62); // D4 = MIDI 62
      expect(messages[0].channel).toBe(0);
    });

    it('should track active notes', () => {
      const c4 = Note.parseNotation('C4');
      const e4 = Note.parseNotation('E4');

      backend.sendNoteOn(c4, 100, 0);
      backend.sendNoteOn(e4, 100, 0);
      expect(backend.getActiveNotes()).toHaveLength(2);

      backend.sendNoteOff(c4, 0);
      expect(backend.getActiveNotes()).toHaveLength(1);

      backend.releaseAll();
      expect(backend.getActiveNotes()).toHaveLength(0);
    });

    it('should send pitch bend message', () => {
      backend.sendPitchBend(0.5);

      const messages = backend.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('pitch_bend');
      expect(messages[0].bendValue).toBe(0.5);
    });

    it('should use default channel', () => {
      backend.setChannel(5);
      const note = Note.parseNotation('C4');
      backend.sendNoteOn(note, 100);

      const messages = backend.getMessages();
      expect(messages[0].channel).toBe(5);
    });

    it('should override default channel when specified', () => {
      backend.setChannel(5);
      const note = Note.parseNotation('C4');
      backend.sendNoteOn(note, 100, 2);

      const messages = backend.getMessages();
      expect(messages[0].channel).toBe(2);
    });
  });

  describe('Note Scheduling', () => {
    beforeEach(async () => {
      await backend.connect();
      backend.clearMessages();
    });

    it('should schedule note on and off', async () => {
      const note = Note.parseNotation('C4');
      backend.sendNote(note, 100, 0.05); // 50ms duration

      // Should have note-on immediately
      let messages = backend.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('note_on');

      // Wait for note-off
      await new Promise(resolve => setTimeout(resolve, 100));
      messages = backend.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[1].type).toBe('note_off');
    });

    it('should release multiple notes', () => {
      const c4 = Note.parseNotation('C4');
      const e4 = Note.parseNotation('E4');
      const g4 = Note.parseNotation('G4');

      backend.sendNoteOn(c4, 100, 0);
      backend.sendNoteOn(e4, 100, 0);
      backend.sendNoteOn(g4, 100, 0);

      backend.releaseNotes([c4, e4, g4]);

      const messages = backend.getMessages();
      expect(messages).toHaveLength(6); // 3 note-on + 3 note-off
      expect(messages.filter(m => m.type === 'note_off')).toHaveLength(3);
    });
  });

  describe('Configuration Options', () => {
    it('should respect channel configuration on construction', () => {
      const backend1 = new MockMidiBackend({ channel: 3 });
      backend1.connect();
      const note = Note.parseNotation('C4');
      backend1.sendNoteOn(note, 100);

      const messages = backend1.getMessages();
      expect(messages[0].channel).toBe(3);
      backend1.disconnect();
    });

    it('should default to channel 0 when no channel specified', () => {
      const backend1 = new MockMidiBackend();
      backend1.connect();
      const note = Note.parseNotation('C4');
      backend1.sendNoteOn(note, 100);

      const messages = backend1.getMessages();
      expect(messages[0].channel).toBe(0);
      backend1.disconnect();
    });

    it('should allow changing channel dynamically with setChannel', async () => {
      await backend.connect();
      backend.clearMessages();

      const note = Note.parseNotation('C4');

      // Send on channel 0
      backend.sendNoteOn(note, 100);
      expect(backend.getMessages()[0].channel).toBe(0);

      // Change to channel 7
      backend.setChannel(7);
      backend.clearMessages();
      backend.sendNoteOn(note, 100);
      expect(backend.getMessages()[0].channel).toBe(7);

      // Change to channel 15 (max)
      backend.setChannel(15);
      backend.clearMessages();
      backend.sendNoteOn(note, 100);
      expect(backend.getMessages()[0].channel).toBe(15);
    });

    it('should support all 16 MIDI channels (0-15)', async () => {
      await backend.connect();
      const note = Note.parseNotation('C4');

      for (let ch = 0; ch < 16; ch++) {
        backend.clearMessages();
        backend.sendNoteOn(note, 100, ch);
        expect(backend.getMessages()[0].channel).toBe(ch);
      }
    });

    it('should handle inter-message delay option', () => {
      const backendWithDelay = new MockMidiBackend({
        channel: 0,
        interMessageDelay: 0.002
      });

      // Mock doesn't actually delay, but verify option is accepted
      expect(backendWithDelay).toBeDefined();
      backendWithDelay.disconnect();
    });

    it('should handle device monitoring disabled', () => {
      const backend1 = new MockMidiBackend({
        channel: 0,
        device_monitoring: false
      });

      expect(backend1).toBeDefined();
      backend1.disconnect();
    });

    it('should handle device monitoring with custom interval', () => {
      const backend1 = new MockMidiBackend({
        channel: 0,
        device_monitoring: 5000 // 5 second interval
      });

      expect(backend1).toBeDefined();
      backend1.disconnect();
    });

    it('should handle device monitoring set to 0 (disabled)', () => {
      const backend1 = new MockMidiBackend({
        channel: 0,
        device_monitoring: 0
      });

      expect(backend1).toBeDefined();
      backend1.disconnect();
    });
  });

  describe('Channel Routing Edge Cases', () => {
    beforeEach(async () => {
      await backend.connect();
      backend.clearMessages();
    });

    it('should send to different channels in rapid succession', () => {
      const note = Note.parseNotation('C4');

      backend.sendNoteOn(note, 100, 0);
      backend.sendNoteOn(note, 100, 1);
      backend.sendNoteOn(note, 100, 2);

      const messages = backend.getMessages();
      expect(messages[0].channel).toBe(0);
      expect(messages[1].channel).toBe(1);
      expect(messages[2].channel).toBe(2);
    });

    it('should maintain separate active notes per channel', () => {
      const note = Note.parseNotation('C4');

      backend.sendNoteOn(note, 100, 0);
      backend.sendNoteOn(note, 100, 1);
      backend.sendNoteOn(note, 100, 2);

      // All three notes should be active
      expect(backend.getActiveNotes()).toHaveLength(3);

      // Release on channel 0
      backend.sendNoteOff(note, 0);
      expect(backend.getActiveNotes()).toHaveLength(2);

      // Release on channel 1
      backend.sendNoteOff(note, 1);
      expect(backend.getActiveNotes()).toHaveLength(1);
    });

    it('should handle scheduled notes on different channels', async () => {
      const note = Note.parseNotation('C4');

      backend.sendNote(note, 100, 0.05, 0); // Channel 0
      backend.sendNote(note, 100, 0.05, 5); // Channel 5
      backend.sendNote(note, 100, 0.05, 10); // Channel 10

      const messages = backend.getMessages();
      expect(messages.filter(m => m.channel === 0 && m.type === 'note_on')).toHaveLength(1);
      expect(messages.filter(m => m.channel === 5 && m.type === 'note_on')).toHaveLength(1);
      expect(messages.filter(m => m.channel === 10 && m.type === 'note_on')).toHaveLength(1);

      // Wait for auto-release
      await new Promise(resolve => setTimeout(resolve, 100));

      const allMessages = backend.getMessages();
      expect(allMessages.filter(m => m.channel === 0 && m.type === 'note_off')).toHaveLength(1);
      expect(allMessages.filter(m => m.channel === 5 && m.type === 'note_off')).toHaveLength(1);
      expect(allMessages.filter(m => m.channel === 10 && m.type === 'note_off')).toHaveLength(1);
    });
  });
});

