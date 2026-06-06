/**
 * Tests for slide-mode wiring in StrummerWebSocketServer.handleSlide.
 *
 * Verifies that Slider events are routed to the MIDI backend as the
 * correct sequence of note_on / pitch_bend / note_off / aftertouch / cc
 * messages and that StrumEventData is emitted on the event bus for
 * visualizers. Mirrors python/tests/unit/test_server_slide.py.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StrummerWebSocketServer } from '../../src/cli/server.js';
import {
  StrummerEventBus,
  type StrumEventData,
} from '../../src/utils/strummer-event-bus.js';
import { MidiStrummerConfig } from '../../src/models/midi-strummer-config.js';
import { Slider, type SlideRoutingState } from '../../src/core/slider.js';
import type { NoteObject } from '../../src/models/note.js';
import { MockMidiBackend } from '../mocks/mock-midi-backend.js';

const C4: NoteObject = { notation: 'C', octave: 4, secondary: false };
const E4: NoteObject = { notation: 'E', octave: 4, secondary: false };
const G4: NoteObject = { notation: 'G', octave: 4, secondary: false };

interface FakeServer {
  config: MidiStrummerConfig;
  backend: MockMidiBackend | null;
  eventBus: StrummerEventBus;
  slider: Slider;
  slideState: SlideRoutingState;
  notesPlayed: number;
  handleSlide(strumX: number, pressure: number): void;
}

/**
 * Build a minimal server instance that bypasses the heavy constructor,
 * mirroring the Python tests' use of StrummerWebSocketServer.__new__.
 */
async function makeServer(
  notes: NoteObject[] = [C4, E4, G4],
  maxBendSemitones = 2.0,
  pressureThreshold = 0.1,
): Promise<{ server: FakeServer; backend: MockMidiBackend; emitted: StrumEventData[] }> {
  const server = Object.create(StrummerWebSocketServer.prototype) as FakeServer;

  server.config = new MidiStrummerConfig();
  server.config.strummer.mode = 'slide';
  server.config.strummer.slide.maxBendSemitones = maxBendSemitones;
  server.config.strummer.slide.pressureThreshold = pressureThreshold;

  const backend = new MockMidiBackend({ channel: 0 });
  await backend.connect();
  server.backend = backend;

  server.eventBus = new StrummerEventBus(0);
  server.eventBus.resume();
  const emitted: StrumEventData[] = [];
  server.eventBus.onStrumEvent((d) => emitted.push(d));

  server.slider = new Slider();
  server.slider.configure(pressureThreshold, maxBendSemitones);
  server.slider.updateBounds(1.0, 1.0);
  server.slider.notes = notes;

  server.slideState = { activeSlideNote: null, lastModulationValue: null };
  server.notesPlayed = 0;

  return { server, backend, emitted };
}

