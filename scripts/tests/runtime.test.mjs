import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runArgs = ['--production', '--no-local-data'];
const env = { ...process.env, PORT: '' };

async function vacantPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

function launch(script, args, options = {}) {
  const child = spawn(process.execPath, [join(root, script), ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], ...options });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, output: () => output };
}

test('server readiness comes from its own listener and production headers match static hosting', { timeout: 15000 }, async t => {
  const port = await vacantPort();
  const { child } = launch('server/index.mjs', [...runArgs, '--port', String(port)]);
  t.after(() => stop(child));
  const [message] = await once(child, 'message');
  assert.deepEqual(message, { type: 'travel-camera-ready', port });
  const response = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(response.status, 200);
  const rules = readFileSync(join(root, 'public', '_headers'), 'utf8').split(/\r?\n/);
  for (const line of rules) {
    const match = /^ {2}([^:]+): (.+)$/.exec(line);
    if (match) assert.equal(response.headers.get(match[1]), match[2]);
  }
  const denied = await new Promise((resolveStatus, reject) => {
    get(`http://127.0.0.1:${port}/api/local-timeline`, { headers: { Host: 'attacker.invalid' } }, response => {
      response.resume();
      resolveStatus(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(denied, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/local-timeline`)).status, 404);
  for (const retired of ['/api/map-status', '/api/map-glyphs/fonts/0-255.pbf', '/maps/world-z5.pmtiles']) {
    assert.equal((await fetch(`http://127.0.0.1:${port}${retired}`)).status, 404);
  }
});

test('launcher never opens a browser for another service occupying its port', { timeout: 30000 }, async t => {
  const other = createServer((_request, response) => response.writeHead(200).end('Different application'));
  other.listen(0, '127.0.0.1');
  await once(other, 'listening');
  t.after(() => new Promise(resolve => other.close(resolve)));
  const port = other.address().port;
  const { child, output } = launch('scripts/launch-local.mjs', ['--no-update', '--no-install', '--no-local-data', '--port', String(port)]);
  t.after(() => stop(child));
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0);
  assert.match(output(), /포트를 사용할 수 없습니다/);
  assert.doesNotMatch(output(), /브라우저 열기를 요청했습니다/);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'Different application');
});
