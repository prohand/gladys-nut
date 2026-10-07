// -----------------------------------------------------------------------------
// Gladys external integration entry point for Network UPS Tools (NUT).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import {
  buildDiscoveredDevices,
  discoverUpsesWithFailures,
  forgetDevice,
  resetRefreshSchedule,
  testNutConnection,
} from './src/devices/index.js';
import { pollUps } from './src/poll.js';
import { registerSceneActions } from './src/scenes.js';
import { registerWidget } from './src/widget.js';

const gladys = new GladysIntegration();
// Null until a configuration with at least one server has been read: the
// handlers below say so instead of failing on `undefined`.
let config = null;

const NOT_CONFIGURED = {
  en: 'No NUT server configured yet: fill in the host of the first server, then save.',
  fr: 'Aucun serveur NUT configuré : renseignez l’hôte du premier serveur, puis enregistrez.',
};

async function refreshDiscovery() {
  const { discovered, failures } = await discoverUpsesWithFailures(config);
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config, discovered));
  await reportDiscovered(failures);
  return discovered;
}

/**
 * Connected — and, when one of several servers did not answer, say which: a
 * plain "connected" hid a second UPS host that was down.
 * @param {{server: {host: string, port: number}, error: Error}[]} failures - Servers that failed.
 * @returns {Promise<void>} Resolves once the status is stored.
 */
async function reportDiscovered(failures) {
  if (failures.length === 0) {
    await gladys.setConnectionStatus(true);
    return;
  }
  const names = failures.map(({ server }) => `${server.host}:${server.port}`).join(', ');
  await gladys.setConnectionStatus(true, {
    en: `Connected, but ${failures.length} NUT server(s) did not answer: ${names}.`,
    fr: `Connecté, mais ${failures.length} serveur(s) NUT n’ont pas répondu : ${names}.`,
  });
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
    return false;
  }
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
  } catch (error) {
    await reportUnavailable(error);
    throw error;
  }
});

gladys.onPoll(async (device) => {
  if (!config) {
    return;
  }
  try {
    // Gladys polls every minute: each poll reads the UPS for the scene
    // triggers, but the readings and the connection status are only written
    // once per configured refresh interval.
    const { refreshed } = await pollUps(gladys, config, device.external_id);
    if (refreshed) {
      await gladys.setConnectionStatus(true);
    }
  } catch (error) {
    await reportUnavailable(error);
    throw error;
  }
});

gladys.onAction('test_connection', async () => {
  if (!config) {
    return NOT_CONFIGURED;
  }
  try {
    const message = await testNutConnection(config);
    await gladys.setConnectionStatus(true);
    return message;
  } catch (error) {
    await reportUnavailable(error);
    throw error;
  }
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
    await refreshDiscovery();
  } catch (error) {
    await reportUnavailable(error);
  }
});

gladys.on('connected', async () => {
  try {
    if (!(await applyConfig(await gladys.getConfig()))) {
      return;
    }
    await refreshDiscovery();
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
