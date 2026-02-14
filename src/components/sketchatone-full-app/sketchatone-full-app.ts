/**
 * Sketchatone Full Web App
 * Complete self-contained web app combining WebHID tablet input with WebMIDI output
 * for the Sketchatone strummer functionality.
 */

import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styles } from './sketchatone-full-app.styles.js';

// Spectrum components
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/number-field/sp-number-field.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-link.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-link-off.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-light.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-moon.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-folder-open.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-download.js';

// Blankslate visualizer components
import 'blankslate/components/tablet-visualizer/tablet-visualizer.js';

// Blankslate managers
import {
  WebHIDManager,
  normalizeTabletData,
  formatValue,
  processDeviceData,
  Config,
  type TabletData,
  type ConfigData,
} from 'blankslate';

// Strum visualizer components
import '../strum-visualizers/curve-visualizer.js';
import '../strum-visualizers/dashboard-panel.js';
import '../strum-visualizers/strum-visualizer.js';
import '../strum-visualizers/strum-events-display.js';

// Tablet buttons config component
import '../tablet-buttons-config/tablet-buttons-config.js';

// Core strummer
import { Strummer, type StrummerEvent, type StrumEvent, type ReleaseEvent } from '../../core/strummer.js';

// Models
import { Note, type NoteObject } from '../../models/note.js';
import { StrummerConfig, type StrummerConfigData } from '../../models/strummer-config.js';
import { ParameterMapping } from '../../models/parameter-mapping.js';
import { TabletButtonsConfig } from '../../models/strummer-features.js';

// MIDI input (for external keyboards)
import { WebMidiInput, MIDI_NOTE_EVENT, type MidiNoteEvent } from '../../utils/web-midi-input.js';

// Shared tablet interaction controller
import { sharedTabletInteraction } from '../../controllers/index.js';

// Types
import type { StrumTabletEvent } from '../strum-visualizers/strum-events-display.js';
import type { StrumNoteEventData } from '../../types/tablet-events.js';

/**
 * WebMIDI Output class for sending MIDI notes
 */
class WebMidiOutput {
  private midiAccess: MIDIAccess | null = null;
  private midiOut: MIDIOutput | null = null;
  private _isConnected = false;
  private _channel: number;
  private activeNoteTimers: Map<string, number> = new Map();

  constructor(channel: number = 0) {
    this._channel = channel;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get channel(): number {
    return this._channel;
  }

  set channel(value: number) {
    this._channel = Math.max(0, Math.min(15, value));
  }

  get currentOutputName(): string | null {
    return this.midiOut?.name ?? null;
  }

  static isSupported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  async getAvailableOutputs(): Promise<Array<{ id: string; name: string }>> {
    if (!WebMidiOutput.isSupported()) return [];
    try {
      if (!this.midiAccess) {
        this.midiAccess = await navigator.requestMIDIAccess();
      }
      return Array.from(this.midiAccess.outputs.values()).map(o => ({
        id: o.id,
        name: o.name ?? 'Unknown'
      }));
    } catch {
      return [];
    }
  }

  async connect(outputId?: string): Promise<boolean> {
    if (!WebMidiOutput.isSupported()) return false;
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      const outputs = Array.from(this.midiAccess.outputs.values());
      if (outputs.length === 0) return false;

      if (outputId) {
        this.midiOut = outputs.find(o => o.id === outputId || o.name === outputId) ?? outputs[0];
      } else {
        this.midiOut = outputs[0];
      }
      this._isConnected = true;
      console.log(`[WebMidiOutput] Connected to: ${this.midiOut.name}`);
      return true;
    } catch (error) {
      console.error('[WebMidiOutput] Failed to connect:', error);
      return false;
    }
  }

  disconnect(): void {
    for (const timer of this.activeNoteTimers.values()) {
      window.clearTimeout(timer);
    }
    this.activeNoteTimers.clear();
    this._isConnected = false;
    this.midiOut = null;
  }

  sendNote(note: NoteObject, velocity: number, duration: number = 1.5): void {
    if (!this.midiOut) return;
    const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
    const noteKey = `${midiNote}-${this._channel}`;

    // Cancel existing timer
    const oldTimer = this.activeNoteTimers.get(noteKey);
    if (oldTimer !== undefined) {
      window.clearTimeout(oldTimer);
      this.activeNoteTimers.delete(noteKey);
    }

    // Send note-on
    this.midiOut.send([0x90 + this._channel, midiNote, velocity]);

    // Schedule note-off
    const timer = window.setTimeout(() => {
      if (this.midiOut) {
        this.midiOut.send([0x80 + this._channel, midiNote, 0x40]);
      }
      this.activeNoteTimers.delete(noteKey);
    }, duration * 1000);
    this.activeNoteTimers.set(noteKey, timer);
  }

