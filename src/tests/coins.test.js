import { queueEvidence } from './evidence-fixture.mjs';
import test from 'node:test';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';
import assert from 'node:assert/strict';
import { RULES, createGame, tick, collectCoin, getCoinEconomy, getResearchStatus, startResearch, publishEvidence, counterWithSource, failLiveResearch } from '../dist/engine.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function collectAll(state) { for (const drop of [...state.coinDrops]) assert.equal(collectCoin(state, drop.id).ok, true); }
function moneyIsConserved(state) {
  const coins = getCoinEconomy(state), onMap = state.coinDrops.reduce((sum, drop) => sum + drop.value, 0);
  assert.equal(coins.generated, onMap + coins.collected);
  assert.equal(coins.collected, state.coins + coins.spent + coins.converted);
  close(state.points, state.totals.earned - state.totals.spent + state.totals.refunded);
}

test('the first real local propagation pays at six seconds without granting unclicked currency', () => {
  const state = createGame(); tick(state, 5.9);
  assert.equal(state.coinDrops.length, 0); assert.equal(state.coins, 0);
  tick(state, .1);
  assert.equal(state.coinDrops.length, 1);
  const drop = state.coinDrops[0];
  assert.equal(drop.regionId, state.startRegionId); assert.equal(drop.createdAt, 6);
  assert.ok([3, 4, 6].includes(drop.value));
  const before = state.points, reward = collectCoin(state, drop.id);
  assert.equal(reward.value, drop.value); assert.equal(reward.pointsEarned, 0);
  assert.equal(state.coins, drop.value); close(state.points, before);
  moneyIsConserved(state);
});

test('ordinary traffic and a world with no truth cannot mint coins', () => {
  const state = createGame();
  state.regions.forEach(region => Object.assign(region, { red: 100, exposed: 0, blue: 0, seeded: false }));
  tick(state, 120);
  assert.equal(state.coinDrops.length, 0); assert.equal(getCoinEconomy(state).generated, 0);
  assert.ok(state.transit.stats.arrived > 0);
});

test('unclaimed income stays within three piles and stops at the current investigation budget', () => {
  const state = createGame(); state.levels.spread = 3; state.levels.defense = 3;
  tick(state, 300);
  assert.ok(state.coinDrops.length > 0 && state.coinDrops.length <= RULES.coinMaxDrops);
  assert.equal(new Set(state.coinDrops.map(drop => drop.regionId)).size, state.coinDrops.length);
  assert.equal(state.coins, 0);
  assert.equal(getCoinEconomy(state).generated, RULES.researchCosts[0]);
  assert.equal(getCoinEconomy(state).fundingPaused, true);
  assert.equal(getCoinEconomy(state).fundingRemaining, 0);
  moneyIsConserved(state);
  const generated = getCoinEconomy(state).generated; collectAll(state);
  assert.equal(state.coins, generated); moneyIsConserved(state);
});

test('coin readings, duplicate clicks, unknown IDs and terminal clicks cannot mint or spend money', () => {
  const state = createGame(); tick(state, 6); const id = state.coinDrops[0].id;
  collectCoin(state, id);
  let before = JSON.stringify(state);
  getCoinEconomy(state); getResearchStatus(state);
  assert.equal(collectCoin(state, id).ok, false);
  assert.equal(collectCoin(state, `${id}`).ok, false);
  assert.equal(collectCoin(state, -1).ok, false);
  assert.equal(JSON.stringify(state), before);
  tick(state, 20); state.phase = 'won'; before = JSON.stringify(state);
  assert.equal(collectCoin(state, state.coinDrops[0].id).ok, false);
  tick(state, 30); assert.equal(JSON.stringify(state), before);
});

test('collection and coin randomness cannot alter media traffic or population trajectories', () => {
  const active = createGame({ seed: 23 }), idle = createGame({ seed: 23 });
  for (let i = 0; i < 240; i++) { tick(active, .5); tick(idle, .5); collectAll(active); }
  assert.deepEqual(active.transit, idle.transit); assert.deepEqual(active.regions, idle.regions);
  assert.equal(active.coinEconomy.generated, idle.coinEconomy.generated);
  assert.equal(active.coinEconomy.rng, idle.coinEconomy.rng);
  close(active.points, idle.points); moneyIsConserved(active); moneyIsConserved(idle);
});

