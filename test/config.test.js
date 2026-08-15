import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('normalizes valid NUT configuration values', () => {
  const config = normalizeConfig({
    host: '  nut.example.net  ',
    port: '3494',
    username: 'gladys',
    password: 'secret',
    poll_frequency: '120',
  });

  assert.deepEqual(config, {
    host: 'nut.example.net',
    port: 3494,
    username: 'gladys',
    password: 'secret',
    poll_frequency: 120,
    timeout: DEFAULT_CONFIG.timeout,
  });
});

test('requires a server host', () => {
  assert.throws(() => normalizeConfig(), /host is required/);
});

test('rejects an invalid NUT port', () => {
  assert.throws(() => normalizeConfig({ host: 'nut.local', port: 0 }), /between 1 and 65535/);
});

test('rejects an unsupported polling interval', () => {
  assert.throws(
    () => normalizeConfig({ host: 'nut.local', poll_frequency: 5 }),
    /between 30 and 3600 seconds/,
  );
});

test('requires a password with a NUT username', () => {
  assert.throws(
    () => normalizeConfig({ host: 'nut.local', username: 'gladys' }),
    /password is required/,
  );
});
