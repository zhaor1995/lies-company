import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldFeed, addFieldMessage, syncFieldFeed, updateFieldInvestigation, getInvestigationFlow } from '../dist/field-feed.js';
import { createGame, startResearch, tick, buyUpgrade, getResearchStatus } from '../dist/engine.js';

const stateFixture = extra => ({ time: 100, log: [], transportEvents: [], mediaEvents: [], evidenceEvents: [], researchResults: [], ...extra });
const progressEvent = (seq, stage, seconds, extra = {}) => ({ seq, stage, at: new Date(Date.UTC(2026, 9, 23, 0, 0, seconds)).toISOString(), ...extra });
const researchFixture = extra => ({ requestId: 'request-1', round: 1, roundId: 'round-1', query: '原文在哪里？', time: 21, status: 'running', ...extra });

test('messages are deduplicated, ordered by game time and stable on unchanged sync', () => {
  const store = createFieldFeed();
  addFieldMessage(store, { id: 'coin', time: 30, title: '金币到账', metric: '+3 金币' });
  const state = stateFixture({ log: [{ id: 1, time: 0, type: 'start', title: '调查开始', detail: '' }, { id: 2, time: 20, type: 'upgrade', title: '升级', detail: '传播增强' }] });
  syncFieldFeed(store, state);
  assert.deepEqual(store.entries.map(entry => entry.time), [0, 20, 30]);
  const revision = store.revision;
  syncFieldFeed(store, state);
  addFieldMessage(store, { id: 'coin', time: 99, title: '金币到账', metric: '+3 金币' });
  assert.equal(store.revision, revision);
  assert.equal(store.entries.at(-1).time, 30);
});

test('event cards retain source actions and do not duplicate evidence-event logs', () => {
  const store = createFieldFeed();
  syncFieldFeed(store, stateFixture({
    log: [{ id: 1, time: 55, type: 'evidence-event', title: '显眼包', detail: '' }, { id: 2, time: 50, type: 'warning', title: '对手集结', detail: '' }],
    mediaEvents: [{ id: 'migration', type: 'migration', startedAt: 60 }],
    evidenceEvents: [{ id: 'round-1:source-goes-viral', eventId: 'source-goes-viral', startedAt: 55 }],
  }));
  assert.equal(store.entries.length, 3);
  assert.ok(store.entries.every(entry => entry.kind === 'event'));
  assert.deepEqual(store.entries[1].action, { type: 'evidenceStory', id: 'source-goes-viral' });
  assert.deepEqual(store.entries[2].action, { type: 'mediaStory', id: 'migration' });
  assert.equal(store.entries[0].tone, 'danger');
});

test('transport history survives the engine ring buffer and preserves significant outcomes', () => {
  const store = createFieldFeed();
  const arrival = (id, time, extra = {}) => ({ id, time, type: 'arrival', outcome: 'seeded', carryingTruth: true, channelId: 'telegram', from: 'europe', to: 'africa', seedAmount: 2, ...extra });
  syncFieldFeed(store, stateFixture({ transportEvents: [arrival(1, 3, { carryingTruth: false }), arrival(2, 10, { firstSeed: true }), arrival(3, 12), arrival(4, 14)] }));
  assert.equal(store.entries.length, 2);
  assert.match(store.entries[0].title, /首次抵达非洲/);
  assert.equal(store.entries[1].count, 2);
  syncFieldFeed(store, stateFixture({ transportEvents: [arrival(5, 20, { type: 'blocked', outcome: 'blocked' }), arrival(6, 25, { outcome: 'missed' })] }));
  assert.equal(store.entries.length, 4);
  assert.equal(store.entries[2].tone, 'danger');
  assert.equal(store.entries[3].tone, 'warning');
  const revision = store.revision;
  syncFieldFeed(store, stateFixture({ transportEvents: [arrival(5, 20, { type: 'blocked', outcome: 'blocked' }), arrival(6, 25, { outcome: 'missed' })] }));
  assert.equal(store.revision, revision);
});

