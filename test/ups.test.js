import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { buildDiscoveredDevices, buildUpsDevice, buildUpsStates } from '../src/devices/ups.js';

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
  assert.equal(device.poll_frequency, 60000);
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
