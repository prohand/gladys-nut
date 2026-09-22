import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resetRefreshSchedule, serversOfDevice } from '../src/devices/ups.js';
import { pollUps } from '../src/poll.js';
import { resetStatusWatch } from '../src/scenes.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { startFakeNut } from './helpers/fakeNut.js';

let nut;
const variables = new Map([
  ['battery.charge', '100'],
  ['ups.status', 'OL'],
]);

before(async () => {
  nut = await startFakeNut(new Map([['main-ups', variables]]));
});
after(() => nut.close());

test('watches the status every minute but writes the readings once per interval', async () => {
  resetRefreshSchedule();
  resetStatusWatch();
  const gladys = createFakeGladys();
  const config = {
    servers: [{ id: 'server-1', host: '127.0.0.1', port: nut.port }],
    poll_frequency: 300,
    timeout: 1000,
  };
  const device = `nut-ups:127.0.0.1-${nut.port}-main-ups`;

  const first = await pollUps(gladys, config, device);
  assert.equal(first.refreshed, true);
  assert.deepEqual(first.events, []);
  assert.equal(gladys.published.length, 1);

  // Power cut one minute later: inside the interval, the event still fires.
  variables.set('ups.status', 'OB DISCHRG');
  variables.set('battery.charge', '97');
  const second = await pollUps(gladys, config, device);
  assert.equal(second.refreshed, false);
  assert.deepEqual(second.events, ['power_lost']);
  assert.deepEqual(gladys.widgetRefreshes, ['ups']);
  assert.equal(gladys.published.length, 1, 'no history row inside the interval');

  variables.set('ups.status', 'OL CHRG');
  const third = await pollUps(gladys, config, device);
  assert.deepEqual(third.events, ['power_restored']);
  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.key),
    ['power_lost', 'power_restored'],
  );
});

test('queries only the server a device belongs to', () => {
  const gladys = createFakeGladys();
  const one = { id: 'server-1', host: 'nas', port: 3493 };
  const two = { id: 'server-2', host: 'nas-2', port: 3493 };
  const config = { servers: [one, two] };

  assert.deepEqual(serversOfDevice(gladys, config, 'nut-ups:nas-2-3493-ups'), [two]);
  assert.deepEqual(serversOfDevice(gladys, config, 'nut-ups:nas-3493-ups'), [one]);
  // A device of a server removed from the configuration: try them all.
  assert.deepEqual(serversOfDevice(gladys, config, 'nut-ups:old-3493-ups'), [one, two]);
});
