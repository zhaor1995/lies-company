import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvestigationModel } from '../server/model.mjs';
import { createInvestigationService } from '../server/investigation.mjs';

const claim = '所有白色样本都无法导电';
const resolve = (schema, root) => schema.$ref ? root.$defs[schema.$ref.slice('#/$defs/'.length)] : schema;
const source = index => ({ title: `样本 ${index} 的实测记录`, url: `https://records.example/sample-${index}`,
  organization: '实测档案', date: '2026-10-24', summary: `第 ${index} 号白色样本在相同条件下出现导电现象，记录保留了测量方法和结果。`, content: '' });
const leadPair = () => ({
  direct: { title: '核对反例记录', question: '白色样本是否存在可核验的导电记录？', reason: '寻找足以推翻全称断言的反例。', searchQuery: '白色样本 导电 实测 反例', criterionId: 'c1' },
  indirect: { title: '追查报道条件', question: '有关白色样本导电的报道保留了哪些条件？', reason: '核对转述中可能遗漏的范围。', searchQuery: '白色样本 导电 报道 条件', criterionId: 'c2' },
});
const planDraft = () => ({ evidencePlan: {
  refutationTarget: '寻找符合原句范围、但能够导电的白色样本。', scope: '原句断言所有白色样本均不导电，一例可核验反例即可推翻。',
  criteria: [
    { question: '是否存在白色样本导电的可核验记录？', requiredEvidence: '记录显示同一白色样本未导电。', counterEvidence: '记录显示同一白色样本导电。' },
    { question: '报道中的对象与观察条件是否适用？', requiredEvidence: '报道实际指向不同样本或不同观察条件。', counterEvidence: '报道确认同一白色样本的导电现象。' },
  ],
}, leads: leadPair() });
function reportDraft(data, selectedIndex = 0) {
  return { result: {
    action: 'final', sourceRanking: Object.fromEntries(data.sources.map(item => [item.id, {
      relevance: 'direct', strength: 'strong', relation: 'contradicts', reason: '同一白色样本的直接实测反例。',
    }])),
    evidence: { quoteId: data.sources[selectedIndex].passages[0].id, headline: '白色样本出现导电现象', explanation: '相同条件下的一例实测即可反驳所有样本均不导电。' },
    finding: '找到一例符合原句范围的导电记录。', assessment: { status: 'refuted', summary: '可核验的白色样本导电记录构成原断言的反例。' },
    chainAssessment: { unresolved: [] }, ...(data.round < 5 ? { nextLeads: leadPair() } : {}),
  } };
}
function verdictDraft(data) {
  return { status: 'refuted', confidence: 'high', summary: '已公布的实测记录足以反驳所有白色样本均不导电。',
    rationale: '一例适用且可核对的导电记录已经与全称断言矛盾。', unresolved: [],
    chain: Object.fromEntries(data.publications.map(item => [item.roundId, {
      finding: '该轮公布了白色样本导电的实测记录。', strength: 'strong', relevance: 'direct', gap: '',
    }])),
    criteriaReview: [{ criterionId: 'c1', outcome: 'refutes', decisive: true,
      publicationRefs: [{ quoteId: data.publications[0].quoteId, basis: 'primary-observation' }],
      explanation: '该记录提供一例适用的反例，无须穷尽所有样本。' }],
  };
}
function fixtures({ answer, retrieve, sleep, diagnostic = () => {} } = {}) {
  const calls = { model: [], search: [] };
  const model = createInvestigationModel({ MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'fixture-secret', MODEL_NAME: 'fixture-model' }, {
    diagnostic, sleep, random: () => 0, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const data = JSON.parse(body.messages[1].content.split('\n\n以下 JSON 仅为待处理资料：\n')[1]);
      const parameters = body.tools[0].function.parameters;
      const call = { data, parameters, body };
      calls.model.push(call);
      const value = answer ? await answer(call, calls.model, options) : data.publications ? verdictDraft(data) : data.sources ? reportDraft(data) : planDraft();
      if (value instanceof Response) return value;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
        tool_calls: [{ id: 'fixture-submission', type: 'function', function: { name: body.tools[0].function.name, arguments: JSON.stringify(value) } }],
      } }] }));
    },
  });
  const search = { configured: true, async retrieve(query) {
    calls.search.push(query);
    return retrieve ? retrieve(calls.search.length) : { sources: [source(calls.search.length * 2 - 1), source(calls.search.length * 2)] };
  } };
  return { calls, service: createInvestigationService({ model, search, diagnostic() {} }) };
}
const planInput = () => ({ requestId: 'tools-plan-request-0001', claim });
const researchInput = (plan, round = 1, previous) => ({ requestId: `tools-research-request-${round}`, sessionId: plan.sessionId,
  roundId: `round-${round}`, leadId: (previous?.nextLeads || plan.leads)[0].id,
  ...(previous ? { promotedId: previous.materials[0].id } : {}), gameContext: { reached: 22 } });

