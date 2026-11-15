import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, createGame, startResearch, completeLiveResearch, failLiveResearch, getResearchStatus, getEvidenceMaterial, getEvidenceBonuses, getEvidenceEvent, getCoinEconomy, publishEvidence, tick } from '../dist/engine.js';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';

function fund(state, value) {
  state.coins += value;
  state.coinEconomy.generated += value;
  state.coinEconomy.collected += value;
}
function liveGame(coins = 90) { const state = createGame({ researchMode: 'live' }); fund(state, coins); return state; }
function payload(state) {
  const definition = RESEARCH_ROUNDS.find(item => item.id === state.research.roundId);
  return {
    provider: '腾讯云元宝搜索', requestId: `cloud-${definition.round}`, fetchedAt: '2026-10-22T10:00:00.000Z',
    query: state.research.query, searchQuery: `长城 ${state.research.query}`, finding: '返回了两份相关检索材料，原文可供继续核对。',
    materials: definition.materials.map((template, i) => ({
      id: template.id, focus: template.focus, eventId: template.eventId, title: `实时材料 ${definition.round}-${i}`, finding: `搜索返回的第 ${i + 1} 份摘要。`,
      nextQuestion: definition.round < RESEARCH_ROUNDS.length ? `第 ${i + 1} 份长城照片的拍摄条件是什么？` : null,
      sources: [{ title: `来源 ${i + 1}`, url: `https://example.org/round-${definition.round}/source-${i}`, organization: `机构 ${i + 1}`, summary: '搜索服务返回的摘要。', date: '2025-01-01' }],
    })),
  };
}
function completeFirst(state) {
  assert.equal(startResearch(state, '从月球能看见长城吗？', { requestId: 'attempt-1' }).ok, true);
  assert.equal(completeLiveResearch(state, 'attempt-1', payload(state)).ok, true);
  state.regions.slice(0, 3).forEach(region => { region.seeded = true; });
  assert.equal(publishEvidence(state).ok, true);
}
function conserved(state) {
  const economy = getCoinEconomy(state);
  assert.equal(economy.generated, state.coinDrops.reduce((sum, drop) => sum + drop.value, 0) + economy.collected);
  assert.equal(economy.collected, state.coins + economy.spent + economy.converted);
  assert.ok(Math.abs(state.points - (state.totals.earned - state.totals.spent + state.totals.refunded)) < 1e-6);
}

test('live searches accept custom Unicode questions but reject invalid input before reserving coins', () => {
  for (const query of ['', 'a', 'x'.repeat(65), '长城\n照片', '\u0000长城', ' 长城\t照片 ', null, 123]) {
    const state = liveGame(), before = JSON.stringify(state);
    assert.equal(startResearch(state, query, { requestId: 'request' }).ok, false);
    assert.equal(JSON.stringify(state), before);
  }
  const state = liveGame(), query = '🛰'.repeat(64);
  assert.equal(startResearch(state, query).ok, false);
  assert.equal(startResearch(state, `  ${query}  `, { requestId: 'custom-question' }).ok, true);
  assert.equal(state.research.query, query); assert.equal(state.coins, 72);
  assert.equal(state.research.kind, 'live'); assert.equal(state.research.duration, null);
  assert.equal(state.coinEconomy.researchPaid, 0); conserved(state);
  const duplicate = JSON.stringify(state);
  assert.equal(startResearch(state, query, { requestId: 'duplicate' }).ok, false);
  assert.equal(JSON.stringify(state), duplicate);
});

