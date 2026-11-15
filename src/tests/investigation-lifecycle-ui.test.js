import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createAppServer } from '../server/main.mjs';
import { createGame, getResearchStatus, setInvestigationPlan, failInvestigationPlan, startLeadRefresh, completeLeadRefresh, failLeadRefresh, startResearch, completeLiveResearch, failLiveResearch, publishEvidence, getStats, getEvidenceMaterial } from '../dist/engine.js';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';
import { getMaterialEffect } from '../dist/investigation-contract.js';
import { worldTime } from '../dist/world-time.js';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const browserFunctions = ['cancelInvestigationSession', 'cancelLiveRequest', 'prepareInvestigation', 'renderOutcome', 'performPublish', 'refreshInvestigationLeads', 'runInvestigation', 'runResearch'].map(name => {
  const fn = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(fn, `execute the actual browser ${name} function`);
  return fn;
}).join('\n');

function stateFixture() {
  const state = createGame({ claim: '待调查的具体观点', researchMode: 'live', investigationMode: 'agent' });
  state.coins = 100;
  const plan = { sessionId: randomUUID(), claim: state.claim, leads: ['1', '2'].map(id => ({ id: `lead-${id}`, title: `方向${id}`, question: `第${id}条线索能否反驳原观点？`, reason: '查证原始记录。' })) };
  assert.equal(setInvestigationPlan(state, plan).ok, true);
  return { state, plan };
}
function researchResult(state) {
  const job=state.research,round=RESEARCH_ROUNDS.find(item=>item.id===job.roundId),template=round.materials[0];
  return { sessionId:job.sessionId,leadId:job.leadId,claim:state.claim,provider:'联网调查',requestId:randomUUID(),fetchedAt:'2026-10-24T00:00:00Z',
    query:job.query,searchQuery:job.query,finding:'原文说明了适用条件。',assessment:{status:'mixed',summary:'现有材料只支持有限范围。'},
    nextLeads:[1,2].map(index=>({id:`next-lead-${index}`,title:`新方向${index}`,question:`新线索${index}是否存在反例？`,reason:'核对其他条件。'})),
    recommendation:{materialId:template.id,reason:'选择原始记录。'},
    materials:[{id:template.id,focus:template.focus,eventId:template.eventId,title:'原始记录',finding:'原文说明了适用条件。',
      insight:{kind:'context',headline:'观察有适用条件',explanation:'不能推及所有场景。',quote:'原始记录说明了适用条件。'},
      sources:[{title:'观察档案',url:'https://example.org/source',organization:'记录机构',summary:'原始记录说明了适用条件。'}],
      effectId:'relay',effectReason:'便于传播可核对的原文。',nextQuestion:'新线索是否存在反例？'}] };
}
function browser(state, fetchImpl) {
  const requests = [], timers = new Map(), elements = new Map();
  let timerId = 0;
  const context = {
    game: state, cancelledInvestigationSessions: new WeakMap(), getResearchStatus, setInvestigationPlan, failInvestigationPlan, startLeadRefresh, completeLeadRefresh, failLeadRefresh,
    startResearch, completeLiveResearch, failLiveResearch, publishEvidence, getStats, getEvidenceMaterial, RESEARCH_ROUNDS, getMaterialEffect, worldTime,
    newUuid: randomUUID, AbortSignal, AbortController, clearTimeout: id => timers.delete(id), setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    liveRequest: null, planRequest: null, planRequestId: null, leadRefreshRequest: null,
    resultShown: false, publicationScene: null, tutorial: { isOpen: () => false }, victoryPresentation: { state, until: 0, waitingShown: false },
    isVictorySettling: current => Boolean((current || context.game)?.phase === 'won' && (current || context.game)?.research),
    isAgentGame: current => Boolean(current?.investigation), RULES: { winTruth: 99 },
    gameAudio: { emit() {}, setScene() {} }, fieldMessage() {}, feedback() {}, render() {}, showAgentSearch() {}, showVictorySettlement() {}, renderFieldFeed() {}, renderResearch() {},
    reducedMotion: { matches: true }, firstMovePending:false,lastFrame:0,celebrationUntil:0,performance,
    text() {}, markAction() {}, closeDetail() {}, coinWalletFeedback() {}, walletFeedback() {}, updateFieldInvestigation() {}, fieldFeed:{},
    pollInvestigationProgress() {}, async readInvestigationProgress() {}, showLiveSearchFailure() {},
    finalReviews: 0, requestFinalVerdict() { context.finalReviews++; }, showEndingCinematic() {},
    detailType: '', detailResultId: null, detailPauseBeforeOpen: null, enemyNotice: null, interrupts: [],
    $: id => { if (!elements.has(id)) elements.set(id, { open: false, close() {}, showModal() {}, hidden: false, dataset:{}, classList:{toggle(){}} }); return elements.get(id); },
    document: { querySelectorAll: () => [] },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), options });
      return fetchImpl ? fetchImpl(url, options) : new Response(JSON.stringify({ ok: true }));
    },
  };
  runInNewContext(browserFunctions, context);
  return { context, requests, timers };
}

test('publishing evidence unlocks the next directions without starting either investigation', () => {
  const { state }=stateFixture(),lead=state.investigation.leads[0];
  assert.equal(startResearch(state,lead.question,{requestId:randomUUID(),leadId:lead.id}).ok,true);
  assert.equal(completeLiveResearch(state,state.research.requestId,researchResult(state)).ok,true);
  const { context,requests }=browser(state);
  context.performPublish();
  assert.ok(state.researchResults[0].promotedId);
  assert.equal(state.research,null);
  assert.equal(requests.length,0);
});

test('refresh changes the questions without searching either direction', async () => {
  const { state }=stateFixture();
  const refreshed={sessionId:state.investigation.sessionId,claim:state.claim,roundId:'round-1',
    leads:[1,2].map(index=>({id:`refreshed-${index}`,title:`换个方向${index}`,question:`不同样本${index}是否存在相反记录？`,reason:'核对独立样本。'}))};
  const { context,requests }=browser(state,async()=>new Response(JSON.stringify({ok:true,result:refreshed})));
  await context.refreshInvestigationLeads();
  assert.deepEqual(state.investigation.leads,refreshed.leads);
  assert.deepEqual(requests.map(request=>request.url),['/api/investigation/refresh']);
  assert.equal(state.research,null);
  assert.equal(state.coins,99,'only the one-coin refresh fee was spent');
});

test('only selecting a direction sends a paid research request for that direction', async () => {
  const { state }=stateFixture();
  const { context,requests }=browser(state,async()=>new Response(JSON.stringify({ok:true,result:researchResult(state)})));
  const lead=state.investigation.leads[1],cost=getResearchStatus(state).cost;
  assert.equal(requests.length,0);
  await context.runResearch(lead.question,lead.id);
  assert.deepEqual(requests.map(request=>request.url),['/api/investigation/research']);
  assert.equal(requests[0].body.leadId,lead.id);
  assert.equal(state.coins,100-cost);
  assert.equal(state.researchResults.length,1);
  assert.equal(state.researchResults[0].chosenLead.id,lead.id);
});

test('browser keeps cancellation alive through navigation and retries failed cleanup on a later lifecycle event', async () => {
  const { state } = stateFixture();
  let fail = true;
  const { context, requests } = browser(state, async () => new Response('{}', { status: fail ? 503 : 200 }));
  await context.cancelInvestigationSession(state);
  fail = false;
  await context.cancelInvestigationSession(state);
  await context.cancelInvestigationSession(state);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.options.keepalive && request.body.sessionId === state.investigation.sessionId));
});

test('an abandoned plan retains its deadline, then closes its late session without preparing either direction', async () => {
  const { state, plan } = stateFixture();
  state.investigation.sessionId = null; state.investigation.leads = [];
  let resolvePlan;
  const { context, requests, timers } = browser(state, (url) => url.endsWith('/plan') ? new Promise(resolve => { resolvePlan = resolve; }) : new Response('{}'));
  const waiting = context.prepareInvestigation(state);
  const planController = context.planRequest.controller;
  assert.equal([...timers.values()][0].ms, 100000);
  context.cancelLiveRequest(); context.game = null;
  assert.equal(planController.signal.aborted, false);
  resolvePlan(new Response(JSON.stringify({ ok: true, result: plan })));
  await waiting;
  assert.equal(timers.size, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/investigation/cancel');
  assert.equal(requests[1].body.sessionId, plan.sessionId);
  assert.equal(state.investigation.sessionId, null);
});

test('successful planning applies both choices without researching either direction', async () => {
  const { state, plan } = stateFixture();
  state.investigation.sessionId = null; state.investigation.leads = [];
  const { context, requests } = browser(state, async url => new Response(JSON.stringify(url.endsWith('/plan') ? { ok: true, result: plan } : { ok: true })));
  await context.prepareInvestigation(state);
  assert.equal(state.investigation.sessionId, plan.sessionId);
  assert.deepEqual(requests.map(request => request.url), ['/api/investigation/plan']);
  assert.equal(state.research,null);
  assert.equal(state.coins,100);
});

test('planning server timeouts use direction-specific wording instead of claiming evidence was collected', async () => {
  const { state } = stateFixture();
  state.investigation.sessionId = null; state.investigation.leads = [];
  const { context, requests, timers } = browser(state, async () => new Response(JSON.stringify({ ok: false,
    error: { code: 'MODEL_TIMEOUT', message: '调查暂未完成，已找到的资料会保留，请稍后重试。' } }), { status: 504 }));
  await context.prepareInvestigation(state);
  assert.equal(state.investigation.planError, '调查方向准备超时，请重新准备。');
  assert.equal(getResearchStatus(state).phase, 'plan-error');
  assert.deepEqual(requests.map(request => request.url), ['/api/investigation/plan']);
  assert.equal(state.coins, 100); assert.equal(timers.size, 0);
});

test('retrying planning clears stale failure state without changing the selected speed or manual pause', async () => {
  const { state, plan } = stateFixture();
  state.investigation.sessionId = null; state.investigation.leads = [];
  failInvestigationPlan(state, '上次准备超时。');
  let resolvePlan;
  const { context, requests } = browser(state, () => new Promise(resolve => { resolvePlan = resolve; }));
  context.manualPaused = true; context.speed = 4;
  const waiting = context.prepareInvestigation(state);
  assert.equal(getResearchStatus(state).phase, 'planning'); assert.equal(state.investigation.planError, null);
  assert.equal(context.manualPaused, true); assert.equal(context.speed, 4); assert.equal(state.coins, 100);
  assert.deepEqual(requests.map(request => request.url), ['/api/investigation/plan']);
  resolvePlan(new Response(JSON.stringify({ ok: true, result: plan }))); await waiting;
  assert.equal(getResearchStatus(state).phase, 'ready');
  assert.equal(context.manualPaused, true); assert.equal(context.speed, 4);
});

test('the browser planning deadline aborts after its 100-second allowance and gives the same stage-specific error', async () => {
  const { state } = stateFixture();
  state.investigation.sessionId = null; state.investigation.leads = [];
  const { context, requests, timers } = browser(state, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
  }));
  const waiting = context.prepareInvestigation(state), deadline = [...timers.values()][0];
  assert.equal(deadline.ms, 100000); assert.equal(requests[0].options.signal.aborted, false);
  deadline.fn(); await waiting;
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(state.investigation.planError, '调查方向准备超时，请重新准备。');
  assert.equal(context.planRequest, null); assert.equal(timers.size, 0); assert.equal(state.coins, 100);
});

