// -----------------------------------------------------------------------------
// Configuration normalization for the Network UPS Tools (NUT) integration.
// The manifest exposes five optional server slots; the first one is required.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';

export const SERVER_SLOT_COUNT = 5;

// Every published state is one row in the Gladys `t_device_feature_state`
// history table, and a UPS exposes up to a dozen features. A one-minute
// interval alone writes ~17 000 rows per day and per UPS, which bloats the
// Gladys database for measurements that barely move. The floor is therefore
// one minute — the fastest tick that stays reasonable — and the default is
// five minutes, which keeps a UPS under ~3 500 rows per day before the
// unchanged-value filter of src/devices/ups.js removes most of them.
export const MIN_POLL_FREQUENCY = 60;
export const MAX_POLL_FREQUENCY = 86400;

export const DEFAULT_CONFIG = Object.freeze({
  poll_frequency: 300,
  timeout: 5000,
});

/**
 * Bring a configured refresh interval back inside the supported range.
 * The interval is clamped rather than rejected: installations configured
 * before the floor was raised still hold a shorter value, and refusing the
 * whole configuration would leave them without any UPS until the user edits
 * the form.
 * @param {number} value - The configured interval, in seconds.
 * @returns {number} An interval between MIN_POLL_FREQUENCY and MAX_POLL_FREQUENCY.
 */
function clampPollFrequency(value) {
  if (value < MIN_POLL_FREQUENCY) {
    logger.warn(
      `A refresh interval of ${value}s fills the Gladys history too fast: using ${MIN_POLL_FREQUENCY}s instead.`,
    );
    return MIN_POLL_FREQUENCY;
  }
  if (value > MAX_POLL_FREQUENCY) {
    logger.warn(
      `A refresh interval of ${value}s is longer than supported: using ${MAX_POLL_FREQUENCY}s instead.`,
    );
    return MAX_POLL_FREQUENCY;
  }
  return value;
}

function asFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function trimString(value) {
  return String(value ?? '').trim();
}

function readServerSlot(input, index) {
  const prefix = `server_${index}_`;
  const legacy = index === 1;
  const host = trimString(input[`${prefix}host`] ?? (legacy ? input.host : ''));
  if (!host) {
    return null;
  }

  const port = Math.round(
    asFiniteNumber(input[`${prefix}port`] ?? (legacy ? input.port : undefined), 3493),
  );
  const username = trimString(input[`${prefix}username`] ?? (legacy ? input.username : ''));
  const passwordValue = input[`${prefix}password`] ?? (legacy ? input.password : '');
  const password =
    passwordValue === undefined || passwordValue === null ? '' : String(passwordValue);

  if (port < 1 || port > 65535) {
    throw new Error(`The NUT server ${index} port must be between 1 and 65535.`);
  }
  if (username && !password) {
    throw new Error(
      `A password is required for NUT server ${index} when a username is configured.`,
    );
  }

  return {
    id: `server-${index}`,
    host,
    port,
    username,
    password,
  };
}

export function normalizeConfig(input = {}) {
  const servers = Array.from({ length: SERVER_SLOT_COUNT }, (_, offset) =>
    readServerSlot(input, offset + 1),
  ).filter(Boolean);
  const identities = new Set();
  for (const server of servers) {
    const identity = `${server.host.toLowerCase()}:${server.port}`;
    if (identities.has(identity)) {
      throw new Error(`The NUT server ${server.host}:${server.port} is configured more than once.`);
    }
    identities.add(identity);
  }

  if (servers.length === 0) {
    throw new Error('At least one NUT server host is required.');
  }

  const pollFrequency = clampPollFrequency(
    Math.round(asFiniteNumber(input.poll_frequency, DEFAULT_CONFIG.poll_frequency)),
  );
  const timeout = Math.round(asFiniteNumber(input.timeout, DEFAULT_CONFIG.timeout));
  if (timeout < 1000 || timeout > 30000) {
    throw new Error('The NUT timeout must be between 1000 and 30000 milliseconds.');
  }

  return {
    servers,
    poll_frequency: pollFrequency,
    timeout,
  };
}
