/**
 * Slider
 *
 * Trombone-style note controller. Holds a single note for the entire
 * pen-down stroke and continuously bends its pitch as the pen moves across
 * the tablet. The bend is computed by piecewise-linear interpolation between
 * the actual MIDI values of the strings in the layout, so the pen's sounding
 * pitch matches the string it is hovering over even when that spans
 * multiple octaves.
 *
 * Pitch bend is returned as a signed semitone offset from the anchor note
 * (`bendSemitones`), clamped to `±maxBendSemitones`. The consumer scales
 * that to a 14-bit MIDI pitch-bend value using the same `maxBendSemitones`
 * (which must also match the synth's configured bend range).
 *
 * Ported from Python sketchatone/strummer/slider.py
 */

import { EventEmitter } from '../utils/event-emitter.js';
import { StringLayout, type NotesState } from './string-layout.js';
import { Note, type NoteObject } from '../models/note.js';

export interface SlideOnEvent {
  type: 'slide_on';
  note: NoteObject;
  velocity: number;
  bendSemitones: number;
}

export interface SlideUpdateEvent {
  type: 'slide_update';
  note: NoteObject;
  bendSemitones: number;
  pressure: number;
}

export interface SlideOffEvent {
  type: 'slide_off';
}

export type SliderEvent =
  | SlideOnEvent
  | SlideUpdateEvent
  | SlideOffEvent;

/**
 * Minimal MIDI surface needed to route a SliderEvent. Matches the relevant
 * portion of WebMidiOutput / MidiBackendProtocol.
 */
export interface SliderMidiTarget {
  sendPitchBend(bendValue: number): void;
  sendNoteOn(note: NoteObject, velocity: number): void;
  releaseNotes(notes: NoteObject[]): void;
  sendAftertouch?(value: number): void;
  sendCc?(ccNumber: number, value: number): void;
}

/**
 * Mutable container for the currently-held slide note. The caller owns
 * the storage so it can react to mode switches / cleanup.
 *
 * `lastModulationValue` caches the last aftertouch/CC value emitted so
 * `routeSlideEventToMidi` can skip redundant messages. Reset to null on
 * slide_off / mode switch.
 */
export interface SlideRoutingState {
  activeSlideNote: NoteObject | null;
  lastModulationValue?: number | null;
}

/**
 * Configuration for routing held-note pressure to a continuous MIDI
 * controller while a slide note is held.
 */
export interface SlidePressureModulation {
  type: 'none' | 'aftertouch' | 'cc';
  ccNumber: number;
  minValue: number;
  maxValue: number;
  /** Same threshold the Slider uses for pen-down; used to normalize pressure. */
  pressureThreshold: number;
}

/**
 * Map a pen pressure (0-1) to a 7-bit MIDI value (0-127) for aftertouch
 * or CC. ``pressure == pressureThreshold`` -> minValue,
 * ``pressure == 1.0`` -> maxValue.
 */
export function pressureToModulationValue(
  pressure: number,
  pressureThreshold: number,
  minValue: number,
  maxValue: number,
): number {
  const denom = 1.0 - pressureThreshold;
  let normalized = denom <= 0 ? 1.0 : (pressure - pressureThreshold) / denom;
  normalized = Math.max(0.0, Math.min(1.0, normalized));
  return Math.max(0, Math.min(127, Math.round(minValue + normalized * (maxValue - minValue))));
}

function emitPressureModulation(
  midi: SliderMidiTarget,
  pressure: number,
  mod: SlidePressureModulation | undefined,
  state: SlideRoutingState,
): void {
  if (!mod || mod.type === 'none') return;
  const value = pressureToModulationValue(pressure, mod.pressureThreshold, mod.minValue, mod.maxValue);
  if (value === state.lastModulationValue) return;
  state.lastModulationValue = value;
  if (mod.type === 'aftertouch' && midi.sendAftertouch) {
    midi.sendAftertouch(value);
  } else if (mod.type === 'cc' && midi.sendCc) {
    midi.sendCc(mod.ccNumber, value);
  }
}

