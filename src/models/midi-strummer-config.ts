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
 *
 * The global keyboard listener emits `key:<char>` events directly; per-key
 * labels live under `deviceButtons.keys`. This section only gates whether
 * the listener runs at all.
 */
export interface KeyboardConfigData {
  /** When true, the global keyboard listener starts with the server. */
  enabled: boolean;
}

export const DEFAULT_KEYBOARD_CONFIG: KeyboardConfigData = {
  enabled: true,
};

export class KeyboardConfig implements KeyboardConfigData {
  enabled: boolean;

  constructor(data: Partial<KeyboardConfigData> = {}) {
    this.enabled = data.enabled ?? DEFAULT_KEYBOARD_CONFIG.enabled;
  }

  static fromDict(data: Record<string, unknown>): KeyboardConfig {
    return new KeyboardConfig({
      enabled: (data.enabled ?? DEFAULT_KEYBOARD_CONFIG.enabled) as boolean,
    });
  }

  toDict(): KeyboardConfigData {
    return { enabled: this.enabled };
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
 * MIDI passthrough connection configuration
 */
export interface MidiPassthroughConnection {
  /** Input port ID or name to forward from */
  inputPort: string | number;
  /** Output port ID or name to forward to */
  outputPort: string | number;
}

/**
 * MIDI input mode - how incoming MIDI notes drive the strummer strings.
 *   - 'direct'     : held MIDI notes become the strummer notes (1:1)
 *   - 'majorScale' : lowest held note is the root of a major scale
 *   - 'minorScale' : lowest held note is the root of a natural minor scale
 *   - 'autoScale'  : 1 note  -> neutral scale [1, 2, 4, 5]
 *                    2 notes -> major or minor scale (minor 3rd interval -> minor)
 *                    >2 notes -> fall back to direct
 */
export type MidiInputMode = 'direct' | 'majorScale' | 'minorScale' | 'autoScale';

export const VALID_MIDI_INPUT_MODES: readonly MidiInputMode[] = ['direct', 'majorScale', 'minorScale', 'autoScale'];
export const DEFAULT_MIDI_INPUT_MODE: MidiInputMode = 'direct';

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
  /** How incoming MIDI notes drive the strummer strings */
  inputMode: MidiInputMode;
  /** Default MIDI channel (0-15 in config files, displayed as 1-16 in CLI) */
  channel: number;
  /** Whether to use virtual MIDI ports */
  useVirtualPorts: boolean;
  /** List of port name patterns to exclude from MIDI input auto-connect */
  inputExclude: string[];
  /** List of port name patterns to hide from the MIDI output picker (case-insensitive substring match) */
  outputExclude: string[];
  /** Name for JACK client (default: "sketchatone") */
  jackClientName: string;
  /** JACK auto-connect mode (default: "chain0") */
  jackAutoConnect: string | null;
  /** Default note duration in seconds (fallback when strummer.noteDuration is not configured) */
  defaultNoteDuration: number;
  /** Delay in seconds after each MIDI message (default: 0). Use e.g. 0.002 (2 ms) on Raspberry Pi when notes stick */
  midiInterMessageDelay: number;
  /** MIDI passthrough connections - forward MIDI from inputs to outputs */
  midiPassthrough: MidiPassthroughConnection[];
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
 * Default MIDI output exclusion patterns.
 * Hides our own MidiIn client from the output picker so users can't
 * accidentally route Sketchatone into itself (the loopback footgun).
 * Midi Through is intentionally NOT excluded here: it's a legitimate
 * output target for chaining into another app.
 */
export const DEFAULT_MIDI_OUTPUT_EXCLUDE: string[] = [
  'sketchatone',      // Our own MidiIn client (shows up as a writable sink)
];

/**
 * Default MIDI configuration
 */
export const DEFAULT_MIDI_CONFIG: MidiConfigData = {
  midiOutputBackend: 'rtmidi',
  outputPort: null,
  inputPort: null,
  inputMode: DEFAULT_MIDI_INPUT_MODE,
  channel: 0,
  useVirtualPorts: false,
  inputExclude: DEFAULT_MIDI_INPUT_EXCLUDE,
  outputExclude: DEFAULT_MIDI_OUTPUT_EXCLUDE,
  jackClientName: 'sketchatone',
  jackAutoConnect: 'chain0',
  defaultNoteDuration: 1.5,
  midiInterMessageDelay: 0,
  midiPassthrough: [],
};

/**
 * MIDI configuration class
 */
export class MidiConfig implements MidiConfigData {
  midiOutputBackend: 'rtmidi' | 'jack';
  outputPort: string | number | null;
  inputPort: string | number | null;
  inputMode: MidiInputMode;
  channel: number;
  useVirtualPorts: boolean;
  inputExclude: string[];
  outputExclude: string[];
  jackClientName: string;
  jackAutoConnect: string | null;
  defaultNoteDuration: number;
  midiInterMessageDelay: number;
  midiPassthrough: MidiPassthroughConnection[];

  constructor(data: Partial<MidiConfigData> = {}) {
    this.midiOutputBackend = data.midiOutputBackend ?? DEFAULT_MIDI_CONFIG.midiOutputBackend;
    this.outputPort = data.outputPort ?? DEFAULT_MIDI_CONFIG.outputPort;
    this.inputPort = data.inputPort ?? DEFAULT_MIDI_CONFIG.inputPort;
    this.inputMode = data.inputMode ?? DEFAULT_MIDI_CONFIG.inputMode;
    this.channel = data.channel ?? DEFAULT_MIDI_CONFIG.channel;
    this.useVirtualPorts = data.useVirtualPorts ?? DEFAULT_MIDI_CONFIG.useVirtualPorts;
    this.inputExclude = data.inputExclude ?? [...DEFAULT_MIDI_INPUT_EXCLUDE];
    this.outputExclude = data.outputExclude ?? [...DEFAULT_MIDI_OUTPUT_EXCLUDE];
    this.jackClientName = data.jackClientName ?? DEFAULT_MIDI_CONFIG.jackClientName;
    this.jackAutoConnect = data.jackAutoConnect ?? DEFAULT_MIDI_CONFIG.jackAutoConnect;
    this.defaultNoteDuration = data.defaultNoteDuration ?? DEFAULT_MIDI_CONFIG.defaultNoteDuration;
    this.midiInterMessageDelay = data.midiInterMessageDelay ?? DEFAULT_MIDI_CONFIG.midiInterMessageDelay;
    this.midiPassthrough = data.midiPassthrough ?? [];
  }

  /**
   * Create from dictionary (supports both snake_case and camelCase)
   */
  static fromDict(data: Record<string, unknown>): MidiConfig {
    return new MidiConfig({
      midiOutputBackend: (data.midi_output_backend ?? data.midiOutputBackend ?? 'rtmidi') as 'rtmidi' | 'jack',
      outputPort: (data.output_port ?? data.outputPort ?? data.midi_output_id ?? data.midiOutputId) as string | number | null | undefined,
      inputPort: (data.input_port ?? data.inputPort ?? data.midi_input_id ?? data.midiInputId) as string | number | null | undefined,
      inputMode: (() => {
        const raw = (data.input_mode ?? data.inputMode) as string | undefined;
        return VALID_MIDI_INPUT_MODES.includes(raw as MidiInputMode) ? (raw as MidiInputMode) : undefined;
      })(),
      channel: data.channel as number | undefined,
      useVirtualPorts: (data.use_virtual_ports ?? data.useVirtualPorts) as boolean | undefined,
      inputExclude: (data.input_exclude ?? data.inputExclude ?? data.midi_input_exclude ?? data.midiInputExclude) as string[] | undefined,
      outputExclude: (data.output_exclude ?? data.outputExclude ?? data.midi_output_exclude ?? data.midiOutputExclude) as string[] | undefined,
      jackClientName: (data.jack_client_name ?? data.jackClientName ?? 'sketchatone') as string,
      jackAutoConnect: (data.jack_auto_connect ?? data.jackAutoConnect ?? 'chain0') as string | null | undefined,
      defaultNoteDuration: (data.default_note_duration ?? data.defaultNoteDuration ?? data.note_duration ?? data.noteDuration) as number | undefined,
      midiInterMessageDelay: (data.midi_inter_message_delay ?? data.midiInterMessageDelay ?? 0) as number,
      midiPassthrough: (data.midi_passthrough ?? data.midiPassthrough ?? []) as MidiPassthroughConnection[],
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
      inputMode: this.inputMode,
      channel: this.channel,
      useVirtualPorts: this.useVirtualPorts,
      inputExclude: this.inputExclude,
      outputExclude: this.outputExclude,
      jackClientName: this.jackClientName,
      jackAutoConnect: this.jackAutoConnect,
      defaultNoteDuration: this.defaultNoteDuration,
      midiInterMessageDelay: this.midiInterMessageDelay,
      midiPassthrough: this.midiPassthrough,
    };
  }
}

/**
 * A single physical device button with its HID scan code and a user-editable name
 */
export interface DeviceButtonData {
  code: number;
  name: string;
}

/**
 * A single keyboard key captured by the global keyboard listener, with a
 * user-editable name. Referenced by action rules as `key:<char>`.
 */
export interface DeviceKeyData {
  key: string;
  name: string;
}

/**
 * Device buttons configuration data
 */
export interface DeviceButtonsConfigData {
  /** Ordered list of known device buttons (HID aux codes) */
  buttons: DeviceButtonData[];
  /** Ordered list of known keyboard keys */
  keys: DeviceKeyData[];
}

export const DEFAULT_DEVICE_BUTTONS_CONFIG: DeviceButtonsConfigData = {
  buttons: [],
  keys: [],
};

/**
 * Device buttons configuration class
 */
export class DeviceButtonsConfig implements DeviceButtonsConfigData {
  buttons: DeviceButtonData[];
  keys: DeviceKeyData[];

  constructor(data: Partial<DeviceButtonsConfigData> = {}) {
    this.buttons = data.buttons ? data.buttons.map(b => ({ code: b.code, name: b.name })) : [];
    this.keys = data.keys ? data.keys.map(k => ({ key: k.key, name: k.name })) : [];
  }

  static fromDict(data: Record<string, unknown>): DeviceButtonsConfig {
    const rawButtons = (data.buttons ?? []) as Array<Record<string, unknown>>;
    const buttons: DeviceButtonData[] = rawButtons
      .filter(b => typeof b.code === 'number')
      .map(b => ({
        code: b.code as number,
        name: (typeof b.name === 'string' && b.name.length > 0)
          ? (b.name as string)
          : `Button ${(b.code as number)}`,
      }));
    const rawKeys = (data.keys ?? []) as Array<Record<string, unknown>>;
    const keys: DeviceKeyData[] = rawKeys
      .filter(k => typeof k.key === 'string' && (k.key as string).length > 0)
      .map(k => ({
        key: k.key as string,
        name: (typeof k.name === 'string' && k.name.length > 0)
          ? (k.name as string)
          : `Key ${(k.key as string).toUpperCase()}`,
      }));
    return new DeviceButtonsConfig({ buttons, keys });
  }

  toDict(): DeviceButtonsConfigData {
    return {
      buttons: this.buttons.map(b => ({ code: b.code, name: b.name })),
      keys: this.keys.map(k => ({ key: k.key, name: k.name })),
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
  deviceButtons: DeviceButtonsConfigData;
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
  private _deviceButtons: DeviceButtonsConfig;

  constructor(data: {
    strummer?: StrummerConfig;
    midi?: MidiConfig;
    keyboard?: KeyboardConfig;
    server?: ServerConfig;
    deviceButtons?: DeviceButtonsConfig;
  } = {}) {
    this._strummer = data.strummer ?? new StrummerConfig();
    this._midi = data.midi ?? new MidiConfig();
    this._keyboard = data.keyboard ?? new KeyboardConfig();
    this._server = data.server ?? new ServerConfig();
    this._deviceButtons = data.deviceButtons ?? new DeviceButtonsConfig();
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

  // Device buttons accessor
  get deviceButtons(): DeviceButtonsConfig {
    return this._deviceButtons;
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
    const deviceButtonsData = (data.device_buttons ?? data.deviceButtons ?? {}) as Record<string, unknown>;

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

      // Everything else goes to strummer (excluding midi, keyboard, server, deviceButtons)
      strummerData = { ...data };
      delete strummerData.midi;
      delete strummerData.keyboard;
      delete strummerData.server;
      delete strummerData.device_buttons;
      delete strummerData.deviceButtons;
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
      deviceButtons: Object.keys(deviceButtonsData).length > 0
        ? DeviceButtonsConfig.fromDict(deviceButtonsData)
        : new DeviceButtonsConfig(),
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
      deviceButtons: this._deviceButtons.toDict(),
    };

    result.keyboard = this._keyboard.toDict();

    return result;
  }

  /**
   * Save to a JSON file
   */
  toJsonFile(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.toDict(), null, 2));
  }
}