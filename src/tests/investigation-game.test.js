import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, createGame, setInvestigationPlan, failInvestigationPlan, startLeadRefresh, completeLeadRefresh, failLeadRefresh, startResearch, completeLiveResearch, failLiveResearch, getResearchStatus, getEvidenceBonuses, getPublishPreview, publishEvidence, tick, collectCoin, getCoinEconomy, buyUpgrade, counterWithSource, getCounterStatus, getCampaignStatus, getStats, startFinalReview, completeFinalReview, failFinalReview } from '../dist/engine.js';
import { getJourney } from '../dist/journey.js';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';
import { buildCaseReport, caseReportText } from '../dist/case-report.js';

const claim = '测试传闻是否成立？';
const leads = round => [1, 2].map(index => ({ id: `r${round}-${index}`, title: `查第${index}条线`, question: `第${round}轮第${index}条线能查到什么？`, reason: '补上原始记录和实际条件。' }));
function agentGame() {
  const game = createGame({ claim, investigationMode: 'agent', researchMode: 'live' });
  game.coins = game.coinEconomy.generated = game.coinEconomy.collected = 90;
  return game;
}
function plannedGame() {
  const game = agentGame();
  assert.equal(setInvestigationPlan(game, { claim, sessionId: 'session-fixture', leads: leads(1) }).ok, true);
  return game;
}
function begin(game) {
  const lead = getResearchStatus(game).leads[1];
  assert.equal(startResearch(game, lead.question, { requestId: 'request-fixture', leadId: lead.id }).ok, true);
}
function resultFor(game, status = 'mixed', focus = 'spread') {
  const job = game.research, round = RESEARCH_ROUNDS.find(round => round.id === job.roundId);
  return {
    sessionId: job.sessionId, leadId: job.leadId, claim, provider: '联网调查', requestId: `source-${round.round}`, fetchedAt: '2026-10-22T00:00:00Z',
    query: job.query, searchQuery: job.query, finding: '发现需要区分的条件。', nextLeads: round.round < RESEARCH_ROUNDS.length ? leads(round.round + 1) : [],
    assessment: { status, summary: '现有材料只支持有限条件，不足以支持绝对表述。' }, recommendation: { materialId: round.materials.find(material => material.focus === focus).id, reason: focus === 'spread' ? '当前触达不足，先扩大传播。' : '先争取已触达的观望者。' },
    materials: round.materials.map((template, index) => ({ id: template.id, focus: template.focus, eventId: template.eventId,
      title: `来源 ${round.round}-${index}`, finding: '材料对适用条件有明确限定。', nextQuestion: round.round < RESEARCH_ROUNDS.length ? leads(round.round + 1)[0].question : null,
      insight: { kind: 'context', headline: `发现 ${round.round}-${index}`, explanation: '只适用于注明的条件。', quote: `原始记录${round.round}-${index}写明了适用条件。` },
      sources: [{ title: `原始来源${index}`, url: `https://example.org/${round.round}/${index}`, organization: '记录机构', summary: `这是摘要。原始记录${round.round}-${index}写明了适用条件。完整内容需查看原文。` }],
      effectId: index ? 'explain' : 'relay', effectReason: '同时补充可传播的解释。',
    })),
  };
}
function complete(game, status, focus) { begin(game); const result = resultFor(game, status, focus); assert.equal(completeLiveResearch(game, 'request-fixture', result).ok, true); return result; }
function secondReady(game) { game.regions.slice(0, 3).forEach(region => { region.seeded = true; }); assert.equal(publishEvidence(game).ok, true); }

function refreshedPlan(game, suffix = 'new') {
  return { claim, sessionId: game.investigation.sessionId, roundId: game.investigation.refresh.roundId,
    leads: [1, 2].map(index => ({ id: `${suffix}-${index}`, title: `换个角度${index}`, question: `刷新${suffix}后第${index}条问题是什么？`, reason: '顺着已有证据核对另一处缺口。' })) };
}

test('one coin refreshes both questions without charging for research or allowing parallel payment', () => {
  const game = plannedGame(); game.coins = 1;
  const request = startLeadRefresh(game, 'refresh-one');
  assert.equal(request.ok, true); assert.equal(request.cost, 1); assert.equal(request.promotedId, null);
  assert.deepEqual(request.leadIds, leads(1).map(lead => lead.id));
  assert.equal(game.coins, 0); assert.equal(game.coinEconomy.spent, 1);
  assert.equal(getResearchStatus(game).phase, 'refreshing'); assert.equal(getResearchStatus(game).available, false);
  const pending = JSON.stringify(game);
  assert.equal(startLeadRefresh(game, 'double-click').ok, false);
  assert.equal(startResearch(game, leads(1)[0].question, { requestId: 'search-race', leadId: 'r1-1' }).ok, false);
  assert.equal(JSON.stringify(game), pending);
  const response = refreshedPlan(game);
  assert.equal(completeLeadRefresh(game, request.requestId, response).ok, true);
  assert.deepEqual(game.investigation.leads, response.leads);
  response.leads[0].question = '外部修改'; assert.notEqual(game.investigation.leads[0].question, response.leads[0].question);
  assert.equal(game.investigation.refresh, null); assert.equal(game.investigation.refreshError, null);
  assert.equal(game.coinEconomy.refreshSpent, 1); assert.equal(game.coinEconomy.researchPaid, 0);
  assert.equal(game.evidence.length, 0); assert.equal(game.researchResults.length, 0);
  assert.deepEqual(game.levels, { spread: 0, persuasion: 0, defense: 0 });
  assert.equal(getResearchStatus(game).phase, 'ready'); assert.equal(getResearchStatus(game).available, false);
  const settled = JSON.stringify(game);
  assert.equal(completeLeadRefresh(game, request.requestId, response).ok, false);
  assert.equal(failLeadRefresh(game, request.requestId).ok, false); assert.equal(JSON.stringify(game), settled);
});

test('refresh rejects zero coins, offline demos, unplanned, searching and publication-locked cases without mutation', () => {
  const noCoins = plannedGame(); noCoins.coins = 0;
  const researching = plannedGame(); begin(researching);
  const unpublished = plannedGame(); complete(unpublished);
  const networkLocked = plannedGame(); complete(networkLocked); publishEvidence(networkLocked);
  for (const game of [noCoins, createGame(), agentGame(), researching, unpublished, networkLocked]) {
    const before = JSON.stringify(game);
    assert.equal(startLeadRefresh(game, 'not-available').ok, false); assert.equal(JSON.stringify(game), before);
  }
  const game = plannedGame(), before = JSON.stringify(game);
  assert.equal(startLeadRefresh(game, '').ok, false); assert.equal(JSON.stringify(game), before);
});

test('a failed refresh keeps the old directions and unrelated search error, and refunds exactly once', () => {
  const game = plannedGame(), balance = game.coins;
  game.researchError = { message: '上次搜证失败', query: '原查询', roundId: 'photo' };
  const researchError = structuredClone(game.researchError);
  assert.equal(startLeadRefresh(game, 'refresh-fail').ok, true);
  const failure = failLeadRefresh(game, 'refresh-fail', '暂时无法连接');
  assert.equal(failure.refund, 1); assert.match(game.investigation.refreshError, /1 金币已退回，原问题保留/);
  assert.deepEqual(game.investigation.leads, leads(1)); assert.deepEqual(game.researchError, researchError);
  assert.equal(game.coins, balance); assert.equal(game.coinEconomy.spent, 0); assert.equal(game.coinEconomy.refreshSpent, 0);
  const settled = JSON.stringify(game);
  assert.equal(failLeadRefresh(game, 'refresh-fail').refund, undefined); assert.equal(JSON.stringify(game), settled);
  assert.equal(startLeadRefresh(game, 'refresh-retry').ok, true); assert.equal(game.investigation.refreshError, null);
  const retry = JSON.stringify(game);
  assert.equal(failLeadRefresh(game, 'refresh-fail').refund, undefined); assert.equal(JSON.stringify(game), retry);
  failLeadRefresh(game, 'refresh-retry');
  begin(game); assert.equal(game.investigation.refreshError, null, 'starting the retained direction clears the old refresh notice');
});

test('foreign, stale, duplicate or malformed refresh responses are rejected before the caller settles their refund', () => {
  const mutations = [
    value => { value.sessionId = 'other-session'; }, value => { value.claim = '别的传闻'; }, value => { value.roundId = 'wrong-round'; },
    value => { value.leads = value.leads.slice(0, 1); }, value => { value.leads[0].id = 'r1-1'; },
    value => { value.leads[0].question = leads(1)[0].question; },
    value => { value.leads[1].question = ` ${value.leads[0].question.replace('？', '?')} `; },
    value => { value.leads[0].reason = ''; },
  ];
  for (const mutate of mutations) {
    const game = plannedGame(), balance = game.coins;
    startLeadRefresh(game, 'refresh-invalid'); const response = refreshedPlan(game); mutate(response);
    assert.equal(completeLeadRefresh(game, 'refresh-invalid', response).ok, false);
    assert.ok(game.investigation.refresh, 'the caller owns failure settlement');
    assert.deepEqual(game.investigation.leads, leads(1)); assert.equal(game.coins, balance - 1);
    assert.equal(failLeadRefresh(game, 'refresh-invalid').refund, 1); assert.equal(game.coins, balance);
  }
});

test('successful refreshes bind the new research choice while preserving prior evidence and its original next leads', () => {
  const game = plannedGame(); complete(game); secondReady(game);
  const previous = structuredClone(game.researchResults[0]), balance = game.coins;
  game.researchError = { roundId: RESEARCH_ROUNDS[1].id, message: '原方向没查到资料' };
  const request = startLeadRefresh(game, 'refresh-second');
  assert.equal(request.promotedId, previous.promotedId); assert.equal(request.roundId, RESEARCH_ROUNDS[1].id);
  const response = refreshedPlan(game);
  assert.equal(completeLeadRefresh(game, request.requestId, response).ok, true);
  assert.equal(game.researchError, null, 'fresh directions do not display a stale search error');
  assert.deepEqual(game.researchResults[0], previous); assert.deepEqual(previous.nextLeads, leads(2));
  assert.equal(game.evidence.length, 1); assert.equal(game.coins, balance - 1);
  assert.equal(startResearch(game, leads(2)[0].question, { requestId: 'old-choice', leadId: leads(2)[0].id }).ok, false);
  complete(game); assert.deepEqual(game.researchResults[1].chosenLead, response.leads[1]);
  assert.deepEqual(game.investigation.leads, leads(3)); assert.equal(game.evidence.length, 2);
  assert.equal(game.coinEconomy.spent, RULES.researchCosts[0] + RULES.researchCosts[1] + 1);
});

test('completed refresh cost can be earned back, but pending or failed refreshes cannot expand the coin budget', () => {
  const game = plannedGame(); game.coins = game.coinEconomy.collected = game.coinEconomy.generated = RULES.researchCosts[0];
  assert.equal(getCoinEconomy(game).fundingRemaining, 0);
  startLeadRefresh(game, 'refresh-budget'); assert.equal(getCoinEconomy(game).fundingRemaining, 0);
  tick(game, 40); assert.equal(game.coinEconomy.generated, RULES.researchCosts[0]);
  failLeadRefresh(game, 'refresh-budget'); assert.equal(getCoinEconomy(game).fundingRemaining, 0);
  startLeadRefresh(game, 'refresh-budget-retry'); completeLeadRefresh(game, 'refresh-budget-retry', refreshedPlan(game));
  assert.equal(getCoinEconomy(game).fundingRemaining, 1);
  tick(game, 40);
  assert.equal(game.coinEconomy.generated, RULES.researchCosts[0] + 1);
  for (const drop of [...game.coinDrops]) collectCoin(game, drop.id);
  assert.equal(game.coins, RULES.researchCosts[0]); assert.equal(getResearchStatus(game).available, true);
  assert.equal(getCoinEconomy(game).fundingRemaining, 0);
});

