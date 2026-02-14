/**
 * Action Rules System
 *
 * A unified system for mapping buttons to actions, supporting:
 * - Individual button-to-action mappings with triggers (press/release/hold)
 * - Button groups with group-specific actions (e.g., chord progressions)
 * - Startup rules (button-less actions that run on initialization)
 * - Button naming for user clarity
 */

import { ActionDefinition } from '../core/actions.js';

/**
 * Button identifier type
 * - "button:primary" - Stylus primary button
 * - "button:secondary" - Stylus secondary button
 * - "button:1" through "button:N" - Tablet buttons by number
 */
export type ButtonId = `button:${string}`;

/**
 * Trigger type for when an action should execute
 */
export type TriggerType = 'press' | 'release' | 'hold';

/**
 * Action category - distinguishes between button and group actions
 */
export type ActionCategory = 'button' | 'group' | 'startup';

/**
 * Group action type - actions that can be assigned to button groups
 * Currently only chord-progression is supported
 */
export type GroupActionType = 'chord-progression';

/**
 * Group action definition - action with parameters for button groups
 */
export interface GroupAction {
  /** Type of group action */
  type: GroupActionType;
  /** Chord progression preset name (for chord-progression type) */
  progression: string;
  /** Octave for chord playback (for chord-progression type) */
  octave: number;
}

/**
 * Individual action rule - maps a button to an action
 */
export interface ActionRule {
  /** Unique identifier for this rule */
  id: string;
  /** Optional human-readable name for this rule */
  name?: string;
  /** Button that triggers this action */
  button: ButtonId;
  /** Action to execute (string or array with params) */
  action: ActionDefinition;
  /** When to trigger: 'press', 'release' (default), or 'hold' */
  trigger?: TriggerType;
}

/**
 * Button group - a named collection of buttons
 * Actions are assigned to groups via GroupRule, not directly on the group
 */
export interface ButtonGroup {
  /** Unique identifier for this group */
  id: string;
  /** Human-readable name for this group */
  name: string;
  /** Buttons in this group (in order for action mapping) */
  buttons: ButtonId[];
}

/**
 * Group rule - assigns a group action to a button group
 */
export interface GroupRule {
  /** Unique identifier for this rule */
  id: string;
  /** Optional human-readable name for this rule */
  name?: string;
  /** Group that this rule applies to */
  groupId: string;
  /** Group action to execute */
  action: GroupAction;
}

/**
 * Startup rule - an action that executes on initialization (no button)
 */
export interface StartupRule {
  /** Unique identifier for this rule */
  id: string;
  /** Human-readable name for this rule */
  name: string;
  /** Action to execute */
  action: ActionDefinition;
}

/**
 * Complete action rules configuration
 */
export interface ActionRulesConfigData {
  /** Human-readable names for buttons */
  buttonNames: Record<ButtonId, string>;
  /** Individual button-to-action rules */
  rules: ActionRule[];
  /** Button groups (just collections of buttons) */
  groups: ButtonGroup[];
  /** Group rules - actions assigned to groups */
  groupRules: GroupRule[];
  /** Actions that execute on startup */
  startupRules: StartupRule[];
}

/**
 * Default action rules configuration
 */
export const DEFAULT_ACTION_RULES_CONFIG: ActionRulesConfigData = {
  buttonNames: {},
  rules: [],
  groups: [],
  groupRules: [],
  startupRules: [],
};

/**
 * Generate a unique ID for rules/groups
 */
