// -----------------------------------------------------------------------------
// Minimal NUT (upsd) TCP client.
//
// NUT servers speak a line-based protocol on TCP port 3493. This module only
// implements the read-only commands required by the integration: LIST UPS and
// LIST VAR. Each read (a whole server, or one UPS) opens one short-lived
// connection carrying all its requests, which avoids stale socket state after
// a NUT server restart without paying a handshake and a login per UPS.
// -----------------------------------------------------------------------------

import net from 'node:net';

export class NutProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NutProtocolError';
  }
}

export function tokenizeNutLine(line) {
  const tokens = [];
  let token = '';
  let quoted = false;
  let escaping = false;

  for (const character of line.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
      continue;
    }
    if (quoted && character === '\\') {
      escaping = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += character;
  }

  if (quoted || escaping) {
    throw new NutProtocolError(`Malformed quoted response from NUT: ${line}`);
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function quoteNutArgument(value) {
  const string = String(value);
  if (/[\r\n]/.test(string)) {
    throw new NutProtocolError('NUT command arguments cannot contain line breaks.');
  }
  return `"${string.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

class NutConnection {
  constructor(socket, timeout) {
    this.socket = socket;
    // Every request is bounded too, not only the TCP connection: an upsd that
    // accepts the connection and then stops answering (a hung driver, a
    // half-open socket) would otherwise freeze the poll forever.
    this.timeout = timeout;
    this.buffer = '';
    this.pending = null;

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.consume(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('end', () =>
      this.fail(new NutProtocolError('The NUT server closed the connection.')),
    );
  }

  static connect({ host, port, timeout }) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new NutProtocolError(`Connection to NUT server ${host}:${port} timed out.`));
      }, timeout);

      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(new NutConnection(socket, timeout));
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(
          new NutProtocolError(`Cannot connect to NUT server ${host}:${port}: ${error.message}`),
        );
      });
    });
  }

  async authenticate(username, password) {
    if (!username) {
      return;
    }
    await this.commandOk(`USERNAME ${quoteNutArgument(username)}`);
    await this.commandOk(`PASSWORD ${quoteNutArgument(password)}`);
  }

  async list(command) {
    const lines = await this.request(command, (line) => {
      const tokens = tokenizeNutLine(line);
      return tokens[0] === 'END' && tokens[1] === 'LIST';
    });
    if (!lines[0]?.startsWith('BEGIN LIST')) {
      throw new NutProtocolError(
        `Unexpected NUT list response for ${command}: ${lines[0] ?? 'empty'}`,
      );
    }
    return lines.slice(1, -1);
  }

  async commandOk(command) {
    const lines = await this.request(command, () => true);
    const [first] = tokenizeNutLine(lines[0] ?? '');
    if (first !== 'OK') {
      throw new NutProtocolError(
        `NUT command failed (${command.split(' ')[0]}): ${lines[0] ?? 'empty response'}`,
      );
    }
  }

  request(command, isComplete) {
    if (this.pending) {
      throw new NutProtocolError('A NUT request is already pending.');
    }
    return new Promise((resolve, reject) => {
      const timer = this.timeout
        ? setTimeout(() => {
            this.fail(
              new NutProtocolError(
                `The NUT server did not answer ${command.split(' ')[0]} within ${this.timeout} ms.`,
              ),
            );
            this.socket.destroy();
          }, this.timeout)
        : null;
      const settle = (callback) => (value) => {
        clearTimeout(timer);
        callback(value);
      };
      this.pending = {
        lines: [],
        resolve: settle(resolve),
        reject: settle(reject),
        isComplete,
      };
      this.socket.write(`${command}\n`, (error) => {
        if (error) {
          this.fail(error);
        }
      });
    });
  }

  consume(chunk) {
    // Called from the socket 'data' event: an exception thrown here is not
    // caught by anyone and kills the whole process. A malformed answer (an
    // unterminated quote from a buggy driver) must fail the pending request,
    // not the integration.
    try {
      this.consumeLines(chunk);
    } catch (error) {
      this.fail(error);
      this.socket.destroy();
    }
  }

  consumeLines(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line || !this.pending) {
        continue;
      }
      const { lines: received, resolve, reject, isComplete } = this.pending;
      received.push(line);

      if (line.startsWith('ERR ')) {
        this.pending = null;
        reject(new NutProtocolError(`NUT server error: ${line}`));
        continue;
      }
      if (isComplete(line, received)) {
        this.pending = null;
        resolve(received);
      }
    }
  }

  fail(error) {
    if (!this.pending) {
      return;
    }
    const { reject } = this.pending;
    this.pending = null;
    reject(error instanceof NutProtocolError ? error : new NutProtocolError(error.message));
  }

  close() {
    this.socket.end();
    this.socket.destroy();
  }
}

async function withNutConnection(config, work) {
  const connection = await NutConnection.connect(config);
  try {
    await connection.authenticate(config.username, config.password);
    return await work(connection);
  } finally {
    connection.close();
  }
}

async function readUpsList(connection) {
  const lines = await connection.list('LIST UPS');
  return lines.flatMap((line) => {
    const tokens = tokenizeNutLine(line);
    if (tokens[0] !== 'UPS' || tokens.length < 2) {
      return [];
    }
    return [{ name: tokens[1], description: tokens.slice(2).join(' ') || tokens[1] }];
  });
}

async function readUpsVariables(connection, upsName) {
  const lines = await connection.list(`LIST VAR ${quoteNutArgument(upsName)}`);
  const variables = new Map();
  for (const line of lines) {
    const tokens = tokenizeNutLine(line);
    if (tokens[0] === 'VAR' && tokens[1] === upsName && tokens.length >= 4) {
      variables.set(tokens[2], tokens.slice(3).join(' '));
    }
  }
  return variables;
}

export async function listUps(config) {
  return withNutConnection(config, readUpsList);
}

export async function listUpsVariables(config, upsName) {
  return withNutConnection(config, (connection) => readUpsVariables(connection, upsName));
}

/**
 * Read every UPS of a server. One connection carries every request: upsd
 * answers them in order, and a connection per UPS meant as many TCP handshakes
 * and USERNAME/PASSWORD exchanges.
 * @param {object} config - `{ host, port, username, password, timeout }`.
 * @returns {Promise<object[]>} `{ name, description, variables }` per UPS.
 */
export async function getNutSnapshot(config) {
  return withNutConnection(config, async (connection) => {
    const snapshots = [];
    for (const ups of await readUpsList(connection)) {
      snapshots.push({ ...ups, variables: await readUpsVariables(connection, ups.name) });
    }
    return snapshots;
  });
}

/**
 * Read one UPS of a server, on a single connection. LIST UPS comes first: it
 * tells a UPS removed from upsd apart from a server failure, and carries the
 * description the device name falls back on.
 * @param {object} config - `{ host, port, username, password, timeout }`.
 * @param {string} upsName - The UPS name on that server.
 * @returns {Promise<object|null>} `{ name, description, variables }`, or null
 *   when the server no longer exposes that UPS.
 */
export async function getNutUpsSnapshot(config, upsName) {
  return withNutConnection(config, async (connection) => {
    const ups = (await readUpsList(connection)).find(({ name }) => name === upsName);
    if (!ups) {
      return null;
    }
    return { ...ups, variables: await readUpsVariables(connection, ups.name) };
  });
}
