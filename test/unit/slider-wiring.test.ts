/**
 * Tests for slide-mode wiring: routeSlideEventToMidi.
 *
 * Verifies that Slider events are routed to the MIDI backend as the
 * correct sequence of note_on / pitch_bend / note_off messages and that
 * the active-slide-note state is tracked across events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Slider,
  routeSlideEventToMidi,
  pressureToModulationValue,
  type SliderEvent,
  type SlideRoutingState,
  type SlidePressureModulation,
} from '../../src/core/slider.js';
import { MockMidiBackend } from '../mocks/mock-midi-backend.js';
import { Note, type NoteObject } from '../../src/models/note.js';

const C4: NoteObject = { notation: 'C', octave: 4, secondary: false };
const E4: NoteObject = { notation: 'E', octave: 4, secondary: false };
const G4: NoteObject = { notation: 'G', octave: 4, secondary: false };

function makeSlider(maxBend = 2.0, pressureThreshold = 0.1): Slider {
  const slider = new Slider();
  slider.notes = [C4, E4, G4];
  slider.updateBounds(1.0, 1.0);
  slider.configure(pressureThreshold, maxBend);
  return slider;
}

describe('routeSlideEventToMidi', () => {
  let backend: MockMidiBackend;
  let state: SlideRoutingState;

  beforeEach(async () => {
    backend = new MockMidiBackend({ channel: 0 });
    await backend.connect();
    backend.clearMessages();
    state = { activeSlideNote: null };
  });

  it('slide_on sends pitch bend then note on and tracks active note', () => {
    const event: SliderEvent = {
      type: 'slide_on',
      note: C4,
      velocity: 100,
      bendSemitones: 0,
    };
    routeSlideEventToMidi(event, backend, state, 2.0);

    const msgs = backend.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('pitch_bend');
    expect(msgs[1].type).toBe('note_on');
    expect(Note.noteToMidi(msgs[1].note!)).toBe(60);
    expect(msgs[1].velocity).toBe(100);
    expect(state.activeSlideNote).toEqual(C4);
  });

  it('slide_update sends only a pitch bend message', () => {
    state.activeSlideNote = C4;
    const event: SliderEvent = {
      type: 'slide_update',
      note: C4,
      bendSemitones: 1.0,
      pressure: 0.5,
    };
    routeSlideEventToMidi(event, backend, state, 2.0);

    const msgs = backend.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('pitch_bend');
    expect(msgs[0].bendValue).toBeCloseTo(0.5, 5);
    expect(state.activeSlideNote).toEqual(C4);
  });

  it('slide_off releases the held note and resets bend to 0', () => {
    state.activeSlideNote = C4;
    routeSlideEventToMidi({ type: 'slide_off' }, backend, state, 2.0);

    const msgs = backend.getMessages();
    const types = msgs.map((m) => m.type);
    expect(types).toContain('note_off');
    const noteOff = msgs.find((m) => m.type === 'note_off')!;
    expect(Note.noteToMidi(noteOff.note!)).toBe(60);
    const bend = msgs.find((m) => m.type === 'pitch_bend')!;
    expect(bend.bendValue).toBe(0);
    expect(state.activeSlideNote).toBeNull();
  });

  it('slide_off with no active note still resets bend', () => {
    routeSlideEventToMidi({ type: 'slide_off' }, backend, state, 2.0);
    const msgs = backend.getMessages();
    expect(msgs.every((m) => m.type !== 'note_off')).toBe(true);
    expect(msgs[msgs.length - 1].type).toBe('pitch_bend');
    expect(msgs[msgs.length - 1].bendValue).toBe(0);
  });

  it('clamps bend value to [-1, 1] regardless of input semitones', () => {
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 99, pressure: 0.5 },
      backend, state, 2.0
    );
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: -99, pressure: 0.5 },
      backend, state, 2.0
    );
    const msgs = backend.getMessages();
    expect(msgs[0].bendValue).toBe(1);
    expect(msgs[1].bendValue).toBe(-1);
  });
});

describe('Slider + routeSlideEventToMidi end-to-end', () => {
  let backend: MockMidiBackend;
  let state: SlideRoutingState;
  let slider: Slider;

  beforeEach(async () => {
    backend = new MockMidiBackend({ channel: 0 });
    await backend.connect();
    backend.clearMessages();
    state = { activeSlideNote: null };
    slider = makeSlider();
  });

  function drive(x: number, pressure: number): void {
    const event = slider.slide(x, pressure);
    if (event) routeSlideEventToMidi(event, backend, state, slider.maxBendSemitones);
  }

  it('pen-down then pen-up produces note_on … note_off', () => {
    drive(1 / 6, 0.5);   // pen down on C
    drive(1 / 6, 0.0);   // pen up

    const types = backend.getMessages().map((m) => m.type);
    expect(types[0]).toBe('pitch_bend');
    expect(types[1]).toBe('note_on');
    expect(types).toContain('note_off');
    expect(state.activeSlideNote).toBeNull();
  });

  it('moving within the same string slot emits pitch_bend only', () => {
    drive(1 / 6, 0.5);    // pen down on C (slot [0, 1/3))
    backend.clearMessages();
    drive(1.25 / 6, 0.5); // small move inside C
    drive(1.5 / 6, 0.5);  // a little further, still inside C

    const msgs = backend.getMessages();
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.type === 'pitch_bend')).toBe(true);
    expect(state.activeSlideNote).toEqual(C4);
  });

  it('sliding across string slots holds the anchor note (no retrigger)', () => {
    // Use a wide bend range so the slider doesn't saturate before we check.
    slider = makeSlider(24.0);
    drive(1 / 6, 0.6);   // pen down on C
    backend.clearMessages();
    drive(3 / 6, 0.6);   // through E's slot
    drive(5 / 6, 0.6);   // into G's slot

    const types = backend.getMessages().map((m) => m.type);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === 'pitch_bend')).toBe(true);
    expect(state.activeSlideNote).toEqual(C4);
  });

  it('continuous bend reaches the neighbor pitch at the neighbor center', () => {
    slider = makeSlider(24.0);
    slider.slide(1 / 6, 0.5);                   // pen down on C
    const atE = slider.slide(3 / 6, 0.5);       // E center
    expect(atE?.type).toBe('slide_update');
    if (atE?.type === 'slide_update') {
      expect(atE.bendSemitones).toBe(4); // E - C
    }
    const atG = slider.slide(5 / 6, 0.5);       // G center
    expect(atG?.type).toBe('slide_update');
    if (atG?.type === 'slide_update') {
      expect(atG.bendSemitones).toBe(7); // G - C
    }
  });

  it('held bend is clamped to ±maxBendSemitones', () => {
    // Two strings an octave apart; small max-bend forces the clamp.
    const wide = new Slider();
    wide.notes = [C4, { notation: 'C', octave: 5, secondary: false }];
    wide.updateBounds(1.0, 1.0);
    wide.configure(0.1, 2.0);

    wide.slide(0.1, 0.5);                  // pen down on C4
    const ev = wide.slide(0.9, 0.5);       // near the other string
    expect(ev?.type).toBe('slide_update');
    if (ev?.type === 'slide_update') {
      expect(Math.abs(ev.bendSemitones)).toBeLessThanOrEqual(2.0 + 1e-9);
      expect(ev.bendSemitones).toBe(2.0);
    }
  });
});

describe('routeSlideEventToMidi pressure modulation', () => {
  let backend: MockMidiBackend;
  let state: SlideRoutingState;
  const aftertouchMod: SlidePressureModulation = {
    type: 'aftertouch',
    ccNumber: 11,
    minValue: 0,
    maxValue: 127,
    pressureThreshold: 0.1,
  };

  beforeEach(async () => {
    backend = new MockMidiBackend({ channel: 0 });
    await backend.connect();
    backend.clearMessages();
    state = { activeSlideNote: null };
  });

  it('slide_on with aftertouch mod emits pitch_bend, note_on, aftertouch', () => {
    const event: SliderEvent = {
      type: 'slide_on', note: C4, velocity: 100, bendSemitones: 0,
    };
    routeSlideEventToMidi(event, backend, state, 2.0, aftertouchMod, 0.5);

    const types = backend.getMessages().map((m) => m.type);
    expect(types).toEqual(['pitch_bend', 'note_on', 'aftertouch']);
    const at = backend.getMessages().find((m) => m.type === 'aftertouch')!;
    expect(at.value).toBeGreaterThan(0);
    expect(at.value).toBeLessThanOrEqual(127);
  });

  it('slide_update emits pitch_bend then aftertouch with default mod', () => {
    state.activeSlideNote = C4;
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0.5, pressure: 0.9 },
      backend, state, 2.0, aftertouchMod
    );
    const types = backend.getMessages().map((m) => m.type);
    expect(types).toEqual(['pitch_bend', 'aftertouch']);
    const at = backend.getMessages().find((m) => m.type === 'aftertouch')!;
    // pressure 0.9 -> normalized ~0.889 -> ~113
    expect(at.value).toBeGreaterThanOrEqual(108);
    expect(at.value).toBeLessThanOrEqual(117);
  });

  it('cc mod routes to sendCc with the configured CC number', () => {
    state.activeSlideNote = C4;
    const ccMod: SlidePressureModulation = { ...aftertouchMod, type: 'cc', ccNumber: 11 };
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0, pressure: 0.5 },
      backend, state, 2.0, ccMod
    );
    const ccMsgs = backend.getMessages().filter((m) => m.type === 'cc');
    expect(ccMsgs).toHaveLength(1);
    expect(ccMsgs[0].ccNumber).toBe(11);
    expect(backend.getMessages().some((m) => m.type === 'aftertouch')).toBe(false);
  });

  it('type=none suppresses modulation messages', () => {
    state.activeSlideNote = C4;
    const noneMod: SlidePressureModulation = { ...aftertouchMod, type: 'none' };
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0, pressure: 0.7 },
      backend, state, 2.0, noneMod
    );
    const msgs = backend.getMessages();
    expect(msgs.every((m) => m.type === 'pitch_bend')).toBe(true);
  });

  it('min/max range clamps the output value', () => {
    state.activeSlideNote = C4;
    const ccMod: SlidePressureModulation = {
      type: 'cc', ccNumber: 1, minValue: 40, maxValue: 80, pressureThreshold: 0.1,
    };
    // At threshold pressure -> min_value
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0, pressure: 0.1 },
      backend, state, 2.0, ccMod
    );
    // At full pressure -> max_value
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0, pressure: 1.0 },
      backend, state, 2.0, ccMod
    );
    const ccMsgs = backend.getMessages().filter((m) => m.type === 'cc');
    expect(ccMsgs[0].value).toBe(40);
    expect(ccMsgs[1].value).toBe(80);
  });

  it('dedups consecutive identical modulation values', () => {
    state.activeSlideNote = C4;
    // Same pressure twice -> only one aftertouch should be emitted
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0, pressure: 0.5 },
      backend, state, 2.0, aftertouchMod
    );
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0.1, pressure: 0.5 },
      backend, state, 2.0, aftertouchMod
    );
    const atMsgs = backend.getMessages().filter((m) => m.type === 'aftertouch');
    expect(atMsgs).toHaveLength(1);
    // Pitch bends still emitted on every update
    expect(backend.getMessages().filter((m) => m.type === 'pitch_bend')).toHaveLength(2);
  });

  it('slide_off resets dedup so a later identical value re-emits', () => {
    state.activeSlideNote = C4;
    routeSlideEventToMidi(
      { type: 'slide_update', note: C4, bendSemitones: 0, pressure: 0.5 },
      backend, state, 2.0, aftertouchMod
    );
    routeSlideEventToMidi({ type: 'slide_off' }, backend, state, 2.0, aftertouchMod);
    expect(state.lastModulationValue).toBeNull();
    backend.clearMessages();
    // After slide_off, a slide_on with the same mapped pressure should emit again
    routeSlideEventToMidi(
      { type: 'slide_on', note: C4, velocity: 100, bendSemitones: 0 },
      backend, state, 2.0, aftertouchMod, 0.5
    );
    expect(backend.getMessages().filter((m) => m.type === 'aftertouch')).toHaveLength(1);
  });
});

describe('pressureToModulationValue', () => {
  it('maps pressure==threshold to min and pressure==1.0 to max', () => {
    expect(pressureToModulationValue(0.1, 0.1, 0, 127)).toBe(0);
    expect(pressureToModulationValue(1.0, 0.1, 0, 127)).toBe(127);
  });

  it('clamps values below threshold to min', () => {
    expect(pressureToModulationValue(0.0, 0.1, 30, 90)).toBe(30);
  });

  it('handles inverted ranges (min > max)', () => {
    expect(pressureToModulationValue(0.1, 0.1, 127, 0)).toBe(127);
    expect(pressureToModulationValue(1.0, 0.1, 127, 0)).toBe(0);
  });
});
