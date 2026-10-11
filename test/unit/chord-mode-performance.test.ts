import { describe, expect, it } from 'vitest';
import '../../src/components/chord-mode-performance/chord-mode-performance.js';

describe('ChordModePerformance', () => {
  it('renders the half-diminished jazz chord', async () => {
    const element = document.createElement('chord-mode-performance');
    element.chordModes = {
      jazz: [{
        degree: 7, alteration: 0, quality: 'half-diminished',
        extension: 'm7b5', display: 'viiø7',
      }],
    };
    element.modeName = 'jazz';
    element.root = 'C';
    document.body.appendChild(element);
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector('.cell-degree')?.textContent).toBe('viiø7');
    expect(element.shadowRoot?.querySelector('.cell-chord')?.textContent).toBe('Bm7b5 (oct 4)');
    element.remove();
  });

  it('renders the configured display label and chord for a numeric entry', async () => {
    const element = document.createElement('chord-mode-performance');
    element.chordModes = {
      major: [{
        degree: 3,
        alteration: 0,
        quality: 'major',
        extension: 'none',
        display: 'V/vi',
      }],
    };
    element.modeName = 'major';
    element.root = 'C';
    document.body.appendChild(element);

    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('.cell-degree')?.textContent).toBe('V/vi');
    expect(element.shadowRoot?.querySelector('.cell-chord')?.textContent).toBe('E (oct 4)');
    expect(element.shadowRoot?.querySelector('.header')?.textContent).toBe('C (oct 4) — major');
    element.remove();
  });

  it.each([
    [12, 'C (oct 6)', 'B7 (oct 6)'],
    [-12, 'C (oct 4)', 'B7 (oct 4)'],
    [-1, 'B (oct 4)', 'A#7 (oct 5)'],
    [-25, 'B (oct 2)', 'A#7 (oct 3)'],
    [1, 'C# (oct 5)', 'C7 (oct 6)'],
  ])('updates root and chord octaves for a %i-semitone transpose', async (offset, root, chord) => {
    const element = document.createElement('chord-mode-performance');
    element.chordModes = {
      major: [{ degree: 7, alteration: 0, quality: 'major', extension: '7', display: 'VII7' }],
    };
    element.modeName = 'major';
    document.body.appendChild(element);
    await element.updateComplete;

    element.octave = 5;
    element.pitchOffset = offset;
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('.header')?.textContent).toBe(`${root} — major`);
    expect(element.shadowRoot?.querySelector('.cell-chord')?.textContent).toBe(chord);
    element.remove();
  });

  it('rejects entries that do not use the explicit schema', async () => {
    const element = document.createElement('chord-mode-performance');
    // @ts-expect-error Exercise rejection of a legacy entry at runtime.
    element.chordModes = { major: [{ degree: 'V/vi', quality: '' }] };
    element.modeName = 'major';
    element.root = 'C';
    document.body.appendChild(element);

    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('.cell-degree')?.textContent).toBe('?');
    expect(element.shadowRoot?.querySelector('.cell-chord')?.textContent).toBe('?');
    element.remove();
  });
});
