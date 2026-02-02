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
  private websocketUrl = typeof window !== 'undefined'
    ? `ws://${window.location.hostname}:8081`
    : 'ws://localhost:8081';

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
  private serverMidiNotes: NoteObject[] = [];

  @state()
  private lastMidiPortName: string | null = null;

  // Version info
  @state()
  private serverVersion: string | null = null;

  // UI version injected at build time
  private readonly uiVersion = __UI_VERSION__;

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
        this.serverVersion = null;
      }
    });

    this.wsClient.onConfig((config: ServerConfigData) => {
      this.websocketServerInfo = `${config.notes?.length ?? 0} strings`;
      this.strummerConfig = config;
      this.serverVersion = config.serverVersion ?? null;
    });

    this.wsClient.onCombinedEvent((data: CombinedEventData) => {
      this.handleTabletData(data);
    });

    // Listen for server MIDI input status (sent on connect)
    this.wsClient.onMidiInputStatus((status: ServerMidiInputStatus) => {
      this.serverMidiConnected = status.connected;
      this.serverMidiNotes = status.currentNotes.map((n) => Note.parseNotation(n));
    });

    // Listen for server MIDI input events (notes changed)
    this.wsClient.onMidiInput((event: ServerMidiInputEvent) => {
      this.serverMidiNotes = event.notes.map((n) => Note.parseNotation(n));
      this.lastMidiPortName = event.portName ?? null;
      this.serverMidiConnected = true;
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

  /**
   * Export configuration as a downloadable JSON file
   */
  private handleExportConfig(): void {
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
   * Save configuration to the server's config file
   */
  private handleSaveConfig(): void {
    this.wsClient.saveConfig();
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
    // @ts-ignore
    return TabletButtonsConfig.fromDict(this.fullConfig.strummer.tabletButtons);
  }

  render() {
    const hasActiveConnection = this.websocketConnected;

    return html`
      <div class="dashboard">
        <!-- Header -->
        <div class="dashboard-header">
          <div class="header-logo-container">
            <svg class="header-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150">
              <rect class="logo-bg" y="0" width="400" height="150" rx="10" ry="10"/>
              <g>
                <path class="logo-title" d="M101.37,67.54c-.57-1.05-1.42-1.99-2.56-2.84-1.14-.84-2.42-1.52-3.85-2.03-1.42-.51-2.91-.89-4.46-1.15-4.6-.68-8.9-2.18-12.89-4.48-.34-.18-.71-.57-1.09-1.16-.39-.59-.58-1.16-.58-1.71,0-2,.34-4.02,1.01-6.03.67-2.02,1.53-3.59,2.58-4.73,1.69-1.89,4.72-3.54,9.11-4.96,4.39-1.41,9.33-2.12,14.82-2.12,3.28,0,5.82.25,7.6.75,1.79.5,2.68,1.28,2.68,2.32,0,1.71-.23,3.03-.7,3.96s-.97,1.55-1.5,1.86c-.54.31-1.48.72-2.82,1.25-1.44.5-2.68,1.03-3.74,1.57s-1.97,1.07-2.72,1.57c-.75.5-1.22.75-1.4.75-.23,0-.34-.09-.34-.27,0-.39.4-.97,1.21-1.76.81-.79,1.81-1.47,2.99-2.07,1.25-.66,1.88-1.08,1.88-1.26,0-.3-.7-.44-2.08-.44-4.22,0-8.11.38-11.69,1.13-3.58.75-6.4,1.74-8.46,2.97-2.06,1.23-3.09,2.48-3.09,3.76,0,.8.43,1.36,1.28,1.69s2.74.88,5.66,1.66c2.92.78,5.53,1.66,7.83,2.67,3.3,1.41,5.75,2.88,7.35,4.41,1.59,1.53,2.39,3.24,2.39,5.13,0,1.3-.31,2.6-.94,3.91-.63,1.31-1.54,2.51-2.75,3.61-1.21,1.09-2.6,1.99-4.17,2.7-1.34.57-3.04,1.1-5.08,1.61-2.04.5-4.25.89-6.63,1.18-2.38.28-4.65.43-6.82.43-3.99,0-7.19-.38-9.62-1.13s-3.64-1.89-3.64-3.42c0-.68.41-1.75,1.23-3.2s1.79-2.42,2.91-2.92c.98-.39,1.93-.61,2.84-.67.91-.06,1.37.05,1.37.33,0,.07-.03.14-.1.21s-.15.13-.24.17c-.09.05-.18.09-.27.14-.46.18-.83.32-1.11.43-.29.1-.51.21-.68.31-.17.1-.26.25-.26.43,0,.48,2.36.72,7.08.72,4.1,0,7.46-.15,10.08-.44,2.62-.3,4.93-.83,6.94-1.61,2-.77,3.83-1.85,5.47-3.21Z"/>
                <path class="logo-title" d="M136.99,66.65v2.29c-2.55,2.99-4.69,5.25-6.43,6.79-1.73,1.54-3.18,2.31-4.34,2.31s-2.12-.33-3.02-.99c-.9-.66-1.71-1.57-2.43-2.73s-1.57-2.78-2.55-4.85c-1.16,1.44-2.21,2.77-3.14,4.02-.93,1.24-1.58,2.07-1.95,2.48-.36.41-.7.62-.99.62-.62,0-1.06-.39-1.33-1.18-.27-.79-.41-1.93-.41-3.44,0-2.05.25-4.03.73-5.93s1.2-3.75,2.12-5.55c.92-1.8,2.11-3.74,3.55-5.83,1.45-2.08,3.07-4.27,4.87-6.54,2.48-3.14,4.63-5.71,6.43-7.71,1.8-1.99,3.37-3.5,4.7-4.51s2.44-1.52,3.33-1.52c1.09,0,1.64.49,1.64,1.47,0,.84-2.02,3.88-6.05,9.11-4.03,5.23-9.91,12.37-17.64,21.41v2.94c5.17-5.54,9.34-9.65,12.49-12.34,3.16-2.69,5.6-4.03,7.33-4.03.71,0,1.25.42,1.64,1.25.39.83.58,1.79.58,2.89,0,2.23-.96,4.3-2.87,6.2-1.91,1.9-4.85,4.08-8.82,6.55.68,1.03,1.29,1.77,1.81,2.24.52.47,1.18.7,1.98.7.71,0,1.47-.24,2.29-.72s1.66-1.08,2.51-1.81c.85-.73,2.17-1.91,3.95-3.55ZM123.49,68.39c.87-.57,1.94-1.45,3.23-2.65,1.29-1.2,2.39-2.44,3.3-3.73.91-1.29,1.37-2.36,1.37-3.23,0-.36-.16-.55-.48-.55-.87,0-2.35.83-4.46,2.5-2.11,1.66-4.16,3.79-6.17,6.39.87,0,1.94.42,3.21,1.26Z"/>
                <path class="logo-title" d="M142.25,67.88v.85c0,1.34.33,2.39.99,3.14.66.75,1.53,1.13,2.6,1.13s2.27-.26,3.47-.79c1.2-.52,2.39-1.22,3.57-2.08,1.18-.87,2.63-2.03,4.34-3.49v2.08c-2.58,3.1-4.99,5.47-7.25,7.13-2.26,1.65-4.55,2.48-6.87,2.48-2.03,0-3.63-.79-4.82-2.36-1.19-1.57-1.78-3.73-1.78-6.46,0-2.39.56-4.56,1.67-6.51,1.12-1.95,2.94-4,5.47-6.17,1.73-1.48,3.45-2.6,5.16-3.35s3.24-1.13,4.58-1.13c1.07,0,1.92.25,2.55.74.63.49.94,1.22.94,2.2,0,1.44-.54,2.87-1.61,4.29-1.07,1.42-2.71,2.84-4.9,4.24-2.2,1.4-4.9,2.75-8.12,4.05ZM142.6,65.66c2.05-.8,3.81-1.79,5.26-2.97,1.46-1.18,2.53-2.32,3.23-3.4.69-1.08,1.04-1.87,1.04-2.38s-.24-.79-.72-.79c-.41,0-1.08.26-2,.79-.92.52-1.86,1.21-2.8,2.05-.95.84-1.79,1.83-2.55,2.97-.75,1.14-1.24,2.38-1.47,3.73Z"/>
                <path class="logo-title" d="M169.22,48.91h1.47c1.21-2.16,2.3-3.7,3.28-4.6.98-.9,2.1-1.35,3.35-1.35s1.88.29,1.88.85c0,.27-.49,1.01-1.47,2.22-.98,1.21-1.72,2.22-2.22,3.04.77.09,1.46.17,2.07.24.6.07,1.08.13,1.42.17-1.3,2.42-2.93,4.89-4.89,7.42-.64-.04-1.17-.09-1.61-.12-.43-.04-.87-.07-1.32-.1-.44-.03-.99-.07-1.62-.12-1.23,1.98-2.26,3.75-3.09,5.31-.83,1.56-1.47,2.99-1.91,4.29s-.67,2.53-.67,3.69c0,1.57.63,2.36,1.88,2.36.87,0,2-.46,3.4-1.38,1.4-.92,3.28-2.34,5.62-4.25v2.29c-6.15,6.68-10.7,10.02-13.64,10.02-1.03,0-1.85-.4-2.48-1.2-.63-.8-.94-1.82-.94-3.08,0-.84.18-1.85.53-3.01.35-1.16.99-2.92,1.9-5.26-.32.27-.62.54-.91.8-.29.26-.55.5-.79.72s-.5.44-.77.68c-.27.24-.55.48-.82.73v-2.36c2.39-2,5.29-5.53,8.68-10.56-.34-.02-.66-.04-.96-.05-.3-.01-.65-.02-1.06-.02-1.34,0-2.35.09-3.01.27-.27.07-.53.14-.77.22s-.4.12-.5.12-.14-.07-.14-.21c0-.75.47-1.88,1.4-3.38.75-1.28,1.46-2.22,2.14-2.84.67-.62,1.49-1.03,2.46-1.25.97-.22,2.33-.32,4.08-.32Z"/>
                <path class="logo-title" d="M195.3,66.72v2.29c-2.44,2.39-4.43,4.25-5.96,5.57-1.54,1.32-2.97,2.35-4.31,3.08s-2.64,1.09-3.91,1.09-2.4-.5-3.45-1.49c-1.05-.99-1.87-2.29-2.46-3.9-.59-1.61-.89-3.31-.89-5.11,0-1.55.34-2.93,1.03-4.14.68-1.21,2-2.77,3.96-4.68,2.32-2.28,4.48-4.04,6.48-5.28,1.99-1.24,3.56-1.86,4.7-1.86.82,0,1.52.29,2.08.85.57.57.85,1.29.85,2.15,0,.73-.38,1.77-1.13,3.11-.75,1.34-1.6,2.51-2.53,3.5-.93.99-1.67,1.49-2.22,1.49-.59,0-.89-.32-.89-.96.02-.18.04-.35.05-.51.01-.16.02-.32.02-.48,0-.27-.1-.43-.29-.46-.19-.03-.43.05-.7.26-2.28,1.6-3.84,2.72-4.68,3.37-.84.65-1.51,1.31-2,1.97-.49.66-.73,1.36-.73,2.08,0,1.34.43,2.44,1.3,3.28.87.84,1.99,1.26,3.38,1.26s3.16-.55,5.18-1.66,4.39-2.72,7.13-4.84Z"/>
                <path class="logo-title" d="M220.73,66.65v2.15c-1.98,2.03-3.7,3.69-5.14,4.97-1.45,1.29-2.71,2.26-3.79,2.92-1.08.66-2,.99-2.75.99-1.78,0-2.67-1.05-2.67-3.15,0-1.69.55-3.64,1.66-5.86,1.1-2.22,2.69-4.84,4.77-7.84-1.03.57-1.99,1.23-2.91,1.97-.91.74-1.72,1.52-2.43,2.32-.71.81-1.3,1.5-1.78,2.07-1.48,1.66-2.91,3.37-4.27,5.11-1.37,1.74-2.29,2.88-2.77,3.4-.48.52-.93.79-1.37.79-1.78,0-2.67-2.19-2.67-6.56,0-1.44.22-3.02.65-4.75.43-1.73,1.59-4.02,3.49-6.87,3.99-5.97,7.4-10.85,10.24-14.65,2.84-3.79,5.19-6.67,7.06-8.61,1.87-1.95,3.12-2.9,3.76-2.85.8.07,1.44.23,1.93.48.49.25.73.54.73.85,0,.57-.39,1.51-1.18,2.82s-2.14,3.36-4.05,6.13c-2.07,2.94-3.54,5.01-4.41,6.2-.87,1.2-2.16,2.89-3.88,5.09s-3.29,4.16-4.72,5.88-3.05,3.58-4.87,5.59v4.1c3.05-3.39,5.7-6.17,7.93-8.34,2.23-2.16,4.12-3.8,5.67-4.9,1.55-1.11,2.69-1.66,3.42-1.66.68,0,1.32.41,1.91,1.21.59.81.89,1.48.89,2,0,.23-.11.51-.34.85-1.64,1.96-2.95,3.58-3.91,4.87-.97,1.29-1.71,2.44-2.24,3.45-.52,1.01-.79,1.89-.79,2.61,0,1.07.51,1.61,1.54,1.61,1.09,0,3.52-1.47,7.28-4.41Z"/>
                <path class="logo-title" d="M224.73,60.53c3.46-3.14,6.82-5.48,10.08-7.01,3.26-1.53,5.78-2.29,7.55-2.29.48,0,.92.2,1.33.6.41.4.73.86.97,1.38.24.52.36.91.36,1.16,0,.41-.16.71-.48.91-.32.19-.88.43-1.67.7.16.37.36.83.62,1.4.25.57.44,1.03.58,1.38s.21.67.21.94c0,.55-.55,1.57-1.66,3.06-1.11,1.49-1.88,2.59-2.32,3.3-.44.71-.67,1.57-.67,2.6,0,1.69.78,2.53,2.32,2.53s4.09-1.49,7.49-4.48v2.08c-5.77,6.4-9.89,9.6-12.37,9.6-.89,0-1.52-.29-1.9-.87-.38-.58-.56-1.44-.56-2.58,0-1.8.65-4.41,1.95-7.83-3.33,3.69-5.8,6.32-7.42,7.88-1.62,1.56-2.95,2.34-4,2.34-.5,0-1.13-.43-1.88-1.3-.75-.87-1.42-1.99-2-3.37-.58-1.38-.87-2.81-.87-4.29,0-1.07.1-1.96.31-2.68.21-.72.6-1.45,1.2-2.2.59-.75,1.54-1.74,2.84-2.97ZM241.1,56.77c-5.93,2.71-10.15,5.01-12.66,6.9-2.52,1.89-3.78,3.84-3.78,5.84,0,.73.12,1.33.38,1.79.25.47.59.7,1.03.7.25,0,.69-.16,1.33-.48,2.39-1.41,4.58-3.25,6.56-5.52s4.36-5.35,7.14-9.25Z"/>
                <path class="logo-title" d="M261.13,48.91h1.47c1.21-2.16,2.3-3.7,3.28-4.6.98-.9,2.1-1.35,3.35-1.35s1.88.29,1.88.85c0,.27-.49,1.01-1.47,2.22-.98,1.21-1.72,2.22-2.22,3.04.77.09,1.46.17,2.07.24.6.07,1.08.13,1.42.17-1.3,2.42-2.93,4.89-4.89,7.42-.64-.04-1.17-.09-1.61-.12-.43-.04-.87-.07-1.32-.1-.44-.03-.99-.07-1.62-.12-1.23,1.98-2.26,3.75-3.09,5.31-.83,1.56-1.47,2.99-1.91,4.29s-.67,2.53-.67,3.69c0,1.57.63,2.36,1.88,2.36.87,0,2-.46,3.4-1.38,1.4-.92,3.28-2.34,5.62-4.25v2.29c-6.15,6.68-10.7,10.02-13.64,10.02-1.03,0-1.85-.4-2.48-1.2s-.94-1.82-.94-3.08c0-.84.18-1.85.53-3.01s.99-2.92,1.9-5.26c-.32.27-.62.54-.91.8-.29.26-.55.5-.79.72s-.5.44-.77.68c-.27.24-.55.48-.82.73v-2.36c2.39-2,5.29-5.53,8.68-10.56-.34-.02-.66-.04-.96-.05-.3-.01-.65-.02-1.06-.02-1.35,0-2.35.09-3.01.27-.27.07-.53.14-.77.22s-.4.12-.5.12-.14-.07-.14-.21c0-.75.47-1.88,1.4-3.38.75-1.28,1.46-2.22,2.14-2.84.67-.62,1.49-1.03,2.46-1.25.97-.22,2.33-.32,4.08-.32Z"/>
                <path class="logo-title" d="M288.61,66.58v2.29c-1.5,1.37-2.71,2.28-3.62,2.73s-2.22.64-3.93.55c-2.96,3.51-5.57,5.26-7.83,5.26-1.28,0-2.44-.42-3.49-1.26-1.05-.84-1.89-1.99-2.51-3.45-.63-1.46-.94-3.09-.94-4.89,0-1.46.48-3.08,1.45-4.85s2.22-3.43,3.76-4.97c1.54-1.54,3.18-2.78,4.94-3.72,1.75-.95,3.38-1.42,4.89-1.42,1.07,0,1.91.17,2.53.5.62.33.92.79.92,1.38,0,.46-.26.98-.79,1.57.87.18,1.46.48,1.78.91.32.42.48,1.19.48,2.31s-.26,2.47-.77,4.14c-.51,1.66-1.21,3.22-2.1,4.68l.62.62h.51c.39,0,.77-.1,1.14-.29.38-.19.71-.4,1.01-.62.3-.22.95-.7,1.95-1.45ZM281.57,57.59c-1.89,1.14-3.51,2.17-4.85,3.09-1.35.92-2.48,1.86-3.42,2.8-.94.95-1.56,1.9-1.88,2.85-.57,2.55-.85,3.93-.85,4.14,0,1.5,1.05,2.26,3.14,2.26.98,0,2.62-.84,4.92-2.53-.39-1.07-.58-2.1-.58-3.08,0-1.44.3-2.9.89-4.39.59-1.49,1.47-3.21,2.63-5.14Z"/>
                <path class="logo-title" d="M311.58,60.46c-4.01,4.47-6.02,7.58-6.02,9.33,0,.98.4,1.47,1.2,1.47.66,0,1.52-.35,2.58-1.04,1.06-.69,2.72-1.93,4.97-3.71v2.36c-3.24,3.19-5.72,5.49-7.45,6.9-1.73,1.41-3.14,2.12-4.24,2.12-1.87,0-2.8-1.23-2.8-3.69,0-.73.11-1.45.34-2.15.23-.71.54-1.44.94-2.2s1.01-1.86,1.83-3.28,1.77-3.04,2.84-4.84c-1.3.66-2.93,1.97-4.89,3.93-1.28,1.23-2.36,2.4-3.25,3.5s-1.84,2.34-2.85,3.69c-1.01,1.36-1.75,2.27-2.22,2.73-.47.47-.94.7-1.42.7-.73,0-1.4-.76-2.02-2.29-.62-1.53-.92-3.3-.92-5.33,0-1.25.14-2.23.43-2.94.28-.71.85-1.71,1.69-3.01,1.57-2.42,2.93-4.19,4.07-5.31,1.14-1.13,2.23-1.69,3.28-1.69.73,0,1.32.13,1.76.38.44.25.67.64.67,1.16,0,.23-.07.47-.21.72-.14.25-.29.48-.46.68s-.53.6-1.08,1.2c-3.6,3.99-5.4,6.57-5.4,7.76,0,.66.22.99.65.99.27,0,.8-.44,1.59-1.32.79-.88,1.8-2.03,3.04-3.45s2.71-2.91,4.41-4.46c1.7-1.55,3.63-3.04,5.79-4.48,1.21-.84,2.21-1.26,3.01-1.26.36,0,.72.5,1.08,1.5.35,1,.53,2.02.53,3.04,0,.5-.49,1.26-1.47,2.29Z"/>
                <path class="logo-title" d="M319.58,67.88v.85c0,1.34.33,2.39.99,3.14.66.75,1.53,1.13,2.6,1.13s2.27-.26,3.47-.79c1.2-.52,2.39-1.22,3.57-2.08,1.19-.87,2.63-2.03,4.34-3.49v2.08c-2.58,3.1-4.99,5.47-7.25,7.13-2.26,1.65-4.55,2.48-6.87,2.48-2.03,0-3.63-.79-4.82-2.36-1.19-1.57-1.78-3.73-1.78-6.46,0-2.39.56-4.56,1.67-6.51,1.12-1.95,2.94-4,5.47-6.17,1.73-1.48,3.45-2.6,5.16-3.35s3.23-1.13,4.58-1.13c1.07,0,1.92.25,2.55.74.63.49.94,1.22.94,2.2,0,1.44-.54,2.87-1.61,4.29-1.07,1.42-2.71,2.84-4.9,4.24-2.2,1.4-4.9,2.75-8.12,4.05ZM319.92,65.66c2.05-.8,3.8-1.79,5.26-2.97,1.46-1.18,2.53-2.32,3.23-3.4.69-1.08,1.04-1.87,1.04-2.38s-.24-.79-.72-.79c-.41,0-1.08.26-2,.79-.92.52-1.86,1.21-2.8,2.05-.95.84-1.79,1.83-2.55,2.97-.75,1.14-1.24,2.38-1.47,3.73Z"/>
              </g>
              <path class="logo-line" fill="none" stroke-width="4" d="M50,89.5c100,6.67,200,6.67,300,0"/>
              <g>
                <path class="logo-subtitle" d="M40.52,123.74h-2.41l-.27,1.44h-2.81l2.7-12.6h3.17l2.7,12.6h-2.81l-.27-1.44ZM40.11,121.4l-.74-4.01-.05-.45-.05.45-.74,4.01h1.58Z"/>
                <path class="logo-subtitle" d="M52.91,116.72v6.16s.02.05.05.05h1.24s.05-.02.05-.05v-6.16h2.43v8.46h-2.39v-.83h-.04c-.13.56-.76.86-1.4.86h-.47c-1.21,0-1.91-.68-1.91-1.91v-6.59h2.43Z"/>
                <path class="logo-subtitle" d="M66.53,125.18c-1.03,0-1.73-.7-1.73-1.73v-4.48h-1.26v-2.25h1.26v-2.52h2.43v2.52h1.62v2.25h-1.62v3.91s.02.05.05.05h1.57v2.25h-2.32Z"/>
                <path class="logo-subtitle" d="M80.28,125.22h-2.75c-1.06,0-1.73-.7-1.73-1.73v-5.08c0-1.06.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v5.08c0,1.03-.7,1.73-1.73,1.73ZM79.53,118.97h-1.24s-.05.02-.05.05v3.85s.02.05.05.05h1.24s.05-.02.05-.05v-3.85s-.02-.05-.05-.05Z"/>
                <path class="logo-subtitle" d="M96.43,125.18v-6.16s-.02-.05-.05-.05h-.97s-.05.02-.05.05v6.16h-2.43v-6.16s-.02-.05-.05-.05h-.97s-.05.02-.05.05v6.16h-2.43v-8.46h2.39v.83h.04c.13-.56.76-.86,1.4-.86h.52c.63,0,1.26.31,1.39.86h.04c.13-.56.74-.86,1.39-.86h.56c1.06,0,1.73.72,1.73,1.76v6.73h-2.43Z"/>
                <path class="logo-subtitle" d="M109.97,125.18v-.68h-.04c-.14.49-.65.72-1.26.72h-.65c-1.17,0-1.87-.67-1.87-1.84v-1.6c0-1.28.67-1.82,1.82-1.82h.7c.61,0,1.12.2,1.26.68h.04l-.04-.68v-.94s-.02-.05-.05-.05h-3.12v-2.25h3.78c1.17,0,1.82.65,1.82,1.82v6.64h-2.4ZM109.88,121.58h-1.24s-.05.02-.05.05v1.42s.02.05.05.05h1.24s.05-.02.05-.05v-1.42s-.02-.05-.05-.05Z"/>
                <path class="logo-subtitle" d="M122.21,125.18c-1.03,0-1.73-.7-1.73-1.73v-4.48h-1.26v-2.25h1.26v-2.52h2.43v2.52h1.62v2.25h-1.62v3.91s.02.05.05.05h1.57v2.25h-2.32Z"/>
                <path class="logo-subtitle" d="M133.91,121.94v.94s.02.05.05.05h3.13v2.25h-3.89c-1.06,0-1.73-.7-1.73-1.73v-5.04c0-1.03.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v3.53h-3.78ZM135.26,118.84s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v1.48h1.35v-1.48Z"/>
                <path class="logo-subtitle" d="M148.88,125.18v-.83h-.04c-.13.56-.76.86-1.4.86h-.65c-1.03,0-1.73-.68-1.73-1.62v-5.29c0-.94.7-1.62,1.73-1.62h.65c.65,0,1.28.31,1.4.86h.04l-.04-.83v-4.14h2.43v12.6h-2.39ZM148.85,122.87v-3.85s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v3.85s.02.05.05.05h1.24s.05-.02.05-.05Z"/>
                <path class="logo-subtitle" d="M172.7,121.45l-3.73-3.67c-.43-.43-.72-1.08-.72-1.89v-1.44c0-1.13.76-1.91,1.91-1.91h3.38c1.13,0,1.91.77,1.91,1.91v2.18h-2.7v-1.48s-.02-.05-.05-.05h-1.69s-.05.02-.05.05v.77c0,.05.02.09.05.13l3.73,3.67c.43.43.72,1.08.72,1.89v1.69c0,1.13-.77,1.91-1.91,1.91h-3.38c-1.15,0-1.91-.77-1.91-1.91v-2.18h2.7v1.48s.02.05.05.05h1.69s.05-.02.05-.05v-1.03c0-.05-.02-.09-.05-.13Z"/>
                <path class="logo-subtitle" d="M187.33,125.22h-2.75c-1.06,0-1.73-.7-1.73-1.73v-5.08c0-1.03.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v1.94h-2.43v-1.33s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v3.85s.02.05.05.05h1.24s.05-.02.05-.05v-1.33h2.43v1.94c0,1.03-.7,1.73-1.73,1.73Z"/>
                <path class="logo-subtitle" d="M198.92,118.97s-.05.02-.05.05v6.16h-2.43v-8.46h2.39v.83h.04c.13-.56.76-.86,1.4-.86h.76v2.29h-2.11Z"/>
                <path class="logo-subtitle" d="M207.63,114.63c0-.79.67-1.46,1.46-1.46s1.46.67,1.46,1.46-.65,1.48-1.46,1.48-1.46-.67-1.46-1.48ZM207.88,125.18v-8.46h2.43v8.46h-2.43Z"/>
                <path class="logo-subtitle" d="M217.71,125.18v-12.6h2.43v4.14l-.04.83h.04c.13-.56.76-.86,1.4-.86h.65c1.03,0,1.73.68,1.73,1.73v5.08c0,1.04-.7,1.73-1.73,1.73h-.65c-.65,0-1.28-.31-1.4-.86h-.04v.83h-2.39ZM221.49,122.87v-3.85s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v3.85s.02.05.05.05h1.24s.05-.02.05-.05Z"/>
                <path class="logo-subtitle" d="M233.73,121.94v.94s.02.05.05.05h3.13v2.25h-3.89c-1.06,0-1.73-.7-1.73-1.73v-5.04c0-1.03.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v3.53h-3.78ZM235.08,118.84s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v1.48h1.35v-1.48Z"/>
                <path class="logo-subtitle" d="M244.44,122.06v-2.25h4.61v2.25h-4.61Z"/>
                <path class="logo-subtitle" d="M255.98,125.18v-12.6h2.7v12.6h-2.7Z"/>
                <path class="logo-subtitle" d="M269.84,125.18v-6.16s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v6.16h-2.43v-8.46h2.39v.83h.04c.13-.56.76-.86,1.4-.86h.65c1.03,0,1.73.68,1.73,1.73v6.77h-2.43Z"/>
                <path class="logo-subtitle" d="M284.15,125.22h-2.75c-1.06,0-1.73-.7-1.73-1.73v-1.19h2.43v.76s.02.05.05.05h1.24s.05-.02.05-.05v-.67s-.04-.07-.07-.09l-2.45-1.15c-.85-.4-1.26-.9-1.26-1.73v-1.01c0-1.03.67-1.73,1.73-1.73h2.75c1.03,0,1.73.67,1.73,1.73v1.1h-2.43v-.67s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v.52c0,.05.04.09.07.11l2.23,1.04c.99.47,1.48.97,1.48,1.76v1.21c0,1.03-.7,1.73-1.73,1.73Z"/>
                <path class="logo-subtitle" d="M295.72,125.18c-1.03,0-1.73-.7-1.73-1.73v-4.48h-1.26v-2.25h1.26v-2.52h2.43v2.52h1.62v2.25h-1.62v3.91s.02.05.05.05h1.57v2.25h-2.32Z"/>
                <path class="logo-subtitle" d="M307.48,118.97s-.05.02-.05.05v6.16h-2.43v-8.46h2.39v.83h.04c.13-.56.76-.86,1.4-.86h.76v2.29h-2.11Z"/>
                <path class="logo-subtitle" d="M318.87,116.72v6.16s.02.05.05.05h1.24s.05-.02.05-.05v-6.16h2.43v8.46h-2.39v-.83h-.04c-.13.56-.76.86-1.4.86h-.47c-1.21,0-1.91-.68-1.91-1.91v-6.59h2.43Z"/>
                <path class="logo-subtitle" d="M337.07,125.18v-6.16s-.02-.05-.05-.05h-.97s-.05.02-.05.05v6.16h-2.43v-6.16s-.02-.05-.05-.05h-.97s-.05.02-.05.05v6.16h-2.43v-8.46h2.39v.83h.04c.13-.56.76-.86,1.4-.86h.52c.63,0,1.26.31,1.39.86h.04c.13-.56.74-.86,1.39-.86h.56c1.06,0,1.73.72,1.73,1.76v6.73h-2.43Z"/>
                <path class="logo-subtitle" d="M349.31,121.94v.94s.02.05.05.05h3.13v2.25h-3.89c-1.06,0-1.73-.7-1.73-1.73v-5.04c0-1.03.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v3.53h-3.78ZM350.66,118.84s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v1.48h1.35v-1.48Z"/>
                <path class="logo-subtitle" d="M364.25,125.18v-6.16s-.02-.05-.05-.05h-1.24s-.05.02-.05.05v6.16h-2.43v-8.46h2.39v.83h.04c.13-.56.76-.86,1.4-.86h.65c1.03,0,1.73.68,1.73,1.73v6.77h-2.43Z"/>
                <path class="logo-subtitle" d="M376.53,125.18c-1.03,0-1.73-.7-1.73-1.73v-4.48h-1.26v-2.25h1.26v-2.52h2.43v2.52h1.62v2.25h-1.62v3.91s.02.05.05.05h1.57v2.25h-2.32Z"/>
              </g>
            </svg>
          </div>
          <div class="header-content">
            <div class="header-row">
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
                <sp-button data-spectrum-pattern="button-primary-s" size="s" variant="primary" ?disabled=${!this.websocketConnected} @click=${this.handleSaveConfig}>
                  Save Configuration
                </sp-button>
                <sp-button data-spectrum-pattern="button-secondary-s" size="s" variant="secondary" ?disabled=${!this.fullConfig} @click=${this.handleExportConfig}>
                  Export Configuration
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
            <div class="version-info">
              <span class="version-label">UI: v${this.uiVersion}</span>
              ${this.serverVersion ? html`<span class="version-label">Server: v${this.serverVersion}</span>` : ''}
            </div>
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
                      ${this.serverMidiConnected ? 'connected' : 'disconnected'}
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
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumming?.midiChannel ?? 1}" step="1" min="1" max="16"
                        @change=${(e: Event) => this.updateConfig('strummer.strumming.midiChannel', Number((e.target as HTMLInputElement).value))}></sp-number-field>
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
                      <sp-number-field data-spectrum-pattern="number-field-s" value="${this.fullConfig?.strummer?.strumRelease?.midiChannel ?? 10}" step="1" min="1" max="16"
                        @change=${(e: Event) => this.updateConfig('strummer.strumRelease.midiChannel', Number((e.target as HTMLInputElement).value))}></sp-number-field>
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
