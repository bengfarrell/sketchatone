/**
 * Electron IPC Bridge
 *
 * Main process module that handles HID reading, strummer processing, and MIDI output.
 * This replaces WebSocket communication with direct IPC for the Electron app.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { usb } from 'usb';

// Import from blankslate CLI modules
import {
  normalizeTabletEvent,
  resolveConfigPath,
  findConfigForDevice,
  loadConfig,
  initializeRealDevice
} from 'blankslate/cli/tablet-reader-base.js';
// Import from blankslate main exports
import { Config, processDeviceData, processKeyboardButtonData, type KeyboardButtonsConfig } from 'blankslate';
import type { IHIDReader } from 'blankslate/core';

// Import strummer modules
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { Actions } from '../core/actions.js';
import { MidiStrummerConfig, type MidiStrummerConfigData } from '../models/midi-strummer-config.js';
import { Note, type NoteObject } from '../models/note.js';
import { RtMidiBackend } from '../midi/rtmidi-backend.js';
import { MidiStrummerBridge } from '../midi/bridge.js';
import type { MidiBackendProtocol } from '../midi/protocol.js';
import { RtMidiInput, MIDI_INPUT_NOTE_EVENT, type MidiInputNoteEvent } from '../midi/rtmidi-input.js';
import {
  StrummerEventBus,
  type TabletEventData,
  type StrumEventData,
  type StrumNoteEventData,
  type CombinedEventData,
} from '../utils/strummer-event-bus.js';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default config directory (device configs are in the 'devices' subdirectory)
const DEFAULT_CONFIG_DIR = path.join(__dirname, '../public/configs/devices');

/**
 * Connection state for the IPC bridge
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * IPC Bridge class - handles HID reading and strummer processing
 * Uses composition instead of inheritance from TabletReaderBase
 */
class IPCBridge {
  private mainWindow: BrowserWindow | null = null;
  private config: MidiStrummerConfig;
  private strummer: Strummer;
  private eventBus: StrummerEventBus;
  private combinedUnsubscribe: (() => void) | null = null;
  private deviceConnected: boolean = false;
  private connectionState: ConnectionState = 'disconnected';

  // HID reader (from blankslate)
  private reader: IHIDReader | null = null;
  private tabletConfig: Config | null = null;

  // USB hotplug event handlers
  private usbAttachHandler: ((device: usb.Device) => void) | null = null;
  private isWaitingForDevice: boolean = false;

  // MIDI support
  private backend: MidiBackendProtocol | null = null;
  private bridge: MidiStrummerBridge | null = null;
  private midiInput: RtMidiInput | null = null;
  private midiInputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private midiInputAvailablePorts: { id: number; name: string }[] = [];
  public notesPlayed: number = 0;
  private actions: Actions;

  // State tracking for stylus buttons
  private buttonState = {
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
  };

  // State tracking for tablet hardware buttons (1-8)
  private tabletButtonState: Record<string, boolean> = {};

  // State tracking for note repeater
  private repeaterState = {
    notes: [] as StrumNoteData[],
    lastRepeatTime: 0,
    isHolding: false,
  };

  // State tracking for strum release feature
  private strumStartTime: number = 0;

  // Path to the strummer config file (for saving)
  private strummerConfigPath: string | undefined;

  // Packet counter for debugging
  private packetCount: number = 0;

  // Current mode tracking for multi-mode configs
  private currentMode: ReturnType<Config['getModeByReportId']> | null = null;

  constructor(
    options: {
      strummerConfigPath?: string;
      midiChannel?: number;
      midiPort?: string | number;
      noteDuration?: number;
    } = {}
  ) {
    this.strummerConfigPath = options.strummerConfigPath;

    // Load combined config from file or use defaults
    if (options.strummerConfigPath) {
      this.config = MidiStrummerConfig.fromJsonFile(options.strummerConfigPath);
    } else {
      this.config = new MidiStrummerConfig();
    }

    // Apply CLI overrides for MIDI settings
    if (options.midiChannel !== undefined) {
      this.config.midi.channel = options.midiChannel;
    }
    if (options.midiPort !== undefined) {
      this.config.midi.outputPort = options.midiPort;
    }
    if (options.noteDuration !== undefined) {
      this.config.noteDuration.default = options.noteDuration;
    }

    // Create event bus
    this.eventBus = new StrummerEventBus();

    // Create strummer
    this.strummer = new Strummer();
    this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);

