/**
 * Action handlers for stylus button and other input actions.
 * Provides a centralized way to handle user actions like toggling features.
 *
 * Ported from Python sketchatone/strummer/actions.py
 */

import { EventEmitter } from '../utils/event-emitter.js';
import { Note, type NoteObject } from '../models/note.js';
import type { Strummer } from './strummer.js';
import type { ActionRulesConfig, ButtonId, TriggerType } from '../models/action-rules.js';

/**
 * Manages the state of a chord progression.
 * Tracks the current progression name, chords, and index.
 */
export class ChordProgressionState {
  progressionName: string | null = null;
  chords: string[] = [];
  currentIndex = 0;
  private availableProgressions: Record<string, string[]>;

  constructor(chordProgressions?: Record<string, string[]>) {
    this.availableProgressions = chordProgressions ?? {};
  }

  /**
   * Update available progressions (e.g., when config changes).
   * If a progression is currently loaded and still exists, reload it to pick up changes.
   */
  updateProgressions(chordProgressions?: Record<string, string[]>): void {
    this.availableProgressions = chordProgressions ?? {};

    // If we have a loaded progression, reload it to pick up any changes
    if (this.progressionName && this.progressionName in this.availableProgressions) {
      const oldIndex = this.currentIndex;
      this.chords = [...this.availableProgressions[this.progressionName]];
      // Preserve index if still valid, otherwise reset to 0
      if (oldIndex < this.chords.length) {
        this.currentIndex = oldIndex;
      } else {
        this.currentIndex = 0;
      }
      console.log(`[PROGRESSION] Reloaded '${this.progressionName}' with ${this.chords.length} chords (index: ${this.currentIndex})`);
    }
  }

