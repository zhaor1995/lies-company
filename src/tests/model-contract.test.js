import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelContract, modelFormatIssue } from '../server/model-contract.mjs';

const leadShape = [{ title: '调查动作', question: '要核对的问题', reason: '调查理由', searchQuery: '检索词', criterionId: '证据标准' }];
const researchShape = { evidence: { headline: '证据标题', explanation: '证据解释', quoteId: '新原文编号' }, finding: '本轮发现', assessment: {}, sourceRanking: [], chainAssessment: {}, nextLeads: leadShape };
const data = { claim: '所有天鹅都是白色的', canSearch: true,
  evidencePlan: { criteria: [{ id: 'c1' }, { id: 'c2' }] },
  sources: [
    { id: 's1', passages: [{ id: 's1-p1', previouslyUsed: true }, { id: 's1-p2', previouslyUsed: false }] },
    { id: 's2', passages: [{ id: 's2-p1', previouslyUsed: false }] },
  ],
};
const directions = () => Object.fromEntries(['direct', 'indirect'].map(role => [role, { title: `${role}调查动作`, question: `${role}核对天鹅的颜色？`, reason: '寻找实际观察记录', searchQuery: '天鹅颜色观察记录', criterionId: 'c1' }]));
const finalArgs = () => ({ result: { action: 'final', sourceRanking: {
  s1: { relevance: 'direct', strength: 'strong', relation: 'contradicts', reason: '有实际观察记录' },
  s2: { relevance: 'indirect', strength: 'limited', relation: 'context', reason: '仅供背景核对' },
}, evidence: { headline: '发现黑天鹅的记录', explanation: '观察到的黑天鹅构成反例。', quoteId: 's1-p2' }, finding: '已有反例',
assessment: { status: 'refuted', summary: '绝对说法被一个适用反例推翻。' }, chainAssessment: { unresolved: [] }, nextLeads: directions() } });
const formatFailure = error => error.code === 'MODEL_FORMAT' && !error.message.includes('private-test');
const research = (extra = {}, schema = researchShape) => createModelContract({ schema, data: { ...data, ...extra } });

function strictObjects(schema, definitions = schema.$defs || {}) {
  if (schema.$ref) {
    const name = schema.$ref.slice('#/$defs/'.length);
    assert.ok(Object.hasOwn(definitions, name));
    strictObjects(definitions[name], definitions);
  }
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    Object.values(schema.properties).forEach(field => strictObjects(field, definitions));
  }
  if (schema.items) strictObjects(schema.items, definitions);
  schema.anyOf?.forEach(branch => strictObjects(branch, definitions));
  if (schema.enum) assert.ok(schema.enum.length > 0, 'strict schemas never use an empty enum');
}

test('research schema fixes one ranking slot per source and only permits fresh original passages', () => {
  const contract = research();
  strictObjects(contract.parameters);
  const finalSchema = contract.parameters.properties.result.anyOf[0];
  assert.deepEqual(finalSchema.properties.sourceRanking.required, ['s1', 's2']);
  assert.deepEqual(finalSchema.properties.evidence.properties.quoteId.enum, ['s1-p2', 's2-p1']);
  assert.deepEqual(finalSchema.properties.nextLeads.required, ['direct', 'indirect']);
  assert.equal(finalSchema.properties.evidence.properties.headline.description, '证据标题');
  const args = finalArgs(), output = contract.assemble(args);
  assert.equal(output.action, 'final');
  assert.deepEqual(output.sourceRanking.map(item => item.sourceId), ['s1', 's2']);
  assert.deepEqual(output.nextLeads.map(item => item.routeRole), ['direct', 'indirect']);
  output.sourceRanking[0].reason = 'changed';
  assert.equal(args.result.sourceRanking.s1.reason, '有实际观察记录', 'assembled objects do not alias model arguments');
});

