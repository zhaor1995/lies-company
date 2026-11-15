import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createInvestigationService } from '../server/investigation.mjs';
import { SearchError } from '../server/search.mjs';

let sequence = 0;
const requestId = () => `lifecycle-test-request-${++sequence}`;
const directions = (refresh = false) => (refresh ? [
  { title: '比较地区差异', question: '不同地区的独立样本是否存在相反观察？', reason: '检查适用范围。' },
  { title: '核对测量方法', question: '原始测量方法是否遗漏了必要条件？', reason: '核对观察过程。' },
] : [
  { title: '找原始记录', question: '传闻提到的原始观察记录是什么？', reason: '核对原始记录。' },
  { title: '核对实际条件', question: '这项观察需要哪些实际条件？', reason: '区分观察与推测。' },
]).map((lead, index) => ({ ...lead, searchQuery: lead.question, routeRole: index ? 'indirect' : 'direct', criterionId: 'c1', limitation: '仍需核对适用条件。' }));

function planDraft(claim) {
  return { evidencePlan: { proposition: claim, refutationTarget: '寻找原命题条件下的直接反例。', scope: '原命题所述主体与条件。',
    criteria: [{ question: '原命题在其宣称条件下成立吗？', requiredEvidence: '相同条件的直接观察。', counterEvidence: '相同条件下的直接反例。' }] }, leads: directions() };
}

function analysisDraft(data) {
  return { action: 'final', finding: '找到了可核对的观察与适用条件。', assessment: { status: 'mixed', summary: '现有材料只支持有限范围，仍需注意条件。' },
    sourceRanking: data.sources.map(source => ({ sourceId: source.id, relevance: 'direct', strength: 'limited', relation: 'limits', reason: '原文直接记载观察条件。' })),
    evidence: { quoteId: data.sources[0].passages[0].id, headline: '观察具有适用条件', explanation: '原文记载了适用条件，不能推及所有场景。' },
    chainAssessment: { unresolved: ['观察条件能否推广？'] }, nextLeads: data.round === 5 ? [] : directions() };
}

function verdictDraft(data) {
  return { status: 'mixed', confidence: 'medium', summary: '现有材料仅支持有限范围。', rationale: '原文记载适用条件，尚不能推广。', unresolved: ['需要核对适用范围。'],
    chain: data.publications.map(item => ({ roundId: item.roundId, finding: '原文提供观察条件。', strength: 'limited', relevance: 'direct', gap: '适用范围仍待核对。' })),
    criteriaReview: data.evidencePlan.criteria.map(item => ({ criterionId: item.id, outcome: 'mixed', decisive: false,
      publicationRefs: data.publications.map(publication => ({ quoteId: publication.quoteId, basis: 'original-document' })), explanation: '已公布原文记载适用条件。' })) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function waitWithAbort(gate, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SearchError('MODEL_TIMEOUT', '请求已停止。', 504));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    gate.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function fixtures(t, { analyze, retrieve, refresh, ...settings } = {}) {
  const calls = { search: [], analysis: [], refresh: [], verdict: [] }, sessions = [];
  const model = { configured: true, async complete(input, options) {
    if (input.data.publications) { calls.verdict.push(input); return verdictDraft(input.data); }
    if (input.data.sources) {
      const call = { input, options }; calls.analysis.push(call);
      return analyze ? analyze(call, calls.analysis.length) : analysisDraft(input.data);
    }
    if (input.data.issuedLeads) { calls.refresh.push(input); return refresh ? refresh(input, options) : { leads: directions(true) }; }
    return planDraft(input.data.claim);
  } };
  const search = { configured: true, async retrieve(query, options) {
    const call = { query, options, index: calls.search.length + 1 }; calls.search.push(call);
    if (retrieve) return retrieve(call);
    return { requestId: `search-${call.index}`, sources: [{ title: `观察记录 ${call.index}`, url: `https://records.example/${call.index}`, organization: '观察档案',
      summary: `第 ${call.index} 份原始观察说明了实验条件，不能推及所有场景。`, content: '', date: '2026-01-01' }] };
  } };
  const service = createInvestigationService({ model, search, diagnostic() {}, ...settings });
  const plan = async () => {
    const result = await service.plan({ requestId: requestId(), claim: '任意传闻需要核查' }); sessions.push(result); return result;
  };
  t.after(async () => {
    for (const session of sessions) await service.cancel?.({ requestId: requestId(), sessionId: session.sessionId });
  });
  return { service, calls, plan };
}

const refreshInput = (plan, extra = {}) => ({ requestId: requestId(), sessionId: plan.sessionId, roundId: 'round-1', leadIds: plan.leads.map(lead => lead.id), ...extra });
const researchInput = (plan, extra = {}) => ({ requestId: requestId(), sessionId: plan.sessionId, roundId: 'round-1', leadId: plan.leads[0].id, gameContext: { reached: 20 }, ...extra });
const rejectCode = (action, code) => assert.rejects(Promise.resolve().then(action), error => error instanceof SearchError && (!code || error.code === code));
const transient = code => Object.assign(new SearchError(code, '服务暂时不可用。', 503), { retryable: true });

// All providers in these tests are in-memory promises. Draining the event loop
// lets their promise chains settle without depending on real provider latency.
async function drain() { await nextTurn(); await nextTurn(); }

test('planning and refreshing only prepare choices; evidence work starts when the player selects a direction', { timeout: 5000 }, async t => {
  const { service, calls, plan } = fixtures(t);
  const session = await plan(); await drain();
  assert.equal(calls.search.length, 0); assert.equal(calls.analysis.length, 0);
  const refreshed = await service.refresh(refreshInput(session)); await drain();
  assert.equal(calls.refresh.length, 1); assert.equal(calls.search.length, 0); assert.equal(calls.analysis.length, 0);
  const input = researchInput(session, { leadId: refreshed.leads[1].id, gameContext: { reached: 90 } });
  const result = await service.research(input); await drain();
  assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 1);
  assert.equal(result.query, refreshed.leads[1].question); assert.equal(result.materials[0].focus, 'persuasion');
  assert.equal(result.materials[0].effectId, 'authority');
  assert.deepEqual(await service.research({ ...input, requestId: requestId(), gameContext: { reached: 10 } }), result);
  assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 1, 'completed results and next-round choices must not launch another investigation');
});

