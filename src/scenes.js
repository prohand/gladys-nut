// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys >= 5.1).
//
// Triggers: every core poll (once a minute) reads `ups.status`; a change of
// flag between two polls fires one event (power lost, power restored, low
// battery, battery to replace). The first read of a UPS only sets the
// reference: an integration restart never fires an event by itself.
//
// Action: `get_ups_status` reads a UPS on demand and returns its state to the
// following actions of the scene. It never fires a trigger nor moves the
// reference of the triggers, so a scene cannot loop through the integration.
//
// The keys below are stored in the users' scenes: never rename one.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { readUpsStatus } from './devices/status.js';
import { readUps, upsDisplayName, upsIds, upsReadings } from './devices/ups.js';

const logger = createLogger({ name: 'nut-scenes' });

export const SCENE_TRIGGERS = Object.freeze({
  POWER_LOST: 'power_lost',
  POWER_RESTORED: 'power_restored',
  BATTERY_LOW: 'battery_low',
  BATTERY_REPLACE: 'battery_replace',
});

export const SCENE_ACTIONS = Object.freeze({
  GET_UPS_STATUS: 'get_ups_status',
});

// Last `ups.status` flags seen by a poll, per device external_id.
const lastStatusFlags = new Map();

/**
 * The events a status change carries.
 * @param {Set<string>|undefined} previous - The flags of the previous poll.
 * @param {Set<string>} current - The flags of this poll.
 * @returns {string[]} The trigger keys to fire, empty on the first read.
 */
export function statusEvents(previous, current) {
  if (previous === undefined) {
    return [];
  }
  const appeared = (flag) => current.has(flag) && !previous.has(flag);
  const events = [];
  if (appeared('OB')) {
    events.push(SCENE_TRIGGERS.POWER_LOST);
  }
  if (previous.has('OB') && !current.has('OB') && current.has('OL')) {
    events.push(SCENE_TRIGGERS.POWER_RESTORED);
  }
  if (appeared('LB')) {
    events.push(SCENE_TRIGGERS.BATTERY_LOW);
  }
  if (appeared('RB')) {
    events.push(SCENE_TRIGGERS.BATTERY_REPLACE);
  }
  return events;
}

/**
 * The flat data of an event, i.e. the `ups` filter of the triggers and the
 * variables a scene reads as {{triggerEvent.data.<key>}}.
 * @param {object} gladys - The SDK instance.
 * @param {object} item - The `{ server, snapshot }` pair of the UPS.
 * @returns {object} The event data.
 */
export function eventData(gladys, item) {
  const readings = upsReadings(item);
  const runtime = readings.get('battery-runtime');
  return {
    ups: upsIds(gladys, item).device,
    ups_name: upsDisplayName(item),
    status: readUpsStatus(item.snapshot.variables).raw || null,
    battery_charge: readings.get('battery-charge') ?? null,
    battery_runtime: runtime === undefined ? null : Math.round(runtime / 60),
    load: readings.get('load') ?? null,
  };
}

/**
 * Compare the status of a freshly polled UPS with the previous poll and fire
 * the matching scene triggers.
 * @param {object} gladys - The SDK instance.
 * @param {object} item - The `{ server, snapshot }` pair of the UPS.
 * @returns {Promise<string[]>} The trigger keys fired.
 */
export async function watchUpsStatus(gladys, item) {
  const deviceExternalId = upsIds(gladys, item).device;
  const current = readUpsStatus(item.snapshot.variables).flags;
  if (current.size === 0) {
    // No status in this read (driver hiccup): keep the previous reference,
    // otherwise its return would look like a new transition.
    return [];
  }
  const events = statusEvents(lastStatusFlags.get(deviceExternalId), current);
  lastStatusFlags.set(deviceExternalId, current);
  if (events.length === 0) {
    return events;
  }
  const data = eventData(gladys, item);
  for (const key of events) {
    logger.info(`${data.ups_name}: ${key} (${data.status ?? 'no status'})`);
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (error) {
      // A refused event (older core, rate limit) must not fail the poll: the
      // readings still have to reach Gladys.
      logger.error(`Cannot fire the scene trigger ${key}`, error);
    }
  }
  return events;
}

/**
 * Forget the previous statuses, e.g. in tests.
 * @returns {void}
 */
export function resetStatusWatch() {
  lastStatusFlags.clear();
}

/**
 * The outputs of the `get_ups_status` scene action. A reading the UPS does not
 * report is left out, the scene then sees it as empty.
 * @param {object} item - The `{ server, snapshot }` pair of the UPS.
 * @returns {object} The declared outputs.
 */
export function upsStatusOutputs(item) {
  const status = readUpsStatus(item.snapshot.variables);
  const readings = upsReadings(item);
  const outputs = {
    ups_name: upsDisplayName(item),
    status: status.key,
    on_battery: status.onBattery,
    low_battery: status.lowBattery,
    replace_battery: status.replaceBattery,
  };
  const numeric = {
    battery_charge: readings.get('battery-charge'),
    battery_runtime: readings.has('battery-runtime')
      ? Math.round(readings.get('battery-runtime') / 60)
      : undefined,
    load: readings.get('load'),
    input_voltage: readings.get('input-voltage'),
  };
  for (const [key, value] of Object.entries(numeric)) {
    if (value !== undefined) {
      outputs[key] = value;
    }
  }
  return outputs;
}

/**
 * Register the scene actions on the SDK instance.
 * @param {object} gladys - The SDK instance.
 * @param {() => object} getConfig - Returns the current normalized configuration.
 * @returns {void}
 */
export function registerSceneActions(gladys, getConfig) {
  gladys.onSceneAction(SCENE_ACTIONS.GET_UPS_STATUS, async (fields) => {
    const config = getConfig();
    if (!config) {
      throw new Error('The integration is not configured yet.');
    }
    if (!fields.ups) {
      throw new Error('No UPS selected.');
    }
    const item = await readUps(gladys, config, fields.ups);
    return upsStatusOutputs(item);
  });
}
