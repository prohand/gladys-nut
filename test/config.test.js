import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_CONFIG,
  MAX_POLL_FREQUENCY,
  MIN_POLL_FREQUENCY,
  normalizeConfig,
} from '../src/config.js';

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

test('raises a polling interval that would flood the Gladys history', () => {
  const interval = (poll_frequency) =>
    normalizeConfig({ server_1_host: 'nut.local', poll_frequency }).poll_frequency;

  // Sub-minute intervals doubled the number of history rows without adding
  // anything readable on a UPS: one minute is now the floor. Installations
  // saved before that floor existed keep working, on the floor.
  assert.equal(interval(5), MIN_POLL_FREQUENCY);
  assert.equal(interval(30), MIN_POLL_FREQUENCY);
  assert.equal(interval(60), 60);
  assert.equal(interval(3600), 3600);
  assert.equal(interval(999999), MAX_POLL_FREQUENCY);
});

test('defaults to a refresh interval gentle on the Gladys database', () => {
  const config = normalizeConfig({ server_1_host: 'nut.local' });

  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.ok(config.poll_frequency >= 300, 'the default interval must stay at five minutes or more');
});

test('requires a password with a NUT username', () => {
  assert.throws(
    () => normalizeConfig({ server_1_host: 'nut.local', server_1_username: 'gladys' }),
    /password is required/,
  );
});
