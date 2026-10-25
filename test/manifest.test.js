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
  assert.deepEqual(manifest.categories, ['servers', 'energy', 'network']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.match(manifest.docker_image, /^ghcr\.io\/prohand\/gladys-nut:/);
  assert.equal(manifest.config_schema.filter((field) => field.key.endsWith('_host')).length, 5);
});

// The store's controlled vocabulary of catalog shelves (Gladys 5.3 added the
// last four).
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

/**
 * Major and minor of the `>=` bound of `gladys_version`.
 * @returns {[number, number]}
 */
function minimumGladysVersion() {
  const match = manifest.gladys_version.match(/^>=\s*(\d+)\.(\d+)\.\d+$/);
  assert.ok(match, 'gladys_version must be a ">=x.y.z" range');
  return [Number(match[1]), Number(match[2])];
}

const atLeast = ([major, minor], [wantedMajor, wantedMinor]) =>
  major > wantedMajor || (major === wantedMajor && minor >= wantedMinor);

test('the search keywords follow the store rules', () => {
  // 1 to 10 search-only terms of 2 to 30 characters, unique once trimmed and
  // lowercased: the store rejects the manifest otherwise.
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}" length`);
  }
});

test('the integration is worldwide: no countries declared', () => {
  // `countries` hides an integration from the catalog shelves of every other
  // country; NUT runs anywhere.
  assert.equal(manifest.countries, undefined);
});

test('the gladys_version floor covers every field the manifest declares', () => {
  // An older core rejects the whole manifest over a field it does not know.
  const floor = minimumGladysVersion();
  assert.ok(atLeast(floor, [4, 86]), 'categories requires Gladys >= 4.86.0');
  if (['widgets', 'scene_triggers', 'scene_actions'].some((field) => field in manifest)) {
    assert.ok(atLeast(floor, [5, 1]), 'widgets and scenes require Gladys >= 5.1.0');
  }
  if (['keywords', 'countries', 'music'].some((field) => field in manifest)) {
    assert.ok(atLeast(floor, [5, 3]), 'keywords, countries and music require Gladys >= 5.3.0');
  }
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
  // An unknown shelf is not rejected, it is DROPPED with a warning: a typo
  // silently costs the integration its place in the catalog.
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown catalog category "${category}"`);
  }
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(manifest.docker_image, /:[^:/]+$/, 'the image reference needs an explicit tag');
});

// Gladys shows its interface in English, French, German and Spanish, and picks
// the reader's language out of every multi-language object (English when it is
// missing). A text left without one of them would read in English there.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

function multiLanguageTexts(value, path = 'manifest', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => multiLanguageTexts(entry, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    if (typeof value.en === 'string') {
      found.push({ path, text: value });
    } else {
      for (const [key, entry] of Object.entries(value)) {
        multiLanguageTexts(entry, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text), LANGUAGES, `${path} must carry ${LANGUAGES.join(', ')}`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim(), `${path}.${language} must not be empty`);
    }
  }
});

test('respects the store length limits in every language', () => {
  const length = (value) => [...value].length;
  const within = (text, min, max, path) => {
    for (const language of LANGUAGES) {
      const size = length(text[language]);
      assert.ok(size >= min && size <= max, `${path}.${language}: ${size} characters`);
    }
  };
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widgets.${widget.key}.label`);
    if (widget.description) {
      within(widget.description, 1, 100, `widgets.${widget.key}.description`);
    }
  }
  for (const field of manifest.config_schema.filter(({ type }) => type === 'section')) {
    if (field.description) {
      within(field.description, 1, 1000, `config_schema.${field.key}.description`);
    }
  }
});

test('the cover image is pinned to the released tag, never to a branch', () => {
  // A URL that never changes is a URL nobody re-fetches: pinned to `main`, a
  // redrawn cover stayed invisible in the store and on the docs site behind
  // whatever the caches had kept. The Release workflow rewrites it to the tag
  // of every release, which publishes an address no cache has seen.
  assert.match(
    manifest.cover_image,
    new RegExp(`/v${manifest.version.replace(/\./g, '\\.')}/cover\\.jpg$`),
    'cover_image must point at the tag of this very version',
  );
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

test('declares the widget and scene capabilities the code handles', async () => {
  const { SCENE_ACTIONS, SCENE_TRIGGERS } = await import('../src/scenes.js');
  const { UPS_WIDGET } = await import('../src/widget.js');

  // Older cores reject a manifest carrying these fields (5.1 for the widget and
  // the scenes, 5.3 for the catalog keywords).
  assert.equal(manifest.gladys_version, '>=5.3.0');
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
