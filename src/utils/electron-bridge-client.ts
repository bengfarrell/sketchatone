/**
 * Electron Bridge Client
 *
 * A drop-in replacement for StrummerWebSocketClient that uses Electron IPC
 * instead of WebSocket communication. This client is used when running
 * inside the Electron app.
 */

import { EventEmitter } from './event-emitter.js';
import type {
  TabletEventData,
  StrumEventData,
  CombinedEventData,
  ServerConfigData,
  TabletVisualizerData,
  DeviceStatusData,
} from '../types/tablet-events.js';
import type {
  ConnectionState,
  ServerMidiInputEvent,
  ServerMidiInputStatus,
  ServerMidiInputPort,
} from './strummer-websocket-client.js';

/**
 * Type declaration for the Electron bridge API exposed via preload
 */
interface ElectronBridgeAPI {
  connect: (configPath?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  getConnectionState: () => Promise<ConnectionState>;
  getConfig: () => Promise<ServerConfigData | null>;
  updateConfig: (path: string, value: unknown) => Promise<void>;
  saveConfig: () => Promise<boolean>;
  setThrottle: (throttleMs: number) => Promise<void>;
  getMidiInputStatus: () => Promise<ServerMidiInputStatus | null>;
  connectMidiInput: (portId: number) => Promise<boolean>;
  disconnectMidiInput: () => Promise<void>;
  onCombinedEvent: (callback: (data: CombinedEventData) => void) => () => void;
  onConfig: (callback: (config: ServerConfigData) => void) => () => void;
  onConnectionState: (callback: (state: ConnectionState) => void) => () => void;
  onDeviceStatus: (callback: (status: DeviceStatusData) => void) => () => void;
  onMidiInput: (callback: (event: ServerMidiInputEvent) => void) => () => void;
  onMidiInputStatus: (callback: (status: ServerMidiInputStatus) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
  platform: string;
  isElectron: boolean;
}

// Declare the global window type extension
declare global {
  interface Window {
    electronBridge?: ElectronBridgeAPI;
  }
}

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronBridge?.isElectron === true;
}

/**
 * Get the Electron bridge API (throws if not in Electron)
 */
function getElectronBridge(): ElectronBridgeAPI {
  if (!window.electronBridge) {
    throw new Error('Electron bridge not available - not running in Electron');
  }
  return window.electronBridge;
}

/**
 * Electron Bridge Client - IPC-based replacement for WebSocket client
 * 
 * This class has the same interface as StrummerWebSocketClient, making it
 * a drop-in replacement when running in Electron.
 */
export class ElectronBridgeClient extends EventEmitter {
  private _connectionState: ConnectionState = 'disconnected';
  private _deviceStatus: DeviceStatusData | null = null;
  private _config: ServerConfigData | null = null;
  private _lastTabletData: TabletVisualizerData = {
    x: 0,
    y: 0,
    pressure: 0,
    tiltX: 0,
    tiltY: 0,
    tiltXY: 0,
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
  };

  // Cleanup functions for IPC listeners
  private cleanupFunctions: Array<() => void> = [];

  constructor() {
    super();
    this.setupIPCListeners();
  }

  /**
   * Set up IPC event listeners
   */
  private setupIPCListeners(): void {
    if (!isElectron()) return;

    const bridge = getElectronBridge();

    // Connection state changes
    this.cleanupFunctions.push(
      bridge.onConnectionState((state) => {
        this.setConnectionState(state);
      })
    );

    // Config updates
    this.cleanupFunctions.push(
      bridge.onConfig((config) => {
        this._config = config;
        this.emit<ServerConfigData>('config', config);
      })
    );

    // Device status updates
    this.cleanupFunctions.push(
      bridge.onDeviceStatus((status) => {
        this._deviceStatus = status;
        this.emit<DeviceStatusData>('device-status', status);
      })
    );

    // Combined tablet/strum events
    this.cleanupFunctions.push(
      bridge.onCombinedEvent((data) => {
        this.handleCombinedEvent(data);
      })
    );

    // MIDI input events
    this.cleanupFunctions.push(
      bridge.onMidiInput((event) => {
        this.emit<ServerMidiInputEvent>('midi-input', event);
      })
    );

    // MIDI input status
    this.cleanupFunctions.push(
      bridge.onMidiInputStatus((status) => {
        this.emit<ServerMidiInputStatus>('midi-input-status', status);
      })
    );

    // Errors
    this.cleanupFunctions.push(
      bridge.onError((error) => {
        this.emit<Error>('error', new Error(error));
      })
    );
  }

  /**
   * Get the current connection state
   */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  /**
   * Get the server config (available after connection)
   */
  get config(): ServerConfigData | null {
    return this._config;
  }

