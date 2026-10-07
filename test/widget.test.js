import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  buildMessageContent,
  buildUpsWidgetContent,
  loadingContent,
  registerWidget,
  withDeadline,
} from '../src/widget.js';
import { forgetLastReads, lastReadUps } from '../src/devices/ups.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { startFakeNut } from './helpers/fakeNut.js';

const server = { id: 'server-1', host: 'nut-one.local', port: 3493 };

function discovered(variables) {
  return { server, snapshot: { name: 'main-ups', description: 'Server UPS', variables } };
}

const fullUps = new Map([
  ['ups.mfr', 'APC'],
  ['ups.model', 'Smart-UPS 1500'],
  ['battery.charge', '92'],
  ['battery.runtime', '840'],
  ['ups.load', '24.5'],
  ['input.voltage', '229.2'],
  ['ups.realpower', '165'],
  ['ups.status', 'OB DISCHRG LB RB OVER'],
  ['ups.alarm', 'Replace battery!'],
]);

test('fits the content budget of the core, so nothing is dropped', () => {
  const content = buildUpsWidgetContent(createFakeGladys(), discovered(fullUps));
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(content.components.length <= 8);
});

test('shows the charge inline with its unit, binds the other tiles and the chart', () => {
  const content = buildUpsWidgetContent(createFakeGladys(), discovered(fullUps));
  const device = 'nut-ups:nut-one.local-3493-main-ups';
  const gauge = content.components.find((component) => component.type === 'gauge');
  const chart = content.components.find((component) => component.type === 'chart');
  const status = content.components.find((component) => component.type === 'status');

  // Inline: a device-bound gauge is drawn without its unit.
  assert.equal(gauge.device_feature, undefined);
  assert.equal(gauge.value, 92);
  assert.equal(gauge.unit, '%');
  assert.equal(gauge.color, 'danger');
  assert.deepEqual(chart.device_features, [`${device}:battery-charge`, `${device}:load`]);
  assert.deepEqual(status.items[0].value, { en: 'Low battery', fr: 'Batterie faible' });
  assert.equal(status.items[0].color, 'danger');
});

test('shows only what a minimal UPS reports', () => {
  const content = buildUpsWidgetContent(
    createFakeGladys(),
    discovered(new Map([['ups.status', 'OL']])),
  );
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    content.components.map((component) => component.type),
    ['text', 'status', 'button'],
  );
});

test('explains an empty or failing widget instead of failing', () => {
  assert.deepEqual(validateWidgetContent(buildMessageContent({ en: 'x', fr: 'x' })), []);
});

let nut;
before(async () => {
  nut = await startFakeNut(new Map([['main-ups', new Map([['ups.status', 'OL']])]]));
});
after(() => nut.close());

test('reads the chosen UPS when the dashboard asks for the widget', async () => {
  forgetLastReads();
  const gladys = createFakeGladys();
  const config = {
    servers: [{ id: 'server-1', host: '127.0.0.1', port: nut.port }],
    poll_frequency: 300,
    timeout: 1000,
  };
  registerWidget(gladys, () => config);
  const get = gladys.handlers['widget:ups'];

  const noUps = await get({ settings: {}, language: 'fr' });
  assert.equal(noUps.components[0].type, 'text');

  const device = `nut-ups:127.0.0.1-${nut.port}-main-ups`;
  const content = await get({ settings: { ups: device }, language: 'fr' });
  assert.equal(content.components[0].text, 'main-ups (127.0.0.1)');
  assert.deepEqual(validateWidgetContent(content), []);

  const missing = await get({ settings: { ups: `${device}-gone` }, language: 'fr' });
  assert.match(missing.components[0].text.en, /no longer exposed/);

  const message = await gladys.handlers['widgetAction:ups'](
    'refresh',
    {},
    { settings: { ups: device } },
  );
  assert.deepEqual(message, { en: 'UPS refreshed', fr: 'Onduleur actualisé' });
});

test('serves the read the polls just made, without opening a NUT connection', async () => {
  forgetLastReads();
  const gladys = createFakeGladys();
  const config = {
    servers: [{ id: 'server-1', host: '127.0.0.1', port: nut.port }],
    poll_frequency: 300,
    timeout: 1000,
  };
  registerWidget(gladys, () => config);
  const device = `nut-ups:127.0.0.1-${nut.port}-main-ups`;
  await gladys.handlers['widget:ups']({ settings: { ups: device }, language: 'fr' });
  assert.ok(lastReadUps(device, 60_000), 'the read is remembered');

  // Even with the server gone, the recent read answers.
  const offline = { ...config, servers: [{ id: 'server-1', host: '127.0.0.1', port: 9 }] };
  registerWidget(gladys, () => offline);
  const content = await gladys.handlers['widget:ups']({
    settings: { ups: device },
    language: 'fr',
  });
  assert.equal(content.components[0].text, 'main-ups (127.0.0.1)');
});

test('a read slower than the deadline gives a loading card, never a dead one', async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 50));
  assert.equal(await withDeadline(slow, 5), null);
  assert.equal(await withDeadline(Promise.resolve('fast'), 50), 'fast');
  await assert.rejects(withDeadline(Promise.reject(new Error('down')), 50), /down/);
  assert.deepEqual(validateWidgetContent(loadingContent()), []);
});