/**
 * Translate a SliderEvent into MIDI calls on `midi` and update
 * `state.activeSlideNote` accordingly.
 *
 *  - slide_on:     pitch bend first (so the note starts at the right pitch),
 *                  then note-on; remember the note as active.
 *  - slide_update: pitch bend only.
 *  - slide_off:    release the active note (if any), reset pitch bend to 0.
 *
 * When `modulation` is supplied and not 'none', slide_on / slide_update
 * additionally emit channel aftertouch or a CC mapped from the event
 * pressure.
 */
export function routeSlideEventToMidi(
  event: SliderEvent,
  midi: SliderMidiTarget,
  state: SlideRoutingState,
  maxBendSemitones: number,
  modulation?: SlidePressureModulation,
  fallbackPressure?: number,
): void {
  const maxBend = maxBendSemitones || 1.0;
  if (event.type === 'slide_on') {
    const bendValue = Math.max(-1, Math.min(1, event.bendSemitones / maxBend));
    midi.sendPitchBend(bendValue);
    midi.sendNoteOn(event.note, event.velocity);
    state.activeSlideNote = event.note;
    // slide_on doesn't carry pressure on the event itself; use fallback (the
    // raw sample pressure) if the caller provides it.
    if (fallbackPressure !== undefined) {
      emitPressureModulation(midi, fallbackPressure, modulation, state);
    }
  } else if (event.type === 'slide_update') {
    const bendValue = Math.max(-1, Math.min(1, event.bendSemitones / maxBend));
    midi.sendPitchBend(bendValue);
    emitPressureModulation(midi, event.pressure, modulation, state);
  } else if (event.type === 'slide_off') {
    if (state.activeSlideNote) {
      midi.releaseNotes([state.activeSlideNote]);
      state.activeSlideNote = null;
    }
    state.lastModulationValue = null;
    midi.sendPitchBend(0);
  }
}

// Minimum changes worth emitting a slide_update for (avoids flooding consumers).
const BEND_EPSILON = 0.001; // semitones
const PRESSURE_EPSILON = 0.005; // normalized pressure

/**
 * Trombone-style controller built on top of a StringLayout.
 *
 * A note is anchored on pen-down and held for the entire stroke. The pitch
 * is bent continuously across the whole tablet, interpolated piecewise-
 * linearly between the MIDI values of adjacent strings so the sounding
 * pitch matches the string under the pen.
 *
 * `maxBendSemitones` must match the synth's configured pitch-bend range;
 * it is used both as the clamp on the reported bend and as the scaling
 * factor when the consumer converts the offset to a 14-bit pitch-bend
 * value.
 *
 * Events emitted:
 *   - 'slide_on':      pen pressed down (data: SlideOnEvent)
 *   - 'slide_update':  bend/pressure changed while held (data: SlideUpdateEvent)
 *   - 'slide_off':     pen lifted (data: SlideOffEvent)
 *   - 'notes_changed': forwarded from the underlying StringLayout
 */
export class Slider extends EventEmitter {
  readonly layout = new StringLayout();

  pressureThreshold = 0.1;
  maxBendSemitones = 24.0;

  // State
  activeIndex = -1;
  lastPressure = 0.0;
  lastBendSemitones = 0.0;

  constructor() {
    super();
    this.layout.on('notes_changed', () => this.emit('notes_changed'));
  }

  get notes(): NoteObject[] {
    return this.layout.notes;
  }

  set notes(notes: NoteObject[]) {
    this.layout.notes = notes;
  }

  getNotesState(): NotesState {
    return this.layout.getNotesState();
  }

  updateBounds(width: number, height: number): void {
    this.layout.updateBounds(width, height);
  }

  /**
   * Configure slider parameters.
   */
  configure(pressureThreshold = 0.1, maxBendSemitones = 24.0): void {
    this.pressureThreshold = pressureThreshold;
    this.maxBendSemitones = maxBendSemitones;
  }

  /**
   * Reset transient state (does not clear notes or bounds).
   */
  clear(): void {
    this.activeIndex = -1;
    this.lastPressure = 0.0;
    this.lastBendSemitones = 0.0;
  }

