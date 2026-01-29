/**
 * Action handlers for stylus button and other input actions.
 * Provides a centralized way to handle user actions like toggling features.
 *
 * Ported from Python sketchatone/strummer/actions.py
 */

import { EventEmitter } from '../utils/event-emitter.js';
import { Note, type NoteObject } from '../models/note.js';
import { CHORD_PROGRESSION_PRESETS } from '../models/strummer-features.js';
import type { Strummer } from './strummer.js';

/**
 * Manages the state of a chord progression.
 * Tracks the current progression name, chords, and index.
 */
export class ChordProgressionState {
  progressionName: string | null = null;
  chords: string[] = [];
  currentIndex = 0;

  /**
   * Load a chord progression by name.
   *
   * @param name - Progression name (e.g., "c-major-pop")
   * @returns True if progression was loaded, False if not found
   */
  loadProgression(name: string): boolean {
    if (name in CHORD_PROGRESSION_PRESETS) {
      this.progressionName = name;
      this.chords = [...CHORD_PROGRESSION_PRESETS[name]];
      this.currentIndex = 0;
      console.log(`[PROGRESSION] Loaded '${name}' with ${this.chords.length} chords`);
      return true;
    } else {
      console.log(`[PROGRESSION] Error: Unknown progression '${name}'`);
      return false;
    }
  }

  /**
   * Set the current index (wraps around).
   *
   * @param index - Index to set
   * @returns Actual index after wrapping
   */
  setIndex(index: number): number {
    if (this.chords.length > 0) {
      this.currentIndex = ((index % this.chords.length) + this.chords.length) % this.chords.length;
    }
    return this.currentIndex;
  }

  /**
   * Increment the current index by amount (wraps around).
   *
   * @param amount - Amount to increment (can be negative)
   * @returns New index after incrementing
   */
  incrementIndex(amount = 1): number {
    if (this.chords.length > 0) {
      this.currentIndex = ((this.currentIndex + amount) % this.chords.length + this.chords.length) % this.chords.length;
    }
    return this.currentIndex;
  }

  /**
   * Get the current chord in the progression.
   *
   * @returns Current chord notation, or null if no progression loaded
   */
  getCurrentChord(): string | null {
    if (this.chords.length > 0 && this.currentIndex >= 0 && this.currentIndex < this.chords.length) {
      return this.chords[this.currentIndex];
    }
    return null;
  }
}

/**
 * Action definition type - can be a string or array
 */
export type ActionDefinition = string | [string, ...unknown[]] | null;

/**
 * Context data passed to action handlers
 */
export interface ActionContext {
  button?: string;
  [key: string]: unknown;
}

/**
 * Action handler function type
 */
export type ActionHandler = (params: unknown[], context: ActionContext) => void;

/**
 * Config interface for Actions class
 */
export interface ActionsConfig {
  noteRepeater?: {
    active: boolean;
    pressureMultiplier: number;
    frequencyMultiplier: number;
  };
  transpose?: {
    active: boolean;
    semitones: number;
  };
  lowerSpread?: number;
  upperSpread?: number;
  get?: (key: string, defaultValue?: unknown) => unknown;
  set?: (key: string, value: unknown) => void;
}

/**
 * Handles various user actions that can be triggered by stylus buttons or other inputs.
 *
 * Actions are executed through the execute() method by passing an action definition.
 * Actions can be specified as:
 * - A string: "toggle-repeater"
 * - An array: ["transpose", 12] where first item is action name, rest are parameters
 * - Nested arrays: ["set-strum-notes", ["C4", "E4", "G4"]] for complex parameters
 * - Chord notation: ["set-strum-chord", "Cmaj7", 3] for chord-based note setting
 *
 * Events emitted:
 *   - 'config_changed': When an action modifies the configuration
 */
export class Actions extends EventEmitter {
  private config: ActionsConfig;
  private strummer: Strummer | null;
  private actionHandlers: Map<string, ActionHandler>;
  progressionState: ChordProgressionState;

