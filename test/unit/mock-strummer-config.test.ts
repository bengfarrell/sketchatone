import { describe, expect, it, vi } from 'vitest';
import { MockStrummerClient } from '../../src/utils/mock-strummer-client.js';
import { validateCompleteConfig } from '../../src/utils/config-validation.js';

describe('mock complete configuration editing', () => {
  it('renames in memory, broadcasts the new identity and reports explicit errors', async () => {
    const client = new MockStrummerClient();
    let current: any;
    const result = vi.fn();
    client.onConfig(config => { current = config; });
    client.on('rename-config-result', result);
    client.connect();
    await Promise.resolve();
    const base = structuredClone(current.config);
    client.renameConfig('mock.json', 'renamed');
    expect(current.currentConfigName).toBe('renamed.json');
    expect(current.availableConfigs).toEqual(['renamed.json']);
    expect(current.config).toEqual(base);
    expect(result).toHaveBeenLastCalledWith({ oldName: 'mock.json', newName: 'renamed.json', success: true });
    client.renameConfig('missing.json', 'other');
    expect(result.mock.calls.at(-1)?.[0].success).toBe(false);
    client.cleanup();
  });

  it('provides a valid template, applies full config and acknowledges preview-only persistence', async () => {
    const client = new MockStrummerClient();
    let current: any;
    const result = vi.fn();
    client.onConfig(config => { current = config; });
    client.on('apply-config-result', result);
    client.connect();
    await Promise.resolve();
    expect(validateCompleteConfig(current.config, current.configValidationTemplate)).toEqual([]);
    const base = JSON.parse(JSON.stringify(current.config));
    const config = { ...base, keyboard: { enabled: false } };
    client.applyConfig(config, 'mock.json', base, 'request');
    expect(current.config).toEqual(config);
    expect(result).toHaveBeenLastCalledWith({
      requestId: 'request', success: true, message: 'Mock configuration applied (preview only; not saved to disk).',
    });
    client.applyConfig(config, 'mock.json', base, 'stale');
    expect(result.mock.calls.at(-1)?.[0].success).toBe(false);
    client.cleanup();
  });
});
