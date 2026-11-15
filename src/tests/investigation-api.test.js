import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createInvestigationService } from '../server/investigation.mjs';
import { createInvestigationModel, parseModelJson } from '../server/model.mjs';
import { createAppServer } from '../server/main.mjs';
import { SearchError } from '../server/search.mjs';
import { createGame, setInvestigationPlan, startResearch, completeLiveResearch } from '../dist/engine.js';

const leads = () => [{ title: '找原始记录', question: '传闻提到的原始观察记录是什么？', reason: '先知道这句话从哪里来。' }, { title: '核对实际条件', question: '这项观察需要哪些实际条件？', reason: '区分观察与推测。' }];
const source = (index, extra = {}) => ({ title: `观察记录 ${index}`, url: `https://source${index}.example/record`, organization: `来源 ${index}`, summary: `第 ${index} 份记录描述了实际条件，尚不能推及所有场景。`, content: '', date: '2026-01-01', ...extra });
const planInput = (extra = {}) => ({ requestId: 'plan-request-00001', claim: '任意传闻需要核查', ...extra });
const researchInput = (plan, extra = {}) => ({ requestId: 'research-request-0001', sessionId: plan.sessionId, roundId: 'round-1', leadId: plan.leads[0].id, gameContext: { reached: 22, truth: 10, exposed: 12, regions: 2, operationPhase: 'preparation', underAttack: false }, ...extra });
const refreshedLeads = () => [{ title: '比较不同样本表现', question: '原传闻在不同地区的独立样本中都成立吗？', reason: '检查能否推广到其他样本。' }, { title: '寻找相反观测', question: '原传闻是否存在可以核对的相反观测？', reason: '检查有无反例。' }];
const refreshInput = (plan, extra = {}) => ({ requestId: 'refresh-request-0001', sessionId: plan.sessionId, roundId: 'round-1', leadIds: plan.leads.map(lead => lead.id), ...extra });
function analysis(data, extra = {}) {
  return { finding: '找到了实际观察记录，仍需注意适用条件。', assessment: { status: 'insufficient', summary: '现有记录不足以支持这个泛化说法。' },
    materials: ['spread', 'persuasion'].map((focus, index) => ({ focus, sourceId: data.sources[index]?.id, headline: `实际记录 ${index + 1}`, explanation: '这是一份需要保留适用范围的观察。', quote: data.sources[index]?.passages[0]?.text,
      effectId: index ? 'explain' : 'relay', effectReason: index ? '把限制讲清楚，有助于观望者理解。' : '简短的原文对照更方便转载。' })),
    recommendation: { focus: 'spread', reason: '还有较多人没听过，先扩大触达。' }, nextLeads: data.round === 5 ? [] : leads(), ...extra };
}
function fixtures({ complete, retrieve, now, timeoutMs, sessionTtlMs } = {}) {
  const calls = { model: [], search: [], diagnostic: [] };
  const model = { configured: true, async complete(input, options) {
    calls.model.push(input);
    const value = complete ? await complete(input, calls.model.length, options) : input.data.sources ? analysis(input.data) : { leads: leads() };
    // Older transport/quote fixtures focus on one malformed field; fill the
    // newly required chain fields without changing their intentionally bad data.
    const design = items => items?.map((lead, index) => ({ routeRole: index ? 'indirect' : 'direct', criterionId: 'c1', searchQuery: lead.question, limitation: '需要核对直接观察。', ...lead }));
    if (Array.isArray(value?.leads)) {
      value.leads = design(value.leads);
      if (value.evidencePlan && !input.data.issuedLeads) value.evidencePlan.proposition = input.data.claim;
      if (!input.data.issuedLeads && value.evidencePlan === undefined) value.evidencePlan = { proposition: input.data.claim, scope: '原命题所述主体与条件。', criteria: [{ question: '原始记录是否支持该观点？', requiredEvidence: '相同条件下的直接记录。', counterEvidence: '相同条件下的直接反例。' }] };
      if (value.evidencePlan) value.evidencePlan = { refutationTarget: '寻找原命题所述条件下的直接反例。', ...value.evidencePlan };
    }
    if (Array.isArray(value?.materials)) {
      if (Array.isArray(value.nextLeads)) value.nextLeads = design(value.nextLeads);
      value.chainAssessment ??= { relation: 'unclear', finding: value.finding || '仍需进一步核查。', unresolved: ['仍需核对适用条件。'], nextCriterionId: 'c1' };
      value.sourceRanking ??= input.data.sources.map(source => ({ sourceId: source.id, relevance: 'direct', strength: 'limited', reason: '材料提供可核对的原始记录。' }));
      value.sourceRanking = value.sourceRanking.map(item => ({ relation: 'context', ...item }));
    }
    return value;
  } };
  const search = { configured: true, async retrieve(query, options) { calls.search.push(query); return retrieve ? retrieve(query, calls.search.length, options) : { requestId: `search-${calls.search.length}`, sources: [source(1), source(2)] }; } };
  return { calls, service: createInvestigationService({ model, search, now, timeoutMs, sessionTtlMs, diagnostic: entry => calls.diagnostic.push(entry) }) };
}
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof SearchError && error.code === code);

function acceptInEngine(plan, result, requestId = 'engine-request-fixture') {
  const game = createGame({ claim: plan.claim, researchMode: 'live', investigationMode: 'agent' }); game.coins = 100;
  assert.equal(setInvestigationPlan(game, plan).ok, true);
  assert.equal(startResearch(game, result.query, { requestId, leadId: result.leadId }).ok, true);
  assert.equal(completeLiveResearch(game, requestId, result).ok, true);
}

test('unusable source URLs are excluded before committing a round the engine must accept', async () => {
  const { service } = fixtures({ retrieve: async () => ({ requestId: 'search-one', sources: [source(0, { url: `https://source.example/${'a'.repeat(2100)}` }), source(1, { content: '原始正文\u0000含控制字符。' }), source(2)] }) });
  const plan = await service.plan(planInput()), input = researchInput(plan), result = await service.research(input);
  assert.equal(result.materials[0].sources[0].url, source(1).url);
  assert.equal(result.materials[0].sources[0].content, '');
  acceptInEngine(plan, result);
  acceptInEngine(plan, await service.research({ ...input, requestId: 'retry-completed-fixture' }));
});

test('investigation preserves optional provider images without letting the model invent one', async () => {
  const { service, calls } = fixtures({
    retrieve: async () => ({ requestId: 'with-picture', sources: [source(1, { imageUrl: 'https://images.example/report.png', imageCaption: '原文中的观测记录' }), source(2, { imageUrl: 'javascript:alert(1)', imageCaption: 'invalid' })] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      const result = analysis(input.data);
      result.materials[1].imageUrl = 'https://invented.example/image.jpg';
      result.materials[1].sources = [{ imageUrl: 'https://invented.example/image.jpg' }];
      return result;
    },
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.materials[0].sources[0].imageUrl, 'https://images.example/report.png');
  assert.equal(result.materials[0].sources[0].imageCaption, '原文中的观测记录');
  assert.equal(result.materials[1].sources[0].imageUrl, undefined);
  assert.equal(result.materials[1].imageUrl, undefined);
  assert.ok(calls.model.at(-1).data.sources.every(source => source.imageUrl === undefined));
  acceptInEngine(plan, result);
});

test('maximum source and result fields remain deliverable after two provider request IDs are joined', async () => {
  let analyses = 0;
  const { service } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `${count}`.repeat(100), sources: [1, 2].map(index => source(index, { title: `${index}${'🧠'.repeat(239)}`, summary: `${index}${'记录中的适用条件。'.repeat(278)}`.slice(0, 2500), content: '正文记录。'.repeat(600), organization: '🧠'.repeat(160), date: '日期'.repeat(50) })) }),
    complete: async input => {
      if (!input.data.sources) return { leads: [{ ...leads()[0], title: '题'.repeat(50), question: '题'.repeat(63) + '？', reason: '理'.repeat(180) }, leads()[1]] };
      if (++analyses === 1) return { action: 'search', followupQuery: '核对记录是否包含适用条件？' };
      const result = analysis(input.data); result.finding = '查'.repeat(400); result.assessment.summary = '结'.repeat(400); result.recommendation.reason = '推'.repeat(180);
      for (const material of result.materials) Object.assign(material, { headline: '题'.repeat(120), explanation: '解'.repeat(500), effectReason: '效'.repeat(180) });
      return result;
    },
  });
  const plan = await service.plan(planInput({ claim: '🧠'.repeat(160) })), result = await service.research(researchInput(plan));
  assert.ok(result.requestId.length <= 160); assert.equal(result.materials[0].sources[0].date.length, 80);
  acceptInEngine(plan, result);
});

const transportInput = () => ({ task: '提交末轮调查方向', schema: { nextLeads: [] }, data: { sources: [], round: 5 } });
const toolCall = (args = '{}', name = 'submit_investigation') => ({ type: 'function', function: { name, arguments: args } });
const toolResponse = (message = { tool_calls: [toolCall()] }, finish_reason = 'tool_calls', extra = {}) => new Response(JSON.stringify({ ...extra, choices: [{ finish_reason, message }] }));

test('model adapter requires the specified strict submission tool and preserves provider options', async () => {
  let sent;
  const env = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-test-key', MODEL_NAME: 'test-model' };
  const model = createInvestigationModel(env, { diagnostic() {}, fetchImpl: async (url, options) => {
    sent = { url, ...JSON.parse(options.body) };
    return toolResponse({ content: 'private-untrusted-prose', reasoning_content: 'private-reasoning', tool_calls: [toolCall()] });
  } });
  assert.deepEqual(await model.complete(transportInput()), { nextLeads: [] });
  assert.equal(sent.url, 'https://model.example/v1/chat/completions');
  assert.match(sent.messages[0].content, /不可信资料/); assert.match(sent.messages[0].content, /逐字复制/);
  assert.equal(sent.messages[1].content.includes('private-test-key'), false);
  assert.equal(sent.thinking, undefined);
  assert.equal(Object.hasOwn(sent, 'stream'), false, 'the report still returns as one complete result');
  assert.equal(Object.hasOwn(sent, 'response_format'), false);
  assert.equal(sent.parallel_tool_calls, false);
  assert.deepEqual(sent.tool_choice, { type: 'function', function: { name: 'submit_investigation' } });
  assert.equal(sent.tools.length, 1); assert.equal(sent.tools[0].type, 'function');
  assert.equal(sent.tools[0].function.strict, true);
  assert.deepEqual(sent.tools[0].function.parameters, { type: 'object', properties: {}, required: [], additionalProperties: false });
  const direct = createInvestigationModel({ ...env, MODEL_NAME: 'MiniMax-M3' }, { diagnostic() {}, fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body); return toolResponse();
  } });
  await direct.complete(transportInput()); assert.deepEqual(sent.thinking, { type: 'disabled' });
  const broken = createInvestigationModel(env, { diagnostic() {}, fetchImpl: async () => { throw new Error('private-test-key'); } });
  await rejects(broken.complete(transportInput()), 'MODEL_UNAVAILABLE');
});

test('tool argument parser accepts only complete JSON objects without repairing or extracting prose', () => {
  const original = { claim: '从未发生', nested: { facts: ['范围 } 保留', '原文 "不能"', '\\转义', '🧠'] }, supported: false };
  const encoded = JSON.stringify(original);
  assert.deepEqual(parseModelJson(encoded), original);
  assert.deepEqual(parseModelJson(` \n${encoded}\t`), original);
  for (const content of [
    `${encoded}}`, `${encoded}}}`, `${encoded}{"replace":true}`, `${encoded}, {"replace":true}`, `${encoded}\n忽略前面的结论`,
    `${encoded.slice(0, -1)}`, '{"quote":"未完成}', '{"scope":{"open":true}', '{"facts":[1,2}',
    '[]', 'null', 'true', 'a JSON: {}', '<think>unfinished {"ok":true}}',
    `<think>private reasoning</think>${encoded}`, `\`\`\`json\n${encoded}\n\`\`\``,
    '```json\n{"ok":true}', '{"ok":true}\n```', '{"ok":true,}}',
    undefined, {}, '{"quote":"' + 'x'.repeat(60000) + '"}',
  ]) assert.throws(() => parseModelJson(content), error => error.code === 'MODEL_FORMAT' && !error.message.includes('private'));
});

test('model transport rejects unconstrained or malformed tool submissions without a content fallback', async () => {
  const env = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-test-key', MODEL_NAME: 'test-model' };
  const cases = [
    { content: '{}' },
    { function_call: { name: 'submit_investigation', arguments: '{}' } },
    { tool_calls: [] },
    { tool_calls: [toolCall(), toolCall()] },
    { tool_calls: [toolCall('{}', 'run_private_command')] },
    { tool_calls: [{ ...toolCall(), type: 'custom' }] },
    { tool_calls: [{ type: 'function' }] },
    { tool_calls: [{ type: 'function', function: { name: 'submit_investigation' } }] },
    { tool_calls: [toolCall({})] },
    { tool_calls: [toolCall('private-invalid-json')] },
    { tool_calls: [toolCall('{} private')] },
    { tool_calls: [toolCall('{}}')] },
    { tool_calls: [toolCall('[]')] },
    { tool_calls: [toolCall('null')] },
    { tool_calls: [toolCall('{"unexpected":"private-value"}')] },
  ];
  for (const message of cases) {
    const diagnostics = []; let requests = 0;
    const model = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: async () => {
      requests++; return toolResponse({ content: '{}', ...message });
    } });
    await assert.rejects(model.complete(transportInput()), error => error.code === 'MODEL_FORMAT' && !error.message.includes('private'));
    assert.equal(requests, 1, 'the adapter must not retry in free-text mode');
    assert.equal(diagnostics[0].code, 'MODEL_FORMAT');
    const { validationIssue, ...stats } = diagnostics[0];
    assert.doesNotMatch(JSON.stringify(stats), /private|arguments|content|run_private_command/);
    if (validationIssue !== undefined) assert.equal(validationIssue, 'arguments: remove unexpected fields; use only the declared properties');
  }
});

test('model transport fills fixed research slots and returns the assembled evidence protocol', async () => {
  let sent;
  const input = {
    task: '核对本轮来源', schema: { evidence: {}, nextLeads: [] },
    data: { round: 5, canSearch: false, sources: [
      { id: 's1', passages: [{ id: 's1-p1', text: '旧原文', previouslyUsed: true }] },
      { id: 's2', passages: [{ id: 's2-p1', text: '新原文' }] },
    ] },
  };
  const first = { relevance: 'indirect', strength: 'limited', relation: 'context', reason: '仅提供背景。' };
  const second = { relevance: 'direct', strength: 'strong', relation: 'contradicts', reason: '提供直接反例。' };
  const filled = { action: 'final', sourceRanking: { s1: first, s2: second }, evidence: { headline: '找到了反例', explanation: '原始记录提供相反观测。', quoteId: 's2-p1' }, finding: '发现反例。', assessment: { status: 'refuted', summary: '原始记录与原说法矛盾。' }, chainAssessment: { unresolved: [] } };
  const model = createInvestigationModel({ MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-key', MODEL_NAME: 'test-model' }, { diagnostic() {}, fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body); return toolResponse({ tool_calls: [toolCall(JSON.stringify({ result: filled }))] });
  } });
  const actual = await model.complete(input);
  assert.deepEqual(actual, { ...filled, sourceRanking: [{ sourceId: 's1', ...first }, { sourceId: 's2', ...second }], nextLeads: [] });
  const resultSchema = sent.tools[0].function.parameters.properties.result;
  assert.deepEqual(resultSchema.properties.sourceRanking.required, ['s1', 's2']);
  assert.deepEqual(resultSchema.properties.evidence.properties.quoteId.enum, ['s2-p1']);
  assert.equal(Object.hasOwn(resultSchema.properties, 'nextLeads'), false);
  assert.equal(Object.hasOwn(resultSchema.properties, 'followupQuery'), false);
  function assertClosed(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, Object.keys(schema.properties));
      Object.values(schema.properties).forEach(assertClosed);
    }
    if (schema.items) assertClosed(schema.items);
    schema.anyOf?.forEach(assertClosed);
  }
  assertClosed(sent.tools[0].function.parameters);
  for (const mutate of [
    value => { delete value.sourceRanking.s1; },
    value => { value.sourceRanking.s3 = first; },
    value => { value.evidence.quoteId = 's1-p1'; },
    value => { value.assessment.status = 'true'; },
    value => { value.nextLeads = []; },
  ]) {
    const invalid = structuredClone(filled); mutate(invalid);
    const bad = createInvestigationModel({ MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-key', MODEL_NAME: 'test-model' }, { diagnostic() {}, fetchImpl: async () => toolResponse({ tool_calls: [toolCall(JSON.stringify({ result: invalid }))] }) });
    await rejects(bad.complete(input), 'MODEL_FORMAT');
  }
});

test('successful tool submissions record only safe timing, usage and structure diagnostics', async () => {
  const diagnostics = [], sent = [], marker = 'private-body-and-credential';
  const env = { MODEL_BASE_URL: `https://${marker}.example/v1`, MODEL_API_KEY: marker, MODEL_NAME: marker };
  const model = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return toolResponse({ content: marker, reasoning_content: marker, tool_calls: [toolCall()] }, 'tool_calls', {
      providerSecret: marker, usage: { prompt_tokens: 125, completion_tokens: 42, private_detail: marker },
    });
  } });
  assert.deepEqual(await model.complete({ ...transportInput(), task: marker }), { nextLeads: [] });
  assert.equal(sent.length, 1);
  const entry = diagnostics[0];
  assert.equal(entry.phase, 'research'); assert.equal(entry.code, 'OK'); assert.equal(entry.structuredOutput, true);
  assert.equal(Object.hasOwn(entry, 'repairedClosingBrace'), false);
  assert.ok(entry.elapsedMs >= 0); assert.ok(entry.requestBytes > 0); assert.ok(entry.responseBytes > 0);
  assert.equal(entry.inputTokens, 125); assert.equal(entry.outputTokens, 42);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-body|providerSecret|quote|MODEL_API|https/);
});