test('optional source images survive immutable snapshots and bad images never discard good evidence', () => {
  for (const imageUrl of ['https://images.example/source.jpg', undefined, 'javascript:alert(1)', 'http://127.0.0.1/private', 'https://images.example/' + 'a'.repeat(2100)]) {
    const state = liveGame(); startResearch(state, '核对长城原文配图', { requestId: 'with-image' });
    const response = payload(state);
    Object.assign(response.materials[0].sources[0], { imageUrl, imageCaption: '实际原文配图' });
    assert.equal(completeLiveResearch(state, 'with-image', response).ok, true);
    response.materials[0].sources[0].imageUrl = 'https://changed.example/changed.png';
    const saved = getEvidenceMaterial(state, 'photo-spread').sources[0];
    assert.equal(saved.imageUrl, imageUrl === 'https://images.example/source.jpg' ? imageUrl : undefined);
    if (saved.imageUrl) assert.equal(saved.imageCaption, '实际原文配图');
    assert.equal(state.evidence.length, 1);
  }
});

test('elapsed game time cannot manufacture live evidence and pending jobs retain their reservation', () => {
  const state = liveGame(); startResearch(state, '自定义长城调查', { requestId: 'slow' });
  tick(state, 120);
  assert.equal(state.research.requestId, 'slow'); assert.ok(state.research.elapsed > 119);
  assert.deepEqual(state.evidence, []); assert.deepEqual(state.researchResults, []);
  assert.equal(getResearchStatus(state).phase, 'searching');
  assert.equal(getEvidenceMaterial(state, 'photo-spread'), undefined);
  assert.equal(state.coinEconomy.spent, 18); conserved(state);
});

test('failed searches refund exactly once, preserve all investigation opportunities and expose a retryable error', () => {
  const state = liveGame(20); startResearch(state, '这份长城资料的出处？', { requestId: 'fail-1' });
  assert.equal(state.coins, 2);
  const failure = failLiveResearch(state, 'fail-1', '搜索暂时不可用');
  assert.equal(failure.ok, false); assert.equal(failure.refund, 18);
  assert.equal(state.coins, 20); assert.equal(state.coinEconomy.spent, 0);
  assert.equal(state.coinEconomy.researchPaid, 0); assert.deepEqual(state.evidence, []);
  assert.equal(state.researchError.query, '这份长城资料的出处？');
  assert.equal(getResearchStatus(state).error.message, '搜索暂时不可用');
  const before = JSON.stringify(state);
  assert.equal(failLiveResearch(state, 'fail-1').ok, false); assert.equal(JSON.stringify(state), before);
  assert.equal(startResearch(state, '换个问题查长城', { requestId: 'retry-1' }).ok, true);
  assert.equal(state.researchError, null); conserved(state);
});

test('success stores immutable response snapshots and the chosen real material drives followup and bonuses', () => {
  const state = liveGame(); startResearch(state, '长城照片的原始记录', { requestId: 'live-1' });
  const response = payload(state), chosenTitle = response.materials[0].title, chosenQuestion = response.materials[0].nextQuestion;
  const success = completeLiveResearch(state, 'live-1', response);
  assert.equal(success.ok, true); assert.equal(success.pointsEarned, 0);
  assert.equal(state.research, null); assert.equal(state.evidence.length, 1);
  assert.equal(state.coinEconomy.researchPaid, 1);
  assert.equal(state.researchResults[0].provider, '腾讯云元宝搜索');
  assert.equal(state.researchResults[0].requestId, 'cloud-1');
  assert.equal(state.researchResults[0].title, '找到新的搜证材料');
  response.materials[0].title = 'response mutated'; response.materials[0].sources[0].url = 'https://changed.example/';
  assert.equal(getEvidenceMaterial(state, 'photo-spread').title, chosenTitle);
  assert.equal(getEvidenceMaterial(state, 'photo-spread').sources[0].url, 'https://example.org/round-1/source-0');
  assert.equal(publishEvidence(state).ok, true);
  assert.equal(getResearchStatus(state).query, chosenQuestion);
  assert.equal(getEvidenceBonuses(state).spreadBonus, .35);
  tick(state, 45);
  assert.equal(getEvidenceEvent(state).eventId, 'source-goes-viral'); conserved(state);
});