  releaseNotes(notes: NoteObject[]): void {
    if (!this.midiOut) return;
    for (const note of notes) {
      const midiNote = Note.notationToMidi(`${note.notation}${note.octave}`);
      const noteKey = `${midiNote}-${this._channel}`;
      const timer = this.activeNoteTimers.get(noteKey);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.activeNoteTimers.delete(noteKey);
      }
      this.midiOut.send([0x80 + this._channel, midiNote, 0x40]);
    }
  }

  sendPitchBend(bendValue: number): void {
    if (!this.midiOut) return;
    bendValue = Math.max(-1.0, Math.min(1.0, bendValue));
    let midiBend = Math.floor((bendValue + 1.0) * 8192);
    midiBend = Math.max(0, Math.min(16383, midiBend));
    const lsb = midiBend & 0x7F;
    const msb = (midiBend >> 7) & 0x7F;
    this.midiOut.send([0xE0 + this._channel, lsb, msb]);
  }

  releaseAll(): void {
    if (!this.midiOut) return;
    // All notes off on channel
    this.midiOut.send([0xB0 + this._channel, 123, 0]);
  }
}

/**
 * Sketchatone Full Web App Component
 */
@customElement('sketchatone-full-app')
export class SketchatoneFullApp extends LitElement {
  static styles = styles;

  @property({ type: String })
  themeColor: 'light' | 'dark' = 'light';

  // WebHID state
  @state() private hidConnected = false;
  @state() private hidDeviceName = '';
  @state() private tabletConfig: Config | null = null;

  // WebMIDI output state
  @state() private midiOutputConnected = false;
  @state() private midiOutputPorts: Array<{ id: string; name: string }> = [];
  @state() private selectedMidiOutput: string | null = null;

  // WebMIDI input state (external keyboard)
  @state() private midiInputConnected = false;
  @state() private midiInputNotes: NoteObject[] = [];

  // Strummer state
  @state() private strummerConfig: StrummerConfig = new StrummerConfig();
  @state() private strummerNotes: NoteObject[] = [];
  @state() private currentChord = 'C';

  // Visualization state
  @state() private tabletData: TabletData = {
    x: 0, y: 0, pressure: 0,
    tiltX: 0, tiltY: 0, tiltXY: 0,
    primaryButtonPressed: false,
    secondaryButtonPressed: false
  };
  @state() private pressedButtons: Set<number> = new Set();
  @state() private lastPressedButton: number | null = null;
  @state() private tabletEvents: StrumTabletEvent[] = [];
  @state() private lastStrumEvent: StrumEvent | null = null;
  @state() private packetCount = 0;

  // Collapsible sections
  @state() private strumVisualizersExpanded = true;
  @state() private tabletButtonsExpanded = false;
  @state() private tabletVisualizersExpanded = true;

  // Feature states
  @state() private transposeActive = false;
  @state() private repeaterActive = false;

  // Managers
  private hidManager = new WebHIDManager();
  private midiOutput = new WebMidiOutput();
  private midiInput = new WebMidiInput();
  private strummer = new Strummer();
  private activeNotes: NoteObject[] = [];

  connectedCallback() {
    super.connectedCallback();
    this.setupHIDManager();
    this.setupMidiInput();
    this.setupStrummer();
    this.initializeMidiOutput();
    this.updateStrummerNotes();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.hidManager.dispose();
    this.midiOutput.disconnect();
    this.midiInput.disconnect();
  }

  private setupHIDManager() {
    this.hidManager.on('connection-change', (state) => {
      this.hidConnected = state === 'connected';
      if (state === 'disconnected') {
        this.hidDeviceName = '';
        this.resetData();
      }
    });

    this.hidManager.on('device-info', (info) => {
      this.hidDeviceName = info.name;
    });

    this.hidManager.on('input-report', ({ bytes }) => {
      this.handleHIDData(bytes);
    });
  }

  private setupMidiInput() {
    this.midiInput.on(MIDI_NOTE_EVENT, (event: MidiNoteEvent) => {
      this.midiInputNotes = event.notes.map(n => Note.parseNotation(n));
      this.midiInputConnected = true;
    });
    // Auto-connect to first available input
    this.midiInput.connect();
  }

  private setupStrummer() {
    this.strummer.on('strum', (event: StrumEvent) => {
      this.handleStrumEvent(event);
    });
    this.strummer.on('release', (event: ReleaseEvent) => {
      this.handleReleaseEvent(event);
    });
  }

  private async initializeMidiOutput() {
    this.midiOutputPorts = await this.midiOutput.getAvailableOutputs();
    if (this.midiOutputPorts.length > 0) {
      await this.midiOutput.connect();
      this.midiOutputConnected = this.midiOutput.isConnected;
      this.selectedMidiOutput = this.midiOutput.currentOutputName;
    }
  }

  private handleHIDData(bytes: Uint8Array) {
    if (!this.tabletConfig) return;
    this.packetCount++;

    // Process raw bytes using config
    const processed = processDeviceData(bytes, this.tabletConfig);
    if (!processed) return;

    // Normalize tablet data
    this.tabletData = normalizeTabletData(processed);

    // Extract button states
    this.pressedButtons = this.extractButtonsFromData(processed);

    // Track last pressed button for display
    if (this.pressedButtons.size > 0) {
      this.lastPressedButton = Array.from(this.pressedButtons)[0];
    }

    // Update shared controller
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

    // Handle stylus button actions
    this.handleStylusButtons();

    // Handle tablet button actions
    this.handleTabletButtons();

    // Process strumming
    this.processStrumming();

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
      state: processed.state as string | undefined,
      // Include tablet hardware button states
      button1: Boolean(processed.button1),
      button2: Boolean(processed.button2),
      button3: Boolean(processed.button3),
      button4: Boolean(processed.button4),
      button5: Boolean(processed.button5),
      button6: Boolean(processed.button6),
      button7: Boolean(processed.button7),
      button8: Boolean(processed.button8),
    };

