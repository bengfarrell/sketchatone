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

import { LitElement, html, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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
  getButtonLabel,
  generateRuleId,
} from '../../models/action-rules.js';
import { ActionDefinition } from '../../core/actions.js';
import { CHORD_PROGRESSION_PRESETS, getChordProgressionPresetNames } from '../../models/strummer-features.js';

// Import Spectrum components
import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/number-field/sp-number-field.js';
import '@spectrum-web-components/field-label/sp-field-label.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-add.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-delete.js';
import '@spectrum-web-components/icons-workflow/icons/sp-icon-edit.js';

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
  static styles = styles;

  @property({ type: Object })
  config?: ActionRulesConfig;

  /** Set of currently pressed button IDs for visual feedback */
  @property({ type: Object })
  pressedButtons: Set<ButtonId> = new Set();

  /** Number of tablet buttons available */
  @property({ type: Number })
  buttonCount: number = 8;

  /** Whether stylus has primary button */
  @property({ type: Boolean })
  hasPrimaryButton: boolean = true;

  /** Whether stylus has secondary button */
  @property({ type: Boolean })
  hasSecondaryButton: boolean = true;

  @state()
  private formMode: FormMode = 'none';

  @state()
  private editingId: string | null = null;

  @state()
  private detecting: boolean = false;

  // Unified action form state
  @state()
  private formTargetType: ActionTargetType = 'button';

  @state()
  private formButton: ButtonId = 'button:1';

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

  // Form state for groups (just name and buttons)
  @state()
  private formGroupName: string = '';

  @state()
  private formGroupButtons: ButtonId[] = [];

  // Available actions
  private readonly actions: ActionDef[] = [
    { value: 'none', label: 'None' },
    { value: 'toggle-repeater', label: 'Toggle Note Repeater' },
    { value: 'toggle-transpose', label: 'Toggle Transpose' },
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
      value: 'set-group-progression',
      label: 'Set Group Progression',
      params: [
        { key: 'groupId', label: 'Group ID', type: 'text', defaultValue: '' },
        {
          key: 'progression',
          label: 'Progression',
          type: 'select',
          defaultValue: 'c-major-pop',
          options: getChordProgressionPresetNames().map((n) => ({ value: n, label: n })),
        },
      ],
    },
  ];

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    // Handle button detection
    if (changedProperties.has('pressedButtons') && this.detecting) {
      const pressed = Array.from(this.pressedButtons);
      if (pressed.length > 0) {
        this.formButton = pressed[0];
        this.detecting = false;
      }
    }
  }

  private getAvailableButtons(): ButtonId[] {
    const buttons: ButtonId[] = [];
    if (this.hasPrimaryButton) buttons.push('button:primary');
    if (this.hasSecondaryButton) buttons.push('button:secondary');
    for (let i = 1; i <= this.buttonCount; i++) {
      buttons.push(`button:${i}` as ButtonId);
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
    if (params.length === 0) return actionName;
    return [actionName, ...params] as [string, ...unknown[]];
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
    this.formButton = 'button:1';
    this.formGroupId = this.config?.groups[0]?.id ?? '';
    this.formAction = 'none';
    this.formTrigger = 'release';
    this.formName = '';
    this.formParams = [];
    // Group action defaults
    this.formGroupActionType = 'chord-progression';
    this.formGroupProgression = 'c-major-pop';
    this.formGroupOctave = 4;
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
      this.formParams = rule.action.slice(1);
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
      this.formParams = rule.action.slice(1);
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

  private closeForm() {
    this.formMode = 'none';
    this.editingId = null;
    this.detecting = false;
  }

  private startDetecting() {
    this.detecting = true;
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
      });
    } else if (this.formMode === 'edit-action' && this.editingId) {
      this.config.updateGroupRule(this.editingId, {
        groupId: this.formGroupId,
        name: this.formName || undefined,
        action: groupAction,
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

  // Render methods
  private renderActionsList() {
    const rules = this.config?.rules ?? [];
    const groupRules = this.config?.groupRules ?? [];
    const startupRules = this.config?.startupRules ?? [];
    const groups = this.config?.groups ?? [];

    const hasAnyActions = rules.length > 0 || groupRules.length > 0 || startupRules.length > 0;

    return html`
      <div class="panel">
        <div class="section-header">
          <span class="section-title">Actions</span>
          <sp-action-button size="s" quiet @click=${() => this.openAddActionForm()}>
            <sp-icon-add slot="icon"></sp-icon-add>
            Add Action
          </sp-action-button>
        </div>
        <div class="rules-list">
          ${!hasAnyActions
            ? html`<div class="empty-state">No actions configured</div>`
            : html`
                ${rules.map(
                  (rule) => html`
                    <div class="rule-item">
                      <span class="rule-type-badge button">Button</span>
                      <span class="rule-button-id">${getButtonLabel(rule.button, this.config?.buttonNames)}</span>
                      <span class="rule-arrow">→</span>
                      <span class="rule-action">${this.formatAction(rule.action)}</span>
                      <span class="rule-trigger">${rule.trigger ?? 'release'}</span>
                      ${rule.name ? html`<span class="rule-name">${rule.name}</span>` : ''}
                      <div class="rule-actions">
                        <sp-action-button size="s" quiet @click=${() => this.openEditButtonRuleForm(rule)}>
                          <sp-icon-edit slot="icon"></sp-icon-edit>
                        </sp-action-button>
                        <sp-action-button size="s" quiet @click=${() => this.deleteRule(rule.id)}>
                          <sp-icon-delete slot="icon"></sp-icon-delete>
                        </sp-action-button>
                      </div>
                    </div>
                  `
                )}
                ${groupRules.map((rule) => {
                  const group = groups.find((g) => g.id === rule.groupId);
                  return html`
                    <div class="rule-item">
                      <span class="rule-type-badge group">Group</span>
                      <span class="rule-button-id">${group?.name ?? 'Unknown Group'}</span>
                      <span class="rule-arrow">→</span>
                      <span class="rule-action">${rule.action.type}: ${rule.action.progression} (Oct ${rule.action.octave})</span>
                      ${rule.name ? html`<span class="rule-name">${rule.name}</span>` : ''}
                      <div class="rule-actions">
                        <sp-action-button size="s" quiet @click=${() => this.openEditGroupRuleForm(rule)}>
                          <sp-icon-edit slot="icon"></sp-icon-edit>
                        </sp-action-button>
                        <sp-action-button size="s" quiet @click=${() => this.deleteGroupRule(rule.id)}>
                          <sp-icon-delete slot="icon"></sp-icon-delete>
                        </sp-action-button>
                      </div>
                    </div>
                  `;
                })}
                ${startupRules.map(
                  (rule) => html`
                    <div class="rule-item">
                      <span class="rule-type-badge startup">Startup</span>
                      <span class="startup-icon">⚡</span>
                      <span class="rule-action">${rule.name}: ${this.formatAction(rule.action)}</span>
                      <div class="rule-actions">
                        <sp-action-button size="s" quiet @click=${() => this.openEditStartupRuleForm(rule)}>
                          <sp-icon-edit slot="icon"></sp-icon-edit>
                        </sp-action-button>
                        <sp-action-button size="s" quiet @click=${() => this.deleteStartupRule(rule.id)}>
                          <sp-icon-delete slot="icon"></sp-icon-delete>
                        </sp-action-button>
                      </div>
                    </div>
                  `
                )}
              `}
        </div>
      </div>
    `;
  }

  private renderGroupsList() {
    const groups = this.config?.groups ?? [];

    return html`
      <div class="panel">
        <div class="section-header">
          <span class="section-title">Button Groups</span>
          <sp-action-button size="s" quiet @click=${this.openAddGroupForm}>
            <sp-icon-add slot="icon"></sp-icon-add>
            Add Group
          </sp-action-button>
        </div>
        <div class="rules-list">
          ${groups.length === 0
            ? html`<div class="empty-state">No button groups configured</div>`
            : groups.map(
                (group) => html`
                  <div class="group-item">
                    <div class="group-header">
                      <span class="group-name">${group.name}</span>
                      <div class="rule-actions">
                        <sp-action-button size="s" quiet @click=${() => this.openEditGroupForm(group)}>
                          <sp-icon-edit slot="icon"></sp-icon-edit>
                        </sp-action-button>
                        <sp-action-button size="s" quiet @click=${() => this.deleteGroup(group.id)}>
                          <sp-icon-delete slot="icon"></sp-icon-delete>
                        </sp-action-button>
                      </div>
                    </div>
                    <div class="group-buttons">
                      ${group.buttons.map((btn) => {
                        const isPressed = this.pressedButtons.has(btn);
                        return html`<span class="button-chip ${isPressed ? 'pressed' : ''}"
                          >${getButtonLabel(btn, this.config?.buttonNames)}</span
                        >`;
                      })}
                    </div>
                  </div>
                `
              )}
        </div>
      </div>
    `;
  }

  private renderParamFields() {
    const actionDef = this.actions.find((a) => a.value === this.formAction);
    if (!actionDef?.params) return '';

    return actionDef.params.map((param, index) => {
      const value = this.formParams[index] ?? param.defaultValue;

      if (param.type === 'select' && param.options) {
        return html`
          <div class="form-field">
            <sp-field-label>${param.label}</sp-field-label>
            <sp-picker value="${value}" @change=${(e: Event) => this.handleParamChange(index, (e.target as HTMLSelectElement).value)}>
              ${param.options.map((opt) => html`<sp-menu-item value="${opt.value}">${opt.label}</sp-menu-item>`)}
            </sp-picker>
          </div>
        `;
      }

      if (param.type === 'number') {
        return html`
          <div class="form-field">
            <sp-field-label>${param.label}</sp-field-label>
            <sp-number-field
              value="${value}"
              min="${param.min}"
              max="${param.max}"
              step="${param.step}"
              @change=${(e: Event) => this.handleParamChange(index, Number((e.target as HTMLInputElement).value))}
            ></sp-number-field>
          </div>
        `;
      }

      return html`
        <div class="form-field">
          <sp-field-label>${param.label}</sp-field-label>
          <sp-textfield value="${value}" @change=${(e: Event) => this.handleParamChange(index, (e.target as HTMLInputElement).value)}></sp-textfield>
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
  }

  private renderActionForm() {
    const isEdit = this.formMode === 'edit-action';
    const availableButtons = this.getAvailableButtons();
    const groups = this.config?.groups ?? [];
    const progressionNames = getChordProgressionPresetNames();

    // Determine title based on target type and mode
    const getTitle = () => {
      if (isEdit) {
        switch (this.formTargetType) {
          case 'button': return 'Edit Button Action';
          case 'group': return 'Edit Group Action';
          case 'startup': return 'Edit Startup Action';
        }
      }
      return 'Add Action';
    };

    return html`
      <div class="form-overlay" @click=${(e: Event) => e.target === e.currentTarget && this.closeForm()}>
        <div class="form-dialog">
          <div class="form-title">${getTitle()}</div>

          <!-- Target Type Selector (only show when adding, not editing) -->
          ${!isEdit ? html`
            <div class="form-field">
              <sp-field-label>Target Type</sp-field-label>
              <sp-picker value="${this.formTargetType}" @change=${this.handleTargetTypeChange}>
                <sp-menu-item value="button">Button</sp-menu-item>
                <sp-menu-item value="group" ?disabled=${groups.length === 0}>Group${groups.length === 0 ? ' (create a group first)' : ''}</sp-menu-item>
                <sp-menu-item value="startup">Startup</sp-menu-item>
              </sp-picker>
            </div>
          ` : ''}

          <!-- Button-specific fields -->
          ${this.formTargetType === 'button' ? html`
            <div class="form-field">
              <sp-field-label>Button</sp-field-label>
              <div class="form-row">
                <sp-picker value="${this.formButton}" @change=${(e: Event) => (this.formButton = (e.target as HTMLSelectElement).value as ButtonId)}>
                  ${availableButtons.map((btn) => html`<sp-menu-item value="${btn}">${getButtonLabel(btn, this.config?.buttonNames)}</sp-menu-item>`)}
                </sp-picker>
                <sp-button size="s" variant="secondary" class="${this.detecting ? 'detecting' : ''}" @click=${this.startDetecting}>
                  ${this.detecting ? 'Press a button...' : 'Detect'}
                </sp-button>
              </div>
            </div>

            <div class="form-field">
              <sp-field-label>Action</sp-field-label>
              <sp-picker value="${this.formAction}" @change=${this.handleActionChange}>
                ${this.actions.map((action) => html`<sp-menu-item value="${action.value}">${action.label}</sp-menu-item>`)}
              </sp-picker>
            </div>

            ${this.renderParamFields()}

            <div class="form-field">
              <sp-field-label>Trigger</sp-field-label>
              <sp-picker value="${this.formTrigger}" @change=${(e: Event) => (this.formTrigger = (e.target as HTMLSelectElement).value as TriggerType)}>
                <sp-menu-item value="release">On Release (default)</sp-menu-item>
                <sp-menu-item value="press">On Press</sp-menu-item>
                <sp-menu-item value="hold">While Held</sp-menu-item>
              </sp-picker>
            </div>
          ` : ''}

          <!-- Group-specific fields -->
          ${this.formTargetType === 'group' ? html`
            <div class="form-field">
              <sp-field-label>Group</sp-field-label>
              <sp-picker value="${this.formGroupId}" @change=${(e: Event) => (this.formGroupId = (e.target as HTMLSelectElement).value)}>
                ${groups.map((group) => html`<sp-menu-item value="${group.id}">${group.name}</sp-menu-item>`)}
              </sp-picker>
            </div>

            <div class="form-field">
              <sp-field-label>Action Type</sp-field-label>
              <sp-picker value="${this.formGroupActionType}" @change=${(e: Event) => (this.formGroupActionType = (e.target as HTMLSelectElement).value as GroupActionType)}>
                <sp-menu-item value="chord-progression">Chord Progression</sp-menu-item>
              </sp-picker>
            </div>

            <div class="form-field">
              <sp-field-label>Chord Progression</sp-field-label>
              <sp-picker value="${this.formGroupProgression}" @change=${(e: Event) => (this.formGroupProgression = (e.target as HTMLSelectElement).value)}>
                ${progressionNames.map((name) => html`<sp-menu-item value="${name}">${name}</sp-menu-item>`)}
              </sp-picker>
            </div>

            <div class="form-field">
              <sp-field-label>Octave</sp-field-label>
              <sp-number-field value="${this.formGroupOctave}" min="0" max="8" step="1" @change=${(e: Event) => (this.formGroupOctave = Number((e.target as HTMLInputElement).value))}></sp-number-field>
            </div>
          ` : ''}

          <!-- Startup-specific fields -->
          ${this.formTargetType === 'startup' ? html`
            <div class="form-field">
              <sp-field-label>Action</sp-field-label>
              <sp-picker value="${this.formAction}" @change=${this.handleActionChange}>
                ${this.actions.map((action) => html`<sp-menu-item value="${action.value}">${action.label}</sp-menu-item>`)}
              </sp-picker>
            </div>

            ${this.renderParamFields()}
          ` : ''}

          <!-- Common name field -->
          <div class="form-field">
            <sp-field-label>Name (optional)</sp-field-label>
            <sp-textfield placeholder="e.g., My Action" value="${this.formName}" @input=${(e: Event) => (this.formName = (e.target as HTMLInputElement).value)}></sp-textfield>
          </div>

          <div class="form-actions">
            <sp-button variant="secondary" @click=${this.closeForm}>Cancel</sp-button>
            <sp-button variant="accent" @click=${this.saveRule}>Save</sp-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderGroupForm() {
    const isEdit = this.formMode === 'edit-group';
    const availableButtons = this.getAvailableButtons();

    return html`
      <div class="form-overlay" @click=${(e: Event) => e.target === e.currentTarget && this.closeForm()}>
        <div class="form-dialog">
          <div class="form-title">${isEdit ? 'Edit Group' : 'Add Group'}</div>

          <div class="form-field">
            <sp-field-label>Group Name</sp-field-label>
            <sp-textfield placeholder="e.g., Main Chords" value="${this.formGroupName}" @input=${(e: Event) => (this.formGroupName = (e.target as HTMLInputElement).value)}></sp-textfield>
          </div>

          <div class="form-field">
            <sp-field-label>Buttons (click to toggle)</sp-field-label>
            <div class="group-buttons">
              ${availableButtons.map((btn) => {
                const isSelected = this.formGroupButtons.includes(btn);
                return html`
                  <span class="button-chip ${isSelected ? 'pressed' : ''}" @click=${() => this.toggleGroupButton(btn)} style="cursor: pointer">
                    ${getButtonLabel(btn, this.config?.buttonNames)}
                  </span>
                `;
              })}
            </div>
          </div>

          <div class="form-actions">
            <sp-button variant="secondary" @click=${this.closeForm}>Cancel</sp-button>
            <sp-button variant="accent" @click=${this.saveGroup}>Save</sp-button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="config-section">
        ${this.renderActionsList()} ${this.renderGroupsList()}
        ${this.formMode === 'add-action' || this.formMode === 'edit-action' ? this.renderActionForm() : ''}
        ${this.formMode === 'add-group' || this.formMode === 'edit-group' ? this.renderGroupForm() : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'action-rules-config': ActionRulesConfigComponent;
  }
}
