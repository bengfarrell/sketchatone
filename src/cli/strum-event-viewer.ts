#!/usr/bin/env node
/**
 * Strum Event Viewer CLI
 *
 * A CLI tool that reads tablet events directly via HID and displays strum events.
 * Extends blankslate's TabletReaderBase for direct device access.
 *
 * Usage:
 *   npm run strum-events
 *   npm run strum-events -- --config ./configs/
 *   npm run strum-events -- --config path/to/config.json
 *   npm run strum-events -- --config path/to/config.json --strummer-config path/to/strummer.json
 *   npm run strum-events -- --config path/to/config.json --mock
 */

import chalk from 'chalk';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

// Import from blankslate CLI modules
import { TabletReaderBase, type TabletReaderOptions, normalizeTabletEvent, resolveConfigPath } from 'blankslate/cli/tablet-reader-base.js';

// Default config directory
const DEFAULT_CONFIG_DIR = './public/configs';
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { StrummerConfig } from '../models/strummer-config.js';
import { Note, type NoteObject } from '../models/note.js';

/**
 * Print strummer-specific configuration info
 */
function printStrummerInfo(strummerConfig: StrummerConfig): void {
  console.log(chalk.cyan('Pressure Threshold: ') + chalk.white(strummerConfig.pressureThreshold.toString()));
  console.log(chalk.cyan('Notes: ') + chalk.white(strummerConfig.notes.join(', ')));
  if (strummerConfig.chord) {
    console.log(chalk.cyan('Chord: ') + chalk.white(strummerConfig.chord));
  }
  console.log();
}

/**
 * Create a progress bar
 */
