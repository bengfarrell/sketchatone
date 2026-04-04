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
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu.js';
import '@spectrum-web-components/menu/sp-menu-item.js';

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
      padding: 8px 14px;
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

    .current-chord {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 12px 0;
    }

    .chord-preview {
      font-size: 28px;
      font-weight: 700;
      color: var(--spectrum-blue-700);
      min-width: 80px;
      text-align: center;
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

    // Auto-clear invalid accidentals when changing root
    if (changedProperties.has('selectedRoot')) {
      if (this.isInvalidAccidental()) {
        this.selectedAccidental = '';
      }
    }
  }

  render() {
    const currentChord = this.getCurrentChord();
    const progressionKeys = Object.keys(this.chordProgressions).sort();

    return html`
      <div class="creator-container">
        <!-- Progression Selector -->
        <div class="progression-selector">
          <div class="selector-header">
            <div class="selector-label">Select Progression</div>
            <sp-action-button
              size="s"
              @click=${this.createNew}>
              <sp-icon-add slot="icon"></sp-icon-add>
              New
            </sp-action-button>
          </div>

          <sp-picker
            label="Choose progression"
            .value=${this.selectedProgressionKey ?? 'new'}
            @change=${(e: CustomEvent) => {
              const value = (e.target as any).value;
              this.loadProgression(value === 'new' ? null : value);
            }}>
            <sp-menu-item value="new">+ New Progression</sp-menu-item>
            ${progressionKeys.map(
              (key) => html`
                <sp-menu-item value="${key}">${key}</sp-menu-item>
              `
            )}
          </sp-picker>
        </div>

        <!-- Name Input -->
        <div class="name-field">
          <sp-field-label for="progression-name">
            ${this.isEditing ? 'Editing' : 'New'} Progression Name
          </sp-field-label>
          <sp-textfield
            id="progression-name"
            placeholder="my-custom-progression"
            .value=${this.progressionName}
            @input=${(e: Event) => this.progressionName = (e.target as HTMLInputElement).value}>
          </sp-textfield>
        </div>

        <!-- Chord Builder -->
        <div class="chord-builder">
          <div class="builder-label">Build Chord</div>

          <!-- Root Note -->
          <div class="builder-section">
            <div class="section-label">Root</div>
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
            </div>
          </div>

          <!-- Accidentals -->
          <div class="builder-section">
            <div class="section-label">Accidental</div>
            <div class="button-group">
              ${ACCIDENTALS.map((acc) => {
                // Check if this accidental creates an invalid combination
                const wouldBeInvalid =
                  (this.selectedRoot === 'E' && acc.value === '#') ||
                  (this.selectedRoot === 'B' && acc.value === '#') ||
                  (this.selectedRoot === 'F' && acc.value === 'b') ||
                  (this.selectedRoot === 'C' && acc.value === 'b');

                return html`
                  <button
                    class="option-button ${this.selectedAccidental === acc.value ? 'selected' : ''}"
                    ?disabled=${wouldBeInvalid}
                    @click=${() => (this.selectedAccidental = acc.value)}>
                    ${acc.label}
                  </button>
                `;
              })}
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

          <!-- Current Chord Preview & Add Button -->
          <div class="current-chord">
            <div class="chord-preview">${currentChord}</div>
            <sp-button
              variant="accent"
              ?disabled=${this.isInvalidAccidental()}
              @click=${() => this.addChord(currentChord)}>
              Add to Progression
            </sp-button>
          </div>
        </div>

        <!-- Progression Preview -->
        <div class="progression-preview">
          <div class="preview-label">Progression (${this.selectedChords.length} chords)</div>
          <div class="preview-chords ${this.selectedChords.length === 0 ? 'empty' : ''}">
            ${this.selectedChords.length === 0
              ? 'Build a chord above and click "Add to Progression"'
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
          ${this.isEditing ? html`
            <sp-button variant="negative" @click=${this.deleteProgression}>
              <sp-icon-delete slot="icon"></sp-icon-delete>
              Delete
            </sp-button>
          ` : ''}
          <sp-button variant="secondary" @click=${this.clearAll}>Clear All</sp-button>
          <sp-button
            variant="primary"
            ?disabled=${this.progressionName.trim() === '' || this.selectedChords.length === 0}
            @click=${this.saveProgression}>
            ${this.isEditing ? 'Update' : 'Save'} Progression
          </sp-button>
        </div>
      </div>
    `;
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
    // E# and B# are technically F and C (enharmonic equivalents)
    // Fb and Cb are technically E and B (enharmonic equivalents)
    if ((this.selectedRoot === 'E' && this.selectedAccidental === '#') ||
        (this.selectedRoot === 'B' && this.selectedAccidental === '#') ||
        (this.selectedRoot === 'F' && this.selectedAccidental === 'b') ||
        (this.selectedRoot === 'C' && this.selectedAccidental === 'b')) {
      return true;
    }
    return false;
  }

  private addChord(chord: string) {
    this.selectedChords = [...this.selectedChords, chord];
  }

  private removeChord(index: number) {
    this.selectedChords = this.selectedChords.filter((_, i) => i !== index);
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
  }

  private deleteProgression() {
    if (!this.selectedProgressionKey) return;

    if (!confirm(`Delete progression "${this.selectedProgressionKey}"?`)) {
      return;
    }

    const updated = { ...this.chordProgressions };
    delete updated[this.selectedProgressionKey];

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


