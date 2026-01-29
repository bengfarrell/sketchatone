/**
 * Sketchatone Dashboard
 * WebSocket-only tablet viewer with strum-specific visualizers
 */

import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styles } from './sketchatone-dashboard.styles.js';

// Spectrum components
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-link.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-link-off.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-light.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-moon.js';

// Blankslate visualizer components
import 'blankslate/components/tablet-visualizer/tablet-visualizer.js';

// Strum visualizer components
import '../strum-visualizers/curve-visualizer.js';
import '../strum-visualizers/dashboard-panel.js';
import '../strum-visualizers/strum-visualizer.js';
import '../strum-visualizers/strum-events-display.js';
// import '../strum-visualizers/piano-keys.js'; // TODO: Add back later

// Tablet buttons config component
import '../tablet-buttons-config/tablet-buttons-config.js';

// Blankslate utilities
import {
  normalizeTabletData,
  formatValue,
  type TabletData,
} from 'blankslate';

// Local WebSocket client with config update support
import {
  StrummerWebSocketClient,
  type ServerMidiInputEvent,
  type ServerMidiInputStatus,
  type ServerMidiInputPort,
} from '../../utils/strummer-websocket-client.js';
import type { StrumEventData, ServerConfigData, CombinedEventData } from '../../types/tablet-events.js';
import type { StrumTabletEvent } from '../strum-visualizers/strum-events-display.js';
import type { MidiStrummerConfigData } from '../../models/midi-strummer-config.js';
import { TabletButtonsConfig } from '../../models/strummer-features.js';
import { Note, type NoteObject } from '../../models/note.js';

// Shared tablet interaction controller for curve visualizers
import { sharedTabletInteraction } from '../../controllers/index.js';

/**
 * Sketchatone Dashboard - WebSocket mode tablet viewer
 */
@customElement('sketchatone-dashboard')
export class SketchatoneDashboard extends LitElement {
  static styles = styles;

  @property({ type: String, attribute: 'app-title' })
  appTitle = 'Sketchatone Dashboard';

  @property({ type: String })
  themeColor: 'light' | 'dark' = 'light';

  // WebSocket state
  @state()
  private websocketConnected = false;

  @state()
  private websocketUrl = 'ws://localhost:8081';

  @state()
  private websocketServerInfo = '';

  // Visualization state
  @state()
  private tabletData: TabletData = {
    x: 0, y: 0, pressure: 0,
    tiltX: 0, tiltY: 0, tiltXY: 0,
    primaryButtonPressed: false,
    secondaryButtonPressed: false
  };

  @state()
  private pressedButtons: Set<number> = new Set();

  @state()
  private tabletEvents: StrumTabletEvent[] = [];

  @state()
  private lastStrumEvent: StrumEventData | null = null;

  @state()
  private packetCount = 0;

  @state()
  private strummerConfig: ServerConfigData | null = null;

  // Collapsible sections
  @state()
  private strumVisualizersExpanded = true;

  @state()
  private tabletButtonsExpanded = false;

  @state()
  private tabletVisualizersExpanded = true;

  // Server MIDI input state (from Node.js server)
  @state()
  private serverMidiConnected = false;

  @state()
  private serverMidiPorts: ServerMidiInputPort[] = [];

  @state()
  private serverMidiNotes: NoteObject[] = [];

  @state()
  private lastMidiPortName: string | null = null;

  // WebSocket client instance
  private wsClient = new StrummerWebSocketClient();

  connectedCallback() {
    super.connectedCallback();
    this.setupWebSocketClient();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.wsClient.cleanup();
  }

