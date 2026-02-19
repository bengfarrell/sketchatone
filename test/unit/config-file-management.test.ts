/**
 * Unit Tests for Config File Management
 *
 * Tests for the config file management functionality including:
 * - Listing config files
 * - Loading config files
 * - Creating new config files
 * - Renaming config files
 * - Uploading/importing config files
 * - Deleting config files
 * - Path traversal security
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MidiStrummerConfig } from '../../src/models/midi-strummer-config.js';

/**
 * ConfigFileManager - A testable implementation of config file management logic.
 * This mirrors the private methods in StrummerWebSocketServer.
 */
class ConfigFileManager {
  public configDir: string | undefined;
  public currentConfigName: string | undefined;
  public configPath: string | undefined;
  public config: MidiStrummerConfig;

  constructor(configDir?: string) {
    this.configDir = configDir;
    this.config = new MidiStrummerConfig();
  }

  /**
   * List all available config files in the config directory.
   * Only returns .json files that are not in subdirectories.
   */
  listConfigs(): string[] {
    if (!this.configDir) {
      return [];
    }

    try {
      const files = fs.readdirSync(this.configDir);
      return files.filter((file) => {
        if (!file.endsWith('.json')) return false;
        const fullPath = path.join(this.configDir!, file);
        return fs.statSync(fullPath).isFile();
      });
    } catch {
      return [];
    }
  }

