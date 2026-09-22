import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_CONFIG, MAX_POLL_FREQUENCY, MIN_POLL_FREQUENCY } from '../src/config.js';

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

test('respects the store admission limits on the catalog identity', () => {
  // The store indexer rejects the whole integration when these bounds are
  // exceeded, so the manifest never reaches the Gladys catalog.
  const length = (value) => [...value].length;

  assert.ok(length(manifest.name) >= 3 && length(manifest.name) <= 30);

  assert.ok(manifest.description.en, 'the English description is mandatory');
  for (const [locale, description] of Object.entries(manifest.description)) {
    assert.ok(
      length(description) >= 10 && length(description) <= 100,
      `description.${locale} must be 10 to 100 characters, got ${length(description)}`,
    );
  }

  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.docker_image, /:[^:/]+$/, 'the image reference needs an explicit tag');
});

test('keeps shared configuration defaults aligned with runtime defaults', () => {
  const pollFrequency = manifest.config_schema.find((field) => field.key === 'poll_frequency');
  assert.equal(DEFAULT_CONFIG.poll_frequency, pollFrequency.default);
});

test('offers no refresh interval that would flood the Gladys history', () => {
  // The form is the only guard the user sees: a bound looser than the runtime
  // one would let the interface propose a value normalizeConfig then rejects.
  const pollFrequency = manifest.config_schema.find((field) => field.key === 'poll_frequency');

  assert.equal(pollFrequency.min, MIN_POLL_FREQUENCY);
  assert.equal(pollFrequency.max, MAX_POLL_FREQUENCY);
  assert.ok(pollFrequency.min >= 60, 'sub-minute polling writes far too many history rows');
  assert.ok(pollFrequency.default >= pollFrequency.min);
  assert.ok(pollFrequency.default <= pollFrequency.max);
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

test('declares the Gladys 5.1 widget and scene capabilities the code handles', async () => {
  const { SCENE_ACTIONS, SCENE_TRIGGERS } = await import('../src/scenes.js');
  const { UPS_WIDGET } = await import('../src/widget.js');

  // Older cores reject a manifest carrying these fields.
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    [UPS_WIDGET],
  );
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(SCENE_TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(SCENE_ACTIONS),
  );

  // Every UPS picker lists the integration's own devices.
  const pickers = [
    ...manifest.widgets.flatMap((widget) => widget.settings),
    ...manifest.scene_triggers.flatMap((trigger) => trigger.fields),
    ...manifest.scene_actions.flatMap((action) => action.fields),
  ];
  assert.ok(pickers.every((field) => field.key === 'ups' && field.source === 'devices'));
  // An empty filter matches every UPS: a trigger field must stay optional.
  assert.ok(manifest.scene_triggers.every((trigger) => !trigger.fields[0].required));
});

test('publishes exactly the declared trigger variables', async () => {
  const { eventData } = await import('../src/scenes.js');
  const item = {
    server: { host: 'h', port: 3493 },
    snapshot: { name: 'u', variables: new Map([['ups.status', 'OL']]) },
  };
  const gladys = { externalIds: (type, id) => ({ device: `${type}:${id}` }) };
  const keys = Object.keys(eventData(gladys, item)).filter((key) => key !== 'ups');
  for (const trigger of manifest.scene_triggers) {
    assert.deepEqual(
      trigger.variables.map((variable) => variable.key),
      keys,
    );
  }
});
