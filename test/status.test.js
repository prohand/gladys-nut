import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRuntime, parseStatusFlags, readUpsStatus } from '../src/devices/status.js';

const status = (raw) => readUpsStatus(new Map(raw === undefined ? [] : [['ups.status', raw]]));

test('splits the NUT status into flags', () => {
  assert.deepEqual([...parseStatusFlags('OL  chrg ')], ['OL', 'CHRG']);
  assert.equal(parseStatusFlags(undefined).size, 0);
});

test('reads the primary state, the most serious flag first', () => {
  assert.equal(status('OL CHRG').key, 'online');
  assert.equal(status('OL CHRG').color, 'success');
  assert.equal(status('OB DISCHRG').key, 'on_battery');
  assert.equal(status('OB DISCHRG LB').key, 'low_battery');
  assert.equal(status('FSD OB LB').key, 'forced_shutdown');
  assert.equal(status('OL BYPASS').key, 'bypass');
  assert.equal(status('OFF').key, 'off');
  assert.equal(status(undefined).key, 'unknown');
});

test('exposes the flags the scenes and the widget rely on', () => {
  const read = status('OB LB RB OVER');
  assert.equal(read.onBattery, true);
  assert.equal(read.lowBattery, true);
  assert.equal(read.replaceBattery, true);
  assert.equal(read.overload, true);
  assert.equal(read.charging, false);
  assert.equal(read.raw, 'OB LB RB OVER');
});

test('formats the runtime within the 12 characters of a widget tile', () => {
  assert.equal(formatRuntime(840), '14 min');
  assert.equal(formatRuntime(5100), '1 h 25');
  assert.equal(formatRuntime(3600), '1 h 00');
  assert.equal(formatRuntime(-5), '0 min');
  assert.ok(formatRuntime(10_000_000).length <= 12);
});