test('model diagnostics preserve truncation, refusal, timeout and malformed-response failures without provider data', async () => {
  const diagnostics = [], env = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-key', MODEL_NAME: 'test-model' };
  const cases = [
    { code: 'MODEL_TRUNCATED', fetchImpl: async () => toolResponse({ tool_calls: [toolCall()] }, 'length', { usage: { prompt_tokens: 'private-tokens', completion_tokens: -1 } }) },
    { code: 'MODEL_REFUSED', fetchImpl: async () => toolResponse({ tool_calls: [toolCall()] }, 'content_filter') },
    { code: 'MODEL_REFUSED', fetchImpl: async () => toolResponse({ refusal: 'private-refusal', tool_calls: [toolCall()] }) },
    { code: 'MODEL_FORMAT', fetchImpl: async () => new Response('private-invalid-json') },
    { code: 'MODEL_LIMIT', fetchImpl: async () => new Response('private-limit-body', { status: 429 }) },
    { code: 'MODEL_UNAVAILABLE', fetchImpl: async () => { throw new Error('private-fetch-error'); } },
  ];
  for (const { code, fetchImpl } of cases) {
    const model = createInvestigationModel(env, { fetchImpl, diagnostic: entry => diagnostics.push(entry) });
    await rejects(model.complete(transportInput()), code);
    assert.equal(diagnostics.at(-1).code, code);
  }
  const controller = new AbortController();
  const late = createInvestigationModel(env, { diagnostic: entry => diagnostics.push(entry), fetchImpl: async () => {
    controller.abort(); return toolResponse();
  } });
  await rejects(late.complete(transportInput(), { signal: controller.signal }), 'MODEL_TIMEOUT');
  assert.equal(diagnostics.at(-1).code, 'MODEL_TIMEOUT');
  assert.equal(diagnostics[0].inputTokens, undefined); assert.equal(diagnostics[0].outputTokens, undefined);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-|content|publications|claim/);
  const noLogger = createInvestigationModel(env, { diagnostic() { throw new Error('private-log-error'); }, fetchImpl: async () => toolResponse() });
  assert.deepEqual(await noLogger.complete(transportInput()), { nextLeads: [] });
});

test('plans preserve the player claim, use two model directions and do not search or judge it in advance', async () => {
  const { service, calls } = fixtures();
  const input = planInput({ claim: '吃胡萝卜可以在黑暗中看清东西' });
  const result = await service.plan(input);
  assert.equal(result.claim, input.claim); assert.equal(result.leads.length, 2); assert.equal(calls.search.length, 0);
  assert.deepEqual(result.leads.map(x => x.id), ['r1-1', 'r1-2']);
  assert.match(calls.model[0].task, /待检验目标，不是既定事实/); assert.equal(result.assessment, undefined);
  await rejects(Promise.resolve().then(() => service.plan(planInput({ claim: 'x' }))), 'INVALID_CLAIM');
  await rejects(Promise.resolve().then(() => service.plan(planInput({ requestId: 'short' }))), 'INVALID_REQUEST');
  result.leads[0].question = 'client mutation';
  assert.notEqual((await service.plan(input)).leads[0].question, result.leads[0].question);
});

test('generic searches execute the selected search terms without prepending the claim and return a separate assessment', async () => {
  const { service, calls } = fixtures();
  const plan = await service.plan(planInput());
  const result = await service.research(researchInput(plan));
  assert.equal(calls.search[0], plan.leads[0].question); assert.doesNotMatch(calls.search[0], /NASA|ESA|长城/);
  assert.equal(result.claim, plan.claim); assert.equal(result.sessionId, plan.sessionId); assert.equal(result.query, plan.leads[0].question);
  assert.deepEqual(result.materials.map(x => x.id), ['photo-spread', 'answer-persuasion']);
  assert.deepEqual(result.materials.map(x => x.effectId), ['relay', 'explain']);
  assert.equal(result.assessment.status, 'insufficient'); assert.equal(result.recommendation.materialId, 'photo-spread');
  assert.equal(result.nextLeads.length, 2);
  for (const material of result.materials) assert.ok(material.sources[0].summary.includes(material.insight.quote));
  assert.equal(result.materials[0].nextQuestion, result.nextLeads[0].question);
});

test('second round requires a genuine selected parent and inherits server-owned evidence', async () => {
  const { service, calls } = fixtures({ retrieve: async (_query, count) => ({ requestId: `search-${count}`, sources: count === 1 ? [source(1), source(2)] : [source(3), source(4)] }) });
  const plan = await service.plan(planInput());
  await rejects(service.research(researchInput(plan, { requestId: 'before-first-round-01', roundId: 'round-2', leadId: 'r2-1', promotedId: 'photo-spread' })), 'MISSING_PARENT');
  const first = await service.research(researchInput(plan));
  await rejects(service.research(researchInput(plan, { requestId: 'invalid-parent-round2', roundId: 'round-2', leadId: 'r2-1', promotedId: 'forged-id' })), 'MISSING_PARENT');
  const second = await service.research(researchInput(plan, { requestId: 'valid-parent-round2', roundId: 'round-2', leadId: first.nextLeads[1].id, promotedId: 'answer-persuasion', previous: { finding: 'client fabrication' } }));
  const history = calls.model.at(-1).data.history;
  assert.equal(history[0].materials.find(material => material.promoted).finding, first.materials[1].insight.explanation);
  assert.equal(history[0].materials.length, 2);
  assert.equal(history[0].materials[1].promoted, true);
  assert.equal(calls.model.at(-1).data.previous, undefined, 'client-supplied ancestry cannot replace server-owned history');
  assert.deepEqual(second.nextLeads.map(lead => lead.id), ['r3-1', 'r3-2']); assert.ok(second.materials.every(x => x.nextQuestion));
  assert.deepEqual(second.materials.map(x => x.id), ['collage-spread', 'conditions-persuasion']);
});

test('second round rejects an entirely repeated pair but allows a new condition from the same article', async () => {
  let newCondition = false;
  const { service } = fixtures({ retrieve: async () => ({ requestId: 'records', sources: [source(1, newCondition ? { summary: '同一篇原文补充了另一个实际观察条件。' } : {}), source(2)] }) });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const input = researchInput(plan, { requestId: 'repeat-second-pair-01', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id });
  await rejects(service.research(input), 'NO_NEW_EVIDENCE');
  newCondition = true;
  const result = await service.research(input);
  assert.equal(result.materials[0].sources[0].url, first.materials[0].sources[0].url);
  assert.notEqual(result.materials[0].insight.quote, first.materials[0].insight.quote);
});

test('repeated evidence is reselected from fresh candidates without another search', async () => {
  let secondRoundCalls = 0;
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `reselect-${count}`, sources: (count === 1 ? [1, 2] : [1, 2, 3, 4]).map(index => source(index)) }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.round === 1) return analysis(input.data);
      const { sources } = input.data;
      for (const item of sources) assert.equal(item.passages[0].previouslyUsed, [source(1).url, source(2).url].includes(item.url));
      if (++secondRoundCalls === 1) return analysis({ ...input.data, sources: [1, 2].map(index => sources.find(item => item.url === source(index).url)) });
      assert.match(input.data.validationIssue, /previouslyUsed=false/);
      assert.ok(input.data.previousDraft.materials.length === 2);
      return analysis({ ...input.data, sources: sources.filter(item => !item.passages[0].previouslyUsed) });
    },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const result = await service.research(researchInput(plan, { requestId: 'reselect-round-two', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id }));
  assert.deepEqual(result.materials.map(item => item.sources[0].url), [source(3).url, source(4).url]);
  assert.equal(secondRoundCalls, 2); assert.equal(calls.search.length, 2); assert.deepEqual(calls.diagnostic, []);
});

test('repeated evidence can trigger one targeted followup within three analysis calls', async () => {
  let secondRoundCalls = 0;
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `followup-${count}`, sources: (count < 3 ? [1, 2] : [3, 4]).map(index => source(index)) }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.round === 1) return analysis(input.data);
      secondRoundCalls++;
      if (secondRoundCalls === 2) {
        assert.match(input.data.validationIssue, /selected evidence was already used/);
        assert.equal(input.data.canSearch, true);
        assert.ok(input.data.sources.every(item => item.passages.every(passage => passage.previouslyUsed)));
        return { action: 'search', followupQuery: '独立观察是否记录了其他适用条件？' };
      }
      if (secondRoundCalls === 3) assert.equal(input.data.canSearch, false);
      return analysis(input.data);
    },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const result = await service.research(researchInput(plan, { requestId: 'repeat-targeted-followup', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id }));
  assert.equal(secondRoundCalls, 3); assert.equal(calls.search.length, 3, 'one first-round search and two second-round searches');
  assert.notEqual(calls.search[1], calls.search[2]); assert.match(calls.search[2], /独立观察/);
  assert.deepEqual(result.materials.map(item => item.sources[0].url), [source(3).url, source(4).url]);
  assert.deepEqual(calls.diagnostic, []);
});

test('exhausted evidence reselection logs a safe diagnostic and does not advance the failed round', async () => {
  let fresh = false, secondRoundCalls = 0;
  const { service, calls } = fixtures({
    retrieve: async () => ({ requestId: 'private-provider-marker', sources: (fresh ? [3, 4] : [1, 2]).map(index => source(index)) }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.round === 2) secondRoundCalls++;
      return analysis(input.data, { privateReasoning: 'private-draft-marker' });
    },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const input = researchInput(plan, { requestId: 'repeat-exhausted-round', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id });
  await rejects(service.research(input), 'NO_NEW_EVIDENCE');
  assert.equal(secondRoundCalls, 2, 'the same failed reselection is not repeated with unchanged sources'); assert.equal(calls.search.length, 2);
  assert.equal(calls.diagnostic.length, 1);
  assert.equal(calls.diagnostic[0].round, 'round-2'); assert.equal(calls.diagnostic[0].code, 'NO_NEW_EVIDENCE');
  assert.match(calls.diagnostic[0].validationIssue, /previouslyUsed=false/);
  assert.doesNotMatch(JSON.stringify(calls.diagnostic), /private-|实际观察|example/);
  assert.equal(service.progress(input).status, 'failed');
  await rejects(service.research({ ...input, requestId: 'after-failed-round-three', roundId: 'round-3', leadId: 'r3-1' }), 'MISSING_PARENT');
  fresh = true;
  const result = await service.research(input);
  assert.equal(calls.model.at(-1).data.history.length, 1);
  assert.deepEqual(result.nextLeads.map(item => item.id), ['r3-1', 'r3-2']);
  assert.equal(calls.diagnostic.length, 1);
});

test('fifth-round fresh hits ranked ninth and tenth remain visible after eight earlier sources were used', async () => {
  const { service, calls } = fixtures({ retrieve: async (_query, count) => ({ requestId: `ranked-${count}`, sources: (count < 5 ? [count * 2 - 1, count * 2] : Array.from({ length: 10 }, (_, index) => index + 1)).map(index => source(index)) }) });
  const plan = await service.plan(planInput()); let previous;
  for (let round = 1; round <= 5; round++) previous = await service.research(researchInput(plan, { requestId: `ranked-round-${round}-request`, roundId: `round-${round}`, leadId: `r${round}-1`, promotedId: previous?.materials[0].id }));
  const seen = calls.model.at(-1).data.sources;
  assert.equal(seen.length, 10);
  assert.deepEqual(seen.slice(0, 2).map(item => item.id), ['s9', 's10']);
  assert.ok(seen.slice(0, 2).every(item => !item.passages[0].previouslyUsed));
  assert.ok(seen.slice(2).every(item => item.passages[0].previouslyUsed));
  assert.deepEqual(previous.materials.map(item => item.sources[0].url), [source(9).url, source(10).url]);
  assert.equal(calls.search.length, 5); assert.equal(calls.model.length, 6); assert.deepEqual(previous.nextLeads, []);
});

test('a tactical recommendation of old evidence is superseded by a ranked fresh candidate', async () => {
  let secondRoundCalls = 0;
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `recommend-${count}`, sources: [source(1), source(count === 1 ? 2 : 3)] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.round === 1) return analysis(input.data);
      secondRoundCalls++;
      const result = analysis({ ...input.data, sources: [1, 3].map(index => input.data.sources.find(item => item.url === source(index).url)) });
      if (secondRoundCalls > 1) {
        assert.match(input.data.validationIssue, /recommendation/);
        result.recommendation.focus = 'persuasion';
      }
      return result;
    },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const result = await service.research(researchInput(plan, { requestId: 'recommend-new-evidence', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id }));
  assert.equal(secondRoundCalls, 1); assert.equal(calls.search.length, 2);
  const recommended = result.materials.find(item => item.id === result.recommendation.materialId);
  assert.equal(recommended.sources[0].url, source(3).url);
});

test('targeted searches replace same-URL excerpts verbatim even when the source pool is full', async () => {
  for (const capacity of [2, 16]) {
    const summary = '新条件：这项观察只在日落后进行，白天结果尚未确认。';
    const originalContent = '原文记载了样本的筛选标准。', replacementContent = '补查正文记载了日落后的观测时段。';
    const { service, calls } = fixtures({
      retrieve: async (_query, count) => ({ requestId: `same-url-${count}`, sources: count === 3
        ? [source(1, { summary, content: capacity === 16 ? replacementContent : '' })]
        : Array.from({ length: count === 1 ? 2 : capacity }, (_, index) => source(index + 1, index === 0 ? { content: originalContent } : {})) }),
      complete: async input => {
        if (!input.data.sources) return { leads: leads() };
        if (input.data.round === 2 && input.data.searches.length === 1) return { action: 'search', followupQuery: '原记录是否注明了观察时段和适用条件？' };
        if (input.data.round === 1) return analysis(input.data);
        const updated = input.data.sources.find(item => item.url === source(1).url);
        assert.equal(updated.id, 's1'); assert.equal(updated.passages[0].text, summary); assert.equal(updated.passages[0].previouslyUsed, false);
        const result = analysis({ ...input.data, sources: [updated, input.data.sources.find(item => item.id !== updated.id)] });
        result.materials[0].quoteId = updated.passages[0].id; delete result.materials[0].sourceId; delete result.materials[0].quote;
        return result;
      },
    });
    const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
    const result = await service.research(researchInput(plan, { requestId: `same-url-capacity-${capacity}`, roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id }));
    assert.equal(result.materials[0].sources[0].url, first.materials[0].sources[0].url);
    assert.equal(result.materials[0].sources[0].summary, summary); assert.equal(result.materials[0].insight.quote, summary);
    assert.equal(result.materials[0].sources[0].content, capacity === 16 ? replacementContent : originalContent);
    assert.equal(calls.search.length, 3); assert.equal(calls.model.length, 4);
  }
});

test('same-URL followups retain new complete body sentences when the summary is unchanged or exceeds the passage budget', async () => {
  for (const repeats of [1, 70]) {
    const summary = '既有记录说明样本来自同一地区。'.repeat(repeats);
    const newSentence = `在${'严格限定的观察条件下反复取样并对照'.repeat(28)}，研究仍未证实这种影响适用于其他地区。`;
    assert.ok(newSentence.length > 450 && newSentence.length <= 800);
    const content = summary + newSentence;
    const { service, calls } = fixtures({
      retrieve: async (_query, count) => ({ requestId: `new-body-${count}`, sources: [source(1, { summary, content: count === 3 ? content : '' }), source(2)] }),
      complete: async input => {
        if (!input.data.sources) return { leads: leads() };
        if (input.data.round === 1) return analysis(input.data);
        if (input.data.searches.length === 1) return { action: 'search', followupQuery: '原文是否提供了其他地区的独立观察？' };
        const updated = input.data.sources.find(item => item.url === source(1).url);
        const newPassage = updated.passages.find(passage => passage.text.includes(newSentence));
        assert.ok(newPassage, 'the complete new sentence including its final negation must reach the model');
        assert.equal(newPassage.previouslyUsed, false);
        assert.ok(updated.passages.some(passage => summary.includes(passage.text)), 'retain some summary context');
        assert.ok(updated.passages.reduce((sum, passage) => sum + passage.text.length, 0) <= 900);
        for (const passage of updated.passages) {
          assert.ok([summary, content].some(body => body.includes(passage.text)), 'every passage must be verbatim');
          assert.match(passage.text, /。$/);
        }
        const result = analysis({ ...input.data, sources: [updated, input.data.sources.find(item => item.id !== updated.id)] });
        result.materials[0].quoteId = newPassage.id; delete result.materials[0].sourceId; delete result.materials[0].quote;
        return result;
      },
    });
    const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
    const result = await service.research(researchInput(plan, { requestId: `new-body-summary-${repeats}`, roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id }));
    assert.equal(result.materials[0].sources[0].summary, summary);
    assert.ok(result.materials[0].insight.quote.includes(newSentence));
    assert.match(result.materials[0].insight.quote, /仍未证实这种影响适用于其他地区。$/);
    assert.equal(calls.search.length, 3); assert.equal(calls.model.length, 4);
  }
});

test('deduplicating summary sentences never joins separated body excerpts or removes a sentence-ending negation', async () => {
  const summary = '此前的观察仅在小样本内开展。';
  const firstNew = '独立记录增加了一个未纳入此前研究的地区。';
  const secondNew = '新地区的记录没有复现此前的变化，也不能据此证明原传闻成立。';
  const content = firstNew + summary + secondNew;
  const { service, calls } = fixtures({ retrieve: async () => ({ requestId: 'interleaved-body', sources: [source(1, { summary, content }), source(2)] }) });
  const plan = await service.plan(planInput());
  await service.research(researchInput(plan));
  const passages = calls.model.at(-1).data.sources.find(item => item.url === source(1).url).passages;
  assert.ok(passages.some(passage => passage.text.includes(firstNew)));
  assert.ok(passages.some(passage => passage.text.includes(secondNew)));
  assert.ok(passages.reduce((sum, passage) => sum + passage.text.length, 0) <= 900);
  for (const passage of passages) {
    assert.ok([summary, content].some(body => body.includes(passage.text)), 'deduplication cannot synthesize a non-contiguous quotation');
    assert.match(passage.text, /。$/);
  }
});

