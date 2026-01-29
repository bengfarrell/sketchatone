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
import {
  NoteRepeaterConfig,
  TransposeConfig,
  StylusButtonsConfig,
  StrumReleaseConfig,
  TabletButtonsConfig,
} from './strummer-features.js';

/**
 * Server configuration data
 */
export interface ServerConfigData {
  /** HTTP server port for serving webapps (null = disabled) */
  httpPort: number | null;
  /** WebSocket server port (null = disabled) */
  wsPort: number | null;
  /** WebSocket message throttle interval in milliseconds */
  wsMessageThrottle: number;
  /** Poll interval in milliseconds for waiting for device (null = quit if no device) */
  deviceFindingPollInterval: number | null;
}

/**
 * Default server configuration
 */
export const DEFAULT_SERVER_CONFIG: ServerConfigData = {
  httpPort: null,
  wsPort: null,
  wsMessageThrottle: 150,
  deviceFindingPollInterval: null,
};

/**
 * Server configuration class
 */
export class ServerConfig implements ServerConfigData {
  httpPort: number | null;
  wsPort: number | null;
  wsMessageThrottle: number;
  deviceFindingPollInterval: number | null;

  constructor(data: Partial<ServerConfigData> = {}) {
    this.httpPort = data.httpPort ?? DEFAULT_SERVER_CONFIG.httpPort;
    this.wsPort = data.wsPort ?? DEFAULT_SERVER_CONFIG.wsPort;
    this.wsMessageThrottle = data.wsMessageThrottle ?? DEFAULT_SERVER_CONFIG.wsMessageThrottle;
    this.deviceFindingPollInterval = data.deviceFindingPollInterval ?? DEFAULT_SERVER_CONFIG.deviceFindingPollInterval;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): ServerConfig {
    return new ServerConfig({
      httpPort: (data.http_port ?? data.httpPort) as number | null | undefined,
      wsPort: (data.ws_port ?? data.wsPort) as number | null | undefined,
      wsMessageThrottle: (data.ws_message_throttle ?? data.wsMessageThrottle) as number | undefined,
      deviceFindingPollInterval: (data.device_finding_poll_interval ?? data.deviceFindingPollInterval) as number | null | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): ServerConfigData {
    return {
      httpPort: this.httpPort,
      wsPort: this.wsPort,
      wsMessageThrottle: this.wsMessageThrottle,
      deviceFindingPollInterval: this.deviceFindingPollInterval,
    };
  }
}

/**
 * MIDI configuration data
 */
export interface MidiConfigData {
  /** MIDI output port name or index */
  outputPort: string | number | null;
  /** MIDI input port name or index (for feedback) */
  inputPort: string | number | null;
  /** Default MIDI channel (0-15) */
  channel: number;
  /** Whether to use virtual MIDI ports */
  useVirtualPorts: boolean;
}

/**
 * Default MIDI configuration
 */
export const DEFAULT_MIDI_CONFIG: MidiConfigData = {
  outputPort: null,
  inputPort: null,
  channel: 0,
  useVirtualPorts: false,
};

/**
 * MIDI configuration class
 */
export class MidiConfig implements MidiConfigData {
  outputPort: string | number | null;
  inputPort: string | number | null;
  channel: number;
  useVirtualPorts: boolean;

  constructor(data: Partial<MidiConfigData> = {}) {
    this.outputPort = data.outputPort ?? DEFAULT_MIDI_CONFIG.outputPort;
    this.inputPort = data.inputPort ?? DEFAULT_MIDI_CONFIG.inputPort;
    this.channel = data.channel ?? DEFAULT_MIDI_CONFIG.channel;
    this.useVirtualPorts = data.useVirtualPorts ?? DEFAULT_MIDI_CONFIG.useVirtualPorts;
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): MidiConfig {
    return new MidiConfig({
      outputPort: (data.output_port ?? data.outputPort) as string | number | null | undefined,
      inputPort: (data.input_port ?? data.inputPort) as string | number | null | undefined,
      channel: data.channel as number | undefined,
      useVirtualPorts: (data.use_virtual_ports ?? data.useVirtualPorts) as boolean | undefined,
    });
  }

  /**
   * Convert to dictionary for JSON serialization
   */
  toDict(): MidiConfigData {
    return {
      outputPort: this.outputPort,
      inputPort: this.inputPort,
      channel: this.channel,
      useVirtualPorts: this.useVirtualPorts,
    };
  }
}

/**
 * Full MIDI strummer configuration data interface
 */
export interface MidiStrummerConfigData {
  strummer: StrummerConfigData;
  midi: MidiConfigData;
  server: ServerConfigData;
}

/**
 * Combined configuration for MIDI strummer.
 *
 * This combines:
 * - Full strummer configuration (notes, mappings, features)
 * - MIDI configuration (ports, channels)
 * - Server configuration (HTTP/WebSocket ports, throttle, poll)
 */
export class MidiStrummerConfig {
  private _strummer: StrummerConfig;
  private _midi: MidiConfig;
  private _server: ServerConfig;

  constructor(data: {
    strummer?: StrummerConfig;
    midi?: MidiConfig;
    server?: ServerConfig;
  } = {}) {
    this._strummer = data.strummer ?? new StrummerConfig();
    this._midi = data.midi ?? new MidiConfig();
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

  get noteRepeater(): NoteRepeaterConfig {
    return this._strummer.noteRepeater;
  }

  get transpose(): TransposeConfig {
    return this._strummer.transpose;
  }

  get stylusButtons(): StylusButtonsConfig {
    return this._strummer.stylusButtons;
  }

  get strumRelease(): StrumReleaseConfig {
    return this._strummer.strumRelease;
  }

  get tabletButtons(): TabletButtonsConfig {
    return this._strummer.tabletButtons;
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

  // Server config accessors
  get server(): ServerConfig {
    return this._server;
  }

  get httpPort(): number | null {
    return this._server.httpPort;
  }

  get wsPort(): number | null {
    return this._server.wsPort;
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

  get velocityScale(): number {
    return this._strummer.velocityScale;
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
    let serverData: Record<string, unknown>;

    if (hasStrummerKey) {
      // Nested format: { strummer: {...}, midi: {...}, server: {...} }
      strummerData = (data.strummer ?? {}) as Record<string, unknown>;
      midiData = (data.midi ?? {}) as Record<string, unknown>;
      serverData = (data.server ?? {}) as Record<string, unknown>;
    } else {
      // Flat format: { note_duration: {...}, note_repeater: {...}, midi: {...}, server: {...} }
      // Extract midi and server, pass the rest to strummer
      midiData = (data.midi ?? {}) as Record<string, unknown>;
      serverData = (data.server ?? {}) as Record<string, unknown>;

      // Everything else goes to strummer (excluding midi and server)
      strummerData = { ...data };
      delete strummerData.midi;
      delete strummerData.server;
    }

    return new MidiStrummerConfig({
      strummer: Object.keys(strummerData).length > 0
        ? StrummerConfig.fromDict(strummerData)
        : new StrummerConfig(),
      midi: Object.keys(midiData).length > 0
        ? MidiConfig.fromDict(midiData)
        : new MidiConfig(),
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
    return {
      strummer: this._strummer.toDict(),
      midi: this._midi.toDict(),
      server: this._server.toDict(),
    };
  }

  /**
   * Save to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}