import test from 'node:test';
import assert from 'node:assert/strict';
import sdk from 'tencentcloud-sdk-nodejs-common';
import { createInvestigationModel } from '../server/model.mjs';
import { createYuanbaoSearch } from '../server/search.mjs';
import { retryAfterMs } from '../server/retry.mjs';

const env = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-test-key', MODEL_NAME: 'test-model' };
const searchEnv = { TENCENTCLOUD_SECRET_ID: 'private-id', TENCENTCLOUD_SECRET_KEY: 'private-key' };
const input = { task: '测试固定填值工具', schema: { nextLeads: [] }, data: { sources: [], round: 5 } };
const result = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit_investigation', arguments: '{}' } }] } }] }));
const options = { diagnostic() {}, sleep: async () => {}, random: () => 0 };
const source = { url: 'https://example.org/fact', title: '原始记录', passage: '一份可追溯的原始资料。' };
const searchResult = () => ({ Pages: [source], RequestId: 'request', Version: 'standard' });
const makeSearch = (request, extra = {}) => createYuanbaoSearch(searchEnv, { ...options, clientImpl: { request }, ...extra });

test('503 retries preserve exactly the same strict-tool request and stop at five attempts', async () => {
  const bodies = [], retries = [], waits = [], diagnostics = []; let closed = 0;
  const model = createInvestigationModel(env, { ...options, diagnostic: entry => diagnostics.push(entry), sleep: async ms => waits.push(ms), fetchImpl: async (_url, request) => {
    bodies.push(request.body);
    if (bodies.length === 5) return result();
    return new Response(new ReadableStream({ cancel() { closed++; } }), { status: 503 });
  } });
  assert.deepEqual(await model.complete(input, { retryAttempts: 5, onRetry: data => retries.push(data) }), { nextLeads: [] });
  assert.equal(bodies.length, 5); assert.equal(new Set(bodies).size, 1);
  assert.equal(closed, 4); assert.deepEqual(waits, [1000, 2000, 4000, 8000]);
  assert.deepEqual(retries.map(row => row.nextAttempt), [2, 3, 4, 5]);
  assert.ok(retries.every(row => row.httpStatus === 503 && row.code === 'MODEL_UNAVAILABLE'));
  assert.deepEqual(diagnostics.map(row => row.retryAttempt), [1, 2, 3, 4, 5]);
  assert.doesNotMatch(JSON.stringify({ retries, diagnostics }), /private|原始资料|测试固定/);
  assert.equal(JSON.parse(bodies[0]).tools[0].function.strict, true);
});

test('transient HTTP statuses retry; ordinary 4xx and authentication failures do not', async () => {
  for (const status of [400, 401, 403, 404, 422, 429, 500, 502, 503, 504]) {
    let attempts = 0;
    const model = createInvestigationModel(env, { ...options, fetchImpl: async () => { attempts++; return new Response('private-provider-body', { status }); } });
    await assert.rejects(model.complete(input, { retryAttempts: 3 }), error => error.httpStatus === status && error.retryable === [429, 500, 502, 503, 504].includes(status) && !error.message.includes('private'));
    assert.equal(attempts, [429, 500, 502, 503, 504].includes(status) ? 3 : 1, `HTTP ${status}`);
  }
});

test('default requests remain one attempt even when the provider returns 503', async () => {
  let attempts = 0;
  const model = createInvestigationModel(env, { ...options, fetchImpl: async () => { attempts++; return new Response('', { status: 503 }); } });
  await assert.rejects(model.complete(input), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(attempts, 1);
});

test('malformed tool output, model refusal and truncation are not transport retries', async () => {
  for (const body of [
    'private-malformed-response',
    JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
    JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { refusal: 'private-refusal' } }] }),
    JSON.stringify({ choices: [{ finish_reason: 'length', message: {} }] }),
    JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'submit_investigation', arguments: '{"extra":"private-field"}' } }] } }] }),
  ]) {
    let attempts = 0;
    const model = createInvestigationModel(env, { ...options, fetchImpl: async () => { attempts++; return new Response(body); } });
    await assert.rejects(model.complete(input, { retryAttempts: 5 }), error => ['MODEL_FORMAT', 'MODEL_REFUSED', 'MODEL_TRUNCATED'].includes(error.code));
    assert.equal(attempts, 1);
  }
});