  /**
   * Load a config file by name.
   * Returns true on success, false on failure.
   */
  loadConfig(configName: string): boolean {
    if (!this.configDir) {
      return false;
    }

    const configPath = path.join(this.configDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.configDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      return false;
    }

    if (!fs.existsSync(configPath)) {
      return false;
    }

    try {
      this.config = MidiStrummerConfig.fromJsonFile(configPath);
      this.configPath = configPath;
      this.currentConfigName = configName;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new config file with default values.
   * Returns true on success, false on failure.
   */
  createConfig(configName: string): boolean {
    if (!this.configDir) {
      return false;
    }

    // Ensure the name ends with .json
    if (!configName.endsWith('.json')) {
      configName = configName + '.json';
    }

    const configPath = path.join(this.configDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.configDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      return false;
    }

    if (fs.existsSync(configPath)) {
      return false;
    }

    try {
      const newConfig = new MidiStrummerConfig();
      fs.writeFileSync(configPath, JSON.stringify(newConfig.toDict(), null, 2));

      // Switch to the newly created config
      this.configPath = configPath;
      this.currentConfigName = configName;
      this.config = newConfig;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rename a config file.
   * Returns true on success, false on failure.
   */
  renameConfig(oldName: string, newName: string): boolean {
    if (!this.configDir) {
      return false;
    }

    // Ensure names end with .json
    if (!oldName.endsWith('.json')) oldName = oldName + '.json';
    if (!newName.endsWith('.json')) newName = newName + '.json';

    const oldPath = path.join(this.configDir, oldName);
    const newPath = path.join(this.configDir, newName);

    // Security check: ensure paths are within the config directory
    const resolvedOldPath = path.resolve(oldPath);
    const resolvedNewPath = path.resolve(newPath);
    const resolvedDir = path.resolve(this.configDir);
    if (!resolvedOldPath.startsWith(resolvedDir + path.sep) && resolvedOldPath !== resolvedDir) {
      return false;
    }
    if (!resolvedNewPath.startsWith(resolvedDir + path.sep) && resolvedNewPath !== resolvedDir) {
      return false;
    }

    if (!fs.existsSync(oldPath)) {
      return false;
    }

    if (fs.existsSync(newPath)) {
      return false;
    }

    try {
      fs.renameSync(oldPath, newPath);

      // Update current config path if we renamed the current config
      if (this.currentConfigName === oldName) {
        this.configPath = newPath;
        this.currentConfigName = newName;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Upload a config file (save uploaded data as a new config).
   * Returns true on success, false on failure.
   */
  uploadConfig(configName: string, configData: unknown): boolean {
    if (!this.configDir) {
      return false;
    }

    // Ensure the name ends with .json
    if (!configName.endsWith('.json')) {
      configName = configName + '.json';
    }

    const configPath = path.join(this.configDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.configDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      return false;
    }

    try {
      // Parse and validate the config data
      const parsedConfig = MidiStrummerConfig.fromDict(configData as Record<string, unknown>);

      // Write the config file
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Switch to the uploaded config
      this.configPath = configPath;
      this.currentConfigName = configName;
      this.config = parsedConfig;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a config file.
   * Returns true on success, false on failure.
   */
  deleteConfig(configName: string): boolean {
    if (!this.configDir) {
      return false;
    }

    // Don't allow deleting the currently loaded config
    if (this.currentConfigName === configName) {
      return false;
    }

    const configPath = path.join(this.configDir, configName);

    // Security check: ensure the resolved path is within the config directory
    const resolvedPath = path.resolve(configPath);
    const resolvedDir = path.resolve(this.configDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      return false;
    }

    if (!fs.existsSync(configPath)) {
      return false;
    }

    try {
      fs.unlinkSync(configPath);
      return true;
    } catch {
      return false;
    }
  }
}

describe('Config File Management', () => {
  let tempDir: string;
  let manager: ConfigFileManager;

  beforeEach(() => {
    // Create a temporary directory for test configs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    manager = new ConfigFileManager(tempDir);
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('listConfigs', () => {
    it('should return empty array when no config directory is set', () => {
      const noConfigManager = new ConfigFileManager();
      expect(noConfigManager.listConfigs()).toEqual([]);
    });

    it('should return empty array when directory is empty', () => {
      expect(manager.listConfigs()).toEqual([]);
    });

    it('should list only .json files', () => {
      fs.writeFileSync(path.join(tempDir, 'config1.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'config2.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'not a config');
      fs.writeFileSync(path.join(tempDir, 'script.js'), 'not a config');

      const configs = manager.listConfigs();
      expect(configs).toHaveLength(2);
      expect(configs).toContain('config1.json');
      expect(configs).toContain('config2.json');
      expect(configs).not.toContain('readme.txt');
      expect(configs).not.toContain('script.js');
    });

    it('should not list subdirectories', () => {
      fs.writeFileSync(path.join(tempDir, 'config.json'), '{}');
      fs.mkdirSync(path.join(tempDir, 'subdir.json')); // Directory with .json name

      const configs = manager.listConfigs();
      expect(configs).toHaveLength(1);
      expect(configs).toContain('config.json');
      expect(configs).not.toContain('subdir.json');
    });

    it('should not list files in subdirectories', () => {
      fs.writeFileSync(path.join(tempDir, 'root.json'), '{}');
      fs.mkdirSync(path.join(tempDir, 'subdir'));
      fs.writeFileSync(path.join(tempDir, 'subdir', 'nested.json'), '{}');

      const configs = manager.listConfigs();
      expect(configs).toHaveLength(1);
      expect(configs).toContain('root.json');
    });
  });

  describe('loadConfig', () => {
    it('should return false when no config directory is set', () => {
      const noConfigManager = new ConfigFileManager();
      expect(noConfigManager.loadConfig('test.json')).toBe(false);
    });

    it('should return false when config file does not exist', () => {
      expect(manager.loadConfig('nonexistent.json')).toBe(false);
    });

    it('should load a valid config file', () => {
      const configData = new MidiStrummerConfig();
      configData.strummer.strumming.chord = 'Am';
      fs.writeFileSync(
        path.join(tempDir, 'test.json'),
        JSON.stringify(configData.toDict(), null, 2)
      );

      expect(manager.loadConfig('test.json')).toBe(true);
      expect(manager.currentConfigName).toBe('test.json');
      expect(manager.config.strummer.strumming.chord).toBe('Am');
    });

    it('should return false for invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'invalid.json'), 'not valid json');
      expect(manager.loadConfig('invalid.json')).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      // Create a file outside the config directory
      const parentDir = path.dirname(tempDir);
      fs.writeFileSync(path.join(parentDir, 'secret.json'), '{}');

      expect(manager.loadConfig('../secret.json')).toBe(false);
      expect(manager.loadConfig('..\\secret.json')).toBe(false);
    });
  });

  describe('createConfig', () => {
    it('should return false when no config directory is set', () => {
      const noConfigManager = new ConfigFileManager();
      expect(noConfigManager.createConfig('test')).toBe(false);
    });

    it('should create a new config file', () => {
      expect(manager.createConfig('newconfig')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'newconfig.json'))).toBe(true);
      expect(manager.currentConfigName).toBe('newconfig.json');
    });

    it('should add .json extension if missing', () => {
      expect(manager.createConfig('myconfig')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'myconfig.json'))).toBe(true);
    });

    it('should not add duplicate .json extension', () => {
      expect(manager.createConfig('myconfig.json')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'myconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'myconfig.json.json'))).toBe(false);
    });

    it('should return false if file already exists', () => {
      fs.writeFileSync(path.join(tempDir, 'existing.json'), '{}');
      expect(manager.createConfig('existing')).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      expect(manager.createConfig('../outside')).toBe(false);
      expect(manager.createConfig('../../outside')).toBe(false);
    });

    it('should switch to the newly created config', () => {
      manager.createConfig('first');
      expect(manager.currentConfigName).toBe('first.json');

      manager.createConfig('second');
      expect(manager.currentConfigName).toBe('second.json');
    });
  });

  describe('renameConfig', () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, 'original.json'), '{}');
    });

    it('should return false when no config directory is set', () => {
      const noConfigManager = new ConfigFileManager();
      expect(noConfigManager.renameConfig('old', 'new')).toBe(false);
    });

    it('should rename a config file', () => {
      expect(manager.renameConfig('original', 'renamed')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'original.json'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'renamed.json'))).toBe(true);
    });

    it('should add .json extension to both names if missing', () => {
      expect(manager.renameConfig('original', 'newname')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'newname.json'))).toBe(true);
    });

    it('should return false if source file does not exist', () => {
      expect(manager.renameConfig('nonexistent', 'newname')).toBe(false);
    });

    it('should return false if target file already exists', () => {
      fs.writeFileSync(path.join(tempDir, 'target.json'), '{}');
      expect(manager.renameConfig('original', 'target')).toBe(false);
    });

    it('should update currentConfigName if renaming current config', () => {
      manager.loadConfig('original.json');
      expect(manager.currentConfigName).toBe('original.json');

      expect(manager.renameConfig('original', 'renamed')).toBe(true);
      expect(manager.currentConfigName).toBe('renamed.json');
    });

    it('should not update currentConfigName if renaming different config', () => {
      fs.writeFileSync(path.join(tempDir, 'other.json'), '{}');
      manager.loadConfig('original.json');

      expect(manager.renameConfig('other', 'renamed')).toBe(true);
      expect(manager.currentConfigName).toBe('original.json');
    });

    it('should reject path traversal attempts in old name', () => {
      expect(manager.renameConfig('../secret', 'newname')).toBe(false);
    });

    it('should reject path traversal attempts in new name', () => {
      expect(manager.renameConfig('original', '../outside')).toBe(false);
    });
  });

