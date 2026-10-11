import { resolveChordModeEntry } from '../models/chord-mode.js';

/** Structural checks shared by the web editor and Node server. The template is
 * supplied by the server so backend-specific supported fields stay visible. */
export function configValidationTemplate(defaults: Record<string, any>): Record<string, any> {
  const template = JSON.parse(JSON.stringify(defaults));
  template.keyboard ??= { enabled: true };
  template.strummer.pitch ??= { startingOffset: 0, startingOctave: 4 };
  template.strummer.harmonicContext ??= { startingRoot: 'C', startingMode: 'major' };
  template.strummer.strumming.chord = '';
  template.strummer.chordProgressions = { '*': [''] };
  template.strummer.chordModes = { '*': [{ degree: 1, alteration: 0, quality: 'major', extension: 'none', display: '', spelling: 'auto' }] };
  template.strummer.actionRules = {
    rules: [{ id: '', name: '', button: '', action: '', trigger: 'press' }],
    groups: [{ id: '', name: '', buttons: [''] }],
    groupRules: [{ id: '', name: '', groupId: '', action: { type: '', progression: '', octave: 4 }, trigger: 'press' }],
    startupRules: [{ id: '', name: '', action: '' }],
  };
  template.deviceButtons = { buttons: [{ code: 0, name: '' }], keys: [{ key: '', name: '' }] };
  template.midi.midiPassthrough = [{ inputPort: null, outputPort: null }];
  return template;
}

