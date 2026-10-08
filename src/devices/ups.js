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
import { getNutSnapshot, getNutUpsSnapshot } from '../nut/client.js';

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
    // Gladys has no category for a percentage of a rated capacity. The
    // `unknown/unknown` catch-all rendered, but the front-end titles a feature
    // with its category label ("Unknown") whenever no other feature of the
    // device shares its type, which is always the case for that pair. The
    // neutral `counter-sensor/integer` pair shares the `integer` type with the
    // battery charge and runtime, so Gladys shows the feature name ("Load")
    // instead; the percent unit carries the meaning.
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
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
// registers on that slowest tick, and the integration itself writes no reading
// on the polls that fall inside the configured interval (see isRefreshDue):
// those polls only watch `ups.status` for the scene triggers. The faster core
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
 * Whether a core poll must write the UPS readings to the Gladys history, or
 * belongs to the configured interval and only watches the UPS status.
 * @param {object} config - The normalized integration configuration.
 * @param {string} deviceExternalId - The polled device external_id.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {boolean} True when the readings have to be published again.
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
 * Forget what was published for one device, so its next read publishes every
 * value again. Gladys drops the states of a device that does not exist yet,
 * while this module records them as published: without this, a UPS added
 * from the Discovery tab stayed empty until a value changed or the hourly
 * heartbeat.
 * @param {string} deviceExternalId - The Gladys device external_id.
 * @returns {void}
 */