test('five investigations inherit the immediate selection and retain all previous judgments without rebilling retries', async () => {
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `search-${count}`, sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      const result = analysis(input.data);
      result.finding = `第${input.data.round}轮核查了新的条件。`;
      result.materials.forEach(material => { material.explanation = `第${input.data.round}轮的${material.focus}材料。`; });
      return result;
    },
  });
  const plan = await service.plan(planInput()), results = [], inputs = [];
  for (let round = 1; round <= 5; round++) {
    const previous = results.at(-1);
    const promotedId = previous?.materials[round % 2].id;
    const input = researchInput(plan, { requestId: `full-chain-round-${round}`, roundId: `round-${round}`, leadId: `r${round}-1`, promotedId });
    if (round > 2) await rejects(service.research({ ...input, requestId: `wrong-ancestor-round-${round}`, promotedId: results[0].materials[0].id }), 'MISSING_PARENT');
    const result = await service.research(input), data = calls.model.at(-1).data;
    const priorMaterials = data.history.flatMap(item => item.materials);
    assert.equal(priorMaterials.length, (round - 1) * 2);
    assert.equal(data.history.length, round - 1);
    assert.equal(priorMaterials.filter(material => material.promoted).length, round - 1);
    if (previous) {
      const parent = data.history.at(-1).materials.find(material => material.promoted);
      assert.equal(parent.finding, previous.materials.find(material => material.id === promotedId).finding);
      assert.deepEqual(data.history.at(-1).assessment, previous.assessment);
      assert.equal(result.investigation.previousFinding, parent.finding);
    }
    assert.deepEqual(result.nextLeads.map(lead => lead.id), round < 5 ? [`r${round + 1}-1`, `r${round + 1}-2`] : []);
    assert.ok(result.materials.every(material => round < 5 ? material.nextQuestion : material.nextQuestion === null));
    results.push(result); inputs.push(input);
    assert.deepEqual(await service.research({ ...input, requestId: `full-chain-replay-${round}` }), result);
  }
  assert.equal(calls.search.length, 5); assert.equal(calls.model.length, 6);
  assert.equal(results[4].assessment.status, 'insufficient', 'using all five opportunities must not manufacture certainty');
  assert.deepEqual(await service.research({ ...inputs[1], requestId: 'early-round-replay-after-end' }), results[1]);
  await rejects(Promise.resolve().then(() => service.research({ ...inputs[4], roundId: 'round-6', requestId: 'sixth-round-not-allowed' })), 'INVALID_REQUEST');
  assert.equal(calls.search.length, 5);
});

test('later rounds reject evidence reused from any earlier round and a failed request can retry with a new condition', async () => {
  let retryWithNewCondition = false;
  const { service, calls } = fixtures({ retrieve: async (_query, count) => ({ requestId: `history-${count}`, sources: count <= 3 ? [source(count * 2 - 1), source(count * 2)] : [source(1, retryWithNewCondition ? { summary: '原记录中的新条件：这次观察只在日落后开展。' } : {}), source(2)] }) });
  const plan = await service.plan(planInput()); let previous;
  for (let round = 1; round <= 3; round++) previous = await service.research(researchInput(plan, { requestId: `history-round-${round}-request`, roundId: `round-${round}`, leadId: `r${round}-1`, promotedId: previous?.materials[0].id }));
  const input = researchInput(plan, { requestId: 'history-round-4-retry', roundId: 'round-4', leadId: 'r4-1', promotedId: previous.materials[1].id });
  await rejects(service.research(input), 'NO_NEW_EVIDENCE');
  retryWithNewCondition = true;
  const result = await service.research(input);
  assert.match(result.materials[0].insight.quote, /新条件/);
  assert.equal(calls.model.at(-1).data.history.length, 3, 'a rejected round never enters history');
  assert.deepEqual(result.nextLeads.map(lead => lead.id), ['r5-1', 'r5-2']);
});

test('a final-round extra lead is repaired without another search or a fictitious sixth opportunity', async () => {
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `final-${count}`, sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.round === 5 && !input.data.validationIssue) return analysis(input.data, { nextLeads: leads() });
      if (input.data.round === 5) {
        assert.match(input.data.validationIssue, /final round requires an empty array/);
        assert.deepEqual(input.schema.nextLeads, []);
      }
      return analysis(input.data);
    },
  });
  const plan = await service.plan(planInput()); let previous;
  for (let round = 1; round <= 5; round++) previous = await service.research(researchInput(plan, { requestId: `final-round-${round}-request`, roundId: `round-${round}`, leadId: `r${round}-1`, promotedId: previous?.materials[0].id }));
  assert.deepEqual(previous.nextLeads, []);
  assert.equal(calls.search.length, 5); assert.equal(calls.model.length, 7);
});

test('round four repairs independent direction and card errors together in one call', async () => {
  let fourthRoundCalls = 0;
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `repair-${count}`, sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.round !== 4) return analysis(input.data);
      fourthRoundCalls++;
      if (fourthRoundCalls === 1) {
        const draft = analysis(input.data, { nextLeads: leads().slice(0, 1) });
        draft.materials[0].effectId = 'explain';
        return draft;
      }
      const draft = structuredClone(input.data.previousDraft);
      assert.match(input.data.validationIssue, /nextLeads: exactly 2/);
      assert.match(input.data.validationIssue, /materials.spread.effectId/);
      draft.nextLeads = leads();
      draft.materials[0].effectId = 'relay';
      return draft;
    },
  });
  const plan = await service.plan(planInput()); let previous;
  for (let round = 1; round <= 5; round++) previous = await service.research(researchInput(plan, {
    requestId: `two-field-repair-round-${round}`, roundId: `round-${round}`, leadId: `r${round}-1`, promotedId: previous?.materials[0].id,
  }));
  assert.equal(fourthRoundCalls, 2);
  assert.equal(calls.search.length, 5, 'only one retrieval per round, including the repaired fourth round');
  assert.equal(calls.model.length, 7);
  assert.deepEqual(calls.diagnostic, []);
  assert.equal(previous.assessment.status, 'insufficient');
  assert.deepEqual(previous.nextLeads, []);
});

test('exhausted format repairs log only server-owned field constraints and leave the round retryable', async () => {
  let broken = true;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    const result = analysis(input.data);
    if (broken) { result.materials[0].headline = ''; result.privateThought = 'private-draft-marker'; }
    return result;
  } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await assert.rejects(service.research(input), error => error.code === 'INVESTIGATION_FORMAT' && /资料已找到/.test(error.message));
  assert.equal(calls.model.length, 3, 'plan plus one judgment and one unsuccessful repair of the same field');
  assert.equal(calls.search.length, 1, 'format repairs reuse the retrieved sources');
  assert.deepEqual(calls.diagnostic, [{ round: 'round-1', code: 'INVESTIGATION_FORMAT', validationIssue: 'materials.spread.headline: 1-120 characters' }]);
  assert.doesNotMatch(JSON.stringify(calls.diagnostic), /private-draft-marker|实际观察|example/);
  broken = false;
  assert.equal((await service.research(input)).materials.length, 2);
  assert.equal(calls.diagnostic.length, 1);
  const untrusted = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    const error = new SearchError('INVESTIGATION_FORMAT', 'provider-private-message');
    error.validationIssue = 'provider-private-field'; throw error;
  } });
  const otherPlan = await untrusted.service.plan(planInput());
  await rejects(untrusted.service.research(researchInput(otherPlan)), 'INVESTIGATION_FORMAT');
  assert.deepEqual(untrusted.calls.diagnostic, [], 'provider-created validation fields must not be logged or echoed into a repair');
});

test('one bounded followup can fill a source gap without hardcoded websites', async () => {
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `search-${count}`, sources: count === 1 ? [source(1)] : [source(2)] }),
    complete: async input => !input.data.sources ? { leads: leads() } : input.data.sources.length < 2 ? { followupQuery: '找到另一份原始观察记录' } : analysis(input.data),
  });
  const plan = await service.plan(planInput());
  const result = await service.research(researchInput(plan));
  assert.deepEqual(calls.search, [plan.leads[0].question, '找到另一份原始观察记录']);
  assert.equal(calls.model.length, 3); assert.match(result.searchQuery, /另一份原始观察记录/);
  assert.equal(result.materials[1].sources[0].url, source(2).url);
});

test('a malformed search request can be repaired before spending the remaining search budget', async () => {
  let analyses = 0;
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `search-${count}`, sources: [source(count)] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (++analyses === 1) return { action: 'search' };
      if (analyses === 2) { assert.equal(input.data.canSearch, true); assert.match(input.data.validationIssue, /followupQuery/); return { action: 'search', followupQuery: '有哪些独立记录能核对实际条件？' }; }
      return analysis(input.data, { action: 'final' });
    },
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.materials.length, 2); assert.equal(calls.search.length, 2); assert.equal(analyses, 3);
});

test('query repair and a followup still leave one final same-source repair, with four calls as a hard ceiling', async () => {
  for (const repairFinal of [true, false]) {
    let analyses = 0;
    const followup = '同样条件下是否有另一份独立观测记录？';
    const { service, calls } = fixtures({ complete: async input => {
      if (!input.data.sources) return chainPlan();
      analyses++;
      if (analyses === 1) return { action: 'search', followupQuery: '长'.repeat(65) };
      if (analyses === 2) {
        assert.match(input.data.validationIssue, /followupQuery/);
        assert.equal(input.data.canSearch, true);
        return { action: 'search', followupQuery: followup };
      }
      assert.equal(input.data.canSearch, false, 'no further retrieval is available during final report repairs');
      if (analyses === 4) {
        assert.match(input.data.validationIssue, /materials\.persuasion\.quoteId: choose two different sources/);
        assert.equal(input.data.previousDraft.materials[0].quoteId, input.data.previousDraft.materials[1].quoteId);
      }
      const result = analysis(input.data);
      result.materials.forEach((material, index) => {
        material.quoteId = input.data.sources[analyses === 4 && repairFinal ? index : 0].passages[0].id;
        delete material.sourceId; delete material.quote;
      });
      return result;
    } });
    const plan = await service.plan(planInput()), input = researchInput(plan);
    if (repairFinal) {
      const result = await service.research(input);
      assert.notEqual(result.materials[0].sources[0].url, result.materials[1].sources[0].url);
      assert.equal(service.progress(input).status, 'completed');
      assert.deepEqual(calls.diagnostic, []);
      acceptInEngine(plan, result);
    } else {
      await rejects(service.research(input), 'INVESTIGATION_FORMAT');
      assert.equal(service.progress(input).status, 'failed');
      assert.equal(calls.diagnostic.length, 1);
    }
    assert.equal(analyses, 4);
    assert.deepEqual(calls.search, [plan.leads[0].question, followup]);
    assert.equal(calls.model.filter(call => call.data.sources).length, 4, 'a persistently invalid final report cannot cause an unbounded repair loop');
  }
});

test('sources without quotable passages do not hide later usable hits within the context budget', async () => {
  const { service, calls } = fixtures({ retrieve: async () => ({ requestId: 'search-one', sources: Array.from({ length: 10 }, (_, index) => source(index + 1, index < 8 ? { summary: `${index + 1}：${'无句号的连续文本'.repeat(140)}` } : {})) }) });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.materials.length, 2); assert.equal(calls.search.length, 1);
  assert.deepEqual(calls.model.at(-1).data.sources.map(item => item.id), ['s9', 's10']);
});

test('analysis context bounds verbatim passages and includes results from a targeted followup', async () => {
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `search-${count}`, sources: Array.from({ length: 8 }, (_, index) => source((count - 1) * 8 + index + 1, { summary: `${count}-${index}：${'原始记录中的范围和条件。'.repeat(100)}`, content: '原文正文。'.repeat(300) })) }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (input.data.searches.length === 1) return { followupQuery: '核对原始观察中的限制条件' };
      const result = analysis(input.data); result.materials.forEach(material => { material.quote = material.quote.slice(0, 160); }); return result;
    },
  });
  const plan = await service.plan(planInput());
  const result = await service.research(researchInput(plan));
  const seen = calls.model.at(-1).data.sources;
  assert.equal(seen.length, 16);
  assert.ok(seen.some(item => item.id === 's16'));
  assert.ok(seen.every(item => item.passages.reduce((sum, passage) => sum + passage.text.length, 0) <= 900));
  assert.ok(result.materials[0].sources[0].summary.includes(seen[0].passages[0].text));
  assert.equal(calls.model.at(-1).data.effects, undefined, 'model evidence analysis does not receive game effects');
});

test('in-flight and completed research retries do not re-bill; changed choices cannot overwrite a round', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixtures({ retrieve: async () => { await gate; return { requestId: 'search-one', sources: [source(1), source(2)] }; } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  const one = service.research(input), duplicate = service.research(input);
  await new Promise(resolve => setImmediate(resolve));
  await rejects(service.research({ ...input, requestId: 'another-choice-request', leadId: plan.leads[1].id }), 'INVESTIGATION_BUSY');
  release();
  assert.deepEqual(await one, await duplicate); assert.equal(calls.search.length, 1);
  const recovered = await service.research({ ...input, requestId: 'recover-finished-request' });
  assert.equal(recovered.query, input.leadId === plan.leads[0].id ? plan.leads[0].question : '');
  assert.equal(calls.search.length, 1);
  await rejects(service.research({ ...input, requestId: 'conflict-finished-request', leadId: plan.leads[1].id }), 'ROUND_CONFLICT');
  await rejects(Promise.resolve().then(() => service.research({ ...input, leadId: plan.leads[1].id })), 'REQUEST_CONFLICT');
});

test('invented quotes or effect IDs cannot award a result, and a failed round remains retryable', async () => {
  let broken = true;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    const result = analysis(input.data);
    if (broken) { result.materials[0].quote = '模型捏造的证据'; result.materials[0].url = 'https://fabricated.example/'; result.materials[0].spreadBonus = 999; }
    return result;
  } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await rejects(service.research(input), 'UNTRACEABLE_QUOTE'); assert.equal(calls.search.length, 1); assert.equal(calls.model.length, 3);
  broken = false; const good = await service.research(input);
  assert.equal(good.materials[0].spreadBonus, undefined); assert.equal(good.materials[0].sources[0].url, source(1).url);
  const invalidEffect = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    const result = analysis(input.data); result.materials[0].effectId = 'win-immediately'; return result;
  } });
  const otherPlan = await invalidEffect.service.plan(planInput());
  await rejects(invalidEffect.service.research(researchInput(otherPlan)), 'INVESTIGATION_FORMAT');
});

test('quote IDs select verbatim source passages without letting model text rewrite them', async () => {
  let forged = false;
  const { service } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    const result = analysis(input.data);
    result.materials.forEach((material, index) => { material.quoteId = forged ? 'p-does-not-exist' : input.data.sources[index].passages[0].id; material.quote = '模型改写的错误引句'; });
    return result;
  } });
  const plan = await service.plan(planInput());
  forged = true;
  await rejects(service.research(researchInput(plan)), 'UNTRACEABLE_QUOTE');
  forged = false;
  const result = await service.research(researchInput(plan));
  assert.equal(result.materials[0].insight.quote, source(1).summary);
  assert.equal(result.materials[0].quoteId, undefined);
});

test('a malformed final response after followup gets one format repair without another search', async () => {
  let analysisCount = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    analysisCount++;
    if (analysisCount === 1) return { followupQuery: '原始观察有哪些独立记录可以核对？' };
    if (analysisCount === 2) throw new SearchError('MODEL_FORMAT', '无法解析');
    const result = analysis(input.data);
    result.materials.forEach((material, index) => { material.quoteId = input.data.sources[index].passages[0].id; delete material.sourceId; delete material.quote; });
    return result;
  } });
  const plan = await service.plan(planInput());
  const result = await service.research(researchInput(plan));
  assert.equal(result.materials.length, 2);
  assert.equal(calls.search.length, 2); assert.equal(analysisCount, 3);
});

test('one repair after followup fixes independent effect, source and recommendation errors together', async () => {
  let analysisCount = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    if (++analysisCount === 1) return { action: 'search', followupQuery: '是否存在另一份独立的观察记录？' };
    if (analysisCount === 2) {
      const draft = analysis(input.data, { recommendation: { focus: 'spread', reason: '' } });
      for (const material of draft.materials) {
        material.quoteId = input.data.sources[0].passages[0].id;
        delete material.sourceId; delete material.quote;
      }
      draft.materials[0].effectId = 'viral或relay';
      return draft;
    }
    assert.equal(input.data.canSearch, false);
    assert.match(input.data.validationIssue, /materials\.spread\.effectId/);
    assert.match(input.data.validationIssue, /materials\.persuasion\.quoteId: choose two different sources/);
    assert.ok(input.data.validationIssue.includes(input.data.sources[1].passages[0].id), 'offer a concrete alternative passage');
    assert.match(input.data.validationIssue, /recommendation\.reason/);
    const repaired = structuredClone(input.data.previousDraft);
    repaired.materials[0].effectId = 'relay';
    repaired.materials[1].quoteId = input.data.sources[1].passages[0].id;
    repaired.recommendation.reason = '让更多人看到可核对的原始记录。';
    return repaired;
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(analysisCount, 3); assert.equal(calls.search.length, 2); assert.deepEqual(calls.diagnostic, []);
  assert.equal(result.materials[0].effectId, 'relay');
  assert.notEqual(result.materials[0].sources[0].url, result.materials[1].sources[0].url);
  assert.ok(result.recommendation.reason);
  acceptInEngine(plan, result);
});