test('investigation updates stay in place, retain actual retries, and use elapsed real time', () => {
  const store = createFieldFeed();
  const entry = updateFieldInvestigation(store, researchFixture());
  addFieldMessage(store, { id: 'coin', time: 22, title: '金币到账' });
  const events = [progressEvent(1, 'searching', 2, { query: '第一条检索' }), progressEvent(2, 'sources', 3, { sourceCount: 4 }), progressEvent(3, 'analyzing', 5), progressEvent(4, 'searching', 7, { query: '补查原始资料' }), progressEvent(5, 'reporting', 9), progressEvent(6, 'repairing', 12)];
  updateFieldInvestigation(store, researchFixture({ time: 50, events }));
  assert.equal(store.entries[0], entry);
  assert.equal(entry.time, 21);
  assert.equal(entry.steps.length, 6);
  assert.equal(entry.steps[5].elapsed, 10);
  assert.equal(entry.sourceCount, 4);
  assert.match(entry.steps[3].detail, /补查/);
  const result = { roundId: 'round-1', query: entry.query, finding: '找到原始出处。', selectedId: 'a', materials: [{ id: 'a' }, { id: 'b' }] };
  updateFieldInvestigation(store, researchFixture({ events, status: 'completed', result }));
  assert.equal(entry.detail, result.finding);
  assert.equal(entry.materialCount, 1);
  assert.deepEqual(entry.action, { type: 'research-result', roundId: 'round-1' });
  updateFieldInvestigation(store, researchFixture({ status: 'running', events: [progressEvent(2, 'sources', 3, { sourceCount: 4 })] }));
  assert.equal(entry.status, 'completed');
  assert.equal(entry.steps.length, 6);
});

test('unknown backend stages and internal failure codes never become player-facing text', () => {
  const store = createFieldFeed();
  const entry = updateFieldInvestigation(store, researchFixture({ status: 'failed', error: 'JSON_PARSE_ERROR token=secret', events: [progressEvent(1, 'internal-stage', 1), progressEvent(2, 'failed', 2, { code: 'MODEL_RESPONSE_INCOMPLETE' })] }));
  assert.equal(entry.steps.length, 1);
  assert.match(entry.detail, /金币已退回/);
  assert.doesNotMatch(entry.detail + entry.steps[0].detail, /JSON|secret|MODEL/);
});

test('live engine completion enriches the existing progress card without repeated evidence logs', () => {
  const store = createFieldFeed();
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'searching', 0, { query: '原始资料' })] }));
  const state = stateFixture({ researchMode: 'live', log: [{ id: 1, time: 21, type: 'research', detail: '原文在哪里？' }], research: { requestId: 'request-1', query: '原文在哪里？', roundId: 'round-1', kind: 'live' } });
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 1);
  state.log.push({ id: 2, time: 40, type: 'evidence', title: '找到材料', detail: '' });
  state.researchResults.push({ requestId: 'request-1', roundId: 'round-1', query: '原文在哪里？', time: 40, finding: '这是资料实际发现', selectedId: 'a', materials: [{ id: 'a' }, { id: 'b' }] });
  state.research = null;
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].status, 'completed');
  assert.equal(store.entries[0].steps.length, 1);
  const revision = store.revision;
  syncFieldFeed(store, state);
  assert.equal(store.revision, revision);
});

test('retries while paused keep separate cards even with equal game time, round and query', () => {
  const store = createFieldFeed();
  const state = stateFixture({ researchMode: 'live', log: [{ id: 1, time: 21, type: 'research', detail: '原文在哪里？' }] });
  updateFieldInvestigation(store, researchFixture());
  syncFieldFeed(store, state);
  updateFieldInvestigation(store, researchFixture({ status: 'failed', error: '搜索暂时无法完成' }));
  state.log.push({ id: 2, time: 21, type: 'research-failed', detail: '搜索暂时无法完成' });
  syncFieldFeed(store, state);
  updateFieldInvestigation(store, researchFixture({ requestId: 'request-2' }));
  state.log.push({ id: 3, time: 21, type: 'research', detail: '原文在哪里？' });
  state.research = { requestId: 'request-2', kind: 'live' };
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 2);
  assert.deepEqual(store.entries.map(entry => entry.status), ['failed', 'running']);
  assert.deepEqual(store.entries.map(entry => entry.engineLogId), [1, 3]);
});

