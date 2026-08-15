import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { getNutSnapshot, listUps, NutProtocolError, tokenizeNutLine } from '../src/nut/client.js';

let server;
let port;
const commands = [];

before(async () => {
  server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        commands.push(line);
        if (line.startsWith('USERNAME ')) {
          socket.write('OK\n');
        } else if (line.startsWith('PASSWORD ')) {
          socket.write('OK\n');
        } else if (line === 'LIST UPS') {
          socket.write(
            'BEGIN LIST UPS\nUPS ups-a "Server room"\nUPS ups-b "Network rack"\nEND LIST UPS\n',
          );
        } else if (line === 'LIST VAR "ups-a"') {
          socket.write(
            'BEGIN LIST VAR ups-a\nVAR ups-a ups.mfr "APC"\nVAR ups-a ups.model "Smart-UPS"\nVAR ups-a battery.charge "98"\nVAR ups-a ups.status "OL"\nEND LIST VAR ups-a\n',
          );
        } else if (line === 'LIST VAR "ups-b"') {
          socket.write(
            'BEGIN LIST VAR ups-b\nVAR ups-b ups.mfr "Eaton"\nVAR ups-b battery.runtime "420"\nEND LIST VAR ups-b\n',
          );
        } else {
          socket.write('ERR UNKNOWN-COMMAND\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function testConfig(overrides = {}) {
  return {
    host: '127.0.0.1',
    port,
    username: '',
    password: '',
    timeout: 1000,
    ...overrides,
  };
}

test('tokenizes quoted NUT values and unescapes characters', () => {
  assert.deepEqual(tokenizeNutLine('VAR ups-a ups.model "Smart \\"UPS\\""'), [
    'VAR',
    'ups-a',
    'ups.model',
    'Smart "UPS"',
  ]);
  assert.throws(() => tokenizeNutLine('VAR ups-a value "unterminated'), NutProtocolError);
});

test('discovers all UPS devices from LIST UPS', async () => {
  const upses = await listUps(testConfig());
  assert.deepEqual(upses, [
    { name: 'ups-a', description: 'Server room' },
    { name: 'ups-b', description: 'Network rack' },
  ]);
});

test('reads variables for every discovered UPS and authenticates when configured', async () => {
  commands.length = 0;
  const snapshots = await getNutSnapshot(testConfig({ username: 'gladys', password: 'secret' }));

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].variables.get('battery.charge'), '98');
  assert.equal(snapshots[0].variables.get('ups.status'), 'OL');
  assert.equal(snapshots[1].variables.get('battery.runtime'), '420');
  assert.ok(commands.includes('USERNAME "gladys"'));
  assert.ok(commands.includes('PASSWORD "secret"'));
  assert.ok(commands.includes('LIST VAR "ups-a"'));
  assert.ok(commands.includes('LIST VAR "ups-b"'));
});