test('search is paid only with clicked gold and invalid questions never consume either wallet', () => {
  const state = createGame();
  assert.equal(getResearchStatus(state).phase, 'ready'); assert.equal(getResearchStatus(state).available, false);
  while (state.coins < RULES.researchCosts[0]) { tick(state, .5); collectAll(state); }
  state.points = 0; state.totals.spent = state.totals.earned;
  const before = JSON.stringify(state);
  assert.equal(startResearch(state, '随便编一个搜索结果').ok, false);
  assert.equal(JSON.stringify(state), before);
  assert.equal(getResearchStatus(state).available, true);
  const gold = state.coins;
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
  assert.equal(state.coins, gold - RULES.researchCosts[0]); assert.equal(state.points, 0);
  moneyIsConserved(state);
});

test('all five budgets can save one investigation ahead; only final success opens action point conversion', () => {
  const state = createGame(); state.levels.spread = 1;
  while (state.coins < RULES.researchCosts[0]) { tick(state, .5); collectAll(state); }
  startResearch(state, getResearchStatus(state).query); tick(state, 12);
  assert.equal(publishEvidence(state).ok, true);
  while (!getResearchStatus(state).available) { tick(state, .5); collectAll(state); assert.ok(state.time < 400); }
  assert.equal(state.coins, RULES.researchCosts[1]);
  const before = state.points;
  const started = startResearch(state, getResearchStatus(state).query);
  assert.equal(started.ok, true); assert.equal(started.pointsEarned, 0); close(state.points, before);
  assert.equal(state.coins, 0); assert.equal(getCoinEconomy(state).cashoutActive, false);
  tick(state, 16);
  assert.equal(getCoinEconomy(state).cashoutActive, false);
  for (let round = 2; round < RESEARCH_ROUNDS.length; round++) {
    publishEvidence(state);
    if (state.event && !state.event.resolved) counterWithSource(state);
    while (!getResearchStatus(state).available) { tick(state, .5); collectAll(state); assert.ok(state.time < 800); }
    assert.equal(state.coins, RULES.researchCosts[round]);
    assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
    const generated = state.coinEconomy.generated;
    tick(state, state.research.duration - .5);
    if (round < RESEARCH_ROUNDS.length - 1) assert.ok(state.coinEconomy.generated > generated);
    assert.ok(state.coinEconomy.generated <= RULES.researchCosts.slice(0, round + 2).reduce((sum, cost) => sum + cost, 0));
    assert.equal(getCoinEconomy(state).cashoutActive, false);
    tick(state, .5);
    assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
    moneyIsConserved(state);
  }
  assert.equal(getCoinEconomy(state).cashoutActive, true); assert.equal(getCoinEconomy(state).nextCost, null);
  assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
  moneyIsConserved(state);
  tick(state, 30); const saved = state.coins, pointBalance = state.points, drop = state.coinDrops[0];
  assert.ok(drop.value >= 6 && drop.value % 6 === 0);
  const collected = collectCoin(state, drop.id);
  assert.equal(collected.pointsEarned, Math.floor((saved + drop.value) / RULES.coinExchangeRate));
  close(state.points, pointBalance + collected.pointsEarned);
  moneyIsConserved(state);
});