test('duplicate selected requests join one investigation while another direction is rejected', { timeout: 5000 }, async t => {
  const gate = deferred();
  const { service, calls, plan } = fixtures(t, { analyze: async ({ input, options }) => { await waitWithAbort(gate, options.signal); return analysisDraft(input.data); } });
  const session = await plan(), firstInput = researchInput(session), duplicateInput = researchInput(session);
  const first = service.research(firstInput), duplicate = service.research(duplicateInput);
  await drain();
  await rejectCode(() => service.research(researchInput(session, { leadId: session.leads[1].id })), 'INVESTIGATION_BUSY');
  const progress = service.progress({ sessionId: session.sessionId, requestId: firstInput.requestId });
  assert.equal(progress.status, 'running'); assert.ok(progress.events.some(event => event.stage === 'sources'));
  assert.deepEqual(service.progress({ sessionId: session.sessionId, requestId: duplicateInput.requestId }).events, progress.events);
  gate.resolve(); assert.deepEqual(await duplicate, await first);
  assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 1);
});

test('cancel aborts a selected investigation and late provider success cannot commit evidence', { timeout: 5000 }, async t => {
  const gate = deferred();
  const { service, calls, plan } = fixtures(t, { analyze: async ({ input }) => { await gate.promise; return analysisDraft(input.data); } });
  const session = await plan(), running = service.research(researchInput(session));
  const rejected = assert.rejects(running, error => error instanceof SearchError && error.code === 'SESSION_CLOSED');
  await drain(); await service.cancel({ requestId: requestId(), sessionId: session.sessionId });
  assert.equal(calls.analysis[0].options.signal.aborted, true); await rejected;
  gate.resolve(); await drain();
  await rejectCode(() => service.verdict({ requestId: requestId(), sessionId: session.sessionId, publications: [{ roundId: 'round-1', materialId: 'photo-spread' }] }), 'INVALID_PUBLICATIONS');
  await rejectCode(() => service.research(researchInput(session)), 'SESSION_CLOSED');
  assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 1);
});

test('cancelling current research preserves previously committed evidence for the final verdict', { timeout: 5000 }, async t => {
  const gate = deferred();
  const { service, calls, plan } = fixtures(t, { analyze: async ({ input, options }) => {
    if (input.data.round > 1) await waitWithAbort(gate, options.signal);
    return analysisDraft(input.data);
  } });
  const session = await plan(), first = await service.research(researchInput(session));
  const running = service.research(researchInput(session, { roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.recommendation.materialId }));
  const rejected = assert.rejects(running, error => error instanceof SearchError);
  await drain(); await service.cancel({ requestId: requestId(), sessionId: session.sessionId }); await rejected; await drain();
  assert.equal(calls.analysis[1].options.signal.aborted, true);
  const verdict = await service.verdict({ requestId: requestId(), sessionId: session.sessionId, publications: [{ roundId: 'round-1', materialId: first.recommendation.materialId }] });
  assert.equal(verdict.finalVerdict.reviewedPublications.length, 1); assert.equal(calls.verdict.length, 1);
  assert.equal(calls.verdict[0].data.publications.length, 1); assert.equal(calls.verdict[0].data.publications[0].question, first.query);
  assert.deepEqual(await service.research(researchInput(session)), first);
});

test('cancel aborts a running refresh and rejects its late response without starting evidence work', { timeout: 5000 }, async t => {
  const gate = deferred(); let refreshSignal;
  const { service, calls, plan } = fixtures(t, { refresh: async (_input, options) => {
    refreshSignal = options.signal; await gate.promise; return { leads: directions(true) };
  } });
  const session = await plan(), refreshing = service.refresh(refreshInput(session));
  const rejected = assert.rejects(refreshing, error => error instanceof SearchError && error.code === 'SESSION_CLOSED');
  await drain(); assert.equal(refreshSignal.aborted, false);
  await service.cancel({ requestId: requestId(), sessionId: session.sessionId });
  assert.equal(refreshSignal.aborted, true); await rejected;
  gate.resolve(); await drain();
  await rejectCode(() => service.research(researchInput(session)), 'SESSION_CLOSED');
  assert.equal(calls.search.length, 0); assert.equal(calls.analysis.length, 0); assert.equal(calls.refresh.length, 1);
});

test('a transient model failure resumes selected research from saved sources', { timeout: 5000 }, async t => {
  const { service, calls, plan } = fixtures(t, { analyze: ({ input }, index) => {
    if (index === 1) throw transient('MODEL_UNAVAILABLE');
    return analysisDraft(input.data);
  } });
  const session = await plan(), firstInput = researchInput(session);
  await rejectCode(() => service.research(firstInput), 'MODEL_UNAVAILABLE');
  const failed = service.progress({ sessionId: session.sessionId, requestId: firstInput.requestId });
  const result = await service.research(researchInput(session));
  assert.equal(result.query, session.leads[0].question); assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 2);
  assert.deepEqual(service.progress({ sessionId: session.sessionId, requestId: firstInput.requestId }), failed);
});

test('switching direction after failure starts its own search instead of reusing the other branch sources', { timeout: 5000 }, async t => {
  const { service, calls, plan } = fixtures(t, { analyze: ({ input }, index) => {
    if (index === 1) throw transient('MODEL_UNAVAILABLE');
    return analysisDraft(input.data);
  } });
  const session = await plan(); await rejectCode(() => service.research(researchInput(session)), 'MODEL_UNAVAILABLE');
  const result = await service.research(researchInput(session, { leadId: session.leads[1].id }));
  assert.equal(calls.search.length, 2); assert.equal(result.query, session.leads[1].question);
  assert.equal(result.materials[0].sources[0].url, 'https://records.example/2');
});

test('a failed follow-up resumes that query without repeating the initial search or analysis', { timeout: 5000 }, async t => {
  let followups = 0;
  const followupQuery = '补查独立观察记录与实际条件';
  const { service, calls, plan } = fixtures(t, {
    retrieve: ({ query, index }) => {
      if (query === followupQuery && ++followups === 1) throw transient('SEARCH_UNAVAILABLE');
      return { requestId: `search-${index}`, sources: [{ title: `记录 ${index}`, url: `https://records.example/${index}`,
        organization: '独立观察档案', summary: `第 ${index} 份记录给出一个可复核的观察条件。`, content: '', date: '2026-01-01' }] };
    },
    analyze: ({ input }) => input.data.searches.length === 1 ? { action: 'search', followupQuery } : analysisDraft(input.data),
  });
  const session = await plan(); await rejectCode(() => service.research(researchInput(session)), 'SEARCH_UNAVAILABLE');
  const result = await service.research(researchInput(session));
  assert.equal(result.query, session.leads[0].question); assert.equal(followups, 2);
  assert.equal(calls.search.filter(call => call.query === session.leads[0].question).length, 1);
  assert.equal(calls.search.length, 3); assert.equal(calls.analysis.length, 2);
});

test('a transient failure during direction repair preserves validated evidence and narrow repair context', { timeout: 5000 }, async t => {
  let draft;
  const { service, calls, plan } = fixtures(t, { analyze: ({ input }, attempt) => {
    if (attempt === 1) { draft = analysisDraft(input.data); return { ...draft, nextLeads: draft.nextLeads.slice(0, 1) }; }
    assert.deepEqual(Object.keys(input.schema), ['nextLeads']);
    assert.deepEqual(input.data.previousDraft.evidence, draft.evidence);
    if (attempt === 2) throw transient('MODEL_UNAVAILABLE');
    return { nextLeads: draft.nextLeads };
  } });
  const session = await plan(); await rejectCode(() => service.research(researchInput(session)), 'MODEL_UNAVAILABLE');
  const result = await service.research(researchInput(session));
  assert.equal(calls.analysis.length, 3); assert.equal(calls.search.length, 1);
  assert.equal(result.materials[0].insight.headline, draft.evidence.headline);
});

