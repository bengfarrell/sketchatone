/**
 * MIDI Devices Configuration Component
 * 
 * Displays available MIDI input and output devices and allows selection.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { MidiDevicePort } from '../../types/tablet-events.js';

@customElement('midi-devices-config')
export class MidiDevicesConfig extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: var(--spectrum-font-family, system-ui, -apple-system, sans-serif);
    }

    .devices-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .device-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--spectrum-gray-300);
    }

    .section-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--spectrum-gray-900);
    }

    .refresh-icon-button {
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: var(--spectrum-gray-600);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.15s ease;
    }

    .refresh-icon-button:hover {
      background: var(--spectrum-gray-200);
      color: var(--spectrum-gray-900);
    }

    .refresh-icon-button:active {
      background: var(--spectrum-gray-300);
    }

    .refresh-icon-button svg {
      width: 16px;
      height: 16px;
    }

    .device-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 200px;
      overflow-y: auto;
    }

    .device-item {
      padding: 10px 12px;
      background: var(--spectrum-gray-100);
      border: 2px solid var(--spectrum-gray-300);
      border-radius: 6px;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .device-item:hover {
      background: var(--spectrum-gray-200);
      border-color: var(--spectrum-gray-400);
    }

    .device-item.connected {
      background: var(--spectrum-green-100);
      border-color: var(--spectrum-green-500);
    }

    /* Toggle Switch Styles */
    .device-toggle {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
      cursor: pointer;
    }

    .device-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--spectrum-gray-400);
      border-radius: 22px;
      transition: 0.2s;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      border-radius: 50%;
      transition: 0.2s;
    }

    .device-toggle input:checked + .toggle-slider {
      background-color: var(--spectrum-green-600);
    }

    .device-toggle input:checked + .toggle-slider:before {
      transform: translateX(18px);
    }

    .device-toggle:hover .toggle-slider {
      background-color: var(--spectrum-gray-500);
    }

    .device-toggle input:checked:hover + .toggle-slider {
      background-color: var(--spectrum-green-700);
    }

    .device-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .device-name {
      font-size: 0.875rem;
      color: var(--spectrum-gray-900);
    }

    .device-index {
      font-size: 0.75rem;
      color: var(--spectrum-gray-600);
      font-family: monospace;
    }

    .empty-message {
      padding: 20px;
      text-align: center;
      color: var(--spectrum-gray-700);
      font-style: italic;
    }
  `;

  @property({ type: Array })
  inputPorts: MidiDevicePort[] = [];

  @property({ type: Array })
  outputPorts: MidiDevicePort[] = [];

  @property({ type: Array })
  currentInputPorts: (string | number)[] = [];  // Array of connected input port IDs

  @property()
  currentOutputPort: string | number | null = null;

  private handleInputToggle(portId: string | number, event: Event): void {
    event.stopPropagation();
    const checkbox = event.target as HTMLInputElement;

    // Build array of selected ports
    let newInputPorts: (string | number)[];
    if (checkbox.checked) {
      // Add this port to the selected list
      newInputPorts = [...this.currentInputPorts, portId];
    } else {
      // Remove this port from the selected list
      newInputPorts = this.currentInputPorts.filter(id => id !== portId);
    }

    this.dispatchEvent(new CustomEvent('apply-devices', {
      bubbles: true,
      composed: true,
      detail: {
        inputPorts: newInputPorts,  // Send array of port IDs
        // Don't change output port when toggling input
      },
    }));
  }

  private handleOutputToggle(portId: string | number, event: Event): void {
    event.stopPropagation();
    const checkbox = event.target as HTMLInputElement;

    // If turning on, apply this port. If turning off, apply null (port 0)
    const newOutputPort = checkbox.checked ? portId : null;

    this.dispatchEvent(new CustomEvent('apply-devices', {
      bubbles: true,
      composed: true,
      detail: {
        // Don't change input port when toggling output
        outputPort: newOutputPort,
      },
    }));
  }

  private handleRefresh(): void {
    this.dispatchEvent(new CustomEvent('refresh-devices', {
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const refreshIcon = html`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
    `;

    return html`
      <div class="devices-container">
        <!-- MIDI Input Devices -->
        <div class="device-section">
          <div class="section-header">
            <span class="section-title">MIDI Input Devices</span>
            <button class="refresh-icon-button" @click=${this.handleRefresh} title="Refresh devices">
              ${refreshIcon}
            </button>
          </div>
          <div class="device-list">
            ${this.inputPorts.length === 0 ? html`
              <div class="empty-message">No MIDI input devices found</div>
            ` : this.inputPorts.map(port => {
              const isConnected = this.currentInputPorts.includes(port.id);
              return html`
                <div class="device-item ${isConnected ? 'connected' : ''}">
                  <label class="device-toggle" @click=${(e: Event) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      .checked=${isConnected}
                      @change=${(e: Event) => this.handleInputToggle(port.id, e)}
                    />
                    <span class="toggle-slider"></span>
                  </label>
                  <div class="device-info">
                    <span class="device-name">${port.name}</span>
                    <span class="device-index">Index: ${port.id}</span>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>

        <!-- MIDI Output Devices -->
        <div class="device-section">
          <div class="section-header">
            <span class="section-title">MIDI Output Devices</span>
            <button class="refresh-icon-button" @click=${this.handleRefresh} title="Refresh devices">
              ${refreshIcon}
            </button>
          </div>
          <div class="device-list">
            ${this.outputPorts.length === 0 ? html`
              <div class="empty-message">No MIDI output devices found</div>
            ` : this.outputPorts.map(port => {
              const isConnected = this.currentOutputPort === port.id;
              return html`
                <div class="device-item ${isConnected ? 'connected' : ''}">
                  <label class="device-toggle" @click=${(e: Event) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      .checked=${isConnected}
                      @change=${(e: Event) => this.handleOutputToggle(port.id, e)}
                    />
                    <span class="toggle-slider"></span>
                  </label>
                  <div class="device-info">
                    <span class="device-name">${port.name}</span>
                    <span class="device-index">Index: ${port.id}</span>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'midi-devices-config': MidiDevicesConfig;
  }
}
