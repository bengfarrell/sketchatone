/**
 * Chord Progression Creator Component
 * 
 * Visual chord selector for creating chord progressions
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/field-label/sp-field-label.js';
import '@spectrum-web-components/divider/sp-divider.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-delete.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-close.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-add.js';

// Root notes
const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Accidentals
const ACCIDENTALS = [
  { label: '♮', value: '' },      // Natural
  { label: '♯', value: '#' },     // Sharp
  { label: '♭', value: 'b' },     // Flat
];

// Chord qualities
const QUALITIES = [
  { label: 'Major', value: '' },
  { label: 'Minor', value: 'm' },
  { label: 'Dim', value: 'dim' },
  { label: 'Aug', value: 'aug' },
  { label: 'Sus2', value: 'sus2' },
  { label: 'Sus4', value: 'sus4' },
  { label: '5', value: '5' },
];

// Extensions
const EXTENSIONS = [
  { label: 'None', value: '' },
  { label: '7', value: '7' },
  { label: 'maj7', value: 'maj7' },
  { label: '9', value: '9' },
  { label: '6', value: '6' },
  { label: 'add9', value: 'add9' },
];

@customElement('chord-progression-creator')
export class ChordProgressionCreator extends LitElement {
  @property({ type: Object })
  chordProgressions: Record<string, string[]> = {};

  @state()
  private progressionName: string = '';

  @state()
  private selectedChords: string[] = [];

  @state()
  private selectedProgressionKey: string | null = null; // null = new progression

  @state()
  private isEditing: boolean = false; // true when editing existing progression

  // Chord builder state
  @state()
  private selectedRoot: string = 'C';

  @state()
  private selectedAccidental: string = '';

  @state()
  private selectedQuality: string = '';

  @state()
  private selectedExtension: string = '';

  @state()
  private dropdownOpen: boolean = false;

  static styles = css`
    :host {
      display: block;
      padding: 16px;
    }

    .creator-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .progression-selector {
      background: var(--spectrum-gray-75);
      border-radius: 8px;
      padding: 16px;
    }

    .selector-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .selector-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--spectrum-gray-600);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .name-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Combined input group for progression name */
    .progression-input-group {
      display: flex;
      gap: 0;
      align-items: stretch;
      position: relative;
    }

    .progression-name-input {
      flex: 1;
      border-top-right-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
    }

    .dropdown-container {
      position: relative;
      display: flex;
    }

    .dropdown-button {
      min-width: 36px;
      height: 32px;
      border-radius: 0;
      padding: 0 8px;
      background-color: var(--spectrum-gray-75, #ffffff);
      border: 1px solid var(--spectrum-gray-400, #b3b3b3);
      border-left: none;
      cursor: pointer;
      transition: background-color 130ms ease-in-out, border-color 130ms ease-in-out;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dropdown-button:hover {
      background-color: var(--spectrum-gray-100, #f5f5f5);
      border-color: var(--spectrum-gray-500, #959595);
    }

    .dropdown-button:active {
      background-color: var(--spectrum-gray-200, #e0e0e0);
    }

    .dropdown-button svg {
      width: 10px;
      height: 10px;
      fill: var(--spectrum-gray-700, #6e6e6e);
    }

    .action-buttons {
      display: flex;
      gap: 0;
      margin-left: 8px;
    }

    .action-buttons sp-action-button {
      height: 32px;
      border-radius: 0;
    }

    .action-buttons sp-action-button:first-child {
      border-top-left-radius: var(--spectrum-corner-radius-100, 4px);
      border-bottom-left-radius: var(--spectrum-corner-radius-100, 4px);
    }

    .action-buttons sp-action-button:last-child {
      border-top-right-radius: var(--spectrum-corner-radius-100, 4px);
      border-bottom-right-radius: var(--spectrum-corner-radius-100, 4px);
    }

    /* Dropdown menu */
    .dropdown-menu {
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      min-width: 250px;
      max-height: 300px;
      overflow-y: auto;
      background: var(--spectrum-gray-75, #ffffff);
      border: 1px solid var(--spectrum-gray-400, #b3b3b3);
      border-radius: var(--spectrum-corner-radius-100, 4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10;
      margin: 0;
      padding: 4px 0;
    }

    .dropdown-menu-item {
      padding: 8px 12px;
      cursor: pointer;
      list-style: none;
      font-size: var(--spectrum-font-size-100, 14px);
      color: var(--spectrum-gray-800, #4b4b4b);
      transition: background-color 130ms ease-in-out;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .dropdown-menu-item:hover {
      background-color: var(--spectrum-gray-200, #e0e0e0);
    }

    .dropdown-menu-item.selected {
      background-color: var(--spectrum-blue-100, #e8f3ff);
      color: var(--spectrum-blue-900, #0054b6);
      font-weight: 600;
    }

    .dropdown-menu-item .checkmark {
      color: var(--spectrum-blue-900, #0054b6);
      font-weight: 700;
      margin-left: 8px;
    }

    .chord-builder {
      background: var(--spectrum-gray-75);
      border-radius: 8px;
      padding: 16px;
    }

    .builder-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--spectrum-gray-600);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    .builder-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
    }

    .builder-section:last-child {
      margin-bottom: 0;
    }

    .section-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--spectrum-gray-600);
      text-transform: uppercase;
    }

    .button-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .option-button {
      padding: 4px 10px;
      background: var(--spectrum-gray-200);
      border: 2px solid var(--spectrum-gray-300);
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      color: var(--spectrum-gray-900);
    }

    .option-button:hover {
      background: var(--spectrum-gray-300);
      border-color: var(--spectrum-gray-400);
    }

    .option-button.selected {
      background: var(--spectrum-blue-500);
      border-color: var(--spectrum-blue-600);
      color: white;
    }

    .option-button:active {
      transform: scale(0.95);
    }

    .option-button:disabled {
      background: var(--spectrum-gray-100);
      border-color: var(--spectrum-gray-200);
      color: var(--spectrum-gray-400);
      cursor: not-allowed;
      opacity: 0.5;
    }

    .option-button:disabled:hover {
      background: var(--spectrum-gray-100);
      border-color: var(--spectrum-gray-200);
    }

    .button-divider {
      width: 1px;
      height: 32px;
      background: var(--spectrum-gray-400);
      margin: 0 8px;
    }

    .progression-preview {
      background: var(--spectrum-gray-75);
      border-radius: 8px;
      padding: 16px;
      min-height: 80px;
    }

    .preview-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--spectrum-gray-700);
      margin-bottom: 8px;
    }

    .preview-chords {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .preview-chords.empty {
      justify-content: center;
      align-items: center;
      min-height: 48px;
      color: var(--spectrum-gray-500);
      font-style: italic;
    }

    .chord-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: var(--spectrum-blue-100);
      border: 1px solid var(--spectrum-blue-300);
      border-radius: 6px;
      font-weight: 600;
      color: var(--spectrum-blue-900);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .chord-chip:hover {
      background: var(--spectrum-blue-200);
    }

    .chord-chip sp-action-button {
      margin: -4px -6px -4px 0;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--spectrum-gray-200);
    }

    /* Native select styling to match Spectrum picker */
    .native-select {
      width: 100%;
      box-sizing: border-box;
      height: var(--spectrum-component-height-100, 32px);
      padding-inline-start: var(--spectrum-component-edge-to-text-100, 12px);
      padding-inline-end: 28px; /* Space for dropdown arrow */
      font-family: var(--spectrum-sans-font-family-stack, adobe-clean, 'Source Sans Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--spectrum-font-size-100, 14px);
      font-weight: var(--spectrum-regular-font-weight, 400);
      line-height: var(--spectrum-line-height-100, 1.3);
      border: 1px solid var(--spectrum-gray-400, #b3b3b3);
      border-radius: var(--spectrum-corner-radius-100, 4px);
      background-color: var(--spectrum-gray-75, #ffffff);
      color: var(--spectrum-gray-800, #4b4b4b);
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%236e6e6e' d='M5 6L0 0h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      transition: border-color 130ms ease-in-out, box-shadow 130ms ease-in-out, background-color 130ms ease-in-out;
    }

    .native-select:hover {
      border-color: var(--spectrum-gray-500, #959595);
      background-color: var(--spectrum-gray-100, #f5f5f5);
    }

    .native-select:focus {
      outline: none;
      border-color: var(--spectrum-blue-900, #0054b6);
      box-shadow: 0 0 0 1px var(--spectrum-blue-900, #0054b6);
    }

    .native-select:focus-visible {
      outline: 2px solid var(--spectrum-focus-indicator-color, #0054b6);
      outline-offset: 2px;
    }
  `;

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);

    // Auto-clear extension when selecting power chords or suspended chords
    if (changedProperties.has('selectedQuality')) {
      if (this.selectedQuality === '5' ||
          this.selectedQuality === 'sus2' ||
          this.selectedQuality === 'sus4') {
        this.selectedExtension = '';
      }
    }

    // Auto-clear accidental when changing root if the current accidental becomes invalid
    if (changedProperties.has('selectedRoot')) {
      if (this.selectedAccidental && this.isAccidentalDisabled(this.selectedAccidental)) {
        this.selectedAccidental = '';
      }
    }
  }

  render() {
    const currentChord = this.getCurrentChord();
    const progressionKeys = Object.keys(this.chordProgressions).sort();

    return html`
      <div class="creator-container">
        <!-- Progression Selector with Combined Input -->
        <div class="progression-selector">
          <div class="progression-input-group">
            <!-- Text input for progression name -->
            <sp-textfield
              class="progression-name-input"
              placeholder="Enter progression name..."
              .value=${this.progressionName}
              @input=${(e: Event) => this.progressionName = (e.target as HTMLInputElement).value}>
            </sp-textfield>

            <!-- Dropdown button -->
            <div class="dropdown-container">
              <button
                class="dropdown-button"
                @click=${this.toggleDropdown}
                @blur=${() => setTimeout(() => this.closeDropdown(), 200)}
                title="Select existing progression">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6">
                  <path d="M5 6L0 0h10z"/>
                </svg>
              </button>

              ${this.dropdownOpen ? html`
                <ul class="dropdown-menu">
                  ${progressionKeys.length === 0 ? html`
                    <li class="dropdown-menu-item" style="opacity: 0.6; cursor: default;">
                      No progressions yet
                    </li>
                  ` : progressionKeys.map(
                    (key) => html`
                      <li
                        class="dropdown-menu-item ${key === this.selectedProgressionKey ? 'selected' : ''}"
                        @click=${() => this.selectFromDropdown(key)}>
                        ${key}
                        ${key === this.selectedProgressionKey ? html`<span class="checkmark">✓</span>` : ''}
                      </li>
                    `
                  )}
                </ul>
              ` : ''}
            </div>

            <!-- Action buttons (New and Delete) -->
            <div class="action-buttons">
              <sp-action-button
                size="s"
                @click=${this.createNew}
                title="Create new progression">
                <sp-icon-add slot="icon"></sp-icon-add>
                New
              </sp-action-button>
              <sp-action-button
                size="s"
                ?disabled=${!this.isEditing}
                @click=${this.deleteProgression}
                title=${this.isEditing ? `Delete "${this.selectedProgressionKey}"` : 'Select a progression to delete'}>
                <sp-icon-delete slot="icon"></sp-icon-delete>
                Delete
              </sp-action-button>
            </div>
          </div>
        </div>

        <!-- Progression Preview -->
        <div class="progression-preview">
          <div class="preview-label">Progression (${this.selectedChords.length} chords)</div>
          <div class="preview-chords ${this.selectedChords.length === 0 ? 'empty' : ''}">
            ${this.selectedChords.length === 0
              ? 'Build a chord below and click "Add to Progression"'
              : this.selectedChords.map(
                  (chord, index) => html`
                    <div class="chord-chip">
                      ${chord}
                      <sp-action-button
                        size="xs"
                        quiet
                        @click=${() => this.removeChord(index)}>
                        <sp-icon-close slot="icon"></sp-icon-close>
                      </sp-action-button>
                    </div>
                  `
                )}
          </div>
        </div>

        <!-- Actions -->
        <div class="actions">
          <sp-button
            variant="accent"
            ?disabled=${this.isInvalidAccidental()}
            @click=${() => this.addChord(currentChord)}>
            Add ${currentChord}
          </sp-button>
          <sp-button variant="secondary" @click=${this.clearAll}>Clear All</sp-button>
          <sp-button
            variant="primary"
            ?disabled=${this.progressionName.trim() === '' || this.selectedChords.length === 0}
            @click=${this.saveProgression}>
            ${this.isEditing ? 'Update' : 'Save'} Progression
          </sp-button>
        </div>

        <!-- Chord Builder -->
        <div class="chord-builder">
          <div class="builder-label">Build Chord</div>

          <!-- Root Note & Accidental -->
          <div class="builder-section">
            <div class="section-label">Root & Accidental</div>
            <div class="button-group">
              ${ROOTS.map(
                (root) => html`
                  <button
                    class="option-button ${this.selectedRoot === root ? 'selected' : ''}"
                    @click=${() => (this.selectedRoot = root)}>
                    ${root}
                  </button>
                `
              )}
              <div class="button-divider"></div>
              ${ACCIDENTALS.map((acc) => html`
                <button
                  class="option-button ${this.selectedAccidental === acc.value ? 'selected' : ''}"
                  ?disabled=${this.isAccidentalDisabled(acc.value)}
                  @click=${() => (this.selectedAccidental = acc.value)}>
                  ${acc.label}
                </button>
              `)}
            </div>
          </div>

          <!-- Quality -->
          <div class="builder-section">
            <div class="section-label">Quality</div>
            <div class="button-group">
              ${QUALITIES.map(
                (qual) => html`
                  <button
                    class="option-button ${this.selectedQuality === qual.value ? 'selected' : ''}"
                    @click=${() => (this.selectedQuality = qual.value)}>
                    ${qual.label}
                  </button>
                `
              )}
            </div>
          </div>

          <!-- Extensions -->
          <div class="builder-section">
            <div class="section-label">Extension</div>
            <div class="button-group">
              ${EXTENSIONS.map((ext) => {
                // Power chords (5) and suspended chords can't have extensions
                const isInvalidExtension = ext.value !== '' &&
                  (this.selectedQuality === '5' ||
                   this.selectedQuality === 'sus2' ||
                   this.selectedQuality === 'sus4');

                return html`
                  <button
                    class="option-button ${this.selectedExtension === ext.value ? 'selected' : ''}"
                    ?disabled=${isInvalidExtension}
                    @click=${() => (this.selectedExtension = ext.value)}>
                    ${ext.label}
                  </button>
                `;
              })}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Check if a specific accidental is invalid for the selected root note.
   * E# and B# are enharmonic to F and C (invalid)
   * Fb and Cb are enharmonic to E and B (invalid)
   */
  private isAccidentalDisabled(accidentalValue: string): boolean {
    const root = this.selectedRoot;

    // E# and B# are enharmonic equivalents (E# = F, B# = C)
    if ((root === 'E' || root === 'B') && accidentalValue === '#') {
      return true;
    }

    // Fb and Cb are enharmonic equivalents (Fb = E, Cb = B)
    if ((root === 'F' || root === 'C') && accidentalValue === 'b') {
      return true;
    }

    return false;
  }

  private getCurrentChord(): string {
    let chord = this.selectedRoot + this.selectedAccidental;

    // Power chords (5) can't have extensions
    if (this.selectedQuality === '5') {
      return chord + '5';
    }

    // Suspended chords typically don't have extensions
    if (this.selectedQuality === 'sus2' || this.selectedQuality === 'sus4') {
      return chord + this.selectedQuality;
    }

    // For minor chords, add 'm' before extensions
    if (this.selectedQuality === 'm' && this.selectedExtension) {
      chord += 'm';
      // Handle special cases for extensions with 'm'
      if (this.selectedExtension === '7') {
        chord += '7'; // m7
      } else if (this.selectedExtension === 'maj7') {
        chord += 'maj7'; // mmaj7 (rare but valid)
      } else {
        chord += this.selectedExtension;
      }
    } else {
      // Non-minor or no extension
      chord += this.selectedQuality;
      chord += this.selectedExtension;
    }

    return chord;
  }

  private isInvalidAccidental(): boolean {
    // Check if the current accidental is disabled for the selected root
    return this.selectedAccidental ? this.isAccidentalDisabled(this.selectedAccidental) : false;
  }

  private addChord(chord: string) {
    this.selectedChords = [...this.selectedChords, chord];
  }

  private removeChord(index: number) {
    this.selectedChords = this.selectedChords.filter((_, i) => i !== index);
  }

  private toggleDropdown() {
    this.dropdownOpen = !this.dropdownOpen;
  }

  private closeDropdown() {
    this.dropdownOpen = false;
  }

  private selectFromDropdown(key: string) {
    this.loadProgression(key);
    this.closeDropdown();
  }

  private loadProgression(key: string | null) {
    this.selectedProgressionKey = key;

    if (key === null) {
      // New progression mode
      this.progressionName = '';
      this.selectedChords = [];
      this.isEditing = false;
    } else {
      // Load existing progression
      this.progressionName = key;
      this.selectedChords = [...(this.chordProgressions[key] || [])];
      this.isEditing = true;
    }
  }

  private createNew() {
    this.loadProgression(null);
    this.closeDropdown();
  }

  private deleteProgression() {
    if (!this.selectedProgressionKey) return;

    if (!confirm(`Delete progression "${this.selectedProgressionKey}"?`)) {
      return;
    }

    const updated = { ...this.chordProgressions };
    delete updated[this.selectedProgressionKey];

    // Update local property immediately to avoid race condition
    this.chordProgressions = updated;

    this.dispatchEvent(
      new CustomEvent('progressions-change', {
        detail: { chordProgressions: updated },
        bubbles: true,
        composed: true,
      })
    );

    // Switch to new progression mode
    this.loadProgression(null);
  }

  private clearAll() {
    if (this.selectedChords.length > 0) {
      if (confirm('Clear all chords from the progression?')) {
        this.selectedChords = [];
      }
    }
  }

  private saveProgression() {
    const name = this.progressionName.trim();
    if (!name) {
      alert('Please enter a progression name');
      return;
    }

    if (this.selectedChords.length === 0) {
      alert('Please select at least one chord');
      return;
    }

    // If editing, check if name changed
    const isRenamingExisting = this.isEditing && this.selectedProgressionKey !== name;

    if (isRenamingExisting && name in this.chordProgressions) {
      if (!confirm(`A progression named "${name}" already exists. Overwrite it?`)) {
        return;
      }
    }

    let updated = { ...this.chordProgressions };

    // If renaming, delete old key
    if (isRenamingExisting && this.selectedProgressionKey) {
      delete updated[this.selectedProgressionKey];
    }

    // Add/update progression
    updated[name] = [...this.selectedChords];

    // Update local property immediately to avoid race condition
    // This ensures loadProgression() below reads from the updated data
    this.chordProgressions = updated;

    this.dispatchEvent(
      new CustomEvent('progressions-change', {
        detail: { chordProgressions: updated },
        bubbles: true,
        composed: true,
      })
    );

    // After save, switch to editing mode for the saved progression
    this.loadProgression(name);
  }

  private dispatchChange(newProgressions: Record<string, string[]>) {
    this.dispatchEvent(
      new CustomEvent('progressions-change', {
        detail: { chordProgressions: newProgressions },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chord-progression-creator': ChordProgressionCreator;
  }
}


