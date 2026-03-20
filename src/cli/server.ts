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
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Import from blankslate CLI modules
import { TabletReaderBase, type TabletReaderOptions, normalizeTabletEvent, resolveConfigPath, findConfigForDevice } from 'blankslate/cli/tablet-reader-base.js';
import type { HIDInterfaceType } from 'blankslate/core';

// Default config directory for device configs
const DEFAULT_CONFIG_DIR = './public/configs/devices';
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { Actions } from '../core/actions.js';
import { MidiStrummerConfig, type MidiStrummerConfigData } from '../models/midi-strummer-config.js';
import { ActionRulesConfig } from '../models/action-rules.js';
import { StrumReleaseConfig } from '../models/strummer-features.js';
import { StrummingConfig } from '../models/strummer-config.js';
import { ParameterMapping } from '../models/parameter-mapping.js';
import { Note, type NoteObject } from '../models/note.js';
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

/**
 * WebSocket tablet event (matches blankslate format)
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
 * Device capabilities from blankslate tablet configuration
 */
interface DeviceCapabilities {
  hasButtons: boolean;
  buttonCount: number;
  hasPressure: boolean;
  pressureLevels: number;
  hasTilt: boolean;
  resolution: {
    x: number;
    y: number;
  };
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
  /** Device capabilities from blankslate tablet configuration */
  deviceCapabilities?: DeviceCapabilities;
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

class StrummerWebSocketServer extends TabletReaderBase {
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private wsPort: number;
  private httpPort: number | undefined;
  private config: MidiStrummerConfig;
  private strummer: Strummer;
  private eventBus: StrummerEventBus;
  private combinedUnsubscribe: (() => void) | null = null;
  private clientCount: number = 0;
  private deviceConnected: boolean = false;
  private publicDir: string;
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

  // State tracking for tablet hardware buttons (dynamically sized based on device capabilities)
  private tabletButtonState: Record<string, boolean> = {};
  private tabletButtonCount: number = 8; // Default, updated when device connects

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
    tabletConfigPath: string,
    options: TabletReaderOptions & {
      strummerConfigPath?: string;
      wsPort?: number;
      httpPort?: number;
      throttleMs?: number;
      // MIDI options
      midiChannel?: number;
      midiPort?: string | number;
      noteDuration?: number;
    } = {}
  ) {
    super(tabletConfigPath, options);

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
    this.httpPort = options.httpPort ?? this.config.httpPort ?? undefined;
    // Resolve public directory relative to the package root
    // Built webapp files are in dist/public
    this.publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

    // Create event bus with throttle for WebSocket (reduces network traffic)
    this.eventBus = new StrummerEventBus(options.throttleMs ?? this.config.wsMessageThrottle ?? 150);

    // Create strummer
    this.strummer = new Strummer();
    this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);

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
    this.actions = new Actions(this.config, this.strummer);

    // Configure action rules so button-to-action mapping works
    this.actions.setActionRulesConfig(this.config.strummer.actionRules);

    // Listen for action events to broadcast to clients
    this.actions.on('action_executed', (event: ActionExecutedEvent) => {
      this.broadcastActionEvent(event);
    });