  /**
   * Initialize Actions with a configuration instance.
   *
   * @param config - Configuration instance that will be modified by actions
   * @param strummer - Optional Strummer instance for setting notes
   */
  constructor(config: ActionsConfig, strummer: Strummer | null = null) {
    super();
    this.config = config;
    this.strummer = strummer;

    // Map action names to handler methods
    this.actionHandlers = new Map<string, ActionHandler>([
      ['toggle-repeater', this.toggleRepeater.bind(this)],
      ['toggle-transpose', this.toggleTranspose.bind(this)],
      ['transpose', this.transpose.bind(this)],
      ['set-strum-notes', this.setStrumNotes.bind(this)],
      ['set-strum-chord', this.setStrumChord.bind(this)],
      ['set-chord-in-progression', this.setChordInProgression.bind(this)],
      ['increment-chord-in-progression', this.incrementChordInProgression.bind(this)],
    ]);

    // Chord progression state
    this.progressionState = new ChordProgressionState();
  }

  /**
   * Execute an action by definition.
   *
   * @param actionDef - Action definition - can be:
   *                   - String: "toggle-repeater"
   *                   - Array: ["transpose", 12] (action name + parameters)
   *                   - Nested array: ["set-strum-notes", ["C4", "E4", "G4"]]
   *                   - null/empty: no action
   * @param context - Optional context data for the action (e.g., which button triggered it)
   * @returns True if action was executed successfully, False if action not found or invalid
   */
  execute(actionDef: ActionDefinition, context: ActionContext = {}): boolean {
    if (actionDef === null || actionDef === 'none' || actionDef === '') {
      return false;
    }

    // Parse action definition
    let actionName: string;
    let params: unknown[];

    if (typeof actionDef === 'string') {
      actionName = actionDef;
      params = [];
    } else if (Array.isArray(actionDef) && actionDef.length > 0) {
      actionName = actionDef[0] as string;
      params = actionDef.slice(1);
    } else {
      console.log(`[ACTIONS] Warning: Invalid action definition: ${JSON.stringify(actionDef)}`);
      return false;
    }

    // Execute the action
    const handler = this.actionHandlers.get(actionName);
    if (handler) {
      handler(params, context);
      return true;
    } else {
      console.log(`[ACTIONS] Warning: Unknown action '${actionName}'`);
      return false;
    }
  }

  /**
   * Toggle the note repeater feature on/off.
   */
  toggleRepeater(params: unknown[], context: ActionContext): void {
    // Get current state from config
    let currentActive = false;
    if (this.config.noteRepeater) {
      currentActive = this.config.noteRepeater.active;
    } else if (this.config.get) {
      const noteRepeaterCfg = this.config.get('noteRepeater', {}) as Record<string, unknown>;
      currentActive = (noteRepeaterCfg?.active as boolean) ?? false;
    }

    const newState = !currentActive;

    // Update config
    if (this.config.noteRepeater) {
      this.config.noteRepeater.active = newState;
    } else if (this.config.set) {
      this.config.set('noteRepeater.active', newState);
    }

    // Log which button triggered the action if available
    const button = context.button ?? 'Unknown';
    console.log(`[ACTIONS] ${button} button toggled repeater: ${newState ? 'ON' : 'OFF'}`);

    // Emit config changed event
    this.emit('config_changed');
  }

  /**
   * Toggle transpose on/off using the configured semitones value.
   * Unlike the 'transpose' action which requires a semitones parameter,
   * this action uses the semitones value already configured in transpose.semitones.
   */
  toggleTranspose(params: unknown[], context: ActionContext): void {
    // Get current state from config
    let currentActive = false;
    let configuredSemitones = 12; // Default

    if (this.config.transpose) {
      currentActive = this.config.transpose.active;
      configuredSemitones = this.config.transpose.semitones;
    } else if (this.config.get) {
      const transposeCfg = this.config.get('transpose', {}) as Record<string, unknown>;
      currentActive = (transposeCfg?.active as boolean) ?? false;
      configuredSemitones = (transposeCfg?.semitones as number) ?? 12;
    }

    const newState = !currentActive;

    // Update config - keep the semitones value, just toggle active
    if (this.config.transpose) {
      this.config.transpose.active = newState;
    } else if (this.config.set) {
      this.config.set('transpose.active', newState);
    }

    // Log which button triggered the action if available
    const button = context.button ?? 'Unknown';
    if (newState) {
      console.log(`[ACTIONS] ${button} button enabled transpose: ${configuredSemitones > 0 ? '+' : ''}${configuredSemitones} semitones`);
    } else {
      console.log(`[ACTIONS] ${button} button disabled transpose`);
    }

    // Emit config changed event
    this.emit('config_changed');
  }

