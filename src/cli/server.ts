#!/usr/bin/env node
/**
 * Strummer WebSocket Server
 *
 * A WebSocket server that broadcasts tablet and strum events from the MIDI Strummer.
 *
 * Usage:
 *   npm run server
 *   npm run server -- --ws-port 8081
 *   npm run server -- --throttle 100
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Vendored tablet client (composition-based OTD wrapper)
import { TabletClient, waitForDevice, type DeviceCapabilities as TabletClientCapabilities } from '../tablet/tabletClient.js';
import type { TabletEvent } from '../tablet/server/eventAdapter.js';

// Version (from package.json)
const SKETCHATONE_VERSION = '0.2.0';
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { Slider, routeSlideEventToMidi, type SlideRoutingState } from '../core/slider.js';
import { Actions } from '../core/actions.js';
import { MidiStrummerConfig, type MidiStrummerConfigData, DeviceButtonsConfig } from '../models/midi-strummer-config.js';
import { ActionRulesConfig, type ButtonId } from '../models/action-rules.js';
import { StrumReleaseConfig } from '../models/strummer-features.js';
import { StrummingConfig } from '../models/strummer-config.js';
import { ParameterMapping } from '../models/parameter-mapping.js';
import { Note, type NoteObject } from '../models/note.js';
import { mapMidiInputToStrummerNotes } from '../core/midi-input-mapper.js';
import { RtMidiBackend } from '../midi/rtmidi-backend.js';
import { MidiStrummerBridge } from '../midi/bridge.js';
import type { MidiBackendProtocol } from '../midi/protocol.js';
import { RtMidiInput, MIDI_INPUT_NOTE_EVENT, type MidiInputNoteEvent } from '../midi/rtmidi-input.js';
import {
  strummerEventBus,
  StrummerEventBus,
  type TabletEventData,
  type StrumEventData,
  type StrumNoteEventData,
  type CombinedEventData,
} from '../utils/strummer-event-bus.js';
import { KeyboardListener } from '../utils/keyboard-listener.js';
import { generateSelfSignedCert, loadSSLCert, getSSLCertPaths } from '../utils/ssl-cert.js';

/**
 * WebSocket tablet event envelope
 */
interface TabletWebSocketEvent extends CombinedEventData {
  type: 'tablet-data';
}

/**
 * Action executed event data
 */
interface ActionExecutedEvent {
  action: string;
  params: unknown[];
  button?: string;
  trigger?: string;
  timestamp: number;
  ruleId?: string;
  isStartup?: boolean;
}

/**
 * Get the local network IP address (for LAN access)
 */
