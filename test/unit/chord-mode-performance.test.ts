import { describe, expect, it } from 'vitest';
import '../../src/components/chord-mode-performance/chord-mode-performance.js';

describe('ChordModePerformance', () => {
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
    expect(element.shadowRoot?.querySelector('.cell-chord')?.textContent).toBe('E');
    element.remove();
  });

  it('rejects entries that do not use the explicit schema', async () => {
    const element = document.createElement('chord-mode-performance');
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