test('a slow live investigation saves one next-round budget, and repeated refunds cannot multiply it', () => {
  const state = createGame({ researchMode: 'live' });
  const currentCost = RULES.researchCosts[0], nextCost = RULES.researchCosts[1];
  while (state.coins < currentCost) { tick(state, .5); collectAll(state); }
  const beforePoints = state.points;
  assert.equal(startResearch(state, getResearchStatus(state).query, { requestId: 'slow-investigation' }).ok, true);
  assert.equal(getCoinEconomy(state).savingNextRound, true);
  tick(state, 180); collectAll(state);
  assert.equal(state.coinEconomy.generated, currentCost + nextCost);
  assert.equal(state.coins, nextCost);
  assert.equal(state.evidence.length, 0); assert.ok(state.points > beforePoints);
  assert.equal(getCoinEconomy(state).fundingPaused, true);
  for (const [attempt, requestId] of ['slow-investigation', 'retry-1', 'retry-2'].entries()) {
    assert.equal(failLiveResearch(state, requestId, '暂时没查到材料').refund, currentCost);
    assert.equal(state.coins, currentCost + nextCost);
    const before = JSON.stringify(state);
    assert.equal(failLiveResearch(state, requestId).refund, undefined);
    assert.equal(JSON.stringify(state), before, 'a repeated failure callback must not refund twice');
    tick(state, 20); collectAll(state);
    assert.equal(state.coinEconomy.generated, currentCost + nextCost);
    moneyIsConserved(state);
    const nextRequest = `retry-${attempt + 1}`;
    const scheduled = state.coinEconomy.nextAt;
    assert.equal(startResearch(state, getResearchStatus(state).query, { requestId: nextRequest }).ok, true);
    assert.equal(state.coinEconomy.nextAt, scheduled);
    tick(state, 30); collectAll(state);
    assert.equal(state.coins, nextCost);
    assert.equal(state.coinEconomy.generated, currentCost + nextCost);
    assert.equal(state.coinEconomy.researchPaid, 0);
    assert.equal(getCoinEconomy(state).cashoutActive, false);
    moneyIsConserved(state);
  }
});

test('advance funding counts unclaimed piles and cannot exceed one extra budget', () => {
  const state = createGame({ researchMode: 'live' });
  while (state.coins < RULES.researchCosts[0]) { tick(state, .5); collectAll(state); }
  startResearch(state, getResearchStatus(state).query, { requestId: 'unclaimed-advance' });
  tick(state, 180);
  assert.equal(state.coins, 0);
  assert.equal(state.coinDrops.reduce((sum, drop) => sum + drop.value, 0), RULES.researchCosts[1]);
  assert.equal(getCoinEconomy(state).fundingPaused, true);
  const generated = state.coinEconomy.generated;
  collectAll(state); tick(state, 90);
  assert.equal(state.coins, RULES.researchCosts[1]);
  assert.equal(state.coinEconomy.generated, generated, 'collecting saved money does not reopen the budget');
  assert.equal(state.coinDrops.length, 0);
  moneyIsConserved(state);
});

test('an unpublished result keeps saving the next budget without unlocking a third investigation', () => {
  const state = createGame();
  while (state.coins < RULES.researchCosts[0]) { tick(state, .5); collectAll(state); }
  startResearch(state, getResearchStatus(state).query); tick(state, 180); collectAll(state);
  assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
  assert.equal(state.coinEconomy.generated, RULES.researchCosts[0] + RULES.researchCosts[1]);
  assert.equal(state.coins, RULES.researchCosts[1]);
  assert.equal(getCoinEconomy(state).savingNextRound, true);
  const previous = JSON.stringify(state);
  assert.equal(startResearch(state, '继续查下一条').ok, false); assert.equal(JSON.stringify(state), previous);
  publishEvidence(state);
  assert.equal(getCoinEconomy(state).savingNextRound, false);
  assert.equal(getCoinEconomy(state).fundingCap, RULES.researchCosts[1]);
  assert.equal(getCoinEconomy(state).fundingRemaining, 0);
  assert.equal(getResearchStatus(state).available, true);
  const generated = state.coinEconomy.generated;
  tick(state, 20); collectAll(state);
  assert.equal(state.coinEconomy.generated, generated, 'publication alone must not unlock two future budgets');
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
  tick(state, 1);
  assert.equal(getCoinEconomy(state).fundingCap, RULES.researchCosts[2]);
  assert.equal(getCoinEconomy(state).savingNextRound, true);
  moneyIsConserved(state);
});

