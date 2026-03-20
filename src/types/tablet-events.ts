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
  // Tablet hardware button states
  tabletButtons?: number;
  // Explicit button properties for backward compatibility (optional)
  button1?: boolean;
  button2?: boolean;
  button3?: boolean;
  button4?: boolean;
  button5?: boolean;
  button6?: boolean;
  button7?: boolean;
  button8?: boolean;
  // Additional buttons (button9, button10, etc.) are accessed dynamically
  // Use (data as Record<string, unknown>)[`button${n}`] for buttons > 8
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
export type ServerMessageType = 'tablet' | 'config' | 'status' | 'midi-devices';

/**
 * Device capabilities from blankslate tablet configuration
 */
export interface DeviceCapabilities {
  hasButtons: boolean;
  buttonCount: number;
  hasPressure: boolean;
  pressureLevels: number;
  hasTilt: boolean;
  resolution: {
    x: number;
    y: number;
  };
}

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
  /** Device capabilities from blankslate tablet configuration */
  deviceCapabilities?: DeviceCapabilities;
  /** Current config file name (without path) */
  currentConfigName?: string;
  /** List of available config files in the config directory */
  availableConfigs?: string[];
  /** True when config represents the saved state (after load/save), false for updates */
  isSavedState?: boolean;
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
 * MIDI device port information
 */
export interface MidiDevicePort {
  id: string | number;
  name: string;
}

/**
 * MIDI devices information from server
 */
export interface MidiDevicesData {
  inputPorts: MidiDevicePort[];
  outputPorts: MidiDevicePort[];
  currentInputPort: string | number | null;
  currentOutputPort: string | number | null;
}

/**
 * Client message types
 */
export type ClientMessageType = 'set-throttle' | 'update-config' | 'set-mode' | 'save-config' | 'load-config' | 'create-config' | 'rename-config' | 'upload-config' | 'delete-config' | 'get-midi-devices';

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
 * Load config client message
 * Tells the server to load a specific config file
 */
export interface LoadConfigMessage {
  type: 'load-config';
  configName: string;
}

/**
 * Create config client message
 * Tells the server to create a new config file with defaults
 */
export interface CreateConfigMessage {
  type: 'create-config';
  configName: string;
}

/**
 * Rename config client message
 * Tells the server to rename a config file
 */
export interface RenameConfigMessage {
  type: 'rename-config';
  oldName: string;
  newName: string;
}

/**
 * Upload config client message
 * Tells the server to save uploaded config data as a new file
 */
export interface UploadConfigMessage {
  type: 'upload-config';
  configName: string;
  configData: unknown;
}

/**
 * Delete config client message
 * Tells the server to delete a config file
 */
export interface DeleteConfigMessage {
  type: 'delete-config';
  configName: string;
}

/**
 * Get MIDI devices client message
 * Requests the list of available MIDI input/output devices from the server
 */
export interface GetMidiDevicesMessage {
  type: 'get-midi-devices';
}

/**
 * MIDI devices response message from server
 */
export interface MidiDevicesMessage {
  type: 'midi-devices';
  data: MidiDevicesData;
}

/**
 * Client message to server
 */
export type ClientMessage = SetThrottleMessage | UpdateConfigMessage | SetModeMessage | SaveConfigMessage | LoadConfigMessage | CreateConfigMessage | RenameConfigMessage | UploadConfigMessage | DeleteConfigMessage | GetMidiDevicesMessage;

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