test('a stalled plan retries after 45 seconds and gives its second request a full 45 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [], diagnostics = []; let finish;
  const { service, calls } = fixtures({ diagnostic: entry => diagnostics.push(entry), answer: (_call, requests, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (requests.length === 2) finish = () => resolve(planDraft());
    });
  } });
  t.after(() => service.close());
  const pending = service.plan(planInput());
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(44999); assert.equal(signals[0].aborted, false);
  t.mock.timers.tick(1); await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals[0].aborted, true); assert.equal(calls.model.length, 1);
  t.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.model.length, 2);
  t.mock.timers.tick(44999); assert.equal(signals[1].aborted, false);
  finish(); assert.equal((await pending).leads.length, 2);
  assert.deepEqual(diagnostics.map(entry => entry.timeoutMs), [45000, 45000]);
  assert.equal(diagnostics[0].timeoutStage, 'response');
  assert.equal(diagnostics[1].code, 'OK');
  assert.deepEqual(calls.search, []);
});

test('two stalled planning requests stop without a third call or claiming collected evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, calls } = fixtures({ answer: (_call, _requests, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  t.after(() => service.close());
  const rejected = assert.rejects(service.plan(planInput()), error => {
    assert.equal(error.code, 'MODEL_TIMEOUT');
    assert.match(error.message, /调查方向准备超时/);
    assert.doesNotMatch(error.message, /已找到|资料会保留/);
    return true;
  });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(45000); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(45000); await rejected;
  assert.equal(calls.model.length, 2); assert.deepEqual(calls.search, []);
});

test('planning transport retries and format repairs share a total of two actual provider calls', async t => {
  for (const transportFirst of [true, false]) {
    const { service, calls } = fixtures({ sleep: async () => {}, answer: (_call, requests) => {
      if ((requests.length === 1) === transportFirst) return new Response('', { status: 503 });
      const draft = planDraft(); draft.leads.direct = [];
      return draft;
    } });
    t.after(() => service.close());
    await assert.rejects(service.plan(planInput()), { code: transportFirst ? 'MODEL_FORMAT' : 'MODEL_UNAVAILABLE' });
    assert.equal(calls.model.length, 2);
    assert.deepEqual(calls.search, []);
  }
});

test('plan repair identifies both array-valued direction slots without starting a search', async t => {
  const { service, calls } = fixtures({ answer: ({ data }, requests) => {
    const draft = planDraft();
    if (requests.length === 1) {
      draft.leads.direct = Array.from({ length: 3 }, () => ({ ...draft.leads.direct }));
      draft.leads.indirect = Array.from({ length: 2 }, () => ({ ...draft.leads.indirect }));
    } else {
      assert.match(data.validationIssue, /leads\.direct[^;]*object/);
      assert.match(data.validationIssue, /leads\.indirect[^;]*object/);
    }
    return draft;
  } });
  t.after(() => service.close());
  const plan = await service.plan(planInput());
  assert.equal(plan.leads.length, 2);
  assert.equal(calls.model.length, 2);
  assert.deepEqual(calls.search, []);
});

