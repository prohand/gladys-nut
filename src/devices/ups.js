// -----------------------------------------------------------------------------
// NUT UPS device mapping.
//
// NUT drivers do not all expose the same variables. Discovery therefore builds
// each device from the variables that its upsd server actually reports instead
// of creating permanently empty sensors. A device identity includes both the
// server and the UPS name, so identical UPS names on different servers remain
// independent in Gladys.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { getNutSnapshot } from '../nut/client.js';

const DEVICE_TYPE = 'nut-ups';
const logger = createLogger({ name: DEVICE_TYPE });

// Gladys Core stores `min` and `max` as NOT NULL columns of t_device_feature:
// a feature published without them is accepted in the discovery list but
// rejected when the user adds the device, with an HTTP 422 ("min cannot be
// null"). Every definition below therefore declares the full envelope of its
// NUT variable. Those bounds stay descriptive — they size the gauges and the
// charts, Gladys never clamps nor rejects a state outside of them — so they
// are deliberately generous enough to cover large three-phase units.
const NUMERIC_VARIABLES = [
  {
    variable: 'battery.charge',
    key: 'battery-charge',
    name: 'Battery charge',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
  },
  {
    variable: 'battery.runtime',
    key: 'battery-runtime',
    name: 'Battery runtime',
    category: DEVICE_FEATURE_CATEGORIES.DURATION,
    type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    unit: DEVICE_FEATURE_UNITS.SECONDS,
    min: 0,
    max: 86400,
  },
  {
    variable: 'ups.load',
    key: 'load',
    name: 'Load',
    // Gladys has no category for a generic percentage of a rated capacity, and
    // `energy-sensor` has no `decimal` type: that pair has neither icon nor
    // label in the front-end, which displayed the feature as a blank chip. The
    // `unknown/unknown` pair is the documented catch-all and renders properly;
    // the feature name and its percent unit carry the meaning.
    category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
    type: DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
  },
  {
    variable: 'input.voltage',
    key: 'input-voltage',
    name: 'Input voltage',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
    min: 0,
    max: 600,
  },
  {
    variable: 'output.voltage',
    key: 'output-voltage',
    name: 'Output voltage',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
    min: 0,
    max: 600,
  },
  {
    variable: 'battery.voltage',
    key: 'battery-voltage',
    name: 'Battery voltage',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
    min: 0,
    max: 600,
  },
  {
    variable: 'input.current',
    key: 'input-current',
    name: 'Input current',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
    unit: DEVICE_FEATURE_UNITS.AMPERE,
    min: 0,
    max: 200,
  },
  {
    variable: 'output.current',
    key: 'output-current',
    name: 'Output current',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
    unit: DEVICE_FEATURE_UNITS.AMPERE,
    min: 0,
    max: 200,
  },
  {
    variable: 'ups.realpower',
    key: 'real-power',
    name: 'Real power',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
    unit: DEVICE_FEATURE_UNITS.WATT,
    min: 0,
    max: 100000,
  },
  {
    variable: 'ups.power',
    key: 'apparent-power',
    name: 'Apparent power',
    // Apparent power is a power reading, so it belongs to `energy-sensor/power`
    // like ups.realpower: only the unit (VA instead of W) and the feature name
    // separate them. The previous `unknown/decimal` pair matched no front-end
    // icon nor label and left an empty chip on the device page.
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
    unit: DEVICE_FEATURE_UNITS.VOLT_AMPERE,
    min: 0,
    max: 100000,
  },
  {
    variable: 'ups.temperature',
    key: 'ups-temperature',
    name: 'UPS temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    min: -40,
    max: 150,
  },
  {
    variable: 'battery.temperature',
    key: 'battery-temperature',
    name: 'Battery temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    min: -40,
    max: 150,
  },
];