test('the fifth round can earn back refresh fees and still finish all searches without premature cashout', () => {
  const game = plannedGame(), budget = RULES.researchCosts.reduce((total, cost) => total + cost, 0);
  game.coins = game.coinEconomy.collected = game.coinEconomy.generated = budget;
  for (let round = 0; round < 4; round++) { complete(game); secondReady(game); }
  assert.equal(game.coins, RULES.researchCosts[4]);
  startLeadRefresh(game, 'refresh-final');
  assert.equal(getCoinEconomy(game).fundingRemaining, 0); assert.equal(game.coinEconomy.converted, 0);
  completeLeadRefresh(game, 'refresh-final', refreshedPlan(game));
  assert.equal(getCoinEconomy(game).fundingRemaining, 1);
  tick(game, 12); for (const drop of [...game.coinDrops]) collectCoin(game, drop.id);
  assert.equal(game.coins, RULES.researchCosts[4]); assert.equal(game.coinEconomy.converted, 0);
  complete(game); assert.equal(game.evidence.length, 5); assert.equal(game.coinEconomy.researchPaid, 5);
  assert.equal(game.coinEconomy.spent, budget + 1); assert.equal(game.coinEconomy.refreshSpent, 1);
  assert.equal(game.coins, 0); assert.equal(getCoinEconomy(game).cashoutActive, true);
});

test('refresh responses cannot change a restarted or finished case; pending cost can still be refunded without unfreezing it', () => {
  for (const outcome of ['won', 'lost']) {
    const game = plannedGame(), balance = game.coins;
    startLeadRefresh(game, 'refresh-ending'); const response = refreshedPlan(game);
    if (outcome === 'won') { winningPopulation(game); tick(game, .1); }
    else game.phase = 'lost';
    const world = frozenWorld(game);
    assert.equal(completeLeadRefresh(game, 'refresh-ending', response).ok, false);
    assert.deepEqual(game.investigation.leads, leads(1)); assert.deepEqual(frozenWorld(game), world);
    assert.equal(failLeadRefresh(game, 'refresh-ending').refund, 1); assert.equal(game.coins, balance);
    assert.deepEqual(frozenWorld(game), world); assert.equal(game.phase, outcome);
    const settled = JSON.stringify(game);
    tick(game, 30); assert.equal(JSON.stringify(game), settled);
    assert.equal(failLeadRefresh(game, 'refresh-ending').refund, undefined);
    assert.equal(startLeadRefresh(game, 'post-game').ok, false);
    const restarted = plannedGame(), before = JSON.stringify(restarted);
    assert.equal(completeLeadRefresh(restarted, 'refresh-ending', response).ok, false);
    assert.equal(failLeadRefresh(restarted, 'refresh-ending').refund, undefined); assert.equal(JSON.stringify(restarted), before);
  }
});

test('planning is free, binds the original claim and cannot turn a foreign plan into playable leads', () => {
  const game = agentGame(), before = JSON.stringify(game);
  assert.equal(getResearchStatus(game).phase, 'planning');
  assert.equal(setInvestigationPlan(game, { claim: '其他传闻', sessionId: 'another-session', leads: leads(1) }).ok, false);
  assert.equal(JSON.stringify(game), before);
  assert.equal(startResearch(game, leads(1)[0].question, { requestId: 'bad', leadId: 'r1-1' }).ok, false);
  assert.equal(game.coins, 90); assert.equal(getPublishPreview(game).available, false);
  failInvestigationPlan(game, '服务暂不可用');
  assert.equal(getJourney(game).stage, 'research-plan-error');
  assert.equal(setInvestigationPlan(game, { claim, sessionId: 'session-fixture', leads: leads(1) }).ok, true);
  assert.equal(getResearchStatus(game).phase, 'ready'); assert.equal(game.coins, 90);
});

test('players select bound directions, results keep factual status and apply only catalogued gains', () => {
  const game = plannedGame();
  assert.equal(startResearch(game, '一个任意问题', { requestId: 'bad', leadId: 'r1-2' }).ok, false);
  assert.equal(game.coins, 90);
  complete(game, 'supported');
  assert.equal(game.researchResults[0].assessment.status, 'supported');
  assert.equal(game.researchResults[0].chosenLead.id, 'r1-2');
  assert.equal(getResearchStatus(game).phase, 'ready-to-publish');
  assert.equal(game.researchResults[0].selectedId, 'photo-spread');
  assert.equal(getPublishPreview(game).available, true);
  assert.equal(getPublishPreview(game).cost, 0);
  assert.equal(getEvidenceBonuses(game).spreadBonus, 0);
  assert.equal(publishEvidence(game).ok, true);
  assert.equal(getEvidenceBonuses(game).spreadBonus, .25);
  assert.equal(getEvidenceBonuses(game).persuasionBonus, .15);
  assert.equal(getPublishPreview(game).available, false);
  assert.equal(game.evidence.length, 1); assert.equal(game.coins, 72);
  assert.equal(getResearchStatus(game).phase, 'locked');
  assert.equal(getResearchStatus(game).gate, 'network');
});

test('a single agent evidence card can be stored and published without inventing another candidate', () => {
  for (const focus of ['spread', 'persuasion']) {
    const game = plannedGame(); begin(game);
    const response = resultFor(game, 'supported', focus);
    response.materials = response.materials.filter(material => material.focus === focus);
    const original = structuredClone(response.materials[0]);
    assert.equal(completeLiveResearch(game, 'request-fixture', response).ok, true);
    const result = game.researchResults[0];
    assert.equal(result.materials.length, 1); assert.deepEqual(result.evidenceIds, [original.id]);
    assert.equal(result.selectedId, original.id); assert.equal(result.assessment.status, 'supported');
    response.materials[0].sources[0].summary = '外部替换';
    response.materials[0].insight.quote = '外部替换';
    assert.equal(result.materials[0].sources[0].summary, original.sources[0].summary);
    assert.equal(result.materials[0].insight.quote, original.insight.quote);
    result.storedAt = game.time;
    assert.match(getResearchStatus(game).reason, /收入囊中/);
    assert.equal(getEvidenceBonuses(game).spreadBonus, 0);
    assert.equal(getEvidenceBonuses(game).persuasionBonus, 0);
    assert.equal(publishEvidence(game).ok, true);
    assert.equal(publishEvidence(game).ok, false);
    assert.equal(game.publications[0].evidenceId, original.id);
    const report = buildCaseReport(game);
    assert.equal(report.steps[0].materials.length, 1);
    assert.equal(report.steps[0].materialId, original.id);
    assert.equal(report.steps[0].quote, original.insight.quote);
    assert.deepEqual(report.sources.map(source => source.url), [original.sources[0].url]);
  }
});