test('network connection failures retry without exposing errors; certificate errors do not', async () => {
  for (const code of ['ECONNRESET', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED']) {
    let attempts = 0; const retries = [];
    const model = createInvestigationModel(env, { ...options, fetchImpl: async () => {
      attempts++; throw new TypeError('fetch failed private-url private-key', { cause: { code } });
    } });
    await assert.rejects(model.complete(input, { retryAttempts: 3, onRetry: entry => retries.push(entry) }), error => error.code === 'MODEL_UNAVAILABLE' && !error.message.includes('private'));
    assert.equal(attempts, code === 'CERT_HAS_EXPIRED' ? 1 : 3);
    assert.doesNotMatch(JSON.stringify(retries), /private/);
  }
});

test('Retry-After seconds and HTTP dates are honored without shortening the delay', async () => {
  const now = Date.parse('2026-10-24T10:00:00Z');
  for (const header of ['12', 'Sat, 24 Oct 2026 10:00:12 GMT']) {
    const waits = []; let attempts = 0;
    const model = createInvestigationModel(env, { ...options, now: () => now, sleep: async ms => waits.push(ms), fetchImpl: async () => ++attempts === 1 ? new Response('', { status: 429, headers: { 'Retry-After': header } }) : result() });
    assert.deepEqual(await model.complete(input, { retryAttempts: 5 }), { nextLeads: [] });
    assert.deepEqual(waits, [12000]);
  }
  assert.equal(retryAfterMs('not-a-date', now), 0);
  assert.equal(retryAfterMs('Sat, 24 Oct 2026 09:59:00 GMT', now), 0);
});

test('an excessive Retry-After fails instead of retrying earlier than instructed', async () => {
  let attempts = 0, waits = 0;
  const model = createInvestigationModel(env, { ...options, sleep: async () => waits++, fetchImpl: async () => { attempts++; return new Response('', { status: 429, headers: { 'Retry-After': '90000' } }); } });
  await assert.rejects(model.complete(input, { retryAttempts: 5 }), error => error.code === 'MODEL_LIMIT' && error.retryable === false);
  assert.equal(attempts, 1); assert.equal(waits, 0);
});

test('the parent deadline cancels a long Retry-After without issuing another call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let attempts = 0, retryStarted;
  const started = new Promise(resolve => { retryStarted = resolve; });
  const model = createInvestigationModel(env, { diagnostic() {}, random: () => 0, fetchImpl: async () => { attempts++; return new Response('', { status: 429, headers: { 'Retry-After': '600' } }); } });
  const rejected = assert.rejects(model.complete(input, { signal: controller.signal, retryAttempts: 5, onRetry: retryStarted }), { code: 'MODEL_TIMEOUT' });
  await started; controller.abort(new Error('private-parent-reason')); await rejected;
  t.mock.timers.tick(700000); assert.equal(attempts, 1);
});

test('each retry receives a new 60-second deadline and successful retries clear it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = []; let releaseSecond, secondStarted;
  const second = new Promise(resolve => { secondStarted = resolve; });
  const model = createInvestigationModel(env, { ...options, fetchImpl: (_url, { signal }) => {
    signals.push(signal);
    if (signals.length === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    secondStarted(); return new Promise(resolve => { releaseSecond = () => resolve(result()); });
  } });
  const pending = model.complete(input, { retryAttempts: 5 });
  t.mock.timers.tick(60000); await second;
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  t.mock.timers.tick(59999); assert.equal(signals[1].aborted, false);
  releaseSecond(); await pending;
  t.mock.timers.tick(60000); assert.equal(signals[1].aborted, false);
});

