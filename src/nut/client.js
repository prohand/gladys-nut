// -----------------------------------------------------------------------------
// Minimal NUT (upsd) TCP client.
//
// NUT servers speak a line-based protocol on TCP port 3493. This module only
// implements the read-only commands required by the integration: LIST UPS and
// LIST VAR. Each operation opens a short-lived connection, which avoids stale
// socket state after a NUT server restart.
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
  constructor(socket) {
    this.socket = socket;
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
        resolve(new NutConnection(socket));
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
      this.pending = { lines: [], resolve, reject, isComplete };
      this.socket.write(`${command}\n`, (error) => {
        if (error) {
          this.fail(error);
        }
      });
    });
  }

  consume(chunk) {
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

export async function listUps(config) {
  return withNutConnection(config, async (connection) => {
    const lines = await connection.list('LIST UPS');
    return lines.flatMap((line) => {
      const tokens = tokenizeNutLine(line);
      if (tokens[0] !== 'UPS' || tokens.length < 2) {
        return [];
      }
      return [{ name: tokens[1], description: tokens.slice(2).join(' ') || tokens[1] }];
    });
  });
}

export async function listUpsVariables(config, upsName) {
  return withNutConnection(config, async (connection) => {
    const lines = await connection.list(`LIST VAR ${quoteNutArgument(upsName)}`);
    const variables = new Map();
    for (const line of lines) {
      const tokens = tokenizeNutLine(line);
      if (tokens[0] === 'VAR' && tokens[1] === upsName && tokens.length >= 4) {
        variables.set(tokens[2], tokens.slice(3).join(' '));
      }
    }
    return variables;
  });
}

export async function getNutSnapshot(config) {
  const upses = await listUps(config);
  const snapshots = await Promise.all(
    upses.map(async (ups) => ({ ...ups, variables: await listUpsVariables(config, ups.name) })),
  );
  return snapshots;
}