test('advance drops use slower intervals and publication restores normal funding without restarting the timer', () => {
  const state = createGame();
  while (state.coins < RULES.researchCosts[0]) { tick(state, .5); collectAll(state); }
  const previouslyScheduled = state.coinEconomy.nextAt;
  startResearch(state, getResearchStatus(state).query);
  assert.equal(state.coinEconomy.nextAt, previouslyScheduled);
  tick(state, previouslyScheduled - state.time + .1);
  assert.ok(state.coinDrops.length > 0);
  const advanceInterval = state.coinEconomy.nextAt - state.coinDrops[0].createdAt;
  assert.ok(advanceInterval >= RULES.coinIntervalMin * 2 && advanceInterval <= RULES.coinIntervalMax * 2,
    `advance interval ${advanceInterval} must be twice the current round interval`);
  collectAll(state);
  tick(state, state.research.duration - state.research.elapsed);
  assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
  const advancedScheduled = state.coinEconomy.nextAt;
  assert.equal(publishEvidence(state).ok, true);
  assert.equal(state.coinEconomy.nextAt, advancedScheduled);
  tick(state, advancedScheduled - state.time + .1);
  assert.ok(state.coinDrops.length > 0);
  const normalInterval = state.coinEconomy.nextAt - state.coinDrops[0].createdAt;
  assert.ok(normalInterval >= 5.75 && normalInterval <= 8.75, `round two must resume its normal interval, got ${normalInterval}`);
  moneyIsConserved(state);
});

test('1x, 2x and 4x keep the same one-round advance cap while live research is pending', () => {
  for (const speed of [1, 2, 4]) {
    const state = createGame({ researchMode: 'live', seed: 23 });
    while (state.coins < RULES.researchCosts[0]) { tick(state, .5 * speed); collectAll(state); }
    assert.equal(state.coins, RULES.researchCosts[0]);
    startResearch(state, getResearchStatus(state).query, { requestId: `speed-${speed}-request` });
    const started = state.time, income = state.totals.earned;
    for (let seconds = 0; seconds < 180; seconds++) { tick(state, speed); collectAll(state); }
    close(state.time - started, 180 * speed);
    assert.equal(state.coinEconomy.generated, RULES.researchCosts[0] + RULES.researchCosts[1]);
    assert.equal(state.coinEconomy.spent, RULES.researchCosts[0]);
    assert.equal(state.coins, RULES.researchCosts[1]); assert.equal(state.researchResults.length, 0);
    assert.equal(getResearchStatus(state).phase, 'searching'); assert.ok(state.totals.earned > income);
    assert.equal(startResearch(state, '不能抢跑下一轮', { requestId: 'another-request' }).ok, false);
    moneyIsConserved(state);
  }
});

test('the fifth pending investigation cannot mint a sixth budget or open action point conversion', () => {
  const state = createGame(); state.levels.spread = 1; state.levels.defense = 3;
  for (let index = 0; index < RESEARCH_ROUNDS.length - 1; index++) {
    while (!getResearchStatus(state).available) {
      tick(state, .5); collectAll(state); assert.ok(state.time < 800);
    }
    assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
    tick(state, 16); collectAll(state);
    assert.equal(publishEvidence(state).ok, true);
    if (state.event && !state.event.resolved && state.event.counterStartedAt == null) counterWithSource(state);
  }
  while (!getResearchStatus(state).available) { tick(state, .5); collectAll(state); assert.ok(state.time < 800); }
  assert.equal(getResearchStatus(state).roundNumber, 5);
  state.researchMode = 'live';
  assert.equal(startResearch(state, getResearchStatus(state).query, { requestId: 'last-pending' }).ok, true);
  const generated = state.coinEconomy.generated;
  assert.equal(generated, RULES.researchCosts.reduce((sum, cost) => sum + cost, 0));
  for (let seconds = 0; seconds < 180; seconds++) {
    // Keep this currency test below the separate support-based victory condition.
    state.regions.forEach(region => Object.assign(region, { red: 80, exposed: 0, blue: 20 }));
    tick(state, 1); collectAll(state);
  }
  assert.equal(getResearchStatus(state).phase, 'searching');
  assert.equal(getCoinEconomy(state).cashoutActive, false);
  assert.equal(getCoinEconomy(state).savingNextRound, false);
  assert.equal(state.coinEconomy.generated, generated);
  assert.equal(state.coinEconomy.converted, 0);
  assert.equal(state.coins, 0);
  assert.equal(failLiveResearch(state, 'last-pending').refund, RULES.researchCosts[4]);
  assert.equal(state.coins, RULES.researchCosts[4]);
  assert.equal(getCoinEconomy(state).cashoutActive, false);
  moneyIsConserved(state);
});

