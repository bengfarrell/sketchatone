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

  constructor(
    tabletConfigPath: string,
    options: TabletReaderOptions & {
      strummerConfigPath?: string;
      wsPort?: number;
      httpPort?: number;
      throttleMs?: number;
    } = {}
  ) {
    super(tabletConfigPath, options);

    // Load combined config from file or use defaults
    if (options.strummerConfigPath) {
      this.config = MidiStrummerConfig.fromJsonFile(options.strummerConfigPath);
    } else {
      this.config = new MidiStrummerConfig();
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
    .addHelpText(
      'after',
      `
Examples:
  # Start with WebSocket only (default port 8081)
  npm run server

  # Start with both HTTP and WebSocket servers
  npm run server -- --http-port 3000 --ws-port 8081

  # Wait indefinitely for device, polling every 2 seconds
  npm run server -- --poll 2000

  # With custom throttle (100ms = 10 events/second max)
  npm run server -- --throttle 100
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
  }>();

  const configInput = options.tabletConfig ?? DEFAULT_CONFIG_DIR;
  const resolvedInput = path.resolve(configInput);

  // Load strummer config early to get server settings (CLI args take precedence)
  const strummerConfigPath = options.strummerConfig ? path.resolve(options.strummerConfig) : undefined;
  const strummerConfig = strummerConfigPath
    ? MidiStrummerConfig.fromJsonFile(strummerConfigPath)
    : new MidiStrummerConfig();

  // Resolve effective poll interval (CLI arg takes precedence over config)
  const effectivePoll = options.poll ?? strummerConfig.deviceFindingPollInterval ?? undefined;

  // Helper function to create and start the server with a given config path
  const createAndStartServer = async (tabletConfigPath: string): Promise<void> => {
    const server = new StrummerWebSocketServer(tabletConfigPath, {
      strummerConfigPath,
      wsPort: options.wsPort,
      httpPort: options.httpPort,
      throttleMs: options.throttle,
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
