import { html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styles } from './tablet-buttons-config.styles.js';
import {
  type TabletButtonAction,
  TabletButtonsConfig,
  CHORD_PROGRESSION_PRESETS,
  getChordProgressionPresetNames,
} from '../../models/strummer-features.js';

import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/number-field/sp-number-field.js';
import '@spectrum-web-components/field-label/sp-field-label.js';
import '@spectrum-web-components/textfield/sp-textfield.js';
import '@spectrum-web-components/switch/sp-switch.js';

/**
 * Action definition with parameter requirements
 */
interface ActionDef {
  value: string;
  label: string;
  params?: Array<{
    key: string;
    label: string;
    type: 'number' | 'text';
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: unknown;
  }>;
}

interface ButtonState {
  actionName: string;
  params: unknown[];
}

/**
 * Tablet buttons configuration component.
 * Supports two modes:
 * 1. Chord progression mode - buttons map to chords in a progression
 * 2. Individual button mode - each button has its own action
 */
@customElement('tablet-buttons-config')
export class TabletButtonsConfigComponent extends LitElement {
  static styles = styles;

  @property({ type: Object })
  config?: TabletButtonsConfig;

  @property({ type: Object })
  pressedButtons: Set<number> = new Set();

  @state()
  private useChordProgressionMode: boolean = true;

  @state()
  private selectedProgression: string = 'c-major-pop';

  @state()
  private selectedOctave: number = 4;

  @state()
  private buttonStates: Record<string, ButtonState> = {
    '1': { actionName: 'none', params: [] },
    '2': { actionName: 'none', params: [] },
    '3': { actionName: 'none', params: [] },
    '4': { actionName: 'none', params: [] },
    '5': { actionName: 'none', params: [] },
    '6': { actionName: 'none', params: [] },
    '7': { actionName: 'none', params: [] },
    '8': { actionName: 'none', params: [] },
  };

