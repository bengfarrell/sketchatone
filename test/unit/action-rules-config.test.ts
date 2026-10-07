/**
 * Unit tests for the private helpers on ActionRulesConfigComponent:
 *   - formatButtonLabel: renders friendly labels for stylus, key:*, code:*.
 *   - getAvailableButtons: merges stylus buttons, known aux codes/keys, and
 *     any codes/keys referenced by existing rules or groups.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ActionRulesConfigComponent } from '../../src/components/action-rules-config/action-rules-config.js';
import { ActionRulesConfig, type ButtonId } from '../../src/models/action-rules.js';

// Cast helper so tests can reach the private methods without leaking `any` everywhere.
type Helpers = {
  formatButtonLabel: (id: ButtonId) => string;
  getAvailableButtons: () => ButtonId[];
};
const helpers = (c: ActionRulesConfigComponent): Helpers => c as unknown as Helpers;

describe('ActionRulesConfigComponent.formatButtonLabel', () => {
  let component: ActionRulesConfigComponent;

  beforeEach(() => {
    component = new ActionRulesConfigComponent();
  });

  it('returns friendly stylus labels for button:primary and button:secondary', () => {
    expect(helpers(component).formatButtonLabel('button:primary')).toBe('Stylus Primary');
    expect(helpers(component).formatButtonLabel('button:secondary')).toBe('Stylus Secondary');
  });

  it('formats key:<char> as "Key <UPPER>"', () => {
    expect(helpers(component).formatButtonLabel('key:a')).toBe('Key A');
    expect(helpers(component).formatButtonLabel('key:1')).toBe('Key 1');
    expect(helpers(component).formatButtonLabel('key:space')).toBe('Key SPACE');
  });

  it('falls back to the raw id for code:* when no mapping is present', () => {
    expect(helpers(component).formatButtonLabel('code:66049' as ButtonId)).toBe('code:66049');
  });

  it('prefers an explicit buttonLabels mapping over the default formatting', () => {
    component.buttonLabels = { 'key:a': 'Left Pedal', 'code:66049': 'Ring 1' };
    expect(helpers(component).formatButtonLabel('key:a')).toBe('Left Pedal');
    expect(helpers(component).formatButtonLabel('code:66049' as ButtonId)).toBe('Ring 1');
  });
});

describe('ActionRulesConfigComponent.getAvailableButtons', () => {
  let component: ActionRulesConfigComponent;

  beforeEach(() => {
    component = new ActionRulesConfigComponent();
  });

  it('includes both stylus buttons by default', () => {
    expect(helpers(component).getAvailableButtons()).toEqual(['button:primary', 'button:secondary']);
  });

  it('omits stylus buttons when the flags say the stylus lacks them', () => {
    component.hasPrimaryButton = false;
    component.hasSecondaryButton = false;
    expect(helpers(component).getAvailableButtons()).toEqual([]);
  });

  it('appends known aux codes sorted numerically after stylus buttons', () => {
    component.knownAuxCodes = new Set([66051, 66049, 66050]);
    expect(helpers(component).getAvailableButtons()).toEqual([
      'button:primary',
      'button:secondary',
      'code:66049',
      'code:66050',
      'code:66051',
    ]);
  });

  it('appends known keys sorted after aux codes', () => {
    component.knownKeys = new Set(['b', 'a', '1']);
    expect(helpers(component).getAvailableButtons()).toEqual([
      'button:primary',
      'button:secondary',
      'key:1',
      'key:a',
      'key:b',
    ]);
  });

  it('merges knownKeys with keys referenced by existing rules and groups', () => {
    component.knownKeys = new Set(['a']);
    component.config = new ActionRulesConfig({
      rules: [
        { id: 'r1', button: 'key:c' as ButtonId, action: 'none' },
        { id: 'r2', button: 'code:66050' as ButtonId, action: 'none' },
      ],
      groups: [
        { id: 'g1', name: 'Group', buttons: ['key:b' as ButtonId, 'code:66049' as ButtonId] },
      ],
    });

    const result = helpers(component).getAvailableButtons();
    expect(result).toEqual([
      'button:primary',
      'button:secondary',
      'code:66049',
      'code:66050',
      'key:a',
      'key:b',
      'key:c',
    ]);
  });

  it('ignores empty key ids referenced in rules', () => {
    component.config = new ActionRulesConfig({
      rules: [{ id: 'r1', button: 'key:' as ButtonId, action: 'none' }],
      groups: [],
    });
    expect(helpers(component).getAvailableButtons()).toEqual(['button:primary', 'button:secondary']);
  });

  it('deduplicates keys shared between knownKeys and rules', () => {
    component.knownKeys = new Set(['a']);
    component.config = new ActionRulesConfig({
      rules: [{ id: 'r1', button: 'key:a' as ButtonId, action: 'none' }],
      groups: [],
    });
    const result = helpers(component).getAvailableButtons();
    expect(result.filter((b) => b === 'key:a')).toHaveLength(1);
  });
});