describe('StrummerWebSocketServer.handleSlide', () => {
  let server: FakeServer;
  let backend: MockMidiBackend;
  let emitted: StrumEventData[];

  beforeEach(async () => {
    ({ server, backend, emitted } = await makeServer());
  });

  it('pen-down sends pitch_bend then note_on', () => {
    server.handleSlide(1 / 6, 0.5);

    const msgs = backend.getMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[0].type).toBe('pitch_bend');
    expect(msgs[1].type).toBe('note_on');
    expect(msgs[1].note?.notation).toBe('C');
    expect(msgs[1].note?.octave).toBe(4);
    expect(msgs[1].velocity).toBeGreaterThan(0);
    expect(server.slideState.activeSlideNote).not.toBeNull();
    expect(server.slideState.activeSlideNote?.notation).toBe('C');
    expect(server.notesPlayed).toBe(1);
  });

  it('move within the same string slot sends pitch_bend only', () => {
    server.config.strummer.slide.pressureModulation.type = 'none';
    server.handleSlide(1 / 6, 0.5);
    backend.clearMessages();

    server.handleSlide(1.5 / 6, 0.5);

    const msgs = backend.getMessages();
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.every((m) => m.type === 'pitch_bend')).toBe(true);
    expect(server.slideState.activeSlideNote?.notation).toBe('C');
  });

  it('pen-up sends note_off and resets bend to 0', () => {
    server.handleSlide(1 / 6, 0.5);
    const held = server.slideState.activeSlideNote;
    expect(held).not.toBeNull();
    backend.clearMessages();

    server.handleSlide(1 / 6, 0.0);

    const msgs = backend.getMessages();
    const types = msgs.map((m) => m.type);
    expect(types).toContain('note_off');
    const noteOff = msgs.find((m) => m.type === 'note_off')!;
    expect(noteOff.note?.notation).toBe(held!.notation);
    expect(noteOff.note?.octave).toBe(held!.octave);
    const bends = msgs.filter((m) => m.type === 'pitch_bend');
    expect(bends.length).toBeGreaterThan(0);
    expect(bends[bends.length - 1].bendValue).toBe(0);
    expect(server.slideState.activeSlideNote).toBeNull();
  });

  it('bend value sent to backend is clamped to [-1, 1]', () => {
    // Pen down between C (anchor) and E (+4 semis) with max_bend=2 forces clamp.
    server.handleSlide(1.5 / 6, 0.5);
    const bends = backend.getMessages().filter((m) => m.type === 'pitch_bend');
    expect(bends.length).toBeGreaterThan(0);
    for (const m of bends) {
      expect(m.bendValue!).toBeGreaterThanOrEqual(-1.0);
      expect(m.bendValue!).toBeLessThanOrEqual(1.0);
    }
  });

  it('emits a slide_on StrumEventData on the event bus', () => {
    server.handleSlide(1 / 6, 0.5);
    const slideOn = emitted.find((e) => e.type === 'slide_on');
    expect(slideOn).toBeDefined();
    expect(slideOn!.notes).toHaveLength(1);
    expect(slideOn!.notes[0].note.notation).toBe('C');
    expect(slideOn!.notes[0].note.octave).toBe(4);
    expect(slideOn!.velocity).toBeGreaterThan(0);
  });

  it('does not crash when backend is null', async () => {
    const { server: s } = await makeServer();
    s.backend = null;
    expect(() => {
      s.handleSlide(1 / 6, 0.5);
      s.handleSlide(1 / 6, 0.0);
    }).not.toThrow();
  });

  it('crossing string slots holds the original anchor note (no retrigger)', async () => {
    const { server: s, backend: b } = await makeServer([C4, E4, G4], 24.0);
    s.config.strummer.slide.pressureModulation.type = 'none';

    s.handleSlide(1 / 6, 0.6);
    expect(s.slideState.activeSlideNote?.notation).toBe('C');
    b.clearMessages();

    s.handleSlide(3 / 6, 0.6);
    s.handleSlide(5 / 6, 0.6);

    const msgs = b.getMessages();
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.type === 'pitch_bend')).toBe(true);
    expect(s.slideState.activeSlideNote?.notation).toBe('C');
  });

  it('continuous bend reaches the neighbor pitch at the neighbor center', async () => {
    const { server: s } = await makeServer([C4, E4, G4], 24.0);

    s.handleSlide(1 / 6, 0.5);
    s.handleSlide(3 / 6, 0.5);
    expect(s.slider.lastBendSemitones).toBe(4.0); // E - C

    s.handleSlide(5 / 6, 0.5);
    expect(s.slider.lastBendSemitones).toBe(7.0); // G - C
  });

  it('held bend is clamped to ±maxBendSemitones across wide intervals', async () => {
    const C5: NoteObject = { notation: 'C', octave: 5, secondary: false };
    const { server: s } = await makeServer([C4, C5], 2.0);

    s.handleSlide(0.1, 0.5);
    s.handleSlide(0.9, 0.5);
    expect(Math.abs(s.slider.lastBendSemitones)).toBeLessThanOrEqual(2.0 + 1e-9);
    expect(s.slider.lastBendSemitones).toBe(2.0);
  });
});