  private setupWebSocketClient() {
    this.wsClient.onConnectionStateChange((state) => {
      this.websocketConnected = state === 'connected';
      if (state === 'disconnected') {
        this.websocketServerInfo = '';
        this.strummerConfig = null;
      }
    });

    this.wsClient.onConfig((config: ServerConfigData) => {
      this.websocketServerInfo = `${config.notes?.length ?? 0} strings`;
      this.strummerConfig = config;
    });

    this.wsClient.onCombinedEvent((data: CombinedEventData) => {
      this.handleTabletData(data);
    });

    // Listen for server MIDI input status (sent on connect)
    this.wsClient.onMidiInputStatus((status: ServerMidiInputStatus) => {
      this.serverMidiConnected = status.connected;
      this.serverMidiPorts = status.availablePorts;
      this.serverMidiNotes = status.currentNotes.map((n) => Note.parseNotation(n));
    });

    // Listen for server MIDI input events (notes changed)
    this.wsClient.onMidiInput((event: ServerMidiInputEvent) => {
      this.serverMidiNotes = event.notes.map((n) => Note.parseNotation(n));
      this.lastMidiPortName = event.portName ?? null;
      this.serverMidiPorts = event.availablePorts;
      this.serverMidiConnected = true;
    });
  }

  /**
   * Copy port name to clipboard
   */
  private copyPortName(portName: string) {
    navigator.clipboard.writeText(portName).then(() => {
      console.log(`Copied "${portName}" to clipboard`);
    });
  }

  private handleTabletData(data: CombinedEventData) {
    this.packetCount++;

    // Normalize and update tablet data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.tabletData = normalizeTabletData(data as any);

    // Extract pressed buttons from individual button fields
    // The server sends button1, button2, etc. as booleans
    this.pressedButtons = this.extractButtonsFromData(data);

    // Update the shared tablet interaction controller so curve visualizers react
    const isPressed = this.tabletData.pressure > 0;
    sharedTabletInteraction.setTabletPosition(this.tabletData.x, this.tabletData.y, isPressed);
    sharedTabletInteraction.setTiltPosition(
      this.tabletData.tiltX,
      this.tabletData.tiltY,
      this.tabletData.pressure,
      isPressed,
      this.tabletData.tiltXY
    );
    sharedTabletInteraction.setPrimaryButton(this.tabletData.primaryButtonPressed);
    sharedTabletInteraction.setSecondaryButton(this.tabletData.secondaryButtonPressed);

    // Create event for display
    const event: StrumTabletEvent = {
      timestamp: Date.now(),
      x: this.tabletData.x,
      y: this.tabletData.y,
      pressure: this.tabletData.pressure,
      tiltX: this.tabletData.tiltX,
      tiltY: this.tabletData.tiltY,
      tiltXY: this.tabletData.tiltXY,
      primaryButtonPressed: this.tabletData.primaryButtonPressed,
      secondaryButtonPressed: this.tabletData.secondaryButtonPressed,
      state: data.state,
    };

    // Check for strum data in the combined event
    if (data.strum) {
      event.strum = data.strum;
      this.lastStrumEvent = data.strum;
    }

    // Add to event stream (keep last 50)
    this.tabletEvents = [...this.tabletEvents, event].slice(-50);
  }