test('single-card results still reject invalid identities, effects, sources and quotes with one refund', () => {
  const mutations = [
    response => { response.materials = []; },
    response => { response.materials.push(structuredClone(response.materials[0])); },
    response => { response.materials.push({ ...response.materials[0], id: 'unknown-card' }); },
    response => { response.materials[0].id = RESEARCH_ROUNDS[1].materials[0].id; },
    response => { response.materials[0].focus = 'persuasion'; },
    response => { response.materials[0].eventId = 'foreign-event'; },
    response => { response.materials[0].effectId = 'authority'; },
    response => { response.materials[0].effectId = 'win-game'; },
    response => { response.materials[0].sources = []; },
    response => { response.materials[0].sources[0].url = 'javascript:alert(1)'; },
    response => { response.materials[0].sources[0].url = 'http://localhost/private'; },
    response => { response.materials[0].sources[0].url = 'https://user:secret@example.org/private'; },
    response => { response.materials[0].insight.quote = '原文没有的结论'; },
    response => { response.recommendation.materialId = RESEARCH_ROUNDS[0].materials[1].id; },
  ];
  for (const mutate of mutations) {
    const game = plannedGame(); begin(game);
    const response = resultFor(game); response.materials = response.materials.slice(0, 1); mutate(response);
    assert.equal(completeLiveResearch(game, 'request-fixture', response).ok, false);
    assert.equal(game.coins, 90); assert.equal(game.evidence.length, 0); assert.equal(game.researchResults.length, 0);
    assert.equal(failLiveResearch(game, 'request-fixture').ok, false); assert.equal(game.coins, 90);
  }
});

test('five single-card investigations preserve publication references through final review and report export', () => {
  const game = plannedGame();
  game.coins = game.coinEconomy.generated = game.coinEconomy.collected = RULES.researchCosts.reduce((sum, cost) => sum + cost, 0);
  for (let round = 1; round <= RESEARCH_ROUNDS.length; round++) {
    begin(game);
    const response = resultFor(game, 'mixed', round % 2 ? 'persuasion' : 'spread');
    response.materials = response.materials.filter(material => material.id === response.recommendation.materialId);
    assert.equal(completeLiveResearch(game, 'request-fixture', response).ok, true);
    assert.equal(game.researchResults.at(-1).materials.length, 1);
    assert.equal(game.researchResults.at(-1).selectedId, response.materials[0].id);
    secondReady(game);
  }
  assert.equal(getResearchStatus(game).phase, 'complete');
  assert.equal(game.coinEconomy.researchPaid, 5);
  assert.deepEqual(game.investigation.leads, []);
  winningPopulation(game); tick(game, .1);
  const started = startFinalReview(game, 'single-card-review');
  assert.equal(started.ok, true); assert.equal(started.request.publications.length, 5);
  assert.equal(completeFinalReview(game, started.request.requestId, reviewPayload(game, 'insufficient')).ok, true);
  const report = buildCaseReport(game);
  assert.equal(report.steps.length, 5); assert.equal(report.sources.length, 5);
  assert.equal(report.finalVerdict.chain.length, 5); assert.equal(report.ending.id, 'new-company');
  for (const [index, step] of report.steps.entries()) {
    const material = game.researchResults[index].materials[0];
    assert.equal(step.materials.length, 1); assert.equal(step.materialId, material.id);
    assert.equal(step.quote, material.insight.quote);
    assert.deepEqual(report.finalVerdict.chain[index].sourceUrls, [material.sources[0].url]);
    assert.ok(caseReportText(report).includes(material.sources[0].url));
  }
});

test('tampered session, quote, effect or recommendation refunds once and creates no evidence', () => {
  const mutations = [result => { result.sessionId = 'foreign'; }, result => { result.claim = 'foreign'; }, result => { result.materials[0].effectId = 'win-game'; }, result => { result.materials[0].insight.quote = '原文没有这句话'; }, result => { result.recommendation.materialId = 'fake'; }];
  for (const mutate of mutations) {
    const game = plannedGame(); begin(game); const result = resultFor(game); mutate(result);
    assert.equal(completeLiveResearch(game, 'request-fixture', result).ok, false);
    assert.equal(game.coins, 90); assert.equal(game.evidence.length, 0);
    assert.equal(failLiveResearch(game, 'request-fixture').ok, false); assert.equal(game.coins, 90);
  }
});

test('round two follows saved next leads, locks its recommendation and settles its payment once', () => {
  const game = plannedGame(); complete(game); secondReady(game);
  assert.deepEqual(getResearchStatus(game).leads, leads(2));
  const result = complete(game, 'refuted', 'persuasion');
  result.assessment.summary = '外部修改'; result.materials[0].insight.headline = '外部修改';
  assert.equal(game.coinEconomy.researchPaid, 2); assert.equal(game.coinEconomy.spent, RULES.researchCosts[0] + RULES.researchCosts[1]);
  assert.equal(game.researchResults[1].assessment.status, 'refuted');
  assert.equal(game.researchResults[1].materials[0].insight.headline, '发现 2-0');
  assert.equal(game.researchResults[1].selectedId, 'conditions-persuasion');
  assert.equal(publishEvidence(game).ok, true);
  assert.equal(getResearchStatus(game).phase, 'ready');
  assert.deepEqual(getResearchStatus(game).leads, leads(3));
});