    // Set up notes
    this.setupNotes();

    // Create Actions handler
    this.actions = new Actions(
      {
        noteRepeater: this.config.noteRepeater,
        transpose: this.config.transpose,
        lowerSpread: this.config.strummer.lowerSpread,
        upperSpread: this.config.strummer.upperSpread,
      },
      this.strummer
    );

    // Initialize tablet button state
    for (let i = 1; i <= 8; i++) {
      this.tabletButtonState[`button${i}`] = false;
    }
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private setupNotes(): void {
    let baseNotes: NoteObject[] = [];

    if (this.config.chord) {
      baseNotes = Note.parseChord(this.config.chord);
    } else {
      for (const noteStr of this.config.notes) {
        baseNotes.push(Note.parseNotation(noteStr));
      }
    }

    const notes = Note.fillNoteSpread(
      baseNotes,
      this.config.strummer.lowerSpread,
      this.config.strummer.upperSpread
    );

    this.strummer.notes = notes;
  }

  private getControlValue(
    control: string,
    inputs: {
      x?: number;
      y?: number;
      pressure?: number;
      tiltX?: number;
      tiltY?: number;
      tiltXY?: number;
      pressureVelocity?: number;
    }
  ): number | null {
    switch (control) {
      case 'none': return null;
      case 'pressure': return inputs.pressure ?? 0;
      case 'tiltX': return ((inputs.tiltX ?? 0) + 1.0) / 2.0;
      case 'tiltY': return ((inputs.tiltY ?? 0) + 1.0) / 2.0;
      case 'tiltXY': return ((inputs.tiltXY ?? 0) + 1.0) / 2.0;
      case 'xaxis': return inputs.x ?? 0.5;
      case 'yaxis': return inputs.y ?? 0.5;
      case 'velocity': return inputs.pressureVelocity ?? inputs.pressure ?? 0;
      default: return null;
    }
  }

  private async setupMidi(): Promise<boolean> {
    try {
      this.backend = new RtMidiBackend({
        channel: this.config.channel,
        useVirtualPorts: this.config.useVirtualPorts,
      });

      const port = this.config.outputPort;
      if (!(await this.backend.connect(port))) {
        console.error('Failed to connect MIDI backend');
        return false;
      }

      this.bridge = new MidiStrummerBridge(this.strummer, this.backend, {
        noteDuration: this.config.noteDuration.default,
        autoConnect: false,
      });

      return true;
    } catch (error) {
      console.error(`MIDI backend not available: ${error}`);
      return false;
    }
  }

  private async setupMidiInput(): Promise<boolean> {
    try {
      this.midiInput = new RtMidiInput();
      const inputPort = this.config.inputPort;

      this.midiInputAvailablePorts = await this.midiInput.getAvailablePorts(true);

      const excludePorts: string[] = [...this.config.midi.inputExclude];
      if (this.backend && 'currentOutputName' in this.backend && this.backend.currentOutputName) {
        excludePorts.push(this.backend.currentOutputName as string);
      }

      let connected = false;
      if (inputPort === null || inputPort === undefined) {
        connected = await this.midiInput.connectAll(excludePorts);
      } else {
        connected = await this.midiInput.connect(inputPort);
      }

      if (!connected) {
        console.log('No MIDI input ports available');
        return false;
      }

      this.midiInput.on<MidiInputNoteEvent>(MIDI_INPUT_NOTE_EVENT, (event) => {
        this.sendMidiInput(event);

        if (this.midiInputDebounceTimer) {
          clearTimeout(this.midiInputDebounceTimer);
          this.midiInputDebounceTimer = null;
        }

        if (event.added) {
          this.updateNotesFromMidiInput(event.notes);
        } else if (event.removed) {
          this.midiInputDebounceTimer = setTimeout(() => {
            this.midiInputDebounceTimer = null;
            if (this.midiInput && this.midiInput.notes.length > 0) {
              this.updateNotesFromMidiInput(this.midiInput.notes);
            }
          }, 100);
        }
      });

      return true;
    } catch (error) {
      console.error(`MIDI input not available: ${error}`);
      return false;
    }
  }

