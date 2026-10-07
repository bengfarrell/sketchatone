import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Note } from '../../models/note.js';
import {
  chordModePrefersFlat,
  chordModeSemitones,
  resolveChordModeEntry,
  type ChordModeMap,
} from '../../models/chord-mode.js';

function buttonLabel(buttonId: string | undefined): string {
  if (!buttonId) return '';
  const colonIdx = buttonId.indexOf(':');
  return colonIdx >= 0 ? buttonId.slice(colonIdx + 1) : buttonId;
}

function computeChordName(entry: unknown, root: string): string {
  const resolved = resolveChordModeEntry(entry);
  if (!resolved) return '?';
  const rootIndex = Note.indexOfNotation(root);
  if (rootIndex === -1) return '?';
  const chordRootIndex = rootIndex + chordModeSemitones(resolved);
  const chordRoot = Note.notationAtIndex(chordRootIndex, chordModePrefersFlat(resolved, root));
  return chordRoot + resolved.chordSuffix;
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
      /* Slow fade-out when active class is removed */
      transition: background 750ms ease, color 750ms ease;
    }

    .cell-key {
      position: absolute;
      top: 5px;
      right: 7px;
      font-size: 11px;
      font-family: var(--sketch-font-mono, monospace);
      color: var(--sketch-color-gray-500);
      line-height: 1;
      transition: color 750ms ease;
    }

    .cell.active .cell-key {
      color: white;
      /* Quick transition in when active class is added */
      transition: color 50ms ease;
    }

    .cell:nth-child(3n) {
      border-right: none;
    }

    .cell:nth-last-child(-n+3) {
      border-bottom: none;
    }

    .cell.active {
      background: var(--sketch-color-accent-500, #4265d6);
      /* Quick transition in when active class is added */
      transition: background 50ms ease, color 50ms ease;
    }

    .cell-degree {
      font-size: var(--sketch-font-size-lg);
      font-weight: 700;
      color: var(--sketch-color-gray-900);
      font-family: var(--sketch-font-mono, monospace);
      margin-bottom: 4px;
      line-height: 1;
      transition: color 750ms ease;
    }

    .cell.active .cell-degree {
      color: white;
      transition: color 50ms ease;
    }

    .cell-chord {
      font-size: var(--sketch-font-size-sm);
      font-weight: 400;
      color: var(--sketch-color-gray-600);
      font-family: var(--sketch-font-sans);
      line-height: 1;
      transition: color 750ms ease;
    }

    .cell.active .cell-chord {
      color: rgba(255, 255, 255, 0.85);
      transition: color 50ms ease;
    }

    .mode-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 12px 8px;
      border-bottom: 1px solid var(--sketch-color-gray-400);
    }

    .mode-pill {
      font-size: 10px;
      font-family: var(--sketch-font-sans);
      padding: 2px 7px;
      border-radius: 99px;
      border: 1px solid var(--sketch-color-gray-400);
      color: var(--sketch-color-gray-500);
      background: transparent;
      text-transform: capitalize;
      line-height: 1.4;
    }

    .mode-pill.current {
      border-color: var(--sketch-color-accent-500, #4265d6);
      color: var(--sketch-color-accent-500, #4265d6);
      background: color-mix(in srgb, var(--sketch-color-accent-500, #4265d6) 12%, transparent);
      font-weight: 600;
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
  chordModes: ChordModeMap = {};

  @property({ type: String })
  modeName: string = '';

  @property({ type: String })
  root: string = 'C';

  @property({ type: Number })
  octave: number = 4;

  @property({ type: Array })
  buttons: string[] = [];

  @property({ type: Array })
  allModeNames: string[] = [];

  @property({ type: Number })
  activeIndex: number | null = null;

  render() {
    const entries = this.modeName ? this.chordModes[this.modeName] : undefined;

    if (!entries) {
      return html`<div class="empty">No chord mode configured</div>`;
    }

    const modeStrip = this.allModeNames.length > 1
      ? html`
        <div class="mode-strip">
          ${this.allModeNames.map((m) => html`
            <span class="mode-pill ${m === this.modeName ? 'current' : ''}">${m}</span>
          `)}
        </div>`
      : '';

    return html`
      <div class="header">${this.root} — ${this.modeName}</div>
      ${modeStrip}
      <div class="grid">
        ${entries.map((entry, idx) => {
          const label = buttonLabel(this.buttons[idx]);
          if (!entry) return html`<div class="cell"><span class="cell-key">${label}</span></div>`;
          const resolved = resolveChordModeEntry(entry);
          const chord = computeChordName(entry, this.root);
          const degreeLabel = resolved?.display ?? '?';
          return html`
            <div class="cell ${idx === this.activeIndex ? 'active' : ''}">
              <span class="cell-key">${label}</span>
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