    if (this.lastStrumEvent) {
      // Convert StrumNoteData to StrumNoteEventData (add midiNote)
      const strumNotes: StrumNoteEventData[] = this.lastStrumEvent.notes.map(n => ({
        note: {
          notation: n.note.notation,
          octave: n.note.octave,
          midiNote: Note.notationToMidi(`${n.note.notation}${n.note.octave}`)
        },
        velocity: n.velocity
      }));
      event.strum = {
        type: 'strum',
        notes: strumNotes,
        velocity: this.lastStrumEvent.notes[0]?.velocity ?? 0,
        timestamp: Date.now() / 1000
      };
    }

    this.tabletEvents = [...this.tabletEvents, event].slice(-50);
  }

  private processStrumming() {
    // Calculate X position for strummer (0-1 range)
    const x = this.tabletData.x;
    const pressure = this.tabletData.pressure;

    // Process through strummer
    const event = this.strummer.strum(x, pressure);
    if (event) {
      if (event.type === 'strum') {
        this.handleStrumEvent(event);
      } else if (event.type === 'release') {
        this.handleReleaseEvent(event);
      }
    }

    // Send pitch bend based on Y position if configured
    if (this.midiOutput.isConnected && this.strummerConfig.pitchBend.control === 'yaxis') {
      const bendValue = this.strummerConfig.pitchBend.mapValue(this.tabletData.y);
      this.midiOutput.sendPitchBend(bendValue);
    }
  }

  private handleStrumEvent(event: StrumEvent) {
    this.lastStrumEvent = event;
    this.activeNotes = event.notes.map(n => n.note);

    if (!this.midiOutput.isConnected) return;

    // Calculate duration based on config
    let duration = this.strummerConfig.noteDuration.default;
    if (this.strummerConfig.noteDuration.control === 'tiltXY') {
      duration = this.strummerConfig.noteDuration.mapValue(Math.abs(this.tabletData.tiltXY));
    } else if (this.strummerConfig.noteDuration.control === 'pressure') {
      duration = this.strummerConfig.noteDuration.mapValue(this.tabletData.pressure);
    }

    // Send notes
    for (const noteData of event.notes) {
      let velocity = noteData.velocity;
      // Apply velocity mapping if configured
      if (this.strummerConfig.noteVelocity.control === 'pressure') {
        velocity = Math.round(this.strummerConfig.noteVelocity.mapValue(this.tabletData.pressure));
      }
      this.midiOutput.sendNote(noteData.note, velocity, duration);
    }
  }

  private handleReleaseEvent(_event: ReleaseEvent) {
    // Release active notes
    if (this.activeNotes.length > 0) {
      this.midiOutput.releaseNotes(this.activeNotes);
      this.activeNotes = [];
    }
    this.lastStrumEvent = null;
  }

  private handleStylusButtons() {
    const config = this.strummerConfig.stylusButtons;
    if (!config.active) return;

    // Handle primary button
    if (this.tabletData.primaryButtonPressed) {
      this.executeStylusAction(config.primaryButtonAction);
    }

    // Handle secondary button
    if (this.tabletData.secondaryButtonPressed) {
      this.executeStylusAction(config.secondaryButtonAction);
    }
  }

  private executeStylusAction(action: string) {
    switch (action) {
      case 'toggle-transpose':
        this.transposeActive = !this.transposeActive;
        this.updateStrummerNotes();
        break;
      case 'toggle-repeater':
        this.repeaterActive = !this.repeaterActive;
        break;
      case 'octave-up':
        this.transposeOctave(1);
        break;
      case 'octave-down':
        this.transposeOctave(-1);
        break;
    }
  }

  private handleTabletButtons() {
    const config = this.strummerConfig.tabletButtons;

    for (let i = 1; i <= 8; i++) {
      if (this.pressedButtons.has(i)) {
        const action = config.getButtonAction(i);
        if (action && typeof action === 'string') {
          this.executeTabletButtonAction(action);
        }
      }
    }
  }

  private executeTabletButtonAction(action: string) {
    // Handle chord changes
    if (action.match(/^[A-G][#b]?(m|maj|min|dim|aug|7|maj7|m7)?$/)) {
      this.setChord(action);
    } else {
      // Handle other actions
      switch (action) {
        case 'octave-up':
          this.transposeOctave(1);
          break;
        case 'octave-down':
          this.transposeOctave(-1);
          break;
        case 'toggle-transpose':
          this.transposeActive = !this.transposeActive;
          this.updateStrummerNotes();
          break;
        case 'toggle-repeater':
          this.repeaterActive = !this.repeaterActive;
          break;
      }
    }
  }

  private transposeOctave(direction: number) {
    this.strummerNotes = this.strummerNotes.map(note => ({
      ...note,
      octave: note.octave + direction
    }));
    this.strummer.notes = this.strummerNotes;
  }

  private setChord(chord: string) {
    this.currentChord = chord;
    this.updateStrummerNotes();
  }

  private updateStrummerNotes() {
    // Parse chord and generate notes
    const baseNotes = Note.parseChord(this.currentChord, 4);

    // Apply spread
    const upper = this.strummerConfig.strumming.upperNoteSpread;
    const lower = this.strummerConfig.strumming.lowerNoteSpread;

    let notes = Note.fillNoteSpread(baseNotes, lower, upper);

    // Apply transpose if active
    if (this.transposeActive && this.strummerConfig.transpose.active) {
      notes = notes.map((note: NoteObject) => Note.transpose(note, this.strummerConfig.transpose.semitones));
    }

    this.strummerNotes = notes;
    this.strummer.notes = notes;
  }

  private extractButtonsFromData(data: Record<string, unknown>): Set<number> {
    const pressed = new Set<number>();
    for (let i = 1; i <= 8; i++) {
      if (data[`button${i}`]) pressed.add(i);
    }
    return pressed;
  }

  private resetData() {
    this.tabletData = {
      x: 0, y: 0, pressure: 0,
      tiltX: 0, tiltY: 0, tiltXY: 0,
      primaryButtonPressed: false,
      secondaryButtonPressed: false
    };
    this.pressedButtons = new Set();
    this.lastPressedButton = null;
    this.tabletEvents = [];
    this.lastStrumEvent = null;
    this.packetCount = 0;
  }

  // Continue in next part...

  // Event handlers
  private async handleConnectHID() {
    if (!this.tabletConfig) {
      alert('Please load a tablet configuration file first');
      return;
    }
    await this.hidManager.connect(this.tabletConfig);
  }

  private handleDisconnectHID() {
    this.hidManager.disconnect();
  }

  private handleConfigFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string) as ConfigData;
        this.tabletConfig = new Config(data);
        console.log('[SketchatoneFullApp] Loaded tablet config:', this.tabletConfig.name);
      } catch (error) {
        console.error('[SketchatoneFullApp] Failed to parse config:', error);
        alert('Failed to parse configuration file');
      }
    };
    reader.readAsText(file);
  }

  private handleStrummerConfigFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        this.strummerConfig = StrummerConfig.fromDict(data);
        this.updateStrummerNotes();
        console.log('[SketchatoneFullApp] Loaded strummer config');
      } catch (error) {
        console.error('[SketchatoneFullApp] Failed to parse strummer config:', error);
        alert('Failed to parse strummer configuration file');
      }
    };
    reader.readAsText(file);
  }

  private handleExportConfig() {
    const configData = this.strummerConfig.toDict();
    const json = JSON.stringify(configData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strummer-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async handleMidiOutputSelect(outputId: string) {
    await this.midiOutput.connect(outputId);
    this.midiOutputConnected = this.midiOutput.isConnected;
    this.selectedMidiOutput = this.midiOutput.currentOutputName;
  }

  private handleThemeToggle() {
    this.dispatchEvent(new CustomEvent('theme-toggle', {
      bubbles: true,
      composed: true
    }));
  }

  private handleChordChange(chord: string) {
    this.setChord(chord);
  }

  private updateConfig(path: string, value: unknown) {
    // Update local config
    const parts = path.split('.');
    let obj: Record<string, unknown> = this.strummerConfig as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
    this.requestUpdate();
    
    // Re-apply notes if strumming config changed
    if (path.includes('strumming') || path.includes('transpose')) {
      this.updateStrummerNotes();
    }
  }

  private handleCurveConfigChange(e: CustomEvent) {
    const detail = e.detail as Record<string, unknown>;
    for (const [path, value] of Object.entries(detail)) {
      this.updateConfig(path, value);
    }
  }

  private handleCurveControlChange(e: CustomEvent) {
    const { parameterKey, control } = e.detail as { parameterKey: string; control: string };
    this.updateConfig(`${parameterKey}.control`, control);
  }

  private handleTabletButtonsConfigChange(e: CustomEvent) {
    const detail = e.detail as Record<string, unknown>;
    for (const [path, value] of Object.entries(detail)) {
      this.updateConfig(`tabletButtons./Users/farrell/Library/pnpm:/Users/farrell/.nvm/versions/node/v20.19.3/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin/python3:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/usr/local/sbin`, value);
    }
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

  private getLastPluckedStringIndex(): number | null {
    if (!this.lastStrumEvent || this.strummerNotes.length === 0) return null;
    const strumNote = this.lastStrumEvent.notes[0];
    if (!strumNote) return null;
    const index = this.strummerNotes.findIndex(
      n => n.notation === strumNote.note.notation && n.octave === strumNote.note.octave
    );
    return index >= 0 ? index : null;
  }

  private getTabletButtonsConfig(): TabletButtonsConfig | undefined {
    return this.strummerConfig.tabletButtons;
  }

  // Common chord presets
  private readonly chordPresets = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Cmaj7', 'Dm7', 'G7'];

  render() {
    const hasActiveConnection = this.hidConnected;

    return html`
      <div class="app">
        <div class="page-content">
          <div class="dashboard">
            <!-- Header -->
            ${this.renderHeader()}

            <!-- HID Connection Panel -->
            ${this.renderHIDConnectionPanel()}

            ${!hasActiveConnection ? html`
              <div class="disconnected-message">
                <p>Load a tablet configuration and connect via WebHID to start</p>
              </div>
            ` : html`
              <!-- Visualization Section -->
              ${this.renderVisualizationSection()}

              <!-- Strumming Configuration Section -->
              ${this.renderStrummingConfigSection()}

              <!-- Tablet Buttons Section -->
              ${this.renderTabletButtonsSection()}
            `}
          </div>
        </div>
      </div>
    `;
  }

  private renderHeader() {
    return html`
      <div class="dashboard-header">
        <div class="header-logo-container">
          <svg class="header-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150">
            <rect class="logo-bg" y="0" width="400" height="150" rx="10" ry="10"/>
            <g>
              <path class="logo-title" d="M101.37,67.54c-.57-1.05-1.42-1.99-2.56-2.84-1.14-.84-2.42-1.52-3.85-2.03-1.42-.51-2.91-.89-4.46-1.15-4.6-.68-8.9-2.18-12.89-4.48-.34-.18-.71-.57-1.09-1.16-.39-.59-.58-1.16-.58-1.71,0-2,.34-4.02,1.01-6.03.67-2.02,1.53-3.59,2.58-4.73,1.69-1.89,4.72-3.54,9.11-4.96,4.39-1.41,9.33-2.12,14.82-2.12,3.28,0,5.82.25,7.6.75,1.79.5,2.68,1.28,2.68,2.32,0,1.71-.23,3.03-.7,3.96s-.97,1.55-1.5,1.86c-.54.31-1.48.72-2.82,1.25-1.44.5-2.68,1.03-3.74,1.57s-1.97,1.07-2.72,1.57c-.75.5-1.22.75-1.4.75-.23,0-.34-.09-.34-.27,0-.39.4-.97,1.21-1.76.81-.79,1.81-1.47,2.99-2.07,1.25-.66,1.88-1.08,1.88-1.26,0-.3-.7-.44-2.08-.44-4.22,0-8.11.38-11.69,1.13-3.58.75-6.4,1.74-8.46,2.97-2.06,1.23-3.09,2.48-3.09,3.76,0,.8.43,1.36,1.28,1.69s2.74.88,5.66,1.66c2.92.78,5.53,1.66,7.83,2.67,3.3,1.41,5.75,2.88,7.35,4.41,1.59,1.53,2.39,3.24,2.39,5.13,0,1.3-.31,2.6-.94,3.91-.63,1.31-1.54,2.51-2.75,3.61-1.21,1.09-2.6,1.99-4.17,2.7-1.34.57-3.04,1.1-5.08,1.61-2.04.5-4.25.89-6.63,1.18-2.38.28-4.65.43-6.82.43-3.99,0-7.19-.38-9.62-1.13s-3.64-1.89-3.64-3.42c0-.68.41-1.75,1.23-3.2s1.79-2.42,2.91-2.92c.98-.39,1.93-.61,2.84-.67.91-.06,1.37.05,1.37.33,0,.07-.03.14-.1.21s-.15.13-.24.17c-.09.05-.18.09-.27.14-.46.18-.83.32-1.11.43-.29.1-.51.21-.68.31-.17.1-.26.25-.26.43,0,.48,2.36.72,7.08.72,4.1,0,7.46-.15,10.08-.44,2.62-.3,4.93-.83,6.94-1.61,2-.77,3.83-1.85,5.47-3.21Z"/>
            </g>
            <path class="logo-line" fill="none" stroke-width="4" d="M50,89.5c100,6.67,200,6.67,300,0"/>
            <g>
              <path class="logo-subtitle" d="M155,123.74h-2.41l-.27,1.44h-2.81l2.7-12.6h3.17l2.7,12.6h-2.81l-.27-1.44ZM154.59,121.4l-.74-4.01-.05-.45-.05.45-.74,4.01h1.58Z"/>
              <path class="logo-subtitle" d="M167.39,116.72v6.16s.02.05.05.05h1.24s.05-.02.05-.05v-6.16h2.43v8.46h-2.39v-.83h-.04c-.13.56-.76.86-1.4.86h-.47c-1.21,0-1.91-.68-1.91-1.91v-6.59h2.43Z"/>
              <path class="logo-subtitle" d="M181.01,125.18c-1.03,0-1.73-.7-1.73-1.73v-4.48h-1.26v-2.25h1.26v-2.52h2.43v2.52h1.62v2.25h-1.62v3.91s.02.05.05.05h1.57v2.25h-2.32Z"/>
              <path class="logo-subtitle" d="M194.76,125.22h-2.75c-1.06,0-1.73-.7-1.73-1.73v-5.08c0-1.06.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v5.08c0,1.03-.7,1.73-1.73,1.73ZM194.01,118.97h-1.24s-.05.02-.05.05v3.85s.02.05.05.05h1.24s.05-.02.05-.05v-3.85s-.02-.05-.05-.05Z"/>
              <path class="logo-subtitle" d="M220,123.74h-2.41l-.27,1.44h-2.81l2.7-12.6h3.17l2.7,12.6h-2.81l-.27-1.44ZM219.59,121.4l-.74-4.01-.05-.45-.05.45-.74,4.01h1.58Z"/>
              <path class="logo-subtitle" d="M232.39,116.72v6.16s.02.05.05.05h1.24s.05-.02.05-.05v-6.16h2.43v8.46h-2.39v-.83h-.04c-.13.56-.76.86-1.4.86h-.47c-1.21,0-1.91-.68-1.91-1.91v-6.59h2.43Z"/>
              <path class="logo-subtitle" d="M246.01,125.18c-1.03,0-1.73-.7-1.73-1.73v-4.48h-1.26v-2.25h1.26v-2.52h2.43v2.52h1.62v2.25h-1.62v3.91s.02.05.05.05h1.57v2.25h-2.32Z"/>
              <path class="logo-subtitle" d="M259.76,125.22h-2.75c-1.06,0-1.73-.7-1.73-1.73v-5.08c0-1.06.67-1.73,1.73-1.73h2.75c1.03,0,1.73.7,1.73,1.73v5.08c0,1.03-.7,1.73-1.73,1.73ZM259.01,118.97h-1.24s-.05.02-.05.05v3.85s.02.05.05.05h1.24s.05-.02.05-.05v-3.85s-.02-.05-.05-.05Z"/>
            </g>
          </svg>
        </div>
        <div class="header-content">
          <div class="header-row">
            <div class="active-features">
              ${this.transposeActive ? html`<span class="feature-badge active">Transpose</span>` : ''}
              ${this.repeaterActive ? html`<span class="feature-badge active">Repeater</span>` : ''}
              ${this.midiOutputConnected ? html`<span class="feature-badge active">MIDI Out: ${this.selectedMidiOutput}</span>` : ''}
              ${this.midiInputConnected ? html`<span class="feature-badge active">MIDI In</span>` : ''}
            </div>
            <div class="header-controls">
              <sp-action-button quiet @click=${this.handleThemeToggle}>
                ${this.themeColor === 'light'
                  ? html`<sp-icon-moon slot="icon"></sp-icon-moon>`
                  : html`<sp-icon-light slot="icon"></sp-icon-light>`}
              </sp-action-button>
            </div>
          </div>
          <div class="connection-row">
            <div class="save-button-group">
              <sp-button size="s" variant="secondary" @click=${this.handleExportConfig}>
                <sp-icon-download slot="icon"></sp-icon-download>
                Export Config
              </sp-button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderHIDConnectionPanel() {
    return html`
      <div class="hid-connection-panel">
        <div class="hid-connection-row">
          <!-- Tablet Config -->
          <div class="config-selector">
            <input type="file" accept=".json" class="config-file-input" id="tablet-config-input"
              @change=${this.handleConfigFileSelect}>
            <sp-button size="s" variant="secondary" @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#tablet-config-input')?.click()}>
              <sp-icon-folder-open slot="icon"></sp-icon-folder-open>
              ${this.tabletConfig ? this.tabletConfig.name : 'Load Tablet Config'}
            </sp-button>
          </div>

          <!-- Strummer Config -->
          <div class="config-selector">
            <input type="file" accept=".json" class="config-file-input" id="strummer-config-input"
              @change=${this.handleStrummerConfigFileSelect}>
            <sp-button size="s" variant="secondary" @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#strummer-config-input')?.click()}>
              <sp-icon-folder-open slot="icon"></sp-icon-folder-open>
              Load Strummer Config
            </sp-button>
          </div>

          <!-- HID Connection -->
          <div class="hid-status">
            ${this.hidConnected ? html`
              <div class="status-badge connected">
                <span class="status-dot"></span>
                ${this.hidDeviceName || 'Connected'}
              </div>
              <sp-button size="s" variant="secondary" @click=${this.handleDisconnectHID}>
                Disconnect
              </sp-button>
            ` : html`
              <sp-button size="s" variant="primary" ?disabled=${!this.tabletConfig} @click=${this.handleConnectHID}>
                <sp-icon-link slot="icon"></sp-icon-link>
                Connect Tablet
              </sp-button>
            `}
          </div>
        </div>

        <!-- MIDI Output Selection -->
        ${this.midiOutputPorts.length > 0 ? html`
          <div class="midi-output-panel">
            <div class="midi-output-header">
              <span class="midi-output-title">MIDI Output</span>
              <div class="status-badge small ${this.midiOutputConnected ? 'connected' : 'disconnected'}">
                <span class="status-dot"></span>
                ${this.midiOutputPorts.length} ports
              </div>
            </div>
            <div class="midi-output-ports">
              ${this.midiOutputPorts.map(port => html`
                <div class="midi-output-port ${port.name === this.selectedMidiOutput ? 'active' : ''}"
                  @click=${() => this.handleMidiOutputSelect(port.id)}>
                  ${port.name}
                </div>
              `)}
            </div>
          </div>
        ` : ''}

        <!-- Chord Selector -->
        <div class="chord-selector">
          <div class="chord-input-row">
            <label>Current Chord:</label>
            <sp-textfield size="s" value=${this.currentChord}
              @change=${(e: Event) => this.handleChordChange((e.target as HTMLInputElement).value)}>
            </sp-textfield>
          </div>
          <div class="chord-presets">
            ${this.chordPresets.map(chord => html`
              <button class="chord-preset-btn ${chord === this.currentChord ? 'active' : ''}"
                @click=${() => this.handleChordChange(chord)}>
                ${chord}
              </button>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  private renderVisualizationSection() {
    return html`
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
                    .socketMode=${true}
                    .tabletConnected=${this.hidConnected}
                    .externalTabletData=${this.tabletData}
                    .externalPressedButtons=${this.pressedButtons}
                    .stringCount=${this.strummerNotes.length}
                    .notes=${this.strummerNotes}
                    .externalLastPluckedString=${this.getLastPluckedStringIndex()}>
                  </strum-visualizer>
                </div>
                <div class="data-values compact">
                  <div class="data-item">
                    <span class="data-label">X</span>
                    <span class="data-value ${this.tabletData.x === 0 ? 'zero' : ''}">${formatValue(this.tabletData.x)}</span>
                  </div>
                  <div class="data-item">
                    <span class="data-label">Y</span>
                    <span class="data-value ${this.tabletData.y === 0 ? 'zero' : ''}">${formatValue(this.tabletData.y)}</span>
                  </div>
                  <div class="data-item">
                    <span class="data-label">Btn</span>
                    <span class="data-value ${this.pressedButtons.size > 0 ? 'active' : ''}">${this.lastPressedButton !== null ? this.lastPressedButton : '–'}</span>
                  </div>
                </div>
              </div>

              <!-- Pressure & Tilt Panel -->
              <div class="visualizer-card compact">
                <div class="visualizer-wrapper">
                  <tablet-visualizer
                    mode="tilt"
                    .socketMode=${true}
                    .tabletConnected=${this.hidConnected}
                    .externalTabletData=${this.tabletData}
                    .externalPressedButtons=${this.pressedButtons}>
                  </tablet-visualizer>
                </div>
                <div class="data-values compact">
                  <div class="data-item">
                    <span class="data-label">Pressure</span>
                    <span class="data-value ${this.tabletData.pressure === 0 ? 'zero' : ''}">${formatValue(this.tabletData.pressure)}</span>
                  </div>
                  <div class="data-item">
                    <span class="data-label">Tilt X</span>
                    <span class="data-value ${this.tabletData.tiltX === 0 ? 'zero' : ''}">${formatValue(this.tabletData.tiltX)}</span>
                  </div>
                  <div class="data-item">
                    <span class="data-label">Tilt Y</span>
                    <span class="data-value ${this.tabletData.tiltY === 0 ? 'zero' : ''}">${formatValue(this.tabletData.tiltY)}</span>
                  </div>
                </div>
              </div>

              <!-- MIDI Input Panel -->
              <div class="visualizer-card compact midi-panel">
                <div class="midi-panel-header">
                  <span class="midi-panel-title">MIDI Input</span>
                  <div class="status-badge small ${this.midiInputConnected ? 'connected' : 'disconnected'}">
                    <span class="status-dot"></span>
                    ${this.midiInputConnected ? 'Connected' : 'Disconnected'}
                  </div>
                </div>
                <div class="midi-notes compact">
                  <span class="midi-notes-label">Notes:</span>
                  <span class="midi-notes-value">${this.midiInputNotes.length > 0
                    ? this.midiInputNotes.map(n => `${n.notation}${n.octave}`).join(', ')
                    : '—'}</span>
                </div>
              </div>

              <!-- Events Panel -->
              <div class="visualizer-card events-panel">
                <strum-events-display
                  .events=${this.tabletEvents}
                  .isEmpty=${this.tabletEvents.length === 0}
                  .lastStrumEvent=${this.lastStrumEvent ? { notes: this.lastStrumEvent.notes, timestamp: Date.now() / 1000 } : null}
                  .deviceInfo=${{ packetCount: this.packetCount, isMock: false, isTranslated: true }}>
                </strum-events-display>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderStrummingConfigSection() {
    const config = this.strummerConfig;
    return html`
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
                  control="${config.noteVelocity.control}"
                  outputLabel="Velocity"
                  color="#51cf66"
                  .config=${config.noteVelocity.toDict()}
                  @config-change=${this.handleCurveConfigChange}
                  @control-change=${this.handleCurveControlChange}>
                </curve-visualizer>
              </dashboard-panel>

              <dashboard-panel title="Note Duration" size="small" .draggable=${false} .minimizable=${false}>
                <curve-visualizer
                  label="Note Duration"
                  parameterKey="noteDuration"
                  control="${config.noteDuration.control}"
                  outputLabel="Duration"
                  color="#f59f00"
                  .config=${config.noteDuration.toDict()}
                  @config-change=${this.handleCurveConfigChange}
                  @control-change=${this.handleCurveControlChange}>
                </curve-visualizer>
              </dashboard-panel>

              <dashboard-panel title="Pitch Bend" size="small" .draggable=${false} .minimizable=${false}>
                <curve-visualizer
                  label="Pitch Bend"
                  parameterKey="pitchBend"
                  control="${config.pitchBend.control}"
                  outputLabel="Bend"
                  color="#339af0"
                  .config=${config.pitchBend.toDict()}
                  @config-change=${this.handleCurveConfigChange}
                  @control-change=${this.handleCurveControlChange}>
                </curve-visualizer>
              </dashboard-panel>

              <!-- Settings Panels -->
              <dashboard-panel title="Strumming Settings" size="medium" .draggable=${false} .minimizable=${false}>
                <div class="settings-form">
                  <div class="setting-row">
                    <label>Pluck Velocity Scale</label>
                    <sp-number-field value="${config.strumming.pluckVelocityScale}" step="0.1" min="0.1" max="10"
                      @change=${(e: Event) => this.updateConfig('strumming.pluckVelocityScale', Number((e.target as HTMLInputElement).value))}></sp-number-field>
                  </div>
                  <div class="setting-row">
                    <label>Pressure Threshold</label>
                    <sp-number-field value="${config.strumming.pressureThreshold}" step="0.01" min="0" max="1"
                      @change=${(e: Event) => this.updateConfig('strumming.pressureThreshold', Number((e.target as HTMLInputElement).value))}></sp-number-field>
                  </div>
                  <div class="setting-row">
                    <label>Upper Note Spread</label>
                    <sp-number-field value="${config.strumming.upperNoteSpread}" step="1" min="0" max="12"
                      @change=${(e: Event) => this.updateConfig('strumming.upperNoteSpread', Number((e.target as HTMLInputElement).value))}></sp-number-field>
                  </div>
                  <div class="setting-row">
                    <label>Lower Note Spread</label>
                    <sp-number-field value="${config.strumming.lowerNoteSpread}" step="1" min="0" max="12"
                      @change=${(e: Event) => this.updateConfig('strumming.lowerNoteSpread', Number((e.target as HTMLInputElement).value))}></sp-number-field>
                  </div>
                </div>
              </dashboard-panel>

              <dashboard-panel title="Stylus Buttons" size="medium" .draggable=${false} .minimizable=${false}
                .hasActiveControl=${true}
                .active=${config.stylusButtons.active}
                @active-change=${(e: CustomEvent) => this.updateConfig('stylusButtons.active', e.detail.active)}>
                <div class="settings-form">
                  <div class="setting-row">
                    <label>Primary Button</label>
                    <sp-picker label="Action" value="${config.stylusButtons.primaryButtonAction}"
                      @change=${(e: Event) => this.updateConfig('stylusButtons.primaryButtonAction', (e.target as HTMLInputElement).value)}>
                      <sp-menu-item value="toggle-transpose">Toggle Transpose</sp-menu-item>
                      <sp-menu-item value="toggle-repeater">Toggle Repeater</sp-menu-item>
                      <sp-menu-item value="octave-up">Octave Up</sp-menu-item>
                      <sp-menu-item value="octave-down">Octave Down</sp-menu-item>
                      <sp-menu-item value="none">None</sp-menu-item>
                    </sp-picker>
                  </div>
                  <div class="setting-row">
                    <label>Secondary Button</label>
                    <sp-picker label="Action" value="${config.stylusButtons.secondaryButtonAction}"
                      @change=${(e: Event) => this.updateConfig('stylusButtons.secondaryButtonAction', (e.target as HTMLInputElement).value)}>
                      <sp-menu-item value="toggle-transpose">Toggle Transpose</sp-menu-item>
                      <sp-menu-item value="toggle-repeater">Toggle Repeater</sp-menu-item>
                      <sp-menu-item value="octave-up">Octave Up</sp-menu-item>
                      <sp-menu-item value="octave-down">Octave Down</sp-menu-item>
                      <sp-menu-item value="none">None</sp-menu-item>
                    </sp-picker>
                  </div>
                </div>
              </dashboard-panel>

              <dashboard-panel title="Transpose" size="medium" .draggable=${false} .minimizable=${false}
                .hasActiveControl=${true}
                .active=${config.transpose.active}
                @active-change=${(e: CustomEvent) => this.updateConfig('transpose.active', e.detail.active)}>
                <div class="settings-form">
                  <div class="setting-row">
                    <label>Semitones</label>
                    <sp-number-field value="${config.transpose.semitones}" step="1" min="-24" max="24"
                      @change=${(e: Event) => this.updateConfig('transpose.semitones', Number((e.target as HTMLInputElement).value))}></sp-number-field>
                  </div>
                </div>
              </dashboard-panel>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderTabletButtonsSection() {
    return html`
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
                  .buttonCount=${this.tabletConfig?.getCapabilities()?.buttonCount ?? 8}
                  @config-change=${this.handleTabletButtonsConfigChange}
                ></tablet-buttons-config>
              </dashboard-panel>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketchatone-full-app': SketchatoneFullApp;
  }
}
