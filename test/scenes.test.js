import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { parseStatusFlags } from '../src/devices/status.js';
import {
  eventData,
  registerSceneActions,
  resetStatusWatch,
  SCENE_TRIGGERS,
  statusEvents,
  upsStatusOutputs,
  watchUpsStatus,
} from '../src/scenes.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const server = { id: 'server-1', host: 'nut-one.local', port: 3493 };

function discovered(status, extra = []) {
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
        ['ups.status', status],
        ...extra,
      ]),
    },
  };
}

beforeEach(() => resetStatusWatch());

test('fires nothing on the first read of a UPS', () => {
  assert.deepEqual(statusEvents(undefined, parseStatusFlags('OB LB')), []);
});

test('fires one event per status transition', () => {
  const events = (previous, current) =>
    statusEvents(parseStatusFlags(previous), parseStatusFlags(current));

  assert.deepEqual(events('OL CHRG', 'OB DISCHRG'), [SCENE_TRIGGERS.POWER_LOST]);
  assert.deepEqual(events('OB DISCHRG', 'OB DISCHRG'), []);
  assert.deepEqual(events('OB DISCHRG', 'OB DISCHRG LB'), [SCENE_TRIGGERS.BATTERY_LOW]);
  assert.deepEqual(events('OB LB', 'OL CHRG'), [SCENE_TRIGGERS.POWER_RESTORED]);
  assert.deepEqual(events('OL', 'OL RB'), [SCENE_TRIGGERS.BATTERY_REPLACE]);
  // A cut that already drains the battery on the first minute carries both.
  assert.deepEqual(events('OL', 'OB LB'), [SCENE_TRIGGERS.POWER_LOST, SCENE_TRIGGERS.BATTERY_LOW]);
  // A UPS that stops answering its status is not a restored power.
  assert.deepEqual(events('OB', ''), []);
});

test('publishes the declared variables with the UPS as filter', async () => {
  const gladys = createFakeGladys();
  await watchUpsStatus(gladys, discovered('OL'));
  assert.deepEqual(gladys.sceneEvents, []);

  await watchUpsStatus(gladys, discovered('OB DISCHRG'));
  assert.deepEqual(gladys.sceneEvents, [
    {
      key: 'power_lost',
      data: {
        ups: 'nut-ups:nut-one.local-3493-main-ups',
        ups_name: 'APC Smart-UPS 1500 (nut-one.local)',
        status: 'OB DISCHRG',
        battery_charge: 92,
        battery_runtime: 14,
        load: 24.5,
      },
    },
  ]);
});

test('sends null for the readings a UPS does not report', () => {
  const gladys = createFakeGladys();
  const item = discovered('OL');
  item.snapshot.variables = new Map([['ups.status', 'OL']]);
  const data = eventData(gladys, item);
  assert.equal(data.battery_charge, null);
  assert.equal(data.battery_runtime, null);
  assert.equal(data.load, null);
});

test('ignores a read without status instead of firing twice', async () => {
  const gladys = createFakeGladys();
  await watchUpsStatus(gladys, discovered('OB'));
  assert.deepEqual(await watchUpsStatus(gladys, discovered('')), []);
  assert.deepEqual(await watchUpsStatus(gladys, discovered('OB')), []);
  assert.deepEqual(gladys.sceneEvents, []);
});

test('keeps polling when Gladys refuses an event', async () => {
  const gladys = createFakeGladys();
  gladys.publishSceneEvent = async () => {
    throw new Error('429');
  };
  await watchUpsStatus(gladys, discovered('OL'));
  assert.deepEqual(await watchUpsStatus(gladys, discovered('OB')), ['power_lost']);
});

test('returns the state of a UPS to the scene', () => {
  assert.deepEqual(upsStatusOutputs(discovered('OB DISCHRG LB')), {
    ups_name: 'APC Smart-UPS 1500 (nut-one.local)',
    status: 'low_battery',
    on_battery: true,
    low_battery: true,
    replace_battery: false,
    battery_charge: 92,
    battery_runtime: 14,
    load: 24.5,
    input_voltage: 229.2,
  });
});

test('refuses the scene action before the configuration is loaded', async () => {
  const gladys = createFakeGladys();
  registerSceneActions(gladys, () => undefined);
  await assert.rejects(gladys.handlers['sceneAction:get_ups_status']({ ups: 'x' }), /configured/);
});

test('get_ups_status returns exactly the outputs the manifest declares', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(
    await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  const declared = manifest.scene_actions
    .find((action) => action.key === 'get_ups_status')
    .outputs.map((output) => output.key)
    .sort();
  // A key the manifest declares but the handler leaves out reads as null in the
  // scene, and a key it adds is invisible to the scene editor.
  assert.deepEqual(Object.keys(upsStatusOutputs(discovered('OL'))).sort(), declared);
});
