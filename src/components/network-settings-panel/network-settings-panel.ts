import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { formStyles } from '../../design-system/form-styles.js';
import '../../design-system/components/sketch-button.js';
import type { StrummerWebSocketClient, ConnectionState } from '../../utils/strummer-websocket-client.js';
import type {
  NetworkSettingsData,
  NetworkSettingsResult,
  NetworkStatusData,
  PublicNetworkConfig,
  SubmittedNetworkConfig,
} from '../../types/network-settings.js';

/** Editable Wi-Fi network row. `password` is only a typed replacement, never a stored secret. */
export interface NetworkDraftWifi {
  id: string;
  ssid: string;
  hidden: boolean;
  passwordSet: boolean;
  password: string;
}

export interface NetworkDraft {
  enabled: boolean;
  wifi: {
    enabled: boolean;
    interface: string;
    connectionTimeout: number;
    reconnectGrace: number;
    networks: NetworkDraftWifi[];
    hotspot: { ssid: string; address: string; passwordSet: boolean; password: string };
  };
  usb: { enabled: boolean };
}

const MAX_NETWORKS = 20;
const utf8Length = (value: string) => new TextEncoder().encode(value).length;
const hasControlChars = (value: string) => [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function draftFromPublic(settings: PublicNetworkConfig): NetworkDraft {
  const wifi = settings.wifi;
  return {
    enabled: Boolean(settings.enabled),
    wifi: {
      enabled: Boolean(wifi?.enabled),
      interface: wifi?.interface ?? 'wlan0',
      connectionTimeout: wifi?.connectionTimeout ?? 15,
      reconnectGrace: wifi?.reconnectGrace ?? 10,
      networks: (wifi?.networks ?? []).map(n => ({
        id: n.id, ssid: n.ssid, hidden: Boolean(n.hidden), passwordSet: Boolean(n.passwordSet), password: '',
      })),
      hotspot: {
        ssid: wifi?.hotspot?.ssid ?? 'Sketchatone',
        address: wifi?.hotspot?.address ?? '192.168.50.1/24',
        passwordSet: Boolean(wifi?.hotspot?.passwordSet),
        password: '',
      },
    },
    usb: { enabled: Boolean(settings.usb?.enabled) },
  };
}

/** Build the outgoing payload. Blank passwords are omitted so the server keeps stored ones. */
export function submittedFromDraft(draft: NetworkDraft): SubmittedNetworkConfig {
  return {
    enabled: draft.enabled,
    wifi: {
      enabled: draft.wifi.enabled,
      interface: draft.wifi.interface,
      connectionTimeout: draft.wifi.connectionTimeout,
      reconnectGrace: draft.wifi.reconnectGrace,
      networks: draft.wifi.networks.map(n => ({
        id: n.id, ssid: n.ssid, hidden: n.hidden, ...(n.password ? { password: n.password } : {}),
      })),
      hotspot: {
        ssid: draft.wifi.hotspot.ssid,
        address: draft.wifi.hotspot.address,
        ...(draft.wifi.hotspot.password ? { password: draft.wifi.hotspot.password } : {}),
      },
    },
    usb: { enabled: draft.usb.enabled },
  };
}

function validatePassword(value: string, label: string): string | null {
  if (!value) return null;
  if (/^[0-9A-Fa-f]{64}$/.test(value)) return null;
  const length = utf8Length(value);
  if (length < 8 || length > 63) return `${label} must be 8-63 characters or a 64-digit hexadecimal key.`;
  if (hasControlChars(value)) return `${label} cannot contain control characters.`;
  return null;
}

export function validateNetworkDraft(draft: NetworkDraft): string[] {
  const errors: string[] = [];
  const wifi = draft.wifi;
  if (!wifi.interface || utf8Length(wifi.interface) > 15 || !/^[A-Za-z0-9_.:-]+$/.test(wifi.interface)) {
    errors.push('Wi-Fi interface must be 1-15 characters (letters, digits, _ . : -).');
  }
  if (!Number.isInteger(wifi.connectionTimeout) || wifi.connectionTimeout < 1 || wifi.connectionTimeout > 120) {
    errors.push('Connection timeout must be a whole number from 1 to 120 seconds.');
  }
  if (!Number.isInteger(wifi.reconnectGrace) || wifi.reconnectGrace < 0 || wifi.reconnectGrace > 300) {
    errors.push('Reconnect grace must be a whole number from 0 to 300 seconds.');
  }
  if (wifi.networks.length > MAX_NETWORKS) errors.push(`At most ${MAX_NETWORKS} Wi-Fi networks can be saved.`);
  const ids = new Set<string>();
  wifi.networks.forEach((n, i) => {
    const label = `Network ${i + 1}`;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(n.id) || ids.has(n.id)) errors.push(`${label} has an invalid or duplicate id.`);
    ids.add(n.id);
    if (!n.ssid || utf8Length(n.ssid) > 32 || hasControlChars(n.ssid)) errors.push(`${label} SSID must be 1-32 bytes.`);
    const passwordError = validatePassword(n.password, `${label} password`);
    if (passwordError) errors.push(passwordError);
  });
  const hotspot = wifi.hotspot;
  if (!hotspot.ssid || utf8Length(hotspot.ssid) > 32 || hasControlChars(hotspot.ssid)) {
    errors.push('Hotspot SSID must be 1-32 bytes.');
  }
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/\d{1,2})?$/.test(hotspot.address) ||
      hotspot.address.split('/')[0].split('.').some(o => Number(o) > 255) ||
      Number(hotspot.address.split('/')[1] ?? 32) > 32) {
    errors.push('Hotspot address must be an IPv4 address such as 192.168.50.1/24.');
  }
  // No unknown generated default exists: a known hotspot password must be set
  // before Wi-Fi management is enabled, or a headless device could be stranded.
  if (draft.enabled && wifi.enabled && !hotspot.passwordSet && !hotspot.password) {
    errors.push('A hotspot password is required before enabling Wi-Fi management. Choose one you will remember.');
  }
  const hotspotError = validatePassword(hotspot.password, 'Hotspot password');
  if (hotspotError) errors.push(hotspotError);
  return errors;
}