  // Available actions with their parameter definitions
  private readonly actions: ActionDef[] = [
    { value: 'none', label: 'None' },
    { value: 'toggle-repeater', label: 'Toggle Note Repeater' },
    { value: 'toggle-transpose', label: 'Toggle Transpose' },
    {
      value: 'transpose',
      label: 'Transpose',
      params: [
        {
          key: 'semitones',
          label: 'Semitones',
          type: 'number',
          min: -24,
          max: 24,
          step: 1,
          defaultValue: 12,
        },
      ],
    },
    {
      value: 'set-strum-chord',
      label: 'Set Strum Chord',
      params: [
        {
          key: 'chord',
          label: 'Chord',
          type: 'text',
          defaultValue: 'C',
        },
        {
          key: 'octave',
          label: 'Octave',
          type: 'number',
          min: 0,
          max: 8,
          step: 1,
          defaultValue: 4,
        },
      ],
    },
    {
      value: 'set-chord-in-progression',
      label: 'Set Chord in Progression',
      params: [
        {
          key: 'progression',
          label: 'Progression',
          type: 'text',
          defaultValue: 'c-major-pop',
        },
        {
          key: 'index',
          label: 'Index',
          type: 'number',
          min: 0,
          max: 20,
          step: 1,
          defaultValue: 0,
        },
        {
          key: 'octave',
          label: 'Octave',
          type: 'number',
          min: 0,
          max: 8,
          step: 1,
          defaultValue: 4,
        },
      ],
    },
    {
      value: 'increment-chord-in-progression',
      label: 'Increment Chord Progression',
      params: [
        {
          key: 'progression',
          label: 'Progression',
          type: 'text',
          defaultValue: 'c-major-pop',
        },
        {
          key: 'increment',
          label: 'Increment',
          type: 'number',
          min: -10,
          max: 10,
          step: 1,
          defaultValue: 1,
        },
        {
          key: 'octave',
          label: 'Octave',
          type: 'number',
          min: 0,
          max: 8,
          step: 1,
          defaultValue: 4,
        },
      ],
    },
  ];

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.has('config') && this.config) {
      // Sync state from config
      this.useChordProgressionMode = this.config.mode === 'progression';
      this.selectedProgression = this.config.preset;
      this.selectedOctave = this.config.octave;

      // Parse individual button actions if in individual mode
      if (this.config.mode === 'individual') {
        for (let i = 1; i <= 8; i++) {
          const buttonKey = String(i);
          const action = this.config.buttonActions[buttonKey as keyof typeof this.config.buttonActions];
          this.parseActionFromConfig(action, buttonKey);
        }
      }
    }
  }

  /**
   * Parse an action definition into action name and params
   */
  private parseActionFromConfig(action: TabletButtonAction | undefined, buttonNumber: string) {
    let actionName = 'none';
    let params: unknown[] = [];

    if (typeof action === 'string') {
      actionName = action;
    } else if (Array.isArray(action) && action.length > 0) {
      actionName = action[0] as string;
      params = action.slice(1);
    }

    this.buttonStates = {
      ...this.buttonStates,
      [buttonNumber]: { actionName, params },
    };
  }

  /**
   * Build action definition from action name and params
   */
  private buildActionDefinition(actionName: string, params: unknown[]): TabletButtonAction {
    if (actionName === 'none' || !actionName) {
      return null;
    }

    // If no params needed or provided, return just the string
    const actionDef = this.actions.find((a) => a.value === actionName);
    if (!actionDef?.params || actionDef.params.length === 0) {
      return actionName;
    }

    // If params exist, return array format
    if (params.length > 0) {
      return [actionName, ...params] as [string, ...unknown[]];
    }

    // Use default params
    const defaultParams = actionDef.params.map((p) => p.defaultValue);
    return [actionName, ...defaultParams] as [string, ...unknown[]];
  }

  private handleActionChange(buttonNumber: string, e: Event) {
    const picker = e.target as HTMLSelectElement;
    const actionName = picker.value;

    // Get action definition
    const actionDef = this.actions.find((a) => a.value === actionName);

    // Initialize with default params if action has parameters
    let params: unknown[] = [];
    if (actionDef?.params) {
      params = actionDef.params.map((p) => p.defaultValue);
    }

    this.buttonStates = {
      ...this.buttonStates,
      [buttonNumber]: { actionName, params },
    };

    // Emit change event
    this.emitButtonChange(buttonNumber, this.buildActionDefinition(actionName, params));
  }

  private handleParamChange(buttonNumber: string, paramIndex: number, value: unknown) {
    const state = this.buttonStates[buttonNumber];
    const newParams = [...state.params];
    newParams[paramIndex] = value;

    this.buttonStates = {
      ...this.buttonStates,
      [buttonNumber]: { ...state, params: newParams },
    };

    // Emit change event
    this.emitButtonChange(buttonNumber, this.buildActionDefinition(state.actionName, newParams));
  }

  private emitButtonChange(buttonNumber: string, action: TabletButtonAction) {
    // Build the full config update
    const buttonActions = { ...this.config?.buttonActions };
    buttonActions[buttonNumber as keyof typeof buttonActions] = action;

    this.dispatchEvent(
      new CustomEvent('config-change', {
        detail: {
          'tablet_buttons.mode': 'individual',
          'tablet_buttons.button_actions': buttonActions,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleModeToggle(e: Event) {
    const switchEl = e.target as HTMLInputElement;
    this.useChordProgressionMode = switchEl.checked;

    // Emit the appropriate config
    if (this.useChordProgressionMode) {
      // Switch to chord progression mode
      this.dispatchEvent(
        new CustomEvent('config-change', {
          detail: {
            'tablet_buttons.mode': 'progression',
            'tablet_buttons.preset': this.selectedProgression,
            'tablet_buttons.octave': this.selectedOctave,
          },
          bubbles: true,
          composed: true,
        })
      );
    } else {
      // Switch to individual button mode
      const buttonActions: Record<string, TabletButtonAction> = {};
      for (let i = 1; i <= 8; i++) {
        const key = String(i);
        const state = this.buttonStates[key];
        buttonActions[key] = this.buildActionDefinition(state.actionName, state.params);
      }
      this.dispatchEvent(
        new CustomEvent('config-change', {
          detail: {
            'tablet_buttons.mode': 'individual',
            'tablet_buttons.button_actions': buttonActions,
          },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private handleProgressionChange(e: Event) {
    const picker = e.target as HTMLSelectElement;
    this.selectedProgression = picker.value;

    // Emit change
    this.dispatchEvent(
      new CustomEvent('config-change', {
        detail: {
          'tablet_buttons.preset': this.selectedProgression,
          'tablet_buttons.chords': CHORD_PROGRESSION_PRESETS[this.selectedProgression] || [],
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleOctaveChange(e: Event) {
    const field = e.target as HTMLInputElement;
    this.selectedOctave = parseInt(field.value, 10);

    // Emit change
    this.dispatchEvent(
      new CustomEvent('config-change', {
        detail: {
          'tablet_buttons.octave': this.selectedOctave,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderParamControls(buttonNumber: string) {
    const state = this.buttonStates[buttonNumber];
    if (!state) return html``;

    const actionDef = this.actions.find((a) => a.value === state.actionName);
    if (!actionDef?.params || actionDef.params.length === 0) {
      return html``;
    }

    return html`
      <div class="param-controls">
        ${actionDef.params.map((paramDef, index) => {
          const value = state.params[index] ?? paramDef.defaultValue;

          if (paramDef.type === 'number') {
            return html`
              <div class="param-field">
                <sp-field-label data-spectrum-pattern="field-label-s" size="s">${paramDef.label}</sp-field-label>
                <sp-number-field
                  data-spectrum-pattern="number-field-s"
                  size="s"
                  .value="${value}"
                  min="${paramDef.min ?? ''}"
                  max="${paramDef.max ?? ''}"
                  step="${paramDef.step ?? 1}"
                  @change="${(ev: Event) => {
                    const field = ev.target as HTMLInputElement;
                    const val = parseFloat(field.value);
                    this.handleParamChange(buttonNumber, index, val);
                  }}"
                >
                </sp-number-field>
              </div>
            `;
          } else if (paramDef.type === 'text') {
            return html`
              <div class="param-field">
                <sp-field-label data-spectrum-pattern="field-label-s" size="s">${paramDef.label}</sp-field-label>
                <sp-textfield
                  data-spectrum-pattern="textfield-s"
                  size="s"
                  .value="${value}"
                  @change="${(ev: Event) => {
                    const field = ev.target as HTMLInputElement;
                    const val = field.value;
                    this.handleParamChange(buttonNumber, index, val);
                  }}"
                >
                </sp-textfield>
              </div>
            `;
          }
          return html``;
        })}
      </div>
    `;
  }

  private renderButton(buttonNumber: string) {
    const state = this.buttonStates[buttonNumber];
    if (!state) return html``;

    const isPressed = this.pressedButtons.has(parseInt(buttonNumber, 10));
    const buttonStyle = isPressed ? 'border-color: var(--spectrum-global-color-blue-500);' : '';

    return html`
      <div class="button-config" style="${buttonStyle}">
        <div class="button-label">Button ${buttonNumber}</div>
        <sp-picker
          data-spectrum-pattern="picker-s"
          size="s"
          .value="${state.actionName}"
          @change="${(e: Event) => this.handleActionChange(buttonNumber, e)}"
        >
          ${this.actions.map(
            (action) => html` <sp-menu-item data-spectrum-pattern="menu-item" value="${action.value}">${action.label}</sp-menu-item> `
          )}
        </sp-picker>
        ${this.renderParamControls(buttonNumber)}
      </div>
    `;
  }

  private renderChordProgressionMode() {
    const progressionNames = getChordProgressionPresetNames();
    const chords = CHORD_PROGRESSION_PRESETS[this.selectedProgression] || [];

    return html`
      <div class="chord-progression-config">
        <sp-field-label data-spectrum-pattern="field-label-m" size="m">Chord Progression</sp-field-label>
        <sp-picker data-spectrum-pattern="picker-m" size="m" .value="${this.selectedProgression}" @change="${this.handleProgressionChange}">
          ${progressionNames.map((name) => html` <sp-menu-item data-spectrum-pattern="menu-item" value="${name}">${name}</sp-menu-item> `)}
        </sp-picker>

        <sp-field-label data-spectrum-pattern="field-label-m" size="m">Octave</sp-field-label>
        <sp-number-field
          data-spectrum-pattern="number-field-m"
          size="m"
          .value="${this.selectedOctave}"
          min="0"
          max="8"
          step="1"
          @change="${this.handleOctaveChange}"
        >
        </sp-number-field>

        <div class="chord-preview">
          ${chords.map((chord, index) => {
            const buttonNum = index + 1;
            const isPressed = this.pressedButtons.has(buttonNum);
            const chipStyle = isPressed ? 'background: var(--spectrum-global-color-blue-500);' : '';
            return html`<span class="chord-chip" style="${chipStyle}">${buttonNum}: ${chord}</span>`;
          })}
        </div>

        <p class="helper-text">
          In chord progression mode, each button will set the strum chord to the corresponding chord in the
          progression. Buttons 1-${chords.length} map to the chords shown above.
        </p>
      </div>
    `;
  }

  private renderIndividualButtonMode() {
    return html`
      <div class="button-grid">${['1', '2', '3', '4', '5', '6', '7', '8'].map((num) => this.renderButton(num))}</div>
    `;
  }

  render() {
    return html`
      <div class="config-section">
        <div class="mode-toggle">
          <sp-field-label data-spectrum-pattern="field-label-m" size="m">Chord Progression Mode</sp-field-label>
          <sp-switch data-spectrum-pattern="switch" ?checked="${this.useChordProgressionMode}" @change="${this.handleModeToggle}">
            ${this.useChordProgressionMode ? 'On' : 'Off'}
          </sp-switch>
        </div>

        ${this.useChordProgressionMode ? this.renderChordProgressionMode() : this.renderIndividualButtonMode()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tablet-buttons-config': TabletButtonsConfigComponent;
  }
}
