/**
 * Strummer WebSocket Client
 *
 * A WebSocket client that connects to the server and provides
 * tablet and strum event data to frontend components.
 */

import { EventEmitter } from './event-emitter.js';
import type {
  TabletEventData,
  StrumEventData,
  CombinedEventData,
  ServerConfigData,
  TabletVisualizerData,
  ClientMessage,
  DeviceStatus,
  DeviceStatusData,
} from '../types/tablet-events.js';

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Events emitted by the WebSocket client
 */
export interface StrummerWebSocketClientEvents {
  'connection-state': ConnectionState;
  'device-status': DeviceStatusData;
  'tablet': TabletEventData;
  'strum': StrumEventData;
  'combined': CombinedEventData;
  'config': ServerConfigData;
  'error': Error;
}

/**
 * Options for the WebSocket client
 */
export interface StrummerWebSocketClientOptions {
  /** WebSocket server URL (default: ws://localhost:8081) */
  url?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds (default: 2000) */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (default: 10, 0 = infinite) */
  maxReconnectAttempts?: number;
}

/**
 * WebSocket client for connecting to the server
 */
export class StrummerWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private autoReconnect: boolean;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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

  constructor(options: StrummerWebSocketClientOptions = {}) {
    super();
    this.url = options.url ?? 'ws://localhost:8081';
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 2000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
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
   * Check if connected to the WebSocket server
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
   * Check if the tablet device is connected to the server
   */
  get isDeviceConnected(): boolean {
    return this._deviceStatus?.deviceConnected ?? false;
  }

  /**
   * Set the WebSocket URL
   */
  setUrl(url: string): void {
    this.url = url;
  }

  /**
   * Connect to the WebSocket server
   * @param url Optional URL to connect to (overrides the constructor URL)
   */
  connect(url?: string): void {
    if (url) {
      this.url = url;
    }

    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return; // Already connecting or connected
    }

    this.setConnectionState('connecting');
    
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnectionState('connected');
      };

      this.ws.onclose = () => {
        this.setConnectionState('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        const error = new Error('WebSocket error');
        this.emit<Error>('error', error);
        this.setConnectionState('error');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    } catch (error) {
      this.setConnectionState('error');
      this.emit<Error>('error', error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.autoReconnect = false; // Prevent auto-reconnect
    this.cancelReconnect();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.setConnectionState('disconnected');
  }

  /**
   * Set the throttle interval
   */
  setThrottle(throttleMs: number): void {
    this.send({ type: 'set-throttle', throttleMs });
  }

  /**
   * Set the current mode
   */
  setMode(mode: string): void {
    this.send({ type: 'set-mode', mode });
  }

  /**
   * Update a config value on the server
   * @param path Dot-notation path to the config property (e.g., 'strummer.strumming.pluckVelocityScale')
   * @param value The new value for the property
   */
  updateConfig(path: string, value: unknown): void {
    this.send({ type: 'update-config', path, value });
  }

  /**
   * Subscribe to combined events (tablet + optional strum merged)
   */
  onCombinedEvent(callback: (data: CombinedEventData) => void): () => void {
    this.on<CombinedEventData>('combined', callback);
    return () => this.off('combined', callback as any);
  }

  /**
   * Subscribe to tablet events (backward compatibility)
   */
  onTabletEvent(callback: (data: TabletEventData) => void): () => void {
    this.on<TabletEventData>('tablet', callback);
    return () => this.off('tablet', callback as any);
  }

  /**
   * Subscribe to strum events (emitted when strum data is present in combined event)
   */
  onStrumEvent(callback: (data: StrumEventData) => void): () => void {
    this.on<StrumEventData>('strum', callback);
    return () => this.off('strum', callback as any);
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
   * Subscribe to mode change events
   */
  onModeChange(callback: (mode: string) => void): () => void {
    this.on<string>('mode-change', callback);
    return () => this.off('mode-change', callback as any);
  }

  /**
   * Subscribe to device status changes (tablet connected/disconnected from server)
   */
  onDeviceStatus(callback: (status: DeviceStatusData) => void): () => void {
    this.on<DeviceStatusData>('device-status', callback);
    return () => this.off('device-status', callback as any);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      this.emit<ConnectionState>('connection-state', state);
    }
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'tablet-data':
          // Server sends combined tablet+strum data with type 'tablet-data'
          // The data is spread directly into the message, not nested under 'data'
          this.handleCombinedEvent(message);
          break;
        case 'tablet':
          // Handle tablet-only messages with nested data property
          if (message.data) {
            this._lastTabletData = message.data;
            this.emit('tablet', message.data);
          }
          break;
        case 'strum':
          // Handle strum messages with nested data property
          if (message.data) {
            this.emit('strum', message.data);
          }
          break;
        case 'mode-change':
          // Handle mode change messages
          if (message.data && message.data.mode) {
            this.emit('mode-change', message.data.mode);
          }
          break;
        case 'config':
          this._config = message.data;
          this.emit<ServerConfigData>('config', message.data);
          break;
        case 'status':
          this._deviceStatus = {
            status: message.status,
            deviceConnected: message.deviceConnected,
            message: message.message,
            timestamp: message.timestamp
          };
          this.emit<DeviceStatusData>('device-status', this._deviceStatus);
          break;
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

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

  private scheduleReconnect(): void {
    if (!this.autoReconnect) return;
    if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('Max reconnect attempts reached');
      return;
    }

    this.cancelReconnect();
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connect();
    }, this.reconnectDelay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.disconnect();
    this.clear();
  }
}

/**
 * Create a singleton instance for easy access
 */
let _sharedClient: StrummerWebSocketClient | null = null;

/**
 * Get or create the shared WebSocket client instance
 */
export function getSharedStrummerClient(options?: StrummerWebSocketClientOptions): StrummerWebSocketClient {
  if (!_sharedClient) {
    _sharedClient = new StrummerWebSocketClient(options);
  }
  return _sharedClient;
}

/**
 * Reset the shared client (useful for testing)
 */
export function resetSharedStrummerClient(): void {
  if (_sharedClient) {
    _sharedClient.cleanup();
    _sharedClient = null;
  }
}
