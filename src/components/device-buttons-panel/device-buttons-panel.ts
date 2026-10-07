import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formStyles } from '../../design-system/form-styles.js';
import '../../design-system/components/sketch-button.js';
import '../../design-system/components/sketch-icon.js';
import type { DeviceButtonData, DeviceKeyData } from '../../models/midi-strummer-config.js';

/**
 * Device Buttons Panel
 *
 * Manages the persisted list of physical tablet buttons and keyboard keys
 * observed on the device.
 * - Start/Stop detection to auto-add newly-pressed buttons and keys (ephemeral
 *   flag on the server; not saved between runs).
 * - Edit each entry's name.
 * - Delete a single entry or clear all.
 */
@customElement('device-buttons-panel')
export class DeviceButtonsPanel extends LitElement {
  static styles = [formStyles, css`
    :host { display: block; }

    .container { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }

    .listening-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 8px 10px;
      background: var(--sketch-color-gray-100);
      border: 1px solid var(--sketch-color-gray-300);
      border-radius: 4px;
    }
    .listening-row label { font-size: 13px; color: var(--sketch-color-gray-800); font-weight: 500; }
    .listening-hint { font-size: 11px; color: var(--sketch-color-gray-600); margin-top: 2px; }

    .detect-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; font-size: 12px; font-weight: 500;
      border: 1px solid var(--sketch-color-gray-400);
      border-radius: 4px; cursor: pointer; flex-shrink: 0;
      background: var(--sketch-color-gray-50);
      color: var(--sketch-color-gray-900);
      transition: background 0.15s, border-color 0.15s;
    }
    .detect-btn:hover { background: var(--sketch-color-gray-200); }
    .detect-btn.active {
      background: var(--sketch-color-red-600, #dc2626);
      border-color: var(--sketch-color-red-700, #b91c1c);
      color: white;
    }
    .detect-btn.active:hover { background: var(--sketch-color-red-700, #b91c1c); }
    .detect-btn .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--sketch-color-gray-500);
    }
    .detect-btn.active .dot {
      background: white;
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }

    .section-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
      color: var(--sketch-color-gray-700);
      margin-top: 4px;
    }

    .button-list { display: flex; flex-direction: column; gap: 6px; }
    .empty-state {
      padding: 12px; text-align: center;
      font-size: 12px; color: var(--sketch-color-gray-600);
      background: var(--sketch-color-gray-100);
      border-radius: 4px;
    }

    .button-row {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px;
      background: var(--sketch-color-gray-100);
      border: 1px solid var(--sketch-color-gray-300);
      border-radius: 4px;
    }
    .button-row .code {
      font-family: var(--sketch-font-family-mono, monospace);
      font-size: 11px; color: var(--sketch-color-gray-600);
      min-width: 60px;
    }
    .button-row input.name-input {
      flex: 1; font-size: 13px; padding: 4px 6px;
      color: var(--sketch-color-gray-900);
      background: var(--sketch-color-gray-50);
      border: 1px solid var(--sketch-color-gray-300);
      border-radius: 3px;
    }
    .button-row input.name-input:focus {
      outline: none;
      border-color: var(--sketch-color-informative, var(--sketch-color-gray-600));
    }
    .button-row input.name-input::placeholder {
      color: var(--sketch-color-gray-500);
    }

    .footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding-top: 8px; border-top: 1px solid var(--sketch-color-gray-300);
    }
  `];

  /** Ordered list of persisted device buttons */
  @property({ type: Array })
  buttons: DeviceButtonData[] = [];

  /** Ordered list of persisted keyboard keys */
  @property({ type: Array })
  keys: DeviceKeyData[] = [];

  /** Server-driven flag: whether the server is currently auto-adding new buttons/keys */
  @property({ type: Boolean })
  detecting: boolean = false;

