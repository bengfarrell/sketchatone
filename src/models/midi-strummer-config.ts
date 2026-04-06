/**
 * MIDI Strummer Config Model
 *
 * Combined configuration model for strummer + MIDI settings.
 * Based on midi-strummer's configuration format.
 */

import * as fs from 'fs';
import {
  StrummerConfig,
  StrummerConfigData,
  StrummingConfig,
} from './strummer-config.js';
import {
  ParameterMapping,
  defaultNoteDuration,
  defaultPitchBend,
  defaultNoteVelocity,
} from './parameter-mapping.js';
import { StrumReleaseConfig } from './strummer-features.js';

/**
 * Keyboard input configuration data
 */
export interface KeyboardConfigData {
  /** Map keyboard keys to button IDs (e.g., {"1": "button:1", "2": "button:2"}) */
  mappings: Record<string, string>;
}

/**
 * Default keyboard configuration
 */
export const DEFAULT_KEYBOARD_CONFIG: KeyboardConfigData = {
  mappings: {},
};

/**
 * Keyboard configuration class
 *
 * The presence of this config section enables the keyboard listener.
 * To disable, remove the "keyboard" section from config or set mappings to empty.
 */
export class KeyboardConfig implements KeyboardConfigData {
  mappings: Record<string, string>;

  constructor(data: Partial<KeyboardConfigData> = {}) {
    this.mappings = data.mappings ?? { ...DEFAULT_KEYBOARD_CONFIG.mappings };
  }

  /**
   * Keyboard is enabled if there are any mappings
   */
  get enabled(): boolean {
    return Object.keys(this.mappings).length > 0;
  }