function createBar(value: number, maxVal: number, width: number): string {
  const clampedValue = Math.max(0, value);
  const filled = maxVal > 0 ? Math.min(Math.floor((clampedValue / maxVal) * width), width) : 0;
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

/**
 * Format a note for display
 */
function formatNote(note: NoteObject): string {
  const secondaryMarker = note.secondary ? chalk.gray('*') : '';
  return chalk.white(`${note.notation}${note.octave}`) + secondaryMarker;
}

/**
 * Print a strum event in a formatted way
 */
function printStrumEvent(event: StrummerEvent): void {
  if (event.type === 'strum') {
    const noteStrs: string[] = [];
    for (const noteData of event.notes) {
      const noteStr = formatNote(noteData.note);
      const velBar = createBar(noteData.velocity, 127, 10);
      noteStrs.push(`${noteStr} vel:${noteData.velocity.toString().padStart(3)} ${velBar}`);
    }

    console.log(chalk.green.bold('♪ STRUM'));
    for (const noteStr of noteStrs) {
      console.log(`  ${noteStr}`);
    }
    console.log();
  } else if (event.type === 'release') {
    console.log(chalk.yellow('↑ RELEASE') + ` (last velocity: ${event.velocity})`);
    console.log();
  }
}

/**
 * Print a live dashboard view with visual string representation
 */
function printLiveDashboard(
  strummer: Strummer,
  x: number,
  y: number,
  pressure: number,
  state: string,
  lastEvent: StrummerEvent | null,
  packetCount: number
): void {
  // ANSI codes
  const HIDE_CURSOR = '\x1b[?25l';
  const MOVE_HOME = '\x1b[H';
  const CLEAR_LINE = '\x1b[2K';

  const lines: string[] = [];
  const border = chalk.cyan.bold('│');
  const boxWidth = 63;

  // Helper to pad line content (accounting for ANSI codes)
  const padLine = (content: string, targetLen: number): string => {
    // Strip ANSI codes to get actual visible length
    const visibleLen = content.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, targetLen - visibleLen);
    return content + ' '.repeat(padding);
  };

  // Header
  lines.push(chalk.cyan.bold('┌' + '─'.repeat(boxWidth) + '┐'));
  lines.push(border + chalk.white.bold('                      STRUM EVENT VIEWER                        ') + border);
  lines.push(chalk.cyan.bold('├' + '─'.repeat(boxWidth) + '┤'));

  // Packet counter and state
  const packetStr = `Packets: ${packetCount}`;
  const stateColor = state === 'contact' ? chalk.green.bold : state === 'hover' ? chalk.yellow : chalk.gray;
  const stateStr = `State: ${stateColor(state)}`;
  lines.push(border + ' ' + padLine(`${packetStr}     ${stateStr}`, boxWidth - 1) + border);

  // Pressure bar
  const pPct = `${(pressure * 100).toFixed(0)}%`.padStart(4);
  const pressureBar = createBar(pressure, 1.0, 20);
  const isPressed = pressure >= strummer.pressureThreshold;
  const pressureLabel = isPressed ? chalk.green.bold('PRESSED') : chalk.gray('       ');
  lines.push(border + ' ' + padLine(`Pressure: ${pPct} ${pressureBar} ${pressureLabel}`, boxWidth - 1) + border);

  lines.push(chalk.cyan.bold('├' + '─'.repeat(boxWidth) + '┤'));

  // String visualization
  const numStrings = strummer.notes.length;
  if (numStrings > 0) {
    const stringWidth = 1.0 / numStrings;
    const currentString = stringWidth > 0 ? Math.min(Math.floor(x / stringWidth), numStrings - 1) : 0;

    // Calculate spacing for strings
    const stringSpacing = Math.floor((boxWidth - 4) / numStrings);
    const totalWidth = stringSpacing * numStrings;
    const leftPad = Math.floor((boxWidth - totalWidth) / 2);

    // String characters
    const STRING_IDLE = '│';
    const STRING_HOVER = '┃';
    const STRING_STRUM = '╋';

    // Build string rows (5 rows for visual height)
    for (let row = 0; row < 5; row++) {
      let rowContent = ' '.repeat(leftPad);
      for (let i = 0; i < numStrings; i++) {
        const isCurrentString = i === currentString;
        const isStrummed = isCurrentString && isPressed;
        const isHovered = isCurrentString && !isPressed;

        let stringChar: string;
        if (isStrummed) {
          // Strummed - show vibrating string
          stringChar = row === 2 ? chalk.green.bold(STRING_STRUM) : chalk.green.bold('║');
        } else if (isHovered) {
          // Hovered - highlight
          stringChar = chalk.yellow(STRING_HOVER);
        } else {
          // Idle
          stringChar = chalk.gray(STRING_IDLE);
        }

        // Center the string character in its column
        const colPad = Math.floor((stringSpacing - 1) / 2);
        rowContent += ' '.repeat(colPad) + stringChar + ' '.repeat(stringSpacing - colPad - 1);
      }
      lines.push(border + padLine(rowContent, boxWidth - 1) + border);
    }

    // Note labels row
    let noteRow = ' '.repeat(leftPad);
    for (let i = 0; i < numStrings; i++) {
      const note = strummer.notes[i];
      const noteLabel = `${note.notation}${note.octave}`;
      const isCurrentString = i === currentString;
      const isStrummed = isCurrentString && isPressed;

      let coloredLabel: string;
      if (isStrummed) {
        coloredLabel = chalk.green.bold(noteLabel);
      } else if (isCurrentString) {
        coloredLabel = chalk.yellow(noteLabel);
      } else {
        coloredLabel = note.secondary ? chalk.gray.dim(noteLabel) : chalk.white(noteLabel);
      }

      // Center the note label in its column
      const labelLen = noteLabel.length;
      const colPad = Math.floor((stringSpacing - labelLen) / 2);
      noteRow += ' '.repeat(colPad) + coloredLabel + ' '.repeat(stringSpacing - colPad - labelLen);
    }
    lines.push(border + padLine(noteRow, boxWidth - 1) + border);

    // Velocity row (show velocity for strummed string)
    let velRow = ' '.repeat(leftPad);
    for (let i = 0; i < numStrings; i++) {
      const isCurrentString = i === currentString;
      const isStrummed = isCurrentString && isPressed;

      let velLabel: string;
      if (isStrummed) {
        // Calculate velocity based on pressure
        const velocity = Math.min(127, Math.floor(pressure * strummer.velocityScale * 127));
        velLabel = chalk.cyan(`v${velocity.toString().padStart(3)}`);
      } else {
        velLabel = '    ';
      }

      const colPad = Math.floor((stringSpacing - 4) / 2);
      velRow += ' '.repeat(colPad) + velLabel + ' '.repeat(stringSpacing - colPad - 4);
    }
    lines.push(border + padLine(velRow, boxWidth - 1) + border);
  } else {
    lines.push(border + padLine('  No strings configured', boxWidth - 1) + border);
  }

  // Last event section
  lines.push(chalk.cyan.bold('├' + '─'.repeat(boxWidth) + '┤'));

  if (lastEvent) {
    if (lastEvent.type === 'strum') {
      const noteNames = lastEvent.notes.map((n: StrumNoteData) => `${n.note.notation}${n.note.octave}`);
      const avgVel = Math.round(lastEvent.notes.reduce((sum, n) => sum + n.velocity, 0) / lastEvent.notes.length);
      const eventLine = `${chalk.green.bold('♪ STRUM')} ${noteNames.join(' ')} ${chalk.cyan(`vel:${avgVel}`)}`;
      lines.push(border + ' ' + padLine(eventLine, boxWidth - 1) + border);
    } else if (lastEvent.type === 'release') {
      const eventLine = `${chalk.yellow('↑ RELEASE')} ${chalk.gray(`(velocity: ${lastEvent.velocity})`)}`;
      lines.push(border + ' ' + padLine(eventLine, boxWidth - 1) + border);
    }
  } else {
    lines.push(border + ' ' + padLine(chalk.gray('Waiting for strum...'), boxWidth - 1) + border);
  }

  lines.push(chalk.cyan.bold('└' + '─'.repeat(boxWidth) + '┘'));
  lines.push(chalk.gray('Press Ctrl+C to stop'));

  // Build output
  const content = lines.map((line) => `${CLEAR_LINE}${line}`).join('\n') + '\n';
  process.stdout.write(HIDE_CURSOR + MOVE_HOME + content);
}