function getLocalIP(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

/**
 * Full config data sent to clients on connection
 */
interface ServerConfigData {
  /** Event throttle in milliseconds */
  throttleMs: number;
  /** Current notes (computed from chord or initial notes) */
  notes: Array<{ notation: string; octave: number }>;
  /** Full strummer configuration */
  config: MidiStrummerConfigData;
  /** Device capabilities from the matched OTD tablet configuration */
  deviceCapabilities?: TabletClientCapabilities;
  /** Current config file name (without path) */
  currentConfigName?: string;
  /** List of available config files in the config directory */
  availableConfigs?: string[];
  /** True when config represents the saved state (after load/save), false for updates */
  isSavedState?: boolean;
}

/**
 * Strummer WebSocket Server
 *
 * Reads tablet events, processes strums, and broadcasts to WebSocket clients.
 * Sends combined events with both tablet data and strum data merged together.
 *
 * Supports running without a tablet connected - will wait for device and handle
 * hot-plugging (disconnect/reconnect) gracefully.
 */
// MIME type mapping for static file serving
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

class StrummerWebSocketServer {
  // Tablet client (composition-based OTD wrapper); null when no device is connected
  // or when running in --dev mode.
  private tabletClient: TabletClient | null = null;
  private devMode: boolean = false;
  private devicePollInterval: number | null = null;
  private devicePollTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownHandlersInstalled: boolean = false;

  private wss: WebSocketServer | null = null;
  private wssSecure: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private httpsServer: https.Server | null = null;
  private wsPort: number;
  private wssPort: number | undefined;
  private httpPort: number | undefined;
  private httpsPort: number | undefined;
  private config: MidiStrummerConfig;
  private strummer: Strummer;
  private slider: Slider;
  // Slide-mode state: currently held note (for routing slide_update/slide_off) and
  // last aftertouch/CC value sent (for dedup; reset on slide_off / mode switch).
  private slideState: SlideRoutingState = { activeSlideNote: null, lastModulationValue: null };
  private eventBus: StrummerEventBus;
  private combinedUnsubscribe: (() => void) | null = null;
  private clientCount: number = 0;
  private deviceConnected: boolean = false;
  // Ephemeral (per-server-run) flag: when true, aux codes we haven't seen before
  // are auto-appended to deviceButtons.buttons. Toggled by clients via the
  // 'set-button-detection' message; never persisted.
  private detectingDeviceButtons: boolean = false;
  private publicDir: string;
  // MIDI support
  private backend: MidiBackendProtocol | null = null;
  private bridge: MidiStrummerBridge | null = null;
  private midiInput: RtMidiInput | null = null;
  private midiInputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private midiInputAvailablePorts: { id: number; name: string }[] = [];
  public notesPlayed: number = 0;
  private actions: Actions;
  private keyboardListener: KeyboardListener | null = null;
  private keyboardButtonStates: Map<string, boolean> = new Map();

  // State tracking for stylus buttons
  private buttonState = {
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
  };

  // State tracking for auxiliary hardware buttons - previous set of HID scan codes
  // so we can diff against the next report to emit press/release events.
  private prevAuxCodes: Set<number> = new Set();

  // State tracking for note repeater
  private repeaterState = {
    notes: [] as StrumNoteData[],
    lastRepeatTime: 0,
    isHolding: false,
  };

  // State tracking for strum release feature
  private strumStartTime: number = 0;

  // State tracking for pitch bend throttling
  private lastPitchBendTime: number = 0;
  private lastPitchBendValue: number | null = null;

  // Path to the strummer config file (for saving)
  private strummerConfigPath: string | undefined;

  // Directory containing strummer config files
  private strummerConfigDir: string | undefined;

  // Current config file name (without path)
  private currentConfigName: string | undefined;

  constructor(
    options: {
      strummerConfigPath?: string;
      wsPort?: number;
      wssPort?: number;
      httpPort?: number;
      httpsPort?: number;
      throttleMs?: number;
      // MIDI options
      midiChannel?: number;
      midiPort?: string | number;
      noteDuration?: number;
      // Tablet options
      devMode?: boolean;
      devicePollInterval?: number | null;
    } = {}
  ) {
    this.devMode = options.devMode ?? false;
    this.devicePollInterval = options.devicePollInterval ?? null;

    // Store the config path for saving later
    this.strummerConfigPath = options.strummerConfigPath;

    // Extract config directory and filename
    if (options.strummerConfigPath) {
      this.strummerConfigDir = path.dirname(options.strummerConfigPath);
      this.currentConfigName = path.basename(options.strummerConfigPath);
    } else {
      // Set default config directory when no config file specified
      this.strummerConfigDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/configs');
      // Try to load default.json if it exists
      const defaultConfigPath = path.join(this.strummerConfigDir, 'default.json');
      if (fs.existsSync(defaultConfigPath)) {
        this.strummerConfigPath = defaultConfigPath;
        this.currentConfigName = 'default.json';
      } else {
        this.currentConfigName = undefined;
      }
    }

    // Load combined config from file or use defaults
    if (this.strummerConfigPath) {
      this.config = MidiStrummerConfig.fromJsonFile(this.strummerConfigPath);
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

    // CLI args take precedence over config file values
    this.wsPort = options.wsPort ?? this.config.wsPort ?? 8081;
    this.wssPort = options.wssPort ?? this.config.wssPort ?? undefined;
    this.httpPort = options.httpPort ?? this.config.httpPort ?? undefined;
    this.httpsPort = options.httpsPort ?? this.config.httpsPort ?? undefined;
    // Resolve public directory relative to the package root
    // Built webapp files are in dist/public
    this.publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

    // Create event bus with throttle for WebSocket (reduces network traffic)
    this.eventBus = new StrummerEventBus(options.throttleMs ?? this.config.wsMessageThrottle ?? 150);

    // Create strummer
    this.strummer = new Strummer();
    this.strummer.configure(this.config.pressureThreshold, this.config.strumming.pressureBufferSize);

    // Create slider (trombone-style controller); notes are kept in sync with the strummer
    this.slider = new Slider();
    this.slider.configure(
      this.config.strummer.slide.pressureThreshold,
      this.config.strummer.slide.maxBendSemitones,
    );

    // Set up notes
    this.setupNotes();

    // Listen for notes_changed events to broadcast config updates
    // This ensures the visualizer updates when actions change the chord
    this.strummer.on('notes_changed', () => {
      this.broadcastConfig();
    });

    // Create Actions handler for stylus buttons
    // Pass the actual config object so Actions can access live values
    // (e.g., lowerSpread/upperSpread that may be updated via UI)
    this.actions = new Actions(this.config, this.strummer, this.config.strummer.chordProgressions);

    // Configure action rules so button-to-action mapping works
    this.actions.setActionRulesConfig(this.config.strummer.actionRules);

    // Listen for action events to broadcast to clients
    this.actions.on('action_executed', (event: ActionExecutedEvent) => {
      this.broadcastActionEvent(event);
    });

    // Execute any startup rules defined in the config
    this.actions.executeStartupRules();

    // Initialize keyboard listener if enabled. Emits raw key names; the server
    // gates learning through `detectingDeviceButtons` and dispatches actions as
    // `key:<char>` button events.
    if (this.config.keyboard.enabled) {
      this.keyboardListener = new KeyboardListener({
        enabled: this.config.keyboard.enabled,
        onKeyPress: (key) => this.handleKeyboardKeyPress(key),
        onKeyRelease: (key) => this.handleKeyboardKeyRelease(key),
      });
    }
  }

  /**
   * Handle HTTP requests for static file serving
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let urlPath = req.url || '/';

    // Default to index.html for root
    if (urlPath === '/') {
      urlPath = '/index.html';
    }

    // Prevent directory traversal
    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(this.publicDir, safePath);

    // Check if file exists and is within publicDir
    if (!filePath.startsWith(this.publicDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    fs.promises.stat(filePath)
      .then((stat) => {
        if (stat.isDirectory()) {
          // Try to serve index.html from directory
          const indexPath = path.join(filePath, 'index.html');
          return fs.promises.stat(indexPath).then(() => indexPath);
        }
        return filePath;
      })
      .then((resolvedPath) => {
        const ext = path.extname(resolvedPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        return fs.promises.readFile(resolvedPath).then((content) => {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        });
      })
      .catch(() => {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });
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

    // Apply spread to both chord and initialNotes
    const notes = Note.fillNoteSpread(
      baseNotes,
      this.config.strummer.lowerSpread,
      this.config.strummer.upperSpread
    );

    this.strummer.notes = notes;
    this.slider.notes = notes;
  }

  /**
   * Get the control input value based on the control type.
   *
   * @param control - Control source type
   * @param inputs - Object containing input values
   * @returns Normalized control value (0.0 to 1.0), or null if control is "none"
   */
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
      case 'none':
        return null;
      case 'pressure':
        return inputs.pressure ?? 0;
      case 'tiltX':
        // tiltX is -1 to 1, normalize to 0-1
        return ((inputs.tiltX ?? 0) + 1.0) / 2.0;
      case 'tiltY':
        // tiltY is -1 to 1, normalize to 0-1
        return ((inputs.tiltY ?? 0) + 1.0) / 2.0;
      case 'tiltXY':
        // tiltXY is -1 to 1, normalize to 0-1
        return ((inputs.tiltXY ?? 0) + 1.0) / 2.0;
      case 'xaxis':
        return inputs.x ?? 0.5;
      case 'yaxis':
        return inputs.y ?? 0.5;
      case 'velocity':
        return inputs.pressureVelocity ?? inputs.pressure ?? 0;
      default:
        return null;
    }
  }

  /**
   * Initialize MIDI backend and bridge
   */
  private async setupMidi(): Promise<boolean> {
    try {
      this.backend = new RtMidiBackend({
        channel: this.config.channel,
        useVirtualPorts: this.config.useVirtualPorts,
      });

      // Connect backend
      const port = this.config.outputPort;
      if (!(await this.backend.connect(port))) {
        console.error(chalk.red('Failed to connect MIDI backend'));
        return false;
      }

      // Create bridge
      this.bridge = new MidiStrummerBridge(this.strummer, this.backend, {
        noteDuration: this.config.noteDuration.default,
        autoConnect: false, // We'll handle events manually
      });

      return true;
    } catch (error) {
      console.error(chalk.red(`MIDI backend not available: ${error}`));
      return false;
    }
  }

  /**
   * Register MIDI input callback for note events
   * Extracted to allow re-registration after reconnection
   */
  private registerMidiInputCallback(): void {
    if (!this.midiInput) return;

    // Listen for note events with debounce logic
    // Similar to browser-side implementation: only update strummer when notes are held,
    // and use debounce to handle rapid releases when releasing a chord
    this.midiInput.on<MidiInputNoteEvent>(MIDI_INPUT_NOTE_EVENT, (event) => {
      // Broadcast MIDI input event to all clients (for UI display)
      this.broadcastMidiInput(event);

      // Clear any pending debounce timer
      if (this.midiInputDebounceTimer) {
        clearTimeout(this.midiInputDebounceTimer);
        this.midiInputDebounceTimer = null;
      }

      if (event.added) {
        // Note was added - update immediately
        this.updateNotesFromMidiInput(event.notes);
      } else if (event.removed) {
        // Note was removed - debounce to handle rapid releases
        this.midiInputDebounceTimer = setTimeout(() => {
          this.midiInputDebounceTimer = null;
          // Only update if there are still notes held
          // If all notes released, keep the last chord
          if (this.midiInput && this.midiInput.notes.length > 0) {
            this.updateNotesFromMidiInput(this.midiInput.notes);
          }
        }, 100); // 100ms debounce
      }
    });

    console.log(chalk.gray('[MIDI Input] Callback registered'));
  }

  /**
   * Register MIDI passthrough for forwarding input to output
   * Similar to Python implementation
   */
  private registerMidiPassthrough(): void {
    if (!this.midiInput || !this.backend) {
      return;
    }

    const passthroughConnections = this.config.midi.midiPassthrough || [];
    if (passthroughConnections.length === 0) {
      console.log(chalk.gray('[MIDI Passthrough] No passthrough connections configured'));
      return;
    }

    console.log(chalk.cyan('[MIDI Passthrough] Registering passthrough callback...'));

    // Create a passthrough callback that forwards MIDI messages
    const passthroughCallback = (message: number[], portId: number, portName: string): void => {
      // Check if this input port has any passthrough connections
      for (const connection of passthroughConnections) {
        const inputPort = connection.inputPort;

        // Match by port ID or name
        if (inputPort === portId || inputPort === portName) {
          // Forward the MIDI message to the output backend
          try {
            if (this.backend && this.backend.isConnected) {
              // Send raw MIDI message through the backend
              // RtMidiBackend has _midiOut.sendMessage() for sending raw bytes
              if (this.backend instanceof RtMidiBackend && (this.backend as any)._midiOut) {
                (this.backend as any)._midiOut.sendMessage(message);
              } else {
                console.log(chalk.yellow('[MIDI Passthrough] Warning: Backend does not support raw MIDI send'));
              }
            }
          } catch (error) {
            console.error(chalk.red(`[MIDI Passthrough] Error forwarding message: ${error}`));
          }
        }
      }
    };

    this.midiInput.setPassthroughCallback(passthroughCallback);
    console.log(chalk.gray('[MIDI Passthrough] Callback registered'));
  }

  /**
   * Initialize MIDI input for external keyboard.
   * Supports multiple connection modes:
   * - Array of port IDs: Connect to specific selected ports
   * - Empty array: No connection (user has disabled all inputs)
   * - null (legacy): Connect to all available ports with exclusions
   * - Single value (legacy): Connect to specific port
   */
  private async setupMidiInput(): Promise<boolean> {
    try {
      this.midiInput = new RtMidiInput();
      const inputPort = this.config.inputPort;

      // Get available ports for UI display
      this.midiInputAvailablePorts = await this.midiInput.getAvailablePorts();
      console.log(chalk.gray(`[MIDI Input] Available ports: ${this.midiInputAvailablePorts.map(p => p.name).join(', ') || 'none'}`));

      let connected = false;

      if (Array.isArray(inputPort)) {
        // Array of port IDs - connect to multiple specific ports
        if (inputPort.length === 0) {
          // Empty array = user explicitly disabled all inputs
          console.log(chalk.yellow('[MIDI Input] No ports selected - staying disconnected'));
          connected = false;
        } else {
          // Connect to selected ports
          console.log(chalk.cyan(`[MIDI Input] Connecting to selected ports: ${JSON.stringify(inputPort)}`));
          const excludePorts: string[] = [...this.config.midi.inputExclude];
          connected = await this.midiInput.connectMultiple(inputPort, excludePorts);
        }
      } else if (inputPort === null || inputPort === undefined) {
        // Legacy: Discovery mode - listen to all ports (except excluded ones)
        const excludePorts: string[] = [...this.config.midi.inputExclude];
        console.log(chalk.gray(`[MIDI Input] Connecting to all ports, excluding: ${excludePorts.join(', ')}`));
        connected = await this.midiInput.connectAll(excludePorts);
      } else {
        // Legacy: Specific port mode - restore saved port
        console.log(chalk.cyan(`[MIDI Input] Restoring saved port: ${inputPort}`));
        connected = await this.midiInput.connect(inputPort);
      }

      if (!connected) {
        console.log(chalk.yellow('[MIDI Input] No MIDI input ports connected'));
        return false;
      }

      // Register the callback for note events
      this.registerMidiInputCallback();

      // Register MIDI passthrough if configured
      this.registerMidiPassthrough();

      return true;
    } catch (error) {
      console.error(chalk.red(`MIDI input not available: ${error}`));
      return false;
    }
  }

  /**
   * Broadcast MIDI input event to all connected clients
   */
  private broadcastMidiInput(event: MidiInputNoteEvent): void {
    if (!this.wss) return;

    // Get currently connected port name
    const connectedPort = this.midiInput?.connectedPorts[0]?.name ?? null;

    const midiInputMessage = {
      type: 'midi-input',
      notes: event.notes,
      added: event.added,
      removed: event.removed,
      portName: event.portName,
      availablePorts: this.midiInputAvailablePorts,
      connectedPort,
    };

    const data = JSON.stringify(midiInputMessage);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Broadcast action event to all connected clients
   */
  private broadcastActionEvent(event: ActionExecutedEvent): void {
    if (!this.wss) return;

    const actionMessage = {
      type: 'action-event',
      ...event,
    };

    const data = JSON.stringify(actionMessage);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Handle raw keyboard press. Learns the key when detection is on, updates
   * the pressed-key state, dispatches a `key:<char>` action event, and emits a
   * synthetic tablet event so the UI can show pressed-key indicators.
   */
  private handleKeyboardKeyPress(key: string): void {
    this.maybeLearnDeviceKey(key);
    const buttonId = `key:${key}` as ButtonId;
    this.keyboardButtonStates.set(buttonId, true);
    this.actions.handleButtonEvent(buttonId, 'press');
    this.emitKeyboardTabletEvent();
  }

  private handleKeyboardKeyRelease(key: string): void {
    const buttonId = `key:${key}` as ButtonId;
    this.keyboardButtonStates.set(buttonId, false);
    this.actions.handleButtonEvent(buttonId, 'release');
    this.emitKeyboardTabletEvent();
  }

  /**
   * Emit a synthetic tablet event carrying the currently-held keyboard keys
   * as `pressedKeys` so the dashboard can highlight them alongside auxCodes.
   */
  private emitKeyboardTabletEvent(): void {
    const pressedKeys: string[] = [];
    for (const [buttonId, isPressed] of this.keyboardButtonStates.entries()) {
      if (!isPressed) continue;
      if (buttonId.startsWith('key:')) pressedKeys.push(buttonId.slice(4));
    }

    const tabletData: TabletEventData = {
      x: 0.5,
      y: 0.5,
      pressure: 0.0,
      tiltX: 0.0,
      tiltY: 0.0,
      tiltXY: 0.0,
      primaryButtonPressed: false,
      secondaryButtonPressed: false,
      state: 'out-of-range',
      timestamp: Date.now(),
      auxCodes: [],
      pressedKeys,
    };

    this.eventBus.emitTabletEvent(tabletData);
  }

  /**
   * Send MIDI input status to a specific client
   */
  private sendMidiInputStatus(client: WebSocket): void {
    if (!this.midiInput) return;

    // Get currently connected port name
    const connectedPort = this.midiInput.connectedPorts[0]?.name ?? null;

    const midiInputMessage = {
      type: 'midi-input-status',
      connected: this.midiInput.isConnected,
      availablePorts: this.midiInputAvailablePorts,
      connectedPort,
      currentNotes: this.midiInput.notes,
    };

    client.send(JSON.stringify(midiInputMessage));
  }

  /**
   * Update strummer notes from MIDI input.
   *
   * Routes the held MIDI notes through the configured `midi.inputMode`
   * mapper (direct / majorScale / minorScale / autoScale) and assigns the
   * resulting base notes as the strummer's initialNotes. `setupNotes()`
   * then applies the upper/lower note spread on top.
   */
  private updateNotesFromMidiInput(noteStrings: string[]): void {
    if (noteStrings.length === 0) return;

    const midiNotes: NoteObject[] = noteStrings.map((s) => Note.parseNotation(s));
    const mode = this.config.midi.inputMode;
    const baseNotes = mapMidiInputToStrummerNotes(midiNotes, mode);
    if (!baseNotes || baseNotes.length === 0) return;

    const baseNoteStrings = baseNotes.map((n) => `${n.notation}${n.octave}`);

    // Update the config's initialNotes
    this.config.strummer.strumming.initialNotes = baseNoteStrings;

    // Clear the chord property so setupNotes() uses initialNotes instead
    // This allows MIDI input to override any preset chord
    this.config.strummer.strumming.chord = undefined;

    // Reconfigure strummer with new notes
    this.setupNotes();

    // Broadcast config change to all connected clients
    this.broadcastConfig();

    console.log(chalk.cyan(`[MIDI Input ${mode}] Held: ${noteStrings.join(', ')} -> Notes: ${baseNoteStrings.join(', ')}`));
  }

  /**
   * Print MIDI configuration info
   */
  private printMidiConfig(): void {
    console.log(chalk.white.bold('MIDI Config:'));
    // Display channel as 1-16 for users (internally stored as 0-15), or 'omni' if undefined
    const channelDisplay = this.config.channel !== undefined && this.config.channel !== null ? String(this.config.channel + 1) : 'omni';
    console.log(chalk.cyan('  Channel: ') + chalk.white(channelDisplay));
    if (this.config.outputPort !== null) {
      console.log(chalk.cyan('  Output Port: ') + chalk.white(String(this.config.outputPort)));
    }
    if (this.config.inputPort !== null) {
      console.log(chalk.cyan('  Input Port: ') + chalk.white(String(this.config.inputPort)));
    }
    console.log(chalk.cyan('  Note Duration: ') + chalk.white(`${this.config.noteDuration.default}s`));
  }

  /**
   * Set the throttle interval
   */
  setThrottle(ms: number): void {
    this.eventBus.throttleMs = ms;
  }

  /**
   * Check if any clients are connected
   */
  private hasClients(): boolean {
    return this.clientCount > 0;
  }

  /**
   * Broadcast a tablet event to all connected clients
   */
  private broadcast(event: TabletWebSocketEvent): void {
    if (!this.wss) return;

    const data = JSON.stringify(event);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Send config to a specific client
   */
  private sendConfig(client: WebSocket, isSavedState = true): void {
    const configData: ServerConfigData = {
      throttleMs: this.eventBus.throttleMs,
      notes: this.strummer.notes.map((n) => ({
        notation: n.notation,
        octave: n.octave,
      })),
      config: this.config.toDict(),
      deviceCapabilities: this.tabletClient?.capabilities ?? undefined,
      currentConfigName: this.currentConfigName,
      availableConfigs: this.listConfigs(),
      isSavedState,
    };

    client.send(
      JSON.stringify({
        type: 'config',
        data: configData,
      })
    );
  }

  /**
   * Send device status to a specific client
   */
  private sendStatus(client: WebSocket): void {
    const statusMessage = {
      type: 'status',
      status: this.deviceConnected ? 'connected' : 'disconnected',
      deviceConnected: this.deviceConnected,
      message: this.deviceConnected ? 'Tablet connected' : 'Waiting for tablet...',
      timestamp: Date.now(),
    };

    client.send(JSON.stringify(statusMessage));
  }

  /**
   * Broadcast config to all connected clients
   */
  private broadcastConfig(isSavedState = false): void {
    if (!this.wss) return;

    const configData: ServerConfigData = {
      throttleMs: this.eventBus.throttleMs,
      notes: this.strummer.notes.map((n) => ({
        notation: n.notation,
        octave: n.octave,
      })),
      config: this.config.toDict(),
      deviceCapabilities: this.tabletClient?.capabilities ?? undefined,
      currentConfigName: this.currentConfigName,
      availableConfigs: this.listConfigs(),
      isSavedState,
    };

    const message = JSON.stringify({
      type: 'config',
      data: configData,
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Broadcast device status to all connected WebSocket clients
   */
  private broadcastStatus(status: 'connected' | 'disconnected', message: string): void {
    if (!this.wss) return;

    const statusMessage = {
      type: 'status',
      status,
      deviceConnected: this.deviceConnected,
      message,
      timestamp: Date.now(),
    };

    const messageStr = JSON.stringify(statusMessage);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  /**
   * Handle disconnection reported by the TabletClient reader. Notifies clients
   * and, if a poll interval is configured, begins polling for a reconnection.
   */
  private handleTabletDisconnect(): void {
    if (!this.deviceConnected) return;
    this.deviceConnected = false;
    this.prevAuxCodes.clear();
    console.log(chalk.yellow('[Tablet] Device disconnected'));
    this.broadcastStatus('disconnected', 'Tablet disconnected, waiting for reconnection...');

    if (this.tabletClient) {
      try { this.tabletClient.stop(); } catch { /* ignore */ }
      this.tabletClient = null;
    }
    this.startDevicePolling();
  }

  /**
   * Poll for a tablet device to (re)appear and start reading from it. Uses
   * `devicePollInterval` from options/config; a null/undefined value means
   * no polling (used when the user wants the server to exit if no device is
   * found).
   */
  private startDevicePolling(): void {
    if (this.devMode) return;
    if (this.devicePollTimer) return;
    const interval = this.devicePollInterval;
    if (interval == null) return;

    const poll = async (): Promise<void> => {
      this.devicePollTimer = null;
      try {
        const client = await TabletClient.discover();
        if (client) {
          await this.attachTabletClient(client);
          return;
        }
      } catch (e) {
        console.log(chalk.gray(`[Tablet] Discovery error: ${(e as Error).message}`));
      }
      this.devicePollTimer = setTimeout(poll, interval);
    };
    this.devicePollTimer = setTimeout(poll, interval);
  }

  /**
   * Attach a TabletClient, start reading events, and notify WebSocket clients.
   */
  private async attachTabletClient(client: TabletClient): Promise<void> {
    this.tabletClient = client;
    this.prevAuxCodes.clear();
    await client.start({
      onEvent: (event) => this.onTabletEvent(event),
      onDisconnect: () => this.handleTabletDisconnect(),
    });
    this.deviceConnected = true;
    const caps = client.capabilities;
    console.log(chalk.green(`✓ Tablet connected: ${caps.manufacturer} ${caps.model}`));
    console.log(chalk.gray(`  Aux buttons: ${caps.auxButtonCount}, pen buttons: ${caps.penButtonCount}`));
    this.broadcastStatus('connected', 'Tablet connected');
    // Config changed (deviceCapabilities is now known) - push to clients.
    this.broadcastConfig(false);
  }

  /**
   * Install SIGINT/SIGTERM handlers that gracefully stop the server.
   */
  private setupShutdownHandlers(): void {
    if (this.shutdownHandlersInstalled) return;
    this.shutdownHandlersInstalled = true;
    const shutdown = async (): Promise<void> => {
      await this.stop();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('unhandledRejection', async (err) => {
      console.error(chalk.red('[Server] unhandledRejection:'), err);
      await shutdown();
    });
    process.on('uncaughtException', async (err) => {
      console.error(chalk.red('[Server] uncaughtException:'), err);
      await shutdown();
    });
  }

  /**
   * Handle a config update from a client
   * Updates the config and broadcasts the new config to all clients
   */
  private handleConfigUpdate(path: string, value: unknown): void {
    try {
      // Capture old mode so we can detect a strum <-> slide transition
      const previousMode = this.config.strummer.mode;

      // Update the config using the path
      this.setConfigValue(path, value);

      // Re-apply strummer settings if relevant
      if (path.startsWith('strummer.strumming.')) {
        this.strummer.configure(this.config.pressureThreshold, this.config.strumming.pressureBufferSize);
      }

      // Re-apply slider settings if relevant
      if (path.startsWith('strummer.slide.')) {
        this.slider.configure(
          this.config.strummer.slide.pressureThreshold,
          this.config.strummer.slide.maxBendSemitones,
        );
      }

      // Release any held notes and reset controller state when the top-level mode changes
      if (path === 'strummer.mode' && this.config.strummer.mode !== previousMode) {
        this.clearControllerState();
      }

      // Re-setup notes if chord or note spread changed
      if (path.includes('chord') || path.includes('Spread') || path.includes('initialNotes')) {
        this.setupNotes();
      }

      // Update chord progressions in Actions if they changed
      if (path === 'strummer.chordProgressions') {
        this.actions.setChordProgressions(this.config.strummer.chordProgressions);
      }

      // Update action rules if they changed
      if (path === 'strummer.actionRules') {
        this.actions.setActionRulesConfig(this.config.strummer.actionRules);
      }

      // Re-apply action rules if they changed
      if (path.includes('actionRules') || path.includes('action_rules')) {
        this.actions.setActionRulesConfig(this.config.strummer.actionRules);
        // Re-execute startup rules to apply new chord progression
        this.actions.executeStartupRules();
      }

      // Reconnect MIDI output if port changed
      if (path === 'midi.midiOutputId' && this.backend) {
        console.log(chalk.cyan(`[MIDI Output] Reconnecting to port: ${value}`));
        this.backend.disconnect();
        this.backend.connect(value as string | number | null).then((success) => {
          if (success) {
            console.log(chalk.green(`[MIDI Output] Reconnected successfully`));
          } else {
            console.log(chalk.red(`[MIDI Output] Failed to reconnect`));
          }
        });
      }

      // Reconnect MIDI input if port changed
      if (path === 'midi.midiInputId' && this.midiInput) {
        console.log(chalk.cyan(`[MIDI Input] Reconnecting to port(s): ${JSON.stringify(value)}`));
        this.midiInput.disconnect();

        let connectPromise: Promise<boolean>;

        if (Array.isArray(value)) {
          // Array of port IDs - connect to multiple specific ports
          if (value.length === 0) {
            // Empty array = disconnect all
            console.log(chalk.yellow('[MIDI Input] Disconnecting all ports (empty selection)'));
            connectPromise = Promise.resolve(false);
          } else {
            // Connect to selected ports
            const excludePorts = [...this.config.midi.inputExclude];
            connectPromise = this.midiInput.connectMultiple(value, excludePorts);
          }
        } else if (value === null) {
          // Legacy: Connect to all ports
          const excludePorts = [...this.config.midi.inputExclude];
          connectPromise = this.midiInput.connectAll(excludePorts);
        } else {
          // Legacy: Single port
          connectPromise = this.midiInput.connect(value as string | number);
        }

        connectPromise.then((success) => {
          if (success) {
            const portCount = this.midiInput?.connectedPorts.length ?? 0;
            console.log(chalk.green(`[MIDI Input] Reconnected to ${portCount} port(s)`));
            // Re-register callbacks after reconnection
            this.registerMidiInputCallback();
            this.registerMidiPassthrough();
          }
          // Always broadcast device status to update UI (even on disconnect)
          this.broadcastMidiDevices();
        });
      }

      // Re-register MIDI passthrough if passthrough config changed
      if (path === 'midi.midiPassthrough' || path === 'midi.midi_passthrough') {
        console.log(chalk.cyan('[MIDI Passthrough] Configuration changed, re-registering...'));
        this.registerMidiPassthrough();
      }

      // Persist every config change immediately so it survives a
      // restart. The Save/Revert affordances have been retired; all
      // in-memory mutations round-trip to disk right away.
      this.persistConfigToFile();

      console.log(chalk.yellow(`Config updated: ${path} = ${JSON.stringify(value)}`));

      // Every update is auto-persisted above, so the broadcast reports
      // the saved state directly.
      this.broadcastConfig(true);
    } catch (e) {
      console.error(chalk.red(`Failed to update config: ${path}`), e);
    }
  }

  /**
   * Write the current in-memory config to disk (if a file path is configured).
   * Used by auto-learn and other server-initiated config mutations.
   */
  private persistConfigToFile(): void {
    if (!this.strummerConfigPath) return;
    try {
      const configJson = JSON.stringify(this.config.toDict(), null, 2);
      fs.writeFileSync(this.strummerConfigPath, configJson, { encoding: 'utf-8' });
      fs.chmodSync(this.strummerConfigPath, 0o666);
    } catch (e) {
      console.error(chalk.red(`[Persist Config] Failed to write ${this.strummerConfigPath}:`), e);
    }
  }

  /**
   * If button detection is currently on and this aux code isn't already known,
   * append it to `deviceButtons.buttons` with a default name, persist, and
   * broadcast the updated config to all clients.
   */
  private maybeLearnDeviceButton(code: number): void {
    if (!this.detectingDeviceButtons) return;
    const dbc = this.config.deviceButtons;
    if (dbc.buttons.some(b => b.code === code)) return;

    const nextIndex = dbc.buttons.length + 1;
    dbc.buttons.push({ code, name: `Button ${nextIndex}` });
    console.log(chalk.cyan(`[Device Buttons] Learned new button: code=${code} name="Button ${nextIndex}"`));
    this.persistConfigToFile();
    this.broadcastConfig(true);
  }

  /**
   * If key detection is currently on and this key isn't already known,
   * append it to `deviceButtons.keys` with a default name, persist, and
   * broadcast the updated config to all clients.
   */
  private maybeLearnDeviceKey(key: string): void {
    if (!this.detectingDeviceButtons) return;
    if (!key) return;
    const dbc = this.config.deviceButtons;
    if (dbc.keys.some(k => k.key === key)) return;

    dbc.keys.push({ key, name: `Key ${key.toUpperCase()}` });
    console.log(chalk.cyan(`[Device Buttons] Learned new key: key="${key}" name="Key ${key.toUpperCase()}"`));
    this.persistConfigToFile();
    this.broadcastConfig(true);
  }

  /**
   * Broadcast the current button-detection state to all clients so UIs stay
   * in sync across multiple browser tabs.
   */
  private broadcastButtonDetectionState(): void {
    if (!this.wss) return;
    const message = JSON.stringify({
      type: 'button-detection-state',
      enabled: this.detectingDeviceButtons,
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  /**
   * Save the current configuration to the config file
   */
  private handleSaveConfig(): void {
    if (!this.strummerConfigPath) {
      console.log(chalk.red('[Save Config] No config file path - config was not loaded from a file'));
      return;
    }

    try {
      const configJson = JSON.stringify(this.config.toDict(), null, 2);
      fs.writeFileSync(this.strummerConfigPath, configJson, { encoding: 'utf-8' });
      // Set permissions explicitly (bypasses umask)
      fs.chmodSync(this.strummerConfigPath, 0o666);
      console.log(chalk.green(`[Save Config] Configuration saved to ${this.strummerConfigPath}`));
      // Broadcast with isSavedState=true so clients know config is now saved
      this.broadcastConfig(true);
    } catch (e) {
      console.error(chalk.red(`[Save Config] Failed to save configuration:`), e);
    }
  }

  /**
   * List all available config files in the config directory
   * Only returns .json files that are not in subdirectories
   */
  private listConfigs(): string[] {
    if (!this.strummerConfigDir) {
      return [];
    }

    try {
      const files = fs.readdirSync(this.strummerConfigDir);
      return files.filter((file) => {
        // Only include .json files
        if (!file.endsWith('.json')) return false;
        // Make sure it's a file, not a directory
        const fullPath = path.join(this.strummerConfigDir!, file);
        return fs.statSync(fullPath).isFile();
      });
    } catch (e) {
      console.error(chalk.red('[List Configs] Failed to list configs:'), e);
      return [];
    }
  }

  /**
   * Load a config file by name
   */
  private handleLoadConfig(configName: string): void {
    if (!this.strummerConfigDir) {
      console.log(chalk.red('[Load Config] No config directory set'));
      return;
    }

    const configPath = path.join(this.strummerConfigDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.strummerConfigDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      console.log(chalk.red('[Load Config] Invalid config path - path traversal detected'));
      return;
    }

    if (!fs.existsSync(configPath)) {
      console.log(chalk.red(`[Load Config] Config file not found: ${configName}`));
      return;
    }

    try {
      this.config = MidiStrummerConfig.fromJsonFile(configPath);
      this.strummerConfigPath = configPath;
      this.currentConfigName = configName;

      // Re-apply strummer/slider settings; release any held notes from the previous config
      this.clearControllerState();
      this.strummer.configure(this.config.pressureThreshold, this.config.strumming.pressureBufferSize);
      this.slider.configure(
        this.config.strummer.slide.pressureThreshold,
        this.config.strummer.slide.maxBendSemitones,
      );
      this.setupNotes();
      this.actions.setActionRulesConfig(this.config.strummer.actionRules);

      console.log(chalk.green(`[Load Config] Loaded config: ${configName}`));

      // Broadcast the new config to all clients (isSavedState=true since we just loaded from file)
      this.broadcastConfig(true);
    } catch (e) {
      console.error(chalk.red(`[Load Config] Failed to load config:`), e);
    }
  }

  /**
   * Create a new config file with default values
   */
  private handleCreateConfig(configName: string): void {
    if (!this.strummerConfigDir) {
      console.log(chalk.red('[Create Config] No config directory set'));
      return;
    }

    // Ensure the name ends with .json
    if (!configName.endsWith('.json')) {
      configName = configName + '.json';
    }

    const configPath = path.join(this.strummerConfigDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.strummerConfigDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      console.log(chalk.red('[Create Config] Invalid config path - path traversal detected'));
      return;
    }

    if (fs.existsSync(configPath)) {
      console.log(chalk.red(`[Create Config] Config file already exists: ${configName}`));
      return;
    }

    try {
      // Create a new config with defaults
      const newConfig = new MidiStrummerConfig();
      const configJson = JSON.stringify(newConfig.toDict(), null, 2);
      fs.writeFileSync(configPath, configJson, { encoding: 'utf-8' });
      // Set permissions explicitly (bypasses umask)
      fs.chmodSync(configPath, 0o666);

      console.log(chalk.green(`[Create Config] Created new config: ${configName}`));

      // Switch to the newly created config
      this.strummerConfigPath = configPath;
      this.currentConfigName = configName;
      this.config = newConfig;

      // Broadcast updated config to all clients (isSavedState=true since we just created/saved the file)
      this.broadcastConfig(true);
    } catch (e) {
      console.error(chalk.red(`[Create Config] Failed to create config:`), e);
    }
  }

  /**
   * Rename a config file
   */
  private handleRenameConfig(oldName: string, newName: string): void {
    if (!this.strummerConfigDir) {
      console.log(chalk.red('[Rename Config] No config directory set'));
      return;
    }

    // Ensure names end with .json
    if (!oldName.endsWith('.json')) oldName = oldName + '.json';
    if (!newName.endsWith('.json')) newName = newName + '.json';

    const oldPath = path.join(this.strummerConfigDir, oldName);
    const newPath = path.join(this.strummerConfigDir, newName);

    // Security check: ensure paths are within the config directory
    const resolvedOldPath = path.resolve(oldPath);
    const resolvedNewPath = path.resolve(newPath);
    const resolvedDir = path.resolve(this.strummerConfigDir);
    if (!resolvedOldPath.startsWith(resolvedDir) || !resolvedNewPath.startsWith(resolvedDir)) {
      console.log(chalk.red('[Rename Config] Invalid config path - path traversal detected'));
      return;
    }

    if (!fs.existsSync(oldPath)) {
      console.log(chalk.red(`[Rename Config] Config file not found: ${oldName}`));
      return;
    }

    if (fs.existsSync(newPath)) {
      console.log(chalk.red(`[Rename Config] Target config file already exists: ${newName}`));
      return;
    }

    try {
      fs.renameSync(oldPath, newPath);

      // Update current config path if we renamed the current config
      if (this.currentConfigName === oldName) {
        this.strummerConfigPath = newPath;
        this.currentConfigName = newName;
      }

      console.log(chalk.green(`[Rename Config] Renamed ${oldName} to ${newName}`));

      // Broadcast updated config list to all clients
      this.broadcastConfig();
    } catch (e) {
      console.error(chalk.red(`[Rename Config] Failed to rename config:`), e);
    }
  }

  /**
   * Upload a config file (save uploaded data as a new config) and switch to it
   */
  private handleUploadConfig(configName: string, configData: unknown): void {
    if (!this.strummerConfigDir) {
      console.log(chalk.red('[Upload Config] No config directory set'));
      return;
    }

    // Ensure the name ends with .json
    if (!configName.endsWith('.json')) {
      configName = configName + '.json';
    }

    const configPath = path.join(this.strummerConfigDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.strummerConfigDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      console.log(chalk.red('[Upload Config] Invalid config path - path traversal detected'));
      return;
    }

    try {
      // Validate the config data by trying to parse it
      const parsedConfig = MidiStrummerConfig.fromDict(configData as Record<string, unknown>);

      // Save the validated config
      const configJson = JSON.stringify(parsedConfig.toDict(), null, 2);
      fs.writeFileSync(configPath, configJson, { encoding: 'utf-8' });
      // Set permissions explicitly (bypasses umask)
      fs.chmodSync(configPath, 0o666);

      console.log(chalk.green(`[Upload Config] Uploaded config: ${configName}`));

      // Switch to the uploaded config
      this.strummerConfigPath = configPath;
      this.currentConfigName = configName;
      this.config = parsedConfig;

      // Re-apply settings from the new config; release any held notes from the previous config
      this.clearControllerState();
      this.strummer.configure(this.config.pressureThreshold, this.config.strumming.pressureBufferSize);
      this.slider.configure(
        this.config.strummer.slide.pressureThreshold,
        this.config.strummer.slide.maxBendSemitones,
      );
      this.setupNotes();
      this.actions.setActionRulesConfig(this.config.strummer.actionRules);

      // Broadcast updated config to all clients (isSavedState=true since we just saved the file)
      this.broadcastConfig(true);
    } catch (e) {
      console.error(chalk.red(`[Upload Config] Failed to upload config:`), e);
    }
  }

  /**
   * Restart the systemd service
   */
  private async handleRestartService(ws: WebSocket): Promise<void> {
    console.log(chalk.cyan('[Restart Service] Received restart request'));

    try {
      // Check if running as systemd service
      const { stdout } = await execAsync('systemctl is-active sketchatone 2>/dev/null || echo "inactive"');
      const isSystemdService = stdout.trim() === 'active';

      if (!isSystemdService) {
        const errorMsg = 'Not running as a systemd service. Please restart manually.';
        console.log(chalk.yellow(`[Restart Service] ${errorMsg}`));
        ws.send(JSON.stringify({
          type: 'restart-service-error',
          error: errorMsg,
        }));
        return;
      }

      // Send acknowledgment before restarting
      ws.send(JSON.stringify({
        type: 'restart-service-ack',
        message: 'Service restart initiated. Reconnecting...',
      }));

      console.log(chalk.yellow('[Restart Service] Restarting sketchatone service...'));

      // Delay to allow acknowledgment to be sent
      setTimeout(async () => {
        try {
          await execAsync('sudo systemctl restart sketchatone');
        } catch (e) {
          console.error(chalk.red('[Restart Service] Failed to restart:'), e);
        }
      }, 500);
    } catch (e) {
      console.error(chalk.red('[Restart Service] Error:'), e);
      ws.send(JSON.stringify({
        type: 'restart-service-error',
        error: 'Failed to restart service',
      }));
    }
  }

  /**
   * Delete a config file
   */
  private handleDeleteConfig(configName: string): void {
    if (!this.strummerConfigDir) {
      console.log(chalk.red('[Delete Config] No config directory set'));
      return;
    }

    // Don't allow deleting the currently loaded config
    if (this.currentConfigName === configName) {
      console.log(chalk.red('[Delete Config] Cannot delete the currently loaded config'));
      return;
    }

    const configPath = path.join(this.strummerConfigDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.strummerConfigDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      console.log(chalk.red('[Delete Config] Invalid config path - path traversal detected'));
      return;
    }

    if (!fs.existsSync(configPath)) {
      console.log(chalk.red(`[Delete Config] Config file not found: ${configName}`));
      return;
    }

    try {
      fs.unlinkSync(configPath);
      console.log(chalk.green(`[Delete Config] Deleted config: ${configName}`));

      // Broadcast updated config list to all clients
      this.broadcastConfig();
    } catch (e) {
      console.error(chalk.red(`[Delete Config] Failed to delete config:`), e);
    }
  }

  /**
   * Normalize a MIDI port name for loopback comparison.
   *
   * ALSA emits `"Client:Port NN:MM"` (e.g. `"Sketchatone:Sketchatone 128:0"`)
   * for both our output and the corresponding input alias; stripping the
   * trailing sequencer numeric suffix and lowercasing collapses the two
   * onto the same key. Mirrors ``_normalize_midi_port_name`` in the
   * Python server.
   */
  private normalizeMidiPortName(name: string | null | undefined): string {
    if (!name) return '';
    return name.replace(/\s+\d+:\d+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Compute the ids of currently-connected input ports whose normalized
   * name matches the current output port name — i.e. an active MIDI
   * loopback that would feed our own strums back into the input handler.
   */
  private computeLoopbackInputPortIds(
    inputPorts: Array<{ id: number; name: string }>,
    currentInputPorts: number[],
  ): number[] {
    const outputName = this.backend?.currentOutputName;
    if (!outputName || currentInputPorts.length === 0) return [];
    const outNorm = this.normalizeMidiPortName(outputName);
    if (!outNorm) return [];
    const connected = new Set(currentInputPorts);
    const result: number[] = [];
    for (const port of inputPorts) {
      if (connected.has(port.id) && this.normalizeMidiPortName(port.name) === outNorm) {
        result.push(port.id);
      }
    }
    return result;
  }

  /**
   * Handle get-midi-devices request
   * Returns available MIDI input and output ports
   */
  private async handleGetMidiDevices(client: WebSocket): Promise<void> {
    try {
      const inputPorts: Array<{ id: number; name: string }> = [];
      const outputPorts: Array<{ id: number; name: string }> = [];

      // Build exclusion lists up front so we can filter both pickers.
      // Same case-insensitive substring rule as RtMidiInput.connectAll,
      // so anything hidden here is guaranteed to also be skipped by the
      // auto-connect path.
      const excludedInputPorts: string[] = [...this.config.midi.inputExclude];
      const excludedOutputPorts: string[] = [...this.config.midi.outputExclude];
      const isExcluded = (name: string | undefined, patterns: string[]): boolean => {
        if (!name) return false;
        const lowered = name.toLowerCase();
        return patterns.some(p => p && lowered.includes(p.toLowerCase()));
      };

      // Get MIDI input ports
      if (this.midiInput) {
        const availableInputs = await this.midiInput.getAvailablePorts();
        for (const port of availableInputs) {
          if (!isExcluded(port.name, excludedInputPorts)) inputPorts.push(port);
        }
      }

      // Get MIDI output ports. Keep the enumeration index as the id so the
      // backend still opens the right port after excluded entries are dropped.
      if (this.backend) {
        const availableOutputs = this.backend.getAvailablePorts();
        availableOutputs.forEach((name: string, index: number) => {
          if (!isExcluded(name, excludedOutputPorts)) {
            outputPorts.push({ id: index, name });
          }
        });
      }

      // Get currently connected ports (not just config values)
      // For input: return ALL connected port IDs (for "all ports" mode)
      const currentInputPorts: number[] = [];
      if (this.midiInput && this.midiInput.isConnected) {
        const connectedPorts = this.midiInput.connectedPorts;
        currentInputPorts.push(...connectedPorts.map(p => p.id));
      }

      // For output: find the port ID that matches the connected port name
      let currentOutputPort: string | number | null = null;
      if (this.backend && this.backend.isConnected && this.backend.currentOutputName) {
        // Find the port index that matches the current output name
        const outputName = this.backend.currentOutputName;
        const matchingPort = outputPorts.find(port => port.name === outputName);
        if (matchingPort) {
          currentOutputPort = matchingPort.id;
        }
      }

      const loopbackInputPortIds = this.computeLoopbackInputPortIds(inputPorts, currentInputPorts);
      if (loopbackInputPortIds.length > 0) {
        console.log(chalk.yellow(`[MIDI Devices] !! Loopback detected on input port ids: ${loopbackInputPortIds.join(', ')}`));
      }

      const response = {
        type: 'midi-devices',
        data: {
          inputPorts,
          outputPorts,
          currentInputPorts,  // Array of connected input port IDs
          currentOutputPort,
          excludedInputPorts,  // Ports excluded from input to prevent feedback loops
          loopbackInputPortIds,  // Connected inputs that share a name with current output
        },
      };

      client.send(JSON.stringify(response));
    } catch (error) {
      console.error(chalk.red('[Get MIDI Devices] Error:'), error);
    }
  }

  /**
   * Broadcast MIDI devices status to all connected clients
   * Similar to handleGetMidiDevices but broadcasts to all clients
   */
  private async broadcastMidiDevices(): Promise<void> {
    if (!this.wss) return;

    try {
      const inputPorts: Array<{ id: number; name: string }> = [];
      const outputPorts: Array<{ id: number; name: string }> = [];

      // Build exclusion list
      const excludedInputPorts: string[] = [...this.config.midi.inputExclude];
      if (this.backend && this.backend.currentOutputName) {
        excludedInputPorts.push(this.backend.currentOutputName);
      }
      const excludedOutputPorts: string[] = [...this.config.midi.outputExclude];
      const isExcluded = (name: string | undefined, patterns: string[]): boolean => {
        if (!name) return false;
        const lowered = name.toLowerCase();
        return patterns.some(p => p && lowered.includes(p.toLowerCase()));
      };

      // Get MIDI input ports
      if (this.midiInput) {
        const availableInputs = await this.midiInput.getAvailablePorts();
        for (const port of availableInputs) {
          if (!isExcluded(port.name, excludedInputPorts)) inputPorts.push(port);
        }
      }

      // Get MIDI output ports. Keep enumeration index as the id so the
      // backend still opens the right port after excluded entries are dropped.
      if (this.backend) {
        const availableOutputs = this.backend.getAvailablePorts();
        availableOutputs.forEach((name: string, index: number) => {
          if (!isExcluded(name, excludedOutputPorts)) {
            outputPorts.push({ id: index, name });
          }
        });
      }

      // Get currently connected ports
      const currentInputPorts: number[] = [];
      if (this.midiInput && this.midiInput.isConnected) {
        const connectedPorts = this.midiInput.connectedPorts;
        currentInputPorts.push(...connectedPorts.map(p => p.id));
      }

      // For output: find the port ID that matches the connected port name
      let currentOutputPort: string | number | null = null;
      if (this.backend && this.backend.isConnected && this.backend.currentOutputName) {
        const outputName = this.backend.currentOutputName;
        const matchingPort = outputPorts.find(port => port.name === outputName);
        if (matchingPort) {
          currentOutputPort = matchingPort.id;
        }
      }

      const loopbackInputPortIds = this.computeLoopbackInputPortIds(inputPorts, currentInputPorts);
      if (loopbackInputPortIds.length > 0) {
        console.log(chalk.yellow(`[Broadcast MIDI Devices] !! Loopback detected on input port ids: ${loopbackInputPortIds.join(', ')}`));
      }

      const message = JSON.stringify({
        type: 'midi-devices',
        data: {
          inputPorts,
          outputPorts,
          currentInputPorts,
          currentOutputPort,
          excludedInputPorts,
          passthroughConnections: this.config.midi.midiPassthrough || [],
          loopbackInputPortIds,
        },
      });

      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    } catch (error) {
      console.error(chalk.red('[Broadcast MIDI Devices] Error:'), error);
    }
  }

  /**
   * Convert snake_case to camelCase
   */
  private snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Set a config value using dot-notation path
   * Supports both snake_case and camelCase paths
   */
  private setConfigValue(path: string, value: unknown): void {
    const parts = path.split('.');

    // Navigate to the parent object
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const camelPart = this.snakeToCamel(part);

      // Try camelCase first, then original
      if (current[camelPart] !== undefined && current[camelPart] !== null) {
        current = current[camelPart] as Record<string, unknown>;
      } else if (current[part] !== undefined && current[part] !== null) {
        current = current[part] as Record<string, unknown>;
      } else {
        throw new Error(`Invalid path: ${path}`);
      }
    }

    // Set the value - try camelCase first
    const lastPart = parts[parts.length - 1];
    const camelLastPart = this.snakeToCamel(lastPart);

    // Convert dict values to proper config objects for known complex types
    let convertedValue = value;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      convertedValue = this.convertDictToConfig(camelLastPart, value as Record<string, unknown>);
    }

    if (camelLastPart in current || !(lastPart in current)) {
      current[camelLastPart] = convertedValue;
    } else {
      current[lastPart] = convertedValue;
    }
  }

  /**
   * Convert a dict value to the appropriate config object based on attribute name.
   */
  private convertDictToConfig(attrName: string, value: Record<string, unknown>): unknown {
    const converters: Record<string, (data: Record<string, unknown>) => unknown> = {
      actionRules: ActionRulesConfig.fromDict,
      strumRelease: StrumReleaseConfig.fromDict,
      strumming: StrummingConfig.fromDict,
      noteDuration: ParameterMapping.fromDict,
      pitchBend: ParameterMapping.fromDict,
      noteVelocity: ParameterMapping.fromDict,
      deviceButtons: DeviceButtonsConfig.fromDict,
    };

    const converter = converters[attrName];
    if (converter) {
      return converter(value);
    }
    return value;
  }

  /**
   * Set up event bus subscriptions
   */
  private setupEventSubscriptions(): void {
    // Subscribe to combined events (tablet + strum merged)
    this.combinedUnsubscribe = this.eventBus.onCombinedEvent((data) => {
      // Send as 'tablet-data' envelope over the WebSocket.
      // The strum field is optional and will be present when a strum occurred.
      this.broadcast({
        type: 'tablet-data',
        ...data,
      });
    });
  }

  /**
   * Handle a tablet event from the TabletClient. Emitted for both pen reports
   * (position/pressure/tilt/pen-buttons) and aux reports (express keys as
   * HID scan codes). Diffs stylus + aux button state to fire press/release
   * actions, then feeds the sample into strum/slide/repeater processing.
   */
  private onTabletEvent(tabletEvent: TabletEvent): void {
    try {
      const { x, y, pressure, tiltX, tiltY, tiltXY,
        primaryButtonPressed, secondaryButtonPressed, auxCodes: rawAuxCodes } = tabletEvent;
      const state: 'hover' | 'contact' | 'out-of-range' =
        tabletEvent.state === 'none' ? 'out-of-range' : tabletEvent.state;

      // Stylus button transitions
      if (primaryButtonPressed && !this.buttonState.primaryButtonPressed) {
        this.actions.handleButtonEvent('button:primary', 'press');
      } else if (!primaryButtonPressed && this.buttonState.primaryButtonPressed) {
        this.actions.handleButtonEvent('button:primary', 'release');
      }
      if (secondaryButtonPressed && !this.buttonState.secondaryButtonPressed) {
        this.actions.handleButtonEvent('button:secondary', 'press');
      } else if (!secondaryButtonPressed && this.buttonState.secondaryButtonPressed) {
        this.actions.handleButtonEvent('button:secondary', 'release');
      }
      this.buttonState.primaryButtonPressed = primaryButtonPressed;
      this.buttonState.secondaryButtonPressed = secondaryButtonPressed;

      // Auxiliary (express-key) transitions: diff HID scan codes as `code:<n>`.
      const currentAuxCodes = new Set<number>(rawAuxCodes);
      for (const code of currentAuxCodes) {
        if (!this.prevAuxCodes.has(code)) {
          this.actions.handleButtonEvent(`code:${code}`, 'press');
          this.maybeLearnDeviceButton(code);
        }
      }
      for (const code of this.prevAuxCodes) {
        if (!currentAuxCodes.has(code)) {
          this.actions.handleButtonEvent(`code:${code}`, 'release');
        }
      }
      this.prevAuxCodes = currentAuxCodes;

      // Apply pitch bend based on configuration (throttled to avoid MIDI flooding).
      // Skip out-of-range events: pen leaving proximity produces Y=0 which maps to PB=-1.0.
      const pitchBendCfg = this.config.pitchBend;
      if (pitchBendCfg && this.backend && state !== 'out-of-range') {
        const controlValue = this.getControlValue(pitchBendCfg.control, {
          x,
          y,
          pressure,
          tiltX,
          tiltY,
          tiltXY,
        });
        if (controlValue !== null) {
          let bendValue = pitchBendCfg.mapValue(controlValue);

          // Initialize tracking variables
          if (!this.lastPitchBendTime) {
            this.lastPitchBendTime = 0;
            this.lastPitchBendValue = null;
          }

          // Apply deadzone around center (±0.02) to avoid sending tiny changes near zero
          if (Math.abs(bendValue) < 0.02) {
            bendValue = 0.0;
          }

          // Only send if value changed significantly
          const valueChanged =
            this.lastPitchBendValue === null ||
            Math.abs(bendValue - this.lastPitchBendValue) > 0.01;

          if (valueChanged) {
            this.backend.sendPitchBend?.(bendValue);
            this.lastPitchBendTime = Date.now();
            this.lastPitchBendValue = bendValue;
          }
        }
      }

      // Calculate dynamic note duration based on configuration
      const noteDurationCfg = this.config.noteDuration;
      let currentNoteDuration = noteDurationCfg.default;
      if (noteDurationCfg) {
        const controlValue = this.getControlValue(noteDurationCfg.control, {
          x,
          y,
          pressure,
          tiltX,
          tiltY,
          tiltXY,
        });
        if (controlValue !== null) {
          currentNoteDuration = noteDurationCfg.mapValue(controlValue);
        }
      }

      // Get note velocity configuration for applying curve
      const noteVelocityCfg = this.config.noteVelocity;

      // Emit tablet event to event bus
      const tabletEventData: TabletEventData = {
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        tiltXY,
        primaryButtonPressed,
        secondaryButtonPressed,
        state,
        timestamp: tabletEvent.timestamp || Date.now(),
        auxCodes: rawAuxCodes.slice(),
      };
      this.eventBus.emitTabletEvent(tabletEventData);

      // Update strummer/slider bounds (use normalized 0-1 range)
      this.strummer.updateBounds(1.0, 1.0);
      this.slider.updateBounds(1.0, 1.0);

      // Apply X inversion for left-handed use if configured
      const strumX = this.config.strumming.invertX ? 1.0 - x : x;

      // Branch on top-level mode: 'slide' uses Slider, 'strum' uses Strummer
      if (this.config.strummer.mode === 'slide') {
        this.handleSlide(strumX, pressure);
        return;
      }

      // Process strum
      const event = this.strummer.strum(strumX, pressure);

      // Get note repeater state from actions
      const repeaterConfig = this.actions.getRepeaterConfig();
      const noteRepeaterEnabled = repeaterConfig.active;
      const pressureMultiplier = repeaterConfig.pressureMultiplier;
      const frequencyMultiplier = repeaterConfig.frequencyMultiplier;

      // Get transpose state from actions
      const transposeEnabled = this.actions.isTransposeActive();
      const transposeSemitones = this.actions.getTransposeSemitones();

      if (event) {
        if (event.type === 'strum') {
          // Track strum start time for strum release feature
          // Only set on FIRST strum event (not subsequent strums across strings)
          if (this.strumStartTime === 0) {
            this.strumStartTime = Date.now() / 1000;
          }

          // Store notes for repeater and mark as holding
          this.repeaterState.notes = event.notes;
          this.repeaterState.isHolding = true;
          this.repeaterState.lastRepeatTime = Date.now() / 1000;

          // Send MIDI notes
          for (const noteData of event.notes) {
            const rawVelocity = noteData.velocity;

            // Apply velocity curve from note_velocity config
            let velocity = rawVelocity;
            if (noteVelocityCfg && rawVelocity > 0) {
              // Normalize velocity to 0-1 range
              const normalizedVel = rawVelocity / 127;
              // Apply the parameter mapping (includes curve)
              velocity = Math.floor(noteVelocityCfg.mapValue(normalizedVel));
              // Clamp to MIDI range
              velocity = Math.max(1, Math.min(127, velocity));
            }

            if (this.backend && velocity > 0) {
              // Apply transpose if enabled
              const noteToPlay = transposeEnabled
                ? Note.transpose(noteData.note, transposeSemitones)
                : noteData.note;
              this.backend.sendNote(
                noteToPlay,
                velocity,
                currentNoteDuration
              );
              this.notesPlayed++;
            }
          }

          // Emit strum event to event bus
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
          // Stop holding - no more repeats
          this.repeaterState.isHolding = false;
          this.repeaterState.notes = [];

          // Handle strum release - send configured MIDI note on quick releases
          const strumReleaseCfg = this.config.strumRelease;
          if (strumReleaseCfg?.active && this.backend && this.strumStartTime > 0) {
            const strumDuration = (Date.now() / 1000) - this.strumStartTime;
            const maxDuration = strumReleaseCfg.maxDuration ?? 0.25;

            // Only trigger release note if duration is within the max duration threshold
            if (strumDuration <= maxDuration) {
              const releaseNote = strumReleaseCfg.midiNote;
              // Default to channel 9 (0-based, MIDI channel 10/drums) if not specified
              const releaseChannel = strumReleaseCfg.midiChannel ?? 9;
              const velocityMultiplier = strumReleaseCfg.velocityMultiplier ?? 1.0;

              // Use the velocity from the strum and apply multiplier
              const baseVelocity = event.velocity ?? 64;
              let releaseVelocity = Math.floor(baseVelocity * velocityMultiplier);
              // Clamp to MIDI range 1-127
              releaseVelocity = Math.max(1, Math.min(127, releaseVelocity));

              // Display channel as 1-based for user-friendliness
              console.log(chalk.cyan(`[Strum Release] note=${releaseNote} vel=${releaseVelocity} ch=${releaseChannel + 1} dur=${strumDuration.toFixed(3)}s`));

              // Send the raw MIDI note using the backend's sendRawNote method
              // Cast to RtMidiBackend to access sendRawNote (not part of protocol interface)
              const rtBackend = this.backend as RtMidiBackend;
              if (rtBackend.sendRawNote) {
                rtBackend.sendRawNote(releaseNote, releaseVelocity, strumDuration, releaseChannel);
              }
            }
          }
          // Reset strum start time
          this.strumStartTime = 0;

          // Emit release event to event bus
          const releaseEventData: StrumEventData = {
            type: 'release',
            notes: [],
            velocity: event.velocity,
            timestamp: Date.now(),
          };
          this.eventBus.emitStrumEvent(releaseEventData);
        }
      }

      // Handle note repeater - fire repeatedly while holding
      if (noteRepeaterEnabled && this.repeaterState.isHolding && this.repeaterState.notes.length > 0) {
        const currentTime = Date.now() / 1000;
        const timeSinceLastRepeat = currentTime - this.repeaterState.lastRepeatTime;

        // Apply frequency multiplier to duration (higher = faster repeats)
        const repeatInterval = frequencyMultiplier > 0
          ? currentNoteDuration / frequencyMultiplier
          : currentNoteDuration;

        // Check if it's time for another repeat
        if (timeSinceLastRepeat >= repeatInterval) {
          for (const noteData of this.repeaterState.notes) {
            // Use the original note's velocity with pressure multiplier applied
            const originalVelocity = noteData.velocity ?? 100;
            let rawRepeatVelocity = Math.floor(originalVelocity * pressureMultiplier);
            rawRepeatVelocity = Math.max(1, Math.min(127, rawRepeatVelocity));

            // Apply velocity curve from note_velocity config
            let repeatVelocity = rawRepeatVelocity;
            if (noteVelocityCfg && rawRepeatVelocity > 0) {
              const normalizedVel = rawRepeatVelocity / 127;
              repeatVelocity = Math.floor(noteVelocityCfg.mapValue(normalizedVel));
              repeatVelocity = Math.max(1, Math.min(127, repeatVelocity));
            }

            if (this.backend && repeatVelocity > 0) {
              // Apply transpose if enabled
              const noteToPlay = transposeEnabled
                ? Note.transpose(noteData.note, transposeSemitones)
                : noteData.note;
              this.backend.sendNote(
                noteToPlay,
                repeatVelocity,
                currentNoteDuration
              );
            }
          }

          this.repeaterState.lastRepeatTime = currentTime;
        }
      }
    } catch (e) {
      console.error(chalk.red(`Error processing tablet event: ${e}`));
    }
  }

  /**
   * Process a tablet sample in slide (trombone) mode.
   *
   * Routes Slider events to the MIDI backend (note on/off + pitch bend) and
   * emits a StrumEventData on the event bus so visualizers see activity.
   */
  private handleSlide(strumX: number, pressure: number): void {
    const event = this.slider.slide(strumX, pressure);
    if (!event) return;

    const slideCfg = this.config.strummer.slide;
    const mod = slideCfg.pressureModulation;

    if (this.backend) {
      routeSlideEventToMidi(
        event,
        // RtMidiBackend implements sendPitchBend/sendNoteOn/releaseNotes/sendAftertouch/sendCc;
        // SliderMidiTarget is a structural subset of MidiBackendProtocol.
        this.backend as unknown as Parameters<typeof routeSlideEventToMidi>[1],
        this.slideState,
        slideCfg.maxBendSemitones,
        {
          type: mod.type,
          ccNumber: mod.ccNumber,
          minValue: mod.minValue,
          maxValue: mod.maxValue,
          pressureThreshold: slideCfg.pressureThreshold,
        },
        pressure,
      );
    }

    if (event.type === 'slide_on') {
      this.notesPlayed++;
    }

    // Emit a strum-event-bus message so dashboards / visualizers can show slide activity.
    const note = event.type === 'slide_off' ? null : event.note;
    const velocity = event.type === 'slide_on' ? event.velocity : 0;
    const strumEventData: StrumEventData = {
      type: event.type,
      notes: note
        ? [{
            note: {
              notation: note.notation,
              octave: note.octave,
              midiNote: Note.noteToMidi(note),
            },
            velocity,
          }]
        : [],
      velocity,
      timestamp: Date.now(),
    };
    this.eventBus.emitStrumEvent(strumEventData);
  }

  /**
   * Release any held notes and reset transient controller state.
   * Called when switching modes (strum <-> slide) or reloading config.
   */
  private clearControllerState(): void {
    if (this.backend) {
      try {
        this.backend.releaseAll();
        this.backend.sendPitchBend?.(0.0);
      } catch {
        // Ignore backend errors during cleanup
      }
    }
    this.slideState.activeSlideNote = null;
    this.slideState.lastModulationValue = null;
    this.slider.clear();
    this.strummer.clearStrum();
    this.repeaterState.notes = [];
    this.repeaterState.isHolding = false;
    this.strumStartTime = 0;
  }


  async start(): Promise<void> {
    console.log(chalk.cyan.bold('\n╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║') + chalk.white.bold('              STRUMMER WEBSOCKET SERVER                     ') + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════════╝\n'));

    // Initialize MIDI output
    console.log(chalk.gray('Initializing MIDI...'));
    if (await this.setupMidi()) {
      console.log(chalk.green('✓ MIDI output initialized'));
      this.printMidiConfig();
    } else {
      console.log(chalk.yellow('⚠ MIDI not available - running without MIDI output'));
    }

    // Initialize MIDI input (for external keyboard)
    console.log(chalk.gray('Initializing MIDI input...'));
    if (await this.setupMidiInput()) {
      const inputPort = this.config.inputPort;
      let portInfo: string;

      if (Array.isArray(inputPort)) {
        if (inputPort.length === 0) {
          portInfo = 'no ports selected';
        } else {
          portInfo = `${inputPort.length} port(s) selected`;
        }
      } else if (inputPort === null) {
        portInfo = `all ports (${this.midiInput?.connectedPorts.length ?? 0} found)`;
      } else {
        portInfo = this.midiInput?.currentInputName ?? String(inputPort);
      }

      console.log(chalk.green(`✓ MIDI input: ${portInfo}`));
    } else {
      console.log(chalk.yellow('⚠ No MIDI input ports connected'));
    }

    // Get local IP for LAN access URLs
    const localIP = getLocalIP();

    // Start HTTP server if port configured
    if (this.httpPort) {
      this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
      this.httpServer.listen(this.httpPort, () => {
        console.log(chalk.green(`✓ HTTP server listening on port ${this.httpPort}`));
        console.log(chalk.cyan(`  Serving: ${this.publicDir}`));
        console.log(chalk.white(`  Local:   `) + chalk.blue.underline(`http://localhost:${this.httpPort}`));
        if (localIP) {
          console.log(chalk.white(`  Network: `) + chalk.blue.underline(`http://${localIP}:${this.httpPort}`));
        }
      });
    }

    // Start HTTPS server if port configured
    if (this.httpsPort) {
      // Generate or load SSL certificate
      const sslCertGenerated = generateSelfSignedCert();
      const sslCert = loadSSLCert();

      if (sslCert) {
        this.httpsServer = https.createServer(
          {
            key: sslCert.key,
            cert: sslCert.cert,
          },
          (req, res) => this.handleHttpRequest(req, res)
        );

        this.httpsServer.listen(this.httpsPort, () => {
          const certPaths = getSSLCertPaths();
          console.log(chalk.green(`✓ HTTPS server listening on port ${this.httpsPort}`));
          console.log(chalk.cyan(`  Certificate: ${certPaths.certFile}`));
          console.log(chalk.white(`  Local:   `) + chalk.blue.underline(`https://localhost:${this.httpsPort}`));
          if (localIP) {
            console.log(chalk.white(`  Network: `) + chalk.blue.underline(`https://${localIP}:${this.httpsPort}`));
          }
          if (sslCertGenerated) {
            console.log(chalk.yellow(`  Note: Self-signed certificate will show browser warnings`));
          }
        });
      } else {
        console.log(chalk.yellow(`⚠ HTTPS server disabled (SSL certificate not available)`));
      }
    }

    // Start WebSocket server if port configured
    if (!this.wsPort) {
      console.log(chalk.yellow('⚠ WebSocket server disabled (no port configured)'));
      this.setupShutdownHandlers();
      return;
    }

    this.wss = new WebSocketServer({ port: this.wsPort });

    this.wss.on('connection', (ws) => {
      this.clientCount++;
      console.log(chalk.green(`✓ Client connected (${this.clientCount} total)`));

      // Resume event bus when first client connects
      if (this.clientCount === 1) {
        this.eventBus.resume();
        console.log(chalk.cyan('  Event processing resumed'));
      }

      // Send current config to new client
      this.sendConfig(ws);

      // Send current device status to new client
      this.sendStatus(ws);

      // Send MIDI input status to new client
      this.sendMidiInputStatus(ws);

      // Send current button-detection state so the UI reflects the shared
      // per-server flag on reconnect / new tab.
      ws.send(JSON.stringify({
        type: 'button-detection-state',
        enabled: this.detectingDeviceButtons,
      }));

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === 'set-throttle' && typeof parsed.throttleMs === 'number') {
            this.setThrottle(parsed.throttleMs);
            console.log(chalk.yellow(`Throttle changed to: ${parsed.throttleMs}ms`));
          } else if (parsed.type === 'set-button-detection' && typeof parsed.enabled === 'boolean') {
            this.detectingDeviceButtons = parsed.enabled;
            console.log(chalk.cyan(`[Device Buttons] Detection ${parsed.enabled ? 'started' : 'stopped'}`));
            this.broadcastButtonDetectionState();
          } else if (parsed.type === 'update-config' && typeof parsed.path === 'string') {
            this.handleConfigUpdate(parsed.path, parsed.value);
          } else if (parsed.type === 'save-config') {
            console.log(chalk.cyan('[WebSocket] Received save-config request'));
            this.handleSaveConfig();
          } else if (parsed.type === 'load-config' && typeof parsed.configName === 'string') {
            this.handleLoadConfig(parsed.configName);
          } else if (parsed.type === 'create-config' && typeof parsed.configName === 'string') {
            this.handleCreateConfig(parsed.configName);
          } else if (parsed.type === 'rename-config' && typeof parsed.oldName === 'string' && typeof parsed.newName === 'string') {
            this.handleRenameConfig(parsed.oldName, parsed.newName);
          } else if (parsed.type === 'upload-config' && typeof parsed.configName === 'string' && parsed.configData) {
            this.handleUploadConfig(parsed.configName, parsed.configData);
          } else if (parsed.type === 'delete-config' && typeof parsed.configName === 'string') {
            this.handleDeleteConfig(parsed.configName);
          } else if (parsed.type === 'get-midi-devices') {
            this.handleGetMidiDevices(ws);
          } else if (parsed.type === 'restart-service') {
            this.handleRestartService(ws);
          }
        } catch (e) {
          console.error(chalk.red('[WebSocket] Error processing message:'), e);
        }
      });

      ws.on('close', () => {
        this.clientCount--;
        console.log(chalk.yellow(`Client disconnected (${this.clientCount} remaining)`));

        // Pause event bus when last client disconnects
        if (this.clientCount === 0) {
          this.eventBus.pause();
          console.log(chalk.cyan('  Event processing paused'));
        }
      });
    });

    console.log(chalk.green(`✓ WebSocket server listening on port ${this.wsPort}`));
    console.log(chalk.cyan(`  Throttle: ${this.eventBus.throttleMs}ms`));
    console.log(chalk.white(`  Local:   `) + chalk.magenta.underline(`ws://localhost:${this.wsPort}`));
    if (localIP) {
      console.log(chalk.white(`  Network: `) + chalk.magenta.underline(`ws://${localIP}:${this.wsPort}`));
    }

    // Start Secure WebSocket server if port configured
    if (this.wssPort) {
      const sslCert = loadSSLCert();

      if (sslCert) {
        // Create HTTPS server for WSS
        const wssHttpsServer = https.createServer({
          key: sslCert.key,
          cert: sslCert.cert,
        });

        // Create WSS server on top of HTTPS server
        this.wssSecure = new WebSocketServer({ server: wssHttpsServer });

        // Use the same connection handler as WS server
        this.wssSecure.on('connection', (ws) => {
          this.clientCount++;
          console.log(chalk.green(`✓ Client connected via WSS (${this.clientCount} total)`));

          // Resume event bus when first client connects
          if (this.clientCount === 1) {
            this.eventBus.resume();
            console.log(chalk.cyan('  Event processing resumed'));
          }

          // Send current config to new client
          this.sendConfig(ws);

          // Send current device status to new client
          this.sendStatus(ws);

          // Send MIDI input status to new client
          this.sendMidiInputStatus(ws);

          ws.on('message', (message) => {
            try {
              const parsed = JSON.parse(message.toString());
              if (parsed.type === 'set-throttle' && typeof parsed.throttleMs === 'number') {
                this.setThrottle(parsed.throttleMs);
                console.log(chalk.yellow(`Throttle changed to: ${parsed.throttleMs}ms`));
              } else if (parsed.type === 'update-config' && typeof parsed.path === 'string') {
                this.handleConfigUpdate(parsed.path, parsed.value);
              } else if (parsed.type === 'save-config') {
                console.log(chalk.cyan('[WebSocket] Received save-config request'));
                this.handleSaveConfig();
              } else if (parsed.type === 'load-config' && typeof parsed.configName === 'string') {
                this.handleLoadConfig(parsed.configName);
              } else if (parsed.type === 'create-config' && typeof parsed.configName === 'string') {
                this.handleCreateConfig(parsed.configName);
              } else if (parsed.type === 'rename-config' && typeof parsed.oldName === 'string' && typeof parsed.newName === 'string') {
                this.handleRenameConfig(parsed.oldName, parsed.newName);
              } else if (parsed.type === 'upload-config' && typeof parsed.configName === 'string' && parsed.configData) {
                this.handleUploadConfig(parsed.configName, parsed.configData);
              } else if (parsed.type === 'delete-config' && typeof parsed.configName === 'string') {
                this.handleDeleteConfig(parsed.configName);
              } else if (parsed.type === 'get-midi-devices') {
                this.handleGetMidiDevices(ws);
              } else if (parsed.type === 'restart-service') {
                this.handleRestartService(ws);
              }
            } catch (e) {
              console.error(chalk.red('[WebSocket] Error processing message:'), e);
            }
          });

          ws.on('close', () => {
            this.clientCount--;
            console.log(chalk.yellow(`Client disconnected (${this.clientCount} remaining)`));

            // Pause event bus when last client disconnects
            if (this.clientCount === 0) {
              this.eventBus.pause();
              console.log(chalk.cyan('  Event processing paused'));
            }
          });
        });

        wssHttpsServer.listen(this.wssPort, () => {
          const certPaths = getSSLCertPaths();
          console.log(chalk.green(`✓ Secure WebSocket server listening on port ${this.wssPort}`));
          console.log(chalk.cyan(`  Certificate: ${certPaths.certFile}`));
          console.log(chalk.white(`  Local:   `) + chalk.magenta.underline(`wss://localhost:${this.wssPort}`));
          if (localIP) {
            console.log(chalk.white(`  Network: `) + chalk.magenta.underline(`wss://${localIP}:${this.wssPort}`));
          }
        });
      } else {
        console.log(chalk.yellow(`⚠ Secure WebSocket server disabled (SSL certificate not available)`));
      }
    }

    // Set up event subscriptions
    this.setupEventSubscriptions();

    // Attach to a tablet device (skipped in dev mode)
    if (this.devMode) {
      console.log(chalk.yellow('⚠ Skipping tablet reader (dev mode)'));
      this.deviceConnected = false;
    } else {
      console.log(chalk.gray('\nDiscovering tablet...'));
      try {
        const pollInterval = this.devicePollInterval;
        const client = pollInterval != null
          ? await waitForDevice({
              intervalMs: pollInterval,
              onWaiting: () => {
                console.log(chalk.yellow('⚠ No tablet detected - waiting for one to be connected...'));
              },
            })
          : await TabletClient.discover();

        if (client) {
          await this.attachTabletClient(client);
        } else {
          console.log(chalk.yellow('\n⚠ No tablet connected.'));
          console.log(chalk.gray('  Use --poll <ms> to wait indefinitely for a device.'));
          this.deviceConnected = false;
        }
      } catch (e) {
        const error = e as Error;
        console.log(chalk.yellow(`\n⚠ Failed to attach tablet: ${error.message}`));
        this.deviceConnected = false;
        this.startDevicePolling();
      }
    }

    // Start keyboard listener if configured
    if (this.keyboardListener) {
      this.keyboardListener.start();
    }

    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    // Set up shutdown handlers
    this.setupShutdownHandlers();
  }

  async stop(): Promise<void> {
    // Unsubscribe from events
    if (this.combinedUnsubscribe) {
      this.combinedUnsubscribe();
      this.combinedUnsubscribe = null;
    }

    // Clean up event bus
    this.eventBus.cleanup();

    // Stop keyboard listener
    if (this.keyboardListener) {
      this.keyboardListener.stop();
    }

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    // Close HTTPS server
    if (this.httpsServer) {
      this.httpsServer.close();
      this.httpsServer = null;
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close Secure WebSocket server
    if (this.wssSecure) {
      this.wssSecure.close();
      this.wssSecure = null;
    }

    // Cancel any pending device-polling timer
    if (this.devicePollTimer) {
      clearTimeout(this.devicePollTimer);
      this.devicePollTimer = null;
    }

    // Stop tablet client
    if (this.tabletClient) {
      try { this.tabletClient.stop(); } catch { /* ignore */ }
      this.tabletClient = null;
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('server')
    .description('Sketchatone Server - HTTP server for webapps and WebSocket server for tablet/strum events')
    .option('-c, --config <path>', 'Combined config file path (strummer, MIDI, and server settings).')
    .option('--ws-port <number>', 'WebSocket server port (default: 8081)', parseInt)
    .option('--http-port <number>', 'HTTP server port for serving webapps', parseInt)
    .option('--throttle <ms>', 'Throttle interval in milliseconds (default: 150)', parseInt)
    .option('--poll <ms>', 'Poll interval in milliseconds for waiting for device. If not set, quit if no device found.', parseInt)
    .option('--dev', 'Development mode: run without a tablet device (UI only, no tablet input)')
    // MIDI options
    .option('--channel <number>', 'MIDI channel (0-15)', parseInt)
    .option('-p, --port <port>', 'MIDI output port (name or index)')
    .option('-d, --duration <seconds>', 'Note duration in seconds', parseFloat)
    // Debug/test options
    .option('--dump-config', 'Load config, print as JSON, and exit (for testing)')
    .option('--list-ports', 'List available MIDI input and output ports, then exit')
    .addHelpText(
      'after',
      `
Examples:
  # List available MIDI ports
  npm run server -- --list-ports

  # Start in dev mode (no tablet device, UI only)
  npm run server -- --dev --http-port 3000

  # Start with WebSocket only (default port 8081)
  npm run server

  # Start with combined config file
  npm run server -- -c public/configs/sample-config.json

  # Start with both HTTP and WebSocket servers
  npm run server -- -c config.json --http-port 3000 --ws-port 8081

  # Wait indefinitely for device, polling every 2 seconds
  npm run server -- --poll 2000

  # With custom throttle (100ms = 10 events/second max)
  npm run server -- --throttle 100

  # With MIDI output on channel 1
  npm run server -- --channel 1 --port 0
`
    );

  program.parse();

  const options = program.opts<{
    config?: string;
    wsPort?: number;
    httpPort?: number;
    throttle?: number;
    poll?: number;
    dev?: boolean;
    // MIDI options
    channel?: number;
    port?: string;
    duration?: number;
    // Debug/test options
    dumpConfig?: boolean;
  }>();

  // Load combined config early to get server settings (CLI args take precedence)
  const configPath = options.config ? path.resolve(options.config) : undefined;
  const strummerConfig = configPath
    ? MidiStrummerConfig.fromJsonFile(configPath)
    : new MidiStrummerConfig();

  // Handle --dump-config: print config as JSON and exit
  if (options.dumpConfig) {
    console.log(JSON.stringify(strummerConfig.toDict(), null, 2));
    process.exit(0);
  }

  // Resolve effective poll interval (CLI arg takes precedence over config)
  const effectivePoll = options.poll ?? strummerConfig.deviceFindingPollInterval ?? null;

  // Parse MIDI port (could be int or string)
  let midiPort: string | number | undefined = options.port;
  if (midiPort !== undefined) {
    const parsed = parseInt(midiPort, 10);
    if (!isNaN(parsed)) {
      midiPort = parsed;
    }
  }

  // Print startup banner
  console.log(chalk.cyan(`=== Strummer WebSocket Server v${SKETCHATONE_VERSION} ===`));
  if (options.dev) {
    console.log(chalk.yellow('⚠ DEV MODE: Running without tablet device (UI only)'));
  }
  if (configPath) {
    console.log(chalk.gray('Config:'), configPath);
  }

  try {
    const server = new StrummerWebSocketServer({
      strummerConfigPath: configPath,
      wsPort: options.wsPort,
      httpPort: options.httpPort,
      throttleMs: options.throttle,
      // MIDI options
      midiChannel: options.channel,
      midiPort,
      noteDuration: options.duration,
      // Tablet options
      devMode: options.dev,
      devicePollInterval: effectivePoll,
    });

    await server.start();
  } catch (e) {
    const error = e as Error;
    console.error(chalk.red('Error: ') + error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Only run main() when this file is executed directly
import * as nodePath from 'path';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && nodePath.resolve(process.argv[1]) === __filename;

// Also check if we're being run as a bin script
const isBinScript = process.argv[1]?.endsWith('server') ||
                    process.argv[1]?.endsWith('server.js');

if (isMainModule || isBinScript) {
  main().catch((error) => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { StrummerWebSocketServer };