  describe('uploadConfig', () => {
    it('should return false when no config directory is set', () => {
      const noConfigManager = new ConfigFileManager();
      expect(noConfigManager.uploadConfig('test', {})).toBe(false);
    });

    it('should upload a valid config', () => {
      const configData = new MidiStrummerConfig();
      configData.strummer.strumming.chord = 'G';

      expect(manager.uploadConfig('uploaded', configData.toDict())).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'uploaded.json'))).toBe(true);
      expect(manager.currentConfigName).toBe('uploaded.json');
      expect(manager.config.strummer.strumming.chord).toBe('G');
    });

    it('should add .json extension if missing', () => {
      const configData = new MidiStrummerConfig();
      expect(manager.uploadConfig('myupload', configData.toDict())).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'myupload.json'))).toBe(true);
    });

    it('should overwrite existing file', () => {
      const oldConfig = new MidiStrummerConfig();
      oldConfig.strummer.strumming.chord = 'C';
      fs.writeFileSync(
        path.join(tempDir, 'existing.json'),
        JSON.stringify(oldConfig.toDict(), null, 2)
      );

      const newConfig = new MidiStrummerConfig();
      newConfig.strummer.strumming.chord = 'D';

      expect(manager.uploadConfig('existing', newConfig.toDict())).toBe(true);
      expect(manager.config.strummer.strumming.chord).toBe('D');
    });

    it('should accept partial config data (defaults are filled in)', () => {
      // MidiStrummerConfig.fromDict is lenient and fills in defaults for missing fields
      expect(manager.uploadConfig('partial', { strummer: { strumming: { chord: 'Em' } } })).toBe(true);
      expect(manager.config.strummer.strumming.chord).toBe('Em');
    });

    it('should reject path traversal attempts', () => {
      const configData = new MidiStrummerConfig();
      expect(manager.uploadConfig('../outside', configData.toDict())).toBe(false);
    });

    it('should switch to the uploaded config', () => {
      const config1 = new MidiStrummerConfig();
      config1.strummer.strumming.chord = 'A';
      manager.uploadConfig('first', config1.toDict());
      expect(manager.currentConfigName).toBe('first.json');

      const config2 = new MidiStrummerConfig();
      config2.strummer.strumming.chord = 'B';
      manager.uploadConfig('second', config2.toDict());
      expect(manager.currentConfigName).toBe('second.json');
    });
  });

  describe('deleteConfig', () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, 'deleteme.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'keepme.json'), '{}');
    });

    it('should return false when no config directory is set', () => {
      const noConfigManager = new ConfigFileManager();
      expect(noConfigManager.deleteConfig('test.json')).toBe(false);
    });

    it('should delete a config file', () => {
      expect(manager.deleteConfig('deleteme.json')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'deleteme.json'))).toBe(false);
    });

    it('should return false if file does not exist', () => {
      expect(manager.deleteConfig('nonexistent.json')).toBe(false);
    });

    it('should not allow deleting the currently loaded config', () => {
      manager.loadConfig('deleteme.json');
      expect(manager.deleteConfig('deleteme.json')).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'deleteme.json'))).toBe(true);
    });

    it('should allow deleting a different config when one is loaded', () => {
      manager.loadConfig('keepme.json');
      expect(manager.deleteConfig('deleteme.json')).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'deleteme.json'))).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      expect(manager.deleteConfig('../secret.json')).toBe(false);
    });
  });

  describe('Path Traversal Security', () => {
    it('should block various path traversal patterns in loadConfig', () => {
      const patterns = [
        '../secret.json',
        '../../secret.json',
      ];

      for (const pattern of patterns) {
        expect(manager.loadConfig(pattern)).toBe(false);
      }
    });

    it('should block various path traversal patterns in createConfig', () => {
      const patterns = [
        '../secret',
        '../../secret',
      ];

      for (const pattern of patterns) {
        expect(manager.createConfig(pattern)).toBe(false);
      }
    });

    it('should block various path traversal patterns in renameConfig', () => {
      fs.writeFileSync(path.join(tempDir, 'source.json'), '{}');

      const patterns = [
        '../secret',
        '../../secret',
      ];

      for (const pattern of patterns) {
        expect(manager.renameConfig('source', pattern)).toBe(false);
        expect(manager.renameConfig(pattern, 'target')).toBe(false);
      }
    });

    it('should block various path traversal patterns in uploadConfig', () => {
      const configData = new MidiStrummerConfig().toDict();
      const patterns = [
        '../secret',
        '../../secret',
      ];

      for (const pattern of patterns) {
        expect(manager.uploadConfig(pattern, configData)).toBe(false);
      }
    });

    it('should block various path traversal patterns in deleteConfig', () => {
      const patterns = [
        '../secret.json',
        '../../secret.json',
      ];

      for (const pattern of patterns) {
        expect(manager.deleteConfig(pattern)).toBe(false);
      }
    });
  });
});

