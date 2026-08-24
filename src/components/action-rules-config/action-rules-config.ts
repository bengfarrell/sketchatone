/**
 * Action Rules Configuration Component
 * 
 * A compact, rule-based UI for configuring button-to-action mappings.
 * Supports:
 * - Individual button rules with triggers (press/release/hold)
 * - Button groups for chord progressions
 * - Startup rules (button-less actions)
 * - Button detection for easy setup
 */

import { LitElement, html, PropertyValues, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { formStyles } from '../../design-system/form-styles.js';
import '../../design-system/components/sketch-button.js';
import '../../design-system/components/sketch-icon.js';
import { live } from 'lit/directives/live.js';
import { cache } from 'lit/directives/cache.js';
import { repeat } from 'lit/directives/repeat.js';
import { styles } from './action-rules-config.styles.js';
import {
  ActionRulesConfig,
  ActionRule,
  ButtonGroup,
  GroupRule,
  StartupRule,
  ButtonId,
  TriggerType,
  GroupAction,
  GroupActionType,
  generateRuleId,
} from '../../models/action-rules.js';
import { ActionDefinition } from '../../core/actions.js';
import { getAllChordProgressionNames } from '../../models/strummer-features.js';
import { Note } from '../../models/note.js';

// Root note options for scale picker (chromatic, sharp notation)
const ROOT_NOTE_OPTIONS: { value: string; label: string }[] = Note.sharpNotations.map((n) => ({ value: n, label: n }));

// Scale type options for scale picker (derived from Note.scaleIntervals)
const SCALE_TYPE_OPTIONS: { value: string; label: string }[] = Object.keys(Note.scaleIntervals).map((k) => ({ value: k, label: k }));

// Import Spectrum components


/**
 * Parameter definition for actions
 */
interface ParamDef {
  key: string;
  label: string;
  type: 'number' | 'text' | 'select';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: unknown;
  options?: { value: string; label: string }[];
}

/**
 * Action definition with optional parameters
 */
interface ActionDef {
  value: string;
  label: string;
  params?: ParamDef[];
}

type FormMode = 'none' | 'add-action' | 'edit-action' | 'add-group' | 'edit-group';
type ActionTargetType = 'button' | 'group' | 'startup';

@customElement('action-rules-config')
export class ActionRulesConfigComponent extends LitElement {
  static styles = [formStyles, styles];

  @property({ type: Object })
  config?: ActionRulesConfig;

  /** Display mode: 'all' shows both panels, 'actions' shows only actions, 'groups' shows only groups */
  @property({ type: String })
  mode: 'all' | 'actions' | 'groups' = 'all';

  /** Set of currently pressed button IDs for visual feedback */
  @property({ type: Object })
  pressedButtons: Set<ButtonId> = new Set();

  /** HID scan codes for auxiliary tablet buttons the user has already observed
   * (either currently pressed or referenced by loaded rules/groups). Shown in the
   * button dropdown alongside stylus buttons so users can edit existing bindings
   * without having to re-detect the physical press. */
  @property({ type: Object })
  knownAuxCodes: Set<number> = new Set();

  /** Normalized keyboard characters the user has already observed. Shown in the
   * button dropdown alongside tablet buttons so `key:<char>` bindings can be
   * edited without having to re-press the key. */
  @property({ type: Object })
  knownKeys: Set<string> = new Set();

  /** Map from button ID (e.g. "code:66049", "key:a") to a friendly display
   * label. When a mapping is present, the UI shows the friendly name in chips
   * and dropdown options instead of the raw identifier. */
  @property({ type: Object })
  buttonLabels: Record<string, string> = {};

  /** Whether stylus has primary button */
  @property({ type: Boolean })
  hasPrimaryButton: boolean = true;

  /** Whether stylus has secondary button */
  @property({ type: Boolean })
  hasSecondaryButton: boolean = true;

  /** Chord progressions from config */
  @property({ type: Object })
  chordProgressions: Record<string, string[]> = {};

  /** Map of triggered action rule IDs to timestamps (for status dot display) */
  @property({ type: Object })
  triggeredActions: Map<string, number> = new Map();

  @state()
  private formMode: FormMode = 'none';

  @state()
  private editingId: string | null = null;

  // Unified action form state
  @state()
  private formTargetType: ActionTargetType = 'button';

  @state()
  private formButton: ButtonId = 'button:primary';

  @state()
  private formGroupId: string = '';

  @state()
  private formAction: string = 'none';

  @state()
  private formTrigger: TriggerType = 'release';

  @state()
  private formName: string = '';

  @state()
  private formParams: unknown[] = [];

  // Group action specific (for chord-progression)
  @state()
  private formGroupActionType: GroupActionType = 'chord-progression';

  @state()
  private formGroupProgression: string = 'c-major-pop';

  @state()
  private formGroupOctave: number = 4;

  @state()
  private formGroupTrigger: TriggerType = 'release';

  // Form state for groups (just name and buttons)
  @state()
  private formGroupName: string = '';

  @state()
  private formGroupButtons: ButtonId[] = [];

  // Get progression names from config
  private get progressionNames(): string[] {
    return getAllChordProgressionNames(this.chordProgressions);
  }

  // Available actions
  private readonly actions: ActionDef[] = [
    { value: 'none', label: 'None' },
    {
      value: 'toggle-repeater',
      label: 'Toggle Note Repeater',
      params: [
        { key: 'pressureMultiplier', label: 'Pressure Multiplier', type: 'number', min: 0.1, max: 10, step: 0.1, defaultValue: 2.0 },
        { key: 'frequencyMultiplier', label: 'Frequency Multiplier', type: 'number', min: 0.1, max: 10, step: 0.1, defaultValue: 1.5 },
      ],
    },
    {
      value: 'toggle-transpose',
      label: 'Toggle Transpose',
      params: [{ key: 'semitones', label: 'Semitones', type: 'number', min: -24, max: 24, step: 1, defaultValue: 12 }],
    },
    {
      value: 'transpose',
      label: 'Transpose',
      params: [{ key: 'semitones', label: 'Semitones', type: 'number', min: -24, max: 24, step: 1, defaultValue: 12 }],
    },
    {
      value: 'set-strum-chord',
      label: 'Set Strum Chord',
      params: [
        { key: 'chord', label: 'Chord', type: 'text', defaultValue: 'C' },
        { key: 'octave', label: 'Octave', type: 'number', min: 0, max: 8, step: 1, defaultValue: 4 },
      ],
    },
    {
      value: 'set-strum-scale',
      label: 'Set Strum Scale',
      params: [
        { key: 'root', label: 'Root Note', type: 'select', defaultValue: 'C', options: ROOT_NOTE_OPTIONS },
        { key: 'scaleType', label: 'Scale Type', type: 'select', defaultValue: 'major', options: SCALE_TYPE_OPTIONS },
        { key: 'octave', label: 'Octave', type: 'number', min: 0, max: 8, step: 1, defaultValue: 4 },
      ],
    },
    {
      value: 'set-group-progression',
      label: 'Set Group Progression',
      params: [
        { key: 'groupId', label: 'Group ID', type: 'text', defaultValue: '' },
        {
          key: 'progression',
          label: 'Progression',
          type: 'select',
          defaultValue: 'c-major-pop',
          // Note: Options are populated dynamically from config in renderParamFields()
          options: [],
        },
      ],
    },
  ];

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    // Notify parent when form open/close state or title changes so the
    // host can swap the panel header (e.g., show back button + form title).
    if (changedProperties.has('formMode') || changedProperties.has('formTargetType')) {
      const open = this.formMode !== 'none';
      this.dispatchEvent(new CustomEvent('form-state-change', {
        detail: { open, title: open ? this.getFormTitle() : '' },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private getFormTitle(): string {
    const isEdit = this.formMode === 'edit-action';
    if (this.formMode === 'add-group') return 'Add Group';
    if (this.formMode === 'edit-group') return 'Edit Group';
    if (isEdit) {
      switch (this.formTargetType) {
        case 'button': return 'Edit Button Action';
        case 'group': return 'Edit Group Action';
        case 'startup': return 'Edit Startup Action';
      }
    }
    return 'Add Action';
  }

  /** Get the human-readable label for a button ID (falls back to the raw ID). */
  private formatButtonLabel(id: ButtonId): string {
    const mapped = this.buttonLabels[id];
    if (mapped) return mapped;
    if (id === 'button:primary') return 'Stylus Primary';
    if (id === 'button:secondary') return 'Stylus Secondary';
    if (id.startsWith('key:')) return `Key ${id.slice(4).toUpperCase()}`;
    return id;
  }

  private getAvailableButtons(): ButtonId[] {
    const buttons: ButtonId[] = [];
    if (this.hasPrimaryButton) buttons.push('button:primary');
    if (this.hasSecondaryButton) buttons.push('button:secondary');
    // Collect aux HID codes and key characters from known sets plus any
    // referenced by existing rules/groups so previously-bound entries remain
    // editable even when the source device isn't currently attached.
    const codes = new Set<number>(this.knownAuxCodes);
    const keys = new Set<string>(this.knownKeys);
    if (this.config) {
      const collect = (id: ButtonId) => {
        if (id.startsWith('code:')) {
          const n = parseInt(id.slice(5), 10);
          if (!isNaN(n)) codes.add(n);
        } else if (id.startsWith('key:')) {
          const k = id.slice(4);
          if (k) keys.add(k);
        }
      };
      for (const rule of this.config.rules) collect(rule.button);
      for (const group of this.config.groups) for (const b of group.buttons) collect(b);
    }
    for (const code of Array.from(codes).sort((a, b) => a - b)) {
      buttons.push(`code:${code}` as ButtonId);
    }
    for (const key of Array.from(keys).sort()) {
      buttons.push(`key:${key}` as ButtonId);
    }
    return buttons;
  }

  private formatAction(action: ActionDefinition): string {
    if (!action || action === 'none') return 'None';
    if (typeof action === 'string') return action;
    if (Array.isArray(action)) {
      const [name, ...params] = action;
      if (params.length > 0) {
        return `${name}(${params.join(', ')})`;
      }
      return name as string;
    }
    return String(action);
  }

  private buildActionDefinition(actionName: string, params: unknown[]): ActionDefinition {
    if (actionName === 'none' || !actionName) return null;
    // set-strum-scale form stores [root, scaleType, octave]; combine into notation "root:scaleType"
    if (actionName === 'set-strum-scale') {
      const root = (params[0] as string) ?? 'C';
      const scaleType = (params[1] as string) ?? 'major';
      const octave = (params[2] as number) ?? 4;
      return ['set-strum-scale', `${root}:${scaleType}`, octave];
    }
    if (params.length === 0) return actionName;
    return [actionName, ...params] as [string, ...unknown[]];
  }

  // Convert stored action params back into form params for editing.
  // For set-strum-scale, split "root:scaleType" back into [root, scaleType, octave].
  private actionParamsToFormParams(actionName: string, params: unknown[]): unknown[] {
    if (actionName === 'set-strum-scale') {
      const notation = (params[0] as string) ?? 'C:major';
      const octave = (params[1] as number) ?? 4;
      let root = 'C';
      let scaleType = 'major';
      if (notation.includes(':')) {
        const [r, s] = notation.split(':');
        root = r || 'C';
        scaleType = s || 'major';
      } else if (notation.length >= 2 && (notation[1] === '#' || notation[1] === 'b')) {
        root = notation.slice(0, 2);
        scaleType = notation.slice(2) || 'major';
      } else {
        root = notation[0] || 'C';
        scaleType = notation.slice(1) || 'major';
      }
      return [root, scaleType, octave];
    }
    return params;
  }

  // Event dispatching
  private dispatchConfigChange() {
    if (!this.config) return;
    this.dispatchEvent(
      new CustomEvent('config-change', {
        detail: { actionRules: this.config.toDict() },
        bubbles: true,
        composed: true,
      })
    );
  }

  // Form handlers
  private openAddActionForm(targetType: ActionTargetType = 'button') {
    this.formMode = 'add-action';
    this.editingId = null;
    this.formTargetType = targetType;
    this.formButton = 'button:primary';
    this.formGroupId = this.config?.groups[0]?.id ?? '';
    this.formAction = 'none';
    this.formTrigger = 'release';
    this.formName = '';
    this.formParams = [];
    // Group action defaults
    this.formGroupActionType = 'chord-progression';
    this.formGroupProgression = 'c-major-pop';
    this.formGroupOctave = 4;
    this.formGroupTrigger = 'release';
  }

  private openEditButtonRuleForm(rule: ActionRule) {
    this.formMode = 'edit-action';
    this.editingId = rule.id;
    this.formTargetType = 'button';
    this.formButton = rule.button;
    this.formTrigger = rule.trigger ?? 'release';
    this.formName = rule.name ?? '';

    // Parse action
    if (typeof rule.action === 'string') {
      this.formAction = rule.action;
      this.formParams = [];
    } else if (Array.isArray(rule.action)) {
      this.formAction = rule.action[0] as string;
      this.formParams = this.actionParamsToFormParams(this.formAction, rule.action.slice(1));
    } else {
      this.formAction = 'none';
      this.formParams = [];
    }
  }

  private openEditGroupRuleForm(rule: GroupRule) {
    this.formMode = 'edit-action';
    this.editingId = rule.id;
    this.formTargetType = 'group';
    this.formGroupId = rule.groupId;
    this.formName = rule.name ?? '';
    this.formGroupActionType = rule.action.type;
    this.formGroupProgression = rule.action.progression;
    this.formGroupOctave = rule.action.octave;
    this.formGroupTrigger = rule.trigger ?? 'release';
  }

  private openEditStartupRuleForm(rule: StartupRule) {
    this.formMode = 'edit-action';
    this.editingId = rule.id;
    this.formTargetType = 'startup';
    this.formName = rule.name;

    if (typeof rule.action === 'string') {
      this.formAction = rule.action;
      this.formParams = [];
    } else if (Array.isArray(rule.action)) {
      this.formAction = rule.action[0] as string;
      this.formParams = this.actionParamsToFormParams(this.formAction, rule.action.slice(1));
    } else {
      this.formAction = 'none';
      this.formParams = [];
    }
  }

  private openAddGroupForm() {
    this.formMode = 'add-group';
    this.editingId = null;
    this.formGroupName = '';
    this.formGroupButtons = [];
  }

  private openEditGroupForm(group: ButtonGroup) {
    this.formMode = 'edit-group';
    this.editingId = group.id;
    this.formGroupName = group.name;
    this.formGroupButtons = [...group.buttons];
  }

  public closeForm() {
    this.formMode = 'none';
    this.editingId = null;
  }

  private handleActionChange(e: Event) {
    const picker = e.target as HTMLSelectElement;
    this.formAction = picker.value;

    // Initialize params with defaults
    const actionDef = this.actions.find((a) => a.value === this.formAction);
    if (actionDef?.params) {
      this.formParams = actionDef.params.map((p) => p.defaultValue);
    } else {
      this.formParams = [];
    }
  }

  private handleParamChange(index: number, value: unknown) {
    const newParams = [...this.formParams];
    newParams[index] = value;
    this.formParams = newParams;
  }

  private toggleGroupButton(buttonId: ButtonId) {
    const index = this.formGroupButtons.indexOf(buttonId);
    if (index >= 0) {
      this.formGroupButtons = this.formGroupButtons.filter((b) => b !== buttonId);
    } else {
      this.formGroupButtons = [...this.formGroupButtons, buttonId];
    }
  }

  private saveRule() {
    if (!this.config) return;

    // Route to appropriate save based on target type
    if (this.formTargetType === 'button') {
      this.saveButtonRule();
    } else if (this.formTargetType === 'group') {
      this.saveGroupRule();
    } else if (this.formTargetType === 'startup') {
      this.saveStartupRule();
    }
  }

  private saveButtonRule() {
    if (!this.config) return;

    const action = this.buildActionDefinition(this.formAction, this.formParams);

    if (this.formMode === 'add-action') {
      this.config.addRule({
        button: this.formButton,
        action,
        trigger: this.formTrigger,
        name: this.formName || undefined,
      });
    } else if (this.formMode === 'edit-action' && this.editingId) {
      this.config.updateRule(this.editingId, {
        button: this.formButton,
        action,
        trigger: this.formTrigger,
        name: this.formName || undefined,
      });
    }

    this.dispatchConfigChange();
    this.closeForm();
  }

  private saveGroupRule() {
    if (!this.config) return;

    // Build the group action based on the selected type
    const groupAction: GroupAction = {
      type: this.formGroupActionType,
      progression: this.formGroupProgression,
      octave: this.formGroupOctave,
    };

    if (this.formMode === 'add-action') {
      this.config.addGroupRule({
        groupId: this.formGroupId,
        name: this.formName || undefined,
        action: groupAction,
        trigger: this.formGroupTrigger,
      });
    } else if (this.formMode === 'edit-action' && this.editingId) {
      this.config.updateGroupRule(this.editingId, {
        groupId: this.formGroupId,
        name: this.formName || undefined,
        action: groupAction,
        trigger: this.formGroupTrigger,
      });
    }

    this.dispatchConfigChange();
    this.closeForm();
  }

  private saveStartupRule() {
    if (!this.config) return;

    const action = this.buildActionDefinition(this.formAction, this.formParams);

    if (this.formMode === 'add-action') {
      this.config.addStartupRule({
        name: this.formName || 'Unnamed Startup Rule',
        action,
      });
    } else if (this.formMode === 'edit-action' && this.editingId) {
      const rule = this.config.startupRules.find((r) => r.id === this.editingId);
      if (rule) {
        rule.name = this.formName || 'Unnamed Startup Rule';
        rule.action = action;
      }
    }

    this.dispatchConfigChange();
    this.closeForm();
  }

  private saveGroup() {
    if (!this.config) return;

    if (this.formMode === 'add-group') {
      this.config.addGroup({
        name: this.formGroupName || 'Unnamed Group',
        buttons: this.formGroupButtons,
      });
    } else if (this.formMode === 'edit-group' && this.editingId) {
      this.config.updateGroup(this.editingId, {
        name: this.formGroupName || 'Unnamed Group',
        buttons: this.formGroupButtons,
      });
    }

    this.dispatchConfigChange();
    this.closeForm();
  }

  private deleteRule(ruleId: string) {
    if (!this.config) return;
    this.config.removeRule(ruleId);
    this.dispatchConfigChange();
  }

  private deleteGroup(groupId: string) {
    if (!this.config) return;
    // Also remove any group rules that reference this group
    const groupRule = this.config.getGroupRuleForGroup(groupId);
    if (groupRule) {
      this.config.removeGroupRule(groupRule.id);
    }
    this.config.removeGroup(groupId);
    this.dispatchConfigChange();
  }

  private deleteGroupRule(ruleId: string) {
    if (!this.config) return;
    this.config.removeGroupRule(ruleId);
    this.dispatchConfigChange();
  }

  private deleteStartupRule(ruleId: string) {
    if (!this.config) return;
    this.config.removeStartupRule(ruleId);
    this.dispatchConfigChange();
  }

  // Public method to open add action form (for external trigger from header button)
  public openAddAction() {
    this.openAddActionForm();
  }

  // Public method to open add group form (for external trigger from header button)
  public openAddGroup() {
    this.openAddGroupForm();
  }

  // Helper to check if a rule is currently triggered (for status dot)
  private isRuleTriggered(ruleId: string): boolean {
    return this.triggeredActions.has(ruleId);
  }

  // Render methods
  private renderActionsListContent() {
    const rules = this.config?.rules ?? [];
    const groupRules = this.config?.groupRules ?? [];
    const startupRules = this.config?.startupRules ?? [];
    const groups = this.config?.groups ?? [];

    const hasAnyActions = rules.length > 0 || groupRules.length > 0 || startupRules.length > 0;

    return html`
      <div class="rules-list">
        ${!hasAnyActions
          ? html`<div class="empty-state">No actions configured</div>`
          : html`
              ${rules.map(
                (rule) => html`
                  <div class="rule-item">
                    <div class="rule-top-row">
                      <span class="status-dot ${this.isRuleTriggered(rule.id) ? 'active' : ''}"></span>
                      <span class="rule-type-badge button">Button</span>
                      <span class="rule-button-id">${this.formatButtonLabel(rule.button)}</span>
                      <span class="rule-trigger">${rule.trigger ?? 'release'}</span>
                      <div class="rule-actions">
                        <sketch-button variant="quiet" size="s" @click=${() => this.openEditButtonRuleForm(rule)}>
                          <sketch-icon slot="icon" name="edit"></sketch-icon>
                        </sketch-button>
                        <sketch-button variant="quiet" size="s" @click=${() => this.deleteRule(rule.id)}>
                          <sketch-icon slot="icon" name="delete"></sketch-icon>
                        </sketch-button>
                      </div>
                    </div>
                    <span class="rule-action">${this.formatAction(rule.action)}</span>
                    ${rule.name ? html`<span class="rule-name">${rule.name}</span>` : ''}
                  </div>
                `
              )}
              ${groupRules.map((rule) => {
                const group = groups.find((g) => g.id === rule.groupId);
                return html`
                  <div class="rule-item">
                    <div class="rule-top-row">
                      <span class="status-dot ${this.isRuleTriggered(rule.id) ? 'active' : ''}"></span>
                      <span class="rule-type-badge group">Group</span>
                      <span class="rule-button-id">${group?.name ?? 'Unknown Group'}</span>
                      <span class="rule-trigger">${rule.trigger ?? 'release'}</span>
                      <div class="rule-actions">
                        <sketch-button variant="quiet" size="s" @click=${() => this.openEditGroupRuleForm(rule)}>
                          <sketch-icon slot="icon" name="edit"></sketch-icon>
                        </sketch-button>
                        <sketch-button variant="quiet" size="s" @click=${() => this.deleteGroupRule(rule.id)}>
                          <sketch-icon slot="icon" name="delete"></sketch-icon>
                        </sketch-button>
                      </div>
                    </div>
                    <span class="rule-action">${rule.action.type}: ${rule.action.progression} (Oct ${rule.action.octave})</span>
                    ${rule.name ? html`<span class="rule-name">${rule.name}</span>` : ''}
                  </div>
                `;
              })}
              ${startupRules.map(
                (rule) => html`
                  <div class="rule-item">
                    <span class="status-dot active permanent"></span>
                    <span class="rule-type-badge startup">Startup</span>
                    <span class="startup-icon">⚡</span>
                    <span class="rule-action">${rule.name}: ${this.formatAction(rule.action)}</span>
                    <div class="rule-actions">
                      <sketch-button variant="quiet" size="s" @click=${() => this.openEditStartupRuleForm(rule)}>
                        <sketch-icon slot="icon" name="edit"></sketch-icon>
                      </sketch-button>
                      <sketch-button variant="quiet" size="s" @click=${() => this.deleteStartupRule(rule.id)}>
                        <sketch-icon slot="icon" name="delete"></sketch-icon>
                      </sketch-button>
                    </div>
                  </div>
                `
              )}
            `}
      </div>
    `;
  }

  private renderActionsList() {
    return html`
      <div class="panel">
        <div class="section-header">
          <span class="section-title">Actions</span>
          <sketch-button variant="quiet" size="s" @click=${() => this.openAddActionForm()}>
            <sketch-icon slot="icon" name="add"></sketch-icon>
            Add Action
          </sketch-button>
        </div>
        ${this.renderActionsListContent()}
      </div>
    `;
  }

  private renderGroupsListContent() {
    const groups = this.config?.groups ?? [];

    return html`
      <div class="rules-list">
        ${groups.length === 0
          ? html`<div class="empty-state">No button groups configured</div>`
          : groups.map(
              (group) => html`
                <div class="group-item">
                  <div class="group-header">
                    <span class="group-name">${group.name}</span>
                    <div class="rule-actions">
                      <sketch-button variant="quiet" size="s" @click=${() => this.openEditGroupForm(group)}>
                        <sketch-icon slot="icon" name="edit"></sketch-icon>
                      </sketch-button>
                      <sketch-button variant="quiet" size="s" @click=${() => this.deleteGroup(group.id)}>
                        <sketch-icon slot="icon" name="delete"></sketch-icon>
                      </sketch-button>
                    </div>
                  </div>
                  <div class="group-buttons">
                    ${group.buttons.map((btn) => {
                      const isPressed = this.pressedButtons.has(btn);
                      return html`<span class="button-chip ${isPressed ? 'pressed' : ''}"
                        >${this.formatButtonLabel(btn)}</span
                      >`;
                    })}
                  </div>
                </div>
              `
            )}
      </div>
    `;
  }

  private renderGroupsList() {
    return html`
      <div class="panel">
        <div class="section-header">
          <span class="section-title">Button Groups</span>
          <sketch-button variant="quiet" size="s" @click=${this.openAddGroupForm}>
            <sketch-icon slot="icon" name="add"></sketch-icon>
            Add Group
          </sketch-button>
        </div>
        ${this.renderGroupsListContent()}
      </div>
    `;
  }

  private renderParamFields() {
    const actionDef = this.actions.find((a) => a.value === this.formAction);
    if (!actionDef?.params) return '';

    return actionDef.params.map((param, index) => {
      const value = this.formParams[index] ?? param.defaultValue;

      if (param.type === 'select' && param.options) {
        // Special handling for progression parameter - use custom progressions
        const options = param.key === 'progression'
          ? this.progressionNames.map((n) => ({ value: n, label: n }))
          : param.options;

        // Use a native <select> rather than sp-picker; the Spectrum picker overlay
        // can disappear when populated with longer option lists (e.g. scale types).
        return html`
          <div class="form-field">
            <label class="sketch-label">${param.label}</label>
            <select
              class="native-select"
              .value=${live(String(value))}
              @change=${(e: Event) => this.handleParamChange(index, (e.target as HTMLSelectElement).value)}
            >
              ${options.map((opt) => html`<option value="${opt.value}" ?selected=${opt.value === value}>${opt.label}</option>`)}
            </select>
          </div>
        `;
      }

      if (param.type === 'number') {
        return html`
          <div class="form-field">
            <label class="sketch-label">${param.label}</label>
            <input type="number" class="sketch-input"
              .value=${value}
              min="${param.min}"
              max="${param.max}"
              step="${param.step}"
              @change=${(e: Event) => this.handleParamChange(index, Number((e.target as HTMLInputElement).value))}
            >
          </div>
        `;
      }

      return html`
        <div class="form-field">
          <label class="sketch-label">${param.label}</label>
          <input type="text" class="sketch-input" .value=${value} @change=${(e: Event) => this.handleParamChange(index, (e.target as HTMLInputElement).value)}>
        </div>
      `;
    });
  }

  private handleTargetTypeChange(e: Event) {
    const newTargetType = (e.target as HTMLSelectElement).value as ActionTargetType;
    this.formTargetType = newTargetType;
    // Reset action-specific fields when changing target type
    this.formAction = 'none';
    this.formParams = [];
    this.formGroupActionType = 'chord-progression';
    this.formGroupProgression = 'c-major-pop';
    this.formGroupOctave = 4;
    this.formGroupTrigger = 'release';
  }

  private renderActionForm() {
    const isEdit = this.formMode === 'edit-action';
    const availableButtons = this.getAvailableButtons();
    const groups = this.config?.groups ?? [];

    return html`
      <div class="form-view">
        ${this.mode === 'all' ? html`
          <div class="form-header">
            <sketch-button variant="quiet" size="s" @click=${this.closeForm} title="Back">
              <sketch-icon slot="icon" name="arrow-left"></sketch-icon>
            </sketch-button>
            <span class="form-title">${this.getFormTitle()}</span>
          </div>
        ` : ''}
        <div class="form-body">

          <!-- Target Type Selector (only show when adding, not editing) -->
          ${!isEdit ? html`
            <div class="form-field">
              <label class="sketch-label">Target Type</label>
              <select class="native-select" .value=${live(this.formTargetType)} @change=${this.handleTargetTypeChange}>
                <option value="button" ?selected=${this.formTargetType === 'button'}>Button</option>
                <option value="group" ?disabled=${groups.length === 0} ?selected=${this.formTargetType === 'group'}>Group${groups.length === 0 ? ' (create a group first)' : ''}</option>
                <option value="startup" ?selected=${this.formTargetType === 'startup'}>Startup</option>
              </select>
            </div>
          ` : ''}

          <!-- Button-specific fields -->
          ${this.formTargetType === 'button' ? html`
            <div class="form-field">
              <label class="sketch-label">Button</label>
              <select class="native-select" .value=${live(this.formButton)} @change=${(e: Event) => (this.formButton = (e.target as HTMLSelectElement).value as ButtonId)}>
                ${availableButtons.map((btn) => html`<option value="${btn}" ?selected=${btn === this.formButton}>${this.formatButtonLabel(btn)}</option>`)}
              </select>
            </div>

            <div class="form-field">
              <label class="sketch-label">Action</label>
              <select class="native-select" .value=${live(this.formAction)} @change=${this.handleActionChange}>
                ${this.actions.map((action) => html`<option value="${action.value}" ?selected=${action.value === this.formAction}>${action.label}</option>`)}
              </select>
            </div>

            ${this.renderParamFields()}

            <div class="form-field">
              <label class="sketch-label">Trigger</label>
              <select class="native-select" .value=${live(this.formTrigger)} @change=${(e: Event) => (this.formTrigger = (e.target as HTMLSelectElement).value as TriggerType)}>
                <option value="release" ?selected=${this.formTrigger === 'release'}>On Release (default)</option>
                <option value="press" ?selected=${this.formTrigger === 'press'}>On Press</option>
                <option value="hold" ?selected=${this.formTrigger === 'hold'}>While Held</option>
              </select>
            </div>
          ` : ''}

          <!-- Group-specific fields -->
          ${this.formTargetType === 'group' ? html`
            <div class="form-field">
              <label class="sketch-label">Group</label>
              <select class="native-select" .value=${live(this.formGroupId)} @change=${(e: Event) => (this.formGroupId = (e.target as HTMLSelectElement).value)}>
                ${groups.map((group) => html`<option value="${group.id}" ?selected=${group.id === this.formGroupId}>${group.name}</option>`)}
              </select>
            </div>

            <div class="form-field">
              <label class="sketch-label">Action Type</label>
              <select class="native-select" .value=${live(this.formGroupActionType)} @change=${(e: Event) => (this.formGroupActionType = (e.target as HTMLSelectElement).value as GroupActionType)}>
                <option value="chord-progression" ?selected=${this.formGroupActionType === 'chord-progression'}>Chord Progression</option>
              </select>
            </div>

            <div class="form-field">
              <label class="sketch-label">Chord Progression</label>
              <select
                class="native-select"
                .value=${live(this.formGroupProgression)}
                @change=${(e: Event) => {
                  this.formGroupProgression = (e.target as HTMLSelectElement).value;
                }}
              >
                ${this.progressionNames.map((name) => html`<option value="${name}" ?selected=${name === this.formGroupProgression}>${name}</option>`)}
              </select>
            </div>

            <div class="form-field">
              <label class="sketch-label">Octave</label>
              <input type="number" class="sketch-input" .value=${this.formGroupOctave} min="0" max="8" step="1" @change=${(e: Event) => (this.formGroupOctave = Number((e.target as HTMLInputElement).value))}>
            </div>

            <div class="form-field">
              <label class="sketch-label">Trigger</label>
              <select class="native-select" .value=${live(this.formGroupTrigger)} @change=${(e: Event) => (this.formGroupTrigger = (e.target as HTMLSelectElement).value as TriggerType)}>
                <option value="release" ?selected=${this.formGroupTrigger === 'release'}>On Release (default)</option>
                <option value="press" ?selected=${this.formGroupTrigger === 'press'}>On Press</option>
                <option value="hold" ?selected=${this.formGroupTrigger === 'hold'}>While Held</option>
              </select>
            </div>
          ` : ''}

          <!-- Startup-specific fields -->
          ${this.formTargetType === 'startup' ? html`
            <div class="form-field">
              <label class="sketch-label">Action</label>
              <select class="native-select" .value=${live(this.formAction)} @change=${this.handleActionChange}>
                ${this.actions.map((action) => html`<option value="${action.value}" ?selected=${action.value === this.formAction}>${action.label}</option>`)}
              </select>
            </div>

            ${this.renderParamFields()}
          ` : ''}

          <!-- Common name field -->
          <div class="form-field">
            <label class="sketch-label">Name (optional)</label>
            <input type="text" class="sketch-input" placeholder="e.g., My Action" .value=${this.formName} @input=${(e: Event) => (this.formName = (e.target as HTMLInputElement).value)}>
          </div>

          <div class="form-actions">
            <sketch-button variant="secondary" @click=${this.closeForm}>Cancel</sketch-button>
            <sketch-button variant="accent" @click=${this.saveRule}>Save</sketch-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderGroupForm() {
    const availableButtons = this.getAvailableButtons();

    return html`
      <div class="form-view">
        ${this.mode === 'all' ? html`
          <div class="form-header">
            <sketch-button variant="quiet" size="s" @click=${this.closeForm} title="Back">
              <sketch-icon slot="icon" name="arrow-left"></sketch-icon>
            </sketch-button>
            <span class="form-title">${this.getFormTitle()}</span>
          </div>
        ` : ''}
        <div class="form-body">

          <div class="form-field">
            <label class="sketch-label">Group Name</label>
            <input type="text" class="sketch-input" placeholder="e.g., Main Chords" .value=${this.formGroupName} @input=${(e: Event) => (this.formGroupName = (e.target as HTMLInputElement).value)}>
          </div>

          <div class="form-field">
            <label class="sketch-label">Buttons (click to toggle)</label>
            <div class="group-buttons">
              ${availableButtons.map((btn) => {
                const isSelected = this.formGroupButtons.includes(btn);
                return html`
                  <span class="button-chip ${isSelected ? 'selected' : ''}" @click=${() => this.toggleGroupButton(btn)} style="cursor: pointer">
                    ${this.formatButtonLabel(btn)}
                  </span>
                `;
              })}
            </div>
          </div>

          <div class="form-actions">
            <sketch-button variant="secondary" @click=${this.closeForm}>Cancel</sketch-button>
            <sketch-button variant="accent" @click=${this.saveGroup}>Save</sketch-button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const showActions = this.mode === 'all' || this.mode === 'actions';
    const showGroups = this.mode === 'all' || this.mode === 'groups';
    const showActionForm = this.formMode === 'add-action' || this.formMode === 'edit-action';
    const showGroupForm = this.formMode === 'add-group' || this.formMode === 'edit-group';

    return html`
      <div class="config-section ${this.mode !== 'all' ? 'single-panel' : ''}">
        ${this.mode === 'all' ? html`
          <div class="panels-row">
            ${showActionForm
              ? html`<div class="panel">${this.renderActionForm()}</div>`
              : this.renderActionsList()}
            ${showGroupForm
              ? html`<div class="panel">${this.renderGroupForm()}</div>`
              : this.renderGroupsList()}
          </div>
        ` : html`
          ${showActions ? (showActionForm ? this.renderActionForm() : this.renderActionsListContent()) : ''}
          ${showGroups ? (showGroupForm ? this.renderGroupForm() : this.renderGroupsListContent()) : ''}
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'action-rules-config': ActionRulesConfigComponent;
  }
}
