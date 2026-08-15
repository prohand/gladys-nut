import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('declares a valid NUT integration identity and local transport', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Network UPS Tools (NUT)');
  assert.deepEqual(manifest.categories, ['energy', 'network']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.match(manifest.docker_image, /^ghcr\.io\/prohand\/gladys-nut:/);
});

test('keeps configuration defaults aligned with the runtime defaults', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('protects the optional password and exposes the connection test action', () => {
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
  assert.equal(password.default, undefined);

  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    ['test_connection'],
  );
});
