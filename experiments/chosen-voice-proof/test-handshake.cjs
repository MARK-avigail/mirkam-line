const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { check } = require('./check-handshake.cjs');
const { runInNewContext } = require('node:vm');
const { readFileSync } = require('node:fs');
const env = { OPENAI_API_KEY: 'private-test-key', MIRKAM_LIVE_PROJECT_ID: 'private-test-project' };

function fake(emit) {
  const req = new EventEmitter();
  req.destroy = () => { req.destroyed = true; };
  req.end = () => queueMicrotask(() => emit(req));
  const calls = [];
  const request = (...args) => { calls.push(args); return req; };
  return { req, calls, request };
}

test('successful upgrade closes without writing an application frame', async () => {
  let closed = false;
  const f = fake(req => req.emit('upgrade', { statusCode: 101 }, { destroy() { closed = true; } }));
  const result = await check({ request: f.request, env });
  assert.deepEqual(result, { result: 'HTTP_UPGRADE_ACCEPTED', http_status: 101, session_start_sent: false });
  assert.equal(closed, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].headers.Authorization, 'Bearer private-test-key');
  assert.equal(f.calls[0][1].method, 'GET');
  assert.equal(JSON.stringify(f.calls).includes('session.start'), false);
});

for (const status of [301, 400, 401, 403, 429, 500, 503]) {
  test(`reports HTTP ${status} without retry, body leakage or redirects`, async () => {
    let discarded = false;
    const f = fake(req => req.emit('response', { statusCode: status,
      headers: { 'retry-after': '30', authorization: 'private-test-key', location: 'https://elsewhere.invalid' },
      destroy() { discarded = true; } }));
    const result = await check({ request: f.request, env });
    assert.equal(result.http_status, status);
    assert.equal(result.retry_after_seconds, 30);
    assert.equal(result.session_start_sent, false);
    assert.equal(f.calls.length, 1);
    assert.equal(discarded, true);
    assert.equal(JSON.stringify(result).includes('private'), false);
  });
}

test('missing configuration never opens network', async () => {
  const result = await check({ env: {}, request() { throw Error('must not connect'); } });
  assert.equal(result.result, 'CONFIGURATION_MISSING');
});

test('network errors expose only known codes', async () => {
  const f = fake(req => req.emit('error', { code: 'private-test-key', message: 'private-test-key' }));
  const result = await check({ request: f.request, env });
  assert.equal(result.code, 'UNCLASSIFIED');
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('timeout destroys the single request', async () => {
  const f = fake(() => {});
  const result = await check({ request: f.request, env, timeoutMs: 5 });
  assert.equal(result.result, 'NETWORK_TIMEOUT');
  assert.equal(f.req.destroyed, true);
  assert.equal(f.calls.length, 1);
});

test('stdin entry point runs without starting a session when configuration is missing', async () => {
  const logs = [];
  const childProcess = { env: {}, exitCode: 0 };
  runInNewContext(readFileSync(require.resolve('./check-handshake.cjs'), 'utf8'), {
    require, module: { id: '[stdin]', exports: {} }, process: childProcess,
    console: { log: value => logs.push(value) }, setTimeout, clearTimeout,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(childProcess.exitCode, 2);
  assert.match(logs.join(''), /VOICE_HANDSHAKE:/);
  assert.match(logs.join(''), /CONFIGURATION_MISSING/);
  assert.match(logs.join(''), /"session_start_sent":false/);
});