test('the last small payout fills the exact budget without pretending a clipped reward is a jackpot', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const state = createGame({ seed });
    state.coins = state.coinEconomy.generated = state.coinEconomy.collected = RULES.researchCosts[0] - 1;
    tick(state, RULES.coinFirstAt);
    assert.equal(state.coinDrops.length, 1); assert.equal(state.coinDrops[0].value, 1);
    assert.equal(state.coinDrops[0].jackpot, false);
    collectAll(state); assert.equal(state.coins, RULES.researchCosts[0]); moneyIsConserved(state);
  }
});

test('late coin income stops only after upgrades and all five counter waves are finished', () => {
  const state = createGame(); state.coinEconomy.researchPaid = RESEARCH_ROUNDS.length;
  state.levels = { spread: 3, persuasion: 3, defense: 3 }; state.points = 100;
  for (let i = 0; i < RESEARCH_ROUNDS.length; i++) {
    queueEvidence(state); assert.equal(publishEvidence(state).ok, true);
  }
  state.coinEconomy.nextAt = 0; tick(state, 1);
  assert.equal(getCoinEconomy(state).allActionsFinished, false);
  assert.ok(state.coinDrops.length > 0);
  counterWithSource(state); tick(state, 40);
  assert.equal(state.event.resolved, true);
  assert.equal(getCoinEconomy(state).allActionsFinished, false, 'a resolved first wave cannot stop funding queued fights');
  const before = state.coinEconomy.generated;
  tick(state, RULES.counterRecoveryDuration);
  assert.ok(state.coinEconomy.generated > before);
  while (!state.enemyWaves.every(wave => wave.resolved)) {
    // Isolate post-investigation funding from the support target terminal condition.
    state.regions.forEach(region => Object.assign(region, { red: 80, exposed: 0, blue: 20 }));
    if (!state.event.resolved && state.event.counterStartedAt == null) counterWithSource(state);
    tick(state, .5);
    assert.ok(state.time < 500, 'all queued waves must remain playable');
  }
  assert.equal(getCoinEconomy(state).allActionsFinished, true);
  const generated = state.coinEconomy.generated, onMap = structuredClone(state.coinDrops);
  tick(state, 60);
  assert.equal(state.coinEconomy.generated, generated); assert.deepEqual(state.coinDrops, onMap);
});

test('maxed action-point upgrades cannot stop funding an unfinished investigation', () => {
  const state = createGame(); state.levels = { spread: 3, persuasion: 3, defense: 3 };
  state.points = 40;
  tick(state, 90); collectAll(state);
  assert.equal(getCoinEconomy(state).allActionsFinished, false);
  assert.equal(state.coins, RULES.researchCosts[0]);
  startResearch(state, getResearchStatus(state).query); tick(state, 12);
  publishEvidence(state);
  const before = state.coinEconomy.generated;
  tick(state, 30);
  assert.ok(state.coinEconomy.generated > before);
  assert.equal(getCoinEconomy(state).allActionsFinished, false);
});

test('no tick is a true pause for coin generation and reset clears both currency and all drops', () => {
  const state = createGame(); tick(state, 40); collectAll(state);
  const frozen = JSON.stringify(state); getCoinEconomy(state); tick(state, 0);
  assert.equal(JSON.stringify(state), frozen);
  const fresh = createGame(); assert.equal(fresh.coins, 0); assert.deepEqual(fresh.coinDrops, []);
  assert.equal(getCoinEconomy(fresh).collected, 0); assert.equal(getCoinEconomy(fresh).cashoutActive, false);
});
