// -----------------------------------------------------------------------------
// Configuration normalization for the Network UPS Tools (NUT) integration.
// The manifest exposes five optional server slots; the first one is required.
// -----------------------------------------------------------------------------

export const SERVER_SLOT_COUNT = 5;

export const DEFAULT_CONFIG = Object.freeze({
  poll_frequency: 60,
  timeout: 5000,
});

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

  const pollFrequency = Math.round(
    asFiniteNumber(input.poll_frequency, DEFAULT_CONFIG.poll_frequency),
  );
  const timeout = Math.round(asFiniteNumber(input.timeout, DEFAULT_CONFIG.timeout));
  if (pollFrequency < 30 || pollFrequency > 3600) {
    throw new Error('The refresh interval must be between 30 and 3600 seconds.');
  }
  if (timeout < 1000 || timeout > 30000) {
    throw new Error('The NUT timeout must be between 1000 and 30000 milliseconds.');
  }

  return {
    servers,
    poll_frequency: pollFrequency,
    timeout,
  };
}