  private sendMidiInput(event: MidiInputNoteEvent): void {
    if (!this.mainWindow) return;

    const connectedPort = this.midiInput?.connectedPorts[0]?.name ?? null;

    this.mainWindow.webContents.send('bridge:midiInput', {
      notes: event.notes,
      added: event.added,
      removed: event.removed,
      portName: event.portName,
      availablePorts: this.midiInputAvailablePorts,
      connectedPort,
    });
  }

  private updateNotesFromMidiInput(noteStrings: string[]): void {
    if (noteStrings.length === 0) return;

    this.config.strummer.strumming.initialNotes = noteStrings;
    this.setupNotes();
    this.sendConfig();

    console.log(`[MIDI Input] Notes: ${noteStrings.join(', ')}`);
  }

  /**
   * Check if the main window is still valid for sending messages
   */
  private canSendToWindow(): boolean {
    return this.mainWindow !== null && !this.mainWindow.isDestroyed();
  }

  private setupEventSubscriptions(): void {
    this.combinedUnsubscribe = this.eventBus.onCombinedEvent((data) => {
      if (this.canSendToWindow()) {
        this.mainWindow!.webContents.send('bridge:combined', {
          type: 'tablet-data',
          ...data,
        });
      }
    });
  }

  private sendConfig(): void {
    if (!this.canSendToWindow()) return;

    const configData = {
      notes: this.strummer.notes.map((n) => ({
        notation: n.notation,
        octave: n.octave,
      })),
      config: this.config.toDict(),
      serverVersion: '1.0.0-electron',
      deviceCapabilities: this.tabletConfig?.getCapabilities() ?? undefined,
    };

    this.mainWindow!.webContents.send('bridge:config', configData);
  }

  private sendDeviceStatus(): void {
    if (!this.canSendToWindow()) return;

    this.mainWindow!.webContents.send('bridge:deviceStatus', {
      status: this.deviceConnected ? 'connected' : 'disconnected',
      deviceConnected: this.deviceConnected,
      message: this.deviceConnected ? 'Tablet connected' : 'Waiting for tablet...',
      timestamp: Date.now(),
    });
  }

