import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configDir } from './paths.js';

const ENV_KEYS = ['NAMEFIX_HOME', 'XDG_CONFIG_HOME'];
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('configDir', () => {
  it('falls back to default app name when input is blank', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/config';
    const result = configDir('   ');
    expect(result).toBe(path.join('/tmp/config', 'namefix'));
  });

  it('trims surrounding whitespace from custom app names', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/config';
    const result = configDir('  demo-app  ');
    expect(result).toBe(path.join('/tmp/config', 'demo-app'));
  });
});