test('a pending second search cannot cash out coins, and refund then retry conserves all currency', () => {
  const state = liveGame(85); completeFirst(state);
  assert.equal(state.coins, 67);
  assert.equal(startResearch(state, getResearchStatus(state).query, { requestId: 'fail-2' }).ok, true);
  assert.equal(state.coins, 67 - RULES.researchCosts[1]); assert.equal(state.coinEconomy.researchPaid, 1);
  assert.equal(getCoinEconomy(state).cashoutActive, false);
  fund(state, 5); const beforePoints = state.points;
  assert.equal(failLiveResearch(state, 'fail-2', '未找到足够材料').refund, RULES.researchCosts[1]);
  assert.equal(state.coins, 72); assert.equal(state.points, beforePoints); assert.equal(state.coinEconomy.spent, 18);
  assert.equal(state.evidence.length, 1); conserved(state);
  assert.equal(startResearch(state, '继续核对这些长城观测记录', { requestId: 'retry-2' }).ok, true);
  const success = completeLiveResearch(state, 'retry-2', payload(state));
  const cashout = 0;
  assert.equal(success.ok, true); assert.equal(success.pointsEarned, cashout);
  assert.equal(state.points, beforePoints + cashout); assert.equal(state.coins, 72 - RULES.researchCosts[1]);
  assert.equal(state.coinEconomy.spent, RULES.researchCosts[0] + RULES.researchCosts[1]); assert.equal(getCoinEconomy(state).cashoutActive, false);
  assert.equal(state.evidence.length, 2); assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
  assert.equal(publishEvidence(state).ok, true);
  assert.equal(getResearchStatus(state).phase, 'ready');
  assert.equal(getEvidenceBonuses(state).spreadBonus, .7); conserved(state);
});

test('duplicate, stale, restarted and terminal responses cannot award evidence or refund twice', () => {
  const state = liveGame(); startResearch(state, '长城照片来源', { requestId: 'old' });
  const oldPayload = payload(state); failLiveResearch(state, 'old');
  startResearch(state, '新的长城问题', { requestId: 'new' });
  let before = JSON.stringify(state);
  assert.equal(completeLiveResearch(state, 'old', oldPayload).ok, false);
  assert.equal(failLiveResearch(state, 'old').ok, false); assert.equal(JSON.stringify(state), before);
  const response = payload(state);
  assert.equal(completeLiveResearch(state, 'new', response).ok, true); before = JSON.stringify(state);
  assert.equal(completeLiveResearch(state, 'new', response).ok, false); assert.equal(JSON.stringify(state), before);
  const restarted = liveGame(); before = JSON.stringify(restarted);
  assert.equal(completeLiveResearch(restarted, 'new', response).ok, false); assert.equal(JSON.stringify(restarted), before);
  const terminal = liveGame(); startResearch(terminal, '长城问题', { requestId: 'terminal' }); terminal.phase = 'won'; before = JSON.stringify(terminal);
  assert.equal(completeLiveResearch(terminal, 'terminal', payload(terminal)).ok, false);
  assert.equal(failLiveResearch(terminal, 'terminal').ok, false); assert.equal(JSON.stringify(terminal), before);
});

test('malformed materials, forged effects and unsafe or duplicate sources fail with a refund', () => {
  const corruptions = [
    response => { response.query = 'different query'; },
    response => { response.materials.pop(); },
    response => { response.materials[0].focus = 'defense'; },
    response => { response.materials[0].eventId = 'arbitrary-effect'; },
    response => { response.materials[0].sources[0].url = 'javascript:alert(1)'; },
    response => { response.materials[0].sources[0].url = 'https://user:secret@example.org/'; },
    response => { response.materials[1].sources[0].url = response.materials[0].sources[0].url + '#same-source'; },
    response => { response.materials[0].sources[0].summary = ''; },
    response => { response.materials[0].nextQuestion = 'x'; },
    response => { response.requestId = ''; },
    response => { response.fetchedAt = 'not a date'; },
  ];
  for (const corrupt of corruptions) {
    const state = liveGame(18); startResearch(state, '长城照片来源', { requestId: 'bad-response' });
    const response = payload(state); corrupt(response);
    const result = completeLiveResearch(state, 'bad-response', response);
    assert.equal(result.ok, false); assert.equal(result.refund, 18);
    assert.equal(state.coins, 18); assert.equal(state.research, null);
    assert.deepEqual(state.evidence, []); assert.equal(state.coinEconomy.researchPaid, 0); conserved(state);
  }
});