test('all five live rounds gate on publication, refund a failed final round and export five traceable evidence records', () => {
  const game = plannedGame(), budget = RULES.researchCosts.reduce((sum, cost) => sum + cost, 0);
  game.coins = game.coinEconomy.generated = game.coinEconomy.collected = budget + RULES.coinExchangeRate * 2;
  for (let round = 1; round <= RESEARCH_ROUNDS.length; round++) {
    assert.deepEqual(getResearchStatus(game).leads, leads(round));
    if (round === 5) {
      const balance = game.coins;
      begin(game);
      const broken = resultFor(game); broken.materials[0].insight.quote = '原文里没有的结论';
      assert.equal(game.coinEconomy.converted, 0, 'paying for the final round must not cash out money before success');
      assert.equal(completeLiveResearch(game, 'request-fixture', broken).ok, false);
      assert.equal(game.coins, balance); assert.equal(game.evidence.length, 4);
      assert.equal(failLiveResearch(game, 'request-fixture').ok, false);
      assert.equal(game.coins, balance, 'a duplicate failure must not refund twice');
    }
    const result = complete(game, round === 5 ? 'insufficient' : 'mixed', round % 2 ? 'persuasion' : 'spread');
    const balance = game.coins;
    assert.equal(getResearchStatus(game).phase, 'ready-to-publish');
    assert.equal(startResearch(game, leads(round + 1)[0].question, { requestId: 'skip-choice', leadId: `r${round + 1}-1` }).ok, false);
    assert.equal(game.coins, balance);
    const selected = result.materials[round % 2];
    assert.equal(game.researchResults.at(-1).selectedId, selected.id);
    assert.equal(publishEvidence(game).ok, true);
    assert.equal(publishEvidence(game).ok, false, 'each investigation can be published only once');
    if (round === 1) game.regions.slice(0, 3).forEach(region => { region.seeded = true; });
  }
  assert.equal(getResearchStatus(game).phase, 'complete');
  assert.deepEqual(getResearchStatus(game).leads, []);
  assert.equal(game.coinEconomy.researchPaid, 5); assert.equal(game.coinEconomy.spent, budget);
  assert.equal(game.coinEconomy.converted, RULES.coinExchangeRate * 2);
  assert.equal(game.coinEconomy.pointsEarned, 2); assert.equal(game.coins, 0);
  game.phase = 'won';
  const report = buildCaseReport(game);
  assert.equal(report.steps.length, 5); assert.equal(report.sources.length, 5);
  assert.equal(report.verdict.status, 'insufficient');
  assert.ok(report.steps.every(step => step.materials.length === 1 && step.materials.filter(material => material.selected).length === 1));
  assert.match(caseReportText(report), /完成 5\/5 轮调查/);
  assert.match(caseReportText(report), /https:\/\/example.org\/5\/1/);
});

function winningPopulation(game, support = RULES.winTruth) {
  for (const region of game.regions) Object.assign(region, { red: 0, exposed: 100 - support, blue: support, seeded: true });
}
function frozenWorld(game) {
  return structuredClone(Object.fromEntries(['time', 'victoryAt', 'regions', 'points', 'levels', 'publications', 'event', 'enemyWaves', 'transit', 'mediaEvents', 'evidenceEvents', 'recoveryUntil', 'totals'].map(key => [key, game[key]])));
}

test('a winning live request finishes only its locked request, archives evidence and never resumes the world', () => {
  const game = plannedGame(); begin(game); const result = resultFor(game, 'insufficient');
  winningPopulation(game); tick(game, 1);
  assert.equal(game.phase, 'won'); assert.equal(game.victoryAt, 0);
  assert.equal(game.victoryResearchId, 'request-fixture');
  const world = frozenWorld(game), before = JSON.stringify(game);
  assert.equal(completeLiveResearch(game, 'other-request', result).ok, false);
  assert.equal(failLiveResearch(game, 'other-request').ok, false);
  assert.equal(JSON.stringify(game), before);
  tick(game, 60); assert.deepEqual(frozenWorld(game), world);
  assert.equal(completeLiveResearch(game, 'request-fixture', result).ok, true);
  assert.deepEqual(frozenWorld(game), world);
  assert.equal(game.research, null); assert.equal(game.researchResults.length, 1);
  const archived = game.researchResults[0];
  assert.equal(archived.storedAt, game.victoryAt); assert.equal(archived.promotedId, null);
  assert.equal(getEvidenceBonuses(game).spreadBonus, 0); assert.equal(getEvidenceBonuses(game).persuasionBonus, 0);
  assert.equal(publishEvidence(game).ok, false);
  const report = buildCaseReport(game);
  assert.equal(report.outcome, 'won'); assert.equal(report.steps.length, 1); assert.equal(report.verdict.status, 'insufficient');
  const settled = JSON.stringify(game);
  assert.equal(completeLiveResearch(game, 'request-fixture', result).ok, false);
  assert.equal(failLiveResearch(game, 'request-fixture').ok, false);
  tick(game, 300); assert.equal(JSON.stringify(game), settled);
});

test('a failed winning live request refunds once without changing the locked victory', () => {
  const game = plannedGame(), balance = game.coins; begin(game);
  winningPopulation(game); tick(game, .1);
  const world = frozenWorld(game);
  const failure = failLiveResearch(game, 'request-fixture', '检索未完成');
  assert.equal(failure.refund, RULES.researchCosts[0]); assert.equal(game.coins, balance);
  assert.equal(game.coinEconomy.spent, 0); assert.equal(game.research, null); assert.equal(game.evidence.length, 0);
  assert.deepEqual(frozenWorld(game), world); assert.equal(game.phase, 'won');
  const settled = JSON.stringify(game);
  assert.equal(failLiveResearch(game, 'request-fixture').ok, false);
  tick(game, 60); assert.equal(JSON.stringify(game), settled);
});

