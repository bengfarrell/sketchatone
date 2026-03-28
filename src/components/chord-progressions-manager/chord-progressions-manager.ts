/**
 * Chord Progressions Manager Component
 * 
 * Allows users to create, edit, and delete chord progressions
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/field-label/sp-field-label.js';
import '@spectrum-web-components/dialog/sp-dialog.js';
import '@spectrum-web-components/divider/sp-divider.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-delete.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';

@customElement('chord-progressions-manager')
export class ChordProgressionsManager extends LitElement {
  @property({ type: Object })
  chordProgressions: Record<string, string[]> = {};

  @state()
  private selectedProgression: string = '';

  @state()
  private editingName: string | null = null;

  @state()
  private editingChords: string = '';

  @state()
  private newProgressionName: string = '';

  @state()
  private newProgressionChords: string = '';

  @state()
  private showAddDialog = false;

  @state()
  private showEditDialog = false;

  static styles = css`
    :host {
      display: block;
      padding: 16px;
    }

    .controls {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: flex-end;
    }

    .picker-container {
      flex: 1;
    }

    sp-picker {
      width: 100%;
    }

    .button-group {
      display: flex;
      gap: 8px;
    }

    .selected-progression {
      padding: 16px;
      background: var(--spectrum-gray-75);
      border-radius: 4px;
      margin-bottom: 16px;
    }

    .progression-details {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .progression-name {
      font-weight: 600;
      font-size: 14px;
      color: var(--spectrum-gray-900);
    }

    .progression-chords {
      color: var(--spectrum-gray-700);
      font-family: monospace;
      font-size: 13px;
    }

    .dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px 0;
    }

    .help-text {
      font-size: 12px;
      color: var(--spectrum-gray-600);
      font-style: italic;
    }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--spectrum-gray-600);
    }
  `;

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);

    // Auto-select first progression if none selected and progressions exist
    if (changedProperties.has('chordProgressions')) {
      const progressionNames = Object.keys(this.chordProgressions).sort();
      if (progressionNames.length > 0 && !this.selectedProgression) {
        this.selectedProgression = progressionNames[0];
      } else if (progressionNames.length === 0) {
        this.selectedProgression = '';
      } else if (!progressionNames.includes(this.selectedProgression)) {
        // Current selection doesn't exist anymore, pick first one
        this.selectedProgression = progressionNames[0];
      }
    }
  }

  render() {
    const progressionEntries = Object.entries(this.chordProgressions);
    const sortedEntries = progressionEntries.sort(([a], [b]) => a.localeCompare(b));

    return html`
      ${progressionEntries.length === 0 ? html`
        <div class="empty-state">
          No chord progressions defined. Click "Add" to create one.
        </div>
      ` : html`
        <div class="controls">
          <div class="picker-container">
            <sp-field-label for="progression-picker">Select Progression</sp-field-label>
            <sp-picker
              id="progression-picker"
              label="Select a progression"
              value=${this.selectedProgression}
              @change=${this.handleProgressionSelect}>
              ${sortedEntries.map(([name]) => html`
                <sp-menu-item value=${name}>${name}</sp-menu-item>
              `)}
            </sp-picker>
          </div>
          <div class="button-group">
            <sp-button size="m" @click=${() => this.showAddDialog = true}>Add</sp-button>
          </div>
        </div>

        ${this.selectedProgression ? this.renderSelectedProgression() : ''}
      `}

      ${this.renderAddDialog()}
      ${this.renderEditDialog()}
    `;
  }

  private handleProgressionSelect(e: Event) {
    const picker = e.target as any;
    this.selectedProgression = picker.value;
  }

  private renderSelectedProgression() {
    if (!this.selectedProgression) return '';

    const chords = this.chordProgressions[this.selectedProgression];
    if (!chords) return '';

    return html`
      <div class="selected-progression">
        <div class="progression-details">
          <div class="progression-name">${this.selectedProgression}</div>
          <div class="progression-chords">${chords.join(', ')}</div>
        </div>
        <sp-divider size="s" style="margin: 12px 0;"></sp-divider>
        <div class="button-group">
          <sp-button size="s" variant="secondary" @click=${() => this.openEditDialog(this.selectedProgression, chords)}>
            <sp-icon-edit slot="icon"></sp-icon-edit>
            Edit
          </sp-button>
          <sp-button size="s" variant="negative" @click=${() => this.deleteProgression(this.selectedProgression)}>
            <sp-icon-delete slot="icon"></sp-icon-delete>
            Delete
          </sp-button>
        </div>
      </div>
    `;
  }

  private renderAddDialog() {
    if (!this.showAddDialog) return '';

    return html`
      <sp-dialog size="m" open @close=${() => this.showAddDialog = false}>
        <h2 slot="heading">Add Chord Progression</h2>
        <div class="dialog-content">
          <sp-field-label for="new-name">Progression Name</sp-field-label>
          <sp-textfield id="new-name" placeholder="e-minor-sad" 
            .value=${this.newProgressionName}
            @input=${(e: Event) => this.newProgressionName = (e.target as HTMLInputElement).value}>
          </sp-textfield>
          
          <sp-field-label for="new-chords">Chords (comma-separated)</sp-field-label>
          <sp-textfield id="new-chords" placeholder="Am, F, C, G"
            .value=${this.newProgressionChords}
            @input=${(e: Event) => this.newProgressionChords = (e.target as HTMLInputElement).value}>
          </sp-textfield>
          <div class="help-text">Example: Am, F, C, G or Cmaj7, Dm7, G7</div>
        </div>
        <sp-button slot="button" variant="secondary" @click=${() => this.closeAddDialog()}>Cancel</sp-button>
        <sp-button slot="button" variant="accent" @click=${() => this.addProgression()}>Add</sp-button>
      </sp-dialog>
    `;
  }

  private renderEditDialog() {
    if (!this.showEditDialog || !this.editingName) return '';

    return html`
      <sp-dialog size="m" open @close=${() => this.showEditDialog = false}>
        <h2 slot="heading">Edit Chord Progression</h2>
        <div class="dialog-content">
          <sp-field-label for="edit-name">Progression Name</sp-field-label>
          <sp-textfield id="edit-name" disabled .value=${this.editingName}></sp-textfield>

          <sp-field-label for="edit-chords">Chords (comma-separated)</sp-field-label>
          <sp-textfield id="edit-chords" placeholder="Am, F, C, G"
            .value=${this.editingChords}
            @input=${(e: Event) => this.editingChords = (e.target as HTMLInputElement).value}>
          </sp-textfield>
          <div class="help-text">Example: Am, F, C, G or Cmaj7, Dm7, G7</div>
        </div>
        <sp-button slot="button" variant="secondary" @click=${() => this.closeEditDialog()}>Cancel</sp-button>
        <sp-button slot="button" variant="accent" @click=${() => this.saveEdit()}>Save</sp-button>
      </sp-dialog>
    `;
  }

  private openEditDialog(name: string, chords: string[]) {
    this.editingName = name;
    this.editingChords = chords.join(', ');
    this.showEditDialog = true;
  }

  private closeEditDialog() {
    this.showEditDialog = false;
    this.editingName = null;
    this.editingChords = '';
  }

  private closeAddDialog() {
    this.showAddDialog = false;
    this.newProgressionName = '';
    this.newProgressionChords = '';
  }

  private addProgression() {
    const name = this.newProgressionName.trim();
    const chordsStr = this.newProgressionChords.trim();

    if (!name || !chordsStr) {
      alert('Please enter both a name and chords');
      return;
    }

    if (name in this.chordProgressions) {
      alert('A progression with this name already exists');
      return;
    }

    const chords = chordsStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
    if (chords.length === 0) {
      alert('Please enter at least one chord');
      return;
    }

    const updated = { ...this.chordProgressions, [name]: chords };
    this.dispatchChange(updated);
    this.closeAddDialog();
  }

  private saveEdit() {
    if (!this.editingName) return;

    const chordsStr = this.editingChords.trim();
    if (!chordsStr) {
      alert('Please enter chords');
      return;
    }

    const chords = chordsStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
    if (chords.length === 0) {
      alert('Please enter at least one chord');
      return;
    }

    const updated = { ...this.chordProgressions, [this.editingName]: chords };
    this.dispatchChange(updated);
    this.closeEditDialog();
  }

  private deleteProgression(name: string) {
    if (!confirm(`Delete chord progression "${name}"?`)) {
      return;
    }

    // Clear selection if we're deleting the selected progression
    if (this.selectedProgression === name) {
      this.selectedProgression = '';
    }

    const updated = { ...this.chordProgressions };
    delete updated[name];
    this.dispatchChange(updated);
  }

  private dispatchChange(newProgressions: Record<string, string[]>) {
    this.dispatchEvent(new CustomEvent('progressions-change', {
      detail: { chordProgressions: newProgressions },
      bubbles: true,
      composed: true,
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chord-progressions-manager': ChordProgressionsManager;
  }
}


