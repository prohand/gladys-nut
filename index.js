// -----------------------------------------------------------------------------
// Gladys external integration entry point for Network UPS Tools (NUT).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import {
  buildDiscoveredDevices,
  discoverUpses,
  publishUpsStates,
  resetRefreshSchedule,
  testNutConnection,
} from './src/devices/index.js';

const gladys = new GladysIntegration();
let config;

async function refreshDiscovery() {
  const snapshots = await discoverUpses(config);
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config, snapshots));
  return snapshots;
}

async function reportUnavailable(error) {
  logger.error('NUT connection failed', error);
  await gladys
    .setConnectionStatus(false, {
      en: `Cannot reach the NUT server: ${error.message}`,
      fr: `Impossible de joindre le serveur NUT : ${error.message}`,
    })
    .catch(() => {});
}

gladys.onScanRequest(async () => {
  try {
    await refreshDiscovery();
    await gladys.setConnectionStatus(true);
  } catch (error) {
    await reportUnavailable(error);
    throw error;
  }
});

gladys.onPoll(async (device) => {
  try {
    // Gladys polls at most every minute; publishUpsStates returns null when
    // the poll falls inside the configured refresh interval and no NUT server
    // was queried, leaving the connection status untouched.
    const refreshed = await publishUpsStates(gladys, config, device.external_id);
    if (refreshed) {
      await gladys.setConnectionStatus(true);
    }
  } catch (error) {
    await reportUnavailable(error);
    throw error;
  }
});

gladys.onAction('test_connection', async () => {
  try {
    const message = await testNutConnection(config);
    await gladys.setConnectionStatus(true);
    return message;
  } catch (error) {
    await reportUnavailable(error);
    throw error;
  }
});

gladys.onConfigUpdated(async (rawConfig) => {
  try {
    config = normalizeConfig(rawConfig);
    // The servers and the refresh interval may both have changed: every device
    // is due for a fresh read on its next poll.
    resetRefreshSchedule();
    await refreshDiscovery();
    await gladys.setConnectionStatus(true);
  } catch (error) {
    await reportUnavailable(error);
  }
});

gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await refreshDiscovery();
    await gladys.setConnectionStatus(true);
  } catch (error) {
    await reportUnavailable(error);
  }
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

logger.info('Starting Network UPS Tools integration...');
gladys.connect().catch((error) => {
  logger.error('Initial connection to Gladys failed', error);
  process.exit(1);
});