  private sendConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    if (this.canSendToWindow()) {
      this.mainWindow!.webContents.send('bridge:connectionState', state);
    }
  }

  private sendError(error: string): void {
    if (this.canSendToWindow()) {
      this.mainWindow!.webContents.send('bridge:error', error);
    }
  }

  /**
   * Process a raw packet through the config mappings
   */
  private processPacket(data: Uint8Array, reportId?: number): Record<string, string | number | boolean> {
    if (!this.tabletConfig || data.length === 0) {
      return {};
    }

    // Extract report ID from first byte if not provided
    const rid = reportId !== undefined ? reportId : data[0];

    // Check if this is a keyboard button packet (report IDs 3, 4, 5)
    if (rid === 3 || rid === 4 || rid === 5) {
      let keyboardButtonsConfig: KeyboardButtonsConfig | null = null;
      for (const mode of this.tabletConfig.modes) {
        const kbConfig = mode.byteCodeMappings?.keyboardButtons;
        if (kbConfig && kbConfig.buttons) {
          keyboardButtonsConfig = kbConfig as KeyboardButtonsConfig;
          break;
        }
      }

      if (keyboardButtonsConfig) {
        return processKeyboardButtonData(data, keyboardButtonsConfig);
      }
    }

    // For multi-mode configs, get Report ID and appropriate mappings
    let mappings;
    let buttonInterfaceReportId;

    const isMultiMode = this.tabletConfig.modes && this.tabletConfig.modes.length > 1;

    if (isMultiMode) {
      let mode = this.tabletConfig.getModeByReportId(rid);

      if (mode && this.currentMode === null) {
        this.currentMode = mode;
        console.log(`Detected device mode: Report ID ${rid}`);
      }

      if (!mode && rid !== undefined) {
        if (this.currentMode && this.currentMode.buttonInterfaceReportId === rid) {
          mode = this.currentMode;
        } else if (this.tabletConfig.modes) {
          mode = this.tabletConfig.modes.find(m => m.buttonInterfaceReportId === rid);
        }
      }

      if (mode) {
        mappings = mode.byteCodeMappings;
        buttonInterfaceReportId = mode.buttonInterfaceReportId;
      } else {
        return {};
      }
    } else {
      const mode = this.tabletConfig.modes[0];
      mappings = mode?.byteCodeMappings;
      buttonInterfaceReportId = mode?.buttonInterfaceReportId;
    }

    return processDeviceData(data, mappings, 0, {
      buttonInterfaceReportId,
    });
  }

  private handlePacket(data: Uint8Array): void {
    try {
      this.packetCount++;
      const events = this.processPacket(data);
      const normalized = normalizeTabletEvent(events);
      const { x, y, pressure, state, tiltX, tiltY, tiltXY, primaryButtonPressed, secondaryButtonPressed } = normalized;

      // Handle stylus button presses
      const stylusButtonsCfg = this.config.stylusButtons;
      if (stylusButtonsCfg?.active) {
        if (primaryButtonPressed && !this.buttonState.primaryButtonPressed) {
          this.actions.execute(stylusButtonsCfg.primaryButtonAction, { button: 'Primary' });
        }
        if (secondaryButtonPressed && !this.buttonState.secondaryButtonPressed) {
          this.actions.execute(stylusButtonsCfg.secondaryButtonAction, { button: 'Secondary' });
        }
      }

      this.buttonState.primaryButtonPressed = primaryButtonPressed;
      this.buttonState.secondaryButtonPressed = secondaryButtonPressed;

      // Handle tablet hardware buttons
      const tabletButtonsCfg = this.config.tabletButtons;
      for (let i = 1; i <= 8; i++) {
        const buttonKey = `button${i}` as keyof typeof normalized;
        const buttonPressed = Boolean(normalized[buttonKey]);
        const stateKey = `button${i}`;

        if (buttonPressed && !this.tabletButtonState[stateKey]) {
          const action = tabletButtonsCfg?.getButtonAction(i);
          if (action) {
            this.actions.execute(action, { button: `Tablet${i}` });
          }
        }
        this.tabletButtonState[stateKey] = buttonPressed;
      }

      // Apply pitch bend
      const pitchBendCfg = this.config.pitchBend;
      if (pitchBendCfg && this.backend) {
        const controlValue = this.getControlValue(pitchBendCfg.control, { x, y, pressure, tiltX, tiltY, tiltXY });
        if (controlValue !== null) {
          const bendValue = pitchBendCfg.mapValue(controlValue);
          this.backend.sendPitchBend?.(bendValue);
        }
      }

      // Calculate note duration
      const noteDurationCfg = this.config.noteDuration;
      let currentNoteDuration = noteDurationCfg.default;
      if (noteDurationCfg) {
        const controlValue = this.getControlValue(noteDurationCfg.control, { x, y, pressure, tiltX, tiltY, tiltXY });
        if (controlValue !== null) {
          currentNoteDuration = noteDurationCfg.mapValue(controlValue);
        }
      }

      const noteVelocityCfg = this.config.noteVelocity;

      // Emit tablet event
      const tabletEventData: TabletEventData = {
        x, y, pressure, tiltX, tiltY, tiltXY,
        primaryButtonPressed, secondaryButtonPressed,
        state: state as 'hover' | 'contact' | 'out-of-range',
        timestamp: Date.now(),
        tabletButtons: normalized.tabletButtons,
        button1: normalized.button1,
        button2: normalized.button2,
        button3: normalized.button3,
        button4: normalized.button4,
        button5: normalized.button5,
        button6: normalized.button6,
        button7: normalized.button7,
        button8: normalized.button8,
      };
      this.eventBus.emitTabletEvent(tabletEventData);

      // Update strummer and process strum
      this.strummer.updateBounds(1.0, 1.0);
      const event = this.strummer.strum(x, pressure);

      const transposeEnabled = this.actions.isTransposeActive();
      const transposeSemitones = this.actions.getTransposeSemitones();

      if (event) {
        if (event.type === 'strum') {
          if (this.strumStartTime === 0) {
            this.strumStartTime = Date.now() / 1000;
          }

          this.repeaterState.notes = event.notes;
          this.repeaterState.isHolding = true;
          this.repeaterState.lastRepeatTime = Date.now() / 1000;

          for (const noteData of event.notes) {
            let velocity = noteData.velocity;
            if (noteVelocityCfg && velocity > 0) {
              const normalizedVel = velocity / 127;
              velocity = Math.floor(noteVelocityCfg.mapValue(normalizedVel));
              velocity = Math.max(1, Math.min(127, velocity));
            }

            if (this.backend && velocity > 0) {
              const noteToPlay = transposeEnabled
                ? Note.transpose(noteData.note, transposeSemitones)
                : noteData.note;
              this.backend.sendNote(noteToPlay, velocity, currentNoteDuration);
              this.notesPlayed++;
            }
          }

          const strumEventData: StrumEventData = {
            type: 'strum',
            notes: event.notes.map((n: StrumNoteData): StrumNoteEventData => ({
              note: {
                notation: n.note.notation,
                octave: n.note.octave,
                midiNote: Note.noteToMidi(n.note),
              },
              velocity: n.velocity,
            })),
            velocity: event.notes[0]?.velocity ?? 0,
            timestamp: Date.now(),
          };
          this.eventBus.emitStrumEvent(strumEventData);
        } else if (event.type === 'release') {
          this.repeaterState.isHolding = false;
          this.repeaterState.notes = [];
          this.strumStartTime = 0;
        }
      }
    } catch (error) {
      console.error('Error processing packet:', error);
    }
  }

  /**
   * Initialize the HID reader using the tablet config
   */
  private async initializeReader(): Promise<void> {
    if (!this.tabletConfig) {
      throw new Error('Tablet config not loaded');
    }
    this.reader = await initializeRealDevice(this.tabletConfig, {
      onDisconnect: () => this.handleDeviceDisconnect()
    });
  }

  /**
   * Handle device disconnection
   */
  private handleDeviceDisconnect(): void {
    console.log('Tablet device disconnected');
    this.deviceConnected = false;
    this.reader = null;
    this.tabletConfig = null;
    this.sendConnectionState('disconnected');
    this.sendDeviceStatus();

    // Start listening for device reconnection via USB events
    this.startWaitingForDevice();
  }

  /**
   * Start listening for USB device attach events (event-based hotplug)
   */
  private startWaitingForDevice(): void {
    if (this.isWaitingForDevice) return;

    this.isWaitingForDevice = true;
    console.log('Waiting for USB device attach event...');

    // Create attach handler
    this.usbAttachHandler = async (device: usb.Device) => {
      console.log(`USB device attached: vendor=0x${device.deviceDescriptor.idVendor.toString(16)}, product=0x${device.deviceDescriptor.idProduct.toString(16)}`);

      // Small delay to let the device fully initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if this device has a matching config
      const foundConfig = findConfigForDevice(DEFAULT_CONFIG_DIR);
      if (foundConfig) {
        console.log(`Matching config found: ${foundConfig}`);
        this.stopWaitingForDevice();
        await this.connect();
      }
    };

    usb.on('attach', this.usbAttachHandler);
  }

  /**
   * Stop listening for USB device attach events
   */
  private stopWaitingForDevice(): void {
    if (this.usbAttachHandler) {
      usb.off('attach', this.usbAttachHandler);
      this.usbAttachHandler = null;
    }
    this.isWaitingForDevice = false;
  }

  async connect(configPath?: string): Promise<boolean> {
    // Stop waiting for device if we were
    this.stopWaitingForDevice();
    try {
      this.sendConnectionState('connecting');

      // Find tablet config
      let tabletConfigPath: string;
      if (configPath) {
        tabletConfigPath = resolveConfigPath(configPath, DEFAULT_CONFIG_DIR);
      } else {
        const foundConfig = findConfigForDevice(DEFAULT_CONFIG_DIR);
        if (!foundConfig) {
          // No device found - start listening for USB attach events
          console.log('No tablet device found. Waiting for USB attach event...');
          this.sendConnectionState('disconnected');
          this.sendDeviceStatus();
          this.startWaitingForDevice();
          return false;
        }
        tabletConfigPath = foundConfig;
      }

      // Load the tablet config
      this.tabletConfig = loadConfig(tabletConfigPath);

      // Initialize MIDI
      console.log('Initializing MIDI...');
      if (!(await this.setupMidi())) {
        console.log('MIDI initialization failed, continuing without MIDI');
      }

      // Initialize MIDI input
      await this.setupMidiInput();

      // Set up event subscriptions
      this.setupEventSubscriptions();
      this.eventBus.resume();

      // Initialize tablet reader
      console.log('Initializing tablet reader...');
      await this.initializeReader();

      if (!this.reader) {
        this.sendError('Failed to initialize tablet reader');
        this.sendConnectionState('error');
        return false;
      }

      this.deviceConnected = true;
      this.sendConnectionState('connected');
      this.sendDeviceStatus();
      this.sendConfig();

      // Start reading
      this.reader.startReading((data) => {
        this.handlePacket(data);
      });

      console.log('IPC Bridge connected and reading tablet data');
      return true;
    } catch (error) {
      console.error('Failed to connect:', error);
      this.sendError(`Failed to connect: ${error}`);
      this.sendConnectionState('error');
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // Stop waiting for USB device events
    this.stopWaitingForDevice();

    this.eventBus.pause();

    if (this.combinedUnsubscribe) {
      this.combinedUnsubscribe();
      this.combinedUnsubscribe = null;
    }

    if (this.reader) {
      this.reader.stopReading();
      await this.reader.close();
      this.reader = null;
    }

    if (this.backend) {
      this.backend.disconnect();
      this.backend = null;
    }

    if (this.midiInput) {
      this.midiInput.disconnect();
      this.midiInput = null;
    }

    this.deviceConnected = false;
    this.tabletConfig = null;
    this.sendConnectionState('disconnected');
    this.sendDeviceStatus();
  }

  /**
   * Start the IPC bridge - required by TabletReaderBase
   * For the IPC bridge, we use connect() instead which is called via IPC
   */
  async start(): Promise<void> {
    // The IPC bridge uses connect() instead of start()
    // This is called via IPC from the renderer process
    await this.connect();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getConfig(): unknown {
    return {
      notes: this.strummer.notes.map((n) => ({
        notation: n.notation,
        octave: n.octave,
      })),
      config: this.config.toDict(),
      serverVersion: '1.0.0-electron',
      deviceCapabilities: this.tabletConfig?.getCapabilities() ?? undefined,
    };
  }

  updateConfig(path: string, value: unknown): void {
    try {
      this.setConfigValue(path, value);

      if (path.startsWith('strummer.strumming.')) {
        this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);
      }

      if (path.includes('chord') || path.includes('Spread') || path.includes('initialNotes')) {
        this.setupNotes();
      }

      console.log(`Config updated: /Users/farrell/Library/pnpm:/Users/farrell/.nvm/versions/node/v20.19.3/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin/python3:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/usr/local/sbin = ${JSON.stringify(value)}`);
      this.sendConfig();
    } catch (e) {
      console.error(`Failed to update config: /Users/farrell/Library/pnpm:/Users/farrell/.nvm/versions/node/v20.19.3/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin/python3:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/usr/local/sbin`, e);
    }
  }

  saveConfig(): boolean {
    if (!this.strummerConfigPath) {
      console.log('No config file path - config was not loaded from a file');
      return false;
    }

    try {
      const configJson = JSON.stringify(this.config.toDict(), null, 2);
      fs.writeFileSync(this.strummerConfigPath, configJson, 'utf-8');
      console.log(`Configuration saved to ${this.strummerConfigPath}`);
      return true;
    } catch (e) {
      console.error('Failed to save configuration:', e);
      return false;
    }
  }

  getMidiInputStatus(): unknown {
    if (!this.midiInput) {
      return {
        connected: false,
        availablePorts: [],
        connectedPort: null,
        currentNotes: [],
      };
    }

    return {
      connected: this.midiInput.isConnected,
      availablePorts: this.midiInputAvailablePorts,
      connectedPort: this.midiInput.connectedPorts[0]?.name ?? null,
      currentNotes: this.midiInput.notes,
    };
  }

  async connectMidiInput(portId: number): Promise<boolean> {
    if (!this.midiInput) return false;
    return await this.midiInput.connect(portId);
  }

  disconnectMidiInput(): void {
    if (this.midiInput) {
      this.midiInput.disconnect();
    }
  }

  private snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  private setConfigValue(path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const camelPart = this.snakeToCamel(part);

      if (current[camelPart] !== undefined && current[camelPart] !== null) {
        current = current[camelPart] as Record<string, unknown>;
      } else if (current[part] !== undefined && current[part] !== null) {
        current = current[part] as Record<string, unknown>;
      } else {
        throw new Error(`Invalid path: /Users/farrell/Library/pnpm:/Users/farrell/.nvm/versions/node/v20.19.3/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin/python3:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/usr/local/sbin`);
      }
    }

    const lastPart = parts[parts.length - 1];
    const camelLastPart = this.snakeToCamel(lastPart);

    if (camelLastPart in current || !(lastPart in current)) {
      current[camelLastPart] = value;
    } else {
      current[lastPart] = value;
    }
  }
}