  private handleWebSocketUrlChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.websocketUrl = input.value;
  }

  private connectWebSocket() {
    this.wsClient.connect(this.websocketUrl);
  }

  private disconnectWebSocket() {
    this.wsClient.disconnect();
    this.resetData();
  }

  private handleSaveConfig(): void {
    if (!this.fullConfig) return;
    const json = JSON.stringify(this.fullConfig, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strummer-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Send a config update to the server
   */
  private updateConfig(path: string, value: unknown) {
    this.wsClient.updateConfig(path, value);
  }

  private resetData() {
    this.tabletData = {
      x: 0, y: 0, pressure: 0,
      tiltX: 0, tiltY: 0, tiltXY: 0,
      primaryButtonPressed: false,
      secondaryButtonPressed: false
    };
    this.pressedButtons = new Set();
    this.tabletEvents = [];
    this.lastStrumEvent = null;
    this.packetCount = 0;
  }

  private handleThemeToggle() {
    this.dispatchEvent(new CustomEvent('theme-toggle', {
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Get the index of the last plucked string based on the last strum event
   */
  private getLastPluckedStringIndex(): number | null {
    if (!this.lastStrumEvent || !this.strummerConfig?.notes) {
      return null;
    }

    // Get the first note from the strum event
    const strumNote = this.lastStrumEvent.notes[0];
    if (!strumNote) {
      return null;
    }

    // Find the matching string index in the config
    const index = this.strummerConfig.notes.findIndex(
      (n: { notation: string; octave: number }) => n.notation === strumNote.note.notation && n.octave === strumNote.note.octave
    );

    return index >= 0 ? index : null;
  }

  /**
   * Get the full typed config from the strummer config
   */
  private get fullConfig(): MidiStrummerConfigData | null {
    if (!this.strummerConfig?.config) return null;
    return this.strummerConfig.config as unknown as MidiStrummerConfigData;
  }

  /**
   * Extract pressed tablet hardware buttons from combined event data
   * The server sends button1, button2, etc. as boolean fields
   */
  private extractButtonsFromData(data: CombinedEventData): Set<number> {
    const pressed = new Set<number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    if (d.button1) pressed.add(1);
    if (d.button2) pressed.add(2);
    if (d.button3) pressed.add(3);
    if (d.button4) pressed.add(4);
    if (d.button5) pressed.add(5);
    if (d.button6) pressed.add(6);
    if (d.button7) pressed.add(7);
    if (d.button8) pressed.add(8);
    return pressed;
  }

  private toggleStrumVisualizers() {
    this.strumVisualizersExpanded = !this.strumVisualizersExpanded;
  }

  private toggleTabletButtons() {
    this.tabletButtonsExpanded = !this.tabletButtonsExpanded;
  }

  private toggleTabletVisualizers() {
    this.tabletVisualizersExpanded = !this.tabletVisualizersExpanded;
  }

  /**
   * Handle config changes from the tablet-buttons-config component
   */
  private handleTabletButtonsConfigChange(e: CustomEvent) {
    const detail = e.detail as Record<string, unknown>;
    // The component emits multiple path-value pairs in the detail
    for (const [path, value] of Object.entries(detail)) {
      this.updateConfig(`strummer.${path}`, value);
    }
  }

  /**
   * Handle config changes from curve-visualizer components
   */
  private handleCurveConfigChange(e: CustomEvent) {
    const detail = e.detail as Record<string, unknown>;
    // The component emits path-value pairs like { 'noteDuration.multiplier': 2 }
    for (const [path, value] of Object.entries(detail)) {
      this.updateConfig(`strummer.${path}`, value);
    }
  }

  /**
   * Handle control changes from curve-visualizer components
   */
  private handleCurveControlChange(e: CustomEvent) {
    const { parameterKey, control } = e.detail as { parameterKey: string; control: string };
    this.updateConfig(`strummer.${parameterKey}.control`, control);
  }

  /**
   * Get the TabletButtonsConfig instance from the full config
   */
  private getTabletButtonsConfig(): TabletButtonsConfig | undefined {
    if (!this.fullConfig?.strummer?.tabletButtons) return undefined;
    return TabletButtonsConfig.fromDict(this.fullConfig.strummer.tabletButtons);
  }

  render() {
    const hasActiveConnection = this.websocketConnected;

    return html`
      <div class="dashboard">
        <!-- Header -->
        <div class="dashboard-header">
          <div class="header-row">
            <div class="header-info">
              <h1>${this.appTitle}</h1>
            </div>
            <div class="header-controls">
              <sp-action-button
                data-spectrum-pattern="action-button-quiet"
                quiet
                @click=${this.handleThemeToggle}
                aria-label=${this.themeColor === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
                ${this.themeColor === 'light'
                  ? html`<sp-icon-moon slot="icon"></sp-icon-moon>`
                  : html`<sp-icon-light slot="icon"></sp-icon-light>`}
              </sp-action-button>
            </div>
          </div>
          <div class="connection-row">
            <div class="save-button-group">
              <sp-button data-spectrum-pattern="button-primary-s" size="s" variant="primary" ?disabled=${!this.fullConfig} @click=${this.handleSaveConfig}>
                Save Config
              </sp-button>
            </div>
            ${this.websocketConnected ? html`
              <div class="connection-group">
                <div class="status-badge connected">
                  <span class="status-dot"></span>
                  ${this.websocketServerInfo || 'Connected'}
                </div>
                <sp-button data-spectrum-pattern="button-secondary-s" size="s" variant="secondary" @click=${this.disconnectWebSocket}>
                  Disconnect
                </sp-button>
              </div>
            ` : html`
              <div class="connection-group">
                <sp-textfield
                  data-spectrum-pattern="textfield-s"
                  size="s"
                  placeholder="ws://localhost:8081"
                  value=${this.websocketUrl}
                  @input=${this.handleWebSocketUrlChange}
                  style="width: 250px;">
                </sp-textfield>
                <sp-button data-spectrum-pattern="button-primary-s" size="s" variant="primary" @click=${this.connectWebSocket}>
                  Connect
                </sp-button>
              </div>
            `}
          </div>
        </div>

        ${!hasActiveConnection ? html`
          <div class="disconnected-message">
            <p>Connect to a WebSocket server to view strummer data</p>
          </div>
        ` : html`
        <!-- Visualization Section (Collapsible) -->
        <div class="visualizer-section">
          <button class="section-header" @click=${this.toggleTabletVisualizers}>
            <span class="section-title">Visualization</span>
            <span class="section-toggle">${this.tabletVisualizersExpanded ? '▼' : '▶'}</span>
          </button>
          ${this.tabletVisualizersExpanded ? html`
            <div class="section-content">
              <div class="visualizers-grid">
                <!-- Coordinates Panel with Strings -->
                <div class="visualizer-card compact">
                  <div class="visualizer-wrapper">
                    <strum-visualizer
                      mode="tablet"
                      .socketMode=${hasActiveConnection}
                      .tabletConnected=${hasActiveConnection}
                      .externalTabletData=${this.tabletData}
                      .externalPressedButtons=${this.pressedButtons}
                      .stringCount=${this.strummerConfig?.notes?.length ?? 6}
                      .notes=${this.strummerConfig?.notes ?? []}
                      .externalLastPluckedString=${this.getLastPluckedStringIndex()}>
                    </strum-visualizer>
                  </div>
                  <div class="data-values compact">
                    <div class="data-item">
                      <span class="data-label">X</span>
                      <span class="data-value ${this.tabletData.x === 0 ? 'zero' : ''}">
                        ${formatValue(this.tabletData.x)}
                      </span>
                    </div>
                    <div class="data-item">
                      <span class="data-label">Y</span>
                      <span class="data-value ${this.tabletData.y === 0 ? 'zero' : ''}">
                        ${formatValue(this.tabletData.y)}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Pressure & Tilt Panel -->
                <div class="visualizer-card compact">
                  <div class="visualizer-wrapper">
                    <tablet-visualizer
                      mode="tilt"
                      .socketMode=${hasActiveConnection}
                      .tabletConnected=${hasActiveConnection}
                      .externalTabletData=${this.tabletData}
                      .externalPressedButtons=${this.pressedButtons}>
                    </tablet-visualizer>
                  </div>
                  <div class="data-values compact">
                    <div class="data-item">
                      <span class="data-label">Pressure</span>
                      <span class="data-value ${this.tabletData.pressure === 0 ? 'zero' : ''}">
                        ${formatValue(this.tabletData.pressure)}
                      </span>
                    </div>
                    <div class="data-item">
                      <span class="data-label">Tilt X</span>
                      <span class="data-value ${this.tabletData.tiltX === 0 ? 'zero' : ''}">
                        ${formatValue(this.tabletData.tiltX)}
                      </span>
                    </div>
                    <div class="data-item">
                      <span class="data-label">Tilt Y</span>
                      <span class="data-value ${this.tabletData.tiltY === 0 ? 'zero' : ''}">
                        ${formatValue(this.tabletData.tiltY)}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- MIDI Input Panel -->
                <div class="visualizer-card compact midi-panel">
                  <div class="midi-panel-header">
                    <span class="midi-panel-title">MIDI Input</span>
                    <div class="status-badge small ${this.serverMidiConnected ? 'connected' : 'disconnected'}">
                      <span class="status-dot"></span>
                      ${this.serverMidiPorts.length} ports
                    </div>
                  </div>
                  <div class="midi-notes compact">
                    <span class="midi-notes-label">Notes:</span>
                    <span class="midi-notes-value">${this.serverMidiNotes.length > 0
                      ? this.serverMidiNotes.map((n) => `${n.notation}${n.octave}`).join(', ')
                      : '—'}</span>
                  </div>
                  ${this.lastMidiPortName ? html`
                    <div class="midi-source">from: ${this.lastMidiPortName}</div>
                  ` : ''}
                  ${this.serverMidiPorts.length > 0 ? html`
                    <div class="midi-ports-list">
                      <span class="midi-ports-label">Ports (click to copy):</span>
                      <ul class="midi-ports">
                        ${this.serverMidiPorts.map((port) => html`
                          <li class="midi-port-item ${port.name === this.lastMidiPortName ? 'active' : ''}"
                              @click=${() => this.copyPortName(port.name)}
                              title="Click to copy for config">
                            ${port.name}
                          </li>
                        `)}
                      </ul>
                    </div>
                  ` : ''}
                </div>

                <!-- Events Panel -->
                <div class="visualizer-card events-panel">
                  <strum-events-display
                    .events=${this.tabletEvents}
                    .isEmpty=${this.tabletEvents.length === 0}
                    .lastStrumEvent=${this.lastStrumEvent}
                    .deviceInfo=${{ packetCount: this.packetCount, isMock: false, isTranslated: true }}>
                  </strum-events-display>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Strumming Configuration Section (Collapsible) -->
        <div class="visualizer-section">
          <button class="section-header" @click=${this.toggleStrumVisualizers}>
            <span class="section-title">Strumming Configuration</span>
            <span class="section-toggle">${this.strumVisualizersExpanded ? '▼' : '▶'}</span>
          </button>
          ${this.strumVisualizersExpanded ? html`
            <div class="section-content">
              <div class="settings-grid">
                <!-- Curve Visualizers -->
                <dashboard-panel title="Note Velocity" size="small" .draggable=${false} .minimizable=${false}>
                  <curve-visualizer
                    label="Note Velocity"
                    parameterKey="noteVelocity"
                    control="${this.fullConfig?.strummer?.noteVelocity?.control ?? 'pressure'}"
                    outputLabel="Velocity"
                    color="#51cf66"
                    .config=${this.fullConfig?.strummer?.noteVelocity ?? { min: 0, max: 127, curve: 4, spread: 'direct', multiplier: 1 }}
                    @config-change=${this.handleCurveConfigChange}
                    @control-change=${this.handleCurveControlChange}>
                  </curve-visualizer>
                </dashboard-panel>

                <dashboard-panel title="Note Duration" size="small" .draggable=${false} .minimizable=${false}>
                  <curve-visualizer
                    label="Note Duration"
                    parameterKey="noteDuration"
                    control="${this.fullConfig?.strummer?.noteDuration?.control ?? 'tiltXY'}"
                    outputLabel="Duration"
                    color="#f59f00"
                    .config=${this.fullConfig?.strummer?.noteDuration ?? { min: 0.15, max: 1.5, curve: 1, spread: 'inverse', multiplier: 1 }}
                    @config-change=${this.handleCurveConfigChange}
                    @control-change=${this.handleCurveControlChange}>
                  </curve-visualizer>
                </dashboard-panel>

                <dashboard-panel title="Pitch Bend" size="small" .draggable=${false} .minimizable=${false}>
                  <curve-visualizer
                    label="Pitch Bend"
                    parameterKey="pitchBend"
                    control="${this.fullConfig?.strummer?.pitchBend?.control ?? 'yaxis'}"
                    outputLabel="Bend"
                    color="#339af0"
                    .config=${this.fullConfig?.strummer?.pitchBend ?? { min: -1, max: 1, curve: 4, spread: 'central', multiplier: 1 }}
                    @config-change=${this.handleCurveConfigChange}
                    @control-change=${this.handleCurveControlChange}>
                  </curve-visualizer>
                </dashboard-panel>

                <!-- Settings Panels -->
                <dashboard-panel title="Strumming Settings" size="medium" .draggable=${false} .minimizable=${false}>
                  <div class="settings-form">
                    <div class="setting-row">
                      <label>Pluck Velocity Scale</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumming?.pluckVelocityScale ?? 4.0}" step="0.1" min="0.1" max="10"
                        @change=${(e: Event) => this.updateConfig('strummer.strumming.pluckVelocityScale', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>Pressure Threshold</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumming?.pressureThreshold ?? 0.1}" step="0.01" min="0" max="1"
                        @change=${(e: Event) => this.updateConfig('strummer.strumming.pressureThreshold', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>MIDI Channel</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${(this.fullConfig?.strummer?.strumming?.midiChannel ?? 0) + 1}" step="1" min="1" max="16"
                        @change=${(e: Event) => this.updateConfig('strummer.strumming.midiChannel', Number((e.target as HTMLInputElement).value) - 1)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>Upper Note Spread</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumming?.upperNoteSpread ?? 3}" step="1" min="0" max="12"
                        @change=${(e: Event) => this.updateConfig('strummer.strumming.upperNoteSpread', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>Lower Note Spread</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumming?.lowerNoteSpread ?? 3}" step="1" min="0" max="12"
                        @change=${(e: Event) => this.updateConfig('strummer.strumming.lowerNoteSpread', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                  </div>
                </dashboard-panel>

                <dashboard-panel title="Stylus Buttons" size="medium" .draggable=${false} .minimizable=${false}
                  .hasActiveControl=${true}
                  .active=${this.fullConfig?.strummer?.stylusButtons?.active ?? true}
                  @active-change=${(e: CustomEvent) => this.updateConfig('strummer.stylusButtons.active', e.detail.active)}>
                  <div class="settings-form">
                    <div class="setting-row">
                      <label>Primary Button</label>
                      <sp-picker data-spectrum-pattern="picker-s" label="Action" value="${this.fullConfig?.strummer?.stylusButtons?.primaryButtonAction ?? 'toggle-transpose'}"
                        @change=${(e: Event) => this.updateConfig('strummer.stylusButtons.primaryButtonAction', (e.target as HTMLInputElement).value)}>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="toggle-transpose">Toggle Transpose</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="toggle-repeater">Toggle Repeater</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="momentary-transpose">Momentary Transpose</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="momentary-repeater">Momentary Repeater</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="octave-up">Octave Up</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="octave-down">Octave Down</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="none">None</sp-menu-item>
                      </sp-picker>
                    </div>
                    <div class="setting-row">
                      <label>Secondary Button</label>
                      <sp-picker data-spectrum-pattern="picker-s" label="Action" value="${this.fullConfig?.strummer?.stylusButtons?.secondaryButtonAction ?? 'toggle-repeater'}"
                        @change=${(e: Event) => this.updateConfig('strummer.stylusButtons.secondaryButtonAction', (e.target as HTMLInputElement).value)}>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="toggle-transpose">Toggle Transpose</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="toggle-repeater">Toggle Repeater</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="momentary-transpose">Momentary Transpose</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="momentary-repeater">Momentary Repeater</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="octave-up">Octave Up</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="octave-down">Octave Down</sp-menu-item>
                        <sp-menu-item data-spectrum-pattern="menu-item" value="none">None</sp-menu-item>
                      </sp-picker>
                    </div>
                  </div>
                </dashboard-panel>

                <dashboard-panel title="Note Repeater" size="medium" .draggable=${false} .minimizable=${false}
                  .hasActiveControl=${true}
                  .active=${this.fullConfig?.strummer?.noteRepeater?.active ?? false}
                  @active-change=${(e: CustomEvent) => this.updateConfig('strummer.noteRepeater.active', e.detail.active)}>
                  <div class="settings-form">
                    <div class="setting-row">
                      <label>Pressure Multiplier</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.noteRepeater?.pressureMultiplier ?? 1.0}" step="0.1" min="0.1" max="10"
                        @change=${(e: Event) => this.updateConfig('strummer.noteRepeater.pressureMultiplier', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>Frequency Multiplier</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.noteRepeater?.frequencyMultiplier ?? 1.0}" step="0.1" min="0.1" max="10"
                        @change=${(e: Event) => this.updateConfig('strummer.noteRepeater.frequencyMultiplier', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                  </div>
                </dashboard-panel>

                <dashboard-panel title="Transpose" size="medium" .draggable=${false} .minimizable=${false}
                  .hasActiveControl=${true}
                  .active=${this.fullConfig?.strummer?.transpose?.active ?? false}
                  @active-change=${(e: CustomEvent) => this.updateConfig('strummer.transpose.active', e.detail.active)}>
                  <div class="settings-form">
                    <div class="setting-row">
                      <label>Semitones</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.transpose?.semitones ?? 12}" step="1" min="-24" max="24"
                        @change=${(e: Event) => this.updateConfig('strummer.transpose.semitones', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                  </div>
                </dashboard-panel>

                <dashboard-panel title="Strum Release" size="medium" .draggable=${false} .minimizable=${false}
                  .hasActiveControl=${true}
                  .active=${this.fullConfig?.strummer?.strumRelease?.active ?? false}
                  @active-change=${(e: CustomEvent) => this.updateConfig('strummer.strumRelease.active', e.detail.active)}>
                  <div class="settings-form">
                    <div class="setting-row">
                      <label>MIDI Note</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumRelease?.midiNote ?? 38}" step="1" min="0" max="127"
                        @change=${(e: Event) => this.updateConfig('strummer.strumRelease.midiNote', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>MIDI Channel</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${(this.fullConfig?.strummer?.strumRelease?.midiChannel ?? 9) + 1}" step="1" min="1" max="16"
                        @change=${(e: Event) => this.updateConfig('strummer.strumRelease.midiChannel', Number((e.target as HTMLInputElement).value) - 1)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>Max Duration</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumRelease?.maxDuration ?? 0.25}" step="0.05" min="0.05" max="2"
                        @change=${(e: Event) => this.updateConfig('strummer.strumRelease.maxDuration', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                    <div class="setting-row">
                      <label>Velocity Multiplier</label>
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumRelease?.velocityMultiplier ?? 1.0}" step="0.1" min="0.1" max="2"
                        @change=${(e: Event) => this.updateConfig('strummer.strumRelease.velocityMultiplier', (e.target as HTMLInputElement).value)}></sp-number-field>
                    </div>
                  </div>
                </dashboard-panel>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Tablet Buttons Section (Collapsible) -->
        <div class="visualizer-section">
          <button class="section-header" @click=${this.toggleTabletButtons}>
            <span class="section-title">Tablet Buttons</span>
            <span class="section-toggle">${this.tabletButtonsExpanded ? '▼' : '▶'}</span>
          </button>
          ${this.tabletButtonsExpanded ? html`
            <div class="section-content">
              <div class="tablet-buttons-grid">
                <dashboard-panel title="Tablet Buttons Configuration" size="wide" .draggable=${false} .minimizable=${false}>
                  <tablet-buttons-config
                    .config=${this.getTabletButtonsConfig()}
                    .pressedButtons=${this.pressedButtons}
                    @config-change=${this.handleTabletButtonsConfigChange}
                  ></tablet-buttons-config>
                </dashboard-panel>
              </div>
            </div>
          ` : ''}
        </div>
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketchatone-dashboard': SketchatoneDashboard;
  }
}
