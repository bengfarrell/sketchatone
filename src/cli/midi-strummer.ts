#!/usr/bin/env node
/**
 * MIDI Strummer CLI
 *
 * A CLI tool that reads tablet events via HID and outputs MIDI notes.
 * Combines the Strummer with MIDI backends (rtmidi).
 *
 * Usage:
 *   npm run midi-strummer
 *   npm run midi-strummer -- --tablet-config ./configs/
 *   npm run midi-strummer -- --tablet-config tablet.json
 *   npm run midi-strummer -- --tablet-config tablet.json --strummer-config strummer.json
 *   npm run midi-strummer -- --tablet-config tablet.json --channel 1
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
import { MidiStrummerConfig } from '../models/midi-strummer-config.js';
import { Note, type NoteObject } from '../models/note.js';
import { RtMidiBackend } from '../midi/rtmidi-backend.js';
import { MidiStrummerBridge } from '../midi/bridge.js';
import type { MidiBackendProtocol } from '../midi/protocol.js';
import { strummerEventBus, type TabletEventData, type StrumEventData, type StrumNoteEventData } from '../utils/strummer-event-bus.js';

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
 * Strip ANSI codes from text
 */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Pad line content accounting for ANSI codes
 */
function padLine(content: string, targetLen: number): string {
  const visibleLen = stripAnsi(content).length;
  const padding = Math.max(0, targetLen - visibleLen);
  return content + ' '.repeat(padding);
}

/**
 * MIDI Strummer that reads tablet input and outputs MIDI notes.
 */
class MidiStrummer extends TabletReaderBase {
  private liveMode: boolean;
  private lastEvent: StrummerEvent | null = null;
  private lastLiveUpdate = 0;
  private notesPlayed = 0;
  private config: MidiStrummerConfig;
  private strummer: Strummer;
  private backend: MidiBackendProtocol | null = null;
  private bridge: MidiStrummerBridge | null = null;