// Singleton instance
let bridge: IPCBridge | null = null;

/**
 * Set up IPC handlers for the bridge
 */
export function setupIPCBridge(mainWindow: BrowserWindow): void {
  // Create bridge (tablet config will be loaded on connect)
  bridge = new IPCBridge();
  bridge.setMainWindow(mainWindow);

  // Connection management
  ipcMain.handle('bridge:connect', async (_event, configPath?: string) => {
    if (!bridge) return false;
    return await bridge.connect(configPath);
  });

  ipcMain.handle('bridge:disconnect', async () => {
    if (!bridge) return;
    await bridge.disconnect();
  });

  ipcMain.handle('bridge:getConnectionState', () => {
    if (!bridge) return 'disconnected';
    return bridge.getConnectionState();
  });

  // Config management
  ipcMain.handle('bridge:getConfig', () => {
    if (!bridge) return null;
    return bridge.getConfig();
  });

  ipcMain.handle('bridge:updateConfig', (_event, path: string, value: unknown) => {
    if (!bridge) return;
    bridge.updateConfig(path, value);
  });

  ipcMain.handle('bridge:saveConfig', () => {
    if (!bridge) return false;
    return bridge.saveConfig();
  });

  // MIDI input management
  ipcMain.handle('bridge:getMidiInputStatus', () => {
    if (!bridge) return null;
    return bridge.getMidiInputStatus();
  });

  ipcMain.handle('bridge:connectMidiInput', async (_event, portId: number) => {
    if (!bridge) return false;
    return await bridge.connectMidiInput(portId);
  });

  ipcMain.handle('bridge:disconnectMidiInput', () => {
    if (!bridge) return;
    bridge.disconnectMidiInput();
  });
}

/**
 * Clean up the IPC bridge
 */
export function cleanupIPCBridge(): void {
  if (bridge) {
    bridge.disconnect();
    bridge = null;
  }

  // Remove all IPC handlers
  ipcMain.removeHandler('bridge:connect');
  ipcMain.removeHandler('bridge:disconnect');
  ipcMain.removeHandler('bridge:getConnectionState');
  ipcMain.removeHandler('bridge:getConfig');
  ipcMain.removeHandler('bridge:updateConfig');
  ipcMain.removeHandler('bridge:saveConfig');
  ipcMain.removeHandler('bridge:getMidiInputStatus');
  ipcMain.removeHandler('bridge:connectMidiInput');
  ipcMain.removeHandler('bridge:disconnectMidiInput');
}
