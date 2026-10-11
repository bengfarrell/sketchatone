import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { StrummerWebSocketServer } from '../../src/cli/server.js';
import { MidiStrummerConfig } from '../../src/models/midi-strummer-config.js';
import { Strummer } from '../../src/core/strummer.js';
import { Slider } from '../../src/core/slider.js';
import { Actions } from '../../src/core/actions.js';
import { configValidationTemplate, validateCompleteConfig } from '../../src/utils/config-validation.js';
import { RtMidiInput } from '../../src/midi/rtmidi-input.js';
import { RtMidiBackend } from '../../src/midi/rtmidi-backend.js';
import { Note } from '../../src/models/note.js';
import { resolveChordModeEntry } from '../../src/models/chord-mode.js';

describe('complete configuration apply', () => {
  let server: any;
  let directory: string;
  let client: { send: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(process.cwd(), '.config-apply-test-'));
    server = Object.create(StrummerWebSocketServer.prototype);
    server.config = new MidiStrummerConfig();
    server.strummerConfigPath = path.join(directory, 'current.json');
    server.currentConfigName = 'current.json';
    fs.writeFileSync(server.strummerConfigPath, JSON.stringify(server.config.toDict()));
    server.strummer = new Strummer();
    server.slider = new Slider();
    server.actions = new Actions(server.config, server.strummer);
    server.eventBus = { throttleMs: 150 };
    server.clearControllerState = vi.fn();
    server.wss = { clients: new Set([{ readyState: 1, send: vi.fn() }]) };
    server.broadcastMidiDevices = vi.fn();
    client = { send: vi.fn(() => expect(server.applyingConfig).not.toBe(true)) };
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = (client: any) => JSON.parse(client.send.mock.calls.at(-1)[0]).data;
  const apply = (server: any, config: any, overrides = {}) => server.handleApplyConfig(client, {
    type: 'apply-config', requestId: 'request', configName: 'current.json',
    baseConfig: server.config.toDict(), config, ...overrides,
  });

  it('refreshes complete runtime state and autosaves once', async () => {
    const config = server.config.toDict();
    config.strummer.pitch.startingOffset = 7;
    config.strummer.harmonicContext.startingRoot = 'D';
    config.strummer.strumming.initialNotes = ['D4', 'F#4'];
    config.server.wsMessageThrottle = 25;
    config.deviceButtons.buttons = [{ code: 42, name: 'Tablet' }];
    const write = vi.spyOn(server, 'writeCompleteConfig');
    await apply(server, config);
    expect(result(client).success).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(server.strummerConfigPath, 'utf8'))).toEqual(server.config.toDict());
    expect(server.actions.getPitchOffset()).toBe(7);
    expect(server.actions.getHarmonicContext().root).toBe('D');
    expect(server.eventBus.throttleMs).toBe(25);
    expect(server.clearControllerState).toHaveBeenCalledOnce();
  });

  it.each([null, [], { strummer: null, midi: {}, server: {} }])('rejects invalid input without live/file mutations', async config => {
    const previous = server.config;
    const file = fs.readFileSync(server.strummerConfigPath, 'utf8');
    await apply(server, config);
    expect(result(client).success).toBe(false);
    expect(server.config).toBe(previous);
    expect(fs.readFileSync(server.strummerConfigPath, 'utf8')).toBe(file);
    expect(server.clearControllerState).not.toHaveBeenCalled();
  });

  it('rejects stale snapshots and file identity changes', async () => {
    await apply(server, server.config.toDict(), { configName: 'other.json' });
    expect(result(client).error).toContain('changed');
    await apply(server, server.config.toDict(), { baseConfig: {} });
    expect(result(client).error).toContain('changed');
    expect(server.clearControllerState).not.toHaveBeenCalled();
  });

  it('reports persistence failure without mutation and rolls back runtime failure', async () => {
    const previous = server.config;
    const write = vi.spyOn(server, 'writeCompleteConfig').mockImplementationOnce(() => { throw new Error('disk failure'); });
    await apply(server, server.config.toDict());
    expect(result(client).error).toContain('disk failure');
    expect(server.config).toBe(previous);
    write.mockRestore();
    vi.spyOn(server, 'refreshCompleteConfig').mockRejectedValueOnce(new Error('runtime failure'));
    const config = server.config.toDict();
    config.server.wsMessageThrottle = 99;
    await apply(server, config);
    expect(result(client).error).toContain('runtime failure');
    expect(server.config).toBe(previous);
    expect(JSON.parse(fs.readFileSync(server.strummerConfigPath, 'utf8'))).toEqual(previous.toDict());
  });

  it('checks nested fields, enums, array records and range values', () => {
    const config: any = server.config.toDict();
    const template = configValidationTemplate(config);
    expect(validateCompleteConfig(config, template)).toEqual([]);
    config.strummer.chordModes = { major: [{ degree: 3, quality: 'minor', extension: 'maj7' }] };
    config.deviceButtons.buttons = [{ code: 'wrong' }];
    config.strummer.strumming.pressureBufferSize = 0;
    config.midi.inputMode = 'invalid';
    config.server.unrecognized = true;
    expect(validateCompleteConfig(config, template).length).toBeGreaterThanOrEqual(5);
  });

  it('validates and applies the bundled jazz half-diminished chord', async () => {
    const bundled = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'python/sketchatone/ui/assets/default_config.json'), 'utf8'));
    const config = server.config.toDict();
    config.strummer.chordModes = bundled.strummer.chordModes;
    expect(validateCompleteConfig(config, configValidationTemplate(new MidiStrummerConfig().toDict()))).toEqual([]);
    await apply(server, config);
    expect(result(client).success).toBe(true);
    const resolved = resolveChordModeEntry(server.config.strummer.chordModes.jazz[2]);
    expect(resolved?.chordSuffix).toBe('m7b5');
    expect(Note.parseChord(`B${resolved?.chordSuffix}`, 4)).toEqual([
      expect.objectContaining({ notation: 'B', octave: 4 }),
      expect.objectContaining({ notation: 'D', octave: 5 }),
      expect.objectContaining({ notation: 'F', octave: 5 }),
      expect.objectContaining({ notation: 'A', octave: 5 }),
    ]);
  });

  it.each([
    ['half-diminished', 'none'],
    ['half-diminished', '7'],
    ['major', 'm7b5'],
    ['minor', 'm7b5'],
  ])('rejects incompatible %s/%s chord combinations', (quality, extension) => {
    expect(resolveChordModeEntry({ degree: 7, alteration: 0, quality, extension })).toBeNull();
  });

  it('refreshes MIDI channel, ports, exclusions and duration without per-property saves', async () => {
    server.backend = { setChannel: vi.fn(), disconnect: vi.fn(), connect: vi.fn().mockResolvedValue(true) };
    server.midiInput = {
      disconnect: vi.fn(), connectMultiple: vi.fn().mockResolvedValue(true),
      setPassthroughCallback: vi.fn(),
    };
    server.registerMidiInputCallback = vi.fn();
    server.bridge = { noteDuration: 1 };
    const config: any = server.config.toDict();
    config.midi.outputPort = 2;
    config.midi.inputPort = [3];
    config.midi.inputExclude = ['exclude'];
    config.strummer.strumming.midiChannel = 5;
    config.strummer.noteDuration.default = 2;
    await apply(server, config);
    expect(result(client).success).toBe(true);
    expect(server.backend.setChannel).toHaveBeenCalledWith(4);
    expect(server.backend.connect).toHaveBeenCalledWith(2);
    expect(server.midiInput.connectMultiple).toHaveBeenCalledWith([3], ['exclude']);
    expect(server.bridge.noteDuration).toBe(2);
  });

  it.each(['output', 'single input', 'multiple inputs'])('rolls back a failed explicit %s connection', async selection => {
    server.config.midi.outputPort = 1;
    server.config.midi.inputPort = [1];
    fs.writeFileSync(server.strummerConfigPath, JSON.stringify(server.config.toDict()));
    const previous = server.config;
    const file = fs.readFileSync(server.strummerConfigPath, 'utf8');
    server.backend = { setChannel: vi.fn(), disconnect: vi.fn(), connect: vi.fn().mockResolvedValue(true) };
    server.midiInput = {
      disconnect: vi.fn(), connect: vi.fn().mockResolvedValue(true),
      connectMultiple: vi.fn().mockResolvedValue(true), connectAll: vi.fn().mockResolvedValue(false),
      setPassthroughCallback: vi.fn(),
    };
    server.registerMidiInputCallback = vi.fn();
    const config = previous.toDict();
    if (selection === 'output') {
      config.midi.outputPort = 2;
      server.backend.connect.mockResolvedValueOnce(false);
    } else if (selection === 'single input') {
      config.midi.inputPort = 'missing input';
      server.midiInput.connect.mockResolvedValueOnce(false);
    } else {
      config.midi.inputPort = [3];
      server.midiInput.connectMultiple.mockResolvedValueOnce(false);
    }
    await apply(server, config);
    expect(result(client).success).toBe(false);
    expect(result(client).error).toContain('Failed to connect MIDI');
    expect(result(client).error).not.toContain('Rollback failed');
    expect(server.config).toBe(previous);
    expect(JSON.parse(fs.readFileSync(server.strummerConfigPath, 'utf8'))).toEqual(JSON.parse(file));
    expect(server.applyingConfig).toBe(false);
    if (selection === 'output') {
      expect(server.backend.connect).toHaveBeenLastCalledWith(1);
    } else {
      expect(server.midiInput.connectMultiple).toHaveBeenLastCalledWith([1], previous.midi.inputExclude);
    }
    const observer: any = [...server.wss.clients][0];
    const snapshot = JSON.parse(observer.send.mock.calls.at(-1)[0]);
    expect(snapshot.data.config).toEqual(previous.toDict());
    expect(snapshot.data.isSavedState).toBe(true);
  });

  it.each([[], null])('allows intentional disconnects and unavailable automatic inputs: %j', async port => {
    server.config.midi.outputPort = 1;
    server.config.midi.inputPort = [2];
    server.backend = { setChannel: vi.fn(), disconnect: vi.fn(), connect: vi.fn().mockResolvedValue(false) };
    server.midiInput = {
      disconnect: vi.fn(), connect: vi.fn(), connectMultiple: vi.fn(),
      connectAll: vi.fn().mockResolvedValue(false), setPassthroughCallback: vi.fn(),
    };
    server.registerMidiInputCallback = vi.fn();
    const config = server.config.toDict();
    config.midi.outputPort = null;
    config.midi.inputPort = port;
    await apply(server, config);
    expect(result(client).success).toBe(true);
    expect(server.backend.disconnect).toHaveBeenCalledOnce();
    expect(server.backend.connect).not.toHaveBeenCalled();
    expect(server.midiInput.connect).not.toHaveBeenCalled();
    expect(server.midiInput.connectMultiple).not.toHaveBeenCalled();
    expect(server.midiInput.connectAll).toHaveBeenCalledTimes(port === null ? 1 : 0);
  });

  it('broadcasts after releasing the apply guard and persists subsequent updates', async () => {
    const duringRefresh = vi.fn(() => {
      expect(server.applyingConfig).toBe(true);
      server.broadcastConfig();
      server.persistConfigToFile();
    });
    server.strummer.on('notes_changed', duringRefresh);
    const config = server.config.toDict();
    config.server.wsMessageThrottle = 25;
    await apply(server, config);
    expect(server.applyingConfig).toBe(false);
    expect(duringRefresh).toHaveBeenCalled();
    const observer: any = [...server.wss.clients][0];
    expect(observer.send).toHaveBeenCalledOnce();
    expect(JSON.parse(observer.send.mock.calls[0][0]).data.config).toEqual(server.config.toDict());
    server.handleConfigUpdate('server.wsMessageThrottle', 40);
    expect(JSON.parse(fs.readFileSync(server.strummerConfigPath, 'utf8')).server.wsMessageThrottle).toBe(40);
    expect(observer.send).toHaveBeenCalledTimes(2);
  });

  it.each(['apply', 'update', 'load'])('clears stale passthrough forwarding on %s', async surface => {
    server.midiInput = new RtMidiInput();
    server.backend = Object.create(RtMidiBackend.prototype);
    server.backend._isConnected = true;
    server.backend._midiOut = { sendMessage: vi.fn() };
    server.backend.setChannel = vi.fn();
    server.config.midi.midiPassthrough = [{ inputPort: 3, outputPort: 2 }];
    server.registerMidiPassthrough();
    const send = server.backend._midiOut.sendMessage;
    server.midiInput.handleMidiMessage([0xb0, 1, 50], 3, 'input');
    expect(send).toHaveBeenCalledOnce();
    const clear = vi.spyOn(server.midiInput, 'setPassthroughCallback');
    if (surface === 'apply') {
      vi.spyOn(server.midiInput, 'disconnect').mockImplementation(() => {});
      vi.spyOn(server.midiInput, 'connectAll').mockResolvedValue(false);
      server.registerMidiInputCallback = vi.fn();
      const config = server.config.toDict();
      config.midi.midiPassthrough = [];
      await apply(server, config);
      expect(result(client).success).toBe(true);
    } else if (surface === 'update') {
      server.handleConfigUpdate('midi.midiPassthrough', []);
    } else {
      server.strummerConfigDir = directory;
      server.handleLoadConfig('current.json');
    }
    expect(clear).toHaveBeenLastCalledWith(null);
    server.midiInput.handleMidiMessage([0xb0, 1, 50], 3, 'input');
    expect(send).toHaveBeenCalledOnce();
  });

  it('broadcasts complete snapshots to secure and ordinary websocket clients', () => {
    const ordinary = { readyState: 1, send: vi.fn() };
    const secure = { readyState: 1, send: vi.fn() };
    server.wss = { clients: new Set([ordinary]) };
    server.wssSecure = { clients: new Set([secure]) };
    server.listConfigs = () => ['current.json'];
    (StrummerWebSocketServer.prototype as any).broadcastConfig.call(server, true);
    for (const client of [ordinary, secure]) {
      expect(JSON.parse(client.send.mock.calls[0][0]).data.configValidationTemplate).toBeDefined();
    }
  });
});