/**
 * Strum event viewer that reads directly from tablet via HID
 */
class StrumEventViewer extends TabletReaderBase {
  private liveMode: boolean;
  private lastEvent: StrummerEvent | null = null;
  private lastLiveUpdate = 0;
  private strummerConfig: StrummerConfig;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  strummer: Strummer;

  constructor(
    configPath: string,
    options: TabletReaderOptions & {
      strummerConfigPath?: string;
      liveMode?: boolean;
    } = {}
  ) {
    super(configPath, options);
    this.liveMode = options.liveMode ?? false;

    // Load or create strummer config
    if (options.strummerConfigPath) {
      this.strummerConfig = StrummerConfig.fromJsonFile(options.strummerConfigPath);
    } else {
      this.strummerConfig = new StrummerConfig();
    }

    // Create strummer
    this.strummer = new Strummer();
    this.strummer.configure(this.strummerConfig.velocityScale, this.strummerConfig.pressureThreshold);

    // Set up notes
    this.setupNotes();
  }

  private setupNotes(): void {
    let notes: NoteObject[] = [];

    if (this.strummerConfig.chord) {
      // Parse chord notation
      const chordNotes = Note.parseChord(this.strummerConfig.chord);
      notes = Note.fillNoteSpread(chordNotes, this.strummerConfig.lowerSpread, this.strummerConfig.upperSpread);
    } else {
      // Use explicit notes from config
      for (const noteStr of this.strummerConfig.notes) {
        notes.push(Note.parseNotation(noteStr));
      }
    }

    this.strummer.notes = notes;
  }

