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
  },
  {
    variable: 'ups.load',
    key: 'load',
    name: 'Load',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
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
  },
  {
    variable: 'output.voltage',
    key: 'output-voltage',
    name: 'Output voltage',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
    min: 0,
  },
  {
    variable: 'battery.voltage',
    key: 'battery-voltage',
    name: 'Battery voltage',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
    min: 0,
  },
  {
    variable: 'input.current',
    key: 'input-current',
    name: 'Input current',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
    unit: DEVICE_FEATURE_UNITS.AMPERE,
    min: 0,
  },
  {
    variable: 'output.current',
    key: 'output-current',
    name: 'Output current',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
    unit: DEVICE_FEATURE_UNITS.AMPERE,
    min: 0,
  },
  {
    variable: 'ups.realpower',
    key: 'real-power',
    name: 'Real power',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
    unit: DEVICE_FEATURE_UNITS.WATT,
    min: 0,
  },
  {
    variable: 'ups.power',
    key: 'apparent-power',
    name: 'Apparent power',
    category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.VOLT_AMPERE,
    min: 0,
  },
  {
    variable: 'ups.temperature',
    key: 'ups-temperature',
    name: 'UPS temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
  },
  {
    variable: 'battery.temperature',
    key: 'battery-temperature',
    name: 'Battery temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
  },
];

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

export function buildUpsDevice(gladys, config, discovered) {
  const { server, snapshot } = discovered;
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(server, snapshot.name));
  const manufacturer = snapshot.variables.get('device.mfr') ?? snapshot.variables.get('ups.mfr');
  const model = snapshot.variables.get('device.model') ?? snapshot.variables.get('ups.model');
  const name =
    [manufacturer, model].filter(Boolean).join(' ') || snapshot.description || snapshot.name;

  const numericFeatures = NUMERIC_VARIABLES.filter(
    (definition) => valueAsNumber(snapshot.variables, definition.variable) !== undefined,
  ).map((definition) => featureFromDefinition(ids, definition));
  return {
    name: `${name} (${server.host})`,
    external_id: ids.device,
    // Gladys Core expects polling frequencies in milliseconds; the manifest and
    // user-facing configuration deliberately stay in seconds.
    poll_frequency: config.poll_frequency * 1000,
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
  const discovered = await discoverUpses(config);
  const item = discovered.find(
    ({ server, snapshot }) =>
      gladys.externalIds(DEVICE_TYPE, platformId(server, snapshot.name)).device ===
      deviceExternalId,
  );
  if (!item) {
    throw new Error(`The UPS for ${deviceExternalId} is no longer exposed by the NUT servers.`);
  }

  const states = buildUpsStates(gladys, config, item);
  if (states.length > 0) {
    await gladys.publishStates(states);
  }
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
