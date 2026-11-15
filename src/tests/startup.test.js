import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { configuredPort, startLocalServer } from '../server/startup.mjs';

const isWindows = process.platform === 'win32';

function localServer(t, body = 'new-service') {
  const server = createServer((_req, res) => res.end(body));
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  return server;
}

async function listenRandom(server) {
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  const { port } = server.address();
  assert.notEqual(port, 4173, 'tests must never use the running game port');
  return port;
}

// Every process these tests can stop belongs to this fixture and binds an OS-assigned port.
async function occupiedPort(t, { ignoreTerm = false } = {}) {
  const child = spawn(process.execPath, ['--input-type=commonjs', '-e', `
    const server = require('node:http').createServer((_req, res) => res.end(String(process.pid)));
    process.on('SIGTERM', () => {
      process.send({ type: 'term' }, () => {
        if (!${JSON.stringify(ignoreTerm)}) server.close(() => process.exit(0));
      });
    });
    server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const messages = [];
  child.on('message', message => messages.push(message));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.race([exited, delay(3000, null, { ref: false }).then(() => { throw new Error('test child failed to exit'); })]);
  });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    exited.then(() => { throw new Error(`test listener exited before startup: ${stderr}`); }),
    delay(3000, null, { ref: false }).then(() => { throw new Error('test listener startup timed out'); }),
  ]);
  assert.equal(ready.type, 'ready');
  assert.notEqual(ready.port, 4173, 'tests must never use the running game port');
  return { child, port: ready.port, messages, exited };
}

async function responseAt(port) {
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  return response.text();
}

test('PORT uses the default only when absent or blank and honors the configured environment', t => {
  const original = process.env.PORT;
  t.after(() => { if (original === undefined) delete process.env.PORT; else process.env.PORT = original; });
  delete process.env.PORT;
  assert.equal(configuredPort(), 4173);
  for (const value of ['', '   ', '\t']) assert.equal(configuredPort(value), 4173);
  process.env.PORT = '5186';
  assert.equal(configuredPort(), 5186);
});

test('PORT accepts valid decimal integers, including the boundaries and surrounding whitespace', () => {
  for (const [value, expected] of [['1', 1], ['65535', 65535], ['5187', 5187], [' 5187 ', 5187]]) {
    assert.equal(configuredPort(value), expected);
  }
});

test('PORT rejects zero, out-of-range, fractional and non-decimal values before startup', () => {
  for (const value of ['0', '-1', '65536', '999999999999999999999', '4173.5', '1e3', '0x1000', 'Infinity', 'NaN', '4173foo', '+4173', '4_173']) {
    assert.throws(() => configuredPort(value), /PORT 必须是 1～65535 的整数/, value);
  }
});

test('an unused random port starts without a takeover and serves requests', { timeout: 10000 }, async t => {
  const reservation = localServer(t);
  const port = await listenRandom(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const server = localServer(t), logs = [];
  await startLocalServer(server, { port, log: line => logs.push(line) });
  assert.equal(server.address().port, port);
  assert.equal(await responseAt(port), 'new-service');
  assert.deepEqual(logs, []);
});

test('a second startup replaces its occupied port without disturbing another listener', { timeout: 15000 }, async t => {
  const old = await occupiedPort(t), other = await occupiedPort(t);
  const server = localServer(t), logs = [];
  assert.notEqual(old.port, other.port);
  await startLocalServer(server, { port: old.port, graceMs: 1500, log: line => logs.push(line) });
  const exit = await old.exited;
  if (!isWindows) {
    assert.deepEqual(exit, { code: 0, signal: null }, 'the old service should close gracefully');
    assert.ok(old.messages.some(message => message.type === 'term'));
  }
  assert.equal(await responseAt(old.port), 'new-service');
  assert.equal(await responseAt(other.port), String(other.child.pid));
  assert.equal(other.child.exitCode, null);
  assert.equal(other.child.signalCode, null);
  assert.equal(logs.length, 1, 'graceful shutdown must not escalate to force');
});

test('production startup refuses an occupied port without stopping its listener', { timeout: 10000 }, async t => {
  const old = await occupiedPort(t), replacement = localServer(t), logs = [];
  await assert.rejects(startLocalServer(replacement, { port: old.port, replaceExisting: false, log: line => logs.push(line) }), /生产服务不会自动停止其他进程/);
  assert.equal(await responseAt(old.port), String(old.child.pid));
  assert.equal(old.child.exitCode, null);
  assert.equal(old.child.signalCode, null);
  assert.deepEqual(old.messages.map(message => message.type), ['ready']);
  assert.equal(replacement.listening, false);
  assert.deepEqual(logs, []);
});

test('production startup still binds only to loopback on an available port', async t => {
  const server = localServer(t);
  await startLocalServer(server, { port: 0, replaceExisting: false });
  assert.equal(server.address().address, '127.0.0.1');
  assert.equal(await responseAt(server.address().port), 'new-service');
});

test('a listener ignoring SIGTERM is reclaimed after the grace period', { timeout: 15000, skip: isWindows && 'Windows terminates SIGTERM targets without a POSIX signal handler' }, async t => {
  const old = await occupiedPort(t, { ignoreTerm: true });
  const server = localServer(t), logs = [];
  await startLocalServer(server, { port: old.port, graceMs: 200, log: line => logs.push(line) });
  assert.deepEqual(await old.exited, { code: null, signal: 'SIGKILL' });
  assert.ok(old.messages.some(message => message.type === 'term'), 'try graceful shutdown before forcing exit');
  assert.equal(await responseAt(old.port), 'new-service');
  assert.equal(logs.length, 2, 'the forced shutdown is reported');
});

test('a listener owned by this process is refused instead of terminating the test runner', { timeout: 10000 }, async t => {
  const old = localServer(t, 'same-process');
  const port = await listenRandom(old);
  const replacement = localServer(t);
  await assert.rejects(startLocalServer(replacement, { port, log: () => {} }), /当前启动进程占用/);
  assert.equal(await responseAt(port), 'same-process');
  assert.equal(replacement.listening, false);
});