test('offline investigation uses actual job progress and never invents live search steps', () => {
  const state = createGame();
  state.coins = 18;
  buyUpgrade(state, 'spread');
  tick(state, 20);
  const started = startResearch(state, getResearchStatus(state).query);
  assert.equal(started.ok, true);
  const store = createFieldFeed();
  syncFieldFeed(store, state);
  const entry = store.entries.find(item => item.kind === 'investigation');
  assert.ok(entry.demo);
  assert.match(entry.title, /核对预置资料/);
  assert.deepEqual(entry.steps, []);
  tick(state, 3);
  syncFieldFeed(store, state);
  assert.equal(entry.progress, state.research.elapsed / state.research.duration);
  tick(state, 20);
  syncFieldFeed(store, state);
  assert.equal(store.entries.filter(item => item.kind === 'investigation').length, 1);
  assert.equal(entry.status, 'completed');
  assert.equal(entry.materialCount, 1);
});


test('scheduled events remain hidden until their actual start time', () => {
  const store = createFieldFeed();
  const state = stateFixture({ mediaEvents: [{ id: 'migration', type: 'migration', startedAt: null }], evidenceEvents: [{ id: 'future', eventId: 'changed-my-mind', startedAt: null }] });
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 0);
  state.mediaEvents[0].startedAt = 150;
  state.evidenceEvents[0].startedAt = 150;
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 0);
  state.time = 150;
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 2);
});

test('provider request IDs cannot duplicate an already tracked client investigation', () => {
  const store = createFieldFeed();
  const entry = updateFieldInvestigation(store, researchFixture());
  const result = { requestId: 'provider-request-unique', roundId: 'round-1', query: '原文在哪里？', time: 30, finding: '找到来源', selectedId: 'a', materials: [{ id: 'a' }, { id: 'b' }] };
  const state = stateFixture({ researchMode: 'live', researchResults: [result], log: [{ id: 1, time: 21, type: 'research', detail: '原文在哪里？' }, { id: 2, time: 30, type: 'evidence' }] });
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0], entry);
  assert.equal(entry.requestId, 'request-1');
  assert.equal(entry.status, 'completed');
});

test('live evidence hotspots describe mechanics without inventing a case-specific anecdote', () => {
  const store = createFieldFeed();
  syncFieldFeed(store, stateFixture({ researchMode: 'live', evidenceEvents: [{ id: 'hotspot', eventId: 'changed-my-mind', startedAt: 30, persuasionBonus: .35 }] }));
  assert.match(store.entries[0].detail, /说服能力 \+35%/);
  assert.doesNotMatch(store.entries[0].detail, /观测|拍摄/);
  assert.equal(store.entries[0].quip, '');
});


test('a completed investigation exposes only its fixed evidence and tracks storage then publication', () => {
  const store = createFieldFeed(), result = { roundId: 'round-1', selectedId: 'a', materials: [
    { id: 'a', title: '锁定证据', finding: '有明确适用条件。' },
    { id: 'b', title: '未采用候选', finding: '不应展示这条发现。' },
  ] };
  const entry = updateFieldInvestigation(store, researchFixture({ status: 'completed', result }));
  assert.equal(entry.evidenceTitle, '锁定证据');
  assert.equal(entry.detail, '有明确适用条件。');
  assert.equal(entry.materialCount, 1); assert.equal(entry.publicationState, '证据已到');
  result.storedAt = 30;
  updateFieldInvestigation(store, researchFixture({ status: 'completed', result }));
  assert.equal(entry.publicationState, '已收入囊中'); assert.equal(entry.published, false);
  result.publishedAt = 40; result.promotedId = 'a';
  updateFieldInvestigation(store, researchFixture({ status: 'completed', result }));
  assert.equal(entry.publicationState, '已公布'); assert.equal(entry.published, true);
  assert.equal(store.entries.length, 1); assert.equal(entry.time, 21);
  updateFieldInvestigation(store, researchFixture({ status: 'running' }));
  assert.equal(entry.publicationState, '已公布', 'a delayed progress poll cannot undo publication');
  assert.equal(entry.published, true);
  assert.doesNotMatch(JSON.stringify(entry), /未采用候选|不应展示/);
});

