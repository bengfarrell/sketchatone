import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Note } from '../../models/note.js';

// Roman numeral degree to semitone offset from tonic
const DEGREE_TO_SEMITONES: Record<string, number> = {
  'I': 0, 'i': 0,
  'bII': 1, 'bii': 1,
  'II': 2, 'ii': 2,
  'bIII': 3, 'biii': 3,
  'III': 4, 'iii': 4,
  'IV': 5, 'iv': 5,
  'bV': 6, 'bv': 6,
  'V': 7, 'v': 7,
  'V/V': 2,
  'bVI': 8, 'bvi': 8,
  'VI': 9, 'vi': 9,
  'bVII': 10, 'bvii': 10,
  'VII': 11, 'vii': 11,
};

// Numpad key for each visual grid position (reading order top-left → bottom-right).
// Tells the user which numpad key to bind to each slot so the layout aligns with
// the standard keypad (7/8/9 top, 4/5/6 middle, 1/2/3 bottom).
const NUMPAD_KEYS = [7, 8, 9, 4, 5, 6, 1, 2, 3];

function computeChordName(degree: string, quality: string, root: string): string {
  const semitones = DEGREE_TO_SEMITONES[degree];
  if (semitones === undefined) return '?';
  const rootIndex = Note.indexOfNotation(root);
  if (rootIndex === -1) return '?';
  const chordRootIndex = (rootIndex + semitones) % 12;
  const chordRoot = Note.notationAtIndex(chordRootIndex, root.includes('b'));
  return chordRoot + quality;
}

@customElement('chord-mode-performance')
export class ChordModePerformance extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .header {
      font-family: var(--sketch-font-sans);
      font-size: var(--sketch-font-size-sm);
      color: var(--sketch-color-gray-500);
      padding: 10px 12px 8px;
      text-transform: capitalize;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      border-top: 1px solid var(--sketch-color-gray-400);
    }

    .cell {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 14px 4px;
      background: var(--sketch-color-gray-100);
      border-right: 1px solid var(--sketch-color-gray-400);
      border-bottom: 1px solid var(--sketch-color-gray-400);
      min-height: 70px;
      transition: background 100ms ease;
    }

    .cell-key {
      position: absolute;
      top: 5px;
      right: 7px;
      font-size: 11px;
      font-family: var(--sketch-font-mono, monospace);
      color: var(--sketch-color-gray-500);
      line-height: 1;
    }

    .cell.active .cell-key {
      color: var(--sketch-color-accent-500);
    }

    .cell:nth-child(3n) {
      border-right: none;
    }

    .cell:nth-last-child(-n+3) {
      border-bottom: none;
    }

    .cell.active {
      background: var(--sketch-color-accent-100, #e8f0fe);
    }

    .cell-degree {
      font-size: var(--sketch-font-size-lg);
      font-weight: 700;
      color: var(--sketch-color-gray-900);
      font-family: var(--sketch-font-mono, monospace);
      margin-bottom: 4px;
      line-height: 1;
    }

    .cell.active .cell-degree {
      color: var(--sketch-color-accent-700, #3352b0);
    }

    .cell-chord {
      font-size: var(--sketch-font-size-sm);
      font-weight: 400;
      color: var(--sketch-color-gray-600);
      font-family: var(--sketch-font-sans);
      line-height: 1;
    }

    .cell.active .cell-chord {
      color: var(--sketch-color-accent-600, #4265d6);
    }

    .empty {
      color: var(--sketch-color-gray-400);
      font-size: var(--sketch-font-size-sm);
      font-family: var(--sketch-font-sans);
      text-align: center;
      padding: 24px 12px;
    }
  `;

  @property({ type: Object })
  chordModes: Record<string, Array<{ degree: string; quality: string }>> = {};

  @property({ type: String })
  modeName: string = '';

  @property({ type: String })
  root: string = 'C';

  @property({ type: Number })
  octave: number = 4;

  @property({ type: Number })
  activeIndex: number | null = null;

  render() {
    const entries = this.modeName ? this.chordModes[this.modeName] : undefined;

    if (!entries) {
      return html`<div class="empty">No chord mode configured</div>`;
    }

    return html`
      <div class="header">${this.root} — ${this.modeName}</div>
      <div class="grid">
        ${entries.map((entry, idx) => {
          const numpadKey = NUMPAD_KEYS[idx];
          if (!entry) return html`<div class="cell"><span class="cell-key">${numpadKey}</span></div>`;
          const chord = computeChordName(entry.degree, entry.quality, this.root);
          const degreeLabel = entry.degree + (entry.quality || '');
          return html`
            <div class="cell ${idx === this.activeIndex ? 'active' : ''}">
              <span class="cell-key">${numpadKey}</span>
              <span class="cell-degree">${degreeLabel}</span>
              <span class="cell-chord">${chord}</span>
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chord-mode-performance': ChordModePerformance;
  }
}