  /**
   * Process slider input.
   *
   * @param x - X position on the tablet (0 to width)
   * @param pressure - Pen pressure (0 to 1)
   * @returns A slide_on / slide_update / slide_off event, or null if nothing
   *          meaningful changed.
   */
  slide(x: number, pressure: number): SliderEvent | null {
    const notes = this.layout.notes;
    if (notes.length === 0) {
      return null;
    }

    const hasPressure = pressure >= this.pressureThreshold;
    const wasPressed = this.lastPressure >= this.pressureThreshold;

    // Pen lifted
    if (wasPressed && !hasPressure) {
      this.lastPressure = pressure;
      if (this.activeIndex === -1) {
        return null;
      }
      this.activeIndex = -1;
      this.lastBendSemitones = 0.0;
      return { type: 'slide_off' };
    }

    // Pen pressed (first contact)
    if (!wasPressed && hasPressure) {
      const index = this.layout.indexAt(x);
      if (index < 0) {
        this.lastPressure = pressure;
        return null;
      }
      this.activeIndex = index;
      this.lastPressure = pressure;
      const velocity = this.pressureToVelocity(pressure);
      const bend = this.bendSemitonesFor(x);
      this.lastBendSemitones = bend;
      return {
        type: 'slide_on',
        note: notes[index],
        velocity,
        bendSemitones: bend,
      };
    }
    return this.processHeld(x, pressure, hasPressure, notes);
  }

  private processHeld(
    x: number,
    pressure: number,
    hasPressure: boolean,
    notes: NoteObject[]
  ): SliderEvent | null {
    if (hasPressure && this.activeIndex !== -1) {
      const bend = this.bendSemitonesFor(x);
      const pressureChanged = Math.abs(pressure - this.lastPressure) > PRESSURE_EPSILON;
      const bendChanged = Math.abs(bend - this.lastBendSemitones) > BEND_EPSILON;
      this.lastPressure = pressure;
      if (pressureChanged || bendChanged) {
        this.lastBendSemitones = bend;
        return {
          type: 'slide_update',
          note: notes[this.activeIndex],
          bendSemitones: bend,
          pressure,
        };
      }
      return null;
    }
    this.lastPressure = pressure;
    return null;
  }

  /**
   * Map pressure (threshold..1.0) to MIDI velocity (20..127).
   */
  private pressureToVelocity(pressure: number): number {
    const denom = 1.0 - this.pressureThreshold;
    if (denom <= 0) {
      return 127;
    }
    let normalized = (pressure - this.pressureThreshold) / denom;
    normalized = Math.max(0.0, Math.min(1.0, normalized));
    return Math.max(20, Math.min(127, Math.floor(20 + normalized * 107)));
  }

  /**
   * Compute the pitch-bend offset (in semitones) from the anchor note for
   * the given x position. Uses piecewise-linear interpolation between
   * adjacent string MIDI values so the sounding pitch matches the string
   * under the pen. Clamps to `±maxBendSemitones`.
   */
  private bendSemitonesFor(x: number): number {
    if (this.activeIndex === -1) {
      return 0.0;
    }
    const sw = this.layout.stringWidth;
    if (sw <= 0) {
      return 0.0;
    }
    const notes = this.layout.notes;
    const n = notes.length;

    // Fractional position in "string-center" units (string i has center i).
    const p = x / sw - 0.5;
    let midiAtX: number;
    if (p <= 0) {
      midiAtX = Note.noteToMidi(notes[0]);
    } else if (p >= n - 1) {
      midiAtX = Note.noteToMidi(notes[n - 1]);
    } else {
      const lo = Math.floor(p);
      const hi = lo + 1;
      const frac = p - lo;
      midiAtX = Note.noteToMidi(notes[lo]) + frac * (Note.noteToMidi(notes[hi]) - Note.noteToMidi(notes[lo]));
    }

    const bend = midiAtX - Note.noteToMidi(notes[this.activeIndex]);
    return Math.max(-this.maxBendSemitones, Math.min(this.maxBendSemitones, bend));
  }
}