const MODE_LABELS: Record<string, string> = {
  disabled: 'Disabled',
  wifi: 'Wi-Fi client',
  hotspot: 'Hotspot',
  error: 'Error',
  unsupported: 'Unsupported',
  unmanaged: 'Not managed',
  connecting: 'Connecting',
  starting: 'Starting',
  reconnecting: 'Reconnecting',
  stopped: 'Stopped',
};

export function formatNetworkMode(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** Summarize the status `usb` object (and legacy flat usb* fields) as readable text. */
export function formatUsbStatus(status: NetworkStatusData): string {
  const parts: string[] = [];
  const describe = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) { if (value.length) parts.push(`${key}: ${value.join(', ')}`); return; }
    if (typeof value === 'boolean') { parts.push(`${key}: ${value ? 'yes' : 'no'}`); return; }
    if (typeof value === 'object') { parts.push(`${key}: ${JSON.stringify(value)}`); return; }
    parts.push(`${key}: ${String(value)}`);
  };
  if (status.usb && typeof status.usb === 'object') {
    Object.entries(status.usb).forEach(([key, value]) => describe(key, value));
  } else {
    describe('enabled', status.usbEnabled);
    describe('connected', status.usbConnectedInterfaces);
    if (!status.usbConnectedInterfaces?.length) describe('detected', status.usbInterfaces);
  }
  return parts.join('; ');
}

let idCounter = 0;
function newNetworkId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `net-${random}${(idCounter++).toString(36)}`;
}

