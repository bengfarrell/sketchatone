import { afterEach, describe, expect, it, vi } from 'vitest';
import { SketchatoneDashboard } from '../../src/components/sketchatone-dashboard/sketchatone-dashboard.js';
import { ConfigJsonEditor } from '../../src/components/config-json-editor/config-json-editor.js';
import { MidiStrummerConfig } from '../../src/models/midi-strummer-config.js';
import { configValidationTemplate } from '../../src/utils/config-validation.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

async function dashboard() {
  const element = new SketchatoneDashboard();
  const client = (element as any).client;
  vi.spyOn(client, 'requestMidiDevices').mockImplementation(() => {});
  document.body.append(element);
  const config = JSON.parse(JSON.stringify(new MidiStrummerConfig().toDict()));
  client.emit('connection-state', 'connected');
  client.emit('config', {
    config, configValidationTemplate: configValidationTemplate(config),
    currentConfigName: 'current.json', availableConfigs: ['current.json', 'existing.json'], notes: [],
  });
  await element.updateComplete;
  return { element, client, config };
}

async function open(element: SketchatoneDashboard) {
  element.shadowRoot!.querySelector<HTMLElement>('[title="Edit Config"]')!.click();
  await element.updateComplete;
  const editor = element.shadowRoot!.querySelector<ConfigJsonEditor>('config-json-editor')!;
  await editor.updateComplete;
  return editor;
}

async function edit(editor: ConfigJsonEditor, draft: string) {
  const textarea = editor.shadowRoot!.querySelector('textarea')!;
  textarea.value = draft;
  textarea.dispatchEvent(new Event('input'));
  await editor.updateComplete;
}

function filename(element: SketchatoneDashboard, name: string) {
  const input = element.shadowRoot!.querySelector<HTMLInputElement>('#config-editor-filename')!;
  input.value = name;
  input.dispatchEvent(new Event('input'));
}

function click(element: SketchatoneDashboard, selector: string) {
  element.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
}

