import test from 'node:test';
import assert from 'node:assert/strict';
import { getJourney } from '../dist/journey.js';
import { worldRemaining } from '../dist/world-time.js';
import { createGame, buyUpgrade, publishEvidence, getPublishPreview, getResearchStatus, startResearch, failLiveResearch, counterWithSource, tick, getStats, getTransports, getTransportStats, getCoinEconomy, collectCoin, getCounterStatus, getCampaignStatus, RULES } from '../dist/engine.js';

// Discovery tests pass their own round. Other fixtures have read all invitations.
const journey = (game, context = {}) => getJourney(game, { researchSeenRound: RULES.researchCosts.length, ...context });
function preparation() {
  const game = createGame();
  assert.equal(buyUpgrade(game, 'spread').ok, true);
  tick(game, 40); game.points = 100;
  // Ordinary guidance fixtures isolate other decisions from collectible hints.
  game.coinDrops = []; game.coinEconomy.nextAt = Infinity; game.coins = 0;
  return game;
}
function population(game, blue, exposed) {
  game.regions.forEach(region => Object.assign(region, { blue, exposed, red: 100 - blue - exposed }));
}
function underAttack(game = preparation()) {
  // Guidance snapshots inject an attack generated through the real publication
  // flow without inventing a free publication or consuming this fixture's search.
  const source = createGame(); source.coins = RULES.researchCosts[0];
  startResearch(source, getResearchStatus(source).query); tick(source, 13);
  population(source, 10, 50); assert.equal(publishEvidence(source).ok, true);
  population(game, 10, 50);
  game.operationPhase = 'public'; game.eventTriggered = true;
  game.event = structuredClone(source.event);
  game.enemyWaves = [game.event]; game.recoveryUntil = 0;
  return game;
}
function criticalNetwork(game = preparation()) {
  // UI snapshot: no simulation crosses this time change; actions still use the engine.
  game.time = 360; population(game, 0.3, 1.2); game.worldLossRate = 0.05;
  return game;
}
function startCurrentSearch(game) {
  const status = getResearchStatus(game);
  assert.equal(status.phase, 'ready');
  game.coins = Math.max(game.coins, status.cost);
  assert.equal(startResearch(game, status.query).ok, true);
  return game.research;
}
function finishCurrentSearch(game) {
  const job = game.research || startCurrentSearch(game);
  tick(game, job.duration - job.elapsed + 0.1);
  const status = getResearchStatus(game);
  assert.equal(status.phase, 'ready-to-publish');
  return status.pendingChoice;
}
function finishCounter(game, waitForRecovery = false) {
  if (!game.event.resolved) {
    if (!getCounterStatus(game).active) assert.equal(counterWithSource(game).ok, true);
    tick(game, getCounterStatus(game).remaining + 0.1);
    assert.equal(game.event.resolved, true, 'recovery fixtures must wait for actual clarification');
  }
  if (waitForRecovery) tick(game, Math.max(0, game.recoveryUntil - game.time) + .1);
}
function finishAllSearches() {
  const game = secondRound();
  while (getResearchStatus(game).phase !== 'complete') {
    const result = finishCurrentSearch(game);
    assert.equal(publishEvidence(game).ok, true);
  }
  assert.equal(game.evidence.length, RULES.researchCosts.length);
  return game;
}
function finishAllWaves(game) {
  while (getCampaignStatus(game).cleared < game.publications.length) {
    if (game.event.resolved) tick(game, RULES.counterRecoveryDuration);
    // Isolate UI guidance from combat affordability and a terminal win.
    game.points = 100; game.levels.defense = 3; population(game, 20, 0);
    finishCounter(game, true);
  }
  assert.equal(getCampaignStatus(game).complete, true);
  game.truthRate = 0;
}
function secondRound() {
  const game = preparation(); finishCurrentSearch(game);
  const status = getResearchStatus(game);
  game.regions.slice(0, 3).forEach(region => { region.seeded = true; });
  game.coins = RULES.researchCosts[1]; game.points = 100;
  assert.equal(publishEvidence(game).ok, true);
  finishCounter(game, true);
  assert.equal(getResearchStatus(game).phase, 'ready');
  return game;
}
function firstTruthInTransit() {
  const game = createGame({ seed: 1 }); buyUpgrade(game, 'spread'); game.coinEconomy.nextAt = Infinity;
  while (game.time < 180) {
    const trip = getTransports(game).find(item => item.carryingTruth);
    if (trip && getTransportStats(game).firstReached === 1) return { game, trip };
    tick(game, 0.1);
  }
  assert.fail('the opening should produce a truth-carrying transport before 180 seconds');
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('guidance is pure, including an unclaimed evidence choice', () => {
  for (const pending of [false, true]) {
    const game = preparation(); if (pending) finishCurrentSearch(game);
    const context = { researchSeenRound: 1, nowMs: 1000 };
    context.previous = getJourney(game, context);
    const before = JSON.stringify({ game, context }); freeze(game); freeze(context);
    assert.notEqual(getJourney(game, context), context.previous);
    assert.equal(JSON.stringify({ game, context }), before);
  }
});

test('first investment remains advice while traffic runs; pause and panels take priority', () => {
  assert.equal(journey(null).primaryAction.type, 'start');
  const game = createGame(), result = journey(game, { firstMovePending: true });
  assert.equal(result.stage, 'first-move');
  assert.equal(result.primaryAction.type, 'upgrade');
  assert.equal(result.primaryAction.key, 'spread');
  assert.equal(result.primaryAction.cost, 10);
  assert.equal(result.primaryAction.disabled, false);
  assert.equal(journey(game, { firstMovePending: true, paused: true }).stage, 'paused');
  assert.equal(journey(game, { firstMovePending: true, paused: true, modalOpen: true }).stage, 'modal');
  assert.equal(journey(game).stage, 'first-upgrade');
  buyUpgrade(game, 'defense'); assert.notEqual(journey(game).stage, 'first-upgrade');
});

test('search invitation uses collected gold, even when action points are empty', () => {
  const game = createGame(); buyUpgrade(game, 'spread');
  assert.equal(getResearchStatus(game).phase, 'ready');
  assert.notEqual(journey(game, { researchSeenRound: 0 }).stage, 'new-clue');
  game.points = 0; game.coins = getResearchStatus(game).cost;
  const result = journey(game, { researchSeenRound: 0 });
  assert.equal(result.stage, 'new-clue');
  assert.equal(result.primaryAction.type, 'open-search');
  assert.equal(result.primaryAction.disabled, false);
  assert.equal(result.primaryAction.currency, 'coins');
  assert.equal(getResearchStatus(game).available, true);
  assert.equal(game.research, null);
  const seen = journey(game, { researchSeenRound: 1, previous: result });
  assert.equal(seen.stage, 'research-ready'); assert.equal(seen.attention.target, 'search');
});

test('a completed choice survives pause and attack, then outranks ordinary spending advice', () => {
  const game = preparation(), result = finishCurrentSearch(game);
  assert.equal(game.evidence.length, 1); assert.equal(result.evidenceIds.length, 2);
  underAttack(game); game.points = 0;
  const context = { researchSeenRound: 1, firstMovePending: true, intent: { type: 'upgrade', key: 'spread' }, nowMs: 1100 };
  const panel = journey(game, { ...context, modalOpen: true, paused: true });
  assert.equal(panel.stage, 'modal'); assert.equal(panel.primaryAction, null);
  const attack = journey(game, { ...context, previous: panel });
  assert.equal(attack.stage, 'evidence-ready'); assert.equal(attack.primaryAction.type, 'open-search');
  assert.equal(getResearchStatus(game).phase, 'ready-to-publish');
  assert.equal(journey(game, { ...context, paused: true }).stage, 'paused');
  game.points = 12; assert.equal(counterWithSource(game).ok, true);
  const choice = journey(game, { ...context, previous: attack });
  assert.equal(choice.stage, 'evidence-ready'); assert.equal(choice.primaryAction.type, 'open-search');
  assert.equal(choice.primaryAction.disabled, false); assert.equal(choice.attention.target, 'search');
  assert.equal(journey(game, { ...context, nowMs: 50000, previous: choice }).stage, 'evidence-ready');
  criticalNetwork(game); assert.equal(journey(game).stage, 'evidence-ready');
  assert.deepEqual(getResearchStatus(game).pendingChoice, result, 'a free earned reward stays claimable during danger');
});

test('promotion removes its reminder immediately without counting the other material as round two', () => {
  const game = preparation(), result = finishCurrentSearch(game), previous = journey(game);
  assert.equal(publishEvidence(game).ok, true);
  assert.equal(game.evidence.length, 1);
  assert.notEqual(journey(game, { previous }).stage, 'evidence-ready');
  assert.notEqual(journey(game, { researchSeenRound: 0 }).stage, 'new-clue');
});

test('a follow-up becomes useful counterplay during clarification without losing its lead', () => {
  const game = secondRound(); underAttack(game);
  const attack = journey(game, { nowMs: 1000 }); assert.match(attack.stage, /^enemy-/);
  const waiting = journey(game, { researchSeenRound: 1, previous: attack, nowMs: 1100 });
  assert.match(waiting.stage, /^enemy-/); assert.equal(waiting.primaryAction.type, 'counter');
  assert.equal(getResearchStatus(game).phase, 'ready');
  assert.equal(counterWithSource(game).ok, true);
  const during = journey(game, { researchSeenRound: 1, previous: waiting, nowMs: 1200 });
  assert.equal(during.stage, 'enemy-research'); assert.equal(during.primaryAction.type, 'open-search');
  assert.equal(during.primaryAction.currency, 'coins'); assert.match(during.body, /15%/);
  assert.equal(game.event.resolved, false);
  finishCounter(game);
  assert.equal(journey(game).stage, 'recovery');
  tick(game, RULES.counterRecoveryDuration);
  const invitation = journey(game, { researchSeenRound: 1, previous: during, nowMs: 1300 });
  assert.equal(invitation.stage, 'new-clue');
  assert.equal(invitation.primaryAction.type, 'open-search');
  assert.ok(invitation.body.includes(getResearchStatus(game).query));
  assert.notEqual(journey(game, { researchSeenRound: 2, previous: invitation, nowMs: 1300 }).stage, 'new-clue');
  assert.equal(getResearchStatus(game).phase, 'ready', 'inspection never spends a round');
});

test('new round invitations break ordinary holds but never pause, panels, or emergency controls', () => {
  const game = preparation(), previous = journey(game, { nowMs: 1000 });
  assert.equal(previous.stage, 'prepare-network');
  game.coins = getResearchStatus(game).cost;
  const context = { previous, researchSeenRound: 0, nowMs: 1100 };
  assert.equal(journey(game, context).stage, 'new-clue');
  assert.equal(journey(game, { ...context, paused: true }).stage, 'paused');
  assert.equal(journey(game, { ...context, modalOpen: true }).stage, 'modal');
  criticalNetwork(game); assert.equal(journey(game, context).stage, 'network-critical');
});

test('five completed rounds never create a sixth invitation, even during another attack', () => {
  const game = finishAllSearches();
  assert.equal(getResearchStatus(game).phase, 'complete'); assert.equal(game.evidence.length, 5);
  for (const researchSeenRound of [0, 1, 2, 3, 4, 5]) {
    const result = journey(game, { researchSeenRound, intent: { type: 'research', cost: 1 } });
    assert.notEqual(result.stage, 'new-clue'); assert.notEqual(result.stage, 'funding');
    assert.notEqual(result.stage, 'intent-ready'); assert.notEqual(result.primaryAction?.type, 'open-search');
  }
  underAttack(game);
  const counter = journey(game, { researchSeenRound: 0 });
  assert.equal(counter.primaryAction.type, 'counter');
  assert.equal(counterWithSource(game).ok, true); assert.equal(game.evidence.length, 5);
  assert.equal(getResearchStatus(game).phase, 'complete');
});

test('rounds three through five keep their own actionable invitation and current gold cost', () => {
  const game = secondRound();
  game.levels.defense = 3;
  for (let roundNumber = 2; roundNumber <= 5; roundNumber++) {
    const status = getResearchStatus(game);
    assert.equal(status.roundNumber, roundNumber);
    game.coins = status.cost; game.truthRate = 0; population(game, 20, 0);
    const invite = journey(game, { researchSeenRound: roundNumber - 1 });
    assert.equal(invite.stage, 'new-clue');
    assert.equal(invite.primaryAction.type, 'open-search');
    assert.equal(invite.primaryAction.cost, RULES.researchCosts[roundNumber - 1]);
    assert.equal(invite.primaryAction.currency, 'coins');
    assert.equal(invite.primaryAction.disabled, false);
    const result = finishCurrentSearch(game);
    assert.equal(journey(game).stage, 'evidence-ready');
    publishEvidence(game);
    finishCounter(game, true);
  }
  assert.equal(getResearchStatus(game).phase, 'complete');
});

test('new evidence advances an active clarification and its earned choice takes priority', () => {
  const game = secondRound(); underAttack(game);
  assert.equal(counterWithSource(game).ok, true);
  const invitation = journey(game);
  assert.equal(invitation.stage, 'enemy-research');
  const job = startCurrentSearch(game), before = getCounterStatus(game).progress;
  const searching = journey(game);
  assert.equal(searching.stage, 'enemy-counter-running');
  assert.notEqual(searching.primaryAction?.type, 'counter', 'running clarification must not ask for another payment');
  assert.match(searching.body, /澄清|进度|缩短/);
  const result = finishCurrentSearch(game), progress = getCounterStatus(game).progress;
  assert.ok(progress >= before, 'clarification continues during the investigation');
  assert.equal(result.counterProgressGain, 0, 'finding evidence alone does not accelerate clarification');
  assert.equal(game.event.resolved, false);
  const reward = journey(game, { previous: searching, intent: { type: 'counter' } });
  assert.equal(reward.stage, 'evidence-ready');
  assert.equal(reward.primaryAction.type, 'open-search');
  assert.equal(reward.primaryAction.disabled, false);
  assert.equal(getResearchStatus(game).pendingChoice.roundId, job.roundId);
  const progressBeforePublication = getCounterStatus(game).progress;
  publishEvidence(game);
  assert.ok(getCounterStatus(game).progress >= Math.min(100, progressBeforePublication + RULES.counterEvidenceProgress));
  assert.notEqual(journey(game, { previous: reward }).stage, 'evidence-ready');
  assert.notEqual(journey(game).primaryAction?.type, 'counter');
});

test('acknowledged enemy pressure interrupts normal advice, upgrade feedback, and spending intent', () => {
  const game = preparation(), previous = journey(game, { nowMs: 1000 }); underAttack(game);
  const result = journey(game, { previous, nowMs: 1100, lastAction: { type: 'upgrade', key: 'spread', at: 1000 }, intent: { type: 'upgrade', key: 'persuasion' } });
  assert.equal(result.stage, 'enemy-warning'); assert.equal(result.primaryAction.type, 'counter');
  assert.equal(result.primaryAction.cost, 12); assert.equal(result.attention.target, 'enemy');
  tick(game, 42); assert.equal(journey(game, { previous: result }).stage, 'enemy-active');
});

test('source counter shortage gives a finite live cost and becomes actionable as funds arrive', () => {
  const game = underAttack(); game.points = 5.5;
  const result = journey(game, { nowMs: 1000 });
  assert.equal(result.stage, 'enemy-funding'); assert.equal(result.primaryAction.disabled, true);
  assert.equal(result.primaryAction.cost, 12); assert.match(result.body, /发起澄清还差 7 点/);
  assert.ok(result.body.includes(worldRemaining(6.5 / getStats(game).income)));
  game.points = 12;
  const ready = journey(game, { previous: result, nowMs: 1100 });
  assert.equal(ready.stage, 'enemy-warning'); assert.equal(ready.primaryAction.disabled, false);
});

test('clarification guidance treats sixty game seconds as one world day', () => {
  const game = underAttack();
  assert.equal(RULES.counterDuration, 60);
  assert.match(journey(game).body, /澄清需要约1天/);
  assert.match(game.event.description, /约17小时后发动主攻/);
  assert.doesNotMatch(journey(game).body, /秒|分钟/);
});

test('clarification starts during search without ending the attack, duplicating payment, or consuming a round', () => {
  const game = preparation(), job = startCurrentSearch(game); underAttack(game);
  const result = journey(game); assert.equal(result.primaryAction.type, 'counter');
  assert.equal(result.primaryAction.cost, 12);
  assert.equal(counterWithSource(game).ok, true); assert.equal(game.research, job);
  assert.equal(game.evidence.length, 0); assert.equal(game.event.resolved, false);
  const points = game.points;
  assert.equal(counterWithSource(game).ok, false); assert.equal(game.points, points);
  const active = journey(game, { intent: { type: 'counter' } });
  assert.equal(active.stage, 'enemy-counter-running'); assert.notEqual(active.primaryAction?.type, 'counter');
  tick(game, 5);
  assert.ok(getCounterStatus(game).progress > 0 && getCounterStatus(game).progress < 100);
  assert.equal(game.research, job); assert.equal(game.event.resolved, false);
});

test('defending preserves an actionable source counter before and after its feedback expires', () => {
  const game = underAttack(); buyUpgrade(game, 'defense');
  const recent = journey(game, { lastAction: { type: 'upgrade', key: 'defense', at: 1000 }, nowMs: 1100 });
  assert.equal(recent.stage, 'enemy-defense-feedback');
  assert.equal(recent.primaryAction.type, 'counter'); assert.equal(recent.primaryAction.disabled, false);
  assert.equal(recent.primaryAction.cost, 12); assert.equal(game.event.resolved, false);
  const result = journey(game, { nowMs: 7000 });
  assert.equal(result.stage, 'enemy-defended'); assert.equal(result.primaryAction.type, 'counter');
  tick(game, 43); assert.ok(game.totals.relapsed > 0); assert.equal(journey(game).stage, 'enemy-defended');
  assert.equal(counterWithSource(game).ok, true); assert.notEqual(journey(game).primaryAction?.type, 'counter');
});

test('defended attacks still report source-counter shortages and unlock when funds arrive', () => {
  const game = underAttack(); buyUpgrade(game, 'defense'); game.points = 0;
  const waiting = journey(game, { researchSeenRound: 0, nowMs: 7000 });
  assert.equal(waiting.stage, 'enemy-defended'); assert.equal(waiting.primaryAction.type, 'counter');
  assert.equal(waiting.primaryAction.cost, 12); assert.equal(waiting.primaryAction.disabled, true);
  assert.equal(waiting.attention.target, 'points');
  game.points = 12;
  const ready = journey(game, { researchSeenRound: 0, previous: waiting, nowMs: 7100 });
  assert.equal(ready.stage, 'enemy-defended'); assert.equal(ready.primaryAction.disabled, false);
  assert.equal(ready.attention.target, 'enemy');
});

test('search progress stays current, has no duplicate action, and outranks stale purchase intent', () => {
  const game = preparation(); startCurrentSearch(game); game.points = 0;
  const context = { intent: { type: 'upgrade', key: 'spread' }, nowMs: 1000 }, first = journey(game, context);
  assert.equal(first.stage, 'researching'); assert.equal(first.primaryAction, null);
  assert.equal(first.attention.target, 'research-progress'); tick(game, 5);
  const next = journey(game, { ...context, previous: first, nowMs: 6000 });
  assert.equal(next.id, first.id); assert.equal(next.shownAt, first.shownAt); assert.notEqual(next.body, first.body);
  const second = secondRound(); startCurrentSearch(second);
  assert.equal(journey(second).stage, 'researching');
  assert.notEqual(journey(second).id, first.id);
});

test('purchase intent takes live costs and updates affordability immediately', () => {
  const game = preparation(); game.points = 20;
  const context = { nowMs: 1000, intent: { type: 'upgrade', key: 'spread', cost: 1 } }, wait = journey(game, context);
  assert.equal(wait.stage, 'funding'); assert.equal(wait.primaryAction.cost, 24);
  assert.equal(wait.primaryAction.disabled, true); assert.ok(wait.body.includes('24'));
  assert.ok(wait.title.includes(String(Math.ceil(wait.primaryAction.cost - game.points))));
  game.points = 24;
  const ready = journey(game, { ...context, previous: wait, nowMs: 1100 });
  assert.equal(ready.stage, 'intent-ready'); assert.equal(ready.primaryAction.disabled, false);
});

test('research intent uses the actual round cost and cannot revive a stale round', () => {
  const game = preparation(), status = getResearchStatus(game); game.points = 100; game.coins = 0;
  const result = journey(game, { intent: { type: 'research', roundId: status.roundId, cost: 1 } });
  assert.equal(result.stage, 'coin-funding'); assert.equal(result.primaryAction, null);
  assert.match(result.title, new RegExp('还差 ' + status.cost + ' 金币')); assert.doesNotMatch(result.body, /秒攒够|行动点不足/);
  assert.notEqual(journey(game, { intent: { type: 'research', roundId: 'expired-round' } }).stage, 'funding');
});

test('ordinary upgrades leave a brief observation period once round discovery is read', () => {
  const game = preparation(), lastAction = { type: 'upgrade', key: 'spread', at: 1000 };
  const first = journey(game, { lastAction, nowMs: 1000 }); assert.equal(first.stage, 'action-feedback');
  assert.equal(journey(game, { lastAction, previous: first, nowMs: 5999 }).stage, 'action-feedback');
  assert.equal(first.primaryAction, null); assert.equal(first.attention.target, 'map');
  assert.notEqual(journey(game, { lastAction, nowMs: 6000 }).stage, 'action-feedback');
});

test('ordinary traffic is not called truth; first arrival requires a real successful landing', () => {
  const plain = createGame({ seed: 1 }); buyUpgrade(plain, 'spread');
  assert.ok(getTransports(plain).every(trip => !trip.carryingTruth)); assert.doesNotMatch(journey(plain).stage, /^transport-/);
  const { game, trip } = firstTruthInTransit(), travelling = journey(game);
  assert.equal(travelling.stage, 'transport-travelling');
  assert.ok(travelling.body.includes(worldRemaining(trip.arrivesAt - game.time)));
  assert.equal(game.regions.find(region => region.id === trip.to).seeded, false);
  while (game.time < 180 && getTransportStats(game).firstReached === 1) tick(game, 0.1);
  const arrival = game.transportEvents.find(event => event.type === 'first-seed' && event.firstSeed);
  assert.ok(arrival); assert.equal(journey(game, { previous: travelling }).stage, 'transport-arrival');
  assert.equal(game.regions.find(region => region.id === arrival.to).seeded, true);
  tick(game, 10.1); assert.notEqual(journey(game).stage, 'transport-arrival');
});

test('unaffordable upgrades point to earning search gold without mixing the two wallets', () => {
  const game = preparation(); game.points = 0; const result = journey(game);
  assert.equal(result.stage, 'funding-auto'); assert.equal(result.primaryAction, null);
  assert.equal(result.attention.target, 'map'); assert.doesNotMatch(result.body, /NaN|Infinity/);
  assert.match(result.body, /金币|搜证/);
  game.points = 100; assert.notEqual(journey(game, { previous: result }).stage, 'funding-auto');
});

test('publishing requires evidence but never a fee or audience threshold', () => {
  const game = preparation();
  assert.equal(getPublishPreview(game).available, false);
  assert.equal(journey(game).stage, 'prepare-network');
  assert.equal(publishEvidence(game).ok, false);
  finishCurrentSearch(game); game.points = 0; population(game, 0, 0);
  assert.equal(getPublishPreview(game).available, true);
  assert.equal(journey(game).primaryAction.label, '查看证据');
  assert.equal(publishEvidence(game).ok, true);
});

test('stored evidence immediately switches the guidance to free publication without another choice', () => {
  const game = preparation(); finishCurrentSearch(game); game.points = 0;
  const unread = journey(game, { nowMs: 1000 });
  assert.equal(unread.title, '新证据已到'); assert.equal(unread.primaryAction.type, 'open-search');
  game.researchResults[0].storedAt = game.time;
  const stored = journey(game, { previous: unread, nowMs: 1100 });
  assert.equal(stored.title, '证据已收入囊中');
  assert.equal(stored.primaryAction.type, 'publish'); assert.equal(stored.primaryAction.cost, 0);
  assert.equal(stored.primaryAction.disabled, false); assert.equal(stored.attention.target, 'publish');
  assert.doesNotMatch(stored.body + stored.primaryAction.label, /主推|两份|20 点/);
});

test('completed clarification yields recovery and high support can finish without five waves', () => {
  const game = underAttack(); tick(game, 5); finishCounter(game);
  const recovery = journey(game); assert.equal(recovery.stage, 'recovery');
  assert.equal(recovery.attention.tone, 'success'); tick(game, RULES.counterRecoveryDuration);
  assert.equal(journey(game).stage, 'public-growth'); population(game, 90, 8);
  const earlyFinish = journey(game); assert.equal(earlyFinish.stage, 'finish');
  assert.match(earlyFinish.body, new RegExp(`${RULES.winTruth}% 即获胜`));
  assert.doesNotMatch(earlyFinish.title + earlyFinish.body, /五波|五份/);
  const finalGame = finishAllSearches(); finishAllWaves(finalGame); population(finalGame, 90, 8);
  const finish = journey(finalGame); assert.equal(finish.stage, 'finish'); assert.ok(finish.body.includes((RULES.winTruth - 90).toFixed(1))); assert.equal(finish.primaryAction?.key, 'persuasion');
});

test('a critical heated network interrupts ordinary holds, but never pause or panels', () => {
  const game = preparation(), previous = journey(game, { nowMs: 1000 }); criticalNetwork(game);
  const context = { previous, firstMovePending: true, nowMs: 1100 }, warning = journey(game, context);
  assert.equal(warning.stage, 'network-critical');
  assert.deepEqual(warning.attention, { target: 'upgrade-defense', tone: 'warning' });
  assert.equal(buyUpgrade(game, warning.primaryAction.key).ok, true);
  assert.ok(warning.body.includes(getStats(game).reached.toFixed(1)));
  assert.equal(journey(game, { ...context, paused: true }).stage, 'paused');
  assert.equal(journey(game, { ...context, modalOpen: true }).stage, 'modal');
});

test('a small opening audience is not called collapsing before global pressure begins', () => {
  const game = createGame(); population(game, 0.3, 1.2);
  assert.equal(journey(game, { firstMovePending: true }).stage, 'first-move');
  assert.notEqual(journey(game).stage, 'network-critical'); game.time = 360;
  assert.equal(journey(game, { firstMovePending: true }).stage, 'network-critical');
});

test('a critical network can start clarification while regular search continues', () => {
  const game = preparation(), job = startCurrentSearch(game); criticalNetwork(underAttack(game)); game.levels.defense = 3;
  const warning = journey(game); assert.equal(warning.primaryAction.type, 'counter');
  assert.equal(warning.stage, 'network-critical'); assert.equal(game.research, job);
  assert.equal(getResearchStatus(game).phase, 'searching');
  assert.equal(counterWithSource(game).ok, true); assert.equal(game.research, job);
  assert.notEqual(journey(game).primaryAction?.type, 'counter');
});

test('critical guidance offers the earned evidence first and otherwise rebuilds reach', () => {
  const game = preparation(); finishCurrentSearch(game); criticalNetwork(game); game.points = 0;
  game.researchResults[0].storedAt = game.time;
  const publish = journey(game); assert.equal(publish.primaryAction.type, 'publish');
  assert.equal(publish.primaryAction.disabled, false); assert.equal(publishEvidence(game).ok, true);
  for (const exposed of [0, 0.01]) {
    const thin = criticalNetwork(); population(thin, 0.3, exposed); thin.levels.defense = 3;
    assert.equal(journey(thin).primaryAction.key, 'spread');
  }
});

test('critical guidance preserves ongoing search and keeps funding waits finite', () => {
  const game = preparation(); startCurrentSearch(game); criticalNetwork(game); game.points = 0;
  const warning = journey(game); assert.equal(getResearchStatus(game).phase, 'searching');
  assert.match(warning.body, /还差 10 点/);
  assert.ok(warning.body.includes(worldRemaining(10 / getStats(game).income)));
  assert.equal(warning.primaryAction.type, 'upgrade'); assert.equal(warning.primaryAction.disabled, true);
  assert.equal(warning.attention.target, 'points'); game.points = warning.primaryAction.cost;
  assert.equal(journey(game, { previous: warning }).primaryAction.disabled, false);
});

test('late recovery follows the real combat window instead of a recently dated log entry', () => {
  const game = underAttack(); game.time = 360; population(game, 30, 50); finishCounter(game);
  const recovery = journey(game); assert.equal(recovery.stage, 'recovery');
  assert.equal(game.event.resolved, true); assert.match(recovery.body, /说服 ×2.2、传播 ×1.35/);
  tick(game, RULES.counterRecoveryDuration);
  game.log.find(entry => entry.type === 'forgery').time = game.time;
  assert.notEqual(journey(game).stage, 'recovery', 'rewriting a history timestamp cannot grant another window');
});

test('elapsed time alone never ends guidance; terminal results outrank choices and pause', () => {
  const game = preparation(); game.time = 650; population(game, 20, 50);
  assert.equal(journey(game).stage, 'prepare-network'); finishCurrentSearch(game);
  for (const phase of ['won', 'lost']) {
    game.phase = phase; game.defeatReason = 'network-collapse';
    const result = journey(game, { paused: true, modalOpen: true, firstMovePending: true });
    assert.equal(result.stage, 'result'); assert.equal(result.primaryAction.type, 'restart');
    assert.doesNotMatch(result.body, /时间不够|时间耗尽|十分钟|倒计时/);
  }
});

test('won guidance keeps a paid investigation visible without demanding publication or restart', () => {
  const game = preparation(); startCurrentSearch(game);
  game.phase = 'won'; game.victoryAt = game.time;
  const waiting = journey(game, { paused: true, modalOpen: true, firstMovePending: true });
  assert.equal(waiting.stage, 'result-settling'); assert.equal(waiting.primaryAction, null);
  assert.equal(waiting.attention.target, 'research-progress');
  assert.match(waiting.title, /胜利已锁定/); assert.match(waiting.body, /通关时间已记下/);
  assert.match(waiting.body, /已付费的调查/); assert.match(waiting.body, /无需再公布/);
  game.research = null;
  const finished = journey(game, { previous: waiting, paused: true });
  assert.equal(finished.stage, 'result'); assert.equal(finished.primaryAction.type, 'restart');
});


test('negative public growth interrupts optimistic holds and recommends defense immediately', () => {
  const game = underAttack(); finishCounter(game); game.time = 360; population(game, 70, 20); game.points = 100;
  game.truthRate = 0.02;
  const before = journey(game, { nowMs: 1000 });
  assert.equal(before.stage, 'public-growth');
  game.truthRate = -0.02;
  const loss = journey(game, { previous: before, nowMs: 1100, lastAction: { type: 'upgrade', key: 'persuasion', at: 1000 } });
  assert.equal(loss.stage, 'public-loss'); assert.equal(loss.primaryAction.key, 'defense');
  assert.equal(loss.primaryAction.disabled, false); assert.deepEqual(loss.attention, { target: 'upgrade-defense', tone: 'warning' });
  population(game, 7, 20);
  assert.equal(journey(game, { previous: loss, nowMs: 1200 }).stage, 'public-loss');
  game.truthRate = -0.015;
  assert.notEqual(journey(game, { previous: loss, nowMs: 1300 }).stage, 'public-loss');
});

test('public loss advice respects crisis, attack, evidence choice, and pause priorities', () => {
  const game = preparation(); finishCurrentSearch(game); underAttack(game); game.truthRate = -0.1;
  assert.equal(journey(game).stage, 'evidence-ready');
  counterWithSource(game); assert.equal(journey(game).stage, 'evidence-ready');
  criticalNetwork(game); assert.equal(journey(game).stage, 'evidence-ready');
  publishEvidence(game);
  assert.equal(journey(game).stage, 'network-critical');
  assert.equal(journey(game, { paused: true }).stage, 'paused');
  assert.equal(journey(game, { paused: true, modalOpen: true }).stage, 'modal');
});

test('public loss offers a live defense funding target and useful alternatives once defense is full', () => {
  const game = underAttack(); finishCounter(game, true); game.truthRate = -0.1; game.points = 0;
  const waiting = journey(game);
  assert.equal(waiting.stage, 'public-loss'); assert.equal(waiting.primaryAction.key, 'defense');
  assert.equal(waiting.primaryAction.disabled, true); assert.equal(waiting.attention.target, 'points');
  game.points = waiting.primaryAction.cost;
  assert.equal(journey(game, { previous: waiting }).primaryAction.disabled, false);
  game.levels.defense = 3; game.points = 100;
  assert.equal(journey(game).primaryAction.key, 'persuasion');
  game.levels.persuasion = 2; game.points = 24;
  assert.equal(journey(game).primaryAction.key, 'spread', 'an affordable alternative is preferred to an unavailable purchase');
  game.points = 100; game.levels.persuasion = 3;
  assert.equal(journey(game).primaryAction.key, 'spread');
  game.levels.spread = 3;
  const full = journey(game);
  assert.equal(full.stage, 'public-loss'); assert.equal(full.primaryAction, null); assert.equal(full.attention.tone, 'warning');
});

test('negative growth does not replace preparation advice before public action', () => {
  const game = preparation(); game.truthRate = -0.1;
  assert.notEqual(journey(game).stage, 'public-loss');
});


test('the first earned coin introduces clicking, without overtaking threats or a pause', () => {
  const game = createGame(); tick(game, RULES.coinFirstAt);
  const hint = journey(game, { firstMovePending: true });
  assert.equal(hint.stage, 'collect-coins'); assert.equal(hint.primaryAction, null);
  assert.deepEqual(hint.attention, { target: 'coins', tone: 'success' });
  assert.match(hint.body, /金币/); assert.equal(getCoinEconomy(game).clicks, 0);
  assert.equal(journey(game, { paused: true }).stage, 'paused');
  assert.equal(journey(game, { modalOpen: true }).stage, 'modal');
  game.points = 100; underAttack(game);
  assert.match(journey(game).stage, /^enemy-/);
  finishCounter(game, true); game.truthRate = -0.1;
  assert.equal(journey(game).stage, 'public-loss');
  criticalNetwork(game); assert.equal(journey(game).stage, 'network-critical');
});

test('collectibles replace idle upgrade funding and can be collected during a search', () => {
  const game = createGame(); buyUpgrade(game, 'spread'); tick(game, RULES.coinFirstAt);
  game.points = 0;
  const idle = journey(game);
  assert.equal(idle.stage, 'collect-coins'); assert.match(idle.body, /搜证还差/);
  game.coins = getResearchStatus(game).cost; startCurrentSearch(game);
  assert.equal(journey(game).stage, 'collect-coins');
  for (const coin of [...game.coinDrops]) collectCoin(game, coin.id);
  assert.equal(journey(game).stage, 'researching');
});

test('action points never count toward search funding, and search gold never funds upgrades', () => {
  const game = preparation(); game.points = 500; game.coins = 0;
  const ask = journey(game, { researchSeenRound: 0, intent: { type: 'research', roundId: getResearchStatus(game).roundId } });
  assert.equal(ask.stage, 'coin-funding'); assert.match(ask.title, new RegExp(RULES.researchCosts[0] + ' 金币'));
  game.coins = RULES.researchCosts[0]; game.points = 0;
  const ready = journey(game, { researchSeenRound: 0 });
  assert.equal(ready.stage, 'new-clue'); assert.equal(ready.primaryAction.disabled, false);
  startCurrentSearch(game); finishCurrentSearch(game);
  game.researchResults[0].storedAt = game.time;
  game.regions.forEach(region => { region.seeded = region.id === game.startRegionId; });
  game.coins = 1000;
  const expand = journey(game);
  assert.equal(expand.stage, 'evidence-ready'); assert.equal(expand.primaryAction.type, 'publish');
  assert.equal(expand.primaryAction.disabled, false); assert.match(expand.body, /公布/);
  assert.doesNotMatch(expand.body, /秒|Infinity/);
});

test('enough gold bypasses neither first publication nor the follow-up regional gate', () => {
  const game = preparation(); finishCurrentSearch(game);
  game.researchResults[0].storedAt = game.time;
  game.regions.forEach(region => { region.seeded = region.id === game.startRegionId; });
  game.coins = RULES.researchCosts[1];
  const unpublished = journey(game, { researchSeenRound: 1 });
  assert.equal(getResearchStatus(game).phase, 'ready-to-publish'); assert.equal(unpublished.stage, 'evidence-ready');
  assert.equal(unpublished.primaryAction.type, 'publish'); assert.equal(unpublished.attention.target, 'publish');
  assert.equal(publishEvidence(game).ok, true); finishCounter(game, true);
  game.regions.forEach(region => { region.seeded = region.id === game.startRegionId; });
  const locked = journey(game, { researchSeenRound: 1 });
  assert.equal(getResearchStatus(game).gate, 'network'); assert.equal(locked.stage, 'followup-network');
  assert.equal(locked.primaryAction.key, 'spread');
  assert.equal(locked.attention.target, 'upgrade-spread');
  game.regions.slice(0, 3).forEach(region => { region.seeded = true; });
  const ready = journey(game, { researchSeenRound: 1, previous: locked });
  assert.equal(ready.stage, 'new-clue'); assert.equal(ready.primaryAction.currency, 'coins');
});

test('after all five searches succeed, the existing coin hint explains automatic conversion', () => {
  const game = finishAllSearches();
  finishAllWaves(game);
  game.coinEconomy.nextAt = game.time; tick(game, 0.1);
  assert.equal(getCoinEconomy(game).cashoutActive, true); assert.ok(game.coinDrops.length);
  const hint = journey(game);
  assert.equal(hint.stage, 'collect-coins');
  assert.match(hint.body, new RegExp('每 ' + getCoinEconomy(game).exchangeRate + ' 金币自动换 1 行动点'));
  assert.equal(hint.primaryAction, null, 'collection stays on the map, not a second collect-all button');
});

test('coins cannot promise emergency action points before all five searches succeed', () => {
  const game = underAttack(); game.points = 0; game.coins = 5;
  game.coinDrops = [{ id: 900, regionId: game.startRegionId, value: 60 }];
  assert.equal(getCoinEconomy(game).cashoutActive, false);
  for (const level of [0, 1]) {
    game.levels.defense = level;
    const enemy = journey(game);
    assert.match(enemy.stage, /^enemy-/); assert.equal(enemy.attention.target, 'points');
    assert.doesNotMatch(enemy.body, /点地图金币|金币.*行动点/);
  }
  game.points = 12; finishCounter(game, true); game.points = 0; game.truthRate = -0.1;
  const loss = journey(game);
  assert.equal(loss.stage, 'public-loss'); assert.equal(loss.attention.target, 'points');
  assert.doesNotMatch(loss.body, /点地图金币|金币.*行动点/);
  criticalNetwork(game);
  const critical = journey(game);
  assert.equal(critical.stage, 'network-critical'); assert.equal(critical.attention.target, 'points');
  assert.doesNotMatch(critical.body, /点地图金币|金币.*行动点/);
});

test('emergency clarification uses the coin remainder and existing drops to explain exact funding', () => {
  const game = finishAllSearches(); underAttack(game);
  game.points = 10; game.coins = 5;
  game.coinDrops = [{ id: 901, regionId: game.startRegionId, value: 7 }];
  const funded = journey(game);
  assert.equal(funded.stage, 'enemy-funding'); assert.equal(funded.attention.target, 'coins');
  assert.equal(funded.primaryAction.type, 'counter'); assert.equal(funded.primaryAction.disabled, true);
  assert.match(funded.body, /可换 2 行动点，够做发起澄清/);
  assert.doesNotMatch(funded.body, /秒攒够/);
  game.points = 0;
  const partial = journey(game);
  assert.match(partial.body, /先补 2 行动点，发起澄清还差 10 点/);
  assert.doesNotMatch(partial.body, /够做/);
  game.points = 10;
  const collected = collectCoin(game, 901);
  assert.equal(collected.pointsEarned, 2);
  const actionable = journey(game);
  assert.equal(actionable.primaryAction.disabled, false); assert.equal(actionable.attention.target, 'enemy');
});

test('defended attacks, public loss, and collapse retain urgency while offering collectible rescue funds', () => {
  const game = finishAllSearches(); underAttack(game);
  game.levels.defense = 1; game.points = 0; game.coins = 2;
  game.coinDrops = [{ id: 902, regionId: game.startRegionId, value: 16 }];
  const defended = journey(game);
  assert.equal(defended.stage, 'enemy-defended'); assert.equal(defended.attention.target, 'coins');
  assert.match(defended.body, /先补 3 行动点，发起澄清还差 9 点/);
  game.points = 12; finishCounter(game, true); game.points = 15; game.truthRate = -0.1;
  const loss = journey(game);
  assert.equal(loss.stage, 'public-loss'); assert.equal(loss.primaryAction.key, 'defense');
  assert.equal(loss.primaryAction.disabled, true); assert.equal(loss.attention.target, 'coins');
  assert.match(loss.body, /可换 3 行动点，够做加强防守/);
  game.levels.persuasion = 1;
  criticalNetwork(game);
  const critical = journey(game);
  assert.equal(critical.stage, 'network-critical'); assert.equal(critical.attention.target, 'coins');
  assert.equal(critical.primaryAction.key, 'defense'); assert.match(critical.body, /可换 3 行动点/);
  game.coinDrops[0].value = 1; game.coins = 0;
  const small = journey(game);
  assert.match(small.body, /凑满 6 枚换 1 行动点/); assert.doesNotMatch(small.body, /够做/);
});

test('last-resort search during a crisis still uses its gold wallet', () => {
  const game = underAttack(); counterWithSource(game); criticalNetwork(game);
  game.levels = { spread: 3, persuasion: 3, defense: 3 };
  game.points = 100; game.coins = 0;
  const critical = journey(game);
  assert.equal(critical.stage, 'network-critical'); assert.equal(critical.primaryAction.type, 'open-search');
  assert.equal(critical.primaryAction.disabled, true); assert.match(critical.body, /搜证还差 18 金币/);
  assert.doesNotMatch(critical.body, /还差 0 点/);
});


function liveSearch() {
  const game = createGame({ researchMode: 'live' });
  game.coins = RULES.researchCosts[0];
  assert.equal(startResearch(game, '长城太空照片的原始出处是什么？', { requestId: 'journey-live-request-0001' }).ok, true);
  game.coinDrops = []; game.coinEconomy.nextAt = Infinity;
  return game;
}

test('live search guidance describes a real pending request without a fictional countdown or verdict', () => {
  const game = liveSearch(); tick(game, 30);
  const pending = journey(game), before = JSON.stringify(game);
  assert.equal(pending.stage, 'researching');
  assert.match(pending.title, /联网/); assert.match(pending.body, /经费已付/); assert.match(pending.body, /升级/);
  assert.doesNotMatch(pending.body, /还需|秒|查明|核验通过|已证实/);
  assert.equal(pending.attention.target, 'research-progress');
  assert.equal(pending.primaryAction, null); assert.equal(game.evidence.length, 0);
  journey(game); assert.equal(JSON.stringify(game), before);
});

test('failed live research offers a funded retry without consuming the round or implying a truth verdict', () => {
  const game = liveSearch();
  failLiveResearch(game, game.research.requestId, '暂时连不上元宝搜索。');
  game.coinDrops = [{ id: 1001, regionId: game.startRegionId, value: 8 }];
  const hint = journey(game, { firstMovePending: true });
  assert.equal(hint.stage, 'research-error'); assert.match(hint.title, /金币已退回/);
  assert.match(hint.body, /暂时连不上元宝搜索.*本轮搜证机会还在/);
  assert.equal(hint.primaryAction.type, 'open-search'); assert.equal(hint.primaryAction.currency, 'coins');
  assert.equal(hint.primaryAction.disabled, false); assert.equal(hint.attention.target, 'search');
  assert.equal(game.coins, RULES.researchCosts[0]); assert.equal(game.evidence.length, 0);
  assert.doesNotMatch(hint.body, /谎言成立|验证失败|已查明/);
  assert.equal(startResearch(game, '长城照片在哪里拍摄？', { requestId: 'journey-live-retry-0002' }).ok, true);
  game.coinDrops = [];
  assert.equal(journey(game).stage, 'researching'); assert.equal(game.researchError, null);
});

test('a refunded search never displaces pause, enemy, falling support, or network collapse guidance', () => {
  const game = liveSearch(); failLiveResearch(game, game.research.requestId, '搜索暂时不可用。');
  assert.equal(journey(game, { paused: true }).stage, 'paused');
  assert.equal(journey(game, { modalOpen: true }).stage, 'modal');
  game.points = 100; underAttack(game);
  assert.match(journey(game).stage, /^enemy-/);
  finishCounter(game, true); game.truthRate = -0.1;
  assert.equal(journey(game).stage, 'public-loss');
  criticalNetwork(game); assert.equal(journey(game).stage, 'network-critical');
  game.phase = 'won'; assert.equal(journey(game).stage, 'result');
});