test('victory cleanup waits for paid research to settle and still starts the independent final review', async () => {
  const { state } = stateFixture(); state.phase = 'won'; state.research = { kind: 'live' };
  const { context, requests } = browser(state);
  context.renderOutcome(1);
  assert.equal(requests.length, 0); assert.equal(context.finalReviews, 0);
  state.research = null;
  context.renderOutcome(2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/investigation/cancel');
  assert.equal(context.finalReviews, 1);
});

async function httpFixture(t, options = {}) {
  const calls = { research: 0, cancel: [], close: 0 };
  const investigation = { configured: true,
    research() { calls.research++; return { finding:'玩家已选择的调查结果' }; },
    cancel(input) { calls.cancel.push(input); return { secretEvidence: 'must stay server-side' }; },
    close() { calls.close++; },
  };
  const server = createAppServer({ investigation, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  t.after(close);
  const post = (path, body, headers = {}) => fetch(`${base}/api/investigation/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lie-company': 'research', origin: base, ...headers }, body: JSON.stringify(body) });
  return { calls, base, post, close };
}

test('the removed prefetch endpoint cannot start work; selected research retains deduplication and origin limits', async t => {
  const { calls, base, post, close } = await httpFixture(t, { minuteLimit: 1, hourLimit: 1 });
  const body = { requestId: randomUUID(), sessionId: randomUUID(), roundId: 'round-1', leadId:'lead-a', promotedId: null };
  assert.equal((await post('prefetch',body)).status,404);
  assert.equal(calls.research,0);
  assert.equal((await post('research', body, { origin: 'https://outside.example' })).status, 403);
  assert.equal((await post('research', body, { 'x-lie-company': '' })).status, 403);
  assert.equal((await post('research', body, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/api/investigation/research`)).status, 405);
  assert.equal((await post('research', { ...body, requestId: 'short' })).status, 400);
  const expected = { ok: true, result: {finding:'玩家已选择的调查结果'} };
  assert.deepEqual(await (await post('research', body)).json(), expected);
  assert.deepEqual(await (await post('research', body)).json(), expected);
  assert.equal(calls.research, 1);
  assert.equal((await post('research', { ...body, leadId:'lead-b' })).status, 409);
  assert.equal((await post('research', { ...body, requestId: randomUUID() })).status, 429);
  await close(); assert.equal(calls.close, 1);
});

test('cancel HTTP bypasses exhausted limits but validates input/origin and exposes no private service data', async t => {
  const { calls, post } = await httpFixture(t, { minuteLimit: 0, hourLimit: 0 });
  const body = { requestId: randomUUID(), sessionId: randomUUID(), ignored: 'private-value' };
  assert.equal((await post('research', body)).status, 429);
  assert.equal((await post('cancel', body, { origin: 'https://outside.example' })).status, 403);
  for (const invalid of [{ ...body, requestId: 'short' }, { ...body, sessionId: '' }, { ...body, sessionId: { id: body.sessionId } }, { ...body, sessionId: 'x'.repeat(81) }]) assert.equal((await post('cancel', invalid)).status, 400);
  assert.deepEqual(await (await post('cancel', body)).json(), { ok: true, result: { sessionId: body.sessionId, cancelled: true } });
  assert.deepEqual(calls.cancel, [{ requestId: body.requestId, sessionId: body.sessionId }]);
});