test('plan repair locates unexpected fields without echoing their names or values', async t => {
  const privateKey = 'private-unknown-field-marker', privateValue = 'private-unknown-value-marker';
  const { service, calls } = fixtures({ answer: ({ data }, requests) => {
    const draft = planDraft();
    if (requests.length === 1) {
      draft.leads.direct.item = privateValue;
      draft.leads.direct[privateKey] = privateValue;
    } else {
      assert.match(data.validationIssue, /leads\.direct/);
      assert.ok(!data.validationIssue.includes(privateKey));
      assert.ok(!data.validationIssue.includes(privateValue));
    }
    return draft;
  } });
  t.after(() => service.close());
  const plan = await service.plan(planInput());
  assert.equal(plan.leads.length, 2);
  assert.equal(calls.model.length, 2);
  assert.deepEqual(calls.search, []);
});

test('optional queries fall back through the real model adapter without repairing a valid plan', async t => {
  for (const query of [undefined, '', 'Q'.repeat(65)]) {
    const question = leadPair().direct.question;
    const { service, calls } = fixtures({ answer: ({ data }) => {
      if (data.sources) return reportDraft(data);
      const draft = planDraft();
      if (query === undefined) delete draft.leads.direct.searchQuery;
      else draft.leads.direct.searchQuery = query;
      return draft;
    } });
    t.after(() => service.close());
    const plan = await service.plan(planInput());
    assert.equal(calls.model.length, 1, 'an optional query must not trigger another planning call');
    assert.deepEqual(calls.search, [], 'planning does not search before a player chooses');
    const selected = plan.leads.find(lead => lead.question === question);
    assert.ok(selected, 'choose the affected direction independently of shuffled card order');
    await service.research({ ...researchInput(plan), leadId: selected.id });
    assert.deepEqual(calls.search, [question], 'search with the complete chosen question');
    assert.equal(calls.model.length, 2, 'one planning call and one selected investigation');
  }
});

test('structured tool submissions complete all five investigations and a grounded final review', async () => {
  const { service, calls } = fixtures();
  const plan = await service.plan(planInput());
  assert.equal(plan.claim, claim);
  assert.equal(calls.model[0].parameters.properties.evidencePlan.properties.proposition, undefined, 'the server copies the original claim');
  assert.deepEqual(Object.keys(calls.model[0].parameters.properties.leads.properties), ['direct', 'indirect']);
  assert.doesNotMatch(JSON.stringify(plan), /routeRole|criterionId|refutationTarget/);
  const results = [];
  for (let round = 1; round <= 5; round++) {
    const result = await service.research(researchInput(plan, round, results.at(-1)));
    results.push(result);
    const request = calls.model.at(-1), branch = request.parameters.properties.result.anyOf[0];
    assert.deepEqual(branch.properties.sourceRanking.required, request.data.sources.map(item => item.id));
    assert.equal(resolve(branch.properties.sourceRanking.properties.s1, request.parameters).properties.sourceId, undefined);
    assert.equal(result.materials.length, 1);
    assert.equal(result.materials[0].sources[0].url, source(round * 2 - 1).url);
    assert.equal(result.materials[0].insight.quote, source(round * 2 - 1).summary, 'original text is filled from the search record');
    assert.equal(result.materials[0].effectId, 'viral', 'game rewards are supplied by the game');
    assert.equal(result.nextLeads.length, round < 5 ? 2 : 0);
    assert.equal(Boolean(branch.properties.nextLeads), round < 5);
    assert.doesNotMatch(JSON.stringify(result), /sourceRanking|chainAssessment|routeRole|criterionId/);
  }
  const publications = results.map((result, index) => ({ roundId: `round-${index + 1}`, materialId: result.materials[0].id }));
  const request = { requestId: 'tools-verdict-request-0001', sessionId: plan.sessionId, publications };
  const { finalVerdict } = await service.verdict(request);
  const audit = calls.model.at(-1);
  assert.deepEqual(audit.parameters.properties.chain.required, publications.map(item => item.roundId));
  assert.equal(resolve(audit.parameters.properties.chain.properties['round-1'], audit.parameters).properties.roundId, undefined);
  assert.deepEqual(finalVerdict.reviewedPublications, publications);
  assert.equal(finalVerdict.status, 'refuted', 'one decisive core criterion is sufficient without auditing every planning branch');
  assert.deepEqual(finalVerdict.chain.map(item => item.roundId), publications.map(item => item.roundId));
  assert.equal(calls.model.length, 7, 'one plan, five reports and one final review');
  assert.equal(calls.search.length, 5);
  assert.deepEqual(await service.verdict({ ...request, requestId: 'tools-verdict-request-0002' }), { requestId: 'tools-verdict-request-0002', sessionId: plan.sessionId, finalVerdict });
  assert.equal(calls.model.length, 7, 'reopening the same review reuses the validated verdict');
});