// Gladys polls devices on a fixed set of frequencies (DEVICE_POLL_FREQUENCIES
// in Gladys Core), the slowest being one minute: publishing any other value
// makes the core reject the whole discovery payload. Every device therefore
// registers on that slowest tick, and the integration itself ignores the polls
// that fall inside the configured interval (see isRefreshDue). The faster core
// frequencies are deliberately never used: they would double the number of
// history rows written into the Gladys database for readings that move slowly.
export const CORE_POLL_FREQUENCY = 60 * 1000;

// A published state that repeats the previous one is still a full row in the
// Gladys history table. Unchanged values are therefore skipped, but not
// forever: republishing at least once an hour keeps the device from looking
// stale in the front-end and keeps the charts anchored over long flat periods.
export const STATE_HEARTBEAT = 60 * 60 * 1000;

// Timestamp of the last NUT read published for a device external_id.
const lastRefreshAt = new Map();

// Last state published for a feature external_id: { value, at }.
const lastPublishedStates = new Map();

/**
 * Whether a core poll must actually query the NUT server, or belongs to the
 * configured interval and has to be ignored.
 * @param {object} config - The normalized integration configuration.
 * @param {string} deviceExternalId - The polled device external_id.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {boolean} True when the UPS has to be read again.
 */
export function isRefreshDue(config, deviceExternalId, now = Date.now()) {
  const last = lastRefreshAt.get(deviceExternalId);
  if (last === undefined) {
    return true;
  }
  // The core ticks on its own clock, so a poll routinely lands a few
  // milliseconds short of the configured interval. Comparing against the raw
  // interval would then skip a whole cycle: a refresh is due as soon as it is
  // closer to the configured interval than to the next core tick.
  return now - last >= config.poll_frequency * 1000 - CORE_POLL_FREQUENCY / 2;
}

/**
 * Whether a freshly read state is worth writing to the Gladys history, i.e.
 * whether it carries something the previous published state does not.
 * @param {object} state - A { device_feature_external_id, state } payload.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {boolean} True when the state has to be published.
 */
export function isStatePublishable(state, now = Date.now()) {
  const last = lastPublishedStates.get(state.device_feature_external_id);
  if (last === undefined) {
    return true;
  }
  return last.value !== state.state || now - last.at >= STATE_HEARTBEAT;
}

/**
 * Record that a state has just been published for its feature.
 * @param {object} state - A { device_feature_external_id, state } payload.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {void}
 */
export function markStatePublished(state, now = Date.now()) {
  lastPublishedStates.set(state.device_feature_external_id, { value: state.state, at: now });
}

/**
 * Record that the UPS behind a device external_id has just been read.
 * @param {string} deviceExternalId - The refreshed device external_id.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {void}
 */
export function markRefreshed(deviceExternalId, now = Date.now()) {
  lastRefreshAt.set(deviceExternalId, now);
}

/**
 * Drop every recorded refresh and published state, so the next poll of each
 * device reads its NUT server again and republishes everything it reports.
 * Called when the configuration changes.
 * @returns {void}
 */
export function resetRefreshSchedule() {
  lastRefreshAt.clear();
  lastPublishedStates.clear();
}

function platformId(server, upsName) {
  return `${encodeURIComponent(server.host)}-${server.port}-${encodeURIComponent(upsName)}`;
}

function valueAsNumber(variables, variable) {
  const value = Number(variables.get(variable));
  return Number.isFinite(value) ? value : undefined;
}