  protected handlePacket(data: Uint8Array): void {
    try {
      this.packetCount++;

      // Process the data using the config
      const events = this.processPacket(data);

      // Extract normalized values
      const normalized = normalizeTabletEvent(events);
      const { x, y, pressure, state } = normalized;

      // Update strummer bounds (use normalized 0-1 range)
      this.strummer.updateBounds(1.0, 1.0);

      // Process strum
      const event = this.strummer.strum(x, pressure);

      if (event) {
        this.lastEvent = event;
        if (!this.liveMode) {
          printStrumEvent(event);
        }
      }

      if (this.liveMode) {
        // Throttle live updates to ~10fps
        const now = Date.now() / 1000;
        if (now - this.lastLiveUpdate >= 0.1 || event) {
          this.lastLiveUpdate = now;
          printLiveDashboard(this.strummer, x, y, pressure, state, this.lastEvent, this.packetCount);
        }
      }
    } catch (e) {
      const error = e as Error;
      process.stderr.write(`\n[ERROR] Failed to process packet: ${error.message}\n`);
      if (error.stack) {
        process.stderr.write(error.stack + '\n');
      }
    }
  }

  async start(): Promise<void> {
    this.printHeader('Strum Event Viewer');
    printStrummerInfo(this.strummerConfig);

    // Initialize reader
    console.log(chalk.gray('Initializing...'));
    await this.initializeReader();

    if (!this.reader) {
      throw new Error('Reader not initialized');
    }

    // Start reading
    console.log(chalk.gray('Setting up data callback...'));
    this.reader.startReading((data) => {
      this.handlePacket(data);
    });

    console.log(chalk.green('✓ Started reading data'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    if (this.isMockMode) {
      this.startMockGestureCycle();
    }

    // Keep the process alive (HID reader alone doesn't keep Node.js event loop active)
    this.keepAliveInterval = setInterval(() => {}, 1000);

    // Set up shutdown handlers
    this.setupShutdownHandlers();
  }

  async stop(): Promise<void> {
    // Clear keep-alive interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    await super.stop();
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('strum-events')
    .description('View strum events from tablet input')
    .option('-c, --config <path>', 'Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided)')
    .option('-s, --strummer-config <path>', 'Path to strummer config JSON file')
    .option('-l, --live', 'Live dashboard mode (updates in place)')
    .option('-m, --mock', 'Use mock data instead of real device')
    .addHelpText(
      'after',
      `
Examples:
  # Auto-detect tablet from default config directory
  npm run strum-events

  # Auto-detect tablet from specific directory
  npm run strum-events -- -c ./configs/

  # Basic usage with tablet config
  npm run strum-events -- -c tablet-config.json

  # With custom strummer config
  npm run strum-events -- -c tablet-config.json -s strummer-config.json

  # Live dashboard mode
  npm run strum-events -- -c tablet-config.json --live

  # Use mock data for testing
  npm run strum-events -- -c tablet-config.json --mock
`
    );

  program.parse();

  const options = program.opts<{
    config?: string;
    strummerConfig?: string;
    live?: boolean;
    mock?: boolean;
  }>();

  // Resolve tablet config path (handles auto-detection from directory)
  const configPath = resolveConfigPath(options.config ?? DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_DIR);

  if (options.strummerConfig) {
    const strummerConfigPath = path.resolve(options.strummerConfig);
    if (!fs.existsSync(strummerConfigPath)) {
      console.error(chalk.red(`Error: Strummer config file not found: ${strummerConfigPath}`));
      process.exit(1);
    }
  }

  let viewer: StrumEventViewer | null = null;
  try {
    viewer = new StrumEventViewer(configPath, {
      mock: options.mock,
      strummerConfigPath: options.strummerConfig ? path.resolve(options.strummerConfig) : undefined,
      liveMode: options.live,
    });

    await viewer.start();
  } catch (e) {
    const error = e as Error;
    console.error(chalk.red('Error: ') + error.message);
    // Show cursor again
    process.stdout.write('\x1b[?25h');
    process.exit(1);
  }
}

// Only run main() when this file is executed directly (not imported)
import { fileURLToPath } from 'url';
import * as nodePath from 'path';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = nodePath.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  main().catch((error) => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { StrumEventViewer, printStrummerInfo, createBar, formatNote, printStrumEvent, printLiveDashboard };