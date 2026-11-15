import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvestigationModel } from '../server/model.mjs';

const env = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-test-key', MODEL_NAME: 'test-model' };
const input = { task: '补齐末轮方向', schema: { nextLeads: [] }, data: { sources: [], round: 5 } };
const toolMessage = () => ({ tool_calls: [{ type: 'function', function: { name: 'submit_investigation', arguments: '{}' } }] });
const result = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: toolMessage() }] }));
const timeout = error => error.code === 'MODEL_TIMEOUT' && error.status === 504;

test('each model call retains its 60-second deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const diagnostics = []; let signal;
  const model = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const rejected = assert.rejects(model.complete(input), timeout);
  t.mock.timers.tick(59999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(diagnostics[0].timeoutMs, 60000);
  assert.equal(diagnostics[0].code, 'MODEL_TIMEOUT');
});

test('successful calls clear their deadline and record safe elapsed timings', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, release;
  const diagnostics = [];
  const model = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { release = () => resolve(result()); });
  } });
  const pending = model.complete(input);
  t.mock.timers.tick(59999); assert.equal(signal.aborted, false);
  release(); assert.deepEqual(await pending, { nextLeads: [] });
  t.mock.timers.tick(90000); assert.equal(signal.aborted, false, 'completed requests must not keep a deadline timer');
  assert.equal(diagnostics[0].timeoutMs, 60000);
  assert.ok(diagnostics[0].headersMs >= 0);
  assert.ok(diagnostics[0].bodyMs >= diagnostics[0].headersMs);
  assert.ok(diagnostics[0].elapsedMs >= diagnostics[0].bodyMs);
});

test('already cancelled model requests never reach the provider', async () => {
  let requests = 0;
  const model = createInvestigationModel(env, { diagnostic() {}, fetchImpl: async () => { requests++; return result(); } });
  const controller = new AbortController(); controller.abort(new Error('private-cancel-reason'));
  await assert.rejects(model.complete(input, { signal: controller.signal }), timeout);
  assert.equal(requests, 0);
});

test('the parent deadline interrupts the model call without leaking its reason', async () => {
  const controller = new AbortController(), diagnostics = [];
  const model = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const rejected = assert.rejects(model.complete(input, { signal: controller.signal }), error => timeout(error) && !error.message.includes('private'));
  controller.abort(new Error('private-parent-reason')); await rejected;
  assert.equal(diagnostics[0].code, 'MODEL_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|publications|claim/);
});

test('deadline expiration while reading a malformed body is a timeout, not a format-repair request', async () => {
  const controller = new AbortController();
  let finishBody, reading;
  const startedReading = new Promise(resolve => { reading = resolve; });
  const model = createInvestigationModel(env, { diagnostic() {}, fetchImpl: async () => ({
    ok: true,
    text: () => { reading(); return new Promise(resolve => { finishBody = resolve; }); },
  }) });
  const rejected = assert.rejects(model.complete(input, { signal: controller.signal }), timeout);
  await startedReading; controller.abort(); finishBody('private-invalid-body'); await rejected;
});

test('a late HTTP error after cancellation keeps the timeout classification', async () => {
  const controller = new AbortController();
  const model = createInvestigationModel(env, { diagnostic() {}, fetchImpl: async () => {
    controller.abort(); return new Response('private-limit-body', { status: 429 });
  } });
  await assert.rejects(model.complete(input, { signal: controller.signal }), timeout);
});

test('reasoning usage diagnostics include only nonnegative safe integer counts', async () => {
  for (const count of [0, 700, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'private-token-count', { private: 'reasoning' }]) {
    const diagnostics = [];
    const model = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: async () => new Response(JSON.stringify({
      usage: { prompt_tokens: 8000, completion_tokens: 1200, completion_tokens_details: { reasoning_tokens: count, private_reasoning: 'private-thinking-body' } },
      choices: [{ finish_reason: 'tool_calls', message: { ...toolMessage(), reasoning_content: 'private-thinking-body' } }],
    })) });
    assert.deepEqual(await model.complete(input), { nextLeads: [] });
    if (Number.isSafeInteger(count) && count >= 0) assert.equal(diagnostics[0].reasoningTokens, count);
    else assert.equal(Object.hasOwn(diagnostics[0], 'reasoningTokens'), false);
    assert.equal(diagnostics[0].inputTokens, 8000); assert.equal(diagnostics[0].outputTokens, 1200);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private|reasoning_content|completion_tokens_details/);
  }
});
