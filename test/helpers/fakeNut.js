// -----------------------------------------------------------------------------
// Minimal in-memory NUT upsd server, for tests that go through the TCP client.
//
// `upses` maps a UPS name to a Map of its variables; tests mutate it between
// two reads to simulate a power cut. Every received command is recorded.
// -----------------------------------------------------------------------------

import net from 'node:net';

function quote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export async function startFakeNut(upses) {
  const commands = [];
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        commands.push(line);
        const listVar = /^LIST VAR "(.+)"$/.exec(line);
        if (line === 'LIST UPS') {
          const rows = [...upses.keys()].map((name) => `UPS ${name} ${quote(name)}\n`).join('');
          socket.write(`BEGIN LIST UPS\n${rows}END LIST UPS\n`);
        } else if (listVar && upses.has(listVar[1])) {
          const name = listVar[1];
          const rows = [...upses.get(name)]
            .map(([variable, value]) => `VAR ${name} ${variable} ${quote(value)}\n`)
            .join('');
          socket.write(`BEGIN LIST VAR ${name}\n${rows}END LIST VAR ${name}\n`);
        } else {
          socket.write('ERR UNKNOWN-UPS\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    commands,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