function featureFromDefinition(ids, definition) {
  const { variable: _variable, key, name, ...properties } = definition;
  return {
    name,
    external_id: ids.feature(key),
    ...properties,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

export function buildUpsDevice(gladys, _config, discovered) {
  const { server, snapshot } = discovered;
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(server, snapshot.name));
  const manufacturer = snapshot.variables.get('device.mfr') ?? snapshot.variables.get('ups.mfr');
  const model = snapshot.variables.get('device.model') ?? snapshot.variables.get('ups.model');
  const name =
    [manufacturer, model].filter(Boolean).join(' ') || snapshot.description || snapshot.name;

  const numericFeatures = NUMERIC_VARIABLES.filter(
    (definition) => valueAsNumber(snapshot.variables, definition.variable) !== undefined,
  ).map((definition) => featureFromDefinition(ids, definition));
  if (numericFeatures.length === 0) {
    logger.warn(
      `The UPS ${snapshot.name} on ${server.host}:${server.port} reports no numeric variable: it is published without any feature.`,
    );
  }
  return {
    name: `${name} (${server.host})`,
    external_id: ids.device,
    // Gladys never polls a device that does not ask for it: without
    // should_poll, the device is created but its values stay frozen on the
    // ones read at discovery time.
    should_poll: true,
    poll_frequency: CORE_POLL_FREQUENCY,
    // Text features are intentionally not published: older Gladys Core releases
    // reject the `text` category with HTTP 422 during discovery validation.
    features: numericFeatures,
  };
}

export function buildDiscoveredDevices(gladys, config, discovered) {
  return discovered.map((item) => buildUpsDevice(gladys, config, item));
}

export function buildUpsStates(gladys, _config, discovered) {
  const { server, snapshot } = discovered;
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(server, snapshot.name));
  const numericStates = NUMERIC_VARIABLES.flatMap((definition) => {
    const value = valueAsNumber(snapshot.variables, definition.variable);
    return value === undefined
      ? []
      : [{ device_feature_external_id: ids.feature(definition.key), state: value }];
  });
  return numericStates;
}

export async function discoverUpses(config) {
  const results = await Promise.all(
    config.servers.map(async (server) => {
      try {
        const snapshots = await getNutSnapshot({ ...server, timeout: config.timeout });
        return { server, snapshots, error: null };
      } catch (error) {
        logger.error(`NUT server ${server.host}:${server.port} is unavailable`, error);
        return { server, snapshots: [], error };
      }
    }),
  );
  const discovered = results.flatMap(({ server, snapshots }) =>
    snapshots.map((snapshot) => ({ server, snapshot })),
  );
  const errors = results.filter(({ error }) => error).map(({ error }) => error);
  if (discovered.length === 0 && errors.length === results.length) {
    throw new Error(`None of the ${results.length} configured NUT servers could be reached.`);
  }
  logger.info(
    `Discovered ${discovered.length} UPS device(s) on ${config.servers.length} NUT server(s).`,
  );
  return discovered;
}

export async function publishUpsStates(gladys, config, deviceExternalId) {
  if (!isRefreshDue(config, deviceExternalId)) {
    return null;
  }
  const discovered = await discoverUpses(config);
  const item = discovered.find(
    ({ server, snapshot }) =>
      gladys.externalIds(DEVICE_TYPE, platformId(server, snapshot.name)).device ===
      deviceExternalId,
  );
  if (!item) {
    throw new Error(`The UPS for ${deviceExternalId} is no longer exposed by the NUT servers.`);
  }

  // Only the readings that actually changed reach Gladys: a UPS idle on mains
  // power reports the same charge, runtime and voltages for hours, and every
  // repeat would be an extra history row for no information at all.
  const now = Date.now();
  const states = buildUpsStates(gladys, config, item).filter((state) =>
    isStatePublishable(state, now),
  );
  if (states.length > 0) {
    await gladys.publishStates(states);
    for (const state of states) {
      markStatePublished(state, now);
    }
  }
  // Recorded once the read succeeded: a failed poll is retried on the next
  // core tick instead of waiting for a whole configured interval.
  markRefreshed(deviceExternalId);
  return item;
}

export async function testNutConnection(config) {
  const discovered = await discoverUpses(config);
  const names = discovered
    .map(({ server, snapshot }) => `${snapshot.name}@${server.host}`)
    .join(', ');
  return {
    en: `${discovered.length} UPS device(s) found${names ? `: ${names}.` : '.'}`,
    fr: `${discovered.length} onduleur(s) détecté(s)${names ? ` : ${names}.` : '.'}`,
  };
}