  /**
   * Load a chord progression by name.
   *
   * @param name - Progression name (e.g., "c-major-pop")
   * @returns True if progression was loaded, False if not found
   */
  loadProgression(name: string): boolean {
    if (name in this.availableProgressions) {
      this.progressionName = name;
      this.chords = [...this.availableProgressions[name]];
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
  trigger?: string;
  ruleId?: string;
  isStartup?: boolean;
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
/**
 * State for the note repeater feature.
 */
interface RepeaterState {
  active: boolean;
  pressureMultiplier: number;
  frequencyMultiplier: number;
}

/**
 * State for the transpose feature.
 */
interface TransposeState {
  active: boolean;
  semitones: number;
}

export class Actions extends EventEmitter {
  private config: ActionsConfig;
  private strummer: Strummer | null;
  private actionHandlers: Map<string, ActionHandler>;
  progressionState: ChordProgressionState;
  private actionRulesConfig: ActionRulesConfig | null = null;
  private chordProgressions: Record<string, string[]> = {};

  // Internal state for repeater and transpose (managed by actions, not config)
  private repeaterState: RepeaterState = {
    active: false,
    pressureMultiplier: 1.0,
    frequencyMultiplier: 1.0,
  };
  private transposeState: TransposeState = {
    active: false,
    semitones: 0,
  };

  /**
   * Initialize Actions with a configuration instance.
   *
   * @param config - Configuration instance that will be modified by actions
   * @param strummer - Optional Strummer instance for setting notes
   * @param chordProgressions - Optional chord progressions from config
   */
  constructor(config: ActionsConfig, strummer: Strummer | null = null, chordProgressions?: Record<string, string[]>) {
    super();
    this.config = config;
    this.strummer = strummer;
    this.chordProgressions = chordProgressions ?? {};

    // Map action names to handler methods
    this.actionHandlers = new Map<string, ActionHandler>([
      ['toggle-repeater', this.toggleRepeater.bind(this)],
      ['toggle-transpose', this.toggleTranspose.bind(this)],
      ['transpose', this.transpose.bind(this)],
      ['set-strum-notes', this.setStrumNotes.bind(this)],
      ['set-strum-chord', this.setStrumChord.bind(this)],
      ['set-chord-in-progression', this.setChordInProgression.bind(this)],
      ['increment-chord-in-progression', this.incrementChordInProgression.bind(this)],
      ['set-group-progression', this.setGroupProgression.bind(this)],
    ]);

    // Chord progression state
    this.progressionState = new ChordProgressionState(this.chordProgressions);
  }

  /**
   * Set the action rules configuration.
   * This enables button-to-action mapping and group progression features.
   */
  setActionRulesConfig(rulesConfig: ActionRulesConfig): void {
    this.actionRulesConfig = rulesConfig;
  }

  /**
   * Get the current action rules configuration.
   */
  getActionRulesConfig(): ActionRulesConfig | null {
    return this.actionRulesConfig;
  }

  /**
   * Update chord progressions.
   * This allows dynamically updating the available progressions.
   * If a progression is currently loaded, re-applies the current chord to update notes.
   */
  setChordProgressions(chordProgressions: Record<string, string[]>): void {
    this.chordProgressions = chordProgressions;

    // Store the current progression state before update
    const wasLoaded = this.progressionState.progressionName !== null;
    const currentProgression = this.progressionState.progressionName;
    const currentIndex = this.progressionState.currentIndex;

    // Update the progressions (this will reload if currently loaded)
    this.progressionState.updateProgressions(chordProgressions);

    // If a progression was loaded and still exists, re-apply the current chord
    // to update the strummer notes with the new chord definition
    if (wasLoaded && currentProgression && currentProgression in chordProgressions) {
      const chordNotation = this.progressionState.getCurrentChord();
      if (chordNotation && this.strummer) {
        try {
          // Parse chord into notes (using default octave 4)
          const notes = Note.parseChord(chordNotation, 4);

          if (notes && notes.length > 0) {
            // Get note spread configuration
            const lowerSpread = this.config.lowerSpread ?? 0;
            const upperSpread = this.config.upperSpread ?? 0;

            // Apply note spread and set strummer notes
            this.strummer.notes = Note.fillNoteSpread(notes, lowerSpread, upperSpread);

            console.log(`[ACTIONS] Re-applied chord '${chordNotation}' after progression update`);
            // Note: broadcast happens automatically via strummer's notes_changed event
          }
        } catch (e) {
          console.log(`[ACTIONS] Error re-applying chord after progression update: ${e}`);
        }
      }
    }
  }

  /**
   * Execute startup rules from the action rules configuration.
   * Should be called once during initialization.
   */
  executeStartupRules(): void {
    if (!this.actionRulesConfig) {
      console.log('[ACTIONS] No action rules config set, skipping startup rules');
      return;
    }

    const startupRules = this.actionRulesConfig.startupRules;
    if (startupRules.length === 0) {
      console.log('[ACTIONS] No startup rules to execute');
      return;
    }

    console.log(`[ACTIONS] Executing ${startupRules.length} startup rule(s)`);
    for (const rule of startupRules) {
      console.log(`[ACTIONS] Executing startup rule: ${rule.name}`);
      this.execute(rule.action, { button: 'startup', ruleName: rule.name, ruleId: rule.id, isStartup: true });
    }
  }

  /**
   * Handle a button event using the action rules configuration.
   *
   * @param buttonId - The button identifier (e.g., "button:primary", "button:1")
   * @param trigger - The trigger type ('press', 'release', or 'hold')
   * @returns True if an action was executed, false otherwise
   */
  handleButtonEvent(buttonId: ButtonId, trigger: TriggerType): boolean {
    if (!this.actionRulesConfig) {
      console.log('[ACTIONS] No action rules config set, cannot handle button event');
      return false;
    }

    const result = this.actionRulesConfig.getRuleForButtonEvent(buttonId, trigger);
    if (result) {
      return this.execute(result.action, { button: buttonId, trigger, ruleId: result.ruleId });
    }

    return false;
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

      // Emit action_executed event for UI feedback
      this.emit('action_executed', {
        action: actionName,
        params,
        button: context.button,
        trigger: context.trigger,
        timestamp: Date.now(),
        ruleId: context.ruleId,
        isStartup: context.isStartup,
      });

      return true;
    } else {
      console.log(`[ACTIONS] Warning: Unknown action '${actionName}'`);
      return false;
    }
  }

  /**
   * Toggle the note repeater feature on/off.
   *
   * @param params - Optional parameters:
   *   - params[0]: pressureMultiplier (number, default 1.0) - Multiplier for note velocity on repeats
   *   - params[1]: frequencyMultiplier (number, default 1.0) - Multiplier for repeat frequency (higher = faster)
   * @param context - Context data (e.g., which button triggered the action)
   */
  toggleRepeater(params: unknown[], context: ActionContext): void {
    const newState = !this.repeaterState.active;

    // Parse optional parameters
    const pressureMultiplier = typeof params[0] === 'number' ? params[0] : 1.0;
    const frequencyMultiplier = typeof params[1] === 'number' ? params[1] : 1.0;

    // Update internal state
    this.repeaterState.active = newState;
    if (newState) {
      // Only update multipliers when turning on
      this.repeaterState.pressureMultiplier = pressureMultiplier;
      this.repeaterState.frequencyMultiplier = frequencyMultiplier;
    }

    // Log which button triggered the action if available
    const button = context.button ?? 'Unknown';
    if (newState) {
      console.log(`[ACTIONS] ${button} button enabled repeater: pressure=${pressureMultiplier}x, frequency=${frequencyMultiplier}x`);
    } else {
      console.log(`[ACTIONS] ${button} button disabled repeater`);
    }

    // Emit config changed event
    this.emit('config_changed');
  }

  /**
   * Toggle transpose on/off.
   *
   * @param params - Optional parameters:
   *   - params[0]: semitones (number, default 12) - Number of semitones to transpose
   * @param context - Context data (e.g., which button triggered the action)
   */
  toggleTranspose(params: unknown[], context: ActionContext): void {
    const newState = !this.transposeState.active;

    // Parse optional semitones parameter
    const semitones = typeof params[0] === 'number' ? Math.floor(params[0]) : 12;

    // Update internal state
    this.transposeState.active = newState;
    if (newState) {
      // Only update semitones when turning on
      this.transposeState.semitones = semitones;
    }

    // Log which button triggered the action if available
    const button = context.button ?? 'Unknown';
    if (newState) {
      console.log(`[ACTIONS] ${button} button enabled transpose: ${semitones > 0 ? '+' : ''}${semitones} semitones`);
    } else {
      console.log(`[ACTIONS] ${button} button disabled transpose`);
    }

    // Emit config changed event
    this.emit('config_changed');
  }

  /**
   * Add semitones to the current transpose value (cumulative).
   * Each press adds the specified semitones to the current transpose amount.
   * Transpose is automatically enabled when non-zero, disabled when zero.
   *
   * @param params - Required parameters:
   *   - params[0]: semitones (number) - Number of semitones to add (can be negative)
   * @param context - Context data (e.g., which button triggered the action)
   */
  transpose(params: unknown[], context: ActionContext): void {
    if (params.length === 0 || typeof params[0] !== 'number') {
      console.log('[ACTIONS] Error: transpose action requires semitones parameter');
      return;
    }

    const semitonesToAdd = Math.floor(params[0] as number);
    const button = context.button ?? 'Unknown';

    // Add to current semitones (cumulative)
    const newSemitones = this.transposeState.semitones + semitonesToAdd;
    this.transposeState.semitones = newSemitones;
    // Active when non-zero
    this.transposeState.active = newSemitones !== 0;

    if (newSemitones === 0) {
      console.log(`[ACTIONS] ${button} button reset transpose to 0`);
    } else {
      console.log(`[ACTIONS] ${button} button transposed ${semitonesToAdd > 0 ? '+' : ''}${semitonesToAdd} → total: ${newSemitones > 0 ? '+' : ''}${newSemitones} semitones`);
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
    return this.transposeState.active ? this.transposeState.semitones : 0;
  }

  /**
   * Check if transpose is currently active.
   */
  isTransposeActive(): boolean {
    return this.transposeState.active;
  }

  /**
   * Get the transpose configuration.
   */
  getTransposeConfig(): { active: boolean; semitones: number } {
    return { ...this.transposeState };
  }

  /**
   * Check if note repeater is currently active.
   */
  isRepeaterActive(): boolean {
    return this.repeaterState.active;
  }

  /**
   * Get the note repeater configuration.
   */
  getRepeaterConfig(): { active: boolean; pressureMultiplier: number; frequencyMultiplier: number } {
    return { ...this.repeaterState };
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
   * Set the chord progression for a button group.
   * This allows dynamically changing which progression a group of buttons uses.
   *
   * @param params - [groupId, progressionName, optionalOctave]
   */
  setGroupProgression(params: unknown[], context: ActionContext): void {
    if (params.length < 2) {
      console.log('[ACTIONS] Error: set-group-progression requires groupId and progressionName');
      return;
    }

    if (typeof params[0] !== 'string') {
      console.log('[ACTIONS] Error: First parameter must be groupId (string)');
      return;
    }

    if (typeof params[1] !== 'string') {
      console.log('[ACTIONS] Error: Second parameter must be progressionName (string)');
      return;
    }

    const groupId = params[0] as string;
    const progressionName = params[1] as string;

    if (!this.actionRulesConfig) {
      console.log('[ACTIONS] Error: No action rules config set');
      return;
    }

    // Validate progression exists
    if (!(progressionName in this.chordProgressions)) {
      console.log(`[ACTIONS] Error: Unknown progression '${progressionName}'`);
      return;
    }

    // Find the group
    const group = this.actionRulesConfig.groups.find(g => g.id === groupId);
    if (!group) {
      console.log(`[ACTIONS] Error: Unknown group '${groupId}'`);
      return;
    }

    // Find the group rule for this group
    const groupRule = this.actionRulesConfig.getGroupRuleForGroup(groupId);
    if (!groupRule) {
      console.log(`[ACTIONS] Error: No rule assigned to group '${group.name}'`);
      return;
    }

    // Update the group rule's progression (only for chord-progression action type)
    if (groupRule.action.type === 'chord-progression') {
      const oldProgression = groupRule.action.progression;
      groupRule.action.progression = progressionName;

      // Optionally update octave
      if (params.length > 2 && typeof params[2] === 'number') {
        groupRule.action.octave = Math.floor(params[2]);
      }

      const button = context.button ?? 'Unknown';
      console.log(`[ACTIONS] ${button} changed group '${group.name}' progression from '${oldProgression}' to '${progressionName}'`);
    } else {
      console.log(`[ACTIONS] Error: Group '${group.name}' does not have a chord-progression action`);
      return;
    }

    // Emit config changed event
    this.emit('config_changed');
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