test('repeated source and direction field definitions are shared instead of expanding the prompt', () => {
  const contract = research();
  const finalSchema = contract.parameters.properties.result.anyOf[0];
  assert.deepEqual(finalSchema.properties.sourceRanking.properties.s1, finalSchema.properties.sourceRanking.properties.s2);
  assert.ok(finalSchema.properties.sourceRanking.properties.s1.$ref);
  assert.deepEqual(finalSchema.properties.nextLeads.properties.direct, finalSchema.properties.nextLeads.properties.indirect);
  assert.ok(finalSchema.properties.nextLeads.properties.direct.$ref);
  assert.equal(Object.keys(contract.parameters.$defs).length, 2);
});

test('missing or unknown source slots cannot reach business normalization', () => {
  const contract = research();
  for (const alter of [
    args => { delete args.result.sourceRanking.s2; },
    args => { args.result.sourceRanking.s3 = args.result.sourceRanking.s2; },
    args => { args.result.sourceRanking = [{ sourceId: 's1' }]; },
    args => { args.result.sourceRanking.s1.sourceId = 's2'; },
  ]) {
    const args = finalArgs(); alter(args);
    assert.throws(() => contract.assemble(args), formatFailure);
  }
});

test('unknown, old and mutated evidence references are rejected', () => {
  for (const quoteId of ['private-test', 's1-p1', '', 's3-p1']) {
    const args = finalArgs(); args.result.evidence.quoteId = quoteId;
    assert.throws(() => research().assemble(args), formatFailure);
  }
  const args = finalArgs(); args.result.evidence.quote = 'private-test';
  assert.throws(() => research().assemble(args), formatFailure);
});

test('direction slots prevent omitted roles, invented criteria and role overrides', () => {
  for (const alter of [
    args => { delete args.result.nextLeads.indirect; },
    args => { args.result.nextLeads.direct.criterionId = 'c3'; },
    args => { args.result.nextLeads.indirect.routeRole = 'direct'; },
    args => { args.result.nextLeads.indirect.question = 'x'; },
  ]) {
    const args = finalArgs(); alter(args);
    assert.throws(() => research().assemble(args), formatFailure);
  }
});

test('optional query fallback still requires a complete valid question', () => {
  const args = finalArgs();
  args.result.nextLeads.direct.searchQuery = 'x'.repeat(65);
  assert.equal(research().assemble(args).nextLeads[0].searchQuery, args.result.nextLeads.direct.question);
  assert.equal(args.result.nextLeads.direct.searchQuery.length, 65, 'validation must not mutate model arguments');
  args.result.nextLeads.direct.question = 'x'.repeat(65);
  assert.throws(() => research().assemble(args), error => /nextLeads.direct.question/.test(modelFormatIssue(error)));
});

test('format diagnostics collect actionable schema paths without provider values or unknown keys', () => {
  const args = finalArgs();
  args.result.sourceRanking.s1.strength = 'private-test-value';
  args.result.nextLeads.direct = [];
  args.result.nextLeads.indirect['private-test-key'] = 'private-test-value';
  assert.throws(() => research().assemble(args), error => {
    const issue = modelFormatIssue(error);
    assert.match(issue, /sourceRanking.s1.strength: choose one of strong, limited, weak/);
    assert.match(issue, /nextLeads.direct: expected one object/);
    assert.match(issue, /nextLeads.indirect: remove unexpected fields/);
    assert.doesNotMatch(issue, /private-test|followupQuery/);
    return formatFailure(error);
  });
  assert.equal(modelFormatIssue({ code: 'MODEL_FORMAT', validationIssue: 'private-test-value' }), undefined);
});

test('no search branch exists once the search budget is exhausted', () => {
  const contract = research({ canSearch: false });
  assert.deepEqual(contract.parameters.properties.result.properties.action.enum, ['final']);
  assert.throws(() => contract.assemble({ result: { action: 'search', followupQuery: '补查天鹅颜色' } }), formatFailure);
  assert.equal(contract.assemble(finalArgs()).action, 'final');
});

