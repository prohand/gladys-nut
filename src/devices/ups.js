// -----------------------------------------------------------------------------
// NUT UPS device mapping.
//
// NUT drivers do not all expose the same variables. Discovery therefore builds
// each device from the variables that its upsd server actually reports instead
// of creating permanently empty sensors.
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

const TEXT_VARIABLES = [
  {
    variable: 'ups.status',
    key: 'status',
    name: 'Status',
  },
  {
    variable: 'ups.alarm',
    key: 'alarm',
    name: 'Alarm',
  },
  {
    variable: 'battery.charger.status',
    key: 'charger-status',
    name: 'Battery charger status',
  },
];

function platformId(config, upsName) {
  return `${encodeURIComponent(config.host)}-${config.port}-${encodeURIComponent(upsName)}`;
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

function textFeature(ids, definition) {
  return {
    name: definition.name,
    external_id: ids.feature(definition.key),
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

export function buildUpsDevice(gladys, config, snapshot) {
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(config, snapshot.name));
  const manufacturer = snapshot.variables.get('device.mfr') ?? snapshot.variables.get('ups.mfr');
  const model = snapshot.variables.get('device.model') ?? snapshot.variables.get('ups.model');
  const name =
    [manufacturer, model].filter(Boolean).join(' ') || snapshot.description || snapshot.name;

  const numericFeatures = NUMERIC_VARIABLES.filter(
    (definition) => valueAsNumber(snapshot.variables, definition.variable) !== undefined,
  ).map((definition) => featureFromDefinition(ids, definition));
  const textFeatures = TEXT_VARIABLES.filter((definition) =>
    snapshot.variables.has(definition.variable),
  ).map((definition) => textFeature(ids, definition));

  return {
    name,
    external_id: ids.device,
    // Gladys Core expects polling frequencies in milliseconds; the manifest and
    // user-facing configuration deliberately stay in seconds.
    poll_frequency: config.poll_frequency * 1000,
    features: [...numericFeatures, ...textFeatures],
  };
}

export function buildDiscoveredDevices(gladys, config, snapshots) {
  return snapshots.map((snapshot) => buildUpsDevice(gladys, config, snapshot));
}

export function buildUpsStates(gladys, config, snapshot) {
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(config, snapshot.name));
  const numericStates = NUMERIC_VARIABLES.flatMap((definition) => {
    const value = valueAsNumber(snapshot.variables, definition.variable);
    return value === undefined
      ? []
      : [{ device_feature_external_id: ids.feature(definition.key), state: value }];
  });
  const textStates = TEXT_VARIABLES.flatMap((definition) => {
    const value = snapshot.variables.get(definition.variable);
    return value === undefined
      ? []
      : [{ device_feature_external_id: ids.feature(definition.key), state: { text: value } }];
  });
  return [...numericStates, ...textStates];
}

export async function discoverUpses(config) {
  const snapshots = await getNutSnapshot(config);
  logger.info(`Discovered ${snapshots.length} UPS device(s) on ${config.host}:${config.port}.`);
  return snapshots;
}

export async function publishUpsStates(gladys, config, deviceExternalId) {
  const snapshots = await discoverUpses(config);
  const snapshot = snapshots.find(
    (candidate) =>
      gladys.externalIds(DEVICE_TYPE, platformId(config, candidate.name)).device ===
      deviceExternalId,
  );
  if (!snapshot) {
    throw new Error(`The UPS for ${deviceExternalId} is no longer exposed by the NUT server.`);
  }

  const states = buildUpsStates(gladys, config, snapshot);
  if (states.length > 0) {
    await gladys.publishStates(states);
  }
  return snapshot;
}

export async function testNutConnection(config) {
  const snapshots = await discoverUpses(config);
  const names = snapshots.map((snapshot) => snapshot.name).join(', ');
  return {
    en: `${snapshots.length} UPS device(s) found${names ? `: ${names}.` : '.'}`,
    fr: `${snapshots.length} onduleur(s) détecté(s)${names ? ` : ${names}.` : '.'}`,
  };
}
