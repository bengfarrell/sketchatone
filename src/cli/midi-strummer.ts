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

// Vendored tablet client (composition-based OTD wrapper)
import { TabletClient, waitForDevice } from '../tablet/tabletClient.js';
import type { TabletEvent } from '../tablet/server/eventAdapter.js';
import { Strummer, type StrummerEvent, type StrumNoteData } from '../core/strummer.js';
import { Actions } from '../core/actions.js';
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
class MidiStrummer {
  private tabletClient: TabletClient | null = null;
  private devicePollInterval: number | null;
  private liveMode: boolean;
  private lastEvent: StrummerEvent | null = null;
  private lastLiveUpdate = 0;
  private notesPlayed = 0;
  private config: MidiStrummerConfig;
  private strummer: Strummer;
  private backend: MidiBackendProtocol | null = null;
  private bridge: MidiStrummerBridge | null = null;
  private actions: Actions;
  private shutdownHandlersInstalled = false;

  // State tracking for stylus buttons
  private buttonState = {
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
  };

  // State tracking for auxiliary hardware buttons - previous HID scan codes
  private prevAuxCodes: Set<number> = new Set();

  // State tracking for note repeater
  private repeaterState = {
    notes: [] as StrumNoteData[],
    lastRepeatTime: 0,
    isHolding: false,
  };

  // State tracking for pitch bend throttling
  private lastPitchBendTime: number = 0;
  private lastPitchBendValue: number | null = null;

  constructor(
    options: {
      strummerConfigPath?: string;
      liveMode?: boolean;
      // CLI overrides
      midiChannel?: number;
      midiPort?: string | number;
      noteDuration?: number;
      devicePollInterval?: number | null;
    } = {}
  ) {
    this.liveMode = options.liveMode ?? false;
    this.devicePollInterval = options.devicePollInterval ?? null;

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
    this.strummer.configure(this.config.pressureThreshold, this.config.strumming.pressureBufferSize);

    // Set up notes
    this.setupNotes();

    // Create Actions handler for stylus buttons
    // Pass the actual config object so Actions can access live values
    // (e.g., lowerSpread/upperSpread that may be updated via UI)
    this.actions = new Actions(this.config, this.strummer, this.config.strummer.chordProgressions);

    // Configure action rules so button-to-action mapping works
    this.actions.setActionRulesConfig(this.config.strummer.actionRules);

    // Execute any startup rules defined in the config
    this.actions.executeStartupRules();
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
    // Display channel as 1-16 for users (internally stored as 0-15), or 'omni' if undefined
    const channelDisplay = this.config.channel !== undefined && this.config.channel !== null ? (this.config.channel + 1).toString() : '1 (default)';
    console.log(chalk.cyan('  Channel: ') + chalk.white(channelDisplay));
    if (this.config.outputPort !== null) {
      console.log(chalk.cyan('  Output Port: ') + chalk.white(String(this.config.outputPort)));
    }
    console.log(chalk.cyan('  Note Duration: ') + chalk.white(`${this.config.noteDuration.default}s`));
    console.log(chalk.cyan('─'.repeat(50)));
    console.log();
  }