  /**
   * Get the last received tablet data (for visualization)
   */
  get lastTabletData(): TabletVisualizerData {
    return this._lastTabletData;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  /**
   * Get the device status (available after connection)
   */
  get deviceStatus(): DeviceStatusData | null {
    return this._deviceStatus;
  }

  /**
   * Check if the tablet device is connected
   */
  get isDeviceConnected(): boolean {
    return this._deviceStatus?.deviceConnected ?? false;
  }

  /**
   * Set the connection state and emit event
   */
  private setConnectionState(state: ConnectionState): void {
    this._connectionState = state;
    this.emit<ConnectionState>('connection-state', state);
  }

  /**
   * Connect to the tablet (via IPC bridge)
   * @param configPath Optional path to tablet config file
   */
  async connect(configPath?: string): Promise<void> {
    if (!isElectron()) {
      throw new Error('Not running in Electron');
    }

    const bridge = getElectronBridge();
    this.setConnectionState('connecting');

    try {
      const success = await bridge.connect(configPath);
      if (!success) {
        this.setConnectionState('error');
      }
      // Connection state will be updated via IPC listener
    } catch (error) {
      this.setConnectionState('error');
      this.emit<Error>('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Disconnect from the tablet
   */
  async disconnect(): Promise<void> {
    if (!isElectron()) return;

    const bridge = getElectronBridge();
    await bridge.disconnect();
    this.setConnectionState('disconnected');
  }

  /**
   * Set the throttle interval
   */
  async setThrottle(throttleMs: number): Promise<void> {
    if (!isElectron()) return;
    const bridge = getElectronBridge();
    await bridge.setThrottle(throttleMs);
  }

  /**
   * Update a config value
   * @param path Dot-notation path to the config property
   * @param value The new value for the property
   */
  async updateConfig(path: string, value: unknown): Promise<void> {
    if (!isElectron()) return;
    const bridge = getElectronBridge();
    await bridge.updateConfig(path, value);
  }

  /**
   * Save the current configuration
   */
  async saveConfig(): Promise<boolean> {
    if (!isElectron()) return false;
    const bridge = getElectronBridge();
    return await bridge.saveConfig();
  }

  /**
   * Subscribe to combined events (tablet + optional strum merged)
   */
  onCombinedEvent(callback: (data: CombinedEventData) => void): () => void {
    this.on<CombinedEventData>('combined', callback);
    return () => this.off('combined', callback as any);
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(callback: (state: ConnectionState) => void): () => void {
    this.on<ConnectionState>('connection-state', callback);
    return () => this.off('connection-state', callback as any);
  }

  /**
   * Subscribe to config updates
   */
  onConfig(callback: (config: ServerConfigData) => void): () => void {
    this.on<ServerConfigData>('config', callback);
    return () => this.off('config', callback as any);
  }

  /**
   * Subscribe to device status changes
   */
  onDeviceStatus(callback: (status: DeviceStatusData) => void): () => void {
    this.on<DeviceStatusData>('device-status', callback);
    return () => this.off('device-status', callback as any);
  }

  /**
   * Subscribe to MIDI input events
   */
  onMidiInput(callback: (event: ServerMidiInputEvent) => void): () => void {
    this.on<ServerMidiInputEvent>('midi-input', callback);
    return () => this.off('midi-input', callback as any);
  }

  /**
   * Subscribe to MIDI input status
   */
  onMidiInputStatus(callback: (status: ServerMidiInputStatus) => void): () => void {
    this.on<ServerMidiInputStatus>('midi-input-status', callback);
    return () => this.off('midi-input-status', callback as any);
  }

  /**
   * Subscribe to errors
   */
  onError(callback: (error: Error) => void): () => void {
    this.on<Error>('error', callback);
    return () => this.off('error', callback as any);
  }

  /**
   * Handle combined tablet/strum event
   */
  private handleCombinedEvent(data: CombinedEventData): void {
    // Update last tablet data for visualization
    this._lastTabletData = {
      x: data.x,
      y: data.y,
      pressure: data.pressure,
      tiltX: data.tiltX,
      tiltY: data.tiltY,
      tiltXY: data.tiltXY,
      primaryButtonPressed: data.primaryButtonPressed,
      secondaryButtonPressed: data.secondaryButtonPressed,
    };

    // Emit combined event
    this.emit<CombinedEventData>('combined', data);

    // Also emit individual events for backward compatibility
    this.emit<TabletEventData>('tablet', data);

    // Emit strum event if present
    if (data.strum) {
      this.emit<StrumEventData>('strum', data.strum);
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Remove all IPC listeners
    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions = [];

    // Clear all event listeners
    this.clear();
  }
}

/**
 * Create the appropriate client based on environment
 * Returns ElectronBridgeClient if in Electron, otherwise returns null
 * (caller should fall back to StrummerWebSocketClient)
 */
export function createBridgeClient(): ElectronBridgeClient | null {
  if (isElectron()) {
    return new ElectronBridgeClient();
  }
  return null;
}