test('the investigation flow starts at submission without inventing searches or source counts', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture());
  const snapshot = JSON.stringify(entry), flow = getInvestigationFlow(entry);
  assert.equal(flow.status, 'running'); assert.equal(flow.stage, 'waiting');
  assert.equal(flow.buttonLabel, '正在提交调查'); assert.equal(flow.activeNode, 'lead');
  assert.equal(flow.sourceCount, null); assert.equal(flow.searchCount, null);
  assert.equal(flow.followup, false); assert.equal(flow.hasRecordedSteps, false);
  assert.deepEqual(flow.nodes.map(node => node.state), ['active', 'queued', 'queued', 'queued']);
  assert.deepEqual(flow.nodes.map(node => node.actor), ['Agent 调查员', '元宝搜索', 'Agent 调查员', '调查档案']);
  assert.equal(JSON.stringify(entry), snapshot, 'a presentation helper cannot mutate the live investigation');
});

test('the flow follows actual search and verification events, including zero returned sources', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'searching', 1, { query: '原始研究记录', searchAttempt: 1 })] }));
  let flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '元宝检索中'); assert.equal(flow.detail, '原始研究记录');
  assert.equal(flow.activeNode, 'search'); assert.equal(flow.searchCount, 1);
  assert.equal(flow.sourceCount, null);
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(2, 'sources', 3, { sourceCount: 0, searchAttempt: 1 })] }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.sourceCount, 0); assert.equal(flow.buttonLabel, '核对材料中');
  assert.equal(flow.activeNode, 'verify'); assert.equal(flow.steps[1].actor, '元宝搜索');
  assert.equal(flow.steps[1].sourceCount, 0);
});

test('a real follow-up returns to search and retains each verification cycle in order', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [
    progressEvent(1, 'searching', 1, { query: '第一条检索', searchAttempt: 1 }),
    progressEvent(2, 'sources', 2, { sourceCount: 10 }),
    progressEvent(3, 'analyzing', 3, { sourceCount: 6 }),
  ] }));
  assert.equal(getInvestigationFlow(entry).sourceCount, 10, 'the retrieval count must not become the smaller model input count');
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(4, 'searching', 8, { query: '补查原始样本', searchAttempt: 2 })] }));
  let flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '元宝补查中'); assert.equal(flow.detail, '补查原始样本');
  assert.equal(flow.followup, true); assert.equal(flow.searchCount, 2);
  assert.deepEqual(flow.nodes.map(node => node.state), ['done', 'active', 'queued', 'queued']);
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(5, 'sources', 10, { sourceCount: 14 }), progressEvent(6, 'analyzing', 11)] }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.activeNode, 'verify'); assert.equal(flow.sourceCount, 14);
  assert.deepEqual(flow.steps.map(step => step.stage), ['searching', 'sources', 'analyzing', 'searching', 'sources', 'analyzing']);
  assert.deepEqual(flow.steps.map(step => step.actor), ['元宝搜索', '元宝搜索', 'Agent 调查员', '元宝搜索', '元宝搜索', 'Agent 调查员']);
});

test('search attempt metadata and repeated searching events each identify a real follow-up', () => {
  const store = createFieldFeed();
  const second = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(4, 'searching', 8, { searchAttempt: 2 })] }));
  assert.equal(getInvestigationFlow(second).searchCount, 2);
  assert.equal(getInvestigationFlow(second).buttonLabel, '元宝补查中');
  const repeated = updateFieldInvestigation(createFieldFeed(), researchFixture({ events: [progressEvent(1, 'searching', 1), progressEvent(2, 'analyzing', 3), progressEvent(3, 'searching', 4)] }));
  assert.equal(getInvestigationFlow(repeated).followup, true);
  assert.equal(getInvestigationFlow(repeated).searchCount, 2);
});

test('report repairs reopen verification instead of implying the report is done', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'reporting', 1), progressEvent(2, 'repairing', 3)] }));
  const flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '补全报告中'); assert.equal(flow.activeNode, 'verify');
  assert.deepEqual(flow.nodes.map(node => node.state), ['done', 'done', 'active', 'queued']);
  assert.equal(flow.steps[0].actor, '调查档案'); assert.equal(flow.steps[1].actor, 'Agent 调查员');
  assert.match(flow.steps[0].detail, /适合当前战局/);
  assert.doesNotMatch(flow.steps[0].detail, /弹幕最多/);
});

