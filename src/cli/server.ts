#!/usr/bin/env node
/**
 * Strummer WebSocket Server
 *
 * A WebSocket server that broadcasts tablet and strum events from the MIDI Strummer.
 * Clients can subscribe to either tablet events or strum events (not both at the same time).
 *
 * Usage:
 *   npm run strummer-websocket
 *   npm run strummer-websocket -- --port 8081
 *   npm run strummer-websocket -- --mode tablet
 *   npm run strummer-websocket -- --mode strum
 *   npm run strummer-websocket -- --throttle 100
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

// Import from blankslate CLI modules
import { TabletReaderBase, type TabletReaderOptions, normalizeTabletEvent, resolveConfigPath, findConfigForDevice } from 'blankslate/cli/tablet-reader-base.js';

// Default config directory
const DEFAULT_CONFIG_DIR = './public/configs';
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { Actions } from '../core/actions.js';
import { MidiStrummerConfig, type MidiStrummerConfigData } from '../models/midi-strummer-config.js';
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
 * Full config data sent to clients on connection
 */
interface ServerConfigData {
  /** Event throttle in milliseconds */
  throttleMs: number;
  /** Current notes (computed from chord or initial notes) */
  notes: Array<{ notation: string; octave: number }>;
  /** Full strummer configuration */
  config: MidiStrummerConfigData;
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
  public notesPlayed: number = 0;
  private actions: Actions;

  // State tracking for stylus buttons
  private buttonState = {
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
  };

  // State tracking for tablet hardware buttons (1-8)
  private tabletButtonState: Record<string, boolean> = {
    button1: false,
    button2: false,
    button3: false,
    button4: false,
    button5: false,
    button6: false,
    button7: false,
    button8: false,
  };

  // State tracking for note repeater
  private repeaterState = {
    notes: [] as StrumNoteData[],
    lastRepeatTime: 0,
    isHolding: false,
  };

  // State tracking for strum release feature
  private strumStartTime: number = 0;

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

    // CLI args take precedence over config file values
    this.wsPort = options.wsPort ?? this.config.wsPort ?? 8081;
    this.httpPort = options.httpPort ?? this.config.httpPort ?? undefined;
    // Resolve public directory relative to the package root
    // Built webapp files are in dist/public
    this.publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

    // Create a local event bus instance with custom throttle
    // CLI args take precedence over config file values
    this.eventBus = new StrummerEventBus(options.throttleMs ?? this.config.wsMessageThrottle ?? 150);

