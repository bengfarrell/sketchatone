import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formStyles } from '../../design-system/form-styles.js';
import '../../design-system/components/sketch-button.js';

/**
 * Server Settings Panel
 * 
 * Displays server-level settings that require a service restart to apply:
 * - MIDI backend (rtmidi vs jack)
 * - HTTP/WS/HTTPS/WSS ports
 * 
 * Provides a "Restart Service" button to apply changes.
 */
@customElement('server-settings-panel')
export class ServerSettingsPanel extends LitElement {
  static styles = [formStyles, css`
    :host {
      display: block;
    }

    .settings-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 4px 0;
    }

    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .setting-row label {
      font-size: 13px;
      color: var(--sketch-color-gray-700);
      flex: 1;
    }

    .restart-warning {
      padding: 12px;
      background: var(--sketch-color-orange-100);
      border-radius: 4px;
      font-size: 12px;
      color: var(--sketch-color-gray-800);
      margin-bottom: 12px;
    }

    .restart-button-container {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--sketch-color-gray-300);
      display: flex;
      justify-content: flex-end;
    }

    .restart-status {
      margin-top: 8px;
      font-size: 12px;
      padding: 8px;
      border-radius: 4px;
    }

    .restart-status.success {
      background: var(--sketch-color-green-100);
      color: var(--sketch-color-green-700);
    }

    .restart-status.error {
      background: var(--sketch-color-red-100);
      color: var(--sketch-color-red-700);
    }
  `];

  @property({ type: String })
  midiBackend = 'rtmidi';

  @property({ type: Number })
  httpPort = 80;

  @property({ type: Number })
  wsPort = 8081;

  @property({ type: Number })
  httpsPort = 443;

  @property({ type: Number })
  wssPort = 8082;

  @property({ type: String })
  restartStatus: 'idle' | 'restarting' | 'success' | 'error' = 'idle';

  @property({ type: String })
  restartMessage = '';

  render() {
    return html`
      <div class="settings-form">
        <div class="restart-warning">
          ⚠️ These settings require a service restart to take effect.
        </div>

        <div class="setting-row">
          <label>MIDI Backend</label>
          <select class="sketch-select" size="s" .value=${this.midiBackend} @change=${this.handleMidiBackendChange}>
            <option value="rtmidi">ALSA (rtmidi)</option>
            <option value="jack">JACK</option>
          </select>
        </div>

        <div class="setting-row">
          <label>HTTP Port</label>
          <input type="number" class="sketch-input" size="s"
            .value=${this.httpPort} min="1" max="65535" step="1"
            @change=${(e: Event) => this.handlePortChange('http', Number((e.target as HTMLInputElement).value))}>
        </div>

        <div class="setting-row">
          <label>WebSocket Port</label>
          <input type="number" class="sketch-input" size="s"
            .value=${this.wsPort} min="1" max="65535" step="1"
            @change=${(e: Event) => this.handlePortChange('ws', Number((e.target as HTMLInputElement).value))}>
        </div>

        <div class="setting-row">
          <label>HTTPS Port</label>
          <input type="number" class="sketch-input" size="s"
            .value=${this.httpsPort} min="1" max="65535" step="1"
            @change=${(e: Event) => this.handlePortChange('https', Number((e.target as HTMLInputElement).value))}>
        </div>

        <div class="setting-row">
          <label>Secure WebSocket Port</label>
          <input type="number" class="sketch-input" size="s"
            .value=${this.wssPort} min="1" max="65535" step="1"
            @change=${(e: Event) => this.handlePortChange('wss', Number((e.target as HTMLInputElement).value))}>
        </div>

        <div class="restart-button-container">
          <sketch-button variant="accent" size="s" @click=${this.handleRestart}>
            Restart Service
          </sketch-button>
        </div>

        ${this.restartStatus !== 'idle' ? html`
          <div class="restart-status ${this.restartStatus}">
            ${this.restartMessage}
          </div>
        ` : ''}
      </div>
    `;
  }

  private handleMidiBackendChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent('update-config', {
      bubbles: true,
      composed: true,
      detail: { path: 'midi.midiOutputBackend', value },
    }));
  }

  private handlePortChange(portType: 'http' | 'ws' | 'https' | 'wss', value: number) {
    const pathMap = {
      http: 'server.httpPort',
      ws: 'server.wsPort',
      https: 'server.httpsPort',
      wss: 'server.wssPort',
    };
    this.dispatchEvent(new CustomEvent('update-config', {
      bubbles: true,
      composed: true,
      detail: { path: pathMap[portType], value },
    }));
  }

  private handleRestart() {
    this.restartStatus = 'restarting';
    this.restartMessage = 'Restarting service...';
    this.dispatchEvent(new CustomEvent('restart-service', {
      bubbles: true,
      composed: true,
    }));
  }

  public showRestartSuccess(message: string) {
    this.restartStatus = 'success';
    this.restartMessage = message;
    setTimeout(() => {
      this.restartStatus = 'idle';
    }, 5000);
  }

  public showRestartError(error: string) {
    this.restartStatus = 'error';
    this.restartMessage = error;
    setTimeout(() => {
      this.restartStatus = 'idle';
    }, 10000);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'server-settings-panel': ServerSettingsPanel;
  }
}