  render() {
    const active = this.detecting;
    return html`
      <div class="container">
        <div class="listening-row">
          <div>
            <label>Input Detection</label>
            <div class="listening-hint">
              ${active
                ? 'Listening… press a tablet button or keyboard key to add it.'
                : 'Press Start, then press any tablet button or keyboard key to capture it.'}
            </div>
          </div>
          <button class="detect-btn ${active ? 'active' : ''}"
            type="button"
            @click=${this.handleDetectToggle}
            title=${active ? 'Stop detecting new inputs' : 'Start detecting new inputs'}>
            <span class="dot"></span>
            ${active ? 'Stop Detecting' : 'Detect New Inputs'}
          </button>
        </div>

        <div class="section-label">Tablet Buttons</div>
        <div class="button-list">
          ${this.buttons.length === 0
            ? html`<div class="empty-state">No buttons observed yet. Press a button on your tablet to add one.</div>`
            : this.buttons.map((btn, i) => html`
                <div class="button-row">
                  <span class="code">code:${btn.code}</span>
                  <input class="name-input" type="text" .value=${btn.name}
                    @change=${(e: Event) => this.handleNameChange(i, (e.target as HTMLInputElement).value)}>
                  <sketch-button variant="quiet" size="s" title="Delete"
                    @click=${() => this.handleDelete(i)}>
                    <sketch-icon slot="icon" name="delete"></sketch-icon>
                  </sketch-button>
                </div>
              `)}
        </div>

        <div class="section-label">Keyboard Keys</div>
        <div class="button-list">
          ${this.keys.length === 0
            ? html`<div class="empty-state">No keys observed yet. Press a keyboard key to add one.</div>`
            : this.keys.map((k, i) => html`
                <div class="button-row">
                  <span class="code">key:${k.key}</span>
                  <input class="name-input" type="text" .value=${k.name}
                    @change=${(e: Event) => this.handleKeyNameChange(i, (e.target as HTMLInputElement).value)}>
                  <sketch-button variant="quiet" size="s" title="Delete"
                    @click=${() => this.handleKeyDelete(i)}>
                    <sketch-icon slot="icon" name="delete"></sketch-icon>
                  </sketch-button>
                </div>
              `)}
        </div>

        ${(this.buttons.length > 0 || this.keys.length > 0) ? html`
          <div class="footer">
            ${this.buttons.length > 0 ? html`
              <sketch-button variant="quiet" size="s" @click=${this.handleClearAll}>
                Clear Buttons
              </sketch-button>
            ` : ''}
            ${this.keys.length > 0 ? html`
              <sketch-button variant="quiet" size="s" @click=${this.handleClearAllKeys}>
                Clear Keys
              </sketch-button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  private emitUpdate(path: string, value: unknown) {
    this.dispatchEvent(new CustomEvent('update-config', {
      bubbles: true, composed: true,
      detail: { path, value },
    }));
  }

  private handleDetectToggle() {
    this.dispatchEvent(new CustomEvent('toggle-button-detection', {
      bubbles: true, composed: true,
      detail: { enabled: !this.detecting },
    }));
  }

  private handleNameChange(index: number, name: string) {
    const next = this.buttons.map((b, i) => i === index ? { ...b, name: name || `Button ${b.code}` } : b);
    this.emitUpdate('deviceButtons.buttons', next);
  }

  private handleDelete(index: number) {
    const next = this.buttons.filter((_, i) => i !== index);
    this.emitUpdate('deviceButtons.buttons', next);
  }

  private handleClearAll() {
    this.emitUpdate('deviceButtons.buttons', []);
  }

  private handleKeyNameChange(index: number, name: string) {
    const next = this.keys.map((k, i) => i === index ? { ...k, name: name || `Key ${k.key.toUpperCase()}` } : k);
    this.emitUpdate('deviceButtons.keys', next);
  }

  private handleKeyDelete(index: number) {
    const next = this.keys.filter((_, i) => i !== index);
    this.emitUpdate('deviceButtons.keys', next);
  }

  private handleClearAllKeys() {
    this.emitUpdate('deviceButtons.keys', []);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'device-buttons-panel': DeviceButtonsPanel;
  }
}