  /**
   * Create from dictionary
   */
  static fromDict(data: Record<string, unknown>): KeyboardConfig {
    return new KeyboardConfig({
      mappings: data.mappings as Record<string, string> | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): KeyboardConfigData {
    return {
      mappings: this.mappings,
    };
  }
}

/**
 * Server configuration data
 */
export interface ServerConfigData {
  /** Path to device config file or directory for auto-detection (null = use default 'devices' folder) */
  device: string | null;
  /** HTTP server port for serving webapps (null = disabled) */
  httpPort: number | null;
  /** HTTPS server port for captive portal detection (null = disabled) */
  httpsPort: number | null;
  /** WebSocket server port (null = disabled) */
  wsPort: number | null;
  /** Secure WebSocket server port with SSL (null = disabled) */
  wssPort: number | null;
  /** WebSocket message throttle interval in milliseconds */
  wsMessageThrottle: number;
  /** Poll interval in milliseconds for waiting for device (null = quit if no device) */
  deviceFindingPollInterval: number | null;
}

/**
 * Default server configuration
 */
export const DEFAULT_SERVER_CONFIG: ServerConfigData = {
  device: null,
  httpPort: null,
  httpsPort: null,
  wsPort: null,
  wssPort: null,
  wsMessageThrottle: 150,
  deviceFindingPollInterval: null,
};

/**
 * Server configuration class
 */
export class ServerConfig implements ServerConfigData {
  device: string | null;
  httpPort: number | null;
  httpsPort: number | null;
  wsPort: number | null;
  wssPort: number | null;
  wsMessageThrottle: number;
  deviceFindingPollInterval: number | null;

  constructor(data: Partial<ServerConfigData> = {}) {
    this.device = data.device ?? DEFAULT_SERVER_CONFIG.device;
    this.httpPort = data.httpPort ?? DEFAULT_SERVER_CONFIG.httpPort;
    this.httpsPort = data.httpsPort ?? DEFAULT_SERVER_CONFIG.httpsPort;
    this.wsPort = data.wsPort ?? DEFAULT_SERVER_CONFIG.wsPort;
    this.wssPort = data.wssPort ?? DEFAULT_SERVER_CONFIG.wssPort;
    this.wsMessageThrottle = data.wsMessageThrottle ?? DEFAULT_SERVER_CONFIG.wsMessageThrottle;
    this.deviceFindingPollInterval = data.deviceFindingPollInterval ?? DEFAULT_SERVER_CONFIG.deviceFindingPollInterval;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): ServerConfig {
    return new ServerConfig({
      device: data.device as string | null | undefined,
      httpPort: (data.http_port ?? data.httpPort) as number | null | undefined,
      httpsPort: (data.https_port ?? data.httpsPort) as number | null | undefined,
      wsPort: (data.ws_port ?? data.wsPort) as number | null | undefined,
      wssPort: (data.wss_port ?? data.wssPort) as number | null | undefined,
      wsMessageThrottle: (data.ws_message_throttle ?? data.wsMessageThrottle) as number | undefined,
      deviceFindingPollInterval: (data.device_finding_poll_interval ?? data.deviceFindingPollInterval) as number | null | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): ServerConfigData {
    return {
      device: this.device,
      httpPort: this.httpPort,
      httpsPort: this.httpsPort,
      wsPort: this.wsPort,
      wssPort: this.wssPort,
      wsMessageThrottle: this.wsMessageThrottle,
      deviceFindingPollInterval: this.deviceFindingPollInterval,
    };
  }
}

/**
 * MIDI configuration data
 */
export interface MidiConfigData {
  /** Which MIDI system to use ("rtmidi" or "jack") */
  midiOutputBackend: 'rtmidi' | 'jack';
  /** MIDI output port name or index */
  outputPort: string | number | null;
  /** MIDI input port name or index (for feedback) */
  inputPort: string | number | null;
  /** Default MIDI channel (0-15 in config files, displayed as 1-16 in CLI) */
  channel: number;
  /** Whether to use virtual MIDI ports */
  useVirtualPorts: boolean;
  /** List of port name patterns to exclude from MIDI input auto-connect */
  inputExclude: string[];
  /** Name for JACK client (default: "sketchatone") */
  jackClientName: string;
  /** JACK auto-connect mode (default: "chain0") */
  jackAutoConnect: string | null;
  /** Default note duration in seconds (fallback when strummer.noteDuration is not configured) */
  defaultNoteDuration: number;
  /** Delay in seconds after each MIDI message (default: 0). Use e.g. 0.002 (2 ms) on Raspberry Pi when notes stick */
  midiInterMessageDelay: number;
}

/**
 * Default MIDI input exclusion patterns
 * These are system/internal ports that are typically not useful for user input
 * Note: Users can now use the same device for input and output if desired
 */
export const DEFAULT_MIDI_INPUT_EXCLUDE: string[] = [
  'sketchatone',      // Our own output port
  'Midi Through',     // ALSA Midi Through (loopback)
  'ZynMidiRouter',    // Zynthian's internal MIDI router
  'zynseq',           // Zynthian sequencer
  'zynsmf',           // Zynthian SMF player
  'ttymidi',          // Serial MIDI (often internal)
];

/**
 * Default MIDI configuration
 */
export const DEFAULT_MIDI_CONFIG: MidiConfigData = {
  midiOutputBackend: 'rtmidi',
  outputPort: null,
  inputPort: null,
  channel: 0,
  useVirtualPorts: false,
  inputExclude: DEFAULT_MIDI_INPUT_EXCLUDE,
  jackClientName: 'sketchatone',
  jackAutoConnect: 'chain0',
  defaultNoteDuration: 1.5,
  midiInterMessageDelay: 0,
};

/**
 * MIDI configuration class
 */
export class MidiConfig implements MidiConfigData {
  midiOutputBackend: 'rtmidi' | 'jack';
  outputPort: string | number | null;
  inputPort: string | number | null;
  channel: number;
  useVirtualPorts: boolean;
  inputExclude: string[];
  jackClientName: string;
  jackAutoConnect: string | null;
  defaultNoteDuration: number;
  midiInterMessageDelay: number;

  constructor(data: Partial<MidiConfigData> = {}) {
    this.midiOutputBackend = data.midiOutputBackend ?? DEFAULT_MIDI_CONFIG.midiOutputBackend;
    this.outputPort = data.outputPort ?? DEFAULT_MIDI_CONFIG.outputPort;
    this.inputPort = data.inputPort ?? DEFAULT_MIDI_CONFIG.inputPort;
    this.channel = data.channel ?? DEFAULT_MIDI_CONFIG.channel;
    this.useVirtualPorts = data.useVirtualPorts ?? DEFAULT_MIDI_CONFIG.useVirtualPorts;
    this.inputExclude = data.inputExclude ?? [...DEFAULT_MIDI_INPUT_EXCLUDE];
    this.jackClientName = data.jackClientName ?? DEFAULT_MIDI_CONFIG.jackClientName;
    this.jackAutoConnect = data.jackAutoConnect ?? DEFAULT_MIDI_CONFIG.jackAutoConnect;
    this.defaultNoteDuration = data.defaultNoteDuration ?? DEFAULT_MIDI_CONFIG.defaultNoteDuration;
    this.midiInterMessageDelay = data.midiInterMessageDelay ?? DEFAULT_MIDI_CONFIG.midiInterMessageDelay;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): MidiConfig {
    return new MidiConfig({
      midiOutputBackend: (data.midi_output_backend ?? data.midiOutputBackend ?? 'rtmidi') as 'rtmidi' | 'jack',
      outputPort: (data.output_port ?? data.outputPort ?? data.midi_output_id ?? data.midiOutputId) as string | number | null | undefined,
      inputPort: (data.input_port ?? data.inputPort ?? data.midi_input_id ?? data.midiInputId) as string | number | null | undefined,
      channel: data.channel as number | undefined,
      useVirtualPorts: (data.use_virtual_ports ?? data.useVirtualPorts) as boolean | undefined,
      inputExclude: (data.input_exclude ?? data.inputExclude ?? data.midi_input_exclude ?? data.midiInputExclude) as string[] | undefined,
      jackClientName: (data.jack_client_name ?? data.jackClientName ?? 'sketchatone') as string,
      jackAutoConnect: (data.jack_auto_connect ?? data.jackAutoConnect ?? 'chain0') as string | null | undefined,
      defaultNoteDuration: (data.default_note_duration ?? data.defaultNoteDuration ?? data.note_duration ?? data.noteDuration) as number | undefined,
      midiInterMessageDelay: (data.midi_inter_message_delay ?? data.midiInterMessageDelay ?? 0) as number,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): MidiConfigData {
    return {
      midiOutputBackend: this.midiOutputBackend,
      outputPort: this.outputPort,
      inputPort: this.inputPort,
      channel: this.channel,
      useVirtualPorts: this.useVirtualPorts,
      inputExclude: this.inputExclude,
      jackClientName: this.jackClientName,
      jackAutoConnect: this.jackAutoConnect,
      defaultNoteDuration: this.defaultNoteDuration,
      midiInterMessageDelay: this.midiInterMessageDelay,
    };
  }
}

/**
 * Full MIDI strummer configuration data interface
 */
export interface MidiStrummerConfigData {
  strummer: StrummerConfigData;
  midi: MidiConfigData;
  keyboard?: KeyboardConfigData;
  server: ServerConfigData;
}

/**
 * Combined configuration for MIDI strummer.
 *
 * This combines:
 * - Full strummer configuration (notes, mappings, features)
 * - MIDI configuration (ports, channels)
 * - Keyboard configuration (for debugging/testing button actions)
 * - Server configuration (HTTP/WebSocket ports, throttle, poll)
 */
export class MidiStrummerConfig {
  private _strummer: StrummerConfig;
  private _midi: MidiConfig;
  private _keyboard: KeyboardConfig;
  private _server: ServerConfig;

  constructor(data: {
    strummer?: StrummerConfig;
    midi?: MidiConfig;
    keyboard?: KeyboardConfig;
    server?: ServerConfig;
  } = {}) {
    this._strummer = data.strummer ?? new StrummerConfig();
    this._midi = data.midi ?? new MidiConfig();
    this._keyboard = data.keyboard ?? new KeyboardConfig();
    this._server = data.server ?? new ServerConfig();
  }

  // Strummer config accessors
  get strummer(): StrummerConfig {
    return this._strummer;
  }

  get noteDuration(): ParameterMapping {
    return this._strummer.noteDuration;
  }

  get pitchBend(): ParameterMapping {
    return this._strummer.pitchBend;
  }

  get noteVelocity(): ParameterMapping {
    return this._strummer.noteVelocity;
  }

  get strumming(): StrummingConfig {
    return this._strummer.strumming;
  }

  // Note: noteRepeater and transpose are now managed by Actions class, not config

  get strumRelease(): StrumReleaseConfig {
    return this._strummer.strumRelease;
  }

  // Convenience properties for Actions class compatibility
  get lowerSpread(): number {
    return this._strummer.lowerSpread;
  }

  get upperSpread(): number {
    return this._strummer.upperSpread;
  }

  // MIDI config accessors
  get midi(): MidiConfig {
    return this._midi;
  }

  get outputPort(): string | number | null {
    return this._midi.outputPort;
  }

  get inputPort(): string | number | null {
    return this._midi.inputPort;
  }

  get channel(): number {
    return this._midi.channel;
  }

  get useVirtualPorts(): boolean {
    return this._midi.useVirtualPorts;
  }

  // Keyboard config accessors
  get keyboard(): KeyboardConfig {
    return this._keyboard;
  }

  // Server config accessors
  get server(): ServerConfig {
    return this._server;
  }

  get httpPort(): number | null {
    return this._server.httpPort;
  }

  get httpsPort(): number | null {
    return this._server.httpsPort;
  }

  get wsPort(): number | null {
    return this._server.wsPort;
  }

  get wssPort(): number | null {
    return this._server.wssPort;
  }

  get wsMessageThrottle(): number {
    return this._server.wsMessageThrottle;
  }

  get deviceFindingPollInterval(): number | null {
    return this._server.deviceFindingPollInterval;
  }

  // Backward compatibility properties
  get pressureThreshold(): number {
    return this._strummer.pressureThreshold;
  }

  get notes(): string[] {
    return this._strummer.notes;
  }

  get chord(): string | undefined {
    return this._strummer.chord;
  }

  /**
   * Create from separate strummer and MIDI configs
   */
  static fromSeparateConfigs(strummer: StrummerConfig, midi: MidiConfig): MidiStrummerConfig {
    return new MidiStrummerConfig({ strummer, midi });
  }

  /**
   * Get the strummer config portion
   */
  toStrummerConfig(): StrummerConfig {
    return this._strummer;
  }

  /**
   * Get the MIDI config portion
   */
  toMidiConfig(): MidiConfig {
    return this._midi;
  }

  /**
   * Get the server config portion
   */
  toServerConfig(): ServerConfig {
    return this._server;
  }

  /**
   * Create from dictionary.
   * Supports both nested format (with 'strummer' key) and flat format (for backward compatibility).
   */
  static fromDict(data: Record<string, unknown>): MidiStrummerConfig {
    // Check if this is nested format (has 'strummer' key) or flat format
    const hasStrummerKey = 'strummer' in data && typeof data.strummer === 'object' && data.strummer !== null;

    let strummerData: Record<string, unknown>;
    let midiData: Record<string, unknown>;
    let keyboardData: Record<string, unknown>;
    let serverData: Record<string, unknown>;

    if (hasStrummerKey) {
      // Nested format: { strummer: {...}, midi: {...}, keyboard: {...}, server: {...} }
      strummerData = (data.strummer ?? {}) as Record<string, unknown>;
      midiData = (data.midi ?? {}) as Record<string, unknown>;
      keyboardData = (data.keyboard ?? {}) as Record<string, unknown>;
      serverData = (data.server ?? {}) as Record<string, unknown>;
    } else {
      // Flat format: { note_duration: {...}, note_repeater: {...}, midi: {...}, keyboard: {...}, server: {...} }
      // Extract midi, keyboard, and server, pass the rest to strummer
      midiData = (data.midi ?? {}) as Record<string, unknown>;
      keyboardData = (data.keyboard ?? {}) as Record<string, unknown>;
      serverData = (data.server ?? {}) as Record<string, unknown>;

      // Everything else goes to strummer (excluding midi, keyboard, and server)
      strummerData = { ...data };
      delete strummerData.midi;
      delete strummerData.keyboard;
      delete strummerData.server;
    }

    return new MidiStrummerConfig({
      strummer: Object.keys(strummerData).length > 0
        ? StrummerConfig.fromDict(strummerData)
        : new StrummerConfig(),
      midi: Object.keys(midiData).length > 0
        ? MidiConfig.fromDict(midiData)
        : new MidiConfig(),
      keyboard: Object.keys(keyboardData).length > 0
        ? KeyboardConfig.fromDict(keyboardData)
        : new KeyboardConfig(),
      server: Object.keys(serverData).length > 0
        ? ServerConfig.fromDict(serverData)
        : new ServerConfig(),
    });
  }

  /**
   * Load from a JSON file
   */
  static fromJsonFile(path: string): MidiStrummerConfig {
    const content = fs.readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    return MidiStrummerConfig.fromDict(data);
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): MidiStrummerConfigData {
    const result: MidiStrummerConfigData = {
      strummer: this._strummer.toDict(),
      midi: this._midi.toDict(),
      server: this._server.toDict(),
    };

    // Only include keyboard config if it has mappings
    if (this._keyboard.enabled) {
      result.keyboard = this._keyboard.toDict();
    }

    return result;
  }

  /**
   * Save to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}