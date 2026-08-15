import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('normalizes multiple NUT server slots', () => {
  const config = normalizeConfig({
    server_1_host: '  nut-one.example.net  ',
    server_1_port: '3494',
    server_1_username: 'gladys',
    server_1_password: 'secret',
    server_2_host: 'nut-two.example.net',
    server_2_port: 3493,
    poll_frequency: '120',
  });

  assert.deepEqual(config, {
    servers: [
      {
        id: 'server-1',
        host: 'nut-one.example.net',
        port: 3494,
        username: 'gladys',
        password: 'secret',
      },
      {
        id: 'server-2',
        host: 'nut-two.example.net',
        port: 3493,
        username: '',
        password: '',
      },
    ],
    poll_frequency: 120,
    timeout: DEFAULT_CONFIG.timeout,
  });
});

test('keeps compatibility with the former single-server configuration', () => {
  const config = normalizeConfig({
    host: 'nut.example.net',
    port: '3494',
    username: 'gladys',
    password: 'secret',
  });

  assert.equal(config.servers.length, 1);
  assert.deepEqual(config.servers[0], {
    id: 'server-1',
    host: 'nut.example.net',
    port: 3494,
    username: 'gladys',
    password: 'secret',
  });
});

test('requires at least one server host', () => {
  assert.throws(() => normalizeConfig(), /At least one NUT server host is required/);
});

test('rejects an invalid NUT port', () => {
  assert.throws(
    () => normalizeConfig({ server_2_host: 'nut.local', server_2_port: 0 }),
    /between 1 and 65535/,
  );
});

test('rejects duplicated server identities', () => {
  assert.throws(
    () =>
      normalizeConfig({
        server_1_host: 'nut.local',
        server_2_host: 'NUT.LOCAL',
        server_2_port: 3493,
      }),
    /configured more than once/,
  );
});

test('rejects an unsupported polling interval', () => {
  assert.throws(
    () => normalizeConfig({ server_1_host: 'nut.local', poll_frequency: 5 }),
    /between 30 and 3600 seconds/,
  );
});

test('requires a password with a NUT username', () => {
  assert.throws(
    () => normalizeConfig({ server_1_host: 'nut.local', server_1_username: 'gladys' }),
    /password is required/,
  );
});
