/**
 * Device network settings: client protocol, Node "unsupported" replies, and the
 * dashboard network settings panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrummerWebSocketClient } from '../../src/utils/strummer-websocket-client.js';
import { MockStrummerClient } from '../../src/utils/mock-strummer-client.js';
import {
  NetworkSettingsPanel,
  draftFromJson,
  draftFromPublic,
  submittedFromDraft,
  validateNetworkDraft,
  formatNetworkMode,
  formatUsbStatus,
} from '../../src/components/network-settings-panel/network-settings-panel.js';
import { StrummerWebSocketServer } from '../../src/cli/server.js';
import { NETWORK_UNSUPPORTED_REASON, type PublicNetworkConfig } from '../../src/types/network-settings.js';
import { loadPanelVisibility, PANELS } from '../../src/components/sketchatone-dashboard/panel-visibility.js';

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) { sockets.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
let sockets: FakeSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

function publicConfig(overrides: Partial<PublicNetworkConfig> = {}): PublicNetworkConfig {
  return {
    enabled: false,
    wifi: {
      enabled: true, interface: 'wlan0', connectionTimeout: 15, reconnectGrace: 10,
      networks: [
        { id: 'home', ssid: 'Home', hidden: false, passwordSet: true },
        { id: 'studio', ssid: 'Studio', hidden: true, passwordSet: false },
      ],
      hotspot: { ssid: 'Sketchatone', passwordSet: true, address: '192.168.50.1/24' },
    },
    usb: { enabled: false },
    ...overrides,
  };
}

beforeEach(() => {
  sockets = [];
  (globalThis as any).WebSocket = FakeSocket;
  (globalThis.WebSocket as any).CONNECTING = 0;
  (globalThis.WebSocket as any).OPEN = 1;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('StrummerWebSocketClient network protocol', () => {
  it('sends network requests and parses replies', () => {
    const client = new StrummerWebSocketClient({ autoReconnect: false });
    const settings = vi.fn();
    const status = vi.fn();
    client.onNetworkSettings(settings);
    client.onNetworkStatus(status);
    client.connect();
    sockets[0].open();
    client.requestNetworkSettings();
    client.requestNetworkStatus();
    expect(sockets[0].sent).toEqual([{ type: 'get-network-settings' }, { type: 'get-network-status' }]);

    sockets[0].receive({ type: 'network-settings', data: { settings: publicConfig(), revision: 'r1', supported: true } });
    sockets[0].receive({ type: 'network-status', data: { mode: 'wifi', addresses: ['10.0.0.2/24'] } });
    expect(settings).toHaveBeenCalledWith({ settings: publicConfig(), revision: 'r1', supported: true, reason: undefined });
    expect(status).toHaveBeenCalledWith({ mode: 'wifi', addresses: ['10.0.0.2/24'] });
    expect(client.networkSettings?.revision).toBe('r1');
    client.cleanup();
  });

  it('sends apply with correlation id and fails locally when disconnected', () => {
    const client = new StrummerWebSocketClient({ autoReconnect: false });
    const result = vi.fn();
    client.onNetworkSettingsResult(result);
    client.applyNetworkSettings(submittedFromDraft(draftFromPublic(publicConfig())), 'r1', 'req-0');
    expect(result).toHaveBeenCalledWith({ requestId: 'req-0', success: false, error: 'Not connected to the server.' });

    client.connect();
    sockets[0].open();
    const settings = submittedFromDraft(draftFromPublic(publicConfig()));
    client.applyNetworkSettings(settings, 'r1', 'req-1');
    expect(sockets[0].sent).toEqual([{ type: 'apply-network-settings', requestId: 'req-1', revision: 'r1', settings }]);
    client.cleanup();
  });

  it('extends the reconnect window only after an accepted network apply', () => {
    vi.useFakeTimers();
    const client = new StrummerWebSocketClient({ maxReconnectAttempts: 1, reconnectDelay: 10 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    client.connect();
    sockets[0].open();
    expect(client.isReconnectWindowExtended).toBe(false);

    // Results for requests we didn't send do not extend the window.
    sockets[0].receive({ type: 'network-settings-result', data: { requestId: 'other', success: true } });
    expect(client.isReconnectWindowExtended).toBe(false);

    client.applyNetworkSettings(submittedFromDraft(draftFromPublic(publicConfig())), 'r1', 'req-1');
    sockets[0].receive({ type: 'network-settings-result', data: { requestId: 'req-1', success: true, revision: 'r2' } });
    expect(client.isReconnectWindowExtended).toBe(true);

    // More attempts than maxReconnectAttempts are made while the window is active.
    for (let i = 0; i < 4; i++) {
      sockets[sockets.length - 1].close();
      vi.advanceTimersByTime(10);
    }
    expect(sockets.length).toBe(5);

    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(client.isReconnectWindowExtended).toBe(false);
    client.cleanup();
  });
});

describe('Node server network handling', () => {
  function call(message: unknown) {
    const sent: any[] = [];
    const ws = { readyState: 1, send: (data: string) => sent.push(JSON.parse(data)) };
    const handled = (StrummerWebSocketServer.prototype as any).handleNetworkMessage.call({}, ws, message);
    return { handled, sent };
  }

  it('reports networking as unsupported', () => {
    expect(call({ type: 'get-network-settings' }).sent).toEqual([{
      type: 'network-settings',
      data: { settings: null, revision: '', supported: false, reason: NETWORK_UNSUPPORTED_REASON },
    }]);
    const status = call({ type: 'get-network-status' }).sent[0];
    expect(status.type).toBe('network-status');
    expect(status.data).toMatchObject({ supported: false, mode: 'unsupported' });
  });

  it('rejects apply with a correlated error without echoing secrets', () => {
    const { handled, sent } = call({
      type: 'apply-network-settings', requestId: 'abc', revision: '',
      settings: { wifi: { hotspot: { password: 'super-secret' } } },
    });
    expect(handled).toBe(true);
    expect(sent).toEqual([{
      type: 'network-settings-result',
      data: { requestId: 'abc', success: false, error: NETWORK_UNSUPPORTED_REASON },
    }]);
    expect(JSON.stringify(sent)).not.toContain('super-secret');
  });

  it('ignores non-network messages', () => {
    expect(call({ type: 'get-midi-devices' })).toEqual({ handled: false, sent: [] });
    expect(call(null)).toEqual({ handled: false, sent: [] });
  });
});

describe('network status formatting', () => {
  it('labels canonical modes and passes through unknown ones', () => {
    expect(formatNetworkMode('wifi')).toBe('Wi-Fi client');
    expect(formatNetworkMode('hotspot')).toBe('Hotspot');
    expect(formatNetworkMode('custom')).toBe('custom');
  });

  it('summarizes the usb object or legacy flat fields', () => {
    expect(formatUsbStatus({ usb: { enabled: true, interfaces: ['usb0'], connectedInterfaces: ['usb0'], error: null } }))
      .toBe('enabled: yes; interfaces: usb0; connectedInterfaces: usb0');
    expect(formatNetworkMode('connecting')).toBe('Connecting');
    expect(formatUsbStatus({ usbEnabled: false, usbInterfaces: ['usb0'] })).toBe('enabled: no; detected: usb0');
    expect(formatUsbStatus({})).toBe('');
  });
});

describe('network draft helpers', () => {
  it('omits blank passwords and keeps network priority order', () => {
    const draft = draftFromPublic(publicConfig());
    draft.wifi.networks[1].password = 'new-password';
    const submitted = submittedFromDraft(draft);
    expect(submitted.wifi.networks.map(n => n.id)).toEqual(['home', 'studio']);
    expect('password' in submitted.wifi.networks[0]).toBe(false);
    expect(submitted.wifi.networks[1].password).toBe('new-password');
    expect('password' in submitted.wifi.hotspot).toBe(false);
    expect(JSON.stringify(submitted)).not.toContain('passwordSet');
  });

  it('requires a known hotspot password only when Wi-Fi management is enabled', () => {
    const draft = draftFromPublic(publicConfig());
    draft.wifi.hotspot.passwordSet = false;
    expect(validateNetworkDraft(draft)).toEqual([]);
    draft.enabled = true;
    expect(validateNetworkDraft(draft).join()).toMatch(/hotspot password is required/i);
    draft.wifi.enabled = false;
    expect(validateNetworkDraft(draft)).toEqual([]);
    draft.wifi.enabled = true;
    draft.wifi.hotspot.password = 'known-password';
    expect(validateNetworkDraft(draft)).toEqual([]);
  });

  it('validates fields', () => {
    const draft = draftFromPublic(publicConfig());
    expect(validateNetworkDraft(draft)).toEqual([]);
    draft.enabled = true;
    draft.wifi.hotspot.passwordSet = false;
    draft.wifi.connectionTimeout = 0;
    draft.wifi.interface = 'bad iface';
    draft.wifi.networks[0].password = 'short';
    const errors = validateNetworkDraft(draft).join('\n');
    expect(errors).toMatch(/hotspot password is required/i);
    expect(errors).toMatch(/Connection timeout/);
    expect(errors).toMatch(/interface/);
    expect(errors).toMatch(/8-63/);
  });

  it('parses JSON and takes passwordSet from the server, not the input', () => {
    const draft = draftFromJson(JSON.stringify({
      enabled: true,
      wifi: { networks: [{ id: 'home', ssid: 'Home', passwordSet: false }, { ssid: 'New', passwordSet: true }] },
      usb: { enabled: true },
    }), publicConfig());
    expect(draft.enabled).toBe(true);
    expect(draft.usb.enabled).toBe(true);
    expect(draft.wifi.networks[0].passwordSet).toBe(true);
    expect(draft.wifi.networks[1].passwordSet).toBe(false);
    expect(draft.wifi.networks[1].id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => draftFromJson('{"enabled":"yes"}', null)).toThrow(/enabled/);
  });
});

describe('network-settings-panel', () => {
  class StubClient extends StrummerWebSocketClient {
    requests: string[] = [];
    applied: any[] = [];
    constructor() { super({ autoReconnect: false }); }
    setState(state: 'connected' | 'disconnected') { this.setConnectionState(state); }
    override requestNetworkSettings() { this.requests.push('settings'); }
    override requestNetworkStatus() { this.requests.push('status'); }
    override applyNetworkSettings(settings: any, revision: string, requestId: string) {
      this.applied.push({ settings, revision, requestId });
    }
    sendSettings(settings: PublicNetworkConfig | null, revision: string, supported = true, reason?: string) {
      this.emit('network-settings', { settings, revision, supported, reason });
    }
  }

  async function mount(connected = true) {
    const client = new StubClient();
    if (connected) client.setState('connected');
    const panel = new NetworkSettingsPanel();
    panel.client = client;
    document.body.append(panel);
    await panel.updateComplete;
    return { panel, client };
  }

  const $ = <T extends Element = HTMLElement>(panel: NetworkSettingsPanel, selector: string) =>
    panel.shadowRoot!.querySelector(selector) as T;
  const $$ = (panel: NetworkSettingsPanel, selector: string) => [...panel.shadowRoot!.querySelectorAll(selector)];

  async function type(panel: NetworkSettingsPanel, selector: string, value: string) {
    const input = $<HTMLInputElement>(panel, selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await panel.updateComplete;
  }

  async function check(panel: NetworkSettingsPanel, selector: string, checked: boolean) {
    const input = $<HTMLInputElement>(panel, selector);
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    await panel.updateComplete;
  }

  it('requests settings and status on connect and on reconnect', async () => {
    const { panel, client } = await mount(false);
    expect(client.requests).toEqual([]);
    client.setState('connected');
    expect(client.requests).toEqual(['settings', 'status']);
    client.setState('disconnected');
    client.setState('connected');
    expect(client.requests).toEqual(['settings', 'status', 'settings', 'status']);
    panel.remove();
  });

  it('renders the full form with master switch off and passwordSet indicators', async () => {
    const { panel, client } = await mount();
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;
    expect($<HTMLInputElement>(panel, '#network-enabled').checked).toBe(false);
    expect($<HTMLInputElement>(panel, '#wifi-enabled').checked).toBe(true);
    expect($<HTMLInputElement>(panel, '#usb-enabled').checked).toBe(false);
    expect($<HTMLInputElement>(panel, '#wifi-interface').value).toBe('wlan0');
    expect($<HTMLInputElement>(panel, '#hotspot-address').value).toBe('192.168.50.1/24');
    const passwords = $$(panel, '.network-password') as HTMLInputElement[];
    expect(passwords.map(p => p.value)).toEqual(['', '']);
    expect(passwords[0].placeholder).toMatch(/keep saved/);
    expect(passwords[1].placeholder).toMatch(/open network/);
    expect($<HTMLElement>(panel, 'sketch-button.apply').hasAttribute('disabled')).toBe(true);
  });

  it('applies only after explicit confirmation, then clears credentials', async () => {
    const { panel, client } = await mount();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log');
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;

    await check(panel, '#network-enabled', true);
    await check(panel, '#usb-enabled', true);
    await type(panel, '.network-password', 'brand-new-pass');
    expect(client.applied).toEqual([]);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    $<HTMLElement>(panel, 'sketch-button.apply').click();
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/disconnect/i));
    expect(client.applied).toEqual([]);

    confirm.mockReturnValueOnce(true);
    $<HTMLElement>(panel, 'sketch-button.apply').click();
    await panel.updateComplete;
    expect(client.applied).toHaveLength(1);
    const { settings, revision, requestId } = client.applied[0];
    expect(revision).toBe('r1');
    expect(settings.enabled).toBe(true);
    expect(settings.usb.enabled).toBe(true);
    expect(settings.wifi.networks[0].password).toBe('brand-new-pass');
    expect('password' in settings.wifi.networks[1]).toBe(false);
    expect($(panel, '.pending')).not.toBeNull();

    const saved = publicConfig({ enabled: true, usb: { enabled: true } });
    client.emit('network-settings-result', { requestId: 'someone-else', success: false, error: 'x' });
    client.emit('network-settings-result', { requestId, success: true, settings: saved, revision: 'r2' });
    await panel.updateComplete;
    expect(($$(panel, '.network-password') as HTMLInputElement[]).map(p => p.value)).toEqual(['', '']);
    expect($(panel, '.result')!.textContent).toMatch(/accepted/i);
    expect($(panel, '.result')!.textContent).toMatch(/reconnect/i);
    expect(storage.mock.calls.flat().join()).not.toContain('brand-new-pass');
    expect(log.mock.calls.flat().map(String).join()).not.toContain('brand-new-pass');
  });

  it('blocks enabling Wi-Fi management until a known hotspot password is entered', async () => {
    const { panel, client } = await mount();
    const config = publicConfig();
    config.wifi.hotspot.passwordSet = false;
    client.sendSettings(config, 'r1');
    await panel.updateComplete;
    expect($(panel, '.hotspot-password-hint')).not.toBeNull();
    await check(panel, '#network-enabled', true);
    expect($(panel, '.validation')!.textContent).toMatch(/hotspot password is required/i);
    expect($<HTMLElement>(panel, 'sketch-button.apply').hasAttribute('disabled')).toBe(true);
    await type(panel, '#hotspot-password', 'known-password');
    expect($(panel, '.validation')).toBeNull();
    expect($<HTMLElement>(panel, 'sketch-button.apply').hasAttribute('disabled')).toBe(false);
  });

  it('refreshes settings when a successful result omits them', async () => {
    const { panel, client } = await mount();
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;
    await type(panel, '.network-password', 'brand-new-pass');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    $<HTMLElement>(panel, 'sketch-button.apply').click();
    const { requestId } = client.applied[0];
    client.requests = [];
    client.emit('network-settings-result', { requestId, success: true, revision: 'r2' });
    await panel.updateComplete;
    expect(client.requests).toContain('settings');
    expect(($$(panel, '.network-password') as HTMLInputElement[])[0].value).toBe('');
    expect((panel as any).draftRevision).toBe('r2');
    expect((panel as any).dirty).toBe(false);

    // The refreshed broadcast replaces the clean draft without a stale warning.
    client.sendSettings(publicConfig({ usb: { enabled: true } }), 'r2');
    await panel.updateComplete;
    expect($<HTMLInputElement>(panel, '#usb-enabled').checked).toBe(true);
    expect($(panel, '.stale')).toBeNull();

    // Subsequent edits apply against the new revision.
    await check(panel, '#usb-enabled', false);
    $<HTMLElement>(panel, 'sketch-button.apply').click();
    expect(client.applied[1].revision).toBe('r2');
  });

  it('shows correlated errors without clearing the draft', async () => {
    const { panel, client } = await mount();
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;
    await type(panel, '#hotspot-ssid', 'Renamed');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    $<HTMLElement>(panel, 'sketch-button.apply').click();
    client.emit('network-settings-result', { requestId: client.applied[0].requestId, success: false, error: 'Network settings changed. Reload them before applying.' });
    await panel.updateComplete;
    expect($(panel, '.result.error')!.textContent).toMatch(/Reload/);
    expect($<HTMLInputElement>(panel, '#hotspot-ssid').value).toBe('Renamed');
  });

  it('does not overwrite a dirty draft on refresh and flags the stale revision', async () => {
    const { panel, client } = await mount();
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;
    await type(panel, '#wifi-interface', 'wlan1');
    client.sendSettings(publicConfig(), 'r2');
    await panel.updateComplete;
    expect($<HTMLInputElement>(panel, '#wifi-interface').value).toBe('wlan1');
    expect($(panel, '.stale')).not.toBeNull();

    $<HTMLElement>(panel, 'sketch-button.reload').click();
    await panel.updateComplete;
    expect($<HTMLInputElement>(panel, '#wifi-interface').value).toBe('wlan0');
    expect($(panel, '.stale')).toBeNull();
  });

  it('adds, reorders and removes networks', async () => {
    const { panel, client } = await mount();
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;
    const ids = () => $$(panel, '.network').map(n => n.getAttribute('data-network-id'));
    ($$(panel, 'sketch-button.move-down')[0] as HTMLElement).click();
    await panel.updateComplete;
    expect(ids()).toEqual(['studio', 'home']);
    ($$(panel, 'sketch-button.move-up')[1] as HTMLElement).click();
    await panel.updateComplete;
    expect(ids()).toEqual(['home', 'studio']);
    $<HTMLElement>(panel, 'sketch-button.add-network').click();
    await panel.updateComplete;
    expect(ids()).toHaveLength(3);
    ($$(panel, 'sketch-button.remove-network')[0] as HTMLElement).click();
    await panel.updateComplete;
    expect(ids().slice(0, 1)).toEqual(['studio']);
  });

  it('edits through the optional JSON view', async () => {
    const { panel, client } = await mount();
    client.sendSettings(publicConfig(), 'r1');
    await panel.updateComplete;
    $<HTMLElement>(panel, 'sketch-button.toggle-json').click();
    await panel.updateComplete;
    const textarea = $<HTMLTextAreaElement>(panel, '#network-json');
    expect(JSON.parse(textarea.value).wifi.networks[0]).toEqual({ id: 'home', ssid: 'Home', hidden: false, passwordSet: true });
    textarea.value = '{ bad';
    textarea.dispatchEvent(new Event('input'));
    await panel.updateComplete;
    expect($(panel, '.json-error')).not.toBeNull();
    const json = JSON.parse(JSON.stringify(publicConfig()));
    json.usb.enabled = true;
    textarea.value = JSON.stringify(json);
    textarea.dispatchEvent(new Event('input'));
    await panel.updateComplete;
    expect($(panel, '.json-error')).toBeNull();
    $<HTMLElement>(panel, 'sketch-button.toggle-json').click();
    await panel.updateComplete;
    expect($<HTMLInputElement>(panel, '#usb-enabled').checked).toBe(true);
  });

  it('shows the unsupported reason and blocks edits', async () => {
    const { panel, client } = await mount();
    client.sendSettings(null, '', false, NETWORK_UNSUPPORTED_REASON);
    client.emit('network-status', { supported: false, mode: 'unsupported', message: NETWORK_UNSUPPORTED_REASON });
    await panel.updateComplete;
    expect($(panel, '.unsupported')!.textContent).toContain(NETWORK_UNSUPPORTED_REASON);
    expect($(panel, '#network-enabled')).toBeNull();
    expect($(panel, '.status-mode')!.textContent).toBe('Unsupported');
    $<HTMLElement>(panel, 'sketch-button.apply').click();
    expect(client.applied).toEqual([]);
  });
});

describe('mock client and dashboard integration', () => {
  it('mock client starts without a hotspot password and requires one to enable Wi-Fi', async () => {
    const client = new MockStrummerClient();
    const results: any[] = [];
    const settings: any[] = [];
    client.onNetworkSettingsResult(r => results.push(r));
    client.onNetworkSettings(s => settings.push(s));
    client.requestNetworkSettings();
    await Promise.resolve();
    const initial = settings[0];
    expect(initial.settings.enabled).toBe(false);
    expect(initial.settings.wifi.hotspot.passwordSet).toBe(false);
    const draft = draftFromPublic(initial.settings);
    draft.enabled = true;
    draft.wifi.networks.push({ id: 'cafe', ssid: 'Cafe', hidden: false, passwordSet: false, password: '' });
    client.applyNetworkSettings(submittedFromDraft(draft), initial.revision, 'one');
    expect(results[0]).toMatchObject({ requestId: 'one', success: false, error: expect.stringMatching(/hotspot password/) });

    draft.wifi.hotspot.password = 'known-password';
    client.applyNetworkSettings(submittedFromDraft(draft), initial.revision, 'two');
    expect(results[1]).toMatchObject({ requestId: 'two', success: true });
    expect(results[1].settings.wifi.hotspot.passwordSet).toBe(true);
    expect(results[1].settings.wifi.networks[0]).toEqual({ id: 'cafe', ssid: 'Cafe', hidden: false, passwordSet: false });
    expect(JSON.stringify(results)).not.toContain('known-password');

    client.applyNetworkSettings(submittedFromDraft(draft), initial.revision, 'three');
    expect(results[2]).toMatchObject({ requestId: 'three', success: false });
    client.disconnect();
  });

  it('registers a network panel that is visible by default', () => {
    expect(PANELS.some(p => p.id === 'networkSettings')).toBe(true);
    expect(loadPanelVisibility().networkSettings).toBe(true);
  });
});