test('missing sources cannot cause an unbounded search loop or fabricated source URLs', async () => {
  const { service, calls } = fixtures({ retrieve: async () => ({ requestId: 'none', sources: [] }), complete: async input => !input.data.sources ? { leads: leads() } : { followupQuery: '仍缺另一份观察记录' } });
  const plan = await service.plan(planInput());
  await rejects(service.research(researchInput(plan)), 'INSUFFICIENT_SOURCES');
  assert.equal(calls.search.length, 2); assert.equal(calls.model.length, 2);
});

test('a complete insufficient result is not discarded because a legacy followup field remains', async () => {
  let analysisCount = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    if (++analysisCount === 1) return { action: 'search', followupQuery: '该研究是否包含直接观察数据？' };
    return analysis(input.data, { followupQuery: '仍需查看更长时间的观察记录' });
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.assessment.status, 'insufficient'); assert.equal(result.materials.length, 2);
  assert.equal(calls.search.length, 2); assert.equal(analysisCount, 2);
  assert.equal(calls.model.at(-1).data.canSearch, false); assert.equal(calls.model.at(-1).data.round, 1);
});

test('complete final materials with a leftover query do not trigger another paid search', async () => {
  const { service, calls } = fixtures({ complete: async input => !input.data.sources ? { leads: leads() } : analysis(input.data, { followupQuery: '还有哪些独立记录？' }) });
  const plan = await service.plan(planInput());
  assert.equal((await service.research(researchInput(plan))).materials.length, 2);
  assert.equal(calls.search.length, 1); assert.equal(calls.model.length, 2);
});

test('a missing next lead is repaired with its exact field and the existing grounded draft', async () => {
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    if (!input.data.validationIssue) return analysis(input.data, { nextLeads: leads().slice(0, 1) });
    assert.match(input.data.validationIssue, /nextLeads: exactly 2/);
    assert.equal(input.data.previousDraft.nextLeads.length, 1);
    assert.equal(input.schema.nextLeads.length, 2);
    return { ...input.data.previousDraft, nextLeads: leads() };
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.nextLeads.length, 2); assert.equal(calls.search.length, 1);
});

test('a late search-only response is repaired into an honest final answer without a third search', async () => {
  let analysisCount = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    analysisCount++;
    if (analysisCount < 3) return { action: 'search', followupQuery: analysisCount === 1 ? '该说法有哪些原始记录？' : '还有哪些独立观察记录？' };
    assert.equal(input.data.canSearch, false); assert.match(input.data.validationIssue, /search is closed/);
    return analysis(input.data, { action: 'final' });
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.assessment.status, 'insufficient'); assert.equal(analysisCount, 3); assert.equal(calls.search.length, 2);
});

test('standalone initial and followup searches retain their terms while the original claim stays in model context', async () => {
  let analysisCount = 0;
  const claim = '某类新型视频对生理指标的影响是否存在独立因果证据'.repeat(3);
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: [{ ...leads()[0], question: '该研究是否直接测量了实际变化？' }, leads()[1]] };
    if (++analysisCount === 1) return { action: 'search', followupQuery: '原始资料中是否区分了相关性和因果性？' };
    return analysis(input.data, { action: 'final' });
  } });
  const plan = await service.plan(planInput({ claim })), result = await service.research(researchInput(plan));
  assert.deepEqual(calls.search, [plan.leads[0].question, '原始资料中是否区分了相关性和因果性？']);
  for (const query of calls.search) assert.ok([...query].length <= 64);
  for (const call of calls.model) assert.equal(call.data.claim, claim);
  assert.equal(result.query, plan.leads[0].question); assert.equal(result.claim, claim);
});

test('long multilingual queries keep their full final condition without splitting emoji', async () => {
  const question = '🧠'.repeat(50) + '是否只适用于特定年龄的人群？';
  const claim = '长期观看某类内容是否产生影响'.repeat(8);
  const { service, calls } = fixtures({ complete: async input => !input.data.sources ? { leads: [{ ...leads()[0], question }, leads()[1]] } : analysis(input.data) });
  const plan = await service.plan(planInput({ claim }));
  await service.research(researchInput(plan, { leadId: plan.leads.find(lead => lead.question === question).id }));
  assert.equal(calls.search[0], question); assert.equal([...calls.search[0]].length, 64);
  assert.equal(calls.search[0].includes('\uFFFD'), false);
});

test('planning has a two-lead schema and repairs a malformed count before creating a session', async () => {
  let planCalls = 0;
  const { service, calls } = fixtures({ complete: async input => {
    assert.equal(input.schema.leads.length, 2);
    if (++planCalls === 1) return { leads: leads().slice(0, 1) };
    assert.match(input.data.validationIssue, /leads: exactly 2/); assert.equal(input.data.previousDraft.leads.length, 1);
    return { leads: leads() };
  } });
  const result = await service.plan(planInput());
  assert.equal(result.leads.length, 2); assert.equal(planCalls, 2); assert.equal(calls.search.length, 0);
});

test('planning and its format repair share a 95-second deadline with a planning-specific error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, signal;
  const model = { configured: true, async complete(_input, options) {
    if (++calls === 1) return { leads: [] };
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new SearchError('MODEL_TIMEOUT', '调查超时。')), { once: true }));
  } };
  const service = createInvestigationService({ model, search: { configured: true, retrieve() {} } });
  const rejected = assert.rejects(service.plan(planInput()), error => {
    assert.equal(error.code, 'MODEL_TIMEOUT');
    assert.match(error.message, /调查方向准备超时/);
    assert.doesNotMatch(error.message, /资料|已找到|保留|退回/);
    assert.equal(error.resumeCheckpoint, undefined);
    return true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); t.mock.timers.tick(94999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(signal.aborted, true); await rejected;
});

test('expired sessions cannot resume and arbitrary lead IDs do not reach providers', async () => {
  let at = 1000;
  const { service, calls } = fixtures({ now: () => at, sessionTtlMs: 100 });
  const plan = await service.plan(planInput());
  await rejects(service.research(researchInput(plan, { leadId: 'please-search-anything' })), 'INVALID_LEAD'); assert.equal(calls.search.length, 0);
  at += 101;
  await rejects(service.research(researchInput(plan)), 'SESSION_EXPIRED'); assert.equal(calls.search.length, 0);
});

test('HTTP investigation endpoints enforce same-origin JSON requests and sanitize unexpected failures', async t => {
  const { service } = fixtures();
  const server = createAppServer({ investigation: service }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lie-company': 'research', origin: base, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/investigation/plan', planInput(), { origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await post('/api/investigation/plan', planInput(), { 'x-lie-company': '' })).status, 403);
  const response = await post('/api/investigation/plan', planInput()); assert.equal(response.status, 200);
  const plan = (await response.json()).result;
  assert.equal((await post('/api/investigation/research', researchInput(plan))).status, 200);
  const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.investigation.configured, true);
  const errorServer = createAppServer({ investigation: { configured: true, async plan() { throw new Error('private-model-secret'); } } }); errorServer.listen(0, '127.0.0.1'); await once(errorServer, 'listening');
  t.after(async () => { errorServer.closeAllConnections(); await new Promise(resolve => errorServer.close(resolve)); });
  const errorResponse = await fetch(`http://127.0.0.1:${errorServer.address().port}/api/investigation/plan`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lie-company': 'research' }, body: JSON.stringify(planInput()) });
  assert.equal(errorResponse.status, 502); assert.doesNotMatch(await errorResponse.text(), /private-model-secret/);
});

test('progress follows actual provider boundaries and keeps successful history without exposing drafts', async () => {
  let releaseSearch, releaseModel;
  const searchGate = new Promise(resolve => { releaseSearch = resolve; });
  const modelGate = new Promise(resolve => { releaseModel = resolve; });
  const { service, calls } = fixtures({
    retrieve: async () => { await searchGate; return { requestId: 'private-provider-id', sources: [source(1), source(2)] }; },
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      await modelGate;
      return analysis(input.data, { privateReasoning: 'never-expose-model-draft' });
    },
  });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  const pending = service.research(input);
  await new Promise(resolve => setImmediate(resolve));
  const first = service.progress(input);
  assert.equal(first.status, 'running');
  assert.deepEqual(first.events.map(event => event.stage), ['searching']);
  assert.equal(first.events[0].query, calls.search[0]); assert.equal(first.events[0].searchAttempt, 1);
  first.events[0].query = 'client mutation';
  assert.notEqual(service.progress(input).events[0].query, 'client mutation');
  const duplicateInput = { ...input, requestId: 'duplicate-progress-0001' };
  const duplicate = service.research(duplicateInput);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(service.progress(duplicateInput).events, service.progress(input).events);
  releaseSearch();
  await new Promise(resolve => setImmediate(resolve));
  const analyzing = service.progress(input);
  assert.deepEqual(analyzing.events.map(event => event.stage), ['searching', 'sources', 'analyzing']);
  assert.equal(analyzing.events[1].sourceCount, 2); assert.equal(analyzing.events[2].modelAttempt, 1);
  assert.deepEqual(analyzing.events[1].sources, [1, 2].map(index => {
    const { title, url, organization, date } = source(index);
    return { title, url, organization, date };
  }));
  analyzing.events[1].sources[0].title = 'client mutation';
  analyzing.events[1].sources.push({ title: 'client-created source', url: 'https://invented.example/' });
  assert.equal(service.progress(input).events[1].sources.length, 2);
  assert.equal(service.progress(input).events[1].sources[0].title, source(1).title);
  releaseModel(); await pending; await duplicate;
  const finished = service.progress(input);
  assert.equal(finished.status, 'completed');
  assert.deepEqual(finished.events.map(event => event.stage), ['searching', 'sources', 'analyzing', 'reporting', 'complete']);
  assert.deepEqual(finished.events.map(event => event.seq), [1, 2, 3, 4, 5]);
  assert.doesNotMatch(JSON.stringify(finished), /private-provider-id|never-expose-model-draft|assessment|materials/);
  const replay = { ...input, requestId: 'recovered-progress-0001' };
  await service.research(replay);
  assert.deepEqual(service.progress(replay).events, finished.events);
  assert.equal(calls.search.length, 1); assert.equal(calls.model.length, 2);
});

test('a followup and field repair report real extra stages within two searches and three judgments', async () => {
  let judgments = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return { leads: leads() };
    if (++judgments === 1) return { action: 'search', followupQuery: '这项观察还有哪些适用条件？' };
    if (judgments === 2) return analysis(input.data, { nextLeads: [] });
    return analysis(input.data);
  } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await service.research(input);
  const record = service.progress(input);
  assert.deepEqual(record.events.map(event => event.stage), ['searching', 'sources', 'analyzing', 'searching', 'sources', 'analyzing', 'reporting', 'repairing', 'reporting', 'complete']);
  assert.deepEqual(record.events.filter(event => event.stage === 'searching').map(event => event.searchAttempt), [1, 2]);
  assert.deepEqual(record.events.filter(event => ['analyzing', 'repairing'].includes(event.stage)).map(event => event.modelAttempt), [1, 2, 3]);
  assert.doesNotMatch(JSON.stringify(record), /validationIssue|previousDraft|nextLeads/);
  assert.equal(calls.search.length, 2); assert.equal(judgments, 3);
});

test('source milestones snapshot all safe cumulative hits, deduplicate followups and match the displayed count', async () => {
  const { service } = fixtures({
    retrieve: async (_query, count) => ({ requestId: 'private-provider-id', sources: count === 1 ? [
      source(0, { url: 'javascript:alert(1)' }),
      source(0, { url: 'https://user:secret@source.example/record' }),
      source(0, { url: 'https://localhost/record' }),
      ...Array.from({ length: 10 }, (_, index) => source(index + 1, { content: 'private-provider-body', internalToken: 'private-token' })),
    ] : [
      source(1, { url: 'http://www.source1.example/record?utm_source=followup#section' }),
      ...Array.from({ length: 8 }, (_, index) => source(index + 11)),
    ] }),
    complete: async input => !input.data.sources ? { leads: leads() }
      : input.data.searches.length === 1 ? { action: 'search', followupQuery: '原始观察还有哪些独立记录？' } : analysis(input.data),
  });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await service.research(input);
  const record = service.progress(input), snapshots = record.events.filter(event => event.stage === 'sources');
  assert.deepEqual(snapshots.map(event => event.sourceCount), [10, 16]);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.sourceCount, snapshot.sources.length);
    assert.deepEqual(snapshot.sources.map(item => item.url), Array.from({ length: snapshot.sourceCount }, (_, index) => source(index + 1).url));
    assert.ok(snapshot.sources.every(item => Object.keys(item).sort().join(',') === 'date,organization,title,url'));
  }
  assert.deepEqual(snapshots[0].sources, snapshots[1].sources.slice(0, 10), 'the first snapshot is not extended by the followup');
  assert.doesNotMatch(JSON.stringify(record), /private-provider|private-token|javascript:|user:secret/);
  assert.equal(record.events.find(event => event.stage === 'analyzing').sourceCount, 10, 'every usable retrieved source can be ranked without reducing the public source list');
});