test('empty or entirely used sources permit only a bounded follow-up query', () => {
  for (const sources of [[], [{ id: 's1', passages: [{ id: 's1-p1', previouslyUsed: true }] }]]) {
    const contract = research({ sources });
    strictObjects(contract.parameters);
    assert.deepEqual(contract.parameters.properties.result.properties.action.enum, ['search']);
    assert.deepEqual(contract.assemble({ result: { action: 'search', followupQuery: '黑天鹅观察记录' } }), { action: 'search', followupQuery: '黑天鹅观察记录' });
    assert.throws(() => contract.assemble(finalArgs()), formatFailure);
    assert.throws(() => research({ sources, canSearch: false }), error => error.code === 'NO_NEW_EVIDENCE');
  }
});

test('final round restores an empty nextLeads array without asking the model to write it', () => {
  const contract = research({}, { ...researchShape, nextLeads: [] });
  const args = finalArgs(); delete args.result.nextLeads;
  assert.deepEqual(contract.assemble(args).nextLeads, []);
  assert.throws(() => contract.assemble(finalArgs()), formatFailure);
});

test('local validation rejects wrong enums, control characters, whitespace, extra fields and nulls', () => {
  for (const alter of [
    args => { args.result.sourceRanking.s1.strength = 'private-test'; },
    args => { args.result.evidence.explanation = '\nprivate-test'; },
    args => { args.result.finding = '  '; },
    args => { args.result.assessment.extra = 'private-test'; },
    args => { args.extra = 'private-test'; },
    args => { args.result.chainAssessment.unresolved = null; },
    args => { args.result.chainAssessment.unresolved = Array(7).fill('待核对'); },
    args => { args.result.evidence.headline = '字'.repeat(121); },
  ]) {
    const args = finalArgs(); alter(args);
    assert.throws(() => research().assemble(args), formatFailure);
  }
});

test('length validation counts Unicode characters, not UTF-16 code units', () => {
  const args = finalArgs(); args.result.evidence.headline = '🦢'.repeat(120);
  assert.equal(research().assemble(args).evidence.headline, args.result.evidence.headline);
});

test('plan leaves proposition and routeRole to the program and preserves variable criteria', () => {
  const schema = { evidencePlan: { refutationTarget: '反证目标', scope: '命题范围', criteria: [{}] }, leads: leadShape };
  const contract = createModelContract({ schema, data: { claim: data.claim } });
  strictObjects(contract.parameters);
  assert.equal(contract.phase, 'plan');
  assert.deepEqual(Object.keys(contract.template), ['evidencePlan', 'leads']);
  assert.equal(contract.template.evidencePlan.criteria.length, 1);
  assert.deepEqual(Object.keys(contract.template.leads), ['direct', 'indirect']);
  assert.equal(Array.isArray(contract.template.leads.direct), false);
  assert.deepEqual(Object.values(contract.template.leads.direct), ['', '', '', '', '']);
  assert.doesNotMatch(JSON.stringify(contract.template), /\$ref|routeRole|proposition/);
  assert.equal(contract.parameters.properties.evidencePlan.properties.proposition, undefined);
  const args = { evidencePlan: { refutationTarget: '存在非白色天鹅', scope: '所有实际天鹅的颜色', criteria: [{ question: '是否有黑天鹅记录', requiredEvidence: '全部颜色观察', counterEvidence: '可信的黑天鹅观察' }] }, leads: directions() };
  const output = contract.assemble(args);
  assert.equal(output.evidencePlan.proposition, data.claim);
  assert.deepEqual(output.leads.map(item => item.routeRole), ['direct', 'indirect']);
  for (const criteria of [[], Array(6).fill(args.evidencePlan.criteria[0])]) assert.throws(() => contract.assemble({ ...args, evidencePlan: { ...args.evidencePlan, criteria } }), formatFailure);
  assert.throws(() => contract.assemble({ ...args, evidencePlan: { ...args.evidencePlan, proposition: 'private-test' } }), formatFailure);
});

