/**
 * Tablet Event Types
 *
 * Shared TypeScript types for tablet events used by both the WebSocket server
 * and frontend client. These types match blankslate's tablet-websocket-server format.
 */

/**
 * Tablet event data - matches blankslate's TabletEventData format
 * This is the canonical format for tablet events sent over WebSocket
 */
export interface TabletEventData {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  tiltXY: number;
  primaryButtonPressed: boolean;
  secondaryButtonPressed: boolean;
  state: 'hover' | 'contact' | 'out-of-range';
  timestamp: number;
}

/**
 * Strum event note data
 */
export interface StrumNoteEventData {
  note: {
    notation: string;
    octave: number;
    midiNote: number;
  };
  velocity: number;
}

/**
 * Strum event data
 */
export interface StrumEventData {
  type: 'strum' | 'release';
  notes: StrumNoteEventData[];
  velocity: number;
  timestamp: number;
}

/**
 * Combined event data - tablet data with optional strum data merged in.
 * This is the primary event format sent over WebSocket.
 * Blankslate can read the tablet fields directly, while sketchatone
 * can also read the strum field when present.
 */
export interface CombinedEventData extends TabletEventData {
  strum?: StrumEventData;
}

/**
 * Device status - indicates whether the tablet is connected to the server
 */
export type DeviceStatus = 'connected' | 'disconnected';

/**
 * Device status message from server
 * Sent when device connects/disconnects, and to new clients on connection
 */
export interface DeviceStatusData {
  status: DeviceStatus;
  deviceConnected: boolean;
  message: string;
  timestamp: number;
}

/**
 * WebSocket message types from server to client
 */
export type ServerMessageType = 'tablet' | 'config' | 'status';

/**
 * Server config data sent on connection
 */
export interface ServerConfigData {
  throttleMs: number;
  notes: Array<{ notation: string; octave: number }>;
  chord?: string;
  /** Full strummer configuration */
  config?: Record<string, unknown>;
  /** Server version (Python/Node.js service version) */
  serverVersion?: string;
}

/**
 * WebSocket message from server
 */
export interface ServerMessage {
  type: ServerMessageType;
  data: unknown;
}

/**
 * Tablet event message from server (contains combined data)
 */
export interface TabletEventMessage {
  type: 'tablet';
  data: CombinedEventData;
}

/**
 * Config message from server
 */
export interface ConfigMessage {
  type: 'config';
  data: ServerConfigData;
}

/**
 * Status message from server
 */
export interface StatusMessage {
  type: 'status';
  status: DeviceStatus;
  deviceConnected: boolean;
  message: string;
  timestamp: number;
}

/**
 * Client message types
 */
export type ClientMessageType = 'set-throttle' | 'update-config' | 'set-mode' | 'save-config';

/**
 * Set throttle client message
 */
export interface SetThrottleMessage {
  type: 'set-throttle';
  throttleMs: number;
}

/**
 * Update config client message
 * Sends a partial config update with a path and value
 */
export interface UpdateConfigMessage {
  type: 'update-config';
  /** Dot-notation path to the config property (e.g., 'strummer.strumming.pluckVelocityScale') */
  path: string;
  /** The new value for the property */
  value: unknown;
}

/**
 * Set mode client message
 */
export interface SetModeMessage {
  type: 'set-mode';
  mode: string;
}

/**
 * Save config client message
 * Tells the server to save the current configuration to the config file
 */
export interface SaveConfigMessage {
  type: 'save-config';
}

/**
 * Client message to server
 */
export type ClientMessage = SetThrottleMessage | UpdateConfigMessage | SetModeMessage | SaveConfigMessage;

/**
 * Tablet data for visualization components
 * This matches the externalTabletData property expected by blankslate's TabletVisualizer
 */
export interface TabletVisualizerData {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  tiltXY: number;
  primaryButtonPressed: boolean;
  secondaryButtonPressed: boolean;
}