  /**
   * Toggle transpose on/off with specified semitones.
   */
  transpose(params: unknown[], context: ActionContext): void {
    if (params.length === 0 || typeof params[0] !== 'number') {
      console.log('[ACTIONS] Error: transpose action requires semitones parameter');
      return;
    }

    const semitones = Math.floor(params[0] as number);
    const button = context.button ?? 'Unknown';

    // Get current transpose state
    let currentActive = false;
    let currentSemitones = 0;

    if (this.config.transpose) {
      currentActive = this.config.transpose.active;
      currentSemitones = this.config.transpose.semitones;
    } else if (this.config.get) {
      const transposeCfg = this.config.get('transpose', {}) as Record<string, unknown>;
      currentActive = (transposeCfg?.active as boolean) ?? false;
      currentSemitones = (transposeCfg?.semitones as number) ?? 0;
    }

    // Toggle: if currently active with same semitones, turn off; otherwise turn on with new semitones
    if (currentActive && currentSemitones === semitones) {
      // Turn off
      if (this.config.transpose) {
        this.config.transpose.active = false;
        this.config.transpose.semitones = 0;
      } else if (this.config.set) {
        this.config.set('transpose.active', false);
        this.config.set('transpose.semitones', 0);
      }
      console.log(`[ACTIONS] ${button} button disabled transpose`);
    } else {
      // Turn on with specified semitones
      if (this.config.transpose) {
        this.config.transpose.active = true;
        this.config.transpose.semitones = semitones;
      } else if (this.config.set) {
        this.config.set('transpose.active', true);
        this.config.set('transpose.semitones', semitones);
      }
      console.log(`[ACTIONS] ${button} button enabled transpose: ${semitones > 0 ? '+' : ''}${semitones} semitones`);
    }

    // Emit config changed event
    this.emit('config_changed');
  }

  /**
   * Get the current transpose semitones.
   *
   * @returns Current transpose semitones (0 if transpose is not active)
   */
  getTransposeSemitones(): number {
    if (this.config.transpose) {
      return this.config.transpose.active ? this.config.transpose.semitones : 0;
    }
    if (this.config.get) {
      const transposeCfg = this.config.get('transpose', {}) as Record<string, unknown>;
      if (transposeCfg?.active) {
        return (transposeCfg.semitones as number) ?? 0;
      }
    }
    return 0;
  }

  /**
   * Check if transpose is currently active.
   */
  isTransposeActive(): boolean {
    if (this.config.transpose) {
      return this.config.transpose.active;
    }
    if (this.config.get) {
      const transposeCfg = this.config.get('transpose', {}) as Record<string, unknown>;
      return (transposeCfg?.active as boolean) ?? false;
    }
    return false;
  }

  /**
   * Check if note repeater is currently active.
   */
  isRepeaterActive(): boolean {
    if (this.config.noteRepeater) {
      return this.config.noteRepeater.active;
    }
    if (this.config.get) {
      const noteRepeaterCfg = this.config.get('noteRepeater', {}) as Record<string, unknown>;
      return (noteRepeaterCfg?.active as boolean) ?? false;
    }
    return false;
  }

  /**
   * Get the note repeater configuration.
   */
  getRepeaterConfig(): { active: boolean; pressureMultiplier: number; frequencyMultiplier: number } {
    if (this.config.noteRepeater) {
      return {
        active: this.config.noteRepeater.active,
        pressureMultiplier: this.config.noteRepeater.pressureMultiplier,
        frequencyMultiplier: this.config.noteRepeater.frequencyMultiplier,
      };
    }
    if (this.config.get) {
      const noteRepeaterCfg = this.config.get('noteRepeater', {}) as Record<string, unknown>;
      return {
        active: (noteRepeaterCfg?.active as boolean) ?? false,
        pressureMultiplier: (noteRepeaterCfg?.pressureMultiplier as number) ?? 1.0,
        frequencyMultiplier: (noteRepeaterCfg?.frequencyMultiplier as number) ?? 1.0,
      };
    }
    return { active: false, pressureMultiplier: 1.0, frequencyMultiplier: 1.0 };
  }