test('refresh and direction-only repair share fixed roles and known criterion IDs', () => {
  for (const field of ['leads', 'nextLeads']) {
    const contract = createModelContract({ schema: { [field]: leadShape }, data });
    assert.equal(contract.phase, field === 'leads' ? 'refresh' : 'repair_leads');
    strictObjects(contract.parameters);
    assert.deepEqual(contract.assemble({ [field]: directions() })[field].map(item => item.routeRole), ['direct', 'indirect']);
  }
  const empty = createModelContract({ schema: { nextLeads: [] }, data: { sources: [], round: 5 } });
  assert.deepEqual(empty.parameters, { type: 'object', properties: {}, required: [], additionalProperties: false });
  assert.deepEqual(empty.assemble({}), { nextLeads: [] });
  assert.throws(() => empty.assemble({ evidence: {} }), formatFailure);
});

const verdictData = { claim: data.claim, evidencePlan: data.evidencePlan, publications: [
  { roundId: 'round-1', sources: [{ passages: [{ id: 'r1-s1-p1' }] }] },
  { roundId: 'round-3', sources: [{ passages: [{ id: 'r3-s1-p1' }] }] },
] };
const verdictArgs = () => ({ status: 'refuted', confidence: 'medium', summary: '已有适用的黑天鹅反例', rationale: '实际观察记录与原始绝对说法矛盾', unresolved: [],
  chain: { 'round-1': { finding: '发现黑天鹅', strength: 'strong', relevance: 'direct', gap: '' }, 'round-3': { finding: '另一条观察记录', strength: 'limited', relevance: 'direct', gap: '观察地点仍可补充' } },
  criteriaReview: [{ criterionId: 'c1', outcome: 'refutes', decisive: true, publicationRefs: [{ quoteId: 'r1-s1-p1', basis: 'original-document' }], explanation: '已有一个明确反例' }],
});

test('verdict requires every published round and restores IDs in publication order', () => {
  const contract = createModelContract({ schema: {}, data: verdictData });
  strictObjects(contract.parameters);
  assert.equal(contract.phase, 'verdict');
  assert.deepEqual(contract.parameters.properties.chain.required, ['round-1', 'round-3']);
  const output = contract.assemble(verdictArgs());
  assert.deepEqual(output.chain.map(item => item.roundId), ['round-1', 'round-3']);
  assert.deepEqual(output.criteriaReview[0].publicationRefs, [{ quoteId: 'r1-s1-p1', basis: 'original-document' }]);
});

test('verdict rejects omitted/unknown rounds, forged references and extra identity fields', () => {
  const contract = createModelContract({ schema: {}, data: verdictData });
  for (const alter of [
    args => { delete args.chain['round-3']; },
    args => { args.chain['round-2'] = args.chain['round-1']; },
    args => { args.chain['round-1'].roundId = 'round-3'; },
    args => { args.criteriaReview[0].criterionId = 'c9'; },
    args => { args.criteriaReview[0].publicationRefs[0].quoteId = 'private-test'; },
    args => { args.criteriaReview[0].publicationRefs[0].basis = 'private-test'; },
    args => { args.criteriaReview[0].publicationRefs[0].proofQuote = 'private-test'; },
    args => { args.criteriaReview[0].decisive = 'true'; },
  ]) {
    const args = verdictArgs(); alter(args);
    assert.throws(() => contract.assemble(args), formatFailure);
  }
});

test('empty verdict publications allow no invented references or rounds', () => {
  const contract = createModelContract({ schema: {}, data: { ...verdictData, publications: [] } });
  strictObjects(contract.parameters);
  const args = verdictArgs(); args.chain = {}; args.criteriaReview = [];
  assert.deepEqual(contract.assemble(args).chain, []);
  args.criteriaReview = verdictArgs().criteriaReview;
  assert.throws(() => contract.assemble(args), formatFailure);
});

test('unsupported contracts fail closed', () => {
  assert.throws(() => createModelContract({ schema: {}, data: {} }), formatFailure);
});
