// -----------------------------------------------------------------------------
// Configuration normalization for the Network UPS Tools (NUT) integration.
// Values come from the manifest form and can be hot-reloaded by Gladys.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = Object.freeze({
  host: '',
  port: 3493,
  username: '',
  poll_frequency: 60,
  timeout: 5000,
});

function asFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeConfig(input = {}) {
  const host = String(input.host ?? DEFAULT_CONFIG.host).trim();
  const port = Math.round(asFiniteNumber(input.port, DEFAULT_CONFIG.port));
  const pollFrequency = Math.round(
    asFiniteNumber(input.poll_frequency, DEFAULT_CONFIG.poll_frequency),
  );
  const timeout = Math.round(asFiniteNumber(input.timeout, DEFAULT_CONFIG.timeout));
  const username = String(input.username ?? DEFAULT_CONFIG.username).trim();
  const password =
    input.password === undefined || input.password === null ? '' : String(input.password);

  if (!host) {
    throw new Error('A NUT server host is required.');
  }
  if (port < 1 || port > 65535) {
    throw new Error('The NUT server port must be between 1 and 65535.');
  }
  if (pollFrequency < 30 || pollFrequency > 3600) {
    throw new Error('The refresh interval must be between 30 and 3600 seconds.');
  }
  if (timeout < 1000 || timeout > 30000) {
    throw new Error('The NUT timeout must be between 1000 and 30000 milliseconds.');
  }
  if (username && !password) {
    throw new Error('A password is required when a NUT username is configured.');
  }

  return {
    host,
    port,
    username,
    password,
    poll_frequency: pollFrequency,
    timeout,
  };
}