  /**
   * Set the strumming notes to a specific set of notes.
   */
  setStrumNotes(params: unknown[], context: ActionContext): void {
    if (params.length === 0 || !Array.isArray(params[0])) {
      console.log('[ACTIONS] Error: set-strum-notes action requires an array of note strings');
      return;
    }

    const noteStrings = params[0] as string[];

    // Validate that all items are strings
    if (!noteStrings.every((n) => typeof n === 'string')) {
      console.log('[ACTIONS] Error: set-strum-notes requires all notes to be strings');
      return;
    }

    if (noteStrings.length === 0) {
      console.log('[ACTIONS] Error: set-strum-notes requires at least one note');
      return;
    }

    if (!this.strummer) {
      console.log('[ACTIONS] Error: No strummer instance available');
      return;
    }

    try {
      // Parse note strings into Note objects
      const notes = noteStrings.map((n) => Note.parseNotation(n));

      // Get note spread configuration
      const lowerSpread = this.config.lowerSpread ?? 0;
      const upperSpread = this.config.upperSpread ?? 0;

      // Apply note spread and set strummer notes
      this.strummer.notes = Note.fillNoteSpread(notes, lowerSpread, upperSpread);

      // Log the action
      const button = context.button ?? 'Unknown';
      const noteNames = noteStrings.join(', ');
      console.log(`[ACTIONS] ${button} button set strum notes: [${noteNames}]`);

      // Note: broadcast happens automatically via strummer's notes_changed event
    } catch (e) {
      console.log(`[ACTIONS] Error parsing notes: ${e}`);
    }
  }

  /**
   * Set the strumming notes using chord notation.
   */
  setStrumChord(params: unknown[], context: ActionContext): void {
    if (params.length === 0 || typeof params[0] !== 'string') {
      console.log('[ACTIONS] Error: set-strum-chord action requires chord notation string');
      return;
    }

    const chordNotation = params[0] as string;
    let octave = 4; // Default octave

    // Check for optional octave parameter
    if (params.length > 1 && typeof params[1] === 'number') {
      octave = Math.floor(params[1]);
    }

    if (!this.strummer) {
      console.log('[ACTIONS] Error: No strummer instance available');
      return;
    }

    try {
      // Parse chord into notes
      const notes = Note.parseChord(chordNotation, octave);

      if (!notes || notes.length === 0) {
        console.log(`[ACTIONS] Error: Failed to parse chord '${chordNotation}'`);
        return;
      }

      // Get note spread configuration
      const lowerSpread = this.config.lowerSpread ?? 0;
      const upperSpread = this.config.upperSpread ?? 0;

      // Apply note spread and set strummer notes
      this.strummer.notes = Note.fillNoteSpread(notes, lowerSpread, upperSpread);

      // Log the action
      const button = context.button ?? 'Unknown';
      const noteNames = notes.map((n) => `${n.notation}${n.octave}`).join(', ');
      console.log(`[ACTIONS] ${button} button set strum chord: ${chordNotation} [${noteNames}]`);

      // Note: broadcast happens automatically via strummer's notes_changed event
    } catch (e) {
      console.log(`[ACTIONS] Error parsing chord: ${e}`);
    }
  }

