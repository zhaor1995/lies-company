import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { createAppServer } from '../server/main.mjs';
import { createGame } from '../dist/engine.js';
import { buildCaseReport } from '../dist/case-report.js';
import { getCaseEnding } from '../dist/investigation-contract.js';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const uuidHelper = appSource.match(/^function newUuid\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(uuidHelper, 'test the UUID helper used by browser requests and ownership tokens');
const browserUuid = crypto => runInNewContext(`${uuidHelper}\nnewUuid`, { crypto });

test('browser UUIDs prefer the native cryptographic generator when available', () => {
  const expected = randomUUID(), crypto = {
    randomUUID() { assert.equal(this, crypto); return expected; },
    getRandomValues() { assert.fail('the native UUID path should not use its fallback'); },
  };
  assert.equal(browserUuid(crypto)(), expected);
});

test('HTTP browser UUID fallback retains v4 format and cryptographic uniqueness', () => {
  let calls = 0;
  const createUuid = browserUuid({ getRandomValues(bytes) { calls++; return webcrypto.getRandomValues(bytes); } });
  const ids = Array.from({ length: 1024 }, () => createUuid());
  assert.equal(calls, ids.length); assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(browserUuid({ getRandomValues: bytes => bytes.fill(0xff) })(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

function completedReport(elapsed = 420, evidence = true) {
  const game = createGame({ researchMode: 'live' });
  game.phase = 'won'; game.time = elapsed;
  for (const region of game.regions) { region.blue = 99; region.exposed = 1; region.red = 0; region.seeded = true; }
  game.researchResults = evidence ? [{ time: 20, roundId: 'round-1', query: '核对原始出处', promotedId: 'material-1', selectedId: 'material-1', publishedAt: 30,
    fetchedAt: '2026-10-23T03:30:00Z', assessment: { status: 'insufficient', summary: '资料未能支持这个绝对表述。' },
    materials: [{ id: 'material-1', title: '原始调查记录', focus: 'persuasion', effectId: 'authority', finding: '资料只记录了有限条件。',
      sources: [{ title: '研究原文', organization: '记录机构', url: 'https://example.org/source-1', date: '2025-01-14' }] }] }] : [];
  game.log = [{ type: 'start', time: 0, title: '侦探出发', detail: '' }, { type: 'win', time: elapsed, title: '夺回世界', detail: '调查完成' }];
  return buildCaseReport(game);
}
const submission = (elapsed = 420) => ({ runId: randomUUID(), ownerToken: randomUUID(), name: '无名侦探', report: completedReport(elapsed) });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lie-company-leaderboard-')), path = join(dir, 'records', 'leaderboard.json'), servers = [];
  t.after(async () => {
    for (const server of servers) { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
    await rm(dir, { recursive: true, force: true });
  });
  async function start() {
    const server = createAppServer({ leaderboardPath: path, configured: false, now: () => Date.parse('2026-10-23T03:30:00Z') });
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route = '', method = 'GET', body, extra = {}) {
      const response = await fetch(`${base}/api/leaderboard${route}`, { method, headers: { 'x-lie-company': 'research', origin: base, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra.headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
      return { status: response.status, ...await response.json() };
    }
    return { request, server };
  }
  return { ...await start(), start, path };
}

test('leaderboard stores a real case report and exposes public metadata without owner tokens', async t => {
  const { request, path } = await fixture(t), input = submission();
  assert.deepEqual((await request()).result, { entries: [], current: null, total: 0 });
  const added = await request('', 'POST', { ...input, name: '  林侦探  ' });
  assert.equal(added.status, 200); assert.equal(added.result.current.name, '林侦探'); assert.equal(added.result.current.rank, 1);
  assert.equal(added.result.current.elapsed, 420); assert.equal(added.result.current.claim, input.report.claim);
  assert.equal((await request(`?runId=${input.runId}`)).result.current.id, input.runId);
  const detail = await request(`/${input.runId}`);
  assert.equal(detail.result.report.steps[0].publicationState, '已公布');
  assert.equal(detail.result.report.steps[0].effectLabel, input.report.steps[0].effectLabel);
  assert.deepEqual(detail.result.report.sources, input.report.sources);
  assert.deepEqual(detail.result.report.style, input.report.style);
  assert.equal(detail.result.report.stats.elapsed, input.report.stats.elapsed);
  assert.doesNotMatch(JSON.stringify(detail), /ownerToken|ownerHash/);
  const stored = await readFile(path, 'utf8'); assert.ok(!stored.includes(input.ownerToken));
  assert.match(JSON.parse(stored).entries[0].ownerHash, /^[a-f0-9]{64}$/);
  const zero = submission(); zero.report = completedReport(420, false);
  assert.equal((await request('', 'POST', zero)).status, 200, 'a victory report with no evidence remains readable');
});

function reviewedReport(status) {
  const result = completedReport(), step = result.steps[0];
  result.finalVerdict = { status, confidence: status === 'refuted' ? 'medium' : 'low', summary: '对已公布材料完成了整体核查。', rationale: '区分原始记录与结论能覆盖的范围。',
    unresolved: status === 'refuted' ? ['尚未逐一核对其他版本，不影响原观点所指版本的判断。'] : ['尚未排除其他解释。'], reviewedPublications: [{ roundId: step.roundId, materialId: step.materialId }],
    chain: [{ roundId: step.roundId, question: step.question, finding: step.finding, sourceUrls: [step.sourceUrl], strength: 'limited', relevance: 'direct', gap: status === 'refuted' ? '材料仅覆盖原观点所指的版本。' : '还需对照数据。' }] };
  result.ending = getCaseEnding(result.outcome, result.finalVerdict, result.claim); result.title = result.ending.title;
  return result;
}

test('leaderboard preserves both endings and reasonable refutations with follow-up questions across reloads', async t => {
  const { request, server, start } = await fixture(t), saved = [];
  for (const status of ['refuted', 'supported', 'mixed', 'insufficient']) {
    const input = submission(); input.report = reviewedReport(status);
    assert.equal((await request('', 'POST', input)).status, 200);
    const report = (await request(`/${input.runId}`)).result.report;
    assert.deepEqual(report.ending, input.report.ending); assert.deepEqual(report.finalVerdict, input.report.finalVerdict);
    assert.equal(report.ending.id, status === 'refuted' ? 'truth' : 'new-company');
    assert.equal(report.verdict.status, status); assert.equal(report.title, input.report.ending.title);
    assert.equal(report.steps[0].roundId, 'round-1'); assert.equal(report.steps[0].materialId, 'material-1');
    saved.push(input);
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const reopened = await start();
  for (const input of saved) {
    const report = (await reopened.request(`/${input.runId}`)).result.report;
    assert.deepEqual(report.finalVerdict, input.report.finalVerdict);
    assert.deepEqual(report.ending, input.report.ending);
  }
});

test('leaderboard does not accept invented review links or a truth ending attached to an insufficient review', async t => {
  const { request } = await fixture(t);
  for (const change of [
    report => { report.ending.id = 'new-company'; }, report => { report.finalVerdict.chain[0].sourceUrls = ['https://foreign.example/source']; },
    report => { report.finalVerdict.reviewedPublications[0].materialId = 'other'; }, report => { report.finalVerdict.chain[0].question = '别的观点'; },
    report => { report.finalVerdict.confidence = 'low'; }, report => { report.steps[0].published = false; },
    report => { report.finalVerdict.status = 'insufficient'; report.finalVerdict.unresolved = ['仍有关键缺口']; }, report => { report.finalVerdict = null; },
  ]) {
    const input = submission(); input.report = reviewedReport('refuted'); change(input.report);
    assert.equal((await request('', 'POST', input)).status, 400);
  }
  const legacy = submission(); delete legacy.report.ending; delete legacy.report.finalVerdict;
  legacy.report.verdict = { status: 'refuted', label: '旧版单轮结论', summary: '最后一轮反驳了部分条件。' };
  assert.equal((await request('', 'POST', legacy)).status, 200);
  const report = (await request(`/${legacy.runId}`)).result.report;
  assert.equal(report.ending.id, 'unreviewed'); assert.equal(report.finalVerdict, null);
});

test('older report styles remain readable without fabricating missing upgrade allocations', async t => {
  const { request } = await fixture(t), input = submission();
  input.report.style = { name: '实锤派', description: '旧版保存的打法总结。' };
  assert.equal((await request('', 'POST', input)).status, 200);
  const saved = (await request(`/${input.runId}`)).result.report;
  assert.deepEqual(saved.style, input.report.style);
  assert.equal(Object.hasOwn(saved.style, 'levels'), false);
});

test('leaderboard sorts elapsed time ascending, keeps tied insertion order, and returns an outside-top-100 rank across reloads', async t => {
  const { request, server, start } = await fixture(t), inputs = Array.from({ length: 103 }, (_, index) => submission(162 - index));
  for (const input of inputs) assert.equal((await request('', 'POST', input)).status, 200);
  const list = (await request(`?runId=${inputs[0].runId}`)).result;
  assert.equal(list.total, 103); assert.equal(list.entries.length, 100); assert.equal(list.current.rank, 103);
  assert.equal(list.entries[0].id, inputs.at(-1).runId); assert.equal(list.entries[99].elapsed, 159);
  assert.ok(list.entries.every((entry, index) => entry.rank === index + 1 && (!index || list.entries[index - 1].elapsed <= entry.elapsed)));
  const tied = submission(60), result = (await request('', 'POST', tied)).result;
  assert.equal(result.current.rank, 2); assert.equal(result.entries[0].id, inputs.at(-1).runId);
  assert.equal((await request(`/${inputs[0].runId}`)).result.entry.rank, 104);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const reopened = await start();
  assert.deepEqual((await reopened.request(`?runId=${tied.runId}`)).result, result);
  assert.equal((await reopened.request(`/${inputs[0].runId}`)).result.entry.rank, 104);
});

test('concurrent duplicate submissions are idempotent and retries cannot rewrite a result', async t => {
  const { request, path } = await fixture(t), input = submission();
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => request('', 'POST', input)));
  assert.ok(duplicates.every(result => result.status === 200 && result.result.total === 1));
  const retry = await request('', 'POST', { ...input, name: '改写名字', report: completedReport(999) });
  assert.equal(retry.result.current.elapsed, 420); assert.equal(retry.result.current.name, input.name);
  const others = Array.from({ length: 8 }, (_, index) => submission(100 + index));
  await Promise.all(others.map(item => request('', 'POST', item)));
  assert.equal((await request()).result.total, 9); assert.equal(JSON.parse(await readFile(path, 'utf8')).entries.length, 9);
  assert.deepEqual(await readdir(join(path, '..')), ['leaderboard.json'], 'atomic writes leave no temporary files');
});

test('only the owner can rename a record and renaming preserves rank, report, and tie position', async t => {
  const { request } = await fixture(t), input = submission(), second = submission();
  await request('', 'POST', input); await request('', 'POST', second);
  const denied = await request(`/${input.runId}`, 'PATCH', { ownerToken: second.ownerToken, name: '盗名' });
  assert.equal(denied.status, 403); assert.equal(denied.error.code, 'LEADERBOARD_OWNER');
  assert.equal((await request('', 'POST', { ...input, ownerToken: second.ownerToken })).status, 403);
  const renamed = await request(`/${input.runId}`, 'PATCH', { ownerToken: input.ownerToken, name: '新侦探', elapsed: 999 });
  assert.equal(renamed.result.current.name, '新侦探'); assert.equal(renamed.result.current.rank, 1); assert.equal(renamed.result.current.elapsed, 420);
  assert.equal((await request(`/${input.runId}`)).result.report.stats.elapsed, 420);
  assert.equal((await request(`/${input.runId}`, 'PATCH', { ownerToken: input.ownerToken, name: '  ' })).status, 400);
  assert.equal((await request(`/${randomUUID()}`)).status, 404);
});

test('leaderboard survives a new server instance with result and rename intact', async t => {
  const { request, server, start } = await fixture(t), input = submission();
  await request('', 'POST', input);
  await request(`/${input.runId}`, 'PATCH', { ownerToken: input.ownerToken, name: '归来的侦探' });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const next = await start(), list = await next.request(`?runId=${input.runId}`);
  assert.equal(list.result.total, 1); assert.equal(list.result.current.name, '归来的侦探');
  assert.equal((await next.request(`/${input.runId}`)).result.report.claim, input.report.claim);
  assert.equal((await next.request('', 'POST', input)).result.total, 1);
});

test('invalid identity, defeat, report structure, source URL, and bounded names fail without a record', async t => {
  const { request } = await fixture(t);
  const changes = [
    input => { input.runId = 'not-a-uuid'; }, input => { input.ownerToken = ''; }, input => { input.name = '侦'.repeat(21); },
    input => { input.report.outcome = 'lost'; }, input => { input.report.stats.elapsed = -1; }, input => { input.report.stats.elapsed = null; },
    input => { input.report.stats.support = 95; }, input => { input.report.stats.support = 98.99; }, input => { input.report.steps = {}; }, input => { input.report.steps[0].sourceUrl = 'javascript:alert(1)'; },
    input => { input.report.steps[0].materials[0].url = 'http://127.0.0.1/secret'; }, input => { input.report.sources[0].url = 'https://u:p@example.org'; },
    input => { input.report.claim = 'a'.repeat(501); }, input => { input.report.stats.evidenceCount = 5; },
    input => { input.report.style.levels.spread = 4; }, input => { input.report.style.levels.defense = -1; },
    input => { input.report.style.levels.persuasion = 1.5; }, input => { input.report.style.levels.defense = '3'; },
    input => { delete input.report.style.levels.spread; },
  ];
  for (const change of changes) { const input = submission(); change(input); assert.equal((await request('', 'POST', input)).status, 400); }
  for (const invalid of [null, [], '{broken']) assert.equal((await request('', 'POST', invalid)).status, 400);
  assert.equal((await request()).result.total, 0);
});

test('leaderboard rejects foreign origins and wrong content types and keeps separate payload limits', async t => {
  const { request } = await fixture(t), input = submission();
  assert.equal((await request('', 'POST', input, { headers: { origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await request('', 'GET', undefined, { headers: { 'x-lie-company': '' } })).status, 403);
  assert.equal((await request('', 'POST', input, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('', 'DELETE')).status, 405);
  input.report.steps[0].quote = '证'.repeat(5000);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 8192);
  assert.equal((await request('', 'POST', input)).status, 200, 'reports have a larger body budget than searches');
  const tooLarge = submission(); tooLarge.padding = 'x'.repeat(256 * 1024);
  assert.equal((await request('', 'POST', tooLarge)).status, 413);
  assert.equal((await request()).result.total, 1);
});