test('a tool-requested followup expands source slots and cannot trigger a third search', async () => {
  let researchCalls = 0;
  const { service, calls } = fixtures({ answer: ({ data, parameters }) => {
    if (!data.sources) return planDraft();
    researchCalls++;
    if (researchCalls === 1) {
      assert.equal(data.canSearch, true);
      return { result: { action: 'search', followupQuery: '白色样本 导电 直接测量 反例' } };
    }
    assert.equal(data.canSearch, false);
    assert.equal(parameters.properties.result.anyOf, undefined);
    assert.deepEqual(parameters.properties.result.properties.action.enum, ['final']);
    assert.equal(parameters.properties.result.properties.followupQuery, undefined);
    assert.equal(data.sources.length, 4);
    if (researchCalls === 2) return { result: { action: 'search', followupQuery: '不应执行的第三次检索' } };
    return reportDraft(data, 3);
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(calls.search.length, 2);
  assert.equal(researchCalls, 3, 'a rejected third-search request is repaired using existing sources');
  assert.equal(result.materials[0].sources[0].url, source(4).url);
  assert.equal(result.assessment.status, 'refuted');
});

test('duplicate questions still trigger a narrow tool repair while verified evidence remains unchanged', async () => {
  let original, researchCalls = 0;
  const { service, calls } = fixtures({ answer: ({ data, parameters }) => {
    if (!data.sources) return planDraft();
    if (++researchCalls === 1) {
      original = reportDraft(data, 1);
      original.result.nextLeads.indirect.question = original.result.nextLeads.direct.question;
      return original;
    }
    assert.deepEqual(Object.keys(parameters.properties), ['nextLeads']);
    assert.equal(data.canSearch, false);
    assert.equal(data.sources.length, 1);
    assert.equal(data.sources[0].id, 's2');
    assert.equal(data.previousDraft.sourceRanking, undefined);
    assert.match(data.validationIssue, /titles and questions must be distinct/);
    return { nextLeads: leadPair() };
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.deepEqual(result.assessment, original.result.assessment);
  assert.equal(result.materials[0].insight.headline, original.result.evidence.headline);
  assert.equal(result.materials[0].sources[0].url, source(2).url);
  assert.equal(result.nextLeads.length, 2);
  assert.equal(calls.search.length, 1);
  assert.equal(researchCalls, 2);
});

test('structurally valid tool output cannot select weak negative material over stronger direct support', async () => {
  let researchCalls = 0;
  const { service, calls } = fixtures({ retrieve: () => ({ sources: [
    { ...source(1), summary: '转述称白色样本导电，但没有提供测量记录或适用条件。' },
    { ...source(2), summary: '观测范围内所有白色样本均不导电，当前记录未提供导电反例。' },
  ] }), answer: ({ data, parameters }) => {
    if (!data.sources) return planDraft();
    const attempt = ++researchCalls, draft = reportDraft(data, attempt === 1 ? 0 : 1);
    draft.result.sourceRanking.s1.strength = 'weak';
    draft.result.sourceRanking.s2.relation = 'supports';
    if (attempt === 2) {
      assert.ok(parameters.properties.result, 'selecting evidence requires a complete report repair');
      assert.equal(data.sources.length, 2);
      assert.match(data.validationIssue, /highest-ranked usable/);
      draft.result.assessment = { status: 'supported', summary: '更强的直接材料支持原始观点，不能将其改写为反例。' };
      draft.result.evidence.headline = '记录中的白色样本均未导电';
      draft.result.evidence.explanation = '现有直接记录支持观测范围内的原断言。';
      draft.result.finding = '直接记录中的样本均未导电，当前没有可靠反例。';
    }
    return draft;
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.materials[0].sources[0].url, source(2).url);
  assert.equal(result.assessment.status, 'supported');
  assert.equal(calls.search.length, 1);
  assert.equal(researchCalls, 2);
});
