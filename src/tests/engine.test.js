import { queueEvidence } from './evidence-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, buyUpgrade, startResearch, publishEvidence, getPublishPreview, chooseSpecialization, getStats, getPacing, getResearchStatus, promoteEvidence, counterWithSource, getCounterStatus, getCampaignStatus, getEvidenceBonuses, getEvidenceEvent, REGIONS, RULES } from '../dist/engine.js';
import { play, SCENARIOS } from './balance.mjs';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';

function close(actual, expected, tolerance = 1e-6) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`); }
function ready(state, clueId) {
  tick(state, (clueId === 'lunar_optics' ? 170 : 40) - state.time);
  state.points = 100; state.coins = 100;
  if (clueId === 'fake_expert') { queueEvidence(state); publishEvidence(state); }
}
function conservation(state) {
  for (const region of state.regions) {
    close(region.red + region.exposed + region.blue, 100);
    assert.ok(region.red >= 0 && region.exposed >= 0 && region.blue >= 0);
  }
  close(getStats(state).truth + getStats(state).exposed + getStats(state).lie, 100);
}
function scenario(name) { return play(SCENARIOS.find(item => item.name === name).options); }

test('six starts, enemy reversals, and automatic propagation conserve population', () => {
  for (const region of REGIONS) {
    const state = createGame({ regionId: region.id });
    assert.equal(state.regions.find(item => item.id === region.id).blue, 8);
    queueEvidence(state); publishEvidence(state);
    for (let i = 0; i < 300; i++) { tick(state, 1); conservation(state); }
    assert.equal(state.event.stage, 'active');
  }
});

test('truth cannot spontaneously appear without a seed, even after publication', () => {
  const state = createGame();
  state.regions.forEach(region => { region.red = 100; region.exposed = 0; region.blue = 0; });
  state.levels = { spread: 3, persuasion: 3, defense: 3 };
  queueEvidence(state); publishEvidence(state);
  tick(state, 200);
  assert.equal(getStats(state).truth, 0);
  assert.equal(getStats(state).exposed, 0);
});

test('purchases cannot overspend, exceed level three, or buy the retired specialization', () => {
  const state = createGame();
  assert.equal(buyUpgrade(state, 'spread').ok, true);
  assert.equal(state.points, 14);
  assert.equal(buyUpgrade(state, 'spread').ok, false);
  state.points = 100;
  buyUpgrade(state, 'spread'); buyUpgrade(state, 'spread');
  const before = state.points;
  assert.equal(buyUpgrade(state, 'spread').ok, false);
  assert.equal(buyUpgrade(state, 'bogus').ok, false);
  assert.equal(chooseSpecialization(state, 'persuasion').ok, false);
  assert.equal(state.levels.spread, 3);
  assert.equal(state.points, before);
});

test('publication is free, irreversible per evidence, and matches its visible gain preview', () => {
  const state = createGame();
  tick(state, 90); queueEvidence(state);
  const preview = getPublishPreview(state), before = getStats(state), points = state.points;
  const result = publishEvidence(state);
  assert.equal(result.ok, true);
  assert.equal(state.operationPhase, 'public');
  close(getStats(state).truth - before.truth, preview.gain);
  close(getStats(state).reached, before.reached);
  close(state.points, points);
  assert.equal(state.publications.length, 1);
  assert.equal(publishEvidence(state).ok, false);
  assert.equal(getPublishPreview(state).available, false);
  conservation(state);
});

test('publication cannot create investigation-point rewards by instantly moving yellow to blue', () => {
  const state = createGame();
  state.regions.forEach(region => { region.blue = 5; region.exposed = 50; region.red = 45; });
  tick(state, .1); // Reach milestones have already been earned while preparing.
  queueEvidence(state);
  const before = state.points, earned = state.totals.earned, milestones = [...state.milestones];
  publishEvidence(state);
  close(state.points, before - RULES.publicationCost);
  close(state.totals.earned, earned);
  assert.deepEqual(state.milestones, milestones);
});

test('one search earns one evidence and locks one material while preserving candidate provenance', () => {
  const state = createGame(); ready(state, 'origin_photo');
  const status = getResearchStatus(state);
  assert.equal(status.cost, RULES.researchCosts[0]); assert.equal(status.duration, 12);
  assert.equal(startResearch(state, status.query).ok, true);
  assert.equal(startResearch(state, status.query).ok, false);
  assert.equal(state.points, 100); assert.equal(state.coins, 100 - RULES.researchCosts[0]);
  tick(state, 12);
  assert.deepEqual(state.evidence, ['round-1']);
  close(getStats(state).evidenceMultiplier, 1 + RULES.evidenceBonusPerRound);
  const pending = getResearchStatus(state).pendingChoice;
  assert.equal(pending.evidenceIds.length, 2); assert.equal(pending.promotedId, null);
  assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
  assert.equal(startResearch(state, status.query).ok, false);
  tick(state, 60);
  assert.equal(state.evidence.length, 1);
  assert.equal(getResearchStatus(state).pendingChoice.roundId, 'round-1');
  assert.equal(publishEvidence(state).ok, true);
  const snapshot = JSON.stringify(state);
  assert.equal(promoteEvidence(state, pending.evidenceIds[1]).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(state.researchResults[0].evidenceIds.length, 2);
});

test('unknown or retired clue queries cannot spend coins, invent evidence, or bypass the ordered investigation route', () => {
  const state = createGame(); ready(state, 'origin_photo');
  for (const query of ['', '外星飞船', 'origin_photo', 'night_lights', 'fake_expert', 'lunar_optics']) {
    const snapshot = JSON.stringify(state);
    const result = startResearch(state, query);
    assert.equal(result.ok, false); assert.match(result.reason, /预置模拟/);
    assert.equal(JSON.stringify(state), snapshot);
  }
});

test('each next round requires prior publication and three actually reached regions', () => {
  const state = createGame(); ready(state, 'origin_photo');
  startResearch(state, getResearchStatus(state).query); tick(state, 12);
  for (const region of state.regions) region.seeded = region.id === state.startRegionId;
  const pending = getResearchStatus(state);
  assert.equal(pending.phase, 'ready-to-publish');
  assert.equal(startResearch(state, pending.query).ok, false);
  assert.equal(publishEvidence(state).ok, true);
  const next = getResearchStatus(state);
  const selected = RESEARCH_ROUNDS[0].materials.find(material => material.id === state.researchResults[0].selectedId);
  assert.equal(next.requiredRegions, 3); assert.equal(next.query, selected.nextQuestion);
  assert.equal(next.gate, 'network');
  for (const region of state.regions.slice(0, 2)) region.seeded = true;
  assert.equal(startResearch(state, next.query).ok, true); tick(state, 16);
  assert.deepEqual(state.evidence, ['round-1', 'round-2']);
  close(getStats(state).evidenceMultiplier, 1 + 2 * RULES.evidenceBonusPerRound);
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, false);
  publishEvidence(state);
  assert.equal(getResearchStatus(state).phase, 'ready');
  assert.equal(getResearchStatus(state).roundNumber, 3);
  assert.deepEqual(state.levels, { spread: 0, persuasion: 0, defense: 0 });
});

test('a funded clarification takes time and reduces the main strike without erasing past losses', () => {
  const state = createGame(); ready(state, 'fake_expert');
  assert.equal(state.event.regionIds.length, 2);
  tick(state, 2);
  assert.equal(counterWithSource(state).ok, true);
  tick(state, RULES.counterDuration);
  assert.equal(state.event.resolved, true);
  assert.equal(state.event.stage, 'resolved');
  assert.ok(state.totals.relapsed > 0);
  assert.ok(state.log.some(entry => entry.type === 'backlash'));
  assert.equal(state.researchResults.length, 1);
  assert.deepEqual(state.evidence, ['round-1']);
  const pastLoss = state.totals.relapsed;
  tick(state, 100);
  close(state.totals.relapsed, pastLoss);
  close(getStats(state).enemyLossRate, 0);
});

test('an ignored enemy attacks two regions, returns blue to red, and does not expire by itself', () => {
  const state = createGame(); ready(state, 'fake_expert');
  state.regions.forEach(region => { region.red = 10; region.exposed = 20; region.blue = 70; });
  state.event.remaining = .1;
  const truth = getStats(state).truth, red = getStats(state).lie;
  tick(state, .1);
  assert.ok(getStats(state).truth < truth - 8, 'the first strike visibly takes more than eight support points');
  assert.ok(getStats(state).lie > red + 9);
  assert.equal(state.event.stage, 'active');
  assert.equal(state.event.remaining, null);
  tick(state, 150);
  assert.equal(state.event.stage, 'active');
  assert.equal(state.event.resolved, false);
  assert.ok(state.totals.reclaimed > 50);
  conservation(state);
});

test('a late investigation stops sustained losses while keeping already lost population lost', () => {
  const state = createGame(); ready(state, 'fake_expert');
  tick(state, 70);
  assert.equal(state.event.stage, 'active');
  const loss = state.totals.relapsed;
  counterWithSource(state); tick(state, RULES.counterDuration);
  assert.equal(state.event.stage, 'resolved');
  assert.ok(state.totals.relapsed > loss);
  const resolvedLoss = state.totals.relapsed;
  tick(state, 20);
  close(state.totals.relapsed, resolvedLoss);
});

test('defense mitigates both the immediate hit and continuous enemy pressure', () => {
  function attack(defense) {
    const state = createGame(); ready(state, 'fake_expert');
    state.regions.forEach(region => { region.red = 10; region.exposed = 20; region.blue = 70; });
    state.levels.defense = defense; state.event.remaining = .1;
    tick(state, 50); return state;
  }
  const weak = attack(0), strong = attack(3);
  assert.ok(strong.totals.relapsed < weak.totals.relapsed * .5);
  close(strong.event.pressure, weak.event.pressure * .35);
  assert.ok(strong.totals.relapsed > 0, 'maximum defense still requires an active response');
  assert.ok(getStats(strong).truth > getStats(weak).truth);
});

test('milestones cannot be farmed by losing and regaining reach', () => {
  const state = createGame();
  state.regions.forEach(region => { region.blue = 5; region.red = 45; region.exposed = 50; });
  tick(state, .1);
  const awarded = state.milestones.length;
  state.regions.forEach(region => { region.blue = 1; region.red = 98; region.exposed = 1; });
  tick(state, .1);
  const earned = state.totals.earned;
  state.regions.forEach(region => { region.blue = 5; region.red = 45; region.exposed = 50; });
  tick(state, .1);
  assert.equal(state.milestones.length, awarded);
  assert.ok(state.totals.earned - earned < .1);
});

test('pause-equivalent no ticks and different speed batches cannot advance extra game time', () => {
  const a = createGame(), b = createGame(); buyUpgrade(a, 'spread'); buyUpgrade(b, 'spread');
  for (let i = 0; i < 100; i++) tick(a, .1);
  tick(b, 10);
  close(a.time, b.time); close(a.points, b.points);
  a.regions.forEach((region, i) => close(region.blue, b.regions[i].blue));
});

test('reset starts a fresh preparation phase without publication, attacks, or old research', () => {
  const old = createGame(); ready(old, 'fake_expert'); counterWithSource(old); tick(old, 10);
  const state = createGame({ regionId: 'asia' });
  assert.equal(state.time, 0); assert.equal(state.points, 24);
  assert.equal(state.operationPhase, 'preparing');
  assert.deepEqual(state.publications, []); assert.deepEqual(state.evidence, []);
  assert.equal(state.research, null); assert.equal(state.event, null);
  assert.equal(state.startRegionId, 'asia');
});

test('invalid time leaves state intact and genuine network collapse freezes a terminal game', () => {
  const state = createGame(), snapshot = JSON.stringify(state);
  assert.equal(tick(state, NaN).ok, false); assert.equal(tick(state, -1).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
  tick(state, 10000);
  assert.equal(state.phase, 'lost'); assert.equal(state.defeatReason, 'network-collapse');
  assert.ok(state.time > 300 && state.time < 900);
  assert.ok(getStats(state).reached < RULES.collapseReach && getStats(state).truth < RULES.collapseTruth);
  assert.ok(!state.transit.active.some(trip => trip.carryingTruth));
  const end = JSON.stringify(state); tick(state, 100);
  assert.equal(JSON.stringify(state), end);
  assert.equal(buyUpgrade(state, 'spread').ok, false);
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, false);
  assert.equal(publishEvidence(state).ok, false);
});

function lateBoard({ time = 480, truth = 20, exposed = 10, defense = 0 } = {}) {
  const state = createGame(); state.time = time; state.levels.defense = defense;
  for (const region of state.regions) Object.assign(region, { red: 100 - truth - exposed, exposed, blue: truth });
  // Isolate the population model from discrete transport in these unit tests.
  state.transit.active = []; state.transit.nextDeparture = Infinity;
  return state;
}

test('world pacing caps its acceleration, follows live support, and has no global deadline', () => {
  const state = lateBoard({ time: 300 });
  assert.equal('maxTime' in RULES, false);
  assert.equal('remaining' in getStats(state), false);
  assert.deepEqual(getPacing(state), { stage: 'opening', heat: 0, populationMultiplier: 1, pressureFactor: 0, networkCritical: false });
  state.time = 390;
  assert.equal(getPacing(state).stage, 'heating'); close(getPacing(state).heat, .5);
  close(getPacing(state).populationMultiplier, 1.25);
  state.time = 480;
  const lowSupport = getPacing(state);
  assert.equal(lowSupport.stage, 'heated'); assert.equal(lowSupport.populationMultiplier, 1.5);
  state.time = 1200;
  assert.deepEqual(getPacing(state), lowSupport);
  for (const region of state.regions) Object.assign(region, { red: 10, exposed: 5, blue: 85 });
  assert.equal(getPacing(state).pressureFactor, 0);
  const snapshot = JSON.stringify(state); getPacing(state); getStats(state);
  assert.equal(JSON.stringify(state), snapshot);
  tick(state, 1);
  assert.equal(state.phase, 'playing'); assert.equal(state.time, 1201);
});

test('global backflow is real, reduced by defense, and separate from the resolved forgery attack', () => {
  const weak = lateBoard(), protectedState = lateBoard({ defense: 3 });
  for (const state of [weak, protectedState]) {
    state.event = { resolved: true, stage: 'resolved', regionIds: ['europe', 'asia'] };
    tick(state, .1); conservation(state);
    assert.equal(state.enemyLossRate, 0);
    assert.ok(state.worldLossRate > 0);
  }
  assert.ok(getStats(weak).truth < 20);
  close(protectedState.worldLossRate, weak.worldLossRate * .35);
  assert.ok(getStats(protectedState).truth > getStats(weak).truth);
});

test('network collapse needs both low-population thresholds for eight seconds and resets on recovery', () => {
  const state = lateBoard({ truth: .2, exposed: .3 });
  assert.equal(getPacing(state).networkCritical, true);
  tick(state, 7.9);
  assert.equal(state.phase, 'playing'); close(state.collapseFor, 7.9);
  for (const region of state.regions) Object.assign(region, { red: 80, exposed: 10, blue: 10 });
  tick(state, .1); assert.equal(state.collapseFor, 0);
  for (const region of state.regions) Object.assign(region, { red: 99.5, exposed: .3, blue: .2 });
  tick(state, 7.9); assert.equal(state.phase, 'playing');
  tick(state, .1);
  assert.equal(state.phase, 'lost'); assert.equal(state.defeatReason, 'network-collapse');
  const fresh = createGame(); assert.equal(fresh.collapseFor, 0); assert.equal(fresh.defeatReason, null);
});

test('pending investigation preserves the chance to respond before collapse can be evaluated', () => {
  const state = lateBoard({ truth: .2, exposed: .3 });
  state.points = 100; state.coins = RULES.researchCosts[0];
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
  tick(state, 11.9);
  assert.equal(state.phase, 'playing'); assert.equal(state.collapseFor, 0); assert.ok(state.research);
  tick(state, .1); assert.equal(state.research, null);
  tick(state, 7.8); assert.equal(state.phase, 'playing');
  tick(state, .2); assert.equal(state.phase, 'lost');
});

test('the simulation harness reports an unresolved policy without inventing a loss', () => {
  const state = play({ maxSimulationTime: 60 });
  assert.equal(state.phase, 'playing'); assert.equal(state.time, 60);
  assert.equal(state.diagnostics.simulationLimitReached, true);
  assert.equal(state.defeatReason, null);
});

test('properly timed publication supports a recovery victory from all six starts', () => {
  for (const region of REGIONS) {
    const state = play({ regionId: region.id });
    assert.equal(state.phase, 'won', region.id);
    assert.ok(state.time >= 240 && state.time <= 600, `${region.id}: ${state.time}`);
    assert.ok(getStats(state).truth >= RULES.winTruth);
    assert.ok(state.publications[0].gain > 20);
    assert.ok(state.evidence.length >= 1 && state.evidence.length <= RESEARCH_ROUNDS.length);
    assert.equal(state.victoryAt, state.time);
    assert.ok(getCampaignStatus(state).cleared <= state.publications.length);
  }
});

test('responding to every wave can recover, while defense alone cannot complete the campaign', () => {
  const recovered = scenario('公开后止损翻盘');
  assert.equal(recovered.phase, 'won'); assert.ok(recovered.diagnostics.maxDrop > 5);
  const reserved = scenario('预留澄清费再公开');
  assert.equal(reserved.phase, 'won');
  assert.ok(reserved.event.counteredAt > reserved.publications[0].time);
  assert.ok(reserved.event.counteredAt - reserved.event.counterStartedAt <= RULES.counterDuration);
  assert.ok(reserved.totals.relapsed < recovered.totals.relapsed);
  assert.ok(reserved.event.prevented > 0);
  const fortified = scenario('硬扛并进化反攻');
  assert.equal(fortified.phase, 'playing'); assert.equal(fortified.event.stage, 'active');
  assert.equal(getCampaignStatus(fortified).cleared, 0);
  assert.equal(getCampaignStatus(fortified).queued, 4);
  const invested = scenario('只管输出忽略反扑');
  assert.equal(invested.phase, 'playing'); assert.equal(getCampaignStatus(invested).cleared, 0);
  assert.ok(invested.levels.defense >= 2); assert.equal(invested.event.resolved, false);
  const ignored = scenario('公开后完全不应对');
  assert.equal(ignored.phase, 'lost'); assert.equal(ignored.defeatReason, 'network-collapse');
  assert.ok(ignored.diagnostics.redRiseSeconds > 30);
});

test('ordinary early launch, late launch, and never launching have distinct costly outcomes', () => {
  const early = scenario('过早公开');
  assert.ok(early.publications[0].time >= 90 && early.publications[0].time < 140);
  const prepared = scenario('公开后及时应对');
  assert.ok(early.publications[0].gain < prepared.publications[0].gain / 2);
  assert.ok(early.totals.relapsed > prepared.totals.relapsed, 'early publication exposes a less prepared network to greater total losses');
  const late = scenario('公开太晚');
  assert.equal(late.phase, 'lost'); assert.equal(late.publications.length, 0);
  assert.ok(late.diagnostics.maxDrop > 5, 'waiting too long gives back the initial network gains');
  const never = scenario('始终不公开');
  assert.equal(never.phase, 'lost'); assert.equal(never.defeatReason, 'network-collapse');
  assert.equal(scenario('完全不操作').phase, 'lost');
  assert.notEqual(scenario('不搜证只发起澄清').phase, 'won');
});

test('starting clarification cannot consume a search slot or charge repeatedly', () => {
  const state = createGame(); ready(state, 'fake_expert');
  state.regions.forEach(region => { region.seeded = true; });
  startResearch(state, getResearchStatus(state).query);
  const job = { ...state.research }, points = state.points;
  assert.equal(counterWithSource(state).ok, true); close(state.points, points - 12);
  assert.deepEqual(state.research, job); assert.equal(state.evidence.length, 1);
  const snapshot = JSON.stringify(state);
  assert.equal(counterWithSource(state).ok, false); assert.equal(JSON.stringify(state), snapshot);
});

test('a repeated fixed policy produces an identical trajectory and result', () => {
  assert.deepEqual(play({ regionId: 'south_america' }), play({ regionId: 'south_america' }));
});


test('query normalization accepts punctuation and spacing changes but not arbitrary keyword matches', () => {
  const state = createGame(); ready(state, 'origin_photo');
  const query = getResearchStatus(state).query;
  assert.equal(startResearch(state, `  ${query}？  `).ok, true);
  assert.equal(state.research.query, `${query}？`);
});

test('early truth has a material income benefit: ten extra percentage points yield six points over two minutes', () => {
  const a = createGame(), b = createGame();
  for (const region of a.regions) { region.red = 90; region.exposed = 0; region.blue = 10; }
  for (const region of b.regions) { region.red = 80; region.exposed = 0; region.blue = 20; }
  close((getStats(b).income - getStats(a).income) * 120, 6);
});


function combatState(defense = 0) {
  const state = createGame({ seed: 23 });
  state.regions.forEach(region => Object.assign(region, { red: 30, exposed: 30, blue: 40, seeded: true }));
  state.points = 100;
  queueEvidence(state); publishEvidence(state);
  state.levels.defense = defense;
  state.transit.active = []; state.transit.nextDeparture = Infinity;
  return state;
}

test('clarification spends once, moves gradually, and cannot instantly restore or recolor anyone', () => {
  const state = combatState(), original = structuredClone(state.regions), points = state.points;
  assert.equal(counterWithSource(state).ok, true);
  assert.deepEqual(state.regions, original);
  assert.equal(state.event.resolved, false);
  close(state.points, points - RULES.counterCost);
  close(getCounterStatus(state).progress, 0);
  close(getCounterStatus(state).remaining, 60);
  const frozen = JSON.stringify(state);
  for (let i = 0; i < 3; i++) { getCounterStatus(state); tick(state, 0); assert.equal(counterWithSource(state).ok, false); }
  assert.equal(JSON.stringify(state), frozen);
  tick(state, 30);
  close(getCounterStatus(state).progress, 50);
  assert.equal(state.event.resolved, false);
  assert.ok(state.totals.relapsed > 0);
  const loss = state.totals.relapsed;
  tick(state, 30);
  assert.equal(state.event.resolved, true);
  close(getCounterStatus(state).progress, 100);
  close(getCounterStatus(state).damagePerSecond, 0);
  assert.ok(state.totals.relapsed >= loss);
  const finished = JSON.stringify(state);
  assert.equal(counterWithSource(state).ok, false);
  assert.equal(JSON.stringify(state), finished);
  conservation(state);
});

test('defense both retains supporters and shortens the same-seed clarification, without restoring lost people', () => {
  const rows = [];
  for (const defense of [0, 1, 2, 3]) {
    const state = combatState(defense);
    const forecast = getCounterStatus(state);
    counterWithSource(state);
    const eta = getCounterStatus(state).remaining;
    while (!state.event.resolved) tick(state, .1);
    rows.push({ defense, duration: state.event.counteredAt, loss: state.totals.relapsed / 6, prevented: state.event.prevented });
    close(state.event.counteredAt, Math.ceil(eta * 10 - 1e-6) / 10);
    assert.ok(forecast.nextRate >= forecast.rate);
    assert.ok(state.event.prevented > 0);
    conservation(state);
  }
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].duration < rows[i - 1].duration);
    assert.ok(rows[i].loss < rows[i - 1].loss);
  }
  assert.ok(rows[1].loss < rows[0].loss * .5);
  assert.ok(rows[2].loss < rows[0].loss * .2);
});

test('buying defense during clarification immediately reduces pressure and remaining time', () => {
  const state = combatState(); counterWithSource(state); tick(state, 12);
  const before = getCounterStatus(state), population = structuredClone(state.regions);
  assert.equal(buyUpgrade(state, 'defense').ok, true);
  const after = getCounterStatus(state);
  close(after.progress, before.progress);
  close(after.rate, before.nextRate);
  close(after.defenseReduction, before.nextDefenseReduction);
  assert.ok(after.remaining < before.remaining && after.damagePerSecond < before.damagePerSecond);
  assert.deepEqual(state.regions, population);
});

test('publication advances active clarification once; merely collecting evidence does not', () => {
  const state = combatState(); state.coins = RULES.researchCosts[1];
  startResearch(state, getResearchStatus(state).query); counterWithSource(state);
  tick(state, 16);
  const progress = getCounterStatus(state).progress;
  close(progress, 100 * 16 / 60);
  assert.equal(state.researchResults[1].counterProgressGain, 0);
  assert.equal(state.log.filter(entry => entry.type === 'counter-progress').length, 0);
  assert.equal(publishEvidence(state).counterProgressGain, 15);
  close(getCounterStatus(state).progress, progress + 15);
  assert.equal(publishEvidence(state).ok, false);
  assert.equal(state.log.filter(entry => entry.type === 'counter-progress').length, 1);
  tick(state, 35); assert.equal(state.event.resolved, true); close(state.event.counteredAt, 51);
});