test('offline mode still uses preset queries and timed results without a network request ID', () => {
  const state = createGame(); fund(state, 18);
  assert.equal(state.researchMode, 'demo');
  assert.equal(startResearch(state, '任意问题').ok, false);
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
  tick(state, 12);
  assert.equal(state.evidence.length, 1); assert.equal(state.researchResults[0].materials, undefined);
  assert.equal(getEvidenceMaterial(state, 'photo-spread').title, RESEARCH_ROUNDS[0].materials[0].title);
});

test('live investigation keeps grounded insights and followup context as isolated display snapshots', () => {
  const state = liveGame();
  assert.equal(getResearchStatus(state).query, '从月球用肉眼能看见长城吗？');
  startResearch(state, getResearchStatus(state).query, { requestId: 'grounded' });
  const response = payload(state), item = response.materials[0];
  item.sources[0].content = 'Returned caption: photographed on the International Space Station.';
  item.insight = { kind: 'location', headline: '照片拍自空间站', explanation: '这份图注描述的是空间站拍摄。', quote: 'photographed on the International Space Station.' };
  item.lead = { kind: 'lens', question: item.nextQuestion, reason: '继续核对相机拍摄与肉眼观测的区别。' };
  response.investigation = { question: response.query, previousFinding: '', summary: '找到拍摄地点。', delta: '这份图注提供了空间站这一条件。', openQuestion: item.nextQuestion };
  assert.equal(completeLiveResearch(state, 'grounded', response).ok, true);
  const saved = getEvidenceMaterial(state, item.id);
  assert.deepEqual(saved.insight, item.insight);
  assert.deepEqual(saved.lead, item.lead);
  assert.deepEqual(state.researchResults[0].investigation, response.investigation);
  item.insight.explanation = 'modified'; item.lead.question = 'modified'; item.sources[0].content = 'modified'; response.investigation.delta = 'modified';
  assert.equal(saved.insight.explanation, '这份图注描述的是空间站拍摄。');
  assert.match(saved.sources[0].content, /International Space Station/);
  assert.notEqual(state.researchResults[0].investigation.delta, 'modified');
  publishEvidence(state);
  assert.equal(getResearchStatus(state).query, saved.lead.question);
});

test('untraceable quotes and malformed investigation data refund instead of awarding evidence', () => {
  const corruptions = [
    response => { response.materials[0].insight = { kind: 'lens', headline: '镜头', explanation: '没有出处的器材参数', quote: '800 mm' }; },
    response => { response.materials[0].sources[0].content = 'x'.repeat(3001); },
    response => { response.materials[0].lead = { kind: 'lens', question: '被偷换的长城问题？', reason: '继续追问' }; },
    response => { response.investigation = { question: 'another question', summary: '材料', delta: '变化', previousFinding: '', openQuestion: '' }; },
    response => { response.investigation = { question: response.query, summary: '材料', delta: '变化', previousFinding: {}, openQuestion: '' }; },
  ];
  for (const corrupt of corruptions) {
    const state = liveGame(18); startResearch(state, '长城照片的拍摄条件', { requestId: 'bad-insight' });
    const response = payload(state); corrupt(response);
    assert.equal(completeLiveResearch(state, 'bad-insight', response).refund, 18);
    assert.equal(state.evidence.length, 0); assert.equal(state.coins, 18); conserved(state);
  }
});