test('retrieved source links remain in failed history and are not overwritten by a successful retry', async () => {
  let fail = true;
  const { service } = fixtures({
    retrieve: async (_query, count) => ({ sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => {
      if (!input.data.sources) return { leads: leads() };
      if (fail) throw new SearchError('MODEL_UNAVAILABLE', 'private-model-body', 502);
      return analysis(input.data);
    },
  });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await rejects(service.research(input), 'MODEL_UNAVAILABLE');
  const failed = service.progress(input);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.events.find(event => event.stage === 'sources').sources.map(item => item.url), [source(1).url, source(2).url]);
  fail = false;
  const retry = { ...input, requestId: 'source-history-retry01' };
  await service.research(retry);
  assert.equal(service.progress(retry).status, 'completed');
  assert.deepEqual(service.progress(retry).events.find(event => event.stage === 'sources').sources.map(item => item.url), [source(3).url, source(4).url]);
  assert.deepEqual(service.progress(input), failed);
  assert.doesNotMatch(JSON.stringify(failed), /private-model-body/);
});

test('failed progress survives refunds, isolates new retries and is scoped to a live session', async () => {
  let fail = true, at = 1000;
  const { service } = fixtures({ now: () => at, sessionTtlMs: 100, retrieve: async () => {
    if (fail) throw new SearchError('SEARCH_TIMEOUT', 'private-provider-body', 504);
    return { requestId: 'success', sources: [source(1), source(2)] };
  } });
  const plan = await service.plan(planInput()), other = await service.plan(planInput({ requestId: 'other-progress-plan01' }));
  const input = researchInput(plan);
  await rejects(service.research(input), 'SEARCH_TIMEOUT');
  const failed = service.progress(input);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.events.map(event => event.stage), ['searching', 'failed']);
  assert.equal(failed.events[1].code, 'SEARCH_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(failed), /private-provider-body/);
  assert.throws(() => service.progress({ ...input, sessionId: other.sessionId }), error => error.code === 'PROGRESS_NOT_FOUND');
  assert.throws(() => service.progress({ ...input, requestId: 'unknown-progress-0001' }), error => error.code === 'PROGRESS_NOT_FOUND');
  assert.throws(() => service.progress({ ...input, requestId: 'bad' }), error => error.code === 'INVALID_REQUEST');
  fail = false;
  const retry = { ...input, requestId: 'new-progress-retry01' };
  await service.research(retry);
  assert.equal(service.progress(retry).status, 'completed');
  assert.deepEqual(service.progress(input), failed);
  at += 101;
  assert.throws(() => service.progress(input), error => error.code === 'SESSION_EXPIRED');
});

test('unexpected errors cannot place provider details or invented error codes in progress', async () => {
  const { service } = fixtures({ retrieve: async () => { throw Object.assign(new Error('private-body'), { code: 'private-secret-code' }); } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await assert.rejects(service.research(input));
  const record = service.progress(input);
  assert.equal(record.events.at(-1).code, 'INVESTIGATION_FAILED');
  assert.doesNotMatch(JSON.stringify(record), /private/);
});

test('HTTP progress shares origin protections and polling does not use paid investigation limits', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixtures({ retrieve: async () => { await gate; return { requestId: 'source', sources: [source(1), source(2)] }; } });
  const server = createAppServer({ investigation: service, minuteLimit: 2, hourLimit: 2 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${base}/api/investigation/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lie-company': 'research', origin: base, ...headers }, body: JSON.stringify(body) });
  const plan = (await (await post('plan', planInput())).json()).result, input = researchInput(plan);
  assert.equal((await post('progress', input)).status, 404);
  for (let i = 0; i < 4; i++) assert.equal((await post('progress', input)).status, 404);
  const researchResponse = post('research', input);
  while (!calls.search.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post('progress', input, { origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await post('progress', input, { 'x-lie-company': '' })).status, 403);
  assert.equal((await post('progress', input, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/api/investigation/progress`)).status, 405);
  for (let i = 0; i < 4; i++) {
    const response = await post('progress', input), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.result.status, 'running');
    assert.deepEqual(body.result.events.map(event => event.stage), ['searching']);
  }
  release(); assert.equal((await researchResponse).status, 200);
  const done = await post('progress', input);
  const completed = (await done.json()).result;
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.events.find(event => event.stage === 'sources').sources.map(item => item.url), [source(1).url, source(2).url]);
  assert.equal((await post('plan', planInput({ requestId: 'third-paid-operation' }))).status, 429);
  assert.equal(calls.search.length, 1); assert.equal(calls.model.length, 2);
});

test('refresh replaces both directions without searching, consuming a round or invalidating earlier options', async () => {
  for (const useOriginal of [false, true]) {
    const { service, calls } = fixtures({ complete: async input => input.data.sources ? analysis(input.data) : { leads: input.data.issuedLeads ? refreshedLeads() : leads() } });
    const plan = await service.plan(planInput()), input = refreshInput(plan);
    const refreshed = await service.refresh(input);
    assert.equal(refreshed.sessionId, plan.sessionId); assert.equal(refreshed.claim, plan.claim); assert.equal(refreshed.roundId, 'round-1');
    assert.equal(calls.search.length, 0); assert.equal(calls.model.length, 2);
    assert.deepEqual(calls.model[1].data.history, []); assert.equal(calls.model[1].data.previous, undefined);
    assert.deepEqual(calls.model[1].data.issuedLeads, plan.leads.map(({ title, question }) => ({ title, question })));
    assert.ok(refreshed.leads.every(lead => lead.id.length <= 40 && !plan.leads.some(original => original.id === lead.id)));
    assert.deepEqual(await service.refresh(input), refreshed); assert.equal(calls.model.length, 2);
    const selected = (useOriginal ? plan : refreshed).leads[1];
    const result = await service.research(researchInput(plan, { leadId: selected.id }));
    assert.equal(result.leadId, selected.id); assert.equal(result.query, selected.question);
    assert.equal(calls.model.at(-1).data.round, 1); assert.equal(calls.search.length, 1);
    await rejects(service.refresh({ ...input, requestId: 'completed-refresh-01' }), 'ROUND_CONFLICT');
  }
});

test('later refresh follows the selected material and full history without rewriting evidence snapshots', async () => {
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ requestId: `refresh-source-${count}`, sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => input.data.sources ? analysis(input.data) : { leads: input.data.issuedLeads ? refreshedLeads() : leads() },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const secondInput = researchInput(plan, { requestId: 'refresh-parent-round-2', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[1].id });
  const second = await service.research(secondInput), originalSnapshot = structuredClone(second);
  const input = refreshInput(plan, { roundId: 'round-3', promotedId: second.materials[0].id, leadIds: second.nextLeads.map(lead => lead.id) });
  const refreshed = await service.refresh(input), data = calls.model.at(-1).data;
  const priorMaterials = data.history.flatMap(item => item.materials);
  assert.equal(calls.search.length, 2); assert.equal(data.history.length, 2); assert.equal(priorMaterials.length, 4);
  assert.equal(priorMaterials.filter(material => material.promoted).length, 2);
  assert.equal(data.history.at(-1).materials.find(material => material.promoted).finding, second.materials[0].insight.explanation);
  assert.deepEqual(data.history.map(item => item.assessment), [first.assessment, second.assessment]);
  assert.ok(data.issuedLeads.some(lead => lead.question === second.nextLeads[0].question));
  assert.deepEqual(await service.research({ ...secondInput, requestId: 'refresh-parent-replay' }), originalSnapshot);
  await rejects(service.research(researchInput(plan, { requestId: 'refresh-wrong-parent', roundId: 'round-3', leadId: refreshed.leads[0].id, promotedId: second.materials[1].id })), 'INVALID_LEAD');
  const third = await service.research(researchInput(plan, { requestId: 'refresh-correct-parent', roundId: 'round-3', leadId: refreshed.leads[0].id, promotedId: second.materials[0].id }));
  assert.equal(third.leadId, refreshed.leads[0].id); assert.equal(third.query, refreshed.leads[0].question);
});

test('duplicate or cosmetic refreshes repair once, then fail without losing the current questions', async () => {
  let valid = false;
  const { service, calls } = fixtures({ complete: async input => {
    if (input.data.sources) return analysis(input.data);
    if (!input.data.issuedLeads) return { leads: leads() };
    return { leads: valid ? refreshedLeads() : [...leads()].reverse().map(lead => ({ ...lead, question: lead.question.replace('？', ' ? ') })) };
  } });
  const plan = await service.plan(planInput()), input = refreshInput(plan);
  await rejects(service.refresh(input), 'INVESTIGATION_FORMAT');
  assert.equal(calls.model.length, 3); assert.equal(calls.search.length, 0);
  assert.match(calls.model.at(-1).data.validationIssue, /genuinely new directions/);
  valid = true;
  const result = await service.refresh(input);
  assert.equal(result.leads.length, 2); assert.equal(calls.model.length, 4);
  const researched = await service.research(researchInput(plan));
  assert.equal(researched.query, plan.leads[0].question);
});

test('refresh checks all previously offered groups and validates malformed replacements', async () => {
  let draft = refreshedLeads();
  const { service, calls } = fixtures({ complete: async input => input.data.sources ? analysis(input.data) : { leads: input.data.issuedLeads ? draft : leads() } });
  const plan = await service.plan(planInput()), first = await service.refresh(refreshInput(plan));
  const input = refreshInput(first, { requestId: 'refresh-again-000001' });
  await rejects(service.refresh(input), 'INVESTIGATION_FORMAT');
  assert.ok(calls.model.at(-1).data.issuedLeads.some(lead => lead.question === first.leads[0].question));
  draft = [refreshedLeads()[0]];
  await rejects(service.refresh(input), 'INVESTIGATION_FORMAT');
  assert.match(calls.model.at(-1).data.validationIssue, /exactly 2/);
  await rejects(service.refresh({ ...input, requestId: 'forged-mixed-group01', leadIds: [plan.leads[0].id, first.leads[1].id] }), 'INVALID_LEAD');
  assert.equal(calls.search.length, 0);
});

test('refresh is idempotent and excludes concurrent refreshes and investigations', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixtures({ complete: async input => {
    if (input.data.sources) return analysis(input.data);
    if (input.data.issuedLeads) { await gate; return { leads: refreshedLeads() }; }
    return { leads: leads() };
  } });
  const plan = await service.plan(planInput()), input = refreshInput(plan);
  const pending = service.refresh(input), duplicate = service.refresh(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.model.length, 2);
  assert.throws(() => service.refresh({ ...input, leadIds: [...input.leadIds].reverse() }), error => error.code === 'REQUEST_CONFLICT');
  await rejects(service.refresh({ ...input, requestId: 'different-refresh-01' }), 'INVESTIGATION_BUSY');
  await rejects(service.research(researchInput(plan)), 'INVESTIGATION_BUSY');
  release(); const result = await pending;
  assert.deepEqual(await duplicate, result);
  result.leads[0].question = 'client mutation';
  assert.notEqual((await service.refresh(input)).leads[0].question, 'client mutation');
  assert.equal((await service.research(researchInput(plan))).query, plan.leads[0].question);
});

test('an active investigation excludes refreshing and invalid round or parent requests never call the model', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixtures({ retrieve: async () => { await gate; return { sources: [source(1), source(2)] }; } });
  const plan = await service.plan(planInput()), input = refreshInput(plan);
  await rejects(service.refresh({ ...input, roundId: 'round-2', leadIds: ['r2-1', 'r2-2'], promotedId: 'answer-persuasion' }), 'MISSING_PARENT');
  await rejects(service.refresh({ ...input, leadIds: ['forged-one', 'forged-two'] }), 'INVALID_LEAD');
  assert.throws(() => service.refresh({ ...input, leadIds: [plan.leads[0].id, plan.leads[0].id] }), error => error.code === 'INVALID_REQUEST');
  const pending = service.research(researchInput(plan));
  await new Promise(resolve => setImmediate(resolve));
  await rejects(service.refresh(input), 'INVESTIGATION_BUSY'); assert.equal(calls.model.length, 1);
  release(); await pending;
  await rejects(service.refresh({ ...input, requestId: 'refresh-bad-parent01', roundId: 'round-2', leadIds: ['r2-1', 'r2-2'], promotedId: 'forged-parent' }), 'MISSING_PARENT');
});

test('refresh shares a 70-second deadline with its repair and does not commit a late model reply', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, release, refreshCalls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, calls } = fixtures({ complete: async (input, _count, options) => {
    if (input.data.sources) return analysis(input.data);
    if (!input.data.issuedLeads) return { leads: leads() };
    if (++refreshCalls === 1) return { leads: [] };
    signal = options.signal; await gate; return { leads: refreshedLeads() };
  } });
  const plan = await service.plan(planInput()), input = refreshInput(plan), pending = service.refresh(input);
  const rejected = rejects(pending, 'MODEL_TIMEOUT');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshCalls, 2); t.mock.timers.tick(69999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(signal.aborted, true); release(); await rejected;
  assert.equal(calls.search.length, 0);
  assert.equal((await service.research(researchInput(plan))).query, plan.leads[0].question);
});

test('expired refresh sessions fail before invoking providers', async () => {
  let at = 1000;
  const { service, calls } = fixtures({ now: () => at, sessionTtlMs: 100 });
  const plan = await service.plan(planInput()); at += 101;
  await rejects(service.refresh(refreshInput(plan)), 'SESSION_EXPIRED');
  assert.equal(calls.model.length, 1); assert.equal(calls.search.length, 0);
});

test('HTTP refresh validates origin, caches one response, and shares the paid-operation rate limit', async t => {
  const { service, calls } = fixtures({ complete: async input => input.data.sources ? analysis(input.data) : { leads: input.data.issuedLeads ? refreshedLeads() : leads() } });
  const server = createAppServer({ investigation: service, minuteLimit: 2, hourLimit: 2 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${base}/api/investigation/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lie-company': 'research', origin: base, ...headers }, body: JSON.stringify(body) });
  const plan = (await (await post('plan', planInput())).json()).result, input = refreshInput(plan);
  assert.equal((await post('refresh', input, { origin: 'https://outside.example' })).status, 403);
  assert.equal((await post('refresh', input, { 'x-lie-company': '' })).status, 403);
  assert.equal((await post('refresh', input, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/api/investigation/refresh`)).status, 405);
  const response = await post('refresh', input), body = await response.json(); assert.equal(response.status, 200);
  assert.equal(body.result.leads.length, 2); assert.equal(body.result.roundId, 'round-1');
  assert.deepEqual(await (await post('refresh', input)).json(), body);
  assert.equal((await post('refresh', { ...input, leadIds: [...input.leadIds].reverse() })).status, 409);
  assert.equal((await post('refresh', { ...input, requestId: 'over-limit-refresh01' })).status, 429);
  assert.equal(calls.model.length, 2); assert.equal(calls.search.length, 0);
});

function compactAnalysis(data, sourceIndex = data.sources.length - 1) {
  return {
    action: 'final', sourceRanking: data.sources.map(source => ({ sourceId: source.id, relevance: 'direct', strength: 'limited', relation: 'limits', reason: '同等直接的记录，但适用条件仍待核对。' })),
    evidence: { quoteId: data.sources[sourceIndex].passages[0].id, headline: '观察仍有适用条件', explanation: '原文记录了条件限制，不能据此推及所有场景。' },
    finding: '这份观察补充了一个仍需核对的条件。', assessment: { status: 'mixed', summary: '现有记录仅支持有限范围，不能完全否定原观点。' },
    chainAssessment: { unresolved: ['是否适用于原观点的完整范围？'] },
    nextLeads: data.round === 5 ? [] : chainPlan().leads,
  };
}

test('direction-only repair sends selected evidence and accepts only the repaired directions', async () => {
  let draft, analysisCalls = 0;
  const { service, calls } = fixtures({
    retrieve: async () => ({ sources: Array.from({ length: 10 }, (_, index) => source(index + 1, { summary: `第${index + 1}份记录。` + '这份完整记录描述了观察条件与适用范围，不能推广到其他场景。'.repeat(12) })) }),
    complete: async input => {
      if (!input.data.sources) return chainPlan();
      if (++analysisCalls === 1) { draft = compactAnalysis(input.data); draft.nextLeads = draft.nextLeads.slice(0, 1); return draft; }
      assert.deepEqual(Object.keys(input.schema), ['nextLeads']);
      assert.equal(input.data.sources.length, 1);
      assert.equal(input.data.sources[0].passages[0].id, draft.evidence.quoteId);
      assert.equal(input.data.canSearch, false);
      assert.equal(input.data.previousDraft.sourceRanking, undefined);
      assert.match(input.data.validationIssue, /nextLeads: exactly 2/);
      return { nextLeads: chainPlan().leads, assessment: { status: 'refuted', summary: '忽略这次改写' }, evidence: { quoteId: 'invented' }, action: 'search', followupQuery: '不能发起的搜索' };
    },
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.assessment.status, 'mixed'); assert.equal(result.materials[0].insight.headline, draft.evidence.headline);
  assert.equal(result.nextLeads.length, 2); assert.equal(calls.search.length, 1); assert.equal(analysisCalls, 2);
  const [full, repair] = calls.model.filter(call => call.data.sources);
  assert.ok(JSON.stringify(repair.data).length < JSON.stringify(full.data).length / 2, 'direction repair must not resend all ten sources');
  acceptInEngine(plan, result);
});

test('direction errors do not trigger narrow repair before evidence ranking is verified', async () => {
  let attempts = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return chainPlan();
    const draft = compactAnalysis(input.data, 0);
    if (++attempts === 1) {
      draft.nextLeads = draft.nextLeads.slice(0, 1);
      draft.sourceRanking[1].strength = 'strong';
      return draft;
    }
    assert.ok(input.schema.sourceRanking, 'invalid evidence needs full-context repair');
    assert.equal(input.data.sources.length, 2);
    assert.match(input.data.validationIssue, /highest-ranked/);
    return draft;
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.nextLeads.length, 2); assert.equal(attempts, 2); assert.equal(calls.search.length, 1);
});

test('compact research accepts any equally ranked fresh source and supplies gameplay fields without model regeneration', async () => {
  for (const reached of [20, 100]) {
    const { service, calls } = fixtures({ retrieve: async () => ({ sources: [source(1), source(2), source(3)] }), complete: async input => {
      if (!input.data.sources) return chainPlan();
      assert.equal(input.schema.materials, undefined); assert.equal(input.schema.recommendation, undefined);
      assert.ok(Object.keys(input.schema).indexOf('sourceRanking') < Object.keys(input.schema).indexOf('evidence'));
      const draft = compactAnalysis(input.data);
      draft.sourceRanking[0].relation = 'contradicts';
      // Unrequested game fields cannot alter awards or select different facts.
      Object.assign(draft.evidence, { effectId: 'win-immediately', focus: 'unknown' });
      return draft;
    } });
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan, { gameContext: { reached } }));
    assert.equal(calls.model.length, 2, 'an equal-grade source must not trigger a second model call');
    assert.equal(result.materials.length, 1); assert.equal(result.materials[0].sources[0].url, source(3).url);
    assert.equal(result.materials[0].effectId, reached < 60 ? 'viral' : 'authority');
    assert.equal(result.recommendation.materialId, result.materials[0].id);
    assert.doesNotMatch(JSON.stringify(result), /sourceRanking|chainAssessment|routeRole|criterionId/);
    acceptInEngine(plan, result);
  }
});

test('one usable source can complete compact research without inventing a second card or extra search', async () => {
  const { service, calls } = fixtures({ retrieve: async () => ({ sources: [source(1)] }), complete: async input => input.data.sources ? compactAnalysis(input.data) : chainPlan() });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.materials.length, 1); assert.equal(calls.search.length, 1); assert.equal(calls.model.length, 2);
  assert.equal(result.assessment.status, 'mixed'); acceptInEngine(plan, result);
});

test('a complete compact report with a legacy followup field does not trigger another paid search', async () => {
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return chainPlan();
    const { action, ...draft } = compactAnalysis(input.data);
    return { ...draft, followupQuery: '下一轮再核对适用范围' };
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.materials.length, 1); assert.equal(calls.search.length, 1); assert.equal(calls.model.length, 2);
});

test('compact evidence cannot use an invented passage or outrank stronger direct support with weaker negative material', async () => {
  for (const fault of ['invented', 'weaker', 'omitted']) {
    const { service } = fixtures({ complete: async input => {
      if (!input.data.sources) return chainPlan();
      const draft = compactAnalysis(input.data);
      if (fault === 'invented') draft.evidence.quoteId = 's999-p1';
      if (fault === 'weaker') Object.assign(draft.sourceRanking[0], { strength: 'strong', relation: 'supports' });
      if (fault === 'omitted') draft.sourceRanking.pop();
      return draft;
    } });
    const plan = await service.plan(planInput());
    await rejects(service.research(researchInput(plan)), fault === 'invented' ? 'UNTRACEABLE_QUOTE' : 'INVESTIGATION_FORMAT');
  }
});

const chainPlan = () => ({
  evidencePlan: { proposition: '原始观点是否符合直接观察？', refutationTarget: '查找原命题条件下足以推翻它的直接反例。', scope: '仅限原始观点的主体与条件。', criteria: [{ question: '原命题在其宣称条件下成立吗？', requiredEvidence: '相同条件的直接原始观察。', counterEvidence: '同一条件下能推翻原命题的直接反例。' }] },
  leads: leads().map((lead, index) => ({ ...lead, searchQuery: lead.question, routeRole: index ? 'indirect' : 'direct', criterionId: 'c1', limitation: index ? '转述不能代替观察。' : '仍需核对适用条件。' })),
});
function chainAnalysis(data) {
  return analysis(data, {
    sourceRanking: [...data.sources].reverse().map((source, index) => ({ sourceId: source.id, relevance: index ? 'indirect' : 'direct', strength: index ? 'limited' : 'strong', relation: 'context', reason: index ? '相关背景不能直接证明原命题。' : '这份原始记录直接对应本轮问题。' })),
    chainAssessment: { relation: 'context', finding: '观察已找到，但还需检验其范围。', unresolved: ['观察条件是否与原命题完全相同？'], nextCriterionId: 'c1' },
    nextLeads: data.round === 5 ? [] : chainPlan().leads,
  });
}
const publishedQuote = publication => publication.sources.flatMap(source => source.passages).find(passage => passage.id === publication.quoteId).text;
function verdictDraft(data, extra = {}) {
  return { status: 'refuted', confidence: 'high', summary: '公布的直接反例否定了原命题。', rationale: '引文记载了相同条件下的反例，没有将二手转述代替观察。', unresolved: [],
    chain: data.publications.map(({ roundId, materialId }) => ({ roundId, materialId, finding: '原始观察提供直接反例。', strength: 'strong', relevance: 'direct', gap: '' })),
    criteriaReview: data.evidencePlan.criteria.map(({ id }) => ({ criterionId: id, outcome: 'refutes', decisive: true, publicationRefs: data.publications.map(publication => ({ roundId: publication.roundId, materialId: publication.materialId, basis: 'primary-observation', proofQuote: publishedQuote(publication) })), explanation: '这份已公布的直接反例满足否定原命题所需条件。' })), ...extra };
}
function chainFixtures(verdict = verdictDraft) {
  return fixtures({ complete: async input => input.data.publications ? verdict(input.data) : input.data.sources ? chainAnalysis(input.data) : chainPlan() });
}
const verdictInput = (plan, result, extra = {}) => ({ requestId: 'verdict-request-0001', sessionId: plan.sessionId, publications: result ? [{ roundId: 'round-1', materialId: result.recommendation.materialId }] : [], ...extra });

test('evidence standards and route teaching metadata are private; ranked relevance overrides tactical recommendation', async () => {
  const { service, calls } = chainFixtures();
  const plan = await service.plan(planInput());
  assert.deepEqual(plan.leads.map(lead => lead.id), ['r1-1', 'r1-2']);
  assert.doesNotMatch(JSON.stringify(plan), /routeRole|criterionId|limitation|evidencePlan|searchQuery|refutationTarget/);
  const result = await service.research(researchInput(plan));
  assert.equal(result.recommendation.materialId, 'answer-persuasion', 'direct evidence wins despite a spread recommendation in a low-reach map');
  assert.doesNotMatch(JSON.stringify(result), /routeRole|sourceRanking|chainAssessment|criterionId|refutationTarget/);
  assert.doesNotMatch(JSON.stringify(result.nextLeads), /searchQuery/);
  assert.equal(calls.model.at(-1).data.evidencePlan.criteria[0].id, 'c1');
  assert.deepEqual(new Set(result.nextLeads.map(lead => lead.question)), new Set(chainPlan().leads.map(lead => lead.question)));
});

test('every usable candidate is reranked; invented or omitted source IDs cannot enter a chain', async () => {
  let corrupted = true;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return chainPlan();
    const result = chainAnalysis(input.data);
    if (corrupted) result.sourceRanking[0].sourceId = 's999';
    return result;
  } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  await rejects(service.research(input), 'INVESTIGATION_FORMAT');
  assert.equal(calls.model.filter(call => call.data.sources).length, 2);
  corrupted = false; const result = await service.research(input);
  assert.equal(result.recommendation.materialId, 'answer-persuasion');
});

