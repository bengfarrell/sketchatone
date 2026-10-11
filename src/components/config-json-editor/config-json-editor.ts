import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { configFingerprint, validateCompleteConfig } from '../../utils/config-validation.js';
import type { ApplyConfigResult } from '../../types/tablet-events.js';
import { formStyles } from '../../design-system/form-styles.js';
import '../../design-system/components/sketch-button.js';

@customElement('config-json-editor')
export class ConfigJsonEditor extends LitElement {
  @property({ attribute: false }) config: Record<string, unknown> | null = null;
  @property({ attribute: false }) template: Record<string, unknown> | null = null;
  @property() configName: string | null = null;
  @property({ type: Boolean }) connected = false;
  @property({ attribute: false }) result: ApplyConfigResult | null = null;
  @property({ type: Boolean }) locked = false;
  @state() private draft = '';
  @state() private dirty = false;
  @state() private errors: string[] = [];
  @state() private status = '';
  @state() private pending: string | null = null;
  private baseConfig: Record<string, unknown> | null = null;
  private baseName: string | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  static styles = [formStyles, css`
    :host { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    textarea { box-sizing: border-box; width: 100%; flex: 1; min-height: 300px; margin: 12px 0;
      resize: vertical; padding: 12px; font: 13px/1.5 monospace;
      color: var(--sketch-color-gray-900); background: var(--sketch-color-gray-100);
      border: 1px solid var(--sketch-color-gray-400); border-radius: 4px; }
    .error { color: var(--sketch-color-error, #c44); white-space: pre-wrap; }
    .status { white-space: pre-wrap; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `];

  get hasUnsavedChanges(): boolean { return this.dirty; }
  get isApplying(): boolean { return !!this.pending; }
  get hasConflict(): boolean { return this.conflict; }

  /** Only move the draft's file identity when an acknowledged rename left its base unchanged. */
  acceptRename(oldName: string, newName: string, config: unknown): void {
    if (this.baseName === oldName && configFingerprint(this.baseConfig) === configFingerprint(config)) {
      this.baseName = newName;
      this.requestUpdate();
    }
  }

  protected updated(): void {
    this.dispatchEvent(new CustomEvent('editor-state-change', {
      bubbles: true, composed: true,
      detail: { dirty: this.dirty, pending: !!this.pending },
    }));
  }

  protected willUpdate(changes: PropertyValues): void {
    if ((changes.has('config') || changes.has('configName')) && !this.dirty && !this.pending) this.reset();
    if (changes.has('connected') && !this.connected && this.pending) {
      this.finish('Connection lost. Apply outcome unknown; reconnect and reset to current configuration before retrying.');
    }
    if (changes.has('result') && this.result?.requestId === this.pending) {
      if (this.result.success) {
        this.finish(this.result.message ?? 'Configuration applied and saved.');
        this.reset();
      } else {
        this.finish(this.result.error ?? 'Apply failed.');
      }
    }
  }

  disconnectedCallback(): void {
    if (this.timeout) clearTimeout(this.timeout);
    super.disconnectedCallback();
  }

  private get conflict(): boolean {
    return this.dirty && (this.baseName !== this.configName ||
      configFingerprint(this.baseConfig) !== configFingerprint(this.config));
  }

  private reset(): void {
    this.baseConfig = this.config ? JSON.parse(JSON.stringify(this.config)) : null;
    this.baseName = this.configName;
    this.draft = this.config ? JSON.stringify(this.config, null, 2) : '';
    this.dirty = false;
    this.errors = [];
  }

  private edit(event: Event): void {
    this.draft = (event.target as HTMLTextAreaElement).value;
    this.dirty = true;
    this.status = '';
    this.validate();
  }

  private validate(): unknown {
    try {
      const parsed = JSON.parse(this.draft);
      this.errors = this.template ? validateCompleteConfig(parsed, this.template)
        : ['Server does not support complete configuration editing.'];
      return parsed;
    } catch (error) {
      this.errors = [error instanceof Error ? error.message : String(error)];
      return null;
    }
  }

  private apply(): void {
    const config = this.validate();
    if (this.errors.length || this.conflict || !this.connected || this.pending || this.locked) return;
    this.pending = `config-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.status = 'Applying…';
    this.timeout = setTimeout(() => {
      this.finish('No acknowledgement received. Apply outcome unknown; reconnect and reset to current configuration before retrying.');
    }, 15000);
    this.dispatchEvent(new CustomEvent('apply-config', {
      bubbles: true, composed: true,
      detail: { config, configName: this.baseName, baseConfig: this.baseConfig, requestId: this.pending },
    }));
  }

  private finish(message: string): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.pending = null;
    this.status = message;
  }

  render() {
    return html`
        <p>Apply replaces and autosaves ${this.baseName ?? 'the current configuration'}.
          Omitted settings use server defaults. Startup-only settings require a restart.</p>
        <textarea aria-label="Configuration JSON" spellcheck="false" .value=${this.draft}
          ?disabled=${!!this.pending || this.locked || !this.config} @input=${this.edit}></textarea>
        ${this.errors.map(error => html`<div class="error" role="alert">${error}</div>`)}
        ${this.conflict ? html`<p class="error" role="alert">The server configuration or file changed.
          Your draft is preserved. Copy any edits you want to keep, then reset to current configuration.</p>` : ''}
        <div class="actions">
        <sketch-button variant="primary" ?disabled=${this.locked || !this.connected || !this.template || !this.configName || !this.dirty || !!this.pending || !!this.errors.length || this.conflict}
          @click=${this.apply}>Apply</sketch-button>
        <sketch-button variant="secondary" ?disabled=${this.locked || !!this.pending || !this.config} @click=${() => { this.reset(); this.status = ''; }}>Reset to current</sketch-button>
        </div>
        <p class="status" role="status">${this.status}</p>
    `;
  }
}
