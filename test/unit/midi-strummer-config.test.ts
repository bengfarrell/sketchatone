import { describe, it, expect } from 'vitest';
import {
  MidiConfig,
  DEFAULT_MIDI_CONFIG,
  MidiStrummerConfig,
  ServerConfig,
  DEFAULT_SERVER_CONFIG,
} from '../../src/models/midi-strummer-config';
import { StrummerConfig, StrummingConfig } from '../../src/models/strummer-config';

describe('ServerConfig', () => {
  describe('Defaults', () => {
    it('should have correct default values', () => {
      const config = new ServerConfig();
      expect(config.device).toBeNull();
      expect(config.httpPort).toBeNull();
      expect(config.wsPort).toBeNull();
      expect(config.wsMessageThrottle).toBe(150);
      expect(config.deviceFindingPollInterval).toBeNull();
    });

    it('should have matching DEFAULT_SERVER_CONFIG', () => {
      expect(DEFAULT_SERVER_CONFIG.device).toBeNull();
      expect(DEFAULT_SERVER_CONFIG.httpPort).toBeNull();
      expect(DEFAULT_SERVER_CONFIG.wsPort).toBeNull();
      expect(DEFAULT_SERVER_CONFIG.wsMessageThrottle).toBe(150);
      expect(DEFAULT_SERVER_CONFIG.deviceFindingPollInterval).toBeNull();
    });
  });

  describe('fromDict', () => {
    it('should create from dictionary with device field', () => {
      const config = ServerConfig.fromDict({
        device: 'devices',
        httpPort: 3000,
        wsPort: 8081,
      });
      expect(config.device).toBe('devices');
      expect(config.httpPort).toBe(3000);
      expect(config.wsPort).toBe(8081);
    });

    it('should create from dictionary with absolute device path', () => {
      const config = ServerConfig.fromDict({
        device: '/opt/sketchatone/configs/devices',
      });
      expect(config.device).toBe('/opt/sketchatone/configs/devices');
    });

    it('should create from dictionary with device file path', () => {
      const config = ServerConfig.fromDict({
        device: '/opt/sketchatone/configs/devices/xp-pen.json',
      });
      expect(config.device).toBe('/opt/sketchatone/configs/devices/xp-pen.json');
    });

    it('should create from dictionary with null device', () => {
      const config = ServerConfig.fromDict({
        device: null,
      });
      expect(config.device).toBeNull();
    });

    it('should create from dictionary with snake_case keys', () => {
      const config = ServerConfig.fromDict({
        device: 'devices',
        http_port: 3000,
        ws_port: 8081,
        ws_message_throttle: 200,
        device_finding_poll_interval: 5000,
      });
      expect(config.device).toBe('devices');
      expect(config.httpPort).toBe(3000);
      expect(config.wsPort).toBe(8081);
      expect(config.wsMessageThrottle).toBe(200);
      expect(config.deviceFindingPollInterval).toBe(5000);
    });

    it('should create from dictionary with camelCase keys', () => {
      const config = ServerConfig.fromDict({
        device: 'devices',
        httpPort: 4000,
        wsPort: 9000,
        wsMessageThrottle: 100,
        deviceFindingPollInterval: 3000,
      });
      expect(config.device).toBe('devices');
      expect(config.httpPort).toBe(4000);
      expect(config.wsPort).toBe(9000);
      expect(config.wsMessageThrottle).toBe(100);
      expect(config.deviceFindingPollInterval).toBe(3000);
    });
  });

  describe('toDict', () => {
    it('should include device field', () => {
      const config = new ServerConfig({ device: 'devices' });
      const dict = config.toDict();
      expect(dict.device).toBe('devices');
    });

    it('should include device as null when not set', () => {
      const config = new ServerConfig();
      const dict = config.toDict();
      expect(dict.device).toBeNull();
    });

    it('should convert to dictionary with all fields', () => {
      const config = new ServerConfig({
        device: '/opt/sketchatone/configs/devices',
        httpPort: 3000,
        wsPort: 8081,
        wsMessageThrottle: 200,
        deviceFindingPollInterval: 5000,
      });
      const dict = config.toDict();
      expect(dict.device).toBe('/opt/sketchatone/configs/devices');
      expect(dict.httpPort).toBe(3000);
      expect(dict.wsPort).toBe(8081);
      expect(dict.wsMessageThrottle).toBe(200);
      expect(dict.deviceFindingPollInterval).toBe(5000);
    });
  });

  describe('Roundtrip', () => {
    it('should roundtrip through dictionary', () => {
      const original = new ServerConfig({
        device: '/opt/sketchatone/configs/devices',
        httpPort: 3000,
        wsPort: 8081,
        wsMessageThrottle: 150,
        deviceFindingPollInterval: 2000,
      });
      const dict = original.toDict();
      const restored = ServerConfig.fromDict(dict);
      expect(restored.device).toBe(original.device);
      expect(restored.httpPort).toBe(original.httpPort);
      expect(restored.wsPort).toBe(original.wsPort);
      expect(restored.wsMessageThrottle).toBe(original.wsMessageThrottle);
      expect(restored.deviceFindingPollInterval).toBe(original.deviceFindingPollInterval);
    });
  });
});

