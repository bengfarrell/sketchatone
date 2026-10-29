/**
 * Device-level network settings protocol (opt-in headless NetworkManager control).
 *
 * These settings are stored separately from musical presets and are never
 * part of the config editor, preset export, or `apply-config` flows.
 */

/** A saved Wi-Fi client network as reported by the server (secrets redacted). */
export interface PublicWifiNetwork {
  id: string;
  ssid: string;
  hidden: boolean;
  passwordSet: boolean;
}

/** The fallback hotspot (access point) as reported by the server. */
export interface PublicHotspotConfig {
  ssid: string;
  passwordSet: boolean;
  address: string;
}

export interface PublicWifiConfig {
  enabled: boolean;
  interface: string;
  connectionTimeout: number;
  reconnectGrace: number;
  /** Ordered by connection priority (first = highest). */
  networks: PublicWifiNetwork[];
  hotspot: PublicHotspotConfig;
}

export interface UsbNetworkConfig {
  enabled: boolean;
}

/** Network config as sent by the server. Never contains passwords. */
export interface PublicNetworkConfig {
  enabled: boolean;
  wifi: PublicWifiConfig;
  usb: UsbNetworkConfig;
}

/**
 * Wi-Fi network as submitted by the client. A blank or omitted password keeps
 * the stored password; a new network with no password is an open network.
 */
export interface SubmittedWifiNetwork {
  id: string;
  ssid: string;
  hidden: boolean;
  password?: string;
}

export interface SubmittedHotspotConfig {
  ssid: string;
  address: string;
  password?: string;
}

/** Network config as submitted by the client in `apply-network-settings`. */
export interface SubmittedNetworkConfig {
  enabled: boolean;
  wifi: {
    enabled: boolean;
    interface: string;
    connectionTimeout: number;
    reconnectGrace: number;
    networks: SubmittedWifiNetwork[];
    hotspot: SubmittedHotspotConfig;
  };
  usb: UsbNetworkConfig;
}

/** Payload of the server `network-settings` message. */
export interface NetworkSettingsData {
  /** Null/absent when the server cannot manage networking. */
  settings: PublicNetworkConfig | null;
  revision: string;
  supported: boolean;
  reason?: string;
}

/** Payload of the server `network-status` message. Unknown fields are tolerated. */
export interface NetworkStatusData {
  supported?: boolean | null;
  mode?: string;
  /** Alias used by some backends for `mode`. */
  state?: string;
  phase?: string;
  enabled?: boolean;
  connected?: boolean;
  interface?: string | null;
  activeConnection?: string | null;
  addresses?: string[];
  usbInterfaces?: string[];
  usbEnabled?: boolean;
  usbConnectedInterfaces?: string[];
  usbError?: string | null;
  /** True while the server is applying settings. */
  busy?: boolean;
  usb?: Record<string, unknown>;
  message?: string;
  error?: string | null;
  [key: string]: unknown;
}

/** Payload of the server `network-settings-result` message. */
export interface NetworkSettingsResult {
  requestId: string;
  success: boolean;
  error?: string;
  settings?: PublicNetworkConfig;
  revision?: string;
}

export interface GetNetworkSettingsMessage {
  type: 'get-network-settings';
}

export interface GetNetworkStatusMessage {
  type: 'get-network-status';
}

export interface ApplyNetworkSettingsMessage {
  type: 'apply-network-settings';
  requestId: string;
  revision: string;
  settings: SubmittedNetworkConfig;
}

export type NetworkClientMessage =
  | GetNetworkSettingsMessage
  | GetNetworkStatusMessage
  | ApplyNetworkSettingsMessage;

export interface NetworkSettingsServerMessage {
  type: 'network-settings';
  data: NetworkSettingsData;
}

export interface NetworkStatusServerMessage {
  type: 'network-status';
  data: NetworkStatusData;
}

export interface NetworkSettingsResultServerMessage {
  type: 'network-settings-result';
  data: NetworkSettingsResult;
}

export type NetworkServerMessage =
  | NetworkSettingsServerMessage
  | NetworkStatusServerMessage
  | NetworkSettingsResultServerMessage;

/** Reason reported by servers that cannot manage device networking. */
export const NETWORK_UNSUPPORTED_REASON =
  'Network management requires the Python server on Linux with NetworkManager.';