test('transport retries preserve the actual search flow without inventing new searches or missing material', () => {
  const store = createFieldFeed();
  const entry = updateFieldInvestigation(store, researchFixture({ events: [
    progressEvent(1, 'searching', 1, { query: '原始记录', searchAttempt: 1 }),
    progressEvent(2, 'repairing', 2, { retry: true, retryStage: 'searching', retryAttempt: 2, sourceCount: 0, httpStatus: 503, code: 'SEARCH_UNAVAILABLE' }),
  ] }));
  let flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '正在重试'); assert.equal(flow.detail, '连接暂时不稳，正在重试');
  assert.equal(flow.activeNode, 'search'); assert.equal(flow.searchCount, 1); assert.equal(flow.sourceCount, 0);
  assert.equal(flow.steps.at(-1).actor, '元宝搜索'); assert.equal(flow.steps.at(-1).title, '正在重试');
  assert.equal(flow.steps.at(-1).detail, '连接暂时不稳，正在重试');
  assert.deepEqual(flow.nodes.map(node => node.state), ['done', 'active', 'queued', 'queued']);
  updateFieldInvestigation(store, researchFixture({ events: [
    progressEvent(3, 'sources', 3, { sourceCount: 10 }), progressEvent(4, 'analyzing', 4),
    progressEvent(5, 'repairing', 5, { retry: true, retryStage: 'analyzing', retryAttempt: 2, sourceCount: 10, httpStatus: 503, code: 'MODEL_UNAVAILABLE' }),
    progressEvent(6, 'repairing', 6, { retry: true, retryStage: 'analyzing', retryAttempt: 3, sourceCount: 10 }),
  ] }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.activeNode, 'verify'); assert.equal(flow.searchCount, 1); assert.equal(flow.sourceCount, 10);
  assert.equal(flow.followup, false); assert.equal(flow.steps.at(-1).actor, 'Agent 调查员');
  assert.doesNotMatch(JSON.stringify(flow), /503|MODEL_|SEARCH_|补全|材料还需|retryAttempt/);
  const stepsOnly = getInvestigationFlow({ status: 'running', steps: entry.steps });
  assert.equal(stepsOnly.activeNode, 'verify'); assert.equal(stepsOnly.buttonLabel, '正在重试');
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(7, 'reporting', 7), progressEvent(8, 'complete', 8, { sourceCount: 10 })], status: 'completed' }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '证据已到'); assert.equal(flow.searchCount, 1); assert.equal(flow.sourceCount, 10);
  assert.ok(flow.nodes.every(node => node.state === 'done'));
});

test('a server completion milestone waits for the accepted evidence before announcing arrival', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'reporting', 1), progressEvent(2, 'complete', 3, { sourceCount: 12 })] }));
  const flow = getInvestigationFlow(entry);
  assert.equal(flow.status, 'running'); assert.equal(flow.buttonLabel, '正在接收报告');
  assert.equal(flow.activeNode, 'report'); assert.equal(flow.nodes[3].state, 'active');
  assert.equal(flow.sourceCount, 12);
});

test('unknown stages keep the last public milestone without leaking internal details', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'searching', 1), progressEvent(2, 'internal-stage', 2, { detail: 'secret-debug-payload' })] }));
  const flow = getInvestigationFlow(entry);
  assert.equal(flow.stage, 'searching'); assert.equal(flow.buttonLabel, '元宝检索中');
  assert.equal(flow.steps.length, 1); assert.doesNotMatch(JSON.stringify(flow), /secret-debug/);
  const unknown = getInvestigationFlow({ status: 'running', stage: 'unpublished-stage' });
  assert.equal(unknown.stage, 'waiting'); assert.equal(unknown.searchCount, null);
});