function newRequestId(): string {
  return `network-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** JSON view of the draft. Includes passwordSet (read-only info) and only typed replacement passwords. */
function draftToJson(draft: NetworkDraft): string {
  const value = {
    enabled: draft.enabled,
    wifi: {
      enabled: draft.wifi.enabled,
      interface: draft.wifi.interface,
      connectionTimeout: draft.wifi.connectionTimeout,
      reconnectGrace: draft.wifi.reconnectGrace,
      networks: draft.wifi.networks.map(n => ({
        id: n.id, ssid: n.ssid, hidden: n.hidden, passwordSet: n.passwordSet,
        ...(n.password ? { password: n.password } : {}),
      })),
      hotspot: {
        ssid: draft.wifi.hotspot.ssid,
        address: draft.wifi.hotspot.address,
        passwordSet: draft.wifi.hotspot.passwordSet,
        ...(draft.wifi.hotspot.password ? { password: draft.wifi.hotspot.password } : {}),
      },
    },
    usb: { enabled: draft.usb.enabled },
  };
  return JSON.stringify(value, null, 2);
}

/** Parse the JSON view. `passwordSet` is derived from the server's state, never from user input. */
export function draftFromJson(text: string, saved: PublicNetworkConfig | null): NetworkDraft {
  const raw = JSON.parse(text);
  const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(raw)) throw new Error('Network settings must be a JSON object.');
  const wifi = raw.wifi ?? {};
  const usb = raw.usb ?? {};
  const hotspot = wifi.hotspot ?? {};
  if (!isObject(wifi) || !isObject(usb) || !isObject(hotspot)) throw new Error('wifi, wifi.hotspot and usb must be objects.');
  const bool = (v: unknown, field: string, fallback: boolean) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'boolean') throw new Error(`${field} must be true or false.`);
    return v;
  };
  const str = (v: unknown, field: string, fallback: string) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string') throw new Error(`${field} must be text.`);
    return v;
  };
  const num = (v: unknown, field: string, fallback: number) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'number') throw new Error(`${field} must be a number.`);
    return v;
  };
  const networks = wifi.networks ?? [];
  if (!Array.isArray(networks)) throw new Error('wifi.networks must be a list.');
  const savedById = new Map((saved?.wifi?.networks ?? []).map(n => [n.id, n]));
  return {
    enabled: bool(raw.enabled, 'enabled', false),
    wifi: {
      enabled: bool(wifi.enabled, 'wifi.enabled', true),
      interface: str(wifi.interface, 'wifi.interface', 'wlan0'),
      connectionTimeout: num(wifi.connectionTimeout, 'wifi.connectionTimeout', 15),
      reconnectGrace: num(wifi.reconnectGrace, 'wifi.reconnectGrace', 10),
      networks: networks.map((n: unknown, i: number) => {
        if (!isObject(n)) throw new Error(`wifi.networks[${i}] must be an object.`);
        const id = n.id === undefined ? newNetworkId() : str(n.id, `wifi.networks[${i}].id`, '');
        return {
          id,
          ssid: str(n.ssid, `wifi.networks[${i}].ssid`, ''),
          hidden: bool(n.hidden, `wifi.networks[${i}].hidden`, false),
          passwordSet: Boolean(savedById.get(id)?.passwordSet),
          password: str(n.password, `wifi.networks[${i}].password`, ''),
        };
      }),
      hotspot: {
        ssid: str(hotspot.ssid, 'wifi.hotspot.ssid', 'Sketchatone'),
        address: str(hotspot.address, 'wifi.hotspot.address', '192.168.50.1/24'),
        passwordSet: Boolean(saved?.wifi?.hotspot?.passwordSet),
        password: str(hotspot.password, 'wifi.hotspot.password', ''),
      },
    },
    usb: { enabled: bool(usb.enabled, 'usb.enabled', false) },
  };
}

/**
 * Network Settings Panel
 *
 * Device-level, opt-in headless networking controls (Wi-Fi client networks,
 * fallback hotspot, USB tethering). These settings are separate from musical
 * presets: they are never part of the config editor, preset export, or
 * `update-config`/`apply-config`. Changes are only sent on an explicit,
 * confirmed Apply. Passwords are never received from the server, never
 * persisted in the browser, and cleared after a successful apply.
 */
@customElement('network-settings-panel')
export class NetworkSettingsPanel extends LitElement {
  static styles = [formStyles, css`
    :host { display: block; }
    .form { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; font-size: 13px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .row label, .row .label { flex: 1; color: var(--sketch-color-gray-700); }
    fieldset { border: 1px solid var(--sketch-color-gray-300); border-radius: 4px; padding: 8px 12px 12px; margin: 0;
      display: flex; flex-direction: column; gap: 8px; }
    fieldset:disabled { opacity: 0.6; }
    legend { font-weight: 600; padding: 0 4px; }
    .network { border: 1px dashed var(--sketch-color-gray-300); border-radius: 4px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .network-actions { display: flex; gap: 4px; justify-content: flex-end; }
    .hint { font-size: 11px; color: var(--sketch-color-gray-600); }
    .notice { padding: 8px 12px; border-radius: 4px; font-size: 12px; }
    .notice.warning { background: var(--sketch-color-orange-100); color: var(--sketch-color-gray-800); }
    .notice.error { background: var(--sketch-color-red-100); color: var(--sketch-color-red-700); }
    .notice.success { background: var(--sketch-color-green-100); color: var(--sketch-color-green-700); }
    .notice.info { background: var(--sketch-color-gray-100); color: var(--sketch-color-gray-800); }
    .status { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 12px; }
    .status dt { color: var(--sketch-color-gray-600); }
    .status dd { margin: 0; word-break: break-word; }
    .actions { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
      padding-top: 12px; border-top: 1px solid var(--sketch-color-gray-300); }
    textarea { width: 100%; min-height: 260px; font-family: monospace; font-size: 12px; box-sizing: border-box; }
    ul { margin: 4px 0 0; padding-left: 18px; }
  `];

  @property({ attribute: false })
  client: StrummerWebSocketClient | null = null;

  @state() private connected = false;
  @state() private serverData: NetworkSettingsData | null = null;
  @state() private status: NetworkStatusData | null = null;
  @state() private draft: NetworkDraft | null = null;
  @state() private draftRevision = '';
  @state() private dirty = false;
  @state() private staleRevision = false;
  @state() private jsonMode = false;
  @state() private jsonText = '';
  @state() private jsonError: string | null = null;
  @state() private pendingRequestId: string | null = null;
  @state() private resultMessage: { kind: 'success' | 'error' | 'warning'; text: string } | null = null;

  private unsubscribers: Array<() => void> = [];
  private subscribedClient: StrummerWebSocketClient | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.subscribe();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe();
  }

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('client') && this.isConnected) this.subscribe();
  }

  private subscribe(): void {
    if (this.subscribedClient === this.client) return;
    this.unsubscribe();
    const client = this.client;
    if (!client) return;
    this.subscribedClient = client;
    this.unsubscribers = [
      client.onConnectionStateChange(state => this.handleConnectionState(state)),
      client.onNetworkSettings(data => this.handleSettings(data)),
      client.onNetworkStatus(status => { this.status = status; }),
      client.onNetworkSettingsResult(result => this.handleResult(result)),
    ];
    // Handlers are installed first so the replies to these requests are not missed.
    if (client.networkSettings) this.handleSettings(client.networkSettings);
    if (client.networkStatus) this.status = client.networkStatus;
    this.handleConnectionState(client.connectionState);
  }

  private unsubscribe(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
    this.subscribedClient = null;
  }

  private handleConnectionState(state: ConnectionState): void {
    this.connected = state === 'connected';
    if (this.connected) {
      this.client?.requestNetworkSettings();
      this.client?.requestNetworkStatus();
    } else if (this.pendingRequestId) {
      this.pendingRequestId = null;
      this.resultMessage = {
        kind: 'warning',
        text: 'Connection lost while applying network settings. The outcome is unknown; the dashboard keeps trying to reconnect. Reload settings once connected.',
      };
    }
  }

  private handleSettings(data: NetworkSettingsData): void {
    this.serverData = data;
    if (!data.settings) {
      if (!this.dirty) { this.draft = null; this.draftRevision = data.revision; }
      return;
    }
    if (!this.dirty || !this.draft) {
      this.loadDraft(data.settings, data.revision);
    } else if (data.revision !== this.draftRevision) {
      // Never overwrite in-progress edits; the server rejects the stale revision on apply.
      this.staleRevision = true;
    }
  }

  private loadDraft(settings: PublicNetworkConfig, revision: string): void {
    this.draft = draftFromPublic(settings);
    this.draftRevision = revision;
    this.dirty = false;
    this.staleRevision = false;
    this.jsonError = null;
    if (this.jsonMode) this.jsonText = draftToJson(this.draft);
  }

  private handleResult(result: NetworkSettingsResult): void {
    if (!this.pendingRequestId || result.requestId !== this.pendingRequestId) return;
    this.pendingRequestId = null;
    if (result.success) {
      if (result.settings) {
        this.loadDraft(result.settings, result.revision ?? this.draftRevision);
        if (this.serverData) {
          this.serverData = { ...this.serverData, settings: result.settings, revision: result.revision ?? this.serverData.revision };
        }
      } else {
        // Accepted without a settings snapshot: adopt the new revision if given and
        // fetch the authoritative saved settings so later applies aren't stale.
        if (result.revision) {
          this.draftRevision = result.revision;
          if (this.serverData) this.serverData = { ...this.serverData, revision: result.revision };
        }
        this.clearPasswords();
        this.dirty = false;
        this.staleRevision = false;
        this.client?.requestNetworkSettings();
      }
      this.resultMessage = {
        kind: 'success',
        text: 'Settings accepted and saved. The device is now applying them, which may briefly disconnect this dashboard; it will keep trying to reconnect. If the device switches networks (for example to its hotspot), join that network and reopen the dashboard there.',
      };
      this.client?.requestNetworkStatus();
    } else {
      this.resultMessage = { kind: 'error', text: result.error || 'Network settings were not applied.' };
    }
  }

  private clearPasswords(): void {
    if (!this.draft) return;
    this.draft = {
      ...this.draft,
      wifi: {
        ...this.draft.wifi,
        networks: this.draft.wifi.networks.map(n => ({ ...n, password: '' })),
        hotspot: { ...this.draft.wifi.hotspot, password: '' },
      },
    };
    if (this.jsonMode) this.jsonText = draftToJson(this.draft);
  }

  private get supported(): boolean {
    return Boolean(this.serverData?.supported);
  }

  private get editable(): boolean {
    return this.supported && this.connected && !this.pendingRequestId && Boolean(this.draft);
  }

  private editDraft(mutate: (draft: NetworkDraft) => void): void {
    if (!this.draft || !this.editable) return;
    const next: NetworkDraft = JSON.parse(JSON.stringify(this.draft));
    mutate(next);
    this.draft = next;
    this.dirty = true;
    this.resultMessage = null;
  }

  private addNetwork(): void {
    this.editDraft(d => {
      if (d.wifi.networks.length >= MAX_NETWORKS) return;
      d.wifi.networks.push({ id: newNetworkId(), ssid: '', hidden: false, passwordSet: false, password: '' });
    });
  }

  private moveNetwork(index: number, delta: number): void {
    this.editDraft(d => {
      const target = index + delta;
      if (target < 0 || target >= d.wifi.networks.length) return;
      const [item] = d.wifi.networks.splice(index, 1);
      d.wifi.networks.splice(target, 0, item);
    });
  }

  private removeNetwork(index: number): void {
    this.editDraft(d => { d.wifi.networks.splice(index, 1); });
  }

  private reload(): void {
    if (this.serverData?.settings) this.loadDraft(this.serverData.settings, this.serverData.revision);
    this.resultMessage = null;
    this.client?.requestNetworkSettings();
    this.client?.requestNetworkStatus();
  }

  private toggleJson(): void {
    if (!this.jsonMode) {
      if (this.draft) this.jsonText = draftToJson(this.draft);
      this.jsonError = null;
      this.jsonMode = true;
    } else if (!this.jsonError) {
      this.jsonMode = false;
    }
  }

  private handleJsonInput(e: Event): void {
    if (!this.editable) return;
    this.jsonText = (e.target as HTMLTextAreaElement).value;
    this.dirty = true;
    this.resultMessage = null;
    try {
      this.draft = draftFromJson(this.jsonText, this.serverData?.settings ?? null);
      this.jsonError = null;
    } catch (error) {
      this.jsonError = error instanceof Error ? error.message : 'Invalid JSON.';
    }
  }

  private apply(): void {
    if (!this.editable || !this.draft || !this.client || this.jsonError) return;
    const errors = validateNetworkDraft(this.draft);
    if (errors.length) {
      this.resultMessage = { kind: 'error', text: errors.join(' ') };
      return;
    }
    const confirmed = window.confirm(
      'Apply network settings?\n\nThe device may disconnect from its current network while it switches Wi-Fi, hotspot, or USB networking. ' +
      'This dashboard may lose its connection and you may need to rejoin the device on a different network.',
    );
    if (!confirmed) return;
    const requestId = newRequestId();
    this.pendingRequestId = requestId;
    this.resultMessage = null;
    this.client.applyNetworkSettings(submittedFromDraft(this.draft), this.draftRevision, requestId);
  }

  private renderStatus() {
    const s = this.status;
    if (!s) return html`<div class="hint">No status received yet.</div>`;
    const mode = s.mode ?? s.state;
    const usb = formatUsbStatus(s);
    return html`
      <dl class="status" data-testid="network-status">
        ${mode ? html`<dt>Mode</dt><dd class="status-mode">${formatNetworkMode(mode)}</dd>` : nothing}
        ${s.phase && s.phase !== mode ? html`<dt>Phase</dt><dd>${s.phase}</dd>` : nothing}
        ${s.activeConnection ? html`<dt>Connection</dt><dd>${s.activeConnection}</dd>` : nothing}
        ${s.interface ? html`<dt>Interface</dt><dd>${s.interface}</dd>` : nothing}
        ${s.addresses?.length ? html`<dt>Addresses</dt><dd>${s.addresses.join(', ')}</dd>` : nothing}
        ${usb ? html`<dt>USB</dt><dd>${usb}</dd>` : nothing}
        ${s.message ? html`<dt>Message</dt><dd>${s.message}</dd>` : nothing}
        ${s.error ? html`<dt>Error</dt><dd class="status-error">${s.error}</dd>` : nothing}
        ${s.usbError ? html`<dt>USB error</dt><dd class="status-error">${s.usbError}</dd>` : nothing}
        ${s.busy ? html`<dt>Busy</dt><dd>Applying settings…</dd>` : nothing}
      </dl>
    `;
  }

  private renderNetwork(n: NetworkDraftWifi, i: number, count: number) {
    return html`
      <div class="network" data-network-id=${n.id}>
        <div class="row">
          <label for="ssid-${n.id}">${i + 1}. SSID</label>
          <input id="ssid-${n.id}" class="sketch-input network-ssid" size="s" maxlength="32" .value=${n.ssid}
            @input=${(e: Event) => this.editDraft(d => { d.wifi.networks[i].ssid = (e.target as HTMLInputElement).value; })}>
        </div>
        <div class="row">
          <label for="pw-${n.id}">Password ${n.passwordSet ? html`<span class="hint">(saved)</span>` : nothing}</label>
          <input id="pw-${n.id}" type="password" class="sketch-input network-password" size="s" autocomplete="new-password"
            placeholder=${n.passwordSet ? 'Leave blank to keep saved password' : 'Blank for an open network'}
            .value=${n.password}
            @input=${(e: Event) => this.editDraft(d => { d.wifi.networks[i].password = (e.target as HTMLInputElement).value; })}>
        </div>
        <div class="row">
          <label for="hidden-${n.id}">Hidden network</label>
          <input id="hidden-${n.id}" type="checkbox" class="sketch-checkbox network-hidden" .checked=${n.hidden}
            @change=${(e: Event) => this.editDraft(d => { d.wifi.networks[i].hidden = (e.target as HTMLInputElement).checked; })}>
        </div>
        <div class="network-actions">
          <sketch-button size="s" variant="quiet" class="move-up" title="Higher priority" ?disabled=${i === 0}
            @click=${() => i > 0 && this.moveNetwork(i, -1)}>↑</sketch-button>
          <sketch-button size="s" variant="quiet" class="move-down" title="Lower priority" ?disabled=${i === count - 1}
            @click=${() => i < count - 1 && this.moveNetwork(i, 1)}>↓</sketch-button>
          <sketch-button size="s" variant="quiet" class="remove-network" title="Remove network"
            @click=${() => this.removeNetwork(i)}>Remove</sketch-button>
        </div>
      </div>
    `;
  }

  private renderForm(draft: NetworkDraft) {
    const wifi = draft.wifi;
    const num = (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      return value === '' ? NaN : Number(value);
    };
    return html`
      <div class="row">
        <label for="network-enabled"><strong>Manage device networking</strong></label>
        <input id="network-enabled" type="checkbox" class="sketch-checkbox" .checked=${draft.enabled}
          @change=${(e: Event) => this.editDraft(d => { d.enabled = (e.target as HTMLInputElement).checked; })}>
      </div>
      <div class="hint">When off, Sketchatone leaves the system's network configuration untouched.</div>

      <fieldset>
        <legend>Wi-Fi</legend>
        <div class="row">
          <label for="wifi-enabled">Enable Wi-Fi management</label>
          <input id="wifi-enabled" type="checkbox" class="sketch-checkbox" .checked=${wifi.enabled}
            @change=${(e: Event) => this.editDraft(d => { d.wifi.enabled = (e.target as HTMLInputElement).checked; })}>
        </div>
        <div class="row">
          <label for="wifi-interface">Interface</label>
          <input id="wifi-interface" class="sketch-input" size="s" maxlength="15" .value=${wifi.interface}
            @input=${(e: Event) => this.editDraft(d => { d.wifi.interface = (e.target as HTMLInputElement).value.trim(); })}>
        </div>
        <div class="row">
          <label for="wifi-timeout">Connection timeout (s)</label>
          <input id="wifi-timeout" type="number" class="sketch-input" size="s" min="1" max="120" step="1"
            .value=${String(wifi.connectionTimeout)}
            @input=${(e: Event) => { const v = num(e); this.editDraft(d => { d.wifi.connectionTimeout = v; }); }}>
        </div>
        <div class="row">
          <label for="wifi-grace">Reconnect grace (s)</label>
          <input id="wifi-grace" type="number" class="sketch-input" size="s" min="0" max="300" step="1"
            .value=${String(wifi.reconnectGrace)}
            @input=${(e: Event) => { const v = num(e); this.editDraft(d => { d.wifi.reconnectGrace = v; }); }}>
        </div>

        <div class="label"><strong>Saved networks</strong> <span class="hint">(tried in order, top first)</span></div>
        ${wifi.networks.length === 0 ? html`<div class="hint">No saved networks; the hotspot is used.</div>` : nothing}
        ${wifi.networks.map((n, i) => this.renderNetwork(n, i, wifi.networks.length))}
        <div>
          <sketch-button size="s" variant="secondary" class="add-network" ?disabled=${wifi.networks.length >= MAX_NETWORKS}
            @click=${() => this.addNetwork()}>Add network</sketch-button>
        </div>
        <div class="hint">To make a saved secure network open, remove it and add it again without a password.</div>

        <div class="label"><strong>Fallback hotspot</strong></div>
        <div class="row">
          <label for="hotspot-ssid">Hotspot SSID</label>
          <input id="hotspot-ssid" class="sketch-input" size="s" maxlength="32" .value=${wifi.hotspot.ssid}
            @input=${(e: Event) => this.editDraft(d => { d.wifi.hotspot.ssid = (e.target as HTMLInputElement).value; })}>
        </div>
        <div class="row">
          <label for="hotspot-password">Hotspot password ${wifi.hotspot.passwordSet ? html`<span class="hint">(saved)</span>` : nothing}</label>
          <input id="hotspot-password" type="password" class="sketch-input" size="s" autocomplete="new-password"
            placeholder=${wifi.hotspot.passwordSet ? 'Leave blank to keep saved password' : 'Required to enable Wi-Fi (8-63 characters)'}
            .value=${wifi.hotspot.password}
            @input=${(e: Event) => this.editDraft(d => { d.wifi.hotspot.password = (e.target as HTMLInputElement).value; })}>
        </div>
        ${!wifi.hotspot.passwordSet ? html`
          <div class="hint hotspot-password-hint">
            No hotspot password is saved yet. Set one you know before enabling Wi-Fi management: it is the only way to reach the device if no saved network is available.
          </div>
        ` : nothing}
        <div class="row">
          <label for="hotspot-address">Hotspot address</label>
          <input id="hotspot-address" class="sketch-input" size="s" .value=${wifi.hotspot.address}
            @input=${(e: Event) => this.editDraft(d => { d.wifi.hotspot.address = (e.target as HTMLInputElement).value.trim(); })}>
        </div>
      </fieldset>

      <fieldset>
        <legend>USB</legend>
        <div class="row">
          <label for="usb-enabled">Enable USB network (tethering)</label>
          <input id="usb-enabled" type="checkbox" class="sketch-checkbox" .checked=${draft.usb.enabled}
            @change=${(e: Event) => this.editDraft(d => { d.usb.enabled = (e.target as HTMLInputElement).checked; })}>
        </div>
      </fieldset>
    `;
  }

  render() {
    const data = this.serverData;
    const editable = this.editable;
    const errors = this.draft && this.dirty ? validateNetworkDraft(this.draft) : [];
    return html`
      <div class="form">
        <div class="notice info">
          Device networking is stored on the device, separate from musical presets, and is not included in preset export.
        </div>
        ${!this.connected ? html`<div class="notice warning">Not connected to the server.</div>` : nothing}
        ${data && !data.supported ? html`
          <div class="notice warning unsupported">Network management is unavailable: ${data.reason || 'not supported by this server.'}</div>
        ` : nothing}
        ${this.staleRevision ? html`
          <div class="notice warning stale">
            Network settings changed on the device while you were editing. Reload to discard your edits, or Apply will be rejected.
          </div>
        ` : nothing}

        <div>
          <div class="label"><strong>Status</strong></div>
          ${this.renderStatus()}
        </div>

        ${this.draft ? html`
          <fieldset class="editor" ?disabled=${!editable}>
            ${this.jsonMode ? html`
              <label for="network-json">Network settings JSON</label>
              <textarea id="network-json" class="sketch-input" spellcheck="false" .value=${this.jsonText}
                @input=${this.handleJsonInput}></textarea>
              <div class="hint">"passwordSet" is informational. Add "password" only to set or replace one; omit it to keep the saved password.</div>
              ${this.jsonError ? html`<div class="notice error json-error">${this.jsonError}</div>` : nothing}
            ` : this.renderForm(this.draft)}
          </fieldset>
        ` : data?.supported ? html`<div class="hint">Loading network settings…</div>` : nothing}

        ${errors.length && !this.jsonError ? html`
          <div class="notice warning validation"><ul>${errors.map(e => html`<li>${e}</li>`)}</ul></div>
        ` : nothing}
        ${this.resultMessage ? html`<div class="notice ${this.resultMessage.kind} result">${this.resultMessage.text}</div>` : nothing}
        ${this.pendingRequestId ? html`<div class="notice info pending">Applying network settings…</div>` : nothing}

        <div class="actions">
          <div>
            <sketch-button size="s" variant="secondary" class="toggle-json" ?disabled=${!this.draft || Boolean(this.jsonError)}
              @click=${() => this.toggleJson()}>${this.jsonMode ? 'Form view' : 'Edit as JSON'}</sketch-button>
            <sketch-button size="s" variant="secondary" class="reload" ?disabled=${!this.connected || Boolean(this.pendingRequestId)}
              @click=${() => this.reload()}>${this.dirty ? 'Discard & reload' : 'Reload'}</sketch-button>
          </div>
          <sketch-button size="s" variant="accent" class="apply"
            ?disabled=${!editable || !this.dirty || errors.length > 0 || Boolean(this.jsonError)}
            @click=${() => this.apply()}>Apply network settings</sketch-button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'network-settings-panel': NetworkSettingsPanel;
  }
}
