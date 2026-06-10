/**
 * Mock Strummer Client
 *
 * A drop-in replacement for StrummerWebSocketClient that emits synthetic
 * tablet, strum, config, and MIDI events without opening a real WebSocket.
 * Used for previewing the dashboard UI in the browser without a server.
 */

import {
  StrummerWebSocketClient,
  type ServerMidiDevices,
  type ServerMidiInputStatus,
} from './strummer-websocket-client.js';
import type {
  CombinedEventData,
  DeviceStatusData,
  ServerConfigData,
  StrumEventData,
} from '../types/tablet-events.js';

const MOCK_NOTES = [
  { notation: 'E', octave: 2, midiNote: 40 },
  { notation: 'A', octave: 2, midiNote: 45 },
  { notation: 'D', octave: 3, midiNote: 50 },
  { notation: 'G', octave: 3, midiNote: 55 },
  { notation: 'B', octave: 3, midiNote: 59 },
  { notation: 'E', octave: 4, midiNote: 64 },
];

function buildMockConfig(): ServerConfigData {
  const config: Record<string, unknown> = {
    strummer: {
      mode: 'strum',
      noteDuration: { min: 0.15, max: 1.5, multiplier: 1, curve: 1, spread: 'inverse', control: 'tiltXY', default: 1 },
      pitchBend: { min: -1, max: 1, multiplier: 1, curve: 4, spread: 'central', control: 'yaxis', default: 0 },
      noteVelocity: { min: 0, max: 127, multiplier: 1, curve: 4, spread: 'direct', control: 'pressure', default: 64 },
      strumming: {
        pluckVelocityScale: 4, pressureThreshold: 0.1, pressureBufferSize: 10,
        midiChannel: 1, initialNotes: ['E2','A2','D3','G3','B3','E4'], chord: 'Em',
        upperNoteSpread: 3, lowerNoteSpread: 3, invertX: false,
      },
      slide: {
        pressureThreshold: 0.1, maxBendSemitones: 24,
        pressureModulation: { type: 'aftertouch', ccNumber: 11, minValue: 0, maxValue: 127 },
      },
      strumRelease: { active: false, midiNote: 38, midiChannel: 10, maxDuration: 0.25, velocityMultiplier: 1 },
      actionRules: {
        rules: [
          { id: 'mock-primary', name: 'Toggle Transpose', button: 'button:primary', action: 'toggle-transpose', trigger: 'press' },
          { id: 'mock-secondary', name: 'Toggle Repeater', button: 'button:secondary', action: 'toggle-repeater', trigger: 'press' },
        ],
        groups: [{ id: 'chord-buttons', name: 'Chord Buttons', buttons: ['button:1','button:2','button:3','button:4'] }],
        groupRules: [{ id: 'mock-progression', name: 'A Minor Pop', groupId: 'chord-buttons', trigger: 'press',
          action: { type: 'chord-progression', progression: 'a-minor-pop', octave: 4 } }],
        startupRules: [],
      },
      chordProgressions: {
        'a-minor-pop': ['Am','F','C','G'],
        'c-major-basic': ['C','F','G','Am'],
      },
    },
    midi: { midiOutputBackend: 'rtmidi', midiOutputId: null, midiInputId: null, defaultNoteDuration: 1.5 },
    server: { device: 'devices', httpPort: 80, wsPort: 8081, httpsPort: 443, wssPort: 8082, wsMessageThrottle: 150 },
  };
  return {
    throttleMs: 50,
    notes: MOCK_NOTES.map(n => ({ notation: n.notation, octave: n.octave })),
    chord: 'Em',
    config,
    serverVersion: 'mock',
    currentConfigName: 'mock.json',
    availableConfigs: ['mock.json'],
    isSavedState: true,
  };
}

export class MockStrummerClient extends StrummerWebSocketClient {
  private mockConfig: ServerConfigData = buildMockConfig();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private lastStrumTime = 0;

  constructor() {
    super({ autoReconnect: false });
  }

  override connect(_url?: string): void {
    if (this.tickTimer) return;
    this.startTime = performance.now();
    this.lastStrumTime = this.startTime;
    queueMicrotask(() => {
      this.emit<string>('connection-state', 'connected');
      this.emit<DeviceStatusData>('device-status', {
        status: 'connected', deviceConnected: true,
        message: 'Mock tablet connected', timestamp: Date.now(),
      });
      this.emit<ServerConfigData>('config', this.mockConfig);
      this.emit<ServerMidiInputStatus>('midi-input-status', {
        connected: false, availablePorts: [], connectedPort: null, currentNotes: [],
      });
      this.emit<ServerMidiDevices>('midi-devices', {
        inputPorts: [{ id: 0, name: 'Mock MIDI In' }],
        outputPorts: [{ id: 0, name: 'Mock MIDI Out' }],
        currentInputPorts: [], currentOutputPort: null, passthroughConnections: [],
      });
    });
    this.tickTimer = setInterval(() => this.tick(), 50);
  }

  override disconnect(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    this.emit<string>('connection-state', 'disconnected');
  }

  override updateConfig(path: string, value: unknown): void {
    const segments = path.split('.');
    const root = this.mockConfig.config as Record<string, unknown> | undefined;
    if (!root) return;
    let node: Record<string, unknown> = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i];
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[segments[segments.length - 1]] = value;
    this.mockConfig = { ...this.mockConfig, isSavedState: false };
    this.emit<ServerConfigData>('config', this.mockConfig);
  }

  private tick(): void {
    const t = (performance.now() - this.startTime) / 1000;
    const x = 0.5 + 0.4 * Math.sin(t * 0.7);
    const y = 0.5 + 0.4 * Math.sin(t * 1.1 + 0.5);
    const pressure = Math.max(0, Math.sin(t * 0.9) * 0.6 + 0.3);
    const tiltX = Math.sin(t * 0.4) * 0.6;
    const tiltY = Math.cos(t * 0.5) * 0.6;
    const event: CombinedEventData = {
      x, y, pressure, tiltX, tiltY,
      tiltXY: Math.min(1, Math.max(-1, Math.sqrt(tiltX * tiltX + tiltY * tiltY) * Math.sign(tiltX * tiltY || 1))),
      primaryButtonPressed: false, secondaryButtonPressed: false,
      state: pressure > 0.1 ? 'contact' : 'hover',
      timestamp: Date.now(),
    };
    const now = performance.now();
    if (pressure > 0.4 && now - this.lastStrumTime > 700) {
      this.lastStrumTime = now;
      const strum: StrumEventData = {
        type: 'strum',
        notes: MOCK_NOTES.map((n) => ({ note: n, velocity: Math.round(40 + pressure * 80) })),
        velocity: Math.round(40 + pressure * 80),
        timestamp: event.timestamp,
      };
      event.strum = strum;
    }
    this.emit<CombinedEventData>('combined', event);
    this.emit<CombinedEventData>('tablet', event);
    if (event.strum) this.emit<StrumEventData>('strum', event.strum);
  }
}
