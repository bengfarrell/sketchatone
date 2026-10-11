import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigJsonEditor } from '../../src/components/config-json-editor/config-json-editor.js';
import { MidiStrummerConfig } from '../../src/models/midi-strummer-config.js';
import { configValidationTemplate } from '../../src/utils/config-validation.js';

afterEach(() => document.body.replaceChildren());

async function editor() {
  const element = new ConfigJsonEditor();
  element.config = JSON.parse(JSON.stringify(new MidiStrummerConfig().toDict()));
  element.template = configValidationTemplate(element.config!);
  element.configName = 'current.json';
  element.connected = true;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

async function edit(element: ConfigJsonEditor, text: string) {
  const textarea = element.shadowRoot!.querySelector('textarea')!;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  await element.updateComplete;
}

describe('JSON config editor', () => {
  it('validates syntax and structure on input without sending mutations', async () => {
    const element = await editor();
    const sent: unknown[] = [];
    element.addEventListener('apply-config', e => sent.push(e));
    for (const draft of ['{', '[]', '{"strummer": {"mode": "invalid"}, "midi": {}, "server": {}}']) {
      await edit(element, draft);
      expect(element.shadowRoot!.querySelector('[role=alert]')).not.toBeNull();
      expect(element.shadowRoot!.querySelector('sketch-button')!.hasAttribute('disabled')).toBe(true);
    }
    expect(sent).toEqual([]);
  });

  it('preserves draft on broadcasts and blocks stale file/config applies', async () => {
    const element = await editor();
    const draft = JSON.stringify({ ...element.config, keyboard: { enabled: false } });
    await edit(element, draft);
    element.config = structuredClone(element.config);
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('textarea')!.value).toBe(draft);
    expect(element.shadowRoot!.querySelector('[role=alert]')).toBeNull();
    element.configName = 'other.json';
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('textarea')!.value).toBe(draft);
    expect(element.shadowRoot!.querySelector('sketch-button')!.hasAttribute('disabled')).toBe(true);
    element.shadowRoot!.querySelectorAll('sketch-button')[1].click();
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('[role=alert]')).toBeNull();
  });

  it('sends a complete replacement and displays correlated failure/success', async () => {
    const element = await editor();
    const config = { ...element.config, keyboard: { enabled: false } };
    let request: any;
    element.addEventListener('apply-config', e => { request = (e as CustomEvent).detail; });
    await edit(element, JSON.stringify(config));
    element.shadowRoot!.querySelector('sketch-button')!.click();
    await element.updateComplete;
    expect(request.config).toEqual(config);
    expect(request.configName).toBe('current.json');
    element.result = { requestId: request.requestId, success: false, error: 'Disk write failed' };
    await element.updateComplete;
    expect(element.shadowRoot!.textContent).toContain('Disk write failed');
    expect(element.shadowRoot!.querySelector('textarea')!.value).toBe(JSON.stringify(config));
    element.shadowRoot!.querySelector('sketch-button')!.click();
    await element.updateComplete;
    element.config = config;
    element.result = { requestId: request.requestId, success: true, message: 'Applied and saved' };
    await element.updateComplete;
    expect(element.shadowRoot!.textContent).toContain('Applied and saved');
    expect(element.shadowRoot!.querySelector('sketch-button')!.hasAttribute('disabled')).toBe(true);
  });

  it('preserves draft and reports unknown outcomes on acknowledgement timeout', async () => {
    vi.useFakeTimers();
    try {
      const element = await editor();
      const draft = JSON.stringify({ ...element.config, keyboard: { enabled: false } });
      await edit(element, draft);
      element.shadowRoot!.querySelector('sketch-button')!.click();
      await element.updateComplete;
      vi.advanceTimersByTime(15000);
      await element.updateComplete;
      expect(element.shadowRoot!.textContent).toContain('Apply outcome unknown');
      expect(element.shadowRoot!.querySelector('textarea')!.value).toBe(draft);
      element.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