export function generateRuleId(prefix: string = 'rule'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse a button ID into its components
 */
export function parseButtonId(buttonId: ButtonId): { type: 'stylus' | 'tablet'; identifier: string } {
  const parts = buttonId.split(':');
  if (parts.length !== 2 || parts[0] !== 'button') {
    throw new Error(`Invalid button ID: ${buttonId}`);
  }
  
  const identifier = parts[1];
  if (identifier === 'primary' || identifier === 'secondary') {
    return { type: 'stylus', identifier };
  }
  
  // Numeric tablet button
  const num = parseInt(identifier, 10);
  if (isNaN(num) || num < 1) {
    throw new Error(`Invalid button ID: ${buttonId}`);
  }
  
  return { type: 'tablet', identifier };
}

/**
 * Create a button ID from components
 */
export function createButtonId(type: 'stylus' | 'tablet', identifier: string | number): ButtonId {
  if (type === 'stylus') {
    if (identifier !== 'primary' && identifier !== 'secondary') {
      throw new Error(`Invalid stylus identifier: ${identifier}`);
    }
    return `button:${identifier}` as ButtonId;
  }
  
  return `button:${identifier}` as ButtonId;
}

/**
 * Get a human-readable label for a button ID
 */
export function getButtonLabel(buttonId: ButtonId, buttonNames?: Record<ButtonId, string>): string {
  // Check for custom name first
  if (buttonNames && buttonNames[buttonId]) {
    return buttonNames[buttonId];
  }
  
  // Generate default label
  const { type, identifier } = parseButtonId(buttonId);
  if (type === 'stylus') {
    return identifier === 'primary' ? 'Primary Stylus' : 'Secondary Stylus';
  }
  
  return `Button ${identifier}`;
}

/**
 * Action Rules Configuration class
 */
export class ActionRulesConfig implements ActionRulesConfigData {
  buttonNames: Record<ButtonId, string>;
  rules: ActionRule[];
  groups: ButtonGroup[];
  groupRules: GroupRule[];
  startupRules: StartupRule[];

  constructor(data: Partial<ActionRulesConfigData> = {}) {
    this.buttonNames = { ...DEFAULT_ACTION_RULES_CONFIG.buttonNames, ...data.buttonNames };
    this.rules = data.rules ? [...data.rules] : [];
    this.groups = data.groups ? [...data.groups] : [];
    this.groupRules = data.groupRules ? [...data.groupRules] : [];
    this.startupRules = data.startupRules ? [...data.startupRules] : [];
  }

  /**
   * Create from a plain object (e.g., from JSON)
   */
  static fromDict(data: Record<string, unknown> | null | undefined): ActionRulesConfig {
    if (!data) {
      return new ActionRulesConfig();
    }

    return new ActionRulesConfig({
      buttonNames: (data.buttonNames ?? data.button_names) as Record<ButtonId, string> | undefined,
      rules: (data.rules as ActionRule[]) ?? [],
      groups: (data.groups as ButtonGroup[]) ?? [],
      groupRules: (data.groupRules ?? data.group_rules) as GroupRule[] | undefined,
      startupRules: (data.startupRules ?? data.startup_rules) as StartupRule[] | undefined,
    });
  }

  /**
   * Convert to a plain object for JSON serialization
   */
  toDict(): ActionRulesConfigData {
    return {
      buttonNames: { ...this.buttonNames },
      rules: [...this.rules],
      groups: [...this.groups],
      groupRules: [...this.groupRules],
      startupRules: [...this.startupRules],
    };
  }

  /**
   * Add a new action rule
   */
  addRule(rule: Omit<ActionRule, 'id'> & { id?: string }): ActionRule {
    const newRule: ActionRule = {
      ...rule,
      id: rule.id ?? generateRuleId('rule'),
      trigger: rule.trigger ?? 'release',
    };
    this.rules.push(newRule);
    return newRule;
  }

  /**
   * Remove a rule by ID
   */
  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update a rule by ID
   */
  updateRule(ruleId: string, updates: Partial<Omit<ActionRule, 'id'>>): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      Object.assign(rule, updates);
      return true;
    }
    return false;
  }

  /**
   * Add a new button group
   */
  addGroup(group: Omit<ButtonGroup, 'id'> & { id?: string }): ButtonGroup {
    const newGroup: ButtonGroup = {
      ...group,
      id: group.id ?? generateRuleId('group'),
    };
    this.groups.push(newGroup);
    return newGroup;
  }

  /**
   * Remove a group by ID
   */
  removeGroup(groupId: string): boolean {
    const index = this.groups.findIndex(g => g.id === groupId);
    if (index >= 0) {
      this.groups.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update a group by ID
   */
  updateGroup(groupId: string, updates: Partial<Omit<ButtonGroup, 'id'>>): boolean {
    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      Object.assign(group, updates);
      return true;
    }
    return false;
  }

  /**
   * Add a new group rule
   */
  addGroupRule(rule: Omit<GroupRule, 'id'> & { id?: string }): GroupRule {
    const newRule: GroupRule = {
      ...rule,
      id: rule.id ?? generateRuleId('grouprule'),
    };
    this.groupRules.push(newRule);
    return newRule;
  }

  /**
   * Remove a group rule by ID
   */
  removeGroupRule(ruleId: string): boolean {
    const index = this.groupRules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.groupRules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Update a group rule by ID
   */
  updateGroupRule(ruleId: string, updates: Partial<Omit<GroupRule, 'id'>>): boolean {
    const rule = this.groupRules.find(r => r.id === ruleId);
    if (rule) {
      Object.assign(rule, updates);
      return true;
    }
    return false;
  }

  /**
   * Get the group rule for a specific group (if any)
   */
  getGroupRuleForGroup(groupId: string): GroupRule | undefined {
    return this.groupRules.find(r => r.groupId === groupId);
  }

  /**
   * Add a startup rule
   */
  addStartupRule(rule: Omit<StartupRule, 'id'> & { id?: string }): StartupRule {
    const newRule: StartupRule = {
      ...rule,
      id: rule.id ?? generateRuleId('startup'),
    };
    this.startupRules.push(newRule);
    return newRule;
  }

  /**
   * Remove a startup rule by ID
   */
  removeStartupRule(ruleId: string): boolean {
    const index = this.startupRules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.startupRules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Set a button's name
   */
  setButtonName(buttonId: ButtonId, name: string): void {
    if (name) {
      this.buttonNames[buttonId] = name;
    } else {
      delete this.buttonNames[buttonId];
    }
  }

  /**
   * Get all rules for a specific button
   */
  getRulesForButton(buttonId: ButtonId): ActionRule[] {
    return this.rules.filter(r => r.button === buttonId);
  }

  /**
   * Get the group that contains a specific button (if any)
   */
  getGroupForButton(buttonId: ButtonId): ButtonGroup | undefined {
    return this.groups.find(g => g.buttons.includes(buttonId));
  }

  /**
   * Get the action for a button press/release/hold event
   * Returns the action definition if found, or null if no matching rule
   */
  getActionForButtonEvent(buttonId: ButtonId, trigger: TriggerType): ActionDefinition | null {
    // First check individual rules
    const rule = this.rules.find(r => r.button === buttonId && (r.trigger ?? 'release') === trigger);
    if (rule) {
      return rule.action;
    }

    // Then check groups (groups only respond to 'release' by default)
    if (trigger === 'release') {
      const group = this.getGroupForButton(buttonId);
      if (group) {
        const buttonIndex = group.buttons.indexOf(buttonId);
        if (buttonIndex >= 0) {
          // Find the group rule for this group
          const groupRule = this.getGroupRuleForGroup(group.id);
          if (groupRule) {
            // Handle group action based on type
            if (groupRule.action.type === 'chord-progression') {
              // Return a set-chord-in-progression action
              return ['set-chord-in-progression', groupRule.action.progression, buttonIndex, groupRule.action.octave];
            }
          }
        }
      }
    }

    return null;
  }
}