test('failures stop the actual unfinished node and preserve the player-facing failure message', () => {
  for (const [stage, activeNode] of [['searching', 'search'], ['analyzing', 'verify'], ['reporting', 'report'], ['repairing', 'verify']]) {
    const entry = updateFieldInvestigation(createFieldFeed(), researchFixture({ status: 'failed', error: '资料已找到，但证据卡片没能整理完成，请重试。', events: [progressEvent(1, stage, 1), progressEvent(2, 'failed', 3, { code: 'MODEL_FORMAT' })] }));
    const flow = getInvestigationFlow(entry);
    assert.equal(flow.buttonLabel, '调查未完成'); assert.equal(flow.activeNode, activeNode);
    assert.equal(flow.nodes.find(node => node.id === activeNode).state, 'failed');
    assert.equal(flow.detail, entry.detail); assert.equal(flow.steps.at(-1).detail, entry.detail);
    assert.doesNotMatch(JSON.stringify(flow), /MODEL_FORMAT/);
    assert.notEqual(flow.nodes[3].state, 'done');
  }
  const earlyFailure = getInvestigationFlow({ status: 'failed', detail: '本轮未能提交。' });
  assert.equal(earlyFailure.activeNode, 'lead'); assert.equal(earlyFailure.nodes[0].state, 'failed');
});

test('a failure milestone waits for the final response before exposing a retryable failure', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'analyzing', 1), progressEvent(2, 'failed', 3, { code: 'MODEL_FORMAT' })] }));
  let flow = getInvestigationFlow(entry);
  assert.equal(flow.status, 'running'); assert.equal(flow.buttonLabel, '正在接收结果');
  assert.equal(flow.activeNode, 'verify'); assert.equal(flow.nodes[2].state, 'active');
  assert.ok(flow.nodes.every(node => node.state !== 'failed'));
  assert.doesNotMatch(flow.detail, /重试|退回/);
  assert.equal(flow.steps.at(-1).title, '正在接收结果');
  assert.doesNotMatch(flow.steps.at(-1).detail, /重试|退回/);
  updateFieldInvestigation(store, researchFixture({ status: 'failed', error: '本轮报告未完成，金币已退回。' }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.status, 'failed'); assert.equal(flow.buttonLabel, '调查未完成');
  assert.equal(flow.activeNode, 'verify'); assert.equal(flow.nodes[2].state, 'failed');
  assert.equal(flow.detail, '本轮报告未完成，金币已退回。');
});

test('late progress cannot regress the finished flow and historical reports do not invent calls', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ status: 'completed', result: { roundId: 'round-1', finding: '已核对适用条件。' } }));
  let flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '证据已到'); assert.equal(flow.activeNode, null);
  assert.ok(flow.nodes.every(node => node.state === 'done'));
  assert.equal(flow.sourceCount, null); assert.equal(flow.searchCount, null);
  assert.equal(flow.hasRecordedSteps, false); assert.deepEqual(flow.steps, []);
  updateFieldInvestigation(store, researchFixture({ status: 'running', events: [progressEvent(1, 'searching', 1, { searchAttempt: 1 })] }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.status, 'completed'); assert.equal(flow.stage, 'complete');
  assert.equal(flow.buttonLabel, '证据已到'); assert.ok(flow.nodes.every(node => node.state === 'done'));
  assert.equal(flow.detail, '已核对适用条件。');
});

test('offline flow labels never pretend to perform a live search', () => {
  const flow = getInvestigationFlow({ demo: true, status: 'running', steps: [], progress: .75 });
  assert.equal(flow.buttonLabel, '核对预置资料'); assert.equal(flow.searchCount, null);
  assert.doesNotMatch(flow.detail, /元宝|Agent/);
});

test('losing stops an unfinished investigation even after the engine job has been cleared', () => {
  const store = createFieldFeed(), entry = updateFieldInvestigation(store, researchFixture({ events: [progressEvent(1, 'searching', 1), progressEvent(2, 'analyzing', 2)] }));
  const state = stateFixture({ phase: 'lost', research: null, researchMode: 'live', log: [{ id: 1, time: 21, type: 'research', detail: '原文在哪里？' }] });
  syncFieldFeed(store, state);
  assert.equal(entry.status, 'failed'); assert.equal(entry.interrupted, true);
  assert.equal(entry.detail, '本局已结束，这轮调查已中止。');
  assert.match(entry.title, /已中止/); assert.doesNotMatch(entry.title, /重试/);
  const flow = getInvestigationFlow(entry);
  assert.equal(flow.buttonLabel, '调查已中止'); assert.equal(flow.nodes[2].state, 'failed');
  const revision = store.revision;
  syncFieldFeed(store, state);
  assert.equal(store.revision, revision, 'repeated ending renders do not change the stopped card');
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(3, 'reporting', 3), progressEvent(4, 'complete', 4)], status: 'running' }));
  assert.equal(entry.status, 'failed'); assert.equal(entry.stage, 'failed');
  assert.equal(entry.steps.length, 2, 'late progress does not continue an interrupted timeline');
  updateFieldInvestigation(store, researchFixture({ status: 'completed', result: { roundId: 'round-1', selectedId: 'late', materials: [{ id: 'late', title: '迟到的结果' }] } }));
  assert.equal(entry.status, 'failed'); assert.equal(entry.action, undefined);
  assert.equal(entry.evidenceTitle, undefined); assert.equal(entry.detail, '本局已结束，这轮调查已中止。');
  syncFieldFeed(store, state);
  assert.equal(store.entries.length, 1); assert.equal(getInvestigationFlow(entry).buttonLabel, '调查已中止');
});

