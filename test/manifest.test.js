import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('declares a valid multi-server NUT integration identity', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Network UPS Tools (NUT)');
  assert.deepEqual(manifest.categories, ['energy', 'network']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.match(manifest.docker_image, /^ghcr\.io\/prohand\/gladys-nut:/);
  assert.equal(manifest.config_schema.filter((field) => field.key.endsWith('_host')).length, 5);
});

test('keeps shared configuration defaults aligned with runtime defaults', () => {
  const pollFrequency = manifest.config_schema.find((field) => field.key === 'poll_frequency');
  assert.equal(DEFAULT_CONFIG.poll_frequency, pollFrequency.default);
});

test('protects all optional passwords and exposes the connection test action', () => {
  const passwords = manifest.config_schema.filter((field) => field.key.endsWith('_password'));
  assert.equal(passwords.length, 5);
  assert.ok(passwords.every((field) => field.type === 'secret' && field.default === undefined));

  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    ['test_connection'],
  );
});