describe('dashboard full-page configuration editor', () => {
  it('opens from the pencil, replaces toolbar and panels, and returns to the dashboard', async () => {
    const { element } = await dashboard();
    const editor = await open(element);
    expect(element.shadowRoot!.querySelector('.dashboard-header')).toBeNull();
    expect(element.shadowRoot!.querySelector('dashboard-panel')).toBeNull();
    expect(editor.shadowRoot!.querySelector('details')).toBeNull();
    expect(element.shadowRoot!.querySelector('label')!.getAttribute('for')).toBe('config-editor-filename');
    click(element, '#config-editor-back');
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('.dashboard-header')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('[title="New Config"]')).not.toBeNull();
    expect(element.shadowRoot!.textContent).toContain('Import');
    expect(element.shadowRoot!.textContent).toContain('Export');
  });

  it('confirms discarding JSON and filename drafts, preserving them when cancelled', async () => {
    const { element } = await dashboard();
    const editor = await open(element);
    await edit(editor, '{');
    filename(element, 'unsaved');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    click(element, '#config-editor-back');
    await element.updateComplete;
    expect(editor.shadowRoot!.querySelector('textarea')!.value).toBe('{');
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true);
    click(element, '#config-editor-back');
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('config-json-editor')).toBeNull();
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });

  it('renames through the existing API without losing a JSON draft, then applies to the new file', async () => {
    const { element, client, config } = await dashboard();
    const rename = vi.spyOn(client, 'renameConfig').mockImplementation(() => {});
    const apply = vi.spyOn(client, 'applyConfig').mockImplementation(() => {});
    const editor = await open(element);
    const draft = JSON.stringify({ ...config, keyboard: { enabled: false } });
    await edit(editor, draft);
    filename(element, 'renamed');
    click(element, '#config-editor-rename');
    await element.updateComplete;
    await editor.updateComplete;
    expect(rename).toHaveBeenCalledWith('current.json', 'renamed.json');
    expect(editor.shadowRoot!.querySelector('textarea')!.disabled).toBe(true);
    click(element, '#config-editor-back');
    expect(element.shadowRoot!.querySelector('config-json-editor')).toBe(editor);
    client.emit('config', {
      config: structuredClone(config), configValidationTemplate: configValidationTemplate(config),
      currentConfigName: 'renamed.json', availableConfigs: ['renamed.json'],
    });
    await element.updateComplete;
    await editor.updateComplete;
    expect(editor.shadowRoot!.querySelector('textarea')!.value).toBe(draft);
    expect(editor.hasConflict).toBe(false);
    expect(element.shadowRoot!.textContent).toContain('Filename saved');
    editor.shadowRoot!.querySelector<HTMLElement>('sketch-button')!.click();
    await element.updateComplete;
    expect(apply).toHaveBeenCalledWith(JSON.parse(draft), 'renamed.json', config, expect.any(String));
    click(element, '#config-editor-back');
    expect(element.shadowRoot!.querySelector('config-json-editor')).toBe(editor);
    client.emit('config', {
      config: JSON.parse(draft), configValidationTemplate: configValidationTemplate(config),
      currentConfigName: 'renamed.json', availableConfigs: ['renamed.json'],
    });
    client.emit('apply-config-result', { requestId: apply.mock.calls[0][3], success: true, message: 'Applied and saved' });
    await element.updateComplete;
    await editor.updateComplete;
    await element.updateComplete;
    expect(editor.hasUnsavedChanges).toBe(false);
    click(element, '#config-editor-back');
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('config-json-editor')).toBeNull();
  });

  it('validates live, preserves drafts on external changes, and never treats changed JSON as an own rename', async () => {
    const { element, client, config } = await dashboard();
    vi.spyOn(client, 'renameConfig').mockImplementation(() => {});
    const apply = vi.spyOn(client, 'applyConfig').mockImplementation(() => {});
    const editor = await open(element);
    await edit(editor, '{');
    expect(editor.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
    const draft = JSON.stringify({ ...config, keyboard: { enabled: false } });
    await edit(editor, draft);
    filename(element, 'renamed');
    click(element, '#config-editor-rename');
    client.emit('config', {
      config: { ...config, keyboard: { enabled: false } },
      configValidationTemplate: configValidationTemplate(config),
      currentConfigName: 'renamed.json', availableConfigs: ['renamed.json'],
    });
    await element.updateComplete;
    await editor.updateComplete;
    expect(editor.hasConflict).toBe(true);
    expect(editor.shadowRoot!.querySelector('textarea')!.value).toBe(draft);
    expect(editor.shadowRoot!.querySelector('sketch-button')!.hasAttribute('disabled')).toBe(true);
  });

  it('reports local and explicit rename failures and releases the pending view', async () => {
    const { element, client } = await dashboard();
    const rename = vi.spyOn(client, 'renameConfig').mockImplementation(() => {});
    await open(element);
    filename(element, 'existing');
    click(element, '#config-editor-rename');
    await element.updateComplete;
    expect(rename).not.toHaveBeenCalled();
    expect(element.shadowRoot!.textContent).toContain('already exists');
    filename(element, 'renamed');
    click(element, '#config-editor-rename');
    client.emit('rename-config-result', { oldName: 'current.json', newName: 'renamed.json', success: false, error: 'Permission denied' });
    await element.updateComplete;
    expect(element.shadowRoot!.textContent).toContain('Permission denied');
    expect(element.shadowRoot!.querySelector('#config-editor-back')!.hasAttribute('disabled')).toBe(false);
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('#config-editor-filename')!.value).toBe('renamed');
  });

  it('preserves a dirty draft and blocks Apply after an external filename change', async () => {
    const { element, client, config } = await dashboard();
    const editor = await open(element);
    await edit(editor, '{');
    client.emit('config', {
      config: structuredClone(config), configValidationTemplate: configValidationTemplate(config),
      currentConfigName: 'external.json', availableConfigs: ['external.json'],
    });
    await element.updateComplete;
    await editor.updateComplete;
    expect(editor.hasConflict).toBe(true);
    expect(editor.shadowRoot!.querySelector('textarea')!.value).toBe('{');
    click(element, '#config-editor-rename');
    await element.updateComplete;
    expect(element.shadowRoot!.textContent).toContain('changed');
  });

  it('reports rename timeout without discarding the draft', async () => {
    vi.useFakeTimers();
    try {
      const { element, client } = await dashboard();
      vi.spyOn(client, 'renameConfig').mockImplementation(() => {});
      const editor = await open(element);
      await edit(editor, '{');
      filename(element, 'renamed');
      click(element, '#config-editor-rename');
      vi.advanceTimersByTime(15000);
      await element.updateComplete;
      await editor.updateComplete;
      expect(element.shadowRoot!.textContent).toContain('Rename outcome unknown');
      expect(editor.shadowRoot!.querySelector('textarea')!.value).toBe('{');
      expect(element.shadowRoot!.querySelector('#config-editor-back')!.hasAttribute('disabled')).toBe(false);
      element.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