test('ordinary failure remains retryable and a won game can finish its paid investigation', () => {
  const failedStore = createFieldFeed();
  syncFieldFeed(failedStore, stateFixture({ phase: 'playing', research: null, log: [
    { id: 1, time: 21, type: 'research', detail: '原文在哪里？' },
    { id: 2, time: 22, type: 'research-failed', detail: '搜索暂时未完成，金币已退回。' },
  ] }));
  const failed = failedStore.entries.find(entry => entry.kind === 'investigation');
  assert.equal(failed.status, 'failed'); assert.equal(failed.interrupted, undefined);
  assert.match(failed.title, /可以重试/); assert.match(failed.detail, /金币已退回/);
  const store = createFieldFeed(), state = stateFixture({ phase: 'won', researchMode: 'live', research: { requestId: 'request-1', kind: 'live' }, log: [{ id: 1, time: 21, type: 'research', detail: '原文在哪里？' }] });
  syncFieldFeed(store, state);
  const entry = store.entries.find(item => item.kind === 'investigation');
  assert.equal(entry.status, 'running'); assert.equal(entry.interrupted, undefined);
  state.research = null;
  state.log.push({ id: 2, time: 30, type: 'evidence' });
  state.researchResults.push({ roundId: 'round-1', requestId: 'request-1', query: '原文在哪里？', finding: '胜利后完成的证据。' });
  syncFieldFeed(store, state);
  assert.equal(entry.status, 'completed'); assert.equal(entry.detail, '胜利后完成的证据。');
});

test('source milestones expose every real source with public attribution fields', () => {
  const sources = Array.from({ length: 20 }, (_, index) => ({ title: `研究资料 ${index + 1}`, url: `https://research.example/articles/${index + 1}`, organization: '研究机构', date: '2026-10-23', content: '不应传给界面的原始正文', passages: [{ text: '原始长段落' }], token: 'private-token' }));
  const entry = updateFieldInvestigation(createFieldFeed(), researchFixture({ events: [progressEvent(1, 'sources', 1, { sourceCount: 20, sources })] }));
  const flow = getInvestigationFlow(entry);
  assert.equal(flow.steps[0].sources.length, 20, 'the list must not silently become only the top few results');
  assert.equal(flow.sourceCount, 20);
  assert.deepEqual(flow.steps[0].sources[0], { title: '研究资料 1', url: 'https://research.example/articles/1', organization: '研究机构', date: '2026-10-23' });
  assert.doesNotMatch(JSON.stringify(entry), /private-token|原始正文|原始长段落/);
  sources[0].title = '调用方后来修改的标题';
  assert.equal(entry.steps[0].sources[0].title, '研究资料 1', 'each event owns a source snapshot');
  flow.steps[0].sources[0].title = '界面后来修改的标题';
  assert.equal(entry.steps[0].sources[0].title, '研究资料 1', 'reading a flow cannot share mutable source records');
});