  /**
   * Handle a tablet event from the TabletClient. Diffs stylus + aux buttons,
   * emits actions, updates the strummer/repeater, and (in live mode) redraws
   * the dashboard.
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
        state,
        timestamp: tabletEvent.timestamp || Date.now(),
        auxCodes: rawAuxCodes.slice(),
      };
      strummerEventBus.emitTabletEvent(tabletEventData);

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
        this.lastEvent = event;

        if (event.type === 'strum') {
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
          // Stop holding - no more repeats
          this.repeaterState.isHolding = false;
          this.repeaterState.notes = [];

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
        console.error(chalk.red(`Error processing tablet event: ${e}`));
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

  private printHeader(title: string): void {
    console.log(chalk.cyan.bold('\n╔' + '═'.repeat(60) + '╗'));
    console.log(chalk.cyan.bold('║') + chalk.white.bold(`  ${title}`.padEnd(60)) + chalk.cyan.bold('║'));
    console.log(chalk.cyan.bold('╚' + '═'.repeat(60) + '╝\n'));
  }

  private setupShutdownHandlers(): void {
    if (this.shutdownHandlersInstalled) return;
    this.shutdownHandlersInstalled = true;
    const shutdown = async (): Promise<void> => {
      await this.stop();
      process.stdout.write('\x1b[?25h');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
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

    // Discover and attach tablet
    console.log(chalk.gray('Discovering tablet...'));
    const pollInterval = this.devicePollInterval;
    const client = pollInterval != null
      ? await waitForDevice({
          intervalMs: pollInterval,
          onWaiting: () => console.log(chalk.yellow('⚠ No tablet detected - waiting...')),
        })
      : await TabletClient.discover();

    if (!client) {
      throw new Error('No tablet device found. Use --poll <ms> to wait for one.');
    }

    this.tabletClient = client;
    await client.start({
      onEvent: (event) => this.onTabletEvent(event),
      onDisconnect: () => {
        console.log(chalk.yellow('\n[Tablet] Device disconnected'));
        this.prevAuxCodes.clear();
      },
    });

    const caps = client.capabilities;
    console.log(chalk.green(`✓ Tablet connected: ${caps.manufacturer} ${caps.model}`));
    console.log(chalk.gray(`  Aux buttons: ${caps.auxButtonCount}, pen buttons: ${caps.penButtonCount}`));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    if (this.liveMode) {
      // Clear screen for live mode
      process.stdout.write('\x1b[2J\x1b[H');
    }

    this.setupShutdownHandlers();
  }

  async stop(): Promise<void> {
    // Stop tablet client
    if (this.tabletClient) {
      try { this.tabletClient.stop(); } catch { /* ignore */ }
      this.tabletClient = null;
    }

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
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('midi-strummer')
    .description('MIDI Strummer - tablet input to MIDI output')
    .option('-s, --strummer-config <path>', 'Path to strummer/MIDI config JSON file')
    .option('--channel <number>', 'MIDI channel (1-16, overrides config)', parseInt)
    .option('-p, --port <port>', 'MIDI output port name or index (overrides config)')
    .option('-d, --duration <seconds>', 'Note duration in seconds (overrides config)', parseFloat)
    .option('-l, --live', 'Live dashboard mode (updates in place)')
    .option('--poll <ms>', 'Poll interval in milliseconds for waiting for device. If not set, quit if no device found.', parseInt)
    .addHelpText(
      'after',
      `
Examples:
  # Auto-detect tablet
  npm run midi-strummer

  # With combined strummer+MIDI config file
  npm run midi-strummer -- -s strummer.json

  # Override MIDI channel
  npm run midi-strummer -- --channel 1

  # Specify MIDI port by index
  npm run midi-strummer -- -p 2

  # Specify MIDI port by name
  npm run midi-strummer -- -p "IAC Driver"

  # Live dashboard mode
  npm run midi-strummer -- --live

  # Wait indefinitely for a device, polling every 2 seconds
  npm run midi-strummer -- --poll 2000
`
    );

  program.parse();

  const options = program.opts<{
    strummerConfig?: string;
    channel?: number;
    port?: string;
    duration?: number;
    live?: boolean;
    poll?: number;
  }>();

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

  // Validate and convert channel from 1-16 to 0-15
  let midiChannel: number | undefined;
  if (options.channel !== undefined) {
    if (options.channel < 1 || options.channel > 16) {
      console.error(chalk.red(`Error: MIDI channel must be between 1 and 16 (got ${options.channel})`));
      process.exit(1);
    }
    midiChannel = options.channel - 1; // Convert 1-16 to 0-15
  }

  try {
    const strummer = new MidiStrummer({
      strummerConfigPath: options.strummerConfig ? path.resolve(options.strummerConfig) : undefined,
      liveMode: options.live,
      midiChannel,
      midiPort,
      noteDuration: options.duration,
      devicePollInterval: options.poll ?? null,
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