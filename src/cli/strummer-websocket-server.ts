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
import * as path from 'path';

// Import from blankslate CLI modules
import { TabletReaderBase, type TabletReaderOptions, normalizeTabletEvent, resolveConfigPath } from 'blankslate/cli/tablet-reader-base.js';

// Default config directory
const DEFAULT_CONFIG_DIR = './public/configs';
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { MidiStrummerConfig, type MidiStrummerConfigData } from '../models/midi-strummer-config.js';
import { Note, type NoteObject } from '../models/note.js';
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
 */
class StrummerWebSocketServer extends TabletReaderBase {
  private wss: WebSocketServer | null = null;
  private port: number;
  private config: MidiStrummerConfig;
  private strummer: Strummer;
  private eventBus: StrummerEventBus;
  private combinedUnsubscribe: (() => void) | null = null;
  private clientCount: number = 0;

  constructor(
    tabletConfigPath: string,
    options: TabletReaderOptions & {
      strummerConfigPath?: string;
      port?: number;
      throttleMs?: number;
    } = {}
  ) {
    super(tabletConfigPath, options);
    this.port = options.port ?? 8081;

    // Create a local event bus instance with custom throttle
    this.eventBus = new StrummerEventBus(options.throttleMs ?? 150);

    // Load combined config from file or use defaults
    if (options.strummerConfigPath) {
      this.config = MidiStrummerConfig.fromJsonFile(options.strummerConfigPath);
    } else {
      this.config = new MidiStrummerConfig();
    }

    // Create strummer
    this.strummer = new Strummer();
    this.strummer.configure(this.config.velocityScale, this.config.pressureThreshold);

    // Set up notes
    this.setupNotes();
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
   * Set a config value using dot-notation path
   */
  private setConfigValue(path: string, value: unknown): void {
    const parts = path.split('.');

    // Navigate to the parent object
    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        throw new Error(`Invalid path: ${path}`);
      }
      current = current[part] as Record<string, unknown>;
    }

    // Set the value
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
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
    // Skip all processing if no clients are connected
    if (!this.hasClients()) {
      return;
    }

    try {
      this.packetCount++;

      // Process the data using the config
      const events = this.processPacket(data);

      // Extract normalized values
      const normalized = normalizeTabletEvent(events);
      const { x, y, pressure, state, tiltX, tiltY, tiltXY, primaryButtonPressed, secondaryButtonPressed } = normalized;

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
      };
      this.eventBus.emitTabletEvent(tabletEventData);

      // Update strummer bounds
      this.strummer.updateBounds(1.0, 1.0);

      // Process strum
      const event = this.strummer.strum(x, pressure);

      if (event) {
        if (event.type === 'strum') {
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
    } catch (e) {
      console.error(chalk.red(`Error processing packet: ${e}`));
    }
  }

  async start(): Promise<void> {
    console.log(chalk.cyan.bold('\n╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║') + chalk.white.bold('              STRUMMER WEBSOCKET SERVER                     ') + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════════╝\n'));

    // Start WebSocket server
    this.wss = new WebSocketServer({ port: this.port });

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

    console.log(chalk.green(`✓ WebSocket server listening on port ${this.port}`));
    console.log(chalk.cyan(`  Throttle: ${this.eventBus.throttleMs}ms`));

    // Set up event subscriptions
    this.setupEventSubscriptions();

    // Initialize tablet reader
    console.log(chalk.gray('\nInitializing tablet reader...'));
    await this.initializeReader();

    if (!this.reader) {
      throw new Error('Reader not initialized');
    }

    // Start reading
    this.reader.startReading((data) => {
      this.handlePacket(data);
    });

    console.log(chalk.green('✓ Started reading tablet data'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    if (this.isMockMode) {
      this.startMockGestureCycle();
    }

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
    .name('strummer-websocket')
    .description('Strummer WebSocket Server - broadcasts combined tablet and strum events')
    .option('-t, --tablet-config <path>', 'Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided)')
    .option('-s, --strummer-config <path>', 'Path to strummer config JSON file')
    .option('-p, --port <number>', 'WebSocket server port (default: 8081)', parseInt)
    .option('--throttle <ms>', 'Throttle interval in milliseconds (default: 150)', parseInt)
    .option('-m, --mock', 'Use mock data instead of real device')
    .addHelpText(
      'after',
      `
Examples:
  # Auto-detect tablet from default config directory
  npm run strummer-websocket

  # Specify port
  npm run strummer-websocket -- --port 8082

  # With custom throttle (100ms = 10 events/second max)
  npm run strummer-websocket -- --throttle 100

  # With mock data for testing
  npm run strummer-websocket -- --mock
`
    );

  program.parse();

  const options = program.opts<{
    tabletConfig?: string;
    strummerConfig?: string;
    port?: number;
    throttle?: number;
    mock?: boolean;
  }>();

  // Resolve tablet config path
  const tabletConfigPath = resolveConfigPath(options.tabletConfig ?? DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_DIR);

  let server: StrummerWebSocketServer | null = null;
  try {
    server = new StrummerWebSocketServer(tabletConfigPath, {
      mock: options.mock,
      strummerConfigPath: options.strummerConfig ? path.resolve(options.strummerConfig) : undefined,
      port: options.port,
      throttleMs: options.throttle,
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
import { fileURLToPath } from 'url';
import * as nodePath from 'path';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && nodePath.resolve(process.argv[1]) === __filename;

// Also check if we're being run as a bin script
const isBinScript = process.argv[1]?.endsWith('strummer-websocket') ||
                    process.argv[1]?.endsWith('strummer-websocket-server.js');

if (isMainModule || isBinScript) {
  main().catch((error) => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { StrummerWebSocketServer };