    // Execute any startup rules defined in the config
    this.actions.executeStartupRules();
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
        // tiltX from blankslate is -1 to 1, normalize to 0-1
        return ((inputs.tiltX ?? 0) + 1.0) / 2.0;
      case 'tiltY':
        // tiltY from blankslate is -1 to 1, normalize to 0-1
        return ((inputs.tiltY ?? 0) + 1.0) / 2.0;
      case 'tiltXY':
        // tiltXY from blankslate is -1 to 1, normalize to 0-1
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
   * Initialize MIDI input for external keyboard
   * If inputPort is null, listens to ALL available MIDI inputs (discovery mode)
   * If inputPort is specified, connects only to that port
   *
   * Excludes the MIDI output port to prevent feedback loops.
   */
  private async setupMidiInput(): Promise<boolean> {
    try {
      this.midiInput = new RtMidiInput();
      const inputPort = this.config.inputPort;

      // Get available ports (filtered to useful ones) for UI display
      this.midiInputAvailablePorts = await this.midiInput.getAvailablePorts(true);
      console.log(chalk.gray(`[MIDI Input] Available ports: ${this.midiInputAvailablePorts.map(p => p.name).join(', ') || 'none'}`));

      // Build list of ports to exclude (to prevent feedback loops)
      // Start with the configured exclusion list
      const excludePorts: string[] = [...this.config.midi.inputExclude];

      // Also exclude our own output port if available
      if (this.backend && 'currentOutputName' in this.backend && this.backend.currentOutputName) {
        excludePorts.push(this.backend.currentOutputName as string);
      }

      console.log(chalk.gray(`[MIDI Input] Excluding ports matching: ${excludePorts.join(', ')}`));

      let connected = false;
      if (inputPort === null || inputPort === undefined) {
        // Discovery mode: listen to all ports (except excluded ones)
        connected = await this.midiInput.connectAll(excludePorts);
      } else {
        // Specific port mode - restore saved port
        console.log(chalk.cyan(`[MIDI Input] Restoring saved port: ${inputPort}`));
        connected = await this.midiInput.connect(inputPort);
      }

      if (!connected) {
        console.log(chalk.yellow('[MIDI Input] No MIDI input ports available'));
        return false;
      }

      // Register the callback for note events
      this.registerMidiInputCallback();

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
   * Update strummer notes from MIDI input
   */
  private updateNotesFromMidiInput(noteStrings: string[]): void {
    if (noteStrings.length === 0) return;

    // Update the config's initialNotes
    this.config.strummer.strumming.initialNotes = noteStrings;

    // Clear the chord property so setupNotes() uses initialNotes instead
    // This allows MIDI input to override any preset chord
    this.config.strummer.strumming.chord = undefined;

    // Reconfigure strummer with new notes
    this.setupNotes();

    // Broadcast config change to all connected clients
    this.broadcastConfig();

    console.log(chalk.cyan(`[MIDI Input] Notes: ${noteStrings.join(', ')}`));
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
      deviceCapabilities: this.configData?.getCapabilities() ?? undefined,
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
      deviceCapabilities: this.configData?.getCapabilities() ?? undefined,
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
   * Override handleDeviceDisconnect to notify WebSocket clients
   */
  protected handleDeviceDisconnect(): void {
    this.deviceConnected = false;

    // Notify all connected clients
    this.broadcastStatus('disconnected', 'Tablet disconnected, waiting for reconnection...');

    // Call parent implementation (handles polling for reconnection)
    super.handleDeviceDisconnect();
  }

  /**
   * Initialize tablet button state based on device capabilities
   */
  private initializeTabletButtonState(): void {
    const capabilities = this.configData?.getCapabilities();
    this.tabletButtonCount = capabilities?.buttonCount ?? 8;

    // Initialize button state for all buttons
    this.tabletButtonState = {};
    for (let i = 1; i <= this.tabletButtonCount; i++) {
      this.tabletButtonState[`button${i}`] = false;
    }

    console.log(chalk.gray(`  Tablet has ${this.tabletButtonCount} hardware buttons`));
  }

  /**
   * Override attemptReconnect to notify clients on success
   */
  protected async attemptReconnect(): Promise<void> {
    const previousAttempts = this.reconnectAttempts;

    await super.attemptReconnect();

    // If reconnection succeeded (attempts reset to 0 and reader exists)
    if (this.reconnectAttempts === 0 && previousAttempts > 0 && this.reader) {
      this.deviceConnected = true;
      this.initializeTabletButtonState();
      this.broadcastStatus('connected', 'Tablet reconnected successfully');
    }
  }

  /**
   * Handle a config update from a client
   * Updates the config and broadcasts the new config to all clients
   */
  private handleConfigUpdate(path: string, value: unknown): void {
    try {
      // Update the config using the path
      this.setConfigValue(path, value);

      // Re-apply strummer settings if relevant
      if (path.startsWith('strummer.strumming.')) {
        this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);
      }

      // Re-setup notes if chord or note spread changed
      if (path.includes('chord') || path.includes('Spread') || path.includes('initialNotes')) {
        this.setupNotes();
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
        console.log(chalk.cyan(`[MIDI Input] Reconnecting to port: ${value}`));
        this.midiInput.disconnect();
        if (value === null) {
          // Connect to all ports
          this.midiInput.connectAll().then((success) => {
            if (success) {
              console.log(chalk.green(`[MIDI Input] Reconnected to all ports`));
              // Re-register callback after reconnection
              this.registerMidiInputCallback();
              // Broadcast device status to update UI
              this.broadcastMidiDevices();
            }
          });
        } else {
          // Connect to specific port
          this.midiInput.connect(value as string | number).then((success) => {
            if (success) {
              console.log(chalk.green(`[MIDI Input] Reconnected successfully`));
              // Re-register callback after reconnection
              this.registerMidiInputCallback();
              // Broadcast device status to update UI
              this.broadcastMidiDevices();
            }
          });
        }
      }

      console.log(chalk.yellow(`Config updated: ${path} = ${JSON.stringify(value)}`));

      // Broadcast updated config to all clients
      this.broadcastConfig();
    } catch (e) {
      console.error(chalk.red(`Failed to update config: ${path}`), e);
    }
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

      // Re-apply strummer settings
      this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);
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

      // Re-apply settings from the new config
      this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);
      this.setupNotes();
      this.actions.setActionRulesConfig(this.config.strummer.actionRules);

      // Broadcast updated config to all clients (isSavedState=true since we just saved the file)
      this.broadcastConfig(true);
    } catch (e) {
      console.error(chalk.red(`[Upload Config] Failed to upload config:`), e);
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
   * Handle get-midi-devices request
   * Returns available MIDI input and output ports
   */
  private async handleGetMidiDevices(client: WebSocket): Promise<void> {
    try {
      const inputPorts: Array<{ id: number; name: string }> = [];
      const outputPorts: Array<{ id: number; name: string }> = [];

      // Get MIDI input ports
      if (this.midiInput) {
        const availableInputs = await this.midiInput.getAvailablePorts(false);
        inputPorts.push(...availableInputs);
      }

      // Get MIDI output ports
      if (this.backend) {
        const availableOutputs = this.backend.getAvailablePorts();
        availableOutputs.forEach((name: string, index: number) => {
          outputPorts.push({ id: index, name });
        });
      }

      // Get currently connected ports (not just config values)
      // For input: return ALL connected port IDs (for "all ports" mode)
      const currentInputPorts: number[] = [];
      if (this.midiInput && this.midiInput.isConnected) {
        const connectedPorts = this.midiInput.connectedPorts;
        currentInputPorts.push(...connectedPorts.map(p => p.id));
        console.log(chalk.gray(`[Get MIDI Devices] MIDI input connected: ${this.midiInput.isConnected}, ports: ${JSON.stringify(connectedPorts)}`));
      } else {
        console.log(chalk.gray(`[Get MIDI Devices] MIDI input not connected or not initialized`));
      }

      // Build exclusion list (same logic as setupMidiInput)
      const excludedInputPorts: string[] = [...this.config.midi.inputExclude];
      if (this.backend && this.backend.currentOutputName) {
        excludedInputPorts.push(this.backend.currentOutputName);
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
        console.log(chalk.gray(`[Get MIDI Devices] MIDI output connected: ${outputName}, matched port: ${currentOutputPort}`));
      }

      const response = {
        type: 'midi-devices',
        data: {
          inputPorts,
          outputPorts,
          currentInputPorts,  // Array of connected input port IDs
          currentOutputPort,
          excludedInputPorts,  // Ports excluded from input to prevent feedback loops
        },
      };

      console.log(chalk.gray(`[Get MIDI Devices] Sending response: ${JSON.stringify(response, null, 2)}`));
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

      // Get MIDI input ports
      if (this.midiInput) {
        const availableInputs = await this.midiInput.getAvailablePorts(false);
        inputPorts.push(...availableInputs);
      }

      // Get MIDI output ports
      if (this.backend) {
        const availableOutputs = this.backend.getAvailablePorts();
        availableOutputs.forEach((name: string, index: number) => {
          outputPorts.push({ id: index, name });
        });
      }

      // Get currently connected ports
      const currentInputPorts: number[] = [];
      if (this.midiInput && this.midiInput.isConnected) {
        const connectedPorts = this.midiInput.connectedPorts;
        currentInputPorts.push(...connectedPorts.map(p => p.id));
      }

      // Build exclusion list
      const excludedInputPorts: string[] = [...this.config.midi.inputExclude];
      if (this.backend && this.backend.currentOutputName) {
        excludedInputPorts.push(this.backend.currentOutputName);
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

      const message = JSON.stringify({
        type: 'midi-devices',
        data: {
          inputPorts,
          outputPorts,
          currentInputPorts,
          currentOutputPort,
          excludedInputPorts,
        },
      });

      console.log(chalk.gray(`[Broadcast MIDI Devices] Broadcasting to ${this.wss.clients.size} client(s)`));
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
      // Send as 'tablet-data' type for blankslate WebSocketManager compatibility
      // The strum field is optional and will be present when a strum occurred
      this.broadcast({
        type: 'tablet-data',
        ...data,
      });
    });
  }

  protected handlePacket(data: Uint8Array, reportId?: number, interfaceType?: HIDInterfaceType): void {
    try {
      this.packetCount++;

      // Process the data using the config
      const events = this.processPacket(data, reportId, interfaceType);

      // Extract normalized values
      const normalized = normalizeTabletEvent(events);
      const { x, y, pressure, state, tiltX, tiltY, tiltXY, primaryButtonPressed, secondaryButtonPressed } = normalized;

      // Handle stylus button presses via action rules
      // Detect button down events (transition from not pressed to pressed)
      if (primaryButtonPressed && !this.buttonState.primaryButtonPressed) {
        // Primary button just pressed
        this.actions.handleButtonEvent('button:primary', 'press');
      }
      if (!primaryButtonPressed && this.buttonState.primaryButtonPressed) {
        // Primary button just released
        this.actions.handleButtonEvent('button:primary', 'release');
      }

      if (secondaryButtonPressed && !this.buttonState.secondaryButtonPressed) {
        // Secondary button just pressed
        this.actions.handleButtonEvent('button:secondary', 'press');
      }
      if (!secondaryButtonPressed && this.buttonState.secondaryButtonPressed) {
        // Secondary button just released
        this.actions.handleButtonEvent('button:secondary', 'release');
      }

      // Update stylus button states
      this.buttonState.primaryButtonPressed = primaryButtonPressed;
      this.buttonState.secondaryButtonPressed = secondaryButtonPressed;

      // Handle tablet hardware button presses via action rules (dynamic button count)
      for (let i = 1; i <= this.tabletButtonCount; i++) {
        const buttonKey = `button${i}` as keyof typeof normalized;
        const buttonPressed = Boolean(normalized[buttonKey]);
        const stateKey = `button${i}`;
        const wasPressed = this.tabletButtonState[stateKey] ?? false;

        // Detect button down event (transition from not pressed to pressed)
        if (buttonPressed && !wasPressed) {
          // Button just pressed - execute 'press' action via action rules system
          this.actions.handleButtonEvent(`button:${i}`, 'press');
        }

        // Detect button up event (transition from pressed to not pressed)
        if (!buttonPressed && wasPressed) {
          // Button just released - execute 'release' action via action rules system
          this.actions.handleButtonEvent(`button:${i}`, 'release');
        }

        // Update tablet button state
        this.tabletButtonState[stateKey] = buttonPressed;
      }

      // Apply pitch bend based on configuration (throttled to avoid MIDI flooding)
      const pitchBendCfg = this.config.pitchBend;
      if (pitchBendCfg && this.backend) {
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
          // This prevents MIDI flooding when there's no actual pitch bend
          if (Math.abs(bendValue) < 0.02) {
            bendValue = 0.0;
          }

          // Only send if value changed significantly
          // Don't send repeated messages with the same value
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
      // Use Record type for dynamic button assignment, then cast to TabletEventData
      const tabletEventData: Record<string, unknown> = {
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        tiltXY,
        primaryButtonPressed,
        secondaryButtonPressed,
        state: state as 'hover' | 'contact' | 'out-of-range',
        timestamp: Date.now(),
        // Tablet hardware buttons
        tabletButtons: normalized.tabletButtons,
      };
      // Dynamically add all button states based on device capabilities
      for (let i = 1; i <= this.tabletButtonCount; i++) {
        const buttonKey = `button${i}`;
        tabletEventData[buttonKey] = Boolean((normalized as Record<string, unknown>)[buttonKey]);
      }
      this.eventBus.emitTabletEvent(tabletEventData as unknown as TabletEventData);

      // Update strummer bounds
      this.strummer.updateBounds(1.0, 1.0);

      // Apply X inversion for left-handed use if configured
      const strumX = this.config.strumming.invertX ? 1.0 - x : x;

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
      console.error(chalk.red(`Error processing packet: ${e}`));
    }
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
    // If inputPort is null, listens to ALL ports (discovery mode)
    // If inputPort is specified, connects only to that port
    console.log(chalk.gray('Initializing MIDI input...'));
    if (await this.setupMidiInput()) {
      const portInfo = this.config.inputPort === null
        ? `listening to all ports (${this.midiInput?.connectedPorts.length ?? 0} found)`
        : this.midiInput?.currentInputName;
      console.log(chalk.green(`✓ MIDI input: ${portInfo}`));
    } else {
      console.log(chalk.yellow('⚠ No MIDI input ports available'));
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

    // Set up event subscriptions
    this.setupEventSubscriptions();

    // Initialize tablet reader (may fail if no device connected)
    console.log(chalk.gray('\nInitializing tablet reader...'));
    try {
      await this.initializeReader();

      if (this.reader) {
        this.deviceConnected = true;
        this.initializeTabletButtonState();

        // Start reading
        this.reader.startReading((data, reportId, interfaceType) => {
          this.handlePacket(data, reportId, interfaceType);
        });

        console.log(chalk.green('✓ Started reading tablet data'));
      }
    } catch (e) {
      // No device found at startup - this is OK, we'll wait for one
      const error = e as Error;
      console.log(chalk.yellow(`\n⚠ No tablet connected: ${error.message}`));
      console.log(chalk.yellow('  Server is running - waiting for tablet to be connected...'));
      this.deviceConnected = false;

      // Start polling for device (uses parent class's polling mechanism)
      this.startDevicePolling();
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

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    await super.stop();
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('server')
    .description('Sketchatone Server - HTTP server for webapps and WebSocket server for tablet/strum events')
    .option('-c, --config <path>', 'Combined config file path (strummer, MIDI, and server settings). Device path is specified in server.device field.')
    .option('--ws-port <number>', 'WebSocket server port (default: 8081)', parseInt)
    .option('--http-port <number>', 'HTTP server port for serving webapps', parseInt)
    .option('--throttle <ms>', 'Throttle interval in milliseconds (default: 150)', parseInt)
    .option('--poll <ms>', 'Poll interval in milliseconds for waiting for device. If not set, quit if no device found.', parseInt)
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

  // Get device path from config (defaults to DEFAULT_CONFIG_DIR if not specified)
  const devicePath = strummerConfig.server.device ?? DEFAULT_CONFIG_DIR;
  const configDir = configPath ? path.dirname(configPath) : process.cwd();

  // Resolve device path (absolute or relative to config file directory)
  const resolvedInput = path.isAbsolute(devicePath)
    ? devicePath
    : path.resolve(configDir, devicePath);

  // Handle --dump-config: print config as JSON and exit
  if (options.dumpConfig) {
    console.log(JSON.stringify(strummerConfig.toDict(), null, 2));
    process.exit(0);
  }

  // Resolve effective poll interval (CLI arg takes precedence over config)
  const effectivePoll = options.poll ?? strummerConfig.deviceFindingPollInterval ?? undefined;

  // Parse MIDI port (could be int or string)
  let midiPort: string | number | undefined = options.port;
  if (midiPort !== undefined) {
    const parsed = parseInt(midiPort, 10);
    if (!isNaN(parsed)) {
      midiPort = parsed;
    }
  }

  // Helper function to create and start the server with a given config path
  const createAndStartServer = async (tabletConfigPath: string): Promise<void> => {
    const server = new StrummerWebSocketServer(tabletConfigPath, {
      strummerConfigPath: configPath,
      wsPort: options.wsPort,
      httpPort: options.httpPort,
      throttleMs: options.throttle,
      // MIDI options
      midiChannel: options.channel,
      midiPort,
      noteDuration: options.duration,
    });

    await server.start();
  };

  try {
    // Check if the input is a file or directory
    const stat = fs.existsSync(resolvedInput) ? fs.statSync(resolvedInput) : null;
    const isDirectory = stat?.isDirectory() ?? false;
    const isFile = stat?.isFile() ?? false;

    if (isFile) {
      // User provided a specific config file - use it directly
      console.log(chalk.blue('[Config]'), `Using specified config file: ${resolvedInput}`);
      await createAndStartServer(resolvedInput);
    } else if (isDirectory || !stat) {
      // Directory or default - need to auto-detect device
      const configDir = isDirectory ? resolvedInput : path.resolve(DEFAULT_CONFIG_DIR);

      // Try to find a connected device
      let configPath = findConfigForDevice(configDir);

      if (configPath) {
        console.log(chalk.blue('[Config]'), `Found device config: ${configPath}`);
        await createAndStartServer(configPath);
      } else if (effectivePoll !== undefined) {
        // No device found, but poll is set - poll indefinitely
        console.log(chalk.yellow('[Config]'), 'No tablet device found. Waiting for device to be connected...');
        console.log(chalk.gray('[Config]'), `Scanning directory: ${configDir}`);
        console.log(chalk.gray('[Config]'), `Poll interval: ${effectivePoll}ms`);

        const pollForDevice = (): Promise<string> => {
          return new Promise((resolve) => {
            const poll = (): void => {
              const foundConfig = findConfigForDevice(configDir);
              if (foundConfig) {
                resolve(foundConfig);
              } else {
                setTimeout(poll, effectivePoll);
              }
            };
            poll();
          });
        };

        configPath = await pollForDevice();
        console.log(chalk.green('[Config]'), `Device connected! Using config: ${configPath}`);
        await createAndStartServer(configPath);
      } else {
        // No device found and poll not set - exit
        console.error(chalk.red('[Config]'), 'No tablet device found.');
        console.error(chalk.gray('[Config]'), `Scanned directory: ${configDir}`);
        console.error(chalk.gray('[Config]'), 'Use --poll <ms> to wait for a device to be connected.');
        process.exit(1);
      }
    } else {
      throw new Error(`Invalid config path: ${resolvedInput}`);
    }
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
import { fileURLToPath } from 'url';
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