export function forgetDevice(deviceExternalId) {
  lastRefreshAt.delete(deviceExternalId);
  const prefix = `${deviceExternalId}:`;
  for (const featureExternalId of lastPublishedStates.keys()) {
    if (featureExternalId.startsWith(prefix)) {
      lastPublishedStates.delete(featureExternalId);
    }
  }
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

/**
 * The Gladys external ids of a discovered UPS.
 * @param {object} gladys - The SDK instance.
 * @param {object} discovered - A `{ server, snapshot }` pair.
 * @returns {object} `{ device, feature(key) }`.
 */
export function upsIds(gladys, discovered) {
  return gladys.externalIds(DEVICE_TYPE, platformId(discovered.server, discovered.snapshot.name));
}

/**
 * The name Gladys shows for a UPS: brand and model when NUT reports them,
 * followed by the server host so identical models stay distinct.
 * @param {object} discovered - A `{ server, snapshot }` pair.
 * @returns {string} The device name.
 */
export function upsDisplayName(discovered) {
  const { server, snapshot } = discovered;
  const manufacturer = snapshot.variables.get('device.mfr') ?? snapshot.variables.get('ups.mfr');
  const model = snapshot.variables.get('device.model') ?? snapshot.variables.get('ups.model');
  const name =
    [manufacturer, model].filter(Boolean).join(' ') || snapshot.description || snapshot.name;
  return `${name} (${server.host})`;
}

/**
 * The numeric readings of a UPS, keyed by feature key ("battery-charge",
 * "load", ...). Only the variables NUT actually reports are present.
 * @param {object} discovered - A `{ server, snapshot }` pair.
 * @returns {Map<string, number>} The readings.
 */
export function upsReadings(discovered) {
  const readings = new Map();
  for (const definition of NUMERIC_VARIABLES) {
    const value = valueAsNumber(discovered.snapshot.variables, definition.variable);
    if (value !== undefined) {
      readings.set(definition.key, value);
    }
  }
  return readings;
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
  const ids = upsIds(gladys, discovered);

  const numericFeatures = NUMERIC_VARIABLES.filter(
    (definition) => valueAsNumber(snapshot.variables, definition.variable) !== undefined,
  ).map((definition) => featureFromDefinition(ids, definition));
  if (numericFeatures.length === 0) {
    logger.warn(
      `The UPS ${snapshot.name} on ${server.host}:${server.port} reports no numeric variable: it is published without any feature.`,
    );
  }
  return {
    name: upsDisplayName(discovered),
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
  const ids = upsIds(gladys, discovered);
  return [...upsReadings(discovered)].map(([key, value]) => ({
    device_feature_external_id: ids.feature(key),
    state: value,
  }));
}

/**
 * Read every configured server, never throwing: each server's outcome is
 * reported, so the connection status can name the ones that failed.
 * @param {object} config - The normalized integration configuration.
 * @returns {Promise<{server: object, snapshots: object[], error: Error|null}[]>}
 *   One result per configured server.
 */
export async function readServers(config) {
  return Promise.all(
    config.servers.map(async (server) => {
      try {
        const snapshots = await getNutSnapshot({ ...server, timeout: config.timeout });
        return { server, snapshots, error: null };
      } catch (error) {
        // Debug only: the caller reports the failure (connection status, one
        // log line per change), a second error line here doubled every report.
        logger.debug(`NUT server ${server.host}:${server.port} is unavailable: ${error.message}`);
        return { server, snapshots: [], error };
      }
    }),
  );
}

/**
 * Read every configured server, and say which ones did not answer.
 * @param {object} config - The normalized integration configuration.
 * @param {object[]} [results] - The outcome of `readServers`, when already read.
 * @returns {Promise<{discovered: object[], failures: {server: object, error: Error}[]}>}
 *   The UPS read, and the servers that failed when at least one other answered.
 */
export async function discoverUpsesWithFailures(config, results) {
  results ??= await readServers(config);
  const discovered = results.flatMap(({ server, snapshots }) =>
    snapshots.map((snapshot) => ({ server, snapshot })),
  );
  const failures = results
    .filter(({ error }) => error)
    .map(({ server, error }) => ({ server, error }));
  if (discovered.length === 0 && failures.length === results.length) {
    if (results.length === 1) {
      throw failures[0].error;
    }
    throw new Error(`None of the ${results.length} configured NUT servers could be reached.`);
  }
  logger.debug(
    `Read ${discovered.length} UPS device(s) on ${config.servers.length} NUT server(s).`,
  );
  return { discovered, failures };
}

/**
 * Read every configured server.
 * @param {object} config - The normalized integration configuration.
 * @returns {Promise<object[]>} The UPS read.
 */
export async function discoverUpses(config) {
  return (await discoverUpsesWithFailures(config)).discovered;
}

// Codes of the errors that concern one device, not a NUT server: the
// connection status must not report its server as unreachable for them.
export const SERVER_REMOVED = 'NUT_SERVER_REMOVED';
export const UPS_GONE = 'NUT_UPS_GONE';

function deviceError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * The configured servers that may hold a device: its external id starts with
 * the host and port of its server, so the other servers need not be queried.
 * Empty when none matches — a server removed from the configuration (or
 * renamed) while its UPS still exists in Gladys: querying every other server
 * each minute for a UPS they never had only ended in a misleading
 * "Cannot reach the NUT server".
 * @param {object} gladys - The SDK instance.
 * @param {object} config - The normalized integration configuration.
 * @param {string} deviceExternalId - The device external_id.
 * @returns {object[]} The servers to query.
 */
export function serversOfDevice(gladys, config, deviceExternalId) {
  return config.servers.filter((server) =>
    deviceExternalId.startsWith(serverIdPrefix(gladys, server)),
  );
}

function serverIdPrefix(gladys, server) {
  return gladys.externalIds(DEVICE_TYPE, platformId(server, '')).device;
}

function upsNameOnServer(gladys, server, deviceExternalId) {
  try {
    return decodeURIComponent(deviceExternalId.slice(serverIdPrefix(gladys, server).length));
  } catch {
    return null;
  }
}

/**
 * Read one UPS from its NUT server: one connection, LIST UPS then the LIST VAR
 * of that UPS only.
 * @param {object} gladys - The SDK instance.
 * @param {object} config - The normalized integration configuration.
 * @param {string} deviceExternalId - The device external_id.
 * @returns {Promise<object>} The `{ server, snapshot }` pair of the UPS. A
 *   server failure is thrown with the failing `server` attached; a device
 *   problem with a `code` (SERVER_REMOVED, UPS_GONE).
 */
export async function readUps(gladys, config, deviceExternalId) {
  const servers = serversOfDevice(gladys, config, deviceExternalId);
  if (servers.length === 0) {
    throw deviceError(
      SERVER_REMOVED,
      `The UPS ${deviceExternalId} belongs to a NUT server that is no longer configured: add that server back, or delete the device in Gladys.`,
    );
  }
  let failure = null;
  // Usually one server; two only when a host name happens to prefix another.
  for (const server of servers) {
    const name = upsNameOnServer(gladys, server, deviceExternalId);
    if (!name) {
      continue;
    }
    try {
      const snapshot = await getNutUpsSnapshot({ ...server, timeout: config.timeout }, name);
      const item = snapshot && { server, snapshot };
      if (item && upsIds(gladys, item).device === deviceExternalId) {
        lastReads.set(deviceExternalId, { item, at: Date.now() });
        return item;
      }
    } catch (error) {
      failure ??= Object.assign(error, { server });
    }
  }
  if (failure) {
    throw failure;
  }
  throw deviceError(
    UPS_GONE,
    `The UPS for ${deviceExternalId} is no longer exposed by the NUT servers.`,
  );
}

// The last read of each UPS, whoever asked for it: the core polls every created
// UPS once a minute (for the status flags), so the widget can show that read
// instead of opening a NUT connection on every dashboard mount.
const lastReads = new Map();

/**
 * The last read of a UPS, when it is recent enough.
 * @param {string} deviceExternalId - The device external_id.
 * @param {number} maxAgeMs - The oldest read accepted.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {object|null} The `{ server, snapshot }` pair, or null.
 */
export function lastReadUps(deviceExternalId, maxAgeMs, now = Date.now()) {
  const last = lastReads.get(deviceExternalId);
  return last && now - last.at <= maxAgeMs ? last.item : null;
}

/** Forget every remembered read (tests, configuration change). */
export function forgetLastReads() {
  lastReads.clear();
}

/**
 * Write the readings of a UPS to the Gladys history. Only the readings that
 * actually changed reach Gladys: a UPS idle on mains power reports the same
 * charge, runtime and voltages for hours, and every repeat would be an extra
 * history row for no information at all.
 * @param {object} gladys - The SDK instance.
 * @param {object} config - The normalized integration configuration.
 * @param {object} item - The `{ server, snapshot }` pair of the UPS.
 * @param {number} [now] - The current timestamp, injectable for tests.
 * @returns {Promise<number>} The number of states published.
 */
export async function publishUpsReadings(gladys, config, item, now = Date.now()) {
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
  markRefreshed(upsIds(gladys, item).device, now);
  return states.length;
}

/**
 * The answer of "Test the connection".
 * @param {object} config - The normalized integration configuration.
 * @param {object[]} [results] - The outcome of `readServers`, when already read.
 * @returns {Promise<object>} A `{ en, fr }` message; throws when no server answered.
 */
export async function testNutConnection(config, results) {
  const { discovered, failures } = await discoverUpsesWithFailures(config, results);
  const names = discovered
    .map(({ server, snapshot }) => `${snapshot.name}@${server.host}`)
    .join(', ');
  const failed = failures.map(({ server }) => `${server.host}:${server.port}`).join(', ');
  return {
    en: `${discovered.length} UPS device(s) found${names ? `: ${names}.` : '.'}${failed ? ` Not answering: ${failed}.` : ''}`,
    fr: `${discovered.length} onduleur(s) détecté(s)${names ? ` : ${names}.` : '.'}${failed ? ` Sans réponse : ${failed}.` : ''}`,
  };
}