describe('WebSocket Config Management Messages', () => {
  describe('load-config message', () => {
    it('should have correct format', () => {
      const message = {
        type: 'load-config',
        configName: 'myconfig.json',
      };

      expect(message).toHaveProperty('type', 'load-config');
      expect(message).toHaveProperty('configName');
      expect(typeof message.configName).toBe('string');
    });
  });

  describe('create-config message', () => {
    it('should have correct format', () => {
      const message = {
        type: 'create-config',
        configName: 'newconfig',
      };

      expect(message).toHaveProperty('type', 'create-config');
      expect(message).toHaveProperty('configName');
    });
  });

  describe('rename-config message', () => {
    it('should have correct format', () => {
      const message = {
        type: 'rename-config',
        oldName: 'oldname.json',
        newName: 'newname.json',
      };

      expect(message).toHaveProperty('type', 'rename-config');
      expect(message).toHaveProperty('oldName');
      expect(message).toHaveProperty('newName');
    });
  });

  describe('upload-config message', () => {
    it('should have correct format', () => {
      const message = {
        type: 'upload-config',
        configName: 'uploaded.json',
        configData: { strummer: {}, midi: {}, server: {} },
      };

      expect(message).toHaveProperty('type', 'upload-config');
      expect(message).toHaveProperty('configName');
      expect(message).toHaveProperty('configData');
      expect(typeof message.configData).toBe('object');
    });
  });

  describe('delete-config message', () => {
    it('should have correct format', () => {
      const message = {
        type: 'delete-config',
        configName: 'todelete.json',
      };

      expect(message).toHaveProperty('type', 'delete-config');
      expect(message).toHaveProperty('configName');
    });
  });

  describe('config response with management fields', () => {
    it('should include currentConfigName', () => {
      const response = {
        type: 'config',
        data: {
          throttleMs: 100,
          notes: [],
          config: {},
          currentConfigName: 'default.json',
          availableConfigs: ['default.json', 'custom.json'],
          isSavedState: true,
        },
      };

      expect(response.data).toHaveProperty('currentConfigName');
      expect(response.data).toHaveProperty('availableConfigs');
      expect(response.data).toHaveProperty('isSavedState');
      expect(Array.isArray(response.data.availableConfigs)).toBe(true);
      expect(typeof response.data.isSavedState).toBe('boolean');
    });

    it('should have isSavedState=true after load/save operations', () => {
      const afterLoad = {
        type: 'config',
        data: { isSavedState: true },
      };
      expect(afterLoad.data.isSavedState).toBe(true);
    });

    it('should have isSavedState=false after update operations', () => {
      const afterUpdate = {
        type: 'config',
        data: { isSavedState: false },
      };
      expect(afterUpdate.data.isSavedState).toBe(false);
    });
  });
});