test('a research deadline fences late provider results and keeps sources for the next explicit retry', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred();
  const { service, calls, plan } = fixtures(t, { analyze: async ({ input }, index) => {
    if (index === 1) await gate.promise;
    return analysisDraft(input.data);
  } });
  const session = await plan(), running = service.research(researchInput(session));
  const rejected = assert.rejects(running, error => error instanceof SearchError && error.code === 'MODEL_TIMEOUT');
  await drain(); t.mock.timers.tick(150000); await rejected; await drain();
  assert.equal(calls.analysis[0].options.signal.aborted, true);
  gate.resolve(); await drain();
  await rejectCode(() => service.verdict({ requestId: requestId(), sessionId: session.sessionId, publications: [{ roundId: 'round-1', materialId: 'photo-spread' }] }), 'INVALID_PUBLICATIONS');
  const result = await service.research(researchInput(session));
  assert.equal(result.materials.length, 1); assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 2);
});

test('explicit retry respects remaining Retry-After without repeating search', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 24) });
  const { service, calls, plan } = fixtures(t, { analyze: ({ input }, index) => {
    if (index === 1) throw Object.assign(transient('MODEL_UNAVAILABLE'), { retryAfterMs: 10000 });
    return analysisDraft(input.data);
  } });
  const session = await plan(); await rejectCode(() => service.research(researchInput(session)), 'MODEL_UNAVAILABLE');
  const resultPromise = service.research(researchInput(session));
  await drain(); assert.equal(calls.analysis.length, 1); assert.equal(calls.search.length, 1);
  t.mock.timers.tick(9999); await drain(); assert.equal(calls.analysis.length, 1);
  t.mock.timers.tick(1); await drain();
  const result = await resultPromise;
  assert.equal(result.query, session.leads[0].question); assert.equal(calls.analysis.length, 2); assert.equal(calls.search.length, 1);
});

test('retrying each failed search query preserves search counts and previous failed progress snapshots', { timeout: 5000 }, async t => {
  const attempts = new Map(), followupQuery = '补查另一份独立观察的原始记录';
  const { service, calls, plan } = fixtures(t, {
    retrieve: ({ query, index }) => {
      const attempt = (attempts.get(query) || 0) + 1; attempts.set(query, attempt);
      if (attempt === 1) throw transient('SEARCH_UNAVAILABLE');
      return { requestId: `search-${index}`, sources: [{ title: `记录 ${index}`, url: `https://records.example/${index}`,
        organization: '独立观察档案', summary: `第 ${index} 份记录给出一个独立可核对的观察条件。`, content: '', date: '2026-01-01' }] };
    },
    analyze: ({ input }) => input.data.searches.length === 1 ? { action: 'search', followupQuery } : analysisDraft(input.data),
  });
  const session = await plan(); await rejectCode(() => service.research(researchInput(session)), 'SEARCH_UNAVAILABLE');
  assert.equal(calls.search.length, 1); assert.equal(calls.analysis.length, 0);
  const secondInput = researchInput(session);
  await rejectCode(() => service.research(secondInput), 'SEARCH_UNAVAILABLE');
  const failedProgress = service.progress({ sessionId: session.sessionId, requestId: secondInput.requestId });
  assert.equal(failedProgress.status, 'failed');
  assert.deepEqual(failedProgress.events.filter(event => event.stage === 'searching').map(event => event.searchAttempt), [1, 2]);
  const finalInput = researchInput(session), result = await service.research(finalInput);
  const completedProgress = service.progress({ sessionId: session.sessionId, requestId: finalInput.requestId });
  assert.equal(completedProgress.status, 'completed'); assert.equal(result.query, session.leads[0].question);
  assert.deepEqual(completedProgress.events.filter(event => event.stage === 'searching').map(event => event.searchAttempt), [1, 2]);
  assert.ok(completedProgress.events.filter(event => event.stage === 'repairing' && event.retry && event.retryStage === 'searching').length >= 2);
  assert.equal(attempts.get(session.leads[0].question), 2); assert.equal(attempts.get(followupQuery), 2);
  assert.equal(calls.search.length, 4); assert.equal(calls.analysis.length, 2);
  assert.deepEqual(service.progress({ sessionId: session.sessionId, requestId: secondInput.requestId }), failedProgress);
});