test('an incomplete ranking after followup identifies all missing sources and repairs without another search', async () => {
  let analyses = 0;
  const omitted = new Set(['s4', 's10', 's12']);
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ sources: Array.from({ length: 6 }, (_, index) => source((count - 1) * 6 + index + 1)) }),
    complete: async input => {
      if (!input.data.sources) return chainPlan();
      if (++analyses === 1) return { action: 'search', followupQuery: '同样观察条件是否存在独立反例记录？' };
      const ids = input.data.sources.map(item => item.id);
      assert.equal(ids.length, 12);
      const result = analysis(input.data, {
        sourceRanking: input.data.sources.map(item => ({ sourceId: item.id, relevance: 'direct', strength: 'limited', relation: 'context', reason: '该记录仍需核对原始观察条件。' })),
      });
      if (analyses === 2) {
        result.sourceRanking = result.sourceRanking.filter(item => !omitted.has(item.sourceId));
      } else {
        assert.equal(input.data.canSearch, false);
        assert.equal(input.data.validationIssue, `sourceRanking: rank all 12 sources exactly once; required sourceIds: ${ids.join(', ')}; missing sourceIds: ${ids.filter(id => omitted.has(id)).join(', ')}; remove repeated or unknown IDs`);
        assert.deepEqual(input.data.previousDraft.sourceRanking.map(item => item.sourceId), ids.filter(id => !omitted.has(id)));
      }
      return result;
    },
  });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  const result = await service.research(input);
  assert.equal(analyses, 3);
  assert.equal(calls.search.length, 2, 'the ranking repair reuses both searches rather than calling the provider again');
  assert.equal(service.progress(input).status, 'completed');
  assert.deepEqual(calls.diagnostic, []);
  assert.equal(result.materials.length, 2);
  acceptInEngine(plan, result);
});

test('later rounds inherit actual unresolved evidence gaps and the original verification standards', async () => {
  const { service, calls } = fixtures({ retrieve: async (_query, count) => ({ sources: [source(count * 2 - 1), source(count * 2)] }), complete: async input => input.data.sources ? chainAnalysis(input.data) : chainPlan() });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  await service.research(researchInput(plan, { requestId: 'chain-second-round-01', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.recommendation.materialId }));
  const data = calls.model.at(-1).data;
  assert.equal(data.history[0].chain.unresolved[0], '观察条件是否与原命题完全相同？');
  assert.equal(data.evidencePlan.criteria[0].counterEvidence, chainPlan().evidencePlan.criteria[0].counterEvidence);
  assert.equal(data.history.at(-1).materials.find(material => material.promoted).sourceUrl, first.materials[1].sources[0].url);
});

test('final review audits only server-owned published material and is idempotent across retries', async () => {
  const { service, calls } = chainFixtures();
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  const input = verdictInput(plan, result, { claim: 'forged claim', finalVerdict: { status: 'refuted' } });
  input.publications[0].quote = 'forged quote';
  const [first, duplicate] = await Promise.all([service.verdict(input), service.verdict(input)]);
  assert.deepEqual(first, duplicate); assert.equal(first.finalVerdict.status, 'refuted');
  assert.equal(first.sessionId, plan.sessionId); assert.equal(first.requestId, input.requestId);
  assert.deepEqual(first.finalVerdict.chain[0].sourceUrls, [result.materials[1].sources[0].url]);
  assert.equal(first.finalVerdict.chain[0].question, result.query);
  const seen = calls.model.at(-1).data;
  assert.equal(seen.publications.length, 1); assert.ok(publishedQuote(seen.publications[0]).includes(result.materials[1].insight.quote));
  assert.equal(seen.publications[0].sources.length, 1); assert.equal(seen.claim, plan.claim);
  assert.doesNotMatch(JSON.stringify(seen), /forged|gameContext|sourceRanking|routeRole/);
  const retry = await service.verdict({ ...input, requestId: 'verdict-new-request-02' });
  assert.equal(retry.requestId, 'verdict-new-request-02'); assert.equal(calls.model.filter(call => call.data.publications).length, 1);
  first.finalVerdict.chain[0].sourceUrls[0] = 'https://forged.example';
  assert.notEqual((await service.verdict(input)).finalVerdict.chain[0].sourceUrls[0], 'https://forged.example');
});

test('unsupported certainty is downgraded; an indirect path label never predetermines the ending', async () => {
  for (const defect of ['low', 'gap', 'indirect', 'no-criterion']) {
    const { service } = chainFixtures(data => {
      const value = verdictDraft(data);
      if (defect === 'low') value.confidence = 'low';
      if (defect === 'gap') { value.unresolved.push('缺少原始观察的适用条件。'); value.criteriaReview[0].decisive = false; }
      if (defect === 'indirect') value.chain[0].relevance = 'indirect';
      if (defect === 'no-criterion') value.criteriaReview = [];
      return value;
    });
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
    const { finalVerdict } = await service.verdict(verdictInput(plan, result));
    assert.equal(finalVerdict.status, 'insufficient'); assert.equal(finalVerdict.confidence, 'low');
    assert.ok(finalVerdict.unresolved.length); assert.match(finalVerdict.rationale, /不代表原观点已被证实/);
  }
});

test('supported and conflicting original claims remain legitimate audit outcomes', async () => {
  for (const status of ['supported', 'mixed', 'insufficient']) {
    const { service } = chainFixtures(data => verdictDraft(data, { status, confidence: 'medium', summary: '材料不能直接推翻原始观点。', unresolved: ['还需查明适用条件。'] }));
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
    assert.equal((await service.verdict(verdictInput(plan, result))).finalVerdict.status, status);
  }
});

test('empty, forged, duplicate or unfinished publications cannot produce a fabricated winning verdict', async () => {
  const { service, calls } = chainFixtures();
  const plan = await service.plan(planInput());
  const empty = await service.verdict(verdictInput(plan));
  assert.equal(empty.finalVerdict.status, 'insufficient'); assert.equal(calls.model.length, 1);
  await rejects(service.verdict(verdictInput(plan, null, { requestId: 'forged-verdict-input', publications: [{ roundId: 'round-1', materialId: 'photo-spread' }] })), 'INVALID_PUBLICATIONS');
  assert.throws(() => service.verdict(verdictInput(plan, null, { publications: [{ roundId: 'round-1', materialId: 'photo-spread' }, { roundId: 'round-1', materialId: 'photo-spread' }] })), error => error.code === 'INVALID_PUBLICATIONS');
  assert.equal(calls.model.length, 1);
});

test('verdict repairs bad references once and failed attempts can be retried without losing evidence', async () => {
  let invalid = true;
  const { service, calls } = chainFixtures(data => {
    const result = verdictDraft(data); if (invalid) result.criteriaReview[0].publicationRefs[0].materialId = 'unpublished'; return result;
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan)), input = verdictInput(plan, result);
  await rejects(service.verdict(input), 'INVESTIGATION_FORMAT');
  assert.equal(calls.model.filter(call => call.data.publications).length, 2);
  assert.equal(calls.search.length, 1); invalid = false;
  assert.equal((await service.verdict(input)).finalVerdict.status, 'refuted');
  assert.equal(calls.search.length, 1);
});

test('verdict shares a 130 second deadline with one repair and rejects late provider output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, signal, auditCalls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { service } = fixtures({ complete: async (input, _count, options) => {
    if (!input.data.sources && !input.data.publications) return chainPlan();
    if (input.data.sources) return chainAnalysis(input.data);
    if (++auditCalls === 1) return {};
    signal = options.signal; await gate; return verdictDraft(input.data);
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  const pending = service.verdict(verdictInput(plan, result)), rejected = rejects(pending, 'MODEL_TIMEOUT');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auditCalls, 2); t.mock.timers.tick(129999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(signal.aborted, true); release(); await rejected;
});

test('a slow first verdict leaves a full repair window and commits the verified result once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let audits = 0, signal;
  const { service, calls } = fixtures({ complete: async (input, _count, options) => {
    if (input.schema.evidencePlan) return chainPlan();
    if (input.data.sources) return chainAnalysis(input.data);
    const attempt = ++audits; signal = options.signal;
    await new Promise(resolve => setTimeout(resolve, 59000));
    return attempt === 1 ? {} : verdictDraft(input.data);
  } });
  const plan = await service.plan(planInput()), round = await service.research(researchInput(plan));
  const input = verdictInput(plan, round), pending = service.verdict(input);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(59000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(audits, 2); assert.equal(signal.aborted, false);
  t.mock.timers.tick(59000);
  assert.equal((await pending).finalVerdict.status, 'refuted');
  assert.equal(signal.aborted, false);
  assert.equal((await service.verdict({ ...input, requestId: 'cached-slow-verdict-01' })).finalVerdict.status, 'refuted');
  assert.equal(audits, 2); assert.equal(calls.search.length, 1);
});

