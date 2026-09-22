// -----------------------------------------------------------------------------
// Handling of one core poll (once a minute per UPS device).
//
// Every poll reads the UPS so the scene triggers see a power cut within a
// minute; the readings, which fill the Gladys history, are only written once
// per configured interval.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isRefreshDue, publishUpsReadings, readUps } from './devices/ups.js';
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
