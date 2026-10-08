// -----------------------------------------------------------------------------
// Gladys external integration entry point for Network UPS Tools (NUT).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createConnectionStatus } from './src/connectionStatus.js';
import {
  buildDiscoveredDevices,
  discoverUpsesWithFailures,
  forgetDevice,
  forgetLastReads,
  readServers,
  resetRefreshSchedule,
  testNutConnection,
} from './src/devices/index.js';
import { createPollHandler, pollUps } from './src/poll.js';
import { registerSceneActions } from './src/scenes.js';
import { registerWidget } from './src/widget.js';

const gladys = new GladysIntegration();
// Null until a configuration with at least one server has been read: the
// handlers below say so instead of failing on `undefined`.
let config = null;
// One status for every server: a poll writing the status of its own server
// made it blink between two servers (see src/connectionStatus.js).
const status = createConnectionStatus(gladys, logger);

// A rejected promise nobody awaits (a handler of a future SDK, a timer) would
// end the process under Node's default policy, taking every UPS reading and
// the scene triggers down with it. Log it and keep running; real exceptions
// still crash, so a corrupted state is never silently carried on.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

const NOT_CONFIGURED = {
  en: 'No NUT server configured yet: fill in the host of the first server, then save.',
  fr: 'Aucun serveur NUT configuré : renseignez l’hôte du premier serveur, puis enregistrez.',
};

/**
 * Read every server, record each outcome in the connection status — which
 * names the servers that did not answer — and publish what was found. When no
 * server answered, the Discovery tab is left as it was.
 * @returns {Promise<object[]>} The UPS read.
 */
async function refreshDiscovery() {
  const results = await readServers(config);
  status.record(results);
  await status.report({ force: true });
  if (results.every(({ error }) => error)) {
    return [];
  }
  const { discovered } = await discoverUpsesWithFailures(config, results);
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config, discovered));
  return discovered;
}

/**
 * Normalize a raw configuration, keeping the previous one when it is refused,
 * and report a refusal for what it is: "cannot reach the NUT server" said
 * nothing useful to someone who had not typed a host yet.
 * @param {object} rawConfig - The configuration Gladys sent.
 * @returns {Promise<boolean>} Whether it was applied.
 */
async function applyConfig(rawConfig) {
  try {
    config = normalizeConfig(rawConfig);
    status.setServers(config.servers);
    return true;
  } catch (error) {
    logger.warn(`Configuration refused: ${error.message}`);
    const message = /at least one NUT server host/i.test(error.message)
      ? NOT_CONFIGURED
      : {
          en: `Invalid configuration: ${error.message}`,
          fr: `Configuration invalide : ${error.message}`,
        };
    await gladys.setConnectionStatus(false, message).catch(() => {});
    status.invalidate();
    return false;
  }
}

// The NUT servers' failures are in the connection status already: what lands
// here failed elsewhere (Gladys itself, most of the time).
function logFailure(context, error) {
  logger.error(`${context} failed: ${error.message}`);
}

gladys.onScanRequest(async () => {
  try {
    await refreshDiscovery();
  } catch (error) {
    logFailure('Scan', error);
    throw error;
  }
});

// Gladys polls every minute: each poll reads the UPS for the scene triggers,
// the readings are only written once per configured refresh interval, and the
// connection status only when a server's outcome changes.
gladys.onPoll(createPollHandler({ gladys, getConfig: () => config, status }));

gladys.onAction('test_connection', async () => {
  if (!config) {
    return NOT_CONFIGURED;
  }
  const results = await readServers(config);
  status.record(results);
  await status.report({ force: true });
  // Throws when no server answered: the screen shows the action in red.
  return testNutConnection(config, results);
});

// Gladys drops the states of a device that does not exist yet, while the
// publisher records them as published: read a UPS the moment it is added (or
// updated from the Discovery tab), with everything it reports.
async function readNewDevice(device) {
  forgetDevice(device.external_id);
  if (!config) {
    return;
  }
  try {
    await pollUps(gladys, config, device.external_id);
  } catch (error) {
    logger.warn(`First read of ${device.external_id} failed: ${error.message}`);
  }
}
gladys.onDeviceCreated(readNewDevice);
gladys.onDeviceUpdated(readNewDevice);

// Gladys >= 5.1: dashboard widget and scene action. The scene triggers are
// fired by the polls (src/poll.js).
registerWidget(gladys, () => config);
registerSceneActions(gladys, () => config);

gladys.onConfigUpdated(async (rawConfig) => {
  if (!(await applyConfig(rawConfig))) {
    return;
  }
  try {
    // The servers and the refresh interval may both have changed: every device
    // is due for a fresh read on its next poll.
    resetRefreshSchedule();
    // The widget shows the last read: one made against the old servers is not it.
    forgetLastReads();
    await refreshDiscovery();
  } catch (error) {
    logFailure('Discovery after a configuration change', error);
  }
});

gladys.on('connected', async () => {
  try {
    if (!(await applyConfig(await gladys.getConfig()))) {
      return;
    }
    await refreshDiscovery();
  } catch (error) {
    logFailure('Discovery on connection', error);
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