test('HTTP final verdict uses existing origin protection, request cache and completed investigation session', async t => {
  const { service, calls } = chainFixtures();
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  const server = createAppServer({ investigation: service }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, body = JSON.stringify(verdictInput(plan, result));
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lie-Company': 'research' }, body };
  assert.equal((await fetch(`${base}/api/investigation/verdict`, { ...options, headers: { ...options.headers, Origin: 'https://evil.example' } })).status, 403);
  const response = await fetch(`${base}/api/investigation/verdict`, options);
  assert.equal(response.status, 200); assert.equal((await response.json()).result.finalVerdict.status, 'refuted');
  assert.equal((await fetch(`${base}/api/investigation/verdict`, options)).status, 200);
  assert.equal(calls.model.filter(call => call.data.publications).length, 1);
});

test('new production plans cannot silently fall back when evidence standards are missing', async () => {
  let calls = 0;
  const service = createInvestigationService({ model: { configured: true, async complete() { calls++; return { leads: chainPlan().leads }; } }, search: { configured: true, async retrieve() { throw new Error('not reached'); } }, diagnostic() {} });
  await rejects(service.plan(planInput()), 'INVESTIGATION_FORMAT'); assert.equal(calls, 2);
});

test('unsubstantiated reporting cannot unlock a truth ending even when labeled high confidence', async () => {
  const { service } = chainFixtures(data => {
    const result = verdictDraft(data); result.criteriaReview[0].publicationRefs[0].basis = 'secondary-assertion';
    result.chain[0].strength = 'weak'; return result;
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal((await service.verdict(verdictInput(plan, result))).finalVerdict.status, 'insufficient');
});

test('decisive proof excerpts must exist verbatim in the actual published source', async () => {
  const { service, calls } = chainFixtures(data => {
    const result = verdictDraft(data); result.criteriaReview[0].publicationRefs[0].proofQuote = '凭空生成的实验原始数据'; return result;
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  await rejects(service.verdict(verdictInput(plan, result)), 'INVESTIGATION_FORMAT');
  assert.equal(calls.model.filter(call => call.data.publications).length, 2);
});

test('planning rejects rewriting the original proposition even when the output looks well structured', async () => {
  let calls = 0;
  const service = createInvestigationService({ model: { configured: true, async complete() { calls++; return chainPlan(); } }, search: { configured: true, async retrieve() {} }, diagnostic() {} });
  await rejects(service.plan(planInput({ claim: '这个原始观点不能被换成别的问题' })), 'INVESTIGATION_FORMAT');
  assert.equal(calls, 2);
});

test('later published proof can close an earlier weak route while global unresolved gaps still block refutation', async () => {
  let keepGlobalGap = false;
  const { service } = fixtures({
    retrieve: async (_query, count) => ({ sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => {
      if (input.data.sources) return chainAnalysis(input.data);
      if (!input.data.publications) return chainPlan();
      const draft = verdictDraft(input.data), decisive = input.data.publications.at(-1);
      draft.chain[0] = { ...draft.chain[0], strength: 'weak', relevance: 'indirect', gap: '这份早期资料只有转述，缺少直接观察。' };
      draft.rationale = '首轮转述本身不足以证明；第二轮已公布的原始观察补齐了直接证据，因此全链不再有这一关键缺口。';
      draft.criteriaReview[0].publicationRefs = [{ roundId: decisive.roundId, materialId: decisive.materialId, basis: 'primary-observation', proofQuote: publishedQuote(decisive) }];
      if (keepGlobalGap) { draft.unresolved = ['后续观察的适用条件仍未核实。']; draft.criteriaReview[0].decisive = false; }
      return draft;
    },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const second = await service.research(researchInput(plan, { requestId: 'weak-then-strong-round2', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.recommendation.materialId }));
  const publications = [{ roundId: 'round-1', materialId: first.recommendation.materialId }, { roundId: 'round-2', materialId: second.recommendation.materialId }];
  const result = await service.verdict(verdictInput(plan, null, { publications }));
  assert.equal(result.finalVerdict.status, 'refuted');
  assert.equal(result.finalVerdict.chain[0].strength, 'weak'); assert.ok(result.finalVerdict.chain[0].gap);
  assert.equal(result.finalVerdict.chain[1].strength, 'strong'); assert.equal(result.finalVerdict.chain[1].gap, '');
  // A different legitimate publication set causes a fresh review. Even with
  // decisive-looking evidence, an unresolved global condition stays blocking.
  keepGlobalGap = true;
  const incomplete = await service.verdict(verdictInput(plan, null, { requestId: 'unresolved-later-proof', publications: [{ ...publications[0], materialId: first.materials[0].id }, publications[1]] }));
  assert.equal(incomplete.finalVerdict.status, 'insufficient');
  assert.deepEqual(incomplete.finalVerdict.unresolved, ['后续观察的适用条件仍未核实。']);
});

test('final review references server passages while retaining the complete contrary source context', async () => {
  const tail = '但这项结果仅适用于封闭样本，不能反驳开放环境下的原命题。';
  const { service, calls } = fixtures({
    retrieve: async () => ({ sources: [1, 2].map(index => {
      const item = source(index);
      return { ...item, content: item.summary + Array.from({ length: 90 }, (_, i) => `第${i}项观察保留原始测量条件。`).join('') + tail };
    }) }),
    complete: async input => {
      if (input.data.sources) return chainAnalysis(input.data);
      if (!input.data.publications) return chainPlan();
      const draft = verdictDraft(input.data, { status: 'mixed', confidence: 'medium', unresolved: [tail] });
      draft.criteriaReview.forEach(review => { review.publicationRefs = input.data.publications.map(item => ({ quoteId: item.quoteId, basis: 'primary-observation' })); });
      return draft;
    },
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  const audit = await service.verdict(verdictInput(plan, result));
  const input = calls.model.at(-1), publication = input.data.publications[0], seen = publication.sources[0];
  assert.equal(audit.finalVerdict.status, 'mixed');
  assert.equal(seen.summary, undefined); assert.equal(seen.content, undefined); assert.equal(publication.quote, undefined);
  assert.ok(seen.passages.some(item => item.id === publication.quoteId));
  const completeContext = seen.passages.map(item => item.text).join('');
  assert.ok(completeContext.includes(tail), 'context beyond the research excerpt budget must still reach final review');
  assert.equal(completeContext.split(source(2).summary).length - 1, 1, 'the same summary embedded in the body is sent once');
  assert.ok(seen.passages.every(item => result.materials[1].sources[0].content.includes(item.text)));
  assert.doesNotMatch(JSON.stringify(input.schema), /proofQuote/);
});

test('published links can jointly refute a claim despite local limits and a nonessential planning branch', async () => {
  // Fictional records isolate the regression: product ownership and company
  // origin live in different sources; neither needs to contain every fact.
  const claim = '晨星编辑器是一家甲国公司';
  const records = [
    source(1, { title: '晨星编辑器发布记录', summary: '晨星编辑器由北河公司开发和运营。' }),
    source(2, { title: '北河公司登记记录', summary: '北河公司是乙国注册公司，总部位于乙国。' }),
  ];
  for (const defect of [null, 'missing-link', 'all-indirect', 'uncited-anchor', 'all-not-required']) {
    const { service, calls } = fixtures({
      retrieve: async (_query, count) => ({ sources: [records[count - 1]] }),
      complete: async input => {
        if (input.data.sources) {
          const result = compactAnalysis(input.data);
          result.chainAssessment.unresolved = ['开发主体所在地尚待核对。', '股东国籍尚未查询。'];
          return result;
        }
        if (!input.data.publications) {
          const result = chainPlan();
          result.evidencePlan.scope = '产品名称被口语称为公司，按该产品的开发运营主体所属国家核查。';
          result.evidencePlan.criteria = [
            { question: '产品的开发运营主体是否为甲国公司？', requiredEvidence: '主体关系和该主体的甲国公司身份。', counterEvidence: '主体关系和该主体的非甲国公司身份。' },
            { question: '各个股东国籍是否为甲国？', requiredEvidence: '股东国籍记录。', counterEvidence: '非甲国国籍记录。' },
          ];
          return result;
        }
        const draft = verdictDraft(input.data);
        draft.chain[0].finding = '确认产品由北河公司开发运营。';
        draft.chain[0].gap = '未单独写明公司所在地，已由第二轮登记记录补齐。';
        draft.chain[1].finding = '同一主体登记在乙国。';
        draft.chain[1].gap = '未列出产品目录，产品关系由第一轮发布记录确认。';
        draft.criteriaReview[0].publicationRefs = input.data.publications.map(publication => ({ quoteId: publication.quoteId, basis: 'original-document' }));
        draft.criteriaReview[0].explanation = '发布记录确认产品归属北河公司，登记记录确认同一主体为乙国公司，两份原文共同否定甲国公司归属。';
        draft.criteriaReview[1] = { criterionId: 'c2', outcome: 'not_required', decisive: false, publicationRefs: [], explanation: '原句没有声称股东国籍；股东国籍不改变上述开发主体和公司身份，不是本次反驳必须补齐的环节。' };
        draft.rationale = '第一轮将产品连接到开发运营主体，第二轮确认同一公司在乙国登记。股东国籍不是原句中公司身份的必要条件。';
        if (defect === 'missing-link') { draft.unresolved = ['尚不能确认登记记录中的北河公司就是产品开发方，存在同名主体。']; draft.criteriaReview[0].decisive = false; }
        if (defect === 'all-indirect') draft.chain.forEach(item => { item.relevance = 'indirect'; });
        if (defect === 'uncited-anchor') {
          draft.criteriaReview[0].publicationRefs = [draft.criteriaReview[0].publicationRefs[1]];
          draft.chain[1].strength = 'weak';
        }
        if (defect === 'all-not-required') draft.criteriaReview[0] = { ...draft.criteriaReview[1], criterionId: 'c1' };
        return draft;
      },
    });
    const plan = await service.plan(planInput({ claim })), first = await service.research(researchInput(plan));
    const second = await service.research(researchInput(plan, { requestId: 'complementary-round-two', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.recommendation.materialId }));
    const publications = [first, second].map((result, index) => ({ roundId: `round-${index + 1}`, materialId: result.recommendation.materialId }));
    const { finalVerdict } = await service.verdict(verdictInput(plan, null, { publications }));
    assert.equal(finalVerdict.status, defect ? 'insufficient' : 'refuted', defect || 'complementary sources');
    assert.equal(finalVerdict.chain.length, 2);
    assert.ok(finalVerdict.chain.every(item => item.gap), 'a local limitation must remain visible even after the chain is complete');
    if (!defect) {
      assert.deepEqual(finalVerdict.unresolved, []);
      assert.match(finalVerdict.rationale, /同一公司/);
      assert.doesNotMatch(JSON.stringify(finalVerdict), /not_required|criteriaReview|routeRole/);
    }
    if (defect === 'missing-link') assert.match(finalVerdict.rationale, /同名主体/, 'downgrade explains the actual blocking gap');
    assert.equal(calls.model.filter(call => call.data.publications).length, 1, 'combination and branch review require no extra model call');
    assert.ok(calls.model.at(-1).data.priorGaps.includes('股东国籍尚未查询。'), 'earlier gaps are reviewed rather than silently deleted');
  }
});

test('a nonessential branch cannot itself claim to be the decisive refutation', async () => {
  const { service, calls } = chainFixtures(data => {
    const draft = verdictDraft(data); draft.criteriaReview[0].outcome = 'not_required'; return draft;
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  await rejects(service.verdict(verdictInput(plan, result)), 'INVESTIGATION_FORMAT');
  assert.equal(calls.model.filter(call => call.data.publications).length, 2);
  assert.match(calls.model.at(-1).data.validationIssue, /nonessential planning branch/);
});

test('a credible reported counterexample is enough without primary originals or completing every planned criterion', async () => {
  const { service, calls } = fixtures({
    retrieve: async () => ({ sources: [source(1, { title: '模型计费比较', summary: '相同日期、相同未缓存调用口径，每百万输入单位，甲模型为2元，乙模型为20元。' })] }),
    complete: async input => {
      if (input.data.sources) return compactAnalysis(input.data);
      if (!input.data.publications) {
        const plan = chainPlan();
        plan.evidencePlan.criteria = [
          { question: '是否有同口径收费更高的模型？', requiredEvidence: '没有可靠的更高收费反例。', counterEvidence: '一个同口径价格更高的模型。' },
          { question: '所有地区和缓存方案的收费是否已穷尽？', requiredEvidence: '完整产品目录。', counterEvidence: '遗漏的产品与方案。' },
        ];
        return plan;
      }
      const draft = verdictDraft(input.data);
      draft.confidence = 'medium';
      draft.summary = '乙模型在同一口径下收费更高，足以反驳甲模型最贵。';
      draft.unresolved = ['仍可补充官方原始价目和其余地区方案，不影响已有同口径反例。'];
      draft.chain[0].strength = 'limited';
      draft.chain[0].gap = '尚未取得厂商原始价目表，也没有穷尽地区和缓存优惠。';
      draft.criteriaReview = [{ ...draft.criteriaReview[0],
        publicationRefs: [{ quoteId: input.data.publications[0].quoteId, basis: 'secondary-assertion' }],
        explanation: '报道给出同单位同条件的具体价格，乙比甲高；绝对最高价说法已有反例，未查其余方案不影响该反例。',
      }];
      return draft;
    },
  });
  const plan = await service.plan(planInput({ claim: '甲模型是价格最贵的模型' }));
  const result = await service.research(researchInput(plan));
  const { finalVerdict } = await service.verdict(verdictInput(plan, result));
  assert.equal(finalVerdict.status, 'refuted');
  assert.equal(finalVerdict.confidence, 'medium');
  assert.equal(finalVerdict.chain[0].strength, 'limited');
  assert.match(finalVerdict.chain[0].gap, /原始价目表/);
  assert.match(finalVerdict.unresolved[0], /不影响已有同口径反例/);
  assert.equal(calls.model.filter(call => call.data.publications).length, 1);
});

test('an explicit decisive conflict cannot be relabeled a harmless outstanding question', async () => {
  const { service } = fixtures({ complete: async input => {
    if (input.data.sources) return compactAnalysis(input.data);
    if (!input.data.publications) {
      const plan = chainPlan();
      plan.evidencePlan.criteria.push({ question: '相同条件下是否有相反记录？', requiredEvidence: '直接的相反记录。', counterEvidence: '确认记录适用条件并不相同。' });
      return plan;
    }
    const draft = verdictDraft(input.data);
    draft.criteriaReview[1].outcome = 'supports';
    return draft;
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  const { finalVerdict } = await service.verdict(verdictInput(plan, result));
  assert.equal(finalVerdict.status, 'insufficient');
  assert.match(finalVerdict.rationale, /相反依据/);
});

test('final review rejects unknown or reassigned passage IDs and repairs without replaying a draft', async () => {
  for (const invalidRef of [{ quoteId: 'r1-s2-p1' }, { quoteId: 'unknown-passage' }, { materialId: 'unpublished' }, { roundId: 'round-2' }, { proofQuote: '伪造原文' }]) {
    const { service, calls } = chainFixtures(data => {
      const draft = verdictDraft(data);
      draft.criteriaReview[0].publicationRefs = [{ quoteId: data.publications[0].quoteId, basis: 'primary-observation', ...invalidRef }];
      return draft;
    });
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
    await rejects(service.verdict(verdictInput(plan, result)), 'INVESTIGATION_FORMAT');
    const attempts = calls.model.filter(call => call.data.publications);
    assert.equal(attempts.length, 2);
    assert.ok(attempts[1].data.validationIssue);
    assert.equal(attempts[1].data.previousDraft, undefined);
  }
  let count = 0;
  const { service } = chainFixtures(data => {
    const draft = verdictDraft(data);
    draft.criteriaReview[0].publicationRefs = [{ quoteId: ++count === 1 ? 'unknown-passage' : data.publications[0].quoteId, basis: 'primary-observation' }];
    return draft;
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal((await service.verdict(verdictInput(plan, result))).finalVerdict.status, 'refuted');
  assert.equal(count, 2);
});

test('server passage references still reject weak or materially incomplete refutations', async () => {
  for (const defect of ['gap', 'indirect', 'weak', 'missing-review', 'confidence', 'mixed-criterion']) {
    const { service } = chainFixtures(data => {
      const draft = verdictDraft(data);
      draft.criteriaReview.forEach(review => { review.publicationRefs = [{ quoteId: data.publications[0].quoteId, basis: 'primary-observation' }]; });
      if (defect === 'gap') { draft.unresolved = ['条件尚未核对。']; draft.criteriaReview[0].decisive = false; }
      if (defect === 'indirect') draft.chain[0].relevance = 'indirect';
      if (defect === 'weak') draft.chain[0].strength = 'weak';
      if (defect === 'missing-review') draft.criteriaReview = [];
      if (defect === 'confidence') draft.confidence = 'low';
      if (defect === 'mixed-criterion') draft.criteriaReview[0].outcome = 'mixed';
      return draft;
    });
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
    assert.equal((await service.verdict(verdictInput(plan, result))).finalVerdict.status, 'insufficient', defect);
  }
});

test('a mixed criterion is a valid unresolved audit outcome without requiring a repair', async () => {
  const { service, calls } = chainFixtures(data => {
    const draft = verdictDraft(data, { status: 'mixed', confidence: 'medium', unresolved: ['不同条件下的记录仍有冲突。'] });
    draft.criteriaReview[0].outcome = 'mixed'; draft.criteriaReview[0].decisive = false;
    return draft;
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal((await service.verdict(verdictInput(plan, result))).finalVerdict.status, 'mixed');
  assert.equal(calls.model.filter(call => call.data.publications).length, 1);
});

test('a counterclaim drives independent searches while refresh and later rounds preserve the original claim and bind real criteria', async () => {
  const claim = '在中国可以正常使用 Claude Code';
  const target = '中国大陆用户是否受到服务地域限制，或必须依赖改变原有条件的替代路径？';
  const initial = chainPlan();
  initial.evidencePlan.refutationTarget = target;
  initial.evidencePlan.criteria = [
    { question: '服务地域规则是否限制中国大陆用户？', requiredEvidence: '当前服务规则明确覆盖中国大陆。', counterEvidence: '当前原始规则明确排除中国大陆。' },
    { question: '所谓可用案例是否依赖中转或更换模型？', requiredEvidence: '可核验的官方直连、原模型完整使用记录。', counterEvidence: '同一案例记录必须中转或更换模型。' },
  ];
  initial.leads = [
    { ...initial.leads[0], title: '核对服务地域', question: 'Claude Code 的服务范围是否排除中国大陆？', searchQuery: 'Claude Code 中国大陆 服务区域 限制 条款', criterionId: 'c1' },
    { ...initial.leads[1], title: '追查使用失败', question: '中国大陆的 Claude Code 使用失败记录能说明什么？', searchQuery: 'Claude Code 中国大陆 无法访问 使用失败 记录', criterionId: 'c1' },
  ];
  const alternatives = [
    { ...initial.leads[0], title: '追查中转依赖', question: 'Claude Code 的国内案例是否依赖中转服务？', searchQuery: 'Claude Code 国内 案例 中转 依赖 条件', criterionId: 'c2' },
    { ...initial.leads[1], title: '辨认模型替换', question: 'Claude Code 的可用演示是否替换了原模型？', searchQuery: 'Claude Code 国内 演示 替代模型 限制', criterionId: 'c2' },
  ];
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ sources: [source(count * 2 - 1), source(count * 2)] }),
    complete: async input => input.data.sources ? analysis(input.data, {
      nextLeads: alternatives,
      assessment: { status: 'mixed', summary: '可用案例依赖额外条件，尚不能完全否定原观点。' },
      chainAssessment: { relation: 'limits', finding: '案例依赖中转或替代模型，需要继续核对条件。', unresolved: ['是否存在同一条件下的官方直连记录？'], nextCriterionId: 'c2' },
    })
      : input.data.issuedLeads ? { leads: alternatives } : structuredClone(initial),
  });
  const plan = await service.plan(planInput({ claim }));
  const refreshed = await service.refresh(refreshInput(plan));
  assert.equal(calls.model[1].data.evidencePlan.refutationTarget, target);
  const selected = refreshed.leads.find(lead => lead.title === '追查中转依赖');
  const firstInput = researchInput(plan, { leadId: selected.id, claim: '伪造的原观点', criterion: { id: 'c1' } });
  const first = await service.research(firstInput);
  const firstData = calls.model.at(-1).data;
  assert.equal(calls.search[0], alternatives[0].searchQuery);
  assert.equal(first.query, selected.question);
  assert.equal(first.claim, claim);
  assert.equal(first.assessment.status, 'mixed');
  assert.equal(firstData.claim, claim);
  assert.equal(firstData.evidencePlan.proposition, claim);
  assert.equal(firstData.evidencePlan.refutationTarget, target);
  assert.deepEqual(firstData.criterion, { id: 'c2', ...initial.evidencePlan.criteria[1] });
  const selectedNext = first.nextLeads.find(lead => lead.title === '辨认模型替换');
  const second = await service.research(researchInput(plan, { requestId: 'falsification-round-two', roundId: 'round-2', leadId: selectedNext.id, promotedId: first.recommendation.materialId }));
  const secondData = calls.model.at(-1).data;
  assert.deepEqual(calls.search, alternatives.map(lead => lead.searchQuery));
  assert.equal(secondData.evidencePlan.refutationTarget, target);
  assert.equal(secondData.criterion.id, 'c2');
  assert.equal(secondData.history[0].question, selected.question);
  assert.equal(secondData.history[0].chain.relation, 'limits');
  assert.equal(secondData.history[0].assessment.status, 'mixed', 'a condition limit remains distinct from a full refutation in the next round');
  assert.equal(secondData.history.at(-1).materials.find(material => material.promoted).finding, first.materials.find(item => item.id === first.recommendation.materialId).insight.explanation);
  assert.equal(second.claim, claim);
  for (const publicValue of [plan, refreshed, first, second, service.progress(firstInput)]) {
    assert.doesNotMatch(JSON.stringify(publicValue), /refutationTarget|criterionId|routeRole|sourceRanking/);
    assert.equal(JSON.stringify(publicValue).includes(target), false);
  }
  for (const lead of [...plan.leads, ...refreshed.leads, ...first.nextLeads]) assert.deepEqual(Object.keys(lead).sort(), ['id', 'question', 'reason', 'title']);
});

test('missing counterclaims, copied assertions and unbound criteria cannot commit a plan', async () => {
  for (const defect of ['missing-target', 'copied-target', 'unknown-criterion']) {
    let valid = false;
    const { service, calls } = fixtures({ complete: async input => {
      const result = chainPlan();
      if (!valid) {
        if (defect === 'missing-target') result.evidencePlan.refutationTarget = undefined;
        if (defect === 'copied-target') result.evidencePlan.refutationTarget = input.data.claim;
        if (defect === 'unknown-criterion') result.leads[0].criterionId = 'c999';
      }
      return result;
    } });
    const input = planInput();
    await rejects(service.plan(input), 'INVESTIGATION_FORMAT');
    assert.equal(calls.model.length, 2, defect);
    assert.equal(calls.search.length, 0, defect);
    assert.match(calls.model.at(-1).data.validationIssue, /refutationTarget|criterionId/);
    valid = true;
    assert.equal((await service.plan(input)).leads.length, 2);
    assert.equal(calls.model.length, 3, 'a failed plan is not cached as a session');
  }
});

test('refresh and result repairs validate questions and criterion bindings before publishing directions', async () => {
  for (const stage of ['refresh', 'analysis']) {
    for (const defect of ['criterionId', 'question']) {
      let attempts = 0;
      const { service, calls } = fixtures({ complete: async input => {
        if (!input.data.issuedLeads && !input.data.sources) return chainPlan();
        const result = input.data.sources ? analysis(input.data) : { leads: refreshedLeads() };
        const active = stage === 'refresh' ? Boolean(input.data.issuedLeads) : Boolean(input.data.sources);
        if (active && ++attempts === 1) (result.leads || result.nextLeads)[0][defect] = defect === 'criterionId' ? 'c404' : undefined;
        return result;
      } });
      const plan = await service.plan(planInput());
      const refreshed = stage === 'refresh' ? await service.refresh(refreshInput(plan)) : plan;
      const result = await service.research(researchInput(plan, { leadId: refreshed.leads[0].id }));
      assert.equal(attempts, 2, `${stage}: ${defect}`);
      assert.ok(calls.model.some(call => call.data.validationIssue?.includes(defect)));
      assert.equal(calls.search.length, 1, 'field repair does not repeat paid searches');
      assert.equal(result.nextLeads.length, 2);
      assert.equal(calls.model.at(-1).data.criterion.id, 'c1');
    }
  }
});

test('overlong search suggestions do not weaken role and criterion validation after a followup', async () => {
  let analyses = 0;
  const { service, calls } = fixtures({ complete: async input => {
    if (!input.data.sources) return chainPlan();
    if (++analyses === 1) return { action: 'search', followupQuery: '原始记录是否存在同样条件下的反例？' };
    const result = analysis(input.data, { nextLeads: chainPlan().leads });
    if (analyses === 2) {
      result.nextLeads[0].searchQuery = 'A'.repeat(65);
      result.nextLeads[1].searchQuery = 'B'.repeat(76);
      result.nextLeads[1].routeRole = 'direct';
      result.nextLeads[0].criterionId = 'c404';
    } else {
      assert.equal(input.data.canSearch, false);
      assert.match(input.data.validationIssue, /nextLeads\.routeRole: one direct and one indirect required/);
      assert.doesNotMatch(input.data.validationIssue, /searchQuery/);
      assert.match(input.data.validationIssue, /nextLeads\[0\]\.criterionId: bind this direction/);
      assert.doesNotMatch(input.data.validationIssue, /nextLeads\[1\]\.criterionId/);
      assert.equal(input.data.previousDraft.nextLeads[0].searchQuery.length, 65);
      assert.equal(input.data.previousDraft.nextLeads[1].searchQuery.length, 76);
    }
    return result;
  } });
  const plan = await service.plan(planInput()), input = researchInput(plan);
  const result = await service.research(input);
  assert.equal(analyses, 3);
  assert.equal(calls.search.length, 2);
  assert.equal(service.progress(input).status, 'completed');
  assert.deepEqual(calls.diagnostic, []);
  acceptInEngine(plan, result);
});

test('invalid optional queries use the complete chosen question without another model call in plans, refreshes or later rounds', async () => {
  const question = '在相同条件下是否仍无法获得官方服务？';
  const validQuery = '官方服务 相同条件 无法获得 记录';
  for (const stage of ['plan', 'refresh', 'next']) {
    for (const query of [undefined, null, 42, '', 'x', '查\u0000证', '查'.repeat(65), '查'.repeat(76), validQuery]) {
      const { service, calls } = fixtures({
        retrieve: async (_query, count) => ({ sources: [source(count * 2 - 1), source(count * 2)] }),
        complete: async input => {
          const draft = input.data.sources ? compactAnalysis(input.data) : input.data.issuedLeads ? { leads: refreshedLeads() } : chainPlan();
          const active = stage === 'plan' ? Boolean(input.schema.evidencePlan) : stage === 'refresh' ? Boolean(input.data.issuedLeads) : input.data.round === 1;
          if (active) Object.assign((draft.leads || draft.nextLeads)[0], { title: '核对受限条件', question, searchQuery: query });
          return draft;
        },
      });
      const plan = await service.plan(planInput());
      const directions = stage === 'refresh' ? (await service.refresh(refreshInput(plan))).leads : plan.leads;
      let result;
      if (stage === 'next') {
        const first = await service.research(researchInput(plan));
        result = await service.research(researchInput(plan, { requestId: 'fallback-query-round2', roundId: 'round-2', promotedId: first.recommendation.materialId,
          leadId: first.nextLeads.find(lead => lead.question === question).id }));
      } else result = await service.research(researchInput(plan, { leadId: directions.find(lead => lead.question === question).id }));
      assert.equal(calls.search.at(-1), query === validQuery ? validQuery : question, `${stage}: preserve the entire validated question, including negation`);
      assert.equal(calls.model.length, stage === 'plan' ? 2 : 3, 'only planning, the requested refresh and one call per research round');
      assert.ok(calls.model.every(call => !call.data.validationIssue));
      assert.deepEqual(calls.diagnostic, []);
      assert.equal(result.materials.length, 1);
      if (stage !== 'next') acceptInEngine({ ...plan, leads: directions }, result);
    }
  }
});

test('a valid optional query cannot rescue a missing or oversized player question', async () => {
  for (const stage of ['plan', 'next']) {
    for (const question of [undefined, '', '问'.repeat(65)]) {
      const { service, calls } = fixtures({ complete: async input => {
        const draft = input.data.sources ? compactAnalysis(input.data) : chainPlan();
        if (stage === 'plan' || input.data.sources) Object.assign((draft.leads || draft.nextLeads)[0], { question, searchQuery: '完整但不能替代玩家问题的检索词' });
        return draft;
      } });
      if (stage === 'plan') await rejects(service.plan(planInput()), 'INVESTIGATION_FORMAT');
      else {
        const plan = await service.plan(planInput());
        await rejects(service.research(researchInput(plan)), 'INVESTIGATION_FORMAT');
      }
      assert.equal(calls.model.length, stage === 'plan' ? 2 : 3);
      assert.match(calls.model.at(-1).data.validationIssue, /\[0\]\.question:/);
      assert.equal(calls.search.length, stage === 'plan' ? 0 : 1);
    }
  }
});

test('non-text lead fields produce repairable format errors rather than type errors', async () => {
  for (const field of ['title', 'question', 'reason']) {
    for (const value of [null, 42]) {
      const { service, calls } = fixtures({ complete: async () => {
        const result = chainPlan();
        result.leads[0][field] = value;
        return result;
      } });
      await rejects(service.plan(planInput()), 'INVESTIGATION_FORMAT');
      assert.equal(calls.model.length, 2, `${field}=${value}`);
      assert.ok(calls.model[1].data.validationIssue.includes(`leads[0].${field}:`));
      assert.match(calls.model[1].data.validationIssue, /received no text/);
      assert.equal(calls.search.length, 0);
    }
  }
});

test('evidence relation breaks quality ties in favor of refutation without letting weak negative material beat direct strong support', async () => {
  const cases = [
    { relation: 'contradicts', relevance: 'direct', strength: 'strong', expected: 2 },
    { relation: 'limits', relevance: 'direct', strength: 'strong', expected: 2 },
    { relation: 'contradicts', relevance: 'indirect', strength: 'weak', expected: 1 },
    { relation: 'contradicts', relevance: 'direct', strength: 'weak', expected: 1 },
  ];
  for (const candidate of cases) {
    const { service } = fixtures({ complete: async input => {
      if (!input.data.sources) return chainPlan();
      return analysis(input.data, {
        sourceRanking: input.data.sources.map((item, index) => ({ sourceId: item.id, relevance: index ? candidate.relevance : 'direct', strength: index ? candidate.strength : 'strong', relation: index ? candidate.relation : 'supports', reason: index ? '所选原文指出相反观察或条件限制。' : '直接记录支持原观点，必须纳入核对。' })),
      });
    } });
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
    const chosen = result.materials.find(item => item.id === result.recommendation.materialId);
    assert.equal(chosen.sources[0].url, source(candidate.expected).url, JSON.stringify(candidate));
    assert.equal(result.materials.length, 2, 'both corroborating and adverse records remain available');
  }
});

test('falsification intent does not invert supporting research or the independent final verdict', async () => {
  const { service, calls } = fixtures({ complete: async input => {
    if (input.data.publications) {
      const result = verdictDraft(input.data, { status: 'supported', summary: '公布的直接记录支持原始观点，反驳未成立。' });
      for (const item of result.criteriaReview) item.outcome = 'supports';
      return result;
    }
    if (!input.data.sources) return chainPlan();
    return analysis(input.data, {
      assessment: { status: 'supported', summary: '实际记录支持原始观点，不能作为反证。' },
      sourceRanking: input.data.sources.map(item => ({ sourceId: item.id, relevance: 'direct', strength: 'strong', relation: 'supports', reason: '记录直接对应原命题的条件。' })),
      chainAssessment: { relation: 'supports', finding: '本次尝试未找到反例。', unresolved: [], nextCriterionId: 'c1' },
    });
  } });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(result.assessment.status, 'supported');
  const audit = await service.verdict(verdictInput(plan, result));
  assert.equal(audit.finalVerdict.status, 'supported');
  assert.equal(calls.model.at(-1).data.claim, plan.claim);
  assert.equal(calls.model.at(-1).data.evidencePlan.refutationTarget, chainPlan().evidencePlan.refutationTarget);
  assert.equal(calls.search.length, 1, 'final review audits actual published evidence without silently searching for a desired answer');
});

test('a reproducible success can refute a negative universal claim without query negation or evidence filtering', async () => {
  const claim = '这项服务从未在本地成功响应';
  const searchQuery = '该服务 本地 成功响应 原始日志 可复现 测试记录';
  const success = source(2, { title: '本地响应测试原始日志', summary: '测试在本地直接请求该服务，原始日志记录了请求参数、执行时间以及成功响应结果，同一条件重复测试三次均成功。' });
  const { service, calls } = fixtures({
    retrieve: async () => ({ sources: [source(1, { summary: '论坛有人报告曾经连接失败，未公开请求日志。' }), success] }),
    complete: async input => {
      if (!input.data.sources) {
        const result = chainPlan();
        result.evidencePlan.refutationTarget = '寻找至少一次在本地成功响应的可核验记录，检验“从未成功”的断言。';
        result.evidencePlan.criteria = [{ question: '是否存在一次条件明确的本地成功响应？', requiredEvidence: '原始记录未出现本地成功响应，仍不足以证明从未成功。', counterEvidence: '一次可核验且可复现的本地成功响应即可反驳从未成功。' }];
        result.leads[0] = { ...result.leads[0], title: '复核成功记录', question: '这项服务是否有可复现的本地成功响应日志？', searchQuery };
        return result;
      }
      return analysis(input.data, {
        assessment: { status: 'refuted', summary: '可复现的本地成功响应记录足以推翻从未成功的断言。' },
        sourceRanking: input.data.sources.map((item, index) => ({ sourceId: item.id, relevance: index ? 'direct' : 'indirect', strength: index ? 'strong' : 'weak', relation: index ? 'contradicts' : 'context', reason: index ? '同一条件下的成功响应是从未成功这一全称否定的直接反例。' : '单次失败传闻不能证明从未成功。' })),
        chainAssessment: { relation: 'contradicts', finding: '找到了可复现的成功反例。', unresolved: [], nextCriterionId: 'c1' },
      });
    },
  });
  const plan = await service.plan(planInput({ claim }));
  const selected = plan.leads.find(lead => lead.title === '复核成功记录');
  const result = await service.research(researchInput(plan, { leadId: selected.id }));
  assert.deepEqual(calls.search, [searchQuery]);
  assert.equal(result.claim, claim);
  assert.equal(calls.model.at(-1).data.claim, claim);
  assert.equal(calls.model.at(-1).data.evidencePlan.proposition, claim);
  assert.equal(result.assessment.status, 'refuted');
  const chosen = result.materials.find(item => item.id === result.recommendation.materialId);
  assert.equal(chosen.sources[0].url, success.url);
  assert.equal(chosen.insight.quote, success.summary);
});
test('compact source-ranking rows preserve all sixteen sources and their judgments with less JSON overhead', async () => {
  const asRow = item => [item.sourceId, item.relevance, item.strength, item.relation, item.reason];
  const { service, calls } = fixtures({
    retrieve: async () => ({ sources: Array.from({ length: 16 }, (_, index) => source(index + 1)) }),
    complete: async input => {
      if (!input.data.sources) return chainPlan();
      assert.equal(input.schema.sourceRanking[0].length, 5);
      assert.equal(input.data.sources.length, 16, 'smaller output must not discard contrary or lower-ranked sources');
      const result = compactAnalysis(input.data);
      const original = JSON.stringify(result.sourceRanking);
      result.sourceRanking = result.sourceRanking.map(asRow);
      assert.ok(Buffer.byteLength(JSON.stringify(result.sourceRanking)) < Buffer.byteLength(original) * 0.7);
      return result;
    },
  });
  const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
  assert.equal(calls.model.length, 2, 'a valid compact ranking needs only one research model call');
  assert.equal(calls.search.length, 1);
  assert.equal(result.materials[0].sources[0].url, source(16).url);
  assert.equal(result.recommendation.reason, '同等直接的记录，但适用条件仍待核对。');
  assert.doesNotMatch(JSON.stringify(result), /sourceRanking|routeRole|criterionId/);
  acceptInEngine(plan, result);
});

test('compact source-ranking rows reject incomplete coverage, invalid grades and missing reasons', async () => {
  const defects = [
    rows => rows.pop(),
    rows => { rows[1][0] = rows[0][0]; },
    rows => { rows[0][0] = 's999'; },
    rows => rows[0].pop(),
    rows => rows[0].push('unexpected column'),
    rows => { rows[0][1] = 'related'; },
    rows => { rows[0][2] = 'certain'; },
    rows => { rows[0][3] = 'false'; },
    rows => { rows[0][4] = ''; },
    rows => { rows[0][4] = null; },
  ];
  for (const corrupt of defects) {
    const { service } = fixtures({ complete: async input => {
      if (!input.data.sources) return chainPlan();
      const result = compactAnalysis(input.data);
      result.sourceRanking = result.sourceRanking.map(item => [item.sourceId, item.relevance, item.strength, item.relation, item.reason]);
      corrupt(result.sourceRanking);
      return result;
    } });
    const plan = await service.plan(planInput());
    await rejects(service.research(researchInput(plan)), 'INVESTIGATION_FORMAT');
  }
});

test('compact source-ranking rows cannot hide stronger direct support behind a weaker counterclaim', async () => {
  const { service } = fixtures({ complete: async input => {
    if (!input.data.sources) return chainPlan();
    const result = compactAnalysis(input.data);
    result.sourceRanking = input.data.sources.map((item, index) => [item.id, 'direct', index ? 'limited' : 'strong', index ? 'contradicts' : 'supports', '直接记录必须按事实强度核对。']);
    return result;
  } });
  const plan = await service.plan(planInput());
  await rejects(service.research(researchInput(plan)), 'INVESTIGATION_FORMAT');
});
test('one ranking repair reports independent errors across every row without echoing invalid model values', async () => {
  for (const tuples of [false, true]) {
    let attempts = 0;
    const marker = 'private-invalid-model-value';
    const { service, calls } = fixtures({ complete: async input => {
      if (!input.data.sources) return chainPlan();
      const result = compactAnalysis(input.data);
      if (++attempts === 1) {
        result.sourceRanking[0].relevance = marker;
        result.sourceRanking[0].relation = marker;
        result.sourceRanking[1].strength = marker;
        result.sourceRanking[1].reason = null;
      } else {
        for (const field of ['sourceRanking[0].relevance', 'sourceRanking[0].relation', 'sourceRanking[1].strength', 'sourceRanking[1].reason']) assert.ok(input.data.validationIssue.includes(field));
        assert.equal(input.data.validationIssue.split('; ').length, 4);
        assert.ok(!input.data.validationIssue.includes(marker));
      }
      if (tuples) result.sourceRanking = result.sourceRanking.map(item => [item.sourceId, item.relevance, item.strength, item.relation, item.reason]);
      return result;
    } });
    const plan = await service.plan(planInput()), result = await service.research(researchInput(plan));
    assert.equal(attempts, 2, 'all ranking fields are repaired in a single extra call');
    assert.equal(calls.search.length, 1);
    assert.deepEqual(calls.diagnostic, []);
    acceptInEngine(plan, result);
  }
});

test('a repeated selection error after a successful followup retains the final fourth-call repair', async () => {
  let attempts = 0, firstIssue;
  const { service, calls } = fixtures({
    retrieve: async (_query, count) => ({ sources: (count < 3 ? [1, 2] : [3]).map(index => source(index)) }),
    complete: async input => {
      if (!input.data.sources) return chainPlan();
      if (input.data.round === 1) return compactAnalysis(input.data);
      attempts++;
      if (attempts === 2) {
        firstIssue = input.data.validationIssue;
        assert.match(firstIssue, /highest-ranked usable/);
        assert.equal(input.data.canSearch, true);
        return { action: 'search', followupQuery: '独立观测是否提供不同的适用条件？' };
      }
      if (attempts === 4) {
        assert.equal(input.data.validationIssue, firstIssue, 'newly retrieved material gives the same repair message a new context');
        assert.equal(input.data.canSearch, false);
      }
      const selectedIndex = input.data.sources.findIndex(item => item.url === source(attempts === 4 ? 1 : 2).url);
      const result = compactAnalysis(input.data, selectedIndex);
      result.sourceRanking = input.data.sources.map(item => {
        const background = item.url === source(3).url;
        return [item.id, background ? 'indirect' : 'direct', background ? 'weak' : 'strong', 'limits', '保留记录的适用范围，不能换引文冒充新发现。'];
      });
      return result;
    },
  });
  const plan = await service.plan(planInput()), first = await service.research(researchInput(plan));
  const input = researchInput(plan, { requestId: 'repeat-error-after-followup', roundId: 'round-2', leadId: first.nextLeads[0].id, promotedId: first.materials[0].id });
  const result = await service.research(input);
  assert.equal(attempts, 4);
  assert.equal(calls.search.length, 3, 'one initial-round search and two second-round searches');
  assert.equal(result.materials[0].sources[0].url, source(1).url);
  assert.equal(service.progress(input).status, 'completed');
  assert.deepEqual(calls.diagnostic, []);
});