test('manually marking a game won never authorizes a previously pending live response', () => {
  const game = plannedGame(); begin(game); const result = resultFor(game);
  game.phase = 'won';
  assert.equal(game.victoryResearchId, null);
  const before = JSON.stringify(game);
  assert.equal(completeLiveResearch(game, 'request-fixture', result).ok, false);
  assert.equal(failLiveResearch(game, 'request-fixture').ok, false);
  tick(game, 30); assert.equal(JSON.stringify(game), before);
});

test('the final paid search can be archived after victory without cashing coins into combat rewards', () => {
  const game = plannedGame();
  game.coins = RULES.researchCosts.reduce((sum, cost) => sum + cost, 0) + 12;
  for (let round = 0; round < 4; round++) {
    complete(game); assert.equal(publishEvidence(game).ok, true);
    game.regions.forEach(region => { region.seeded = true; });
  }
  begin(game); const result = resultFor(game);
  winningPopulation(game); tick(game, .1);
  const world = frozenWorld(game), converted = game.coinEconomy.converted;
  assert.equal(completeLiveResearch(game, 'request-fixture', result).ok, true);
  assert.deepEqual(frozenWorld(game), world);
  assert.equal(game.coinEconomy.converted, converted);
  assert.equal(game.coins, 12); assert.equal(game.researchResults.at(-1).storedAt, game.victoryAt);
  assert.equal(game.researchResults.at(-1).promotedId, null);
});

test('victory archives an already completed unpublished report without applying its powers', () => {
  const game = plannedGame(); complete(game); const report = game.researchResults[0];
  assert.equal(report.promotedId, null);
  winningPopulation(game); tick(game, .1);
  assert.equal(game.phase, 'won'); assert.equal(game.victoryResearchId, null);
  assert.equal(report.storedAt, game.victoryAt); assert.equal(report.promotedId, null);
  assert.equal(game.publications.length, 0); assert.equal(game.enemyWaves.length, 0);
  assert.equal(getEvidenceBonuses(game).spreadBonus, 0);
  assert.equal(buildCaseReport(game).steps.length, 1);
});

test('a winning report cannot upgrade insufficient evidence into a refutation', () => {
  const game = plannedGame(); complete(game, 'insufficient'); publishEvidence(game);
  game.phase = 'won'; const report = buildCaseReport(game);
  assert.equal(report.verdict.status, 'insufficient'); assert.equal(report.stats.evidenceCount, 1);
  assert.equal(report.steps[0].question, leads(1)[1].question);
  assert.equal(report.steps[0].materials.length, 1); assert.equal(report.steps[0].materials.filter(material => material.selected).length, 1);
  assert.equal(report.sources.length, 1); assert.match(caseReportText(report), /完成 1\/5 轮调查/);
  assert.match(caseReportText(report), /https:\/\/example.org\/1\/0/);
  assert.ok(!report.timeline.some(event => event.kind === 'arrival'));
  assert.deepEqual(buildCaseReport(game), report);
  report.steps[0].materials[0].finding = 'changed';
  assert.notEqual(buildCaseReport(game).steps[0].materials[0].finding, 'changed');
});

test('report supports zero, two rounds, real battle events and truthful lost outcomes', () => {
  const game = plannedGame(); assert.equal(buildCaseReport(game).steps.length, 0);
  assert.equal(buildCaseReport(game).sources.length, 0);
  complete(game); secondReady(game); complete(game, 'supported', 'persuasion');
  publishEvidence(game); game.phase = 'lost';
  const report = buildCaseReport(game);
  assert.equal(report.outcome, 'lost'); assert.equal(report.verdict.status, 'insufficient', 'a provisional round assessment is not a final chain review');
  assert.equal(report.ending.id, 'defeat');
  assert.equal(report.steps.length, 2); assert.equal(report.sources.length, 2);
  assert.equal(report.style.name, '原装出厂', 'mixed evidence does not count as purchased upgrades');
  assert.deepEqual(report.style.levels, { spread: 0, persuasion: 0, defense: 0 });
  assert.ok(report.timeline.some(event => event.kind === 'publication'));
  assert.equal(report.steps[1].effectLabel, '说服 +35% · 传播 +15%');
});

function reviewGame() {
  const game = plannedGame(); complete(game, 'supported'); secondReady(game);
  for (const region of game.regions) Object.assign(region, { blue: 99, exposed: 1, red: 0, seeded: true });
  tick(game, .1); assert.equal(game.phase, 'won');
  return game;
}
function reviewPayload(game, status = 'refuted') {
  const review = game.finalReview;
  return { requestId: review.requestId, sessionId: review.sessionId, finalVerdict: {
    status, confidence: status === 'refuted' ? 'high' : 'medium', summary: '结合已公布记录，对原观点进行整体核查。',
    rationale: '先核对原命题，再区分直接证明与背景材料；未找到证据不等于已经反驳。',
    unresolved: status === 'refuted' ? [] : ['仍需补上对原命题的直接测量。'],
    reviewedPublications: review.publications.map(item => ({ ...item })),
    chain: review.publications.map(publication => {
      const result = game.researchResults.find(item => item.roundId === publication.roundId);
      const material = result.materials.find(item => item.id === publication.materialId);
      return { roundId: result.roundId, question: result.chosenLead.question, finding: material.finding,
        strength: status === 'refuted' ? 'strong' : 'limited', relevance: 'direct', gap: status === 'refuted' ? '' : '缺少对原命题的直接测量。', sourceUrls: material.sources.map(source => source.url) };
    }),
  } };
}