test('explicit cancellation during a request never retries', async () => {
  const controller = new AbortController(); let attempts = 0;
  const model = createInvestigationModel(env, { ...options, fetchImpl: (_url, { signal }) => {
    attempts++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const pending = assert.rejects(model.complete(input, { signal: controller.signal, retryAttempts: 5 }), error => error.code === 'MODEL_TIMEOUT' && error.retryable !== true);
  controller.abort(); await pending; assert.equal(attempts, 1);
});

test('search retries only explicit transient SDK/HTTP errors and never auth/account errors', async () => {
  for (const [failure, count, code] of [
    [{ httpCode: 503 }, 3, 'SEARCH_UNAVAILABLE'], [{ httpCode: 429 }, 3, 'SEARCH_LIMIT'],
    [{ code: 'InternalError' }, 3, 'SEARCH_UNAVAILABLE'], [{ code: 'RequestLimitExceeded' }, 3, 'SEARCH_LIMIT'],
    [new Error('request failed, reason: socket hang up at private-url'), 3, 'SEARCH_UNAVAILABLE'],
    [{ code: 'AuthFailure.SignatureFailure' }, 1, 'SEARCH_AUTH'], [{ httpCode: 401 }, 1, 'SEARCH_AUTH'],
    [{ code: 'UnauthorizedOperation' }, 1, 'SEARCH_AUTH'], [{ code: 'InvalidParameter.Query' }, 1, 'INVALID_QUERY'],
    [{ code: 'ResourceUnavailable.NotEnoughBalance' }, 1, 'SEARCH_UNAVAILABLE'],
    [{ code: 'LimitExceeded.Quota' }, 1, 'SEARCH_UNAVAILABLE'], [{ code: 'FailedOperation' }, 1, 'SEARCH_UNAVAILABLE'],
  ]) {
    let attempts = 0; const retries = [];
    const search = makeSearch(async () => { attempts++; throw failure; });
    await assert.rejects(search.retrieve('调查方向', { retryAttempts: 3, onRetry: row => retries.push(row) }), error => error.code === code && (error.retryable === true) === (count === 3));
    assert.equal(attempts, count, JSON.stringify(failure));
    assert.doesNotMatch(JSON.stringify(retries), /private|SignatureFailure/);
  }
});

test('search retries reuse the same query and return original source data', async () => {
  const queries = []; let attempts = 0;
  const search = makeSearch(async (_action, input) => { queries.push(input); if (++attempts < 3) throw { httpCode: 503 }; return searchResult(); });
  const found = await search.retrieve(' 调查方向 ', { retryAttempts: 3 });
  assert.deepEqual(queries, Array(3).fill({ Query: '调查方向' }));
  assert.equal(found.sources[0].summary, source.passage); assert.equal(found.sources[0].url, source.url);
});

test('search cancellation and malformed responses do not retry', async () => {
  const controller = new AbortController(); let attempts = 0;
  const search = makeSearch(async (_action, _data, { signal }) => {
    attempts++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const pending = assert.rejects(search.retrieve('调查方向', { signal: controller.signal, retryAttempts: 3 }), { code: 'SEARCH_TIMEOUT' });
  controller.abort(); await pending; assert.equal(attempts, 1);
  let malformed = 0;
  await assert.rejects(makeSearch(async () => { malformed++; return {}; }).retrieve('调查方向', { retryAttempts: 3 }), { code: 'INVALID_RESPONSE' });
  assert.equal(malformed, 1);
});

test('search requests keep the default of one attempt', async () => {
  let attempts = 0;
  await assert.rejects(makeSearch(async () => { attempts++; throw { httpCode: 503 }; }).retrieve('调查方向'), { code: 'SEARCH_UNAVAILABLE' });
  assert.equal(attempts, 1);
});

test('search timeout retries get fresh timers; already aborted searches never run', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = []; let secondStarted;
  const started = new Promise(resolve => { secondStarted = resolve; });
  const search = makeSearch(async (_action, _query, { signal }) => {
    signals.push(signal);
    if (signals.length === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    secondStarted(); return searchResult();
  });
  const pending = search.retrieve('调查方向', { retryAttempts: 3 });
  t.mock.timers.tick(20000); await started; await pending;
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  t.mock.timers.tick(20000); assert.equal(signals[1].aborted, false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(search.retrieve('调查方向', { signal: controller.signal, retryAttempts: 3 }), error => error.code === 'SEARCH_TIMEOUT' && error.retryable !== true);
  assert.equal(signals.length, 2);
});

test('SDK integration preserves Retry-After and closes non-200 bodies before retry', async t => {
  let attempts = 0, closed = 0; const waits = [];
  t.mock.method(sdk.CommonClient.prototype, 'request', function () {
    attempts++;
    return this.parseResponse(attempts === 1
      ? { status: 503, headers: new Headers({ 'Retry-After': '7' }), body: { destroy() { closed++; } } }
      : new Response(JSON.stringify({ Response: searchResult() }), { headers: { 'Content-Type': 'application/json' } }));
  });
  const search = createYuanbaoSearch(searchEnv, { ...options, sleep: async ms => waits.push(ms) });
  const found = await search.retrieve('调查方向', { retryAttempts: 3 });
  assert.equal(found.sources[0].url, source.url); assert.equal(attempts, 2); assert.equal(closed, 1); assert.deepEqual(waits, [7000]);
});