test('follow-up searches preserve both the first and cumulative source snapshots', () => {
  const store = createFieldFeed(), first = { title: '原始实验', url: 'https://journal.example/experiment' }, additional = { title: '独立复核', url: 'https://lab.example/review' };
  const entry = updateFieldInvestigation(store, researchFixture({ events: [
    progressEvent(1, 'searching', 1, { searchAttempt: 1 }),
    progressEvent(2, 'sources', 3, { sourceCount: 1, sources: [first] }),
    progressEvent(3, 'analyzing', 4),
  ] }));
  updateFieldInvestigation(store, researchFixture({ events: [
    progressEvent(4, 'searching', 5, { searchAttempt: 2 }),
    progressEvent(5, 'sources', 6, { sourceCount: 2, sources: [first, additional] }),
  ] }));
  let flow = getInvestigationFlow(entry);
  const sourceSteps = flow.steps.filter(step => step.stage === 'sources');
  assert.deepEqual(sourceSteps.map(step => step.sources.length), [1, 2]);
  assert.deepEqual(sourceSteps[0].sources, [first]);
  assert.deepEqual(sourceSteps[1].sources, [first, additional]);
  assert.equal(flow.followup, true); assert.equal(flow.sourceCount, 2);
  updateFieldInvestigation(store, researchFixture({ status: 'failed', interrupted: true }));
  updateFieldInvestigation(store, researchFixture({ events: [progressEvent(6, 'sources', 7, { sourceCount: 3, sources: [first, additional, { title: '迟到来源', url: 'https://late.example/article' }] })] }));
  flow = getInvestigationFlow(entry);
  assert.equal(flow.status, 'failed'); assert.equal(flow.sourceCount, 2);
  assert.deepEqual(flow.steps.filter(step => step.stage === 'sources').map(step => step.sources.length), [1, 2]);
});

test('legacy source counts do not fabricate a list and a real empty list stays empty', () => {
  const legacy = updateFieldInvestigation(createFieldFeed(), researchFixture({ events: [progressEvent(1, 'sources', 1, { sourceCount: 10 })] }));
  assert.equal(getInvestigationFlow(legacy).steps[0].sources, undefined);
  const empty = updateFieldInvestigation(createFieldFeed(), researchFixture({ events: [progressEvent(1, 'sources', 1, { sourceCount: 0, sources: [] })] }));
  assert.deepEqual(getInvestigationFlow(empty).steps[0].sources, []);
  const malformed = getInvestigationFlow({ status: 'running', steps: [{ stage: 'sources', title: '材料已找到', sources: 'not-a-source-list' }] });
  assert.equal(malformed.steps[0].sources, undefined);
});

test('source links are restricted to safe web URLs, deduplicated and stripped of unknown fields', () => {
  const sources = [
    { title: ' 原始记录 ', url: 'HTTPS://EXAMPLE.COM:443/report#results', organization: ' 机构 ', date: ' 2026-10-23 ', secret: 'private-source-data', content: 'raw-content' },
    { title: '同一来源的另一锚点', url: 'https://example.com/report#abstract' },
    { title: '旧报道', url: 'http://archive.example/report', organization: 10, date: { value: 'bad' } },
    ...['javascript:alert(1)', 'data:text/html,secret', 'file:///private/key', 'ftp://files.example/report', '//example.com/report', 'https://user:password@example.com/report', 'https://user@example.com/report', 'https://example.com/\nreport', 'https://example.com/\u0000report', 'https://exa mple.com/'].map(url => ({ title: '不安全链接', url })),
    null, {}, { title: '缺少地址' }, { title: 22, url: 'https://example.com/invalid-title' },
  ];
  const entry = updateFieldInvestigation(createFieldFeed(), researchFixture({ events: [progressEvent(1, 'sources', 1, { sourceCount: 2, sources })] }));
  const expected = [{ title: '原始记录', url: 'https://example.com/report#results', organization: '机构', date: '2026-10-23' }, { title: '旧报道', url: 'http://archive.example/report' }];
  assert.deepEqual(entry.steps[0].sources, expected);
  assert.deepEqual(getInvestigationFlow(entry).steps[0].sources, expected);
  assert.doesNotMatch(JSON.stringify(entry), /private-source-data|raw-content|javascript:|password|不安全链接/);
  const direct = getInvestigationFlow({ status: 'running', steps: [{ stage: 'sources', title: '材料已找到', sources }] });
  assert.deepEqual(direct.steps[0].sources, expected, 'saved or hand-created steps cannot bypass source sanitation');
  const misplaced = getInvestigationFlow({ status: 'running', steps: [{ stage: 'analyzing', title: '核对材料', sources }] });
  assert.equal(misplaced.steps[0].sources, undefined, 'source lists belong to retrieval snapshots');
});
