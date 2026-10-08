import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { aggregateStatus, createConnectionStatus } from '../src/connectionStatus.js';
import {
  discoverUpsesWithFailures,
  readUps,
  resetRefreshSchedule,
  SERVER_REMOVED,
  serversOfDevice,
} from '../src/devices/ups.js';
import { createPollHandler, pollUps } from '../src/poll.js';
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
  // A device of a server removed from the configuration: none of the others
  // ever held it, so none is queried.
  assert.deepEqual(serversOfDevice(gladys, config, 'nut-ups:old-3493-ups'), []);
});

test('a UPS of a removed server is reported as such, without reading any server', async () => {
  const gladys = createFakeGladys();
  const config = {
    servers: [{ id: 'server-1', host: '127.0.0.1', port: nut.port }],
    poll_frequency: 300,
    timeout: 1000,
  };
  const before = nut.connections;
  await assert.rejects(
    () => readUps(gladys, config, 'nut-ups:old-host-3493-main-ups'),
    (error) => error.code === SERVER_REMOVED && /no longer configured/.test(error.message),
  );
  assert.equal(nut.connections, before, 'no NUT connection opened');
});

test('a poll reads only its UPS, on one connection', async () => {
  const fake = await startFakeNut(
    new Map([
      ['ups-a', new Map([['battery.charge', '90']])],
      ['ups-b', new Map([['battery.charge', '80']])],
    ]),
  );
  try {
    const gladys = createFakeGladys();
    const config = {
      servers: [{ id: 'server-1', host: '127.0.0.1', port: fake.port }],
      poll_frequency: 300,
      timeout: 1000,
    };
    const item = await readUps(gladys, config, `nut-ups:127.0.0.1-${fake.port}-ups-b`);
    assert.equal(item.snapshot.variables.get('battery.charge'), '80');
    assert.equal(fake.connections, 1);
    assert.deepEqual(fake.commands, ['LIST UPS', 'LIST VAR "ups-b"']);

    await assert.rejects(
      () => readUps(gladys, config, `nut-ups:127.0.0.1-${fake.port}-ups-c`),
      /no longer exposed/,
    );
  } finally {
    await fake.close();
  }
});

function recordingLogger() {
  const lines = { error: [], warn: [], info: [] };
  return {
    lines,
    error: (message) => lines.error.push(message),
    warn: (message) => lines.warn.push(message),
    info: (message) => lines.info.push(message),
  };
}

test('one server down out of two: a steady partial status, logged once', async () => {
  resetRefreshSchedule();
  resetStatusWatch();
  const gladys = createFakeGladys();
  const log = recordingLogger();
  const config = {
    servers: [
      { id: 'server-1', host: '127.0.0.1', port: nut.port },
      // Nothing listens on port 9: refused at once.
      { id: 'server-2', host: '127.0.0.1', port: 9 },
    ],
    poll_frequency: 300,
    timeout: 1000,
  };
  const status = createConnectionStatus(gladys, log);
  status.setServers(config.servers);
  const onPoll = createPollHandler({ gladys, getConfig: () => config, status, log });
  const healthy = { external_id: `nut-ups:127.0.0.1-${nut.port}-main-ups` };
  const down = { external_id: 'nut-ups:127.0.0.1-9-other-ups' };

  for (let minute = 0; minute < 3; minute += 1) {
    await onPoll(healthy);
    await assert.rejects(() => onPoll(down));
  }

  // Connected (the first server answers), the second one named — and never a
  // blink back to a bare "connected" or to "disconnected".
  assert.equal(gladys.connectionStatuses.length, 2);
  assert.deepEqual(gladys.connectionStatuses[0], { connected: true, message: undefined });
  const partial = gladys.connectionStatuses[1];
  assert.equal(partial.connected, true);
  assert.match(partial.message.en, /1 of 2 NUT servers do not answer: 127\.0\.0\.1:9/);
  assert.equal(log.lines.error.length, 1, 'the failure is logged once, not every minute');
});

test('a UPS of a removed server is skipped quietly, with one warning', async () => {
  const gladys = createFakeGladys();
  const log = recordingLogger();
  const config = {
    servers: [{ id: 'server-1', host: '127.0.0.1', port: nut.port }],
    poll_frequency: 300,
    timeout: 1000,
  };
  const status = createConnectionStatus(gladys, log);
  status.setServers(config.servers);
  const onPoll = createPollHandler({ gladys, getConfig: () => config, status, log });
  const orphan = { external_id: 'nut-ups:old-host-3493-main-ups' };

  await onPoll(orphan);
  await onPoll(orphan);
  assert.equal(log.lines.warn.length, 1);
  assert.match(log.lines.warn[0], /no longer configured/);
  assert.deepEqual(gladys.connectionStatuses, [], 'no "cannot reach" for a removed server');
});

test('the status is disconnected only when every server fails', () => {
  assert.deepEqual(aggregateStatus(2, new Map()), { connected: true });
  const one = aggregateStatus(2, new Map([['a:3493', 'refused']]));
  assert.equal(one.connected, true);
  assert.match(one.message.fr, /1 serveur\(s\) NUT sur 2/);
  const all = aggregateStatus(
    2,
    new Map([
      ['a:3493', 'refused'],
      ['b:3493', 'timeout'],
    ]),
  );
  assert.equal(all.connected, false);
  assert.match(all.message.en, /a:3493 \(refused\); b:3493 \(timeout\)/);
});

test('names the server that did not answer while another one did', async () => {
  const config = {
    servers: [
      { id: 'server-1', host: '127.0.0.1', port: nut.port },
      // Nothing listens on port 9: refused at once.
      { id: 'server-2', host: '127.0.0.1', port: 9 },
    ],
    poll_frequency: 300,
    timeout: 1000,
  };
  const { discovered, failures } = await discoverUpsesWithFailures(config);
  assert.equal(discovered.length, 1);
  assert.deepEqual(
    failures.map(({ server }) => server.id),
    ['server-2'],
  );
});