test('a final review binds actual published evidence and leaves the frozen victory and gameplay untouched', () => {
  const game = reviewGame(), before = structuredClone(game), started = startFinalReview(game, 'final-one');
  assert.equal(started.ok, true);
  assert.deepEqual(started.request.publications, game.publications.map(item => ({ roundId: item.roundId, materialId: item.evidenceId })));
  started.request.publications[0].materialId = 'outside-mutation';
  assert.notEqual(game.finalReview.publications[0].materialId, 'outside-mutation');
  const payload = reviewPayload(game);
  assert.equal(completeFinalReview(game, 'final-one', payload).ok, true);
  const report = buildCaseReport(game);
  assert.equal(report.ending.id, 'truth'); assert.equal(report.verdict.status, 'refuted');
  assert.equal(game.researchResults[0].assessment.status, 'supported', 'the final review is distinct from a round assessment');
  assert.equal(report.finalVerdict.chain.length, 1); assert.match(caseReportText(report), /真相战胜了谎言/);
  payload.finalVerdict.chain[0].finding = 'outside-mutation'; report.finalVerdict.chain[0].finding = 'report-mutation';
  assert.notEqual(game.finalReview.verdict.chain[0].finding, 'outside-mutation'); assert.notEqual(game.finalReview.verdict.chain[0].finding, 'report-mutation');
  const after = structuredClone(game); after.finalReview = before.finalReview;
  assert.deepEqual(after, before, 'fact review cannot change resources, victory time, waves or evidence bonuses');
  assert.equal(startFinalReview(game, 'final-two').ok, false);
});

test('a completed chain review can expose the new-company ending without treating absence of proof as truth', () => {
  for (const status of ['supported', 'mixed', 'insufficient']) {
    const game = reviewGame(); game.researchResults[0].assessment.status = 'refuted';
    startFinalReview(game, `final-${status}`);
    assert.equal(completeFinalReview(game, `final-${status}`, reviewPayload(game, status)).ok, true);
    const report = buildCaseReport(game);
    assert.equal(report.ending.id, 'new-company'); assert.equal(report.verdict.status, status);
    const explanations = { supported: /材料.*支持原观点/, mixed: /条件限制或彼此冲突/, insufficient: /未能证伪不等于原观点为真/ };
    assert.match(report.ending.summary, explanations[status]);
    assert.match(caseReportText(report), /新的谎言公司/);
    assert.equal(game.phase, 'won', 'a narrative reversal does not revoke the gameplay win');
  }
});

test('a cited direct finding with medium confidence and noncritical follow-ups survives game and report serialization', () => {
  const game = reviewGame();
  assert.equal(startFinalReview(game, 'reasonable-review').ok, true);
  const payload = reviewPayload(game);
  payload.finalVerdict.confidence = 'medium';
  payload.finalVerdict.chain[0].strength = 'limited';
  payload.finalVerdict.chain[0].gap = '材料只覆盖原观点所指的版本，未逐一核对其他版本。';
  payload.finalVerdict.rationale = '材料直接涉及原观点所指的版本，现有范围已足以判断；其他版本不影响这次结论。';
  payload.finalVerdict.unresolved = ['尚未取得所有版本的完整资料，其他版本仍可继续补查。'];
  assert.equal(completeFinalReview(game, 'reasonable-review', payload).ok, true);
  const restored = JSON.parse(JSON.stringify(game));
  assert.deepEqual(restored.finalReview.verdict, payload.finalVerdict);
  const report = JSON.parse(JSON.stringify(buildCaseReport(restored))), text = caseReportText(report);
  assert.equal(report.ending.id, 'truth');
  assert.deepEqual(report.finalVerdict, payload.finalVerdict);
  assert.equal(report.finalVerdict.chain.length, 1, 'one adequate published finding can support the judgment');
  assert.match(text, /材料边界：材料只覆盖原观点所指的版本/);
  assert.ok(text.includes(payload.finalVerdict.unresolved[0]));
  assert.match(text, /真相战胜了谎言/);
  assert.doesNotMatch(text, /完整证明|medium|limited/);
});

test('final review accepts a combined proof when each published source has a local boundary', () => {
  const game = plannedGame(); complete(game); secondReady(game); complete(game);
  assert.equal(publishEvidence(game).ok, true);
  for (const region of game.regions) Object.assign(region, { blue: 99, exposed: 1, red: 0, seeded: true });
  tick(game, .1); assert.equal(game.phase, 'won');
  assert.equal(startFinalReview(game, 'combined-proof').ok, true);
  const payload = reviewPayload(game);
  assert.equal(payload.finalVerdict.chain.length, 2);
  payload.finalVerdict.chain[0].gap = '这份记录只确认主体身份，不说明其登记地点。';
  payload.finalVerdict.chain[1].gap = '这份记录只确认该主体登记地点，不列出其产品。';
  payload.finalVerdict.rationale = '两份已公布记录分别确认主体和登记地点，合并后没有影响原观点判断的缺口。';
  assert.equal(completeFinalReview(game, 'combined-proof', payload).ok, true);
  const report = buildCaseReport(game);
  assert.equal(report.ending.id, 'truth');
  assert.deepEqual(report.finalVerdict.chain, payload.finalVerdict.chain);
  assert.equal(report.steps.filter(step => step.published).length, 2);
  assert.match(caseReportText(report), /材料边界：这份记录只确认主体身份/);
});

test('legacy, offline and failed reviews remain unreviewed rather than manufacturing either ending', () => {
  const legacy = reviewGame(); legacy.finalReview = undefined; legacy.researchResults[0].assessment.status = 'refuted';
  assert.equal(buildCaseReport(legacy).ending.id, 'unreviewed');
  const demo = createGame(); demo.phase = 'won';
  assert.equal(buildCaseReport(demo).ending.id, 'unreviewed'); assert.equal(startFinalReview(demo, 'demo').ok, false);
  const game = reviewGame(); startFinalReview(game, 'final-fail');
  assert.equal(buildCaseReport(game).ending.id, 'unreviewed');
  failFinalReview(game, 'final-fail', '连接暂时中断');
  assert.equal(buildCaseReport(game).ending.id, 'unreviewed'); assert.equal(game.finalReview.status, 'failed');
  assert.equal(startFinalReview(game, 'final-retry').ok, true);
  const before = JSON.stringify(game), stale = reviewPayload(game); stale.requestId = 'final-fail';
  assert.equal(completeFinalReview(game, 'final-fail', stale).ok, false); assert.equal(failFinalReview(game, 'final-fail').ok, false);
  assert.equal(JSON.stringify(game), before);
  assert.equal(completeFinalReview(game, 'final-retry', reviewPayload(game)).ok, true);
});