  /**
   * Set the chord progression to a specific index and apply that chord.
   */
  setChordInProgression(params: unknown[], context: ActionContext): void {
    if (params.length < 2) {
      console.log('[ACTIONS] Error: set-chord-in-progression requires progression name and index');
      return;
    }

    if (typeof params[0] !== 'string') {
      console.log('[ACTIONS] Error: First parameter must be progression name (string)');
      return;
    }

    if (typeof params[1] !== 'number') {
      console.log('[ACTIONS] Error: Second parameter must be index (integer)');
      return;
    }

    const progressionName = params[0] as string;
    const index = Math.floor(params[1] as number);
    let octave = 4; // Default octave

    // Check for optional octave parameter
    if (params.length > 2 && typeof params[2] === 'number') {
      octave = Math.floor(params[2]);
    }

    if (!this.strummer) {
      console.log('[ACTIONS] Error: No strummer instance available');
      return;
    }

    // Load progression if different from current
    if (this.progressionState.progressionName !== progressionName) {
      if (!this.progressionState.loadProgression(progressionName)) {
        return;
      }
    }

    // Set the index
    const actualIndex = this.progressionState.setIndex(index);
    const chordNotation = this.progressionState.getCurrentChord();

    if (!chordNotation) {
      console.log('[ACTIONS] Error: Could not get chord from progression');
      return;
    }

    try {
      // Parse chord into notes
      const notes = Note.parseChord(chordNotation, octave);

      if (!notes || notes.length === 0) {
        console.log(`[ACTIONS] Error: Failed to parse chord '${chordNotation}'`);
        return;
      }

      // Get note spread configuration
      const lowerSpread = this.config.lowerSpread ?? 0;
      const upperSpread = this.config.upperSpread ?? 0;

      // Apply note spread and set strummer notes
      this.strummer.notes = Note.fillNoteSpread(notes, lowerSpread, upperSpread);

      // Log the action
      const button = context.button ?? 'Unknown';
      console.log(`[ACTIONS] ${button} button set progression '${progressionName}' to index ${actualIndex}: ${chordNotation}`);

      // Note: broadcast happens automatically via strummer's notes_changed event
    } catch (e) {
      console.log(`[ACTIONS] Error setting chord in progression: ${e}`);
    }
  }

  /**
   * Increment the current chord progression index and apply that chord.
   */
  incrementChordInProgression(params: unknown[], context: ActionContext): void {
    if (params.length < 1) {
      console.log('[ACTIONS] Error: increment-chord-in-progression requires progression name');
      return;
    }

    if (typeof params[0] !== 'string') {
      console.log('[ACTIONS] Error: First parameter must be progression name (string)');
      return;
    }

    const progressionName = params[0] as string;
    let incrementAmount = 1; // Default increment
    let octave = 4; // Default octave

    // Check for optional increment amount parameter
    if (params.length > 1 && typeof params[1] === 'number') {
      incrementAmount = Math.floor(params[1]);
    }

    // Check for optional octave parameter
    if (params.length > 2 && typeof params[2] === 'number') {
      octave = Math.floor(params[2]);
    }

    if (!this.strummer) {
      console.log('[ACTIONS] Error: No strummer instance available');
      return;
    }

    // Load progression if different from current
    if (this.progressionState.progressionName !== progressionName) {
      if (!this.progressionState.loadProgression(progressionName)) {
        return;
      }
    }

    // Increment the index
    const actualIndex = this.progressionState.incrementIndex(incrementAmount);
    const chordNotation = this.progressionState.getCurrentChord();

    if (!chordNotation) {
      console.log('[ACTIONS] Error: Could not get chord from progression');
      return;
    }

    try {
      // Parse chord into notes
      const notes = Note.parseChord(chordNotation, octave);

      if (!notes || notes.length === 0) {
        console.log(`[ACTIONS] Error: Failed to parse chord '${chordNotation}'`);
        return;
      }

      // Get note spread configuration
      const lowerSpread = this.config.lowerSpread ?? 0;
      const upperSpread = this.config.upperSpread ?? 0;

      // Apply note spread and set strummer notes
      this.strummer.notes = Note.fillNoteSpread(notes, lowerSpread, upperSpread);

      // Log the action
      const button = context.button ?? 'Unknown';
      const direction = incrementAmount > 0 ? 'forward' : 'backward';
      console.log(`[ACTIONS] ${button} button incremented progression '${progressionName}' ${direction} by ${Math.abs(incrementAmount)} to index ${actualIndex}: ${chordNotation}`);

      // Note: broadcast happens automatically via strummer's notes_changed event
    } catch (e) {
      console.log(`[ACTIONS] Error incrementing chord in progression: ${e}`);
    }
  }

  /**
   * Register a custom action handler.
   *
   * @param actionName - Name of the action
   * @param handlerFunc - Function to call when action is executed
   */
  registerAction(actionName: string, handlerFunc: ActionHandler): void {
    this.actionHandlers.set(actionName, handlerFunc);
    console.log(`[ACTIONS] Registered custom action: ${actionName}`);
  }

  /**
   * Get list of all available action names.
   *
   * @returns List of action names that can be executed
   */
  getAvailableActions(): string[] {
    return Array.from(this.actionHandlers.keys());
  }
}