const enums: Record<string, string[]> = {
  mode: ['strum', 'slide'],
  inputMode: ['direct', 'majorScale', 'minorScale', 'autoScale'],
  midiOutputBackend: ['rtmidi', 'jack'],
  trigger: ['press', 'release', 'hold'],
  spread: ['direct', 'inverse', 'central', 'none'],
  control: ['none', 'pressure', 'tiltX', 'tiltY', 'tiltXY', 'xaxis', 'yaxis', 'velocity'],
  quality: ['major', 'minor', 'diminished', 'half-diminished', 'augmented', 'sus2', 'sus4', 'power'],
  extension: ['none', '6', '7', 'maj7', '9', 'maj9', 'add9', 'm7b5'],
  spelling: ['auto', 'flat', 'sharp'],
};
const nullable = new Set(['chord', 'device', 'httpPort', 'httpsPort', 'wsPort', 'wssPort', 'deviceFindingPollInterval', 'midiChannel', 'jackAutoConnect']);
const ports = new Set(['outputPort', 'inputPort', 'midiOutputId', 'midiInputId']);
const aliases: Record<string, string> = { midiOutputId: 'outputPort', midiInputId: 'inputPort', midiInputExclude: 'inputExclude', midiOutputExclude: 'outputExclude', outputPort: 'midiOutputId', inputPort: 'midiInputId', inputExclude: 'midiInputExclude', outputExclude: 'midiOutputExclude' };
const camel = (key: string): string => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function validateCompleteConfig(value: unknown, template: Record<string, any>): string[] {
  const errors: string[] = [];
  const fail = (path: string, message: string): void => { errors.push(`${path}: ${message}`); };
  const walk = (data: any, sample: any, path: string, key = ''): void => {
    if (data === undefined) return;
    if (data === null && nullable.has(key)) return;
    if (ports.has(key) || (sample === null && ['inputPort', 'outputPort'].includes(key))) {
      const port = (v: any) => v === null || typeof v === 'string' || (Number.isInteger(v) && v >= 0);
      if (!(port(data) || (['inputPort', 'midiInputId'].includes(key) && Array.isArray(data) && data.every(v => Number.isInteger(v) && v >= 0)))) fail(path, 'expected port name, nonnegative index, null, or input index list');
      return;
    }
    if (key === 'action' && typeof sample === 'string') {
      if (!(typeof data === 'string' || (Array.isArray(data) && typeof data[0] === 'string'))) fail(path, 'expected action name or [name, parameters…]');
      return;
    }
    if (sample === null) {
      const type = key === 'device' ? 'string' : 'number';
      if (typeof data !== type) fail(path, `expected ${type} or null`);
    } else if (Array.isArray(sample)) {
      if (!Array.isArray(data)) return fail(path, 'expected array');
      data.forEach((entry, i) => walk(entry, sample[0] ?? '', `${path}[${i}]`));
    } else if (typeof sample === 'object') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(path, 'expected object');
      if (/chordModes\.[^.]+\[\d+\]$/.test(path) && !resolveChordModeEntry(data)) fail(path, 'invalid chord-mode entry or quality/extension combination');
      const required = /deviceButtons\.buttons\[\d+\]$/.test(path) ? ['code', 'name']
        : /deviceButtons\.keys\[\d+\]$/.test(path) ? ['key', 'name']
        : /actionRules\.rules\[\d+\]$/.test(path) ? ['id', 'button', 'action']
        : /actionRules\.groups\[\d+\]$/.test(path) ? ['id', 'name', 'buttons']
        : /actionRules\.groupRules\[\d+\]$/.test(path) ? ['id', 'groupId', 'action']
        : /actionRules\.startupRules\[\d+\]$/.test(path) ? ['id', 'action']
        : /midiPassthrough\[\d+\]$/.test(path) ? ['inputPort', 'outputPort']
        : /groupRules\[\d+\]\.action$/.test(path) ? ['type'] : [];
      required.forEach(field => {
        if (!(field in data) && !(field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`) in data)) fail(`${path}.${field}`, 'required field');
      });
      const seen = new Set<string>();
      Object.entries(data).forEach(([raw, entry]) => {
        let field = camel(raw);
        if (!(field in sample) && aliases[field]) field = aliases[field];
        if (['__proto__', 'constructor', 'prototype'].includes(field)) return fail(`${path}.${raw}`, 'unsupported field');
        if (seen.has(field)) fail(`${path}.${raw}`, 'duplicate alias');
        seen.add(field);
        if (!(field in sample) && !('*' in sample)) return fail(`${path}.${raw}`, 'unsupported field');
        walk(entry, field in sample ? sample[field] : sample['*'], `${path}.${field}`, '*' in sample ? '' : field);
      });
      if (typeof data.min === 'number' && typeof data.max === 'number' && data.min > data.max) fail(path, 'min must not exceed max');
    } else if (typeof data !== typeof sample || (typeof data === 'number' && !Number.isFinite(data))) {
      return fail(path, `expected ${typeof sample}`);
    }
    if (enums[key] && !enums[key].includes(data)) fail(path, `expected ${enums[key].join(', ')}`);
    if (key === 'type' && path.includes('groupRules') && !['chord-progression', 'chord-mode'].includes(data)) fail(path, 'expected chord-progression or chord-mode');
    if (key === 'type' && path.includes('pressureModulation') && !['none', 'aftertouch', 'cc'].includes(data)) fail(path, 'expected none, aftertouch or cc');
    if (key === 'startingRoot' && (typeof data !== 'string' || !/^[A-G](#|b)?$/.test(data))) fail(path, 'expected root note such as C or Bb');
    if (typeof data === 'string' && /initialNotes\[\d+\]$/.test(path) && !/^[A-Ga-g](?:#|b)?-?\d+$/.test(data)) fail(path, 'expected note with octave such as C4');
    if (typeof data === 'number') {
      if (key === 'midiChannel' && (!Number.isInteger(data) || data < 1 || data > 16)) fail(path, 'expected MIDI channel 1–16 or null');
      if (key === 'channel' && (!Number.isInteger(data) || data < 0 || data > 15)) fail(path, 'expected MIDI channel 0–15');
      if (['midiNote', 'ccNumber', 'minValue', 'maxValue'].includes(key) && (!Number.isInteger(data) || data < 0 || data > 127)) fail(path, 'expected integer 0–127');
      if (key === 'curve' && data <= 0) fail(path, 'must be positive');
      if (key === 'randomization' && (data < 0 || data > 1)) fail(path, 'expected 0–1');
      if (['upperNoteSpread', 'lowerNoteSpread', 'startingOffset', 'startingOctave', 'octave', 'code'].includes(key) && !Number.isInteger(data)) fail(path, 'expected integer');
      if (['httpPort', 'httpsPort', 'wsPort', 'wssPort'].includes(key) && (!Number.isInteger(data) || data < 1 || data > 65535)) fail(path, 'expected port 1–65535');
      if (key === 'pressureThreshold' && (data < 0 || data > 1)) fail(path, 'expected 0–1');
      if (key === 'pressureBufferSize' && (!Number.isInteger(data) || data < 1)) fail(path, 'expected positive integer');
      if (['wsMessageThrottle', 'deviceFindingPollInterval', 'maxDuration', 'defaultNoteDuration', 'midiInterMessageDelay', 'upperNoteSpread', 'lowerNoteSpread'].includes(key) && data < 0) fail(path, 'must be nonnegative');
      if (key === 'degree' && (!Number.isInteger(data) || data < 1 || data > 7)) fail(path, 'expected degree 1–7');
      if (key === 'alteration' && (!Number.isInteger(data) || Math.abs(data) > 2)) fail(path, 'expected integer −2–2');
    }
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['$: expected configuration object'];
  for (const section of ['strummer', 'midi', 'server']) {
    if (!(section in value)) fail(section, 'required section');
  }
  walk(value, template, '$');
  return errors;
}

/** Key-order-independent identity for optimistic concurrency checks. */
export function configFingerprint(value: any): string {
  if (Array.isArray(value)) return `[${value.map(configFingerprint).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${configFingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function normalizeCompleteConfig(value: any, template: any): any {
  if (Array.isArray(value)) return value.map(entry => normalizeCompleteConfig(entry, template?.[0]));
  if (!value || typeof value !== 'object' || !template || typeof template !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([raw, entry]) => {
    if ('*' in template) return [raw, normalizeCompleteConfig(entry, template['*'])];
    let field = camel(raw);
    if (!(field in template) && aliases[field]) field = aliases[field];
    return [field, normalizeCompleteConfig(entry, template[field])];
  }));
}