test('final reviews reject foreign sessions, invented references, missing links and unsupported refutations', () => {
  const changes = [
    value => { value.sessionId = 'foreign'; }, value => { value.requestId = 'foreign'; },
    value => { value.finalVerdict.reviewedPublications[0].materialId = 'other'; },
    value => { value.finalVerdict.chain = []; }, value => { value.finalVerdict.reviewedPublications.push({ ...value.finalVerdict.reviewedPublications[0] }); },
    value => { value.finalVerdict.chain[0].sourceUrls = ['https://invented.example/source']; },
    value => { value.finalVerdict.chain[0].sourceUrls = ['javascript:alert(1)']; },
    value => { value.finalVerdict.chain[0].question = '偷换命题'; }, value => { value.finalVerdict.confidence = 'low'; },
    value => { value.finalVerdict.chain[0].strength = 'weak'; }, value => { value.finalVerdict.chain[0].relevance = 'indirect'; },
    value => { value.finalVerdict.chain[0].sourceUrls = []; },
  ];
  for (const change of changes) {
    const game = reviewGame(); startFinalReview(game, 'final-invalid'); const payload = reviewPayload(game); change(payload);
    const before = JSON.stringify(game);
    assert.equal(completeFinalReview(game, 'final-invalid', payload).ok, false); assert.equal(JSON.stringify(game), before);
    assert.equal(buildCaseReport(game).ending.id, 'unreviewed');
  }
});

test('only a settled victory can start review, and unpublished archived evidence cannot enter its chain', () => {
  const playing = plannedGame(), lost = reviewGame(); lost.phase = 'lost';
  for (const game of [playing, lost]) { const before = JSON.stringify(game); assert.equal(startFinalReview(game, 'wrong-phase').ok, false); assert.equal(JSON.stringify(game), before); }
  const game = plannedGame(); complete(game); secondReady(game); begin(game);
  const pending = resultFor(game);
  for (const region of game.regions) Object.assign(region, { blue: 99, exposed: 1, red: 0, seeded: true });
  tick(game, .1); assert.equal(startFinalReview(game, 'still-researching').ok, false);
  assert.equal(completeLiveResearch(game, 'request-fixture', pending).ok, true);
  assert.equal(game.researchResults.length, 2); assert.equal(game.publications.length, 1);
  assert.equal(startFinalReview(game, 'settled-review').ok, true); const payload = reviewPayload(game);
  assert.equal(payload.finalVerdict.chain.length, 1);
  assert.equal(completeFinalReview(game, 'settled-review', payload).ok, true);
  assert.equal(buildCaseReport(game).steps[1].publicationState, '已归档');
  assert.equal(buildCaseReport(game).finalVerdict.chain.length, 1);
});

test('offline file demos still build a report using their explicitly preset sources', () => {
  const game = createGame(); game.coins = 18;
  const status = getResearchStatus(game);
  assert.equal(startResearch(game, status.query).ok, true); tick(game, 30);
  assert.equal(publishEvidence(game).ok, true);
  const report = buildCaseReport(game);
  assert.equal(report.steps.length, 1); assert.equal(report.sources.length, 1);
  assert.match(report.steps[0].sourceUrl, /nasa.gov/);
});

test('mixed evidence builds remain viable with asynchronous investigations and only earned coins', () => {
  for (const delay of [15, 90]) for (const focuses of [['spread', 'spread'], ['spread', 'persuasion'], ['persuasion', 'spread'], ['persuasion', 'persuasion']]) {
    const game = createGame({ claim, investigationMode: 'agent', researchMode: 'live', seed: 7 });
    setInvestigationPlan(game, { claim, sessionId: 'session-fixture', leads: leads(1) });
    const preparation = ['spread', 'spread', 'persuasion'], post = ['persuasion', 'defense', 'persuasion', 'spread', 'defense'];
    let resolvesAt = Infinity;
    while (game.phase === 'playing' && game.time < 900) {
      for (const drop of [...game.coinDrops]) collectCoin(game, drop.id);
      if (game.research && game.time >= resolvesAt) assert.equal(completeLiveResearch(game, 'request-fixture', resultFor(game, 'mixed', focuses[(getResearchStatus(game).roundNumber - 1) % focuses.length])).ok, true);
      const status = getResearchStatus(game);
      if (status.pendingEvidence && (game.publications.length > 0 || getStats(game).reached >= 70)) {
        assert.equal(publishEvidence(game).ok, true);
      }
      if (getResearchStatus(game).available) { begin(game); resolvesAt = game.time + delay; }
      const wantsPublish = getStats(game).reached >= 70 && getPublishPreview(game).available;
      if (game.operationPhase === 'preparing') {
        if (wantsPublish) publishEvidence(game);
        else if (preparation.length && buyUpgrade(game, preparation[0]).ok) preparation.shift();
      } else {
        if (game.event && !game.event.resolved) counterWithSource(game);
        if (game.event?.counterStartedAt != null && post.length && buyUpgrade(game, post[0]).ok) post.shift();
      }
      tick(game, .5);
    }
    assert.equal(game.phase, 'won', `latency=${delay}, choices=${focuses}`);
    if (game.research) {
      const world = frozenWorld(game);
      assert.equal(completeLiveResearch(game, 'request-fixture', resultFor(game, 'mixed', focuses[(getResearchStatus(game).roundNumber - 1) % focuses.length])).ok, true);
      assert.deepEqual(frozenWorld(game), world);
    }
    assert.ok(game.evidence.length >= 3 && game.evidence.length <= 5);
    assert.equal(game.coinEconomy.spent, RULES.researchCosts.slice(0, game.evidence.length).reduce((sum, cost) => sum + cost, 0));
    assert.ok(game.time < 900, `gameplay took ${game.time}s with ${delay}s investigations`);
  }
});
