import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  buildDiscoveredDevices,
  buildUpsDevice,
  buildUpsStates,
  CORE_POLL_FREQUENCIES,
  corePollFrequency,
  isRefreshDue,
  markRefreshed,
  resetRefreshSchedule,
} from '../src/devices/ups.js';

const config = {
  servers: [],
  poll_frequency: 60,
};

const serverOne = { id: 'server-1', host: 'nut-one.local', port: 3493 };
const serverTwo = { id: 'server-2', host: 'nut-two.local', port: 3493 };

function discovered(server = serverOne, overrides = {}) {
  return {
    server,
    snapshot: {
      name: 'main-ups',
      description: 'Server UPS',
      variables: new Map([
        ['ups.mfr', 'APC'],
        ['ups.model', 'Smart-UPS 1500'],
        ['battery.charge', '92'],
        ['battery.runtime', '840'],
        ['ups.load', '24.5'],
        ['input.voltage', '229.2'],
        ['output.voltage', '230.1'],
        ['battery.voltage', '27.3'],
        ['input.current', '1.1'],
        ['output.current', '0.9'],
        ['ups.realpower', '165'],
        ['ups.power', '210'],
        ['ups.temperature', '31.5'],
        ['battery.temperature', '29.7'],
        ['ups.status', 'OL'],
        ['ups.alarm', 'No alarms'],
        ['battery.charger.status', 'floating'],
      ]),
      ...overrides,
    },
  };
}

test('builds a UPS device from variables reported by NUT', () => {
  const gladys = createFakeGladys();
  const device = buildUpsDevice(gladys, config, discovered());

  assert.equal(device.name, 'APC Smart-UPS 1500 (nut-one.local)');
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, CORE_POLL_FREQUENCIES.EVERY_MINUTE);
  assert.match(device.external_id, /^nut-ups:nut-one\.local-3493-main-ups$/);
  assert.equal(device.features.length, 12);
  assert.deepEqual(
    device.features.find((feature) => feature.name === 'Battery charge'),
    {
      name: 'Battery charge',
      external_id: `${device.external_id}:battery-charge`,
      category: 'battery',
      type: 'integer',
      unit: 'percent',
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
  );
});

test('bounds every published feature, as Gladys rejects a null min or max', () => {
  const gladys = createFakeGladys();
  const device = buildUpsDevice(gladys, config, discovered());

  for (const feature of device.features) {
    assert.ok(
      Number.isFinite(feature.min),
      `${feature.name} must declare a numeric min, got ${feature.min}`,
    );
    assert.ok(
      Number.isFinite(feature.max),
      `${feature.name} must declare a numeric max, got ${feature.max}`,
    );
    assert.ok(feature.min < feature.max, `${feature.name} must declare min lower than max`);
  }
});

test('registers the device on a polling frequency Gladys accepts', () => {
  const gladys = createFakeGladys();
  const slow = buildUpsDevice(gladys, { ...config, poll_frequency: 3600 }, discovered());
  const fast = buildUpsDevice(gladys, { ...config, poll_frequency: 30 }, discovered());

  assert.equal(slow.poll_frequency, CORE_POLL_FREQUENCIES.EVERY_MINUTE);
  assert.equal(fast.poll_frequency, CORE_POLL_FREQUENCIES.EVERY_30_SECONDS);
  assert.equal(corePollFrequency(45), CORE_POLL_FREQUENCIES.EVERY_MINUTE);
  for (const frequency of Object.values(CORE_POLL_FREQUENCIES)) {
    // Gladys Core only stores the frequencies of its own DEVICE_POLL_FREQUENCIES enum
    assert.ok([1000, 2000, 10000, 15000, 30000, 60000].includes(frequency));
  }
});

test('reads the NUT server only once per configured refresh interval', () => {
  const externalId = 'nut-ups:nut-one.local-3493-main-ups';
  const hourly = { ...config, poll_frequency: 3600 };
  resetRefreshSchedule();

  assert.equal(isRefreshDue(hourly, externalId, 0), true);
  markRefreshed(externalId, 0);
  assert.equal(isRefreshDue(hourly, externalId, 60 * 1000), false);
  assert.equal(isRefreshDue(hourly, externalId, 3500 * 1000), false);
  // due on the core tick closest to the configured interval (3600s - 60s / 2)
  assert.equal(isRefreshDue(hourly, externalId, 3570 * 1000), true);
  // a core tick landing a few milliseconds early must not skip a whole cycle
  assert.equal(isRefreshDue({ ...config, poll_frequency: 60 }, externalId, 59_990), true);

  resetRefreshSchedule();
  assert.equal(isRefreshDue(hourly, externalId, 60 * 1000), true);
});

test('does not create text-only NUT sensors in the discovery payload', () => {
  const gladys = createFakeGladys();
  const device = buildUpsDevice(
    gladys,
    config,
    discovered(serverOne, { variables: new Map([['ups.status', 'OB']]) }),
  );

  assert.deepEqual(device.features, []);
});

test('creates numeric state payloads for the known UPS', () => {
  const gladys = createFakeGladys();
  const states = buildUpsStates(gladys, config, discovered());

  assert.deepEqual(
    states.find((state) => state.device_feature_external_id.endsWith(':battery-charge')),
    {
      device_feature_external_id: 'nut-ups:nut-one.local-3493-main-ups:battery-charge',
      state: 92,
    },
  );
});

test('keeps identical UPS names independent across NUT servers', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, config, [
    discovered(serverOne),
    discovered(serverTwo),
  ]);

  assert.equal(devices.length, 2);
  assert.notEqual(devices[0].external_id, devices[1].external_id);
  assert.match(devices[0].name, /nut-one\.local/);
  assert.match(devices[1].name, /nut-two\.local/);
});