describe('StrummerWebSocketServer.handleSlide pressure modulation', () => {
  let server: FakeServer;
  let backend: MockMidiBackend;

  beforeEach(async () => {
    ({ server, backend } = await makeServer());
  });

  it('aftertouch (default) emitted on slide_on and slide_update', () => {
    server.handleSlide(1 / 6, 0.5);
    let at = backend.getMessages().filter((m) => m.type === 'aftertouch');
    expect(at).toHaveLength(1);
    // pressure=0.5, threshold=0.1 -> normalized ~0.444 -> value ~56
    expect(at[0].value!).toBeGreaterThanOrEqual(50);
    expect(at[0].value!).toBeLessThanOrEqual(60);

    backend.clearMessages();
    server.handleSlide(2 / 6, 0.9);
    at = backend.getMessages().filter((m) => m.type === 'aftertouch');
    expect(at).toHaveLength(1);
    // pressure=0.9 -> normalized ~0.889 -> value ~113
    expect(at[0].value!).toBeGreaterThanOrEqual(108);
    expect(at[0].value!).toBeLessThanOrEqual(117);
  });

  it("type='cc' routes pressure to the configured CC number", () => {
    server.config.strummer.slide.pressureModulation.type = 'cc';
    server.config.strummer.slide.pressureModulation.ccNumber = 11;

    server.handleSlide(1 / 6, 0.55);

    const msgs = backend.getMessages();
    const cc = msgs.filter((m) => m.type === 'cc');
    expect(cc).toHaveLength(1);
    expect(cc[0].ccNumber).toBe(11);
    expect(cc[0].value!).toBeGreaterThanOrEqual(0);
    expect(cc[0].value!).toBeLessThanOrEqual(127);
    expect(msgs.some((m) => m.type === 'aftertouch')).toBe(false);
  });

  it("type='none' suppresses aftertouch and cc messages", () => {
    server.config.strummer.slide.pressureModulation.type = 'none';

    server.handleSlide(1 / 6, 0.5);
    server.handleSlide(2 / 6, 0.8);

    const msgs = backend.getMessages();
    expect(msgs.some((m) => m.type === 'aftertouch')).toBe(false);
    expect(msgs.some((m) => m.type === 'cc')).toBe(false);
  });

  it('min/max range clamps the output value', () => {
    server.config.strummer.slide.pressureModulation.type = 'cc';
    server.config.strummer.slide.pressureModulation.ccNumber = 1;
    server.config.strummer.slide.pressureModulation.minValue = 40;
    server.config.strummer.slide.pressureModulation.maxValue = 80;

    server.handleSlide(1 / 6, 0.1);
    let cc = backend.getMessages().filter((m) => m.type === 'cc');
    expect(cc[0].value).toBe(40);

    backend.clearMessages();
    server.handleSlide(1.5 / 6, 1.0);
    cc = backend.getMessages().filter((m) => m.type === 'cc');
    expect(cc.length).toBeGreaterThan(0);
    expect(cc[cc.length - 1].value).toBe(80);
  });

  it('dedups consecutive identical modulation values', () => {
    server.handleSlide(1 / 6, 0.5);
    backend.clearMessages();
    server.handleSlide(1.1 / 6, 0.5);
    server.handleSlide(1.2 / 6, 0.5);
    const msgs = backend.getMessages();
    expect(msgs.filter((m) => m.type === 'aftertouch')).toHaveLength(0);
    expect(msgs.some((m) => m.type === 'pitch_bend')).toBe(true);
  });

  it('slide_off resets dedup so a later identical value re-emits', () => {
    server.handleSlide(1 / 6, 0.5);
    server.handleSlide(1 / 6, 0.0);
    expect(server.slideState.lastModulationValue).toBeNull();
    backend.clearMessages();

    server.handleSlide(1 / 6, 0.5);
    const at = backend.getMessages().filter((m) => m.type === 'aftertouch');
    expect(at).toHaveLength(1);
  });
});