    // Create strummer
    this.strummer = new Strummer();
    this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);

    // Set up notes
    this.setupNotes();

    // Create Actions handler for stylus buttons
    this.actions = new Actions(
      {
        noteRepeater: this.config.noteRepeater,
        transpose: this.config.transpose,
        lowerSpread: this.config.strummer.lowerSpread,
        upperSpread: this.config.strummer.upperSpread,
      },
      this.strummer
    );
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

      // Build list of ports to exclude (to prevent feedback from our own output)
      const excludePorts: string[] = [];
      if (this.backend && 'currentOutputName' in this.backend && this.backend.currentOutputName) {
        excludePorts.push(this.backend.currentOutputName as string);
        console.log(chalk.gray(`[MIDI Input] Excluding output port from input: ${this.backend.currentOutputName}`));
      }

      let connected = false;
      if (inputPort === null || inputPort === undefined) {
        // Discovery mode: listen to all ports (except our output)
        connected = await this.midiInput.connectAll(excludePorts);
      } else {
        // Specific port mode
        connected = await this.midiInput.connect(inputPort);
      }

      if (!connected) {
        console.log(chalk.yellow('[MIDI Input] No MIDI input ports available'));
        return false;
      }

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

    const midiInputMessage = {
      type: 'midi-input',
      notes: event.notes,
      added: event.added,
      removed: event.removed,
      portName: event.portName,
      availablePorts: this.midiInput?.connectedPorts ?? [],
    };

    const data = JSON.stringify(midiInputMessage);
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

    const midiInputMessage = {
      type: 'midi-input-status',
      connected: this.midiInput.isConnected,
      availablePorts: this.midiInput.connectedPorts,
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
    console.log(chalk.cyan('  Channel: ') + chalk.white(this.config.channel.toString()));
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
  private sendConfig(client: WebSocket): void {
    const configData: ServerConfigData = {
      throttleMs: this.eventBus.throttleMs,
      notes: this.strummer.notes.map((n) => ({
        notation: n.notation,
        octave: n.octave,
      })),
      config: this.config.toDict(),
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
  private broadcastConfig(): void {
    if (!this.wss) return;

    const configData: ServerConfigData = {
      throttleMs: this.eventBus.throttleMs,
      notes: this.strummer.notes.map((n) => ({
        notation: n.notation,
        octave: n.octave,
      })),
      config: this.config.toDict(),
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
   * Override attemptReconnect to notify clients on success
   */
  protected async attemptReconnect(): Promise<void> {
    const previousAttempts = this.reconnectAttempts;

    await super.attemptReconnect();

    // If reconnection succeeded (attempts reset to 0 and reader exists)
    if (this.reconnectAttempts === 0 && previousAttempts > 0 && this.reader) {
      this.deviceConnected = true;
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

      console.log(chalk.yellow(`Config updated: ${path} = ${JSON.stringify(value)}`));

      // Broadcast updated config to all clients
      this.broadcastConfig();
    } catch (e) {
      console.error(chalk.red(`Failed to update config: ${path}`), e);
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

    if (camelLastPart in current || !(lastPart in current)) {
      current[camelLastPart] = value;
    } else {
      current[lastPart] = value;
    }
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

  protected handlePacket(data: Uint8Array): void {
    try {
      this.packetCount++;

      // Process the data using the config
      const events = this.processPacket(data);

      // Extract normalized values
      const normalized = normalizeTabletEvent(events);
      const { x, y, pressure, state, tiltX, tiltY, tiltXY, primaryButtonPressed, secondaryButtonPressed } = normalized;

      // Handle stylus button presses
      const stylusButtonsCfg = this.config.stylusButtons;

      // Detect button down events (transition from not pressed to pressed)
      if (stylusButtonsCfg?.active) {
        if (primaryButtonPressed && !this.buttonState.primaryButtonPressed) {
          // Primary button just pressed
          const action = stylusButtonsCfg.primaryButtonAction;
          this.actions.execute(action, { button: 'Primary' });
        }

        if (secondaryButtonPressed && !this.buttonState.secondaryButtonPressed) {
          // Secondary button just pressed
          const action = stylusButtonsCfg.secondaryButtonAction;
          this.actions.execute(action, { button: 'Secondary' });
        }
      }

      // Update stylus button states
      this.buttonState.primaryButtonPressed = primaryButtonPressed;
      this.buttonState.secondaryButtonPressed = secondaryButtonPressed;

      // Handle tablet hardware button presses (buttons 1-8)
      const tabletButtonsCfg = this.config.tabletButtons;
      for (let i = 1; i <= 8; i++) {
        const buttonKey = `button${i}` as keyof typeof normalized;
        const buttonPressed = Boolean(normalized[buttonKey]);
        const stateKey = `button${i}`;

        // Detect button down event (transition from not pressed to pressed)
        if (buttonPressed && !this.tabletButtonState[stateKey]) {
          // Button just pressed - execute configured action
          const action = tabletButtonsCfg?.getButtonAction(i);
          if (action) {
            this.actions.execute(action, { button: `Tablet${i}` });
          }
        }

        // Update tablet button state
        this.tabletButtonState[stateKey] = buttonPressed;
      }

      // Apply pitch bend based on configuration
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
          const bendValue = pitchBendCfg.mapValue(controlValue);
          this.backend.sendPitchBend?.(bendValue);
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

      // Emit tablet event to event bus (throttled)
      const tabletEventData: TabletEventData = {
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

      // Update strummer bounds
      this.strummer.updateBounds(1.0, 1.0);

      // Process strum
      const event = this.strummer.strum(x, pressure);

      // Get note repeater configuration
      const noteRepeaterCfg = this.config.noteRepeater;
      const noteRepeaterEnabled = noteRepeaterCfg?.active ?? false;
      const pressureMultiplier = noteRepeaterCfg?.pressureMultiplier ?? 1.0;
      const frequencyMultiplier = noteRepeaterCfg?.frequencyMultiplier ?? 1.0;

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

          // Emit strum event to event bus (throttled)
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

          // Emit release event to event bus (throttled)
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

    // Start HTTP server if port configured
    if (this.httpPort) {
      this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
      this.httpServer.listen(this.httpPort, () => {
        console.log(chalk.green(`✓ HTTP server listening on port ${this.httpPort}`));
        console.log(chalk.cyan(`  Serving: ${this.publicDir}`));
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
          }
        } catch (e) {
          // Ignore invalid messages
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

    // Set up event subscriptions
    this.setupEventSubscriptions();

    // Initialize tablet reader (may fail if no device connected)
    console.log(chalk.gray('\nInitializing tablet reader...'));
    try {
      await this.initializeReader();

      if (this.reader) {
        this.deviceConnected = true;

        // Start reading
        this.reader.startReading((data) => {
          this.handlePacket(data);
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
    .option('-t, --tablet-config <path>', 'Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided)')
    .option('-s, --strummer-config <path>', 'Path to strummer config JSON file')
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

  # Start with both HTTP and WebSocket servers
  npm run server -- --http-port 3000 --ws-port 8081

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
    tabletConfig?: string;
    strummerConfig?: string;
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

  const configInput = options.tabletConfig ?? DEFAULT_CONFIG_DIR;
  const resolvedInput = path.resolve(configInput);

  // Load strummer config early to get server settings (CLI args take precedence)
  const strummerConfigPath = options.strummerConfig ? path.resolve(options.strummerConfig) : undefined;
  const strummerConfig = strummerConfigPath
    ? MidiStrummerConfig.fromJsonFile(strummerConfigPath)
    : new MidiStrummerConfig();

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
      strummerConfigPath,
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