describe('MidiConfig', () => {
  it('should have correct default values', () => {
    const config = new MidiConfig();
    expect(config.outputPort).toBeNull();
    expect(config.inputPort).toBeNull();
    expect(config.channel).toBe(0);
    expect(config.useVirtualPorts).toBe(false);
  });

  it('should create from dictionary with snake_case', () => {
    const config = MidiConfig.fromDict({
      output_port: 'IAC Driver Bus 1',
      input_port: 'IAC Driver Bus 2',
      channel: 5,
      use_virtual_ports: true,
    });
    expect(config.outputPort).toBe('IAC Driver Bus 1');
    expect(config.inputPort).toBe('IAC Driver Bus 2');
    expect(config.channel).toBe(5);
    expect(config.useVirtualPorts).toBe(true);
  });

  it('should create from dictionary with camelCase', () => {
    const config = MidiConfig.fromDict({
      outputPort: 'USB MIDI',
      inputPort: null,
      channel: 10,
      useVirtualPorts: false,
    });
    expect(config.outputPort).toBe('USB MIDI');
    expect(config.inputPort).toBeNull();
    expect(config.channel).toBe(10);
    expect(config.useVirtualPorts).toBe(false);
  });

  it('should convert to dictionary', () => {
    const config = new MidiConfig({
      outputPort: 'Virtual Port',
      inputPort: 'Feedback Port',
      channel: 3,
      useVirtualPorts: true,
    });
    const dict = config.toDict();
    expect(dict.outputPort).toBe('Virtual Port');
    expect(dict.inputPort).toBe('Feedback Port');
    expect(dict.channel).toBe(3);
    expect(dict.useVirtualPorts).toBe(true);
  });
});

