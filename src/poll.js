// -----------------------------------------------------------------------------
// Handling of one core poll (once a minute per UPS device).
//
// Every poll reads the UPS so the scene triggers see a power cut within a
// minute; the readings, which fill the Gladys history, are only written once
// per configured interval.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  isRefreshDue,
  publishUpsReadings,
  readUps,
  SERVER_REMOVED,
  UPS_GONE,
} from './devices/ups.js';
import { watchUpsStatus } from './scenes.js';
import { UPS_WIDGET } from './widget.js';

const logger = createLogger({ name: 'nut-poll' });

/**
 * Read a polled UPS, fire its scene triggers and, when due, publish its readings.
 * @param {object} gladys - The SDK instance.
 * @param {object} config - The normalized integration configuration.
 * @param {string} deviceExternalId - The polled device external_id.
 * @returns {Promise<{ item: object, events: string[], refreshed: boolean }>}
 * `refreshed` is false when the poll fell inside the configured interval.
 */
export async function pollUps(gladys, config, deviceExternalId) {
  const item = await readUps(gladys, config, deviceExternalId);
  const events = await watchUpsStatus(gladys, item);
  if (events.length > 0) {
    try {
      // The widget shows the state: re-pull it now rather than at TTL expiry.
      gladys.requestWidgetRefresh(UPS_WIDGET);
    } catch (error) {
      logger.debug('Widget refresh request failed', error);
    }
  }
  const refreshed = isRefreshDue(config, deviceExternalId);
  if (refreshed) {
    await publishUpsReadings(gladys, config, item);
  }
  return { item, events, refreshed };
}

/**
 * The handler of the core polls: reads the UPS, keeps the aggregated
 * connection status up to date, and reports a device that can no longer be
 * read once instead of every minute.
 * @param {object} options - Dependencies.
 * @param {object} options.gladys - The SDK instance.
 * @param {() => object|null} options.getConfig - The current normalized configuration.
 * @param {object} options.status - The connection status tracker (src/connectionStatus.js).
 * @param {object} [options.log] - A logger (warn, error); the module logger by default.
 * @param {Function} [options.poll] - The read, `pollUps` by default (tests).
 * @returns {(device: {external_id: string}) => Promise<void>} The handler.
 */
export function createPollHandler({ gladys, getConfig, status, log = logger, poll = pollUps }) {
  // Device problems already logged, so a poll a minute does not repeat them.
  const reported = new Map();

  return async (device) => {
    const config = getConfig();
    if (!config) {
      return;
    }
    const deviceExternalId = device.external_id;
    try {
      const { item } = await poll(gladys, config, deviceExternalId);
      reported.delete(deviceExternalId);
      status.serverOk(item.server);
      await status.report();
    } catch (error) {
      if (error.code === SERVER_REMOVED || error.code === UPS_GONE) {
        // A device problem, not a server one: its server (if any) answered,
        // or is not configured at all. Nothing to tell the other servers'
        // status, and nothing to retry until the configuration changes.
        if (reported.get(deviceExternalId) !== error.message) {
          reported.set(deviceExternalId, error.message);
          log.warn(error.message);
        }
        return;
      }
      if (error.server) {
        status.serverFailed(error.server, error);
        await status.report();
      } else {
        log.error(`Poll of ${deviceExternalId} failed: ${error.message}`);
      }
      throw error;
    }
  };
}