  constructor(
    tabletConfigPath: string,
    options: TabletReaderOptions & {
      strummerConfigPath?: string;
      liveMode?: boolean;
      // CLI overrides
      midiChannel?: number;
      midiPort?: string | number;
      noteDuration?: number;
    } = {}
  ) {
    super(tabletConfigPath, options);
    this.liveMode = options.liveMode ?? false;

    // Load combined config from file or use defaults
    if (options.strummerConfigPath) {
      this.config = MidiStrummerConfig.fromJsonFile(options.strummerConfigPath);
    } else {
      this.config = new MidiStrummerConfig();
    }

    // Apply CLI overrides
    if (options.midiChannel !== undefined) {
      this.config.midi.channel = options.midiChannel;
    }
    if (options.midiPort !== undefined) {
      this.config.midi.outputPort = options.midiPort;
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

  private printConfigInfo(): void {
    console.log(chalk.cyan('─'.repeat(50)));
    console.log(chalk.white.bold('Strummer Config:'));
    console.log(chalk.cyan('  Pressure Threshold: ') + chalk.white(this.config.pressureThreshold.toString()));
    console.log(chalk.cyan('  Notes: ') + chalk.white(this.config.notes.join(', ')));
    if (this.config.chord) {
      console.log(chalk.cyan('  Chord: ') + chalk.white(this.config.chord));
    }
    console.log();
    console.log(chalk.white.bold('MIDI Config:'));
    console.log(chalk.cyan('  Channel: ') + chalk.white(this.config.channel.toString()));
    if (this.config.outputPort !== null) {
      console.log(chalk.cyan('  Output Port: ') + chalk.white(String(this.config.outputPort)));
    }
    console.log(chalk.cyan('  Note Duration: ') + chalk.white(`${this.config.noteDuration.default}s`));
    console.log(chalk.cyan('─'.repeat(50)));
    console.log();
  }

  protected handlePacket(data: Uint8Array): void {
    try {
      this.packetCount++;

      // Process the data using the config
      const events = this.processPacket(data);

      // Extract normalized values
      const normalized = normalizeTabletEvent(events);
      const { x, y, pressure, state, tiltX, tiltY, tiltXY, primaryButtonPressed, secondaryButtonPressed } = normalized;

      // Emit tablet event to global event bus (throttled)
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
      strummerEventBus.emitTabletEvent(tabletEventData);

      // Update strummer bounds
      this.strummer.updateBounds(1.0, 1.0);

      // Process strum
      const event = this.strummer.strum(x, pressure);

      if (event) {
        this.lastEvent = event;

        if (event.type === 'strum') {
          // Send MIDI notes
          for (const noteData of event.notes) {
            if (this.backend) {
              this.backend.sendNote(
                noteData.note,
                noteData.velocity,
                this.config.noteDuration.default
              );
              this.notesPlayed++;
            }
          }

          // Emit strum event to global event bus (throttled)
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
          strummerEventBus.emitStrumEvent(strumEventData);

          if (!this.liveMode) {
            this.printStrumEvent(event, x, y, pressure);
          }
        } else if (event.type === 'release') {
          // Emit release event to global event bus (throttled)
          const releaseEventData: StrumEventData = {
            type: 'release',
            notes: [],
            velocity: event.velocity,
            timestamp: Date.now(),
          };
          strummerEventBus.emitStrumEvent(releaseEventData);

          if (!this.liveMode) {
            this.printReleaseEvent(event, x, y, pressure);
          }
        }
      }

      // Update live display
      if (this.liveMode) {
        const now = Date.now() / 1000;
        if (now - this.lastLiveUpdate >= 0.05) {
          // 20 FPS
          this.lastLiveUpdate = now;
          this.printLiveDashboard(x, y, pressure, state);
        }
      }
    } catch (e) {
      if (!this.liveMode) {
        console.error(chalk.red(`Error processing packet: ${e}`));
      }
    }
  }

  private printStrumEvent(event: StrummerEvent, x: number, y: number, pressure: number): void {
    if (event.type !== 'strum') return;

    const noteStrs: string[] = [];
    for (const n of event.notes) {
      noteStrs.push(`${n.note.notation}${n.note.octave}(v${n.velocity})`);
    }

    const coords = chalk.gray(`X: ${x.toFixed(4)} Y: ${y.toFixed(4)} P: ${pressure.toFixed(4)}`);
    console.log(
      chalk.green.bold('♪ STRUM ') +
        chalk.white(noteStrs.join(' ')) +
        chalk.cyan(' → MIDI ') +
        coords
    );
  }

  private printReleaseEvent(event: StrummerEvent, x: number, y: number, pressure: number): void {
    if (event.type !== 'release') return;
    const coords = chalk.gray(`X: ${x.toFixed(4)} Y: ${y.toFixed(4)} P: ${pressure.toFixed(4)}`);
    console.log(chalk.yellow('↑ RELEASE ') + chalk.gray(`(velocity: ${event.velocity}) `) + coords);
  }

  private printLiveDashboard(x: number, y: number, pressure: number, state: string): void {
    const HIDE_CURSOR = '\x1b[?25l';
    const MOVE_HOME = '\x1b[H';
    const CLEAR_LINE = '\x1b[2K';

    const lines: string[] = [];
    const border = chalk.cyan.bold('│');
    const boxWidth = 63;

    // Header
    lines.push(chalk.cyan.bold('┌' + '─'.repeat(boxWidth) + '┐'));
    lines.push(
      border +
        chalk.white.bold('                        MIDI STRUMMER                           ') +
        border
    );
    lines.push(chalk.cyan.bold('├' + '─'.repeat(boxWidth) + '┤'));

    // Status line
    const status = `Backend: rtmidi  Notes played: ${this.notesPlayed}`;
    const stateColor =
      state === 'contact' ? chalk.green.bold : state === 'hover' ? chalk.yellow : chalk.gray;
    const stateStr = stateColor(state);
    lines.push(border + ' ' + padLine(`${status}  State: ${stateStr}`, boxWidth - 1) + border);

    // Pressure bar
    const pPct = `${(pressure * 100).toFixed(0)}%`.padStart(4);
    const pressureBar = createBar(pressure, 1.0, 20);
    const isPressed = pressure >= this.strummer.pressureThreshold;
    const pressureLabel = isPressed ? chalk.green.bold('PRESSED') : '       ';
    lines.push(
      border + ' ' + padLine(`Pressure: ${pPct} ${pressureBar} ${pressureLabel}`, boxWidth - 1) + border
    );

    lines.push(chalk.cyan.bold('├' + '─'.repeat(boxWidth) + '┤'));

    // String visualization
    const numStrings = this.strummer.notes.length;
    if (numStrings > 0) {
      const stringWidth = 1.0 / numStrings;
      const currentString =
        stringWidth > 0 ? Math.min(Math.floor(x / stringWidth), numStrings - 1) : 0;
      const stringSpacing = Math.floor((boxWidth - 4) / numStrings);
      const totalWidth = stringSpacing * numStrings;
      const leftPad = Math.floor((boxWidth - totalWidth) / 2);

      // String rows
      for (let row = 0; row < 5; row++) {
        let rowContent = ' '.repeat(leftPad);
        for (let i = 0; i < numStrings; i++) {
          const isCurrent = i === currentString;
          const isStrummed = isCurrent && isPressed;

          let char: string;
          if (isStrummed) {
            char = row === 2 ? chalk.green.bold('╋') : chalk.green.bold('║');
          } else if (isCurrent) {
            char = chalk.yellow('┃');
          } else {
            char = chalk.gray('│');
          }

          const colPad = Math.floor((stringSpacing - 1) / 2);
          rowContent += ' '.repeat(colPad) + char + ' '.repeat(stringSpacing - colPad - 1);
        }
        lines.push(border + padLine(rowContent, boxWidth - 1) + border);
      }

      // Note labels
      let noteRow = ' '.repeat(leftPad);
      for (let i = 0; i < numStrings; i++) {
        const note = this.strummer.notes[i];
        const label = `${note.notation}${note.octave}`;
        const isCurrent = i === currentString;

        let coloredLabel: string;
        if (isCurrent && isPressed) {
          coloredLabel = chalk.green.bold(label);
        } else if (isCurrent) {
          coloredLabel = chalk.yellow(label);
        } else {
          coloredLabel = chalk.gray(label);
        }

        const colPad = Math.floor((stringSpacing - label.length) / 2);
        noteRow += ' '.repeat(colPad) + coloredLabel + ' '.repeat(stringSpacing - colPad - label.length);
      }
      lines.push(border + padLine(noteRow, boxWidth - 1) + border);
    }

    // Last event
    lines.push(chalk.cyan.bold('├' + '─'.repeat(boxWidth) + '┤'));
    if (this.lastEvent) {
      if (this.lastEvent.type === 'strum') {
        const noteNames = this.lastEvent.notes.map(
          (n: StrumNoteData) => `${n.note.notation}${n.note.octave}`
        );
        const eventLine = `${chalk.green.bold('♪ MIDI')} ${noteNames.join(' ')}`;
        lines.push(border + ' ' + padLine(eventLine, boxWidth - 1) + border);
      } else if (this.lastEvent.type === 'release') {
        lines.push(border + ' ' + padLine(chalk.yellow('↑ RELEASE'), boxWidth - 1) + border);
      }
    } else {
      lines.push(border + ' ' + padLine(chalk.gray('Waiting for strum...'), boxWidth - 1) + border);
    }

    lines.push(chalk.cyan.bold('└' + '─'.repeat(boxWidth) + '┘'));
    lines.push(chalk.gray('Press Ctrl+C to stop'));

    const content = lines.map((line) => `${CLEAR_LINE}${line}`).join('\n') + '\n';
    process.stdout.write(HIDE_CURSOR + MOVE_HOME + content);
  }

  async start(): Promise<void> {
    this.printHeader('MIDI Strummer');
    this.printConfigInfo();

    // Initialize MIDI
    console.log(chalk.gray('Initializing MIDI...'));
    if (!(await this.setupMidi())) {
      process.exit(1);
    }
    console.log(chalk.green('✓ MIDI initialized'));

    // Initialize tablet reader
    console.log(chalk.gray('Initializing tablet reader...'));
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

    if (this.liveMode) {
      // Clear screen for live mode
      process.stdout.write('\x1b[2J\x1b[H');
    }

    // Set up shutdown handlers
    this.setupShutdownHandlers();
  }

  async stop(): Promise<void> {
    // Clean up MIDI
    if (this.bridge) {
      this.bridge.releaseAll();
      this.bridge.disconnect();
    }
    if (this.backend) {
      this.backend.disconnect();
    }

    // Clean up event bus
    strummerEventBus.cleanup();

    await super.stop();
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('midi-strummer')
    .description('MIDI Strummer - tablet input to MIDI output')
    .option('-t, --tablet-config <path>', 'Path to tablet config JSON file or directory (auto-detects from ./public/configs if not provided)')
    .option('-s, --strummer-config <path>', 'Path to strummer/MIDI config JSON file')
    .option('--channel <number>', 'MIDI channel (0-15, overrides config)', parseInt)
    .option('-p, --port <port>', 'MIDI output port name or index (overrides config)')
    .option('-d, --duration <seconds>', 'Note duration in seconds (overrides config)', parseFloat)
    .option('-l, --live', 'Live dashboard mode (updates in place)')
    .option('-m, --mock', 'Use mock data instead of real device')
    .addHelpText(
      'after',
      `
Examples:
  # Auto-detect tablet from default config directory
  npm run midi-strummer

  # Auto-detect tablet from specific directory
  npm run midi-strummer -- -t ./configs/

  # Basic usage with specific config file
  npm run midi-strummer -- -t tablet.json

  # With combined strummer+MIDI config file
  npm run midi-strummer -- -t tablet.json -s strummer.json

  # Override MIDI channel
  npm run midi-strummer -- -t tablet.json --channel 1

  # Specify MIDI port by index
  npm run midi-strummer -- -t tablet.json -p 2

  # Specify MIDI port by name
  npm run midi-strummer -- -t tablet.json -p "IAC Driver"

  # Live dashboard mode with mock data
  npm run midi-strummer -- -t tablet.json --mock --live
`
    );

  program.parse();

  const options = program.opts<{
    tabletConfig?: string;
    strummerConfig?: string;
    channel?: number;
    port?: string;
    duration?: number;
    live?: boolean;
    mock?: boolean;
  }>();

  // Resolve tablet config path (handles auto-detection from directory)
  const tabletConfigPath = resolveConfigPath(options.tabletConfig ?? DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_DIR);

  if (options.strummerConfig) {
    const strummerConfigPath = path.resolve(options.strummerConfig);
    if (!fs.existsSync(strummerConfigPath)) {
      console.error(chalk.red(`Error: Strummer config file not found: ${strummerConfigPath}`));
      process.exit(1);
    }
  }

  // Parse port - could be number or string
  let midiPort: string | number | undefined;
  if (options.port !== undefined) {
    const portNum = parseInt(options.port, 10);
    midiPort = isNaN(portNum) ? options.port : portNum;
  }

  let strummer: MidiStrummer | null = null;
  try {
    strummer = new MidiStrummer(tabletConfigPath, {
      mock: options.mock,
      strummerConfigPath: options.strummerConfig ? path.resolve(options.strummerConfig) : undefined,
      liveMode: options.live,
      midiChannel: options.channel,
      midiPort,
      noteDuration: options.duration,
    });

    await strummer.start();
  } catch (e) {
    const error = e as Error;
    console.error(chalk.red('Error: ') + error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    // Show cursor again
    process.stdout.write('\x1b[?25h');
    process.exit(1);
  }
}

// Only run main() when this file is executed directly (not imported)
import { fileURLToPath } from 'url';
import * as nodePath from 'path';
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && nodePath.resolve(process.argv[1]) === __filename;

// Also check if we're being run as a bin script (npm run, etc.)
const isBinScript = process.argv[1]?.endsWith('midi-strummer') ||
                    process.argv[1]?.endsWith('midi-strummer.js');

if (isMainModule || isBinScript) {
  main().catch((error) => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { MidiStrummer };