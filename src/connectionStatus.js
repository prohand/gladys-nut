// -----------------------------------------------------------------------------
// Connection status shown in the Configuration screen, aggregated over every
// configured NUT server.
//
// Each UPS is polled on its own, once a minute. When every poll wrote the
// status for its own server, two servers with one of them down made the badge
// blink: the healthy poll reset it to "connected" without a word, the other one
// to "cannot reach" a few seconds later, and each failed poll logged two error
// lines. The status is therefore built from the last outcome of EVERY server
// and only sent when it changes; a server failure is logged when it starts or
// changes, not on every poll.
// -----------------------------------------------------------------------------

/**
 * @param {{host: string, port: number}} server - A configured server.
 * @returns {string} Its `host:port` label, also the key of its outcome.
 */
export function serverLabel(server) {
  return `${server.host}:${server.port}`;
}

/**
 * The status the Configuration screen should show.
 * @param {number} serverCount - How many servers are configured.
 * @param {Map<string, string>} failures - Failing server label -> last error message.
 * @returns {{connected: boolean, message?: object}} The status.
 */
export function aggregateStatus(serverCount, failures) {
  if (failures.size === 0) {
    return { connected: true };
  }
  const details = [...failures].map(([label, message]) => `${label} (${message})`).join('; ');
  if (failures.size < serverCount) {
    // Partly connected: the UPS of the other servers keep being read.
    return {
      connected: true,
      message: {
        en: `Connected, but ${failures.size} of ${serverCount} NUT servers do not answer: ${details}.`,
        fr: `Connecté, mais ${failures.size} serveur(s) NUT sur ${serverCount} ne répondent pas : ${details}.`,
      },
    };
  }
  return {
    connected: false,
    message: {
      en: `Cannot reach the NUT server(s): ${details}.`,
      fr: `Impossible de joindre le(s) serveur(s) NUT : ${details}.`,
    },
  };
}

/**
 * Track the outcome of each server and keep the Gladys connection status in
 * line with all of them.
 * @param {object} gladys - The SDK instance (setConnectionStatus).
 * @param {object} logger - A logger (error, info).
 * @returns {object} The tracker.
 */
export function createConnectionStatus(gladys, logger) {
  let servers = [];
  const failures = new Map();
  let lastSent = null;

  return {
    /**
     * Start over with a new server list: outcomes of removed servers go away.
     * @param {object[]} configured - The configured servers.
     */
    setServers(configured) {
      servers = configured;
      const labels = new Set(configured.map(serverLabel));
      for (const label of failures.keys()) {
        if (!labels.has(label)) {
          failures.delete(label);
        }
      }
    },

    /** @param {object} server - A server that just answered. */
    serverOk(server) {
      const label = serverLabel(server);
      if (failures.delete(label)) {
        logger.info(`NUT server ${label} answers again.`);
      }
    },

    /**
     * @param {object} server - A server that just failed.
     * @param {Error} error - Why.
     */
    serverFailed(server, error) {
      const label = serverLabel(server);
      if (failures.get(label) !== error.message) {
        logger.error(`NUT server ${label} is unavailable: ${error.message}`);
      }
      failures.set(label, error.message);
    },

    /**
     * Record a read of every server (`readServers`).
     * @param {{server: object, error: Error|null}[]} results - One outcome per server.
     */
    record(results) {
      for (const { server, error } of results) {
        if (error) {
          this.serverFailed(server, error);
        } else {
          this.serverOk(server);
        }
      }
    },

    /** @returns {{connected: boolean, message?: object}} The current status. */
    current() {
      return aggregateStatus(servers.length, failures);
    },

    /**
     * Send the status when it differs from the last one sent.
     * @param {{force?: boolean}} [options] - `force` sends it anyway.
     * @returns {Promise<void>} Resolves once sent (errors are swallowed).
     */
    async report({ force = false } = {}) {
      const status = aggregateStatus(servers.length, failures);
      const signature = JSON.stringify(status);
      if (!force && signature === lastSent) {
        return;
      }
      lastSent = signature;
      try {
        await gladys.setConnectionStatus(status.connected, status.message);
      } catch {
        // Gladys unreachable: send it again next time.
        lastSent = null;
      }
    },

    /** Someone else wrote the status: the next report must be sent. */
    invalidate() {
      lastSent = null;
    },
  };
}