describe('MidiStrummerConfig', () => {
  describe('Basic', () => {
    it('should have correct default values', () => {
      const config = new MidiStrummerConfig();
      // Strummer defaults
      expect(config.strummer.strumming.pressureThreshold).toBe(0.1);
      expect(config.strummer.strumming.initialNotes).toEqual(['C4', 'E4', 'G4']);
      // MIDI defaults
      expect(config.midi.outputPort).toBeNull();
      expect(config.midi.channel).toBe(0);
    });

    it('should create from separate configs', () => {
      const strummer = new StrummerConfig({
        strumming: new StrummingConfig({
          pressureThreshold: 0.2,
          initialNotes: ['D4', 'F#4', 'A4'],
        }),
      });
      const midi = new MidiConfig({
        outputPort: 'Test Port',
        channel: 5,
      });
      const config = MidiStrummerConfig.fromSeparateConfigs(strummer, midi);
      expect(config.strummer.strumming.pressureThreshold).toBe(0.2);
      expect(config.midi.outputPort).toBe('Test Port');
    });

    it('should return strummer config', () => {
      const config = new MidiStrummerConfig();
      const strummer = config.toStrummerConfig();
      expect(strummer).toBeInstanceOf(StrummerConfig);
      expect(strummer.strumming.initialNotes).toEqual(['C4', 'E4', 'G4']);
    });

    it('should return MIDI config', () => {
      const config = new MidiStrummerConfig();
      const midi = config.toMidiConfig();
      expect(midi).toBeInstanceOf(MidiConfig);
      expect(midi.channel).toBe(0);
    });
  });

  describe('New Format', () => {
    it('should create from dictionary with new format', () => {
      const config = MidiStrummerConfig.fromDict({
        strummer: {
          strumming: {
            pressureThreshold: 0.15,
            initialNotes: ['E4', 'G4', 'B4'],
          },
          noteRepeater: {
            active: true,
          },
        },
        midi: {
          outputPort: 'IAC Driver',
          channel: 3,
        },
      });
      expect(config.strummer.strumming.pressureThreshold).toBe(0.15);
      expect(config.strummer.strumming.initialNotes).toEqual(['E4', 'G4', 'B4']);
      expect(config.strummer.noteRepeater.active).toBe(true);
      expect(config.midi.outputPort).toBe('IAC Driver');
      expect(config.midi.channel).toBe(3);
    });

    it('should convert to dictionary', () => {
      const config = new MidiStrummerConfig();
      const dict = config.toDict();
      expect(dict.strummer).toBeDefined();
      expect(dict.midi).toBeDefined();
      expect(dict.strummer.strumming).toBeDefined();
      expect(dict.midi.channel).toBe(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should provide strummer properties', () => {
      const config = new MidiStrummerConfig({
        strummer: new StrummerConfig({
          strumming: new StrummingConfig({
            pressureThreshold: 0.3,
            pluckVelocityScale: 4.0,
            initialNotes: ['G4', 'B4', 'D5'],
            chord: 'G',
          }),
        }),
      });
      expect(config.pressureThreshold).toBe(0.3);
      expect(config.velocityScale).toBe(4.0);
      expect(config.notes).toEqual(['G4', 'B4', 'D5']);
      expect(config.chord).toBe('G');
    });

    it('should provide MIDI properties', () => {
      const config = new MidiStrummerConfig({
        midi: new MidiConfig({
          outputPort: 'Test Output',
          inputPort: 'Test Input',
          channel: 8,
          useVirtualPorts: true,
        }),
      });
      expect(config.outputPort).toBe('Test Output');
      expect(config.inputPort).toBe('Test Input');
      expect(config.channel).toBe(8);
      expect(config.useVirtualPorts).toBe(true);
    });
  });

  describe('Server Config', () => {
    it('should have default server config', () => {
      const config = new MidiStrummerConfig();
      expect(config.server).toBeDefined();
      expect(config.server.device).toBeNull();
      expect(config.server.httpPort).toBeNull();
      expect(config.server.wsPort).toBeNull();
    });

    it('should create with custom server config', () => {
      const config = new MidiStrummerConfig({
        server: new ServerConfig({
          device: 'devices',
          httpPort: 3000,
          wsPort: 8081,
        }),
      });
      expect(config.server.device).toBe('devices');
      expect(config.server.httpPort).toBe(3000);
      expect(config.server.wsPort).toBe(8081);
    });

    it('should parse server config from dictionary', () => {
      const config = MidiStrummerConfig.fromDict({
        server: {
          device: '/opt/sketchatone/configs/devices',
          httpPort: 4000,
          wsPort: 9000,
          wsMessageThrottle: 100,
        },
      });
      expect(config.server.device).toBe('/opt/sketchatone/configs/devices');
      expect(config.server.httpPort).toBe(4000);
      expect(config.server.wsPort).toBe(9000);
      expect(config.server.wsMessageThrottle).toBe(100);
    });

    it('should parse server config with snake_case keys', () => {
      const config = MidiStrummerConfig.fromDict({
        server: {
          device: 'devices',
          http_port: 3000,
          ws_port: 8081,
          ws_message_throttle: 200,
          device_finding_poll_interval: 5000,
        },
      });
      expect(config.server.device).toBe('devices');
      expect(config.server.httpPort).toBe(3000);
      expect(config.server.wsPort).toBe(8081);
      expect(config.server.wsMessageThrottle).toBe(200);
      expect(config.server.deviceFindingPollInterval).toBe(5000);
    });

    it('should include server in toDict output', () => {
      const config = new MidiStrummerConfig({
        server: new ServerConfig({
          device: 'devices',
          httpPort: 3000,
        }),
      });
      const dict = config.toDict();
      expect(dict.server).toBeDefined();
      expect(dict.server.device).toBe('devices');
      expect(dict.server.httpPort).toBe(3000);
    });

    it('should return server config via toServerConfig', () => {
      const config = new MidiStrummerConfig({
        server: new ServerConfig({
          device: '/opt/sketchatone/configs/devices',
          httpPort: 3000,
        }),
      });
      const serverConfig = config.toServerConfig();
      expect(serverConfig).toBeInstanceOf(ServerConfig);
      expect(serverConfig.device).toBe('/opt/sketchatone/configs/devices');
      expect(serverConfig.httpPort).toBe(3000);
    });
  });

  describe('Roundtrip', () => {
    it('should roundtrip through new format dictionary', () => {
      const original = new MidiStrummerConfig({
        strummer: new StrummerConfig({
          strumming: new StrummingConfig({
            pressureThreshold: 0.18,
            pluckVelocityScale: 3.5,
            initialNotes: ['C4', 'E4', 'G4', 'B4'],
            chord: 'Cmaj7',
            midiChannel: 2,
          }),
        }),
        midi: new MidiConfig({
          outputPort: 'Roundtrip Port',
          channel: 4,
          useVirtualPorts: true,
        }),
      });
      const dict = original.toDict();
      const restored = MidiStrummerConfig.fromDict(dict);
      expect(restored.strummer.strumming.pressureThreshold).toBe(0.18);
      expect(restored.strummer.strumming.pluckVelocityScale).toBe(3.5);
      expect(restored.strummer.strumming.initialNotes).toEqual(['C4', 'E4', 'G4', 'B4']);
      expect(restored.strummer.strumming.chord).toBe('Cmaj7');
      expect(restored.midi.outputPort).toBe('Roundtrip Port');
      expect(restored.midi.channel).toBe(4);
      expect(restored.midi.useVirtualPorts).toBe(true);
    });

    it('should roundtrip with server config', () => {
      const original = new MidiStrummerConfig({
        server: new ServerConfig({
          device: '/opt/sketchatone/configs/devices',
          httpPort: 3000,
          wsPort: 8081,
          wsMessageThrottle: 150,
          deviceFindingPollInterval: 2000,
        }),
      });
      const dict = original.toDict();
      const restored = MidiStrummerConfig.fromDict(dict);
      expect(restored.server.device).toBe('/opt/sketchatone/configs/devices');
      expect(restored.server.httpPort).toBe(3000);
      expect(restored.server.wsPort).toBe(8081);
      expect(restored.server.wsMessageThrottle).toBe(150);
      expect(restored.server.deviceFindingPollInterval).toBe(2000);
    });
  });
});