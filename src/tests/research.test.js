import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, createGame, tick, getStats, getPublishPreview, getSelectedEvidence, getPendingEvidence, getResearchStatus, startResearch, promoteEvidence, getEvidenceBonuses, getEvidenceEvent, getTransports, publishEvidence, counterWithSource, getCounterStatus, getCampaignStatus } from '../dist/engine.js';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';
import { play } from './balance.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function firstResult(seed = 1) {
  const state = createGame({ seed }); tick(state, 35); state.coins = RULES.researchCosts[0];
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
  tick(state, 12); return state;
}
function publishFixture(state, focus) {
  const pending = getResearchStatus(state).pendingChoice;
  const definition = RESEARCH_ROUNDS.find(round => round.id === pending.roundId);
  const material = definition.materials.find(item => item.focus === focus);
  // Fix the selected material only inside this effect-isolation fixture.
  // Recommendation locking is covered by the acquisition tests.
  state.researchResults.find(result => result.roundId === pending.roundId).selectedId = material.id;
  assert.equal(publishEvidence(state).ok, true);
  return material;
}
function secondResult(state) {
  // Population and evidence bonuses are isolated from the coin economy here.
  state.regions.forEach(region => { region.seeded = true; });
  if (state.operationPhase !== 'public') {
    state.points = Math.max(state.points, RULES.publicationCost + RULES.counterCost);
    assert.equal(publishEvidence(state).ok, true);
  }
  if (state.event?.counterStartedAt == null) assert.equal(counterWithSource(state).ok, true);
  state.coins = RULES.researchCosts[1];
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true);
  tick(state, 16);
}

test('round one is available by funding rather than a timer and a pending result remains reviewable', () => {
  const state = createGame();
  const snapshot = JSON.stringify(state);
  assert.equal(getResearchStatus(state).phase, 'ready');
  assert.equal(getResearchStatus(state).available, false);
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
  state.coins = RULES.researchCosts[0]; assert.equal(getResearchStatus(state).available, true);
  startResearch(state, getResearchStatus(state).query); tick(state, 12);
  const pending = getResearchStatus(state).pendingChoice;
  pending.evidenceIds.length = 0; pending.promotedId = 'invented';
  assert.equal(getResearchStatus(state).pendingChoice.evidenceIds.length, 2);
  tick(state, 180);
  assert.equal(getResearchStatus(state).phase, 'ready-to-publish');
  assert.equal(state.evidence.length, 1); assert.equal(state.evidenceEvents.length, 0);
  assert.equal(getEvidenceBonuses(state).spreadBonus, 0);
  state.phase = 'won';
  const ended = JSON.stringify(state); tick(state, 10);
  assert.equal(JSON.stringify(state), ended);
  assert.equal(getResearchStatus(state).pendingChoice.evidenceIds.length, 2);
});

test('each pair is archived while only its published material contributes an additive bonus', () => {
  const state = firstResult(); publishFixture(state, 'persuasion');
  close(getEvidenceBonuses(state).persuasionBonus, .5);
  secondResult(state); publishFixture(state, 'persuasion');
  close(getEvidenceBonuses(state).persuasionBonus, 1);
  close(getEvidenceBonuses(state).persuasionMultiplier, 2);
  close(getStats(state).evidenceMultiplier, 1 + 2 * RULES.evidenceBonusPerRound);
  assert.equal(state.researchResults.flatMap(result => result.evidenceIds).length, 4);
  assert.equal(state.researchResults.filter(result => result.promotedId).length, 2);
  assert.deepEqual(state.levels, { spread: 0, persuasion: 0, defense: 0 });
});

test('publishing spread and persuasion changes their corresponding population flows without changing levels', () => {
  const spread = firstResult(), persuasion = structuredClone(spread);
  publishFixture(spread, 'spread'); publishFixture(persuasion, 'persuasion');
  for (const state of [spread, persuasion]) { state.transit.active = []; state.transit.nextDeparture = Infinity; }
  tick(spread, 30); tick(persuasion, 30);
  assert.ok(getStats(spread).reached > getStats(persuasion).reached);
  assert.ok(getStats(persuasion).truth > getStats(spread).truth);
  assert.deepEqual(spread.levels, persuasion.levels);
});

test('the fictional controversy modifies only optional bonuses, pauses with time, then restores them', () => {
  const state = firstResult(); const material = publishFixture(state, 'persuasion');
  while (!getEvidenceEvent(state) && state.time < 150) tick(state, .1);
  const active = getEvidenceEvent(state);
  assert.ok(active); assert.equal(active.eventId, material.eventId);
  close(active.endsAt - active.startedAt, 45);
  close(getEvidenceBonuses(state).spreadBonus, .8);
  close(getEvidenceBonuses(state).persuasionBonus, .4);
  assert.equal(state.evidence.length, 1); close(getStats(state).evidenceMultiplier, 1 + RULES.evidenceBonusPerRound);
  assert.deepEqual(state.levels, { spread: 0, persuasion: 0, defense: 0 });
  const paused = JSON.stringify(state); active.endsAt = 0; getEvidenceBonuses(state);
  assert.equal(JSON.stringify(state), paused);
  tick(state, getEvidenceEvent(state).endsAt - state.time);
  assert.equal(getEvidenceEvent(state), null);
  close(getEvidenceBonuses(state).spreadBonus, 0);
  close(getEvidenceBonuses(state).persuasionBonus, .5);
});

test('each selected round schedules one related event and neither media nor evidence events overlap', () => {
  const state = firstResult(); const first = publishFixture(state, 'persuasion');
  secondResult(state); const second = publishFixture(state, 'persuasion');
  tick(state, 380 - state.time);
  assert.equal(state.evidenceEvents.length, 2);
  assert.deepEqual(state.evidenceEvents.map(event => event.eventId), [first.eventId, second.eventId]);
  for (const event of state.evidenceEvents) {
    const result = state.researchResults.find(item => item.roundId === event.roundId);
    assert.ok(event.startedAt >= result.promotedAt + 45);
  }
  const all = [...state.evidenceEvents, ...state.mediaEvents].sort((a, b) => a.startedAt - b.startedAt);
  all.forEach((event, index) => { if (index) assert.ok(event.startedAt >= all[index - 1].endsAt); });
  assert.equal(state.evidence.length, 2);
});

test('an evidence-linked viral event cannot create a truth carrier in a region with no truth', () => {
  const state = firstResult(); publishFixture(state, 'persuasion');
  for (const region of state.regions) Object.assign(region, { red: 100, exposed: 0, blue: 0 });
  for (const trip of state.transit.active) trip.carryingTruth = false;
  const carried = state.transit.stats.carrying;
  tick(state, 120 - state.time);
  assert.ok(getEvidenceEvent(state));
  assert.equal(getStats(state).reached, 0);
  assert.equal(state.transit.stats.carrying, carried);
  assert.ok(getTransports(state).every(trip => !trip.carryingTruth));
});

test('evidence and temporary bonuses keep carrying probability below certainty', () => {
  const template = firstResult(); publishFixture(template, 'spread');
  let carried = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const state = structuredClone(template);
    state.transit.rng = seed; state.transit.active = []; state.transit.nextDeparture = state.time + 2;
    state.levels.spread = 3;
    for (const region of state.regions) Object.assign(region, { red: 0, exposed: 20, blue: 80 });
    const before = state.transit.stats.carrying;
    tick(state, 2); carried += state.transit.stats.carrying - before;
  }
  assert.ok(carried > 950 && carried < 995, `${carried}/1000 trips carried truth`);
});

test('two published evidence routes and their scheduled effects reproduce for the same seed and elapsed time', () => {
  const a = firstResult(23), b = firstResult(23);
  for (const state of [a, b]) { publishFixture(state, 'spread'); secondResult(state); publishFixture(state, 'persuasion'); }
  for (let i = 0; i < 60; i++) tick(a, 1);
  tick(b, 60);
  assert.deepEqual(a.evidenceEvents, b.evidenceEvents);
  assert.deepEqual(a.mediaEvents, b.mediaEvents);
  assert.deepEqual(a.transit, b.transit);
  close(getStats(a).truth, getStats(b).truth);
});

function repeatDelivery(secondFocus = 'spread') {
  const state = firstResult(); publishFixture(state, 'spread'); secondResult(state);
  if (secondFocus) publishFixture(state, secondFocus);
  // Every publication now brings a separate attack. Clear both before testing
  // delivery in isolation, including the queued wave after the recovery window.
  for (let i = 0; getCampaignStatus(state).cleared < state.publications.length && i < 5; i++) {
    if (state.event.resolved) tick(state, RULES.counterRecoveryDuration);
    if (!getCounterStatus(state).active) {
      state.points = RULES.counterCost;
      assert.equal(counterWithSource(state).ok, true);
    }
    tick(state, getCounterStatus(state).remaining + .1);
  }
  assert.equal(getCampaignStatus(state).cleared, state.publications.length);
  tick(state, RULES.counterRecoveryDuration);
  state.levels.spread = 3;
  state.regions.forEach(region => Object.assign(region, { red: 0, exposed: 60, blue: 40, seeded: true }));
  state.transit.active = []; state.transit.nextDeparture = state.time + 2;
  // Retain one actual scheduled truth carrier, then isolate its arrival from
  // all other traffic so the difference is delivery, not background growth.
  let trip;
  for (let i = 0; i < 5 && !trip; i++) {
    tick(state, 2);
    trip = state.transit.active.find(item => item.carryingTruth && item.landingRoll < .98);
  }
  assert.ok(trip);
  state.transit.active = [trip]; state.transit.nextDeparture = Infinity;
  return { state, trip, target: state.regions.find(region => region.id === trip.to) };
}

function deliverComparedWithNoArrival(state, trip) {
  const control = structuredClone(state); control.transit.active = [];
  const duration = trip.arrivesAt - state.time;
  tick(state, duration); tick(control, duration);
  const target = state.regions.find(region => region.id === trip.to);
  const baseline = control.regions.find(region => region.id === trip.to);
  const event = state.transportEvents.find(item => item.tripId === trip.id && item.type !== 'departure');
  assert.ok(event);
  state.regions.forEach(region => {
    close(region.red + region.exposed + region.blue, 100);
    assert.ok(region.red >= 0 && region.exposed >= 0 && region.blue >= 0);
  });
  return { target, baseline, event };
}

test('the second spread material converts existing observers at a successful real delivery even when reach is saturated', () => {
  const { state, trip } = repeatDelivery();
  close(getEvidenceBonuses(state).arrivalConversion, RULES.evidenceArrivalConversion);
  const { target, baseline, event } = deliverComparedWithNoArrival(state, trip);
  assert.equal(event.outcome, 'reinforced'); assert.equal(event.seedAmount, 0);
  close(event.convertedAmount, baseline.exposed * .03);
  close(target.blue - baseline.blue, event.convertedAmount);
  close(baseline.exposed - target.exposed, event.convertedAmount);
  close(target.red, baseline.red);
});

test('delivery persuades only the pre-existing audience, never the people first reached by that arrival', () => {
  for (const population of [{ red: 100, exposed: 0, blue: 0, seeded: false }, { red: 40, exposed: 40, blue: 20, seeded: true }]) {
    const fixture = repeatDelivery(); Object.assign(fixture.target, population);
    const { target, baseline, event } = deliverComparedWithNoArrival(fixture.state, fixture.trip);
    close(event.convertedAmount, baseline.exposed * .03);
    close(target.exposed - baseline.exposed, event.seedAmount - event.convertedAmount);
    close(target.blue - baseline.blue, event.convertedAmount);
    if (!population.seeded) {
      assert.equal(event.type, 'first-seed'); assert.equal(event.convertedAmount, 0);
      assert.equal(target.blue, 0); assert.ok(target.exposed > 0);
    }
  }
});

test('ordinary, intercepted and unsuccessful messages cannot use the repeat-delivery conversion', () => {
  for (const kind of ['ordinary', 'blocked', 'missed']) {
    const { state, trip } = repeatDelivery();
    if (kind === 'ordinary') trip.carryingTruth = false;
    if (kind === 'missed') trip.landingRoll = 1;
    if (kind === 'blocked') {
      Object.assign(state.event, { resolved: false, stage: 'active', activeFor: 0, pressure: .5, counterStartedAt: null, counterProgress: 0 });
      state.event.regionIds = [trip.to]; trip.blockRoll = 0;
    }
    const { target, baseline, event } = deliverComparedWithNoArrival(state, trip);
    assert.equal(event.outcome, kind); assert.equal(event.convertedAmount, 0);
    assert.deepEqual(target, baseline);
  }
});

test('holding the second result or publishing persuasion grants no repeat-delivery conversion', () => {
  for (const focus of [null, 'persuasion']) {
    const { state, trip } = repeatDelivery(focus);
    assert.equal(getEvidenceBonuses(state).arrivalConversion, 0);
    const { target, baseline, event } = deliverComparedWithNoArrival(state, trip);
    assert.equal(event.convertedAmount, 0); assert.equal(event.outcome, 'saturated');
    assert.deepEqual(target, baseline);
  }
});

test('automatic recommendations support both propagation and persuasion investment policies', () => {
  const balanced = play();
  const propagation = play({ prepOrder: ['spread', 'spread'], postOrder: ['spread', 'defense', 'persuasion', 'defense', 'persuasion'] });
  for (const state of [balanced, propagation]) {
    assert.equal(state.phase, 'won');
    assert.equal(state.evidence.length, 5);
    assert.equal(state.publications.length, 5);
    assert.ok(state.researchResults.every(result => result.selectedId === result.promotedId));
  }
});


test('a finished search locks the suitable evidence once and keeping it in hand activates no optional effects', () => {
  const state = firstResult();
  const pending = getResearchStatus(state).pendingEvidence;
  assert.equal(pending.selectedId, 'photo-spread');
  assert.equal(getSelectedEvidence(state, pending).id, pending.selectedId);
  assert.equal(getPendingEvidence(state).id, pending.selectedId);
  assert.equal(pending.promotedId, null);
  for (const region of state.regions) Object.assign(region, { red: 10, exposed: 70, blue: 20 });
  tick(state, 50);
  assert.equal(getPendingEvidence(state).id, pending.selectedId, 'later population changes cannot reroll the report');
  assert.equal(getEvidenceBonuses(state).spreadBonus, 0);
  assert.equal(getEvidenceBonuses(state).persuasionBonus, 0);
  assert.equal(state.event, null); assert.equal(state.evidenceEvents.length, 0);
  assert.equal(getPublishPreview(state).cost, 0);
  assert.equal(getPublishPreview(state).title, getPendingEvidence(state).title);
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, false);
  const snapshot = JSON.stringify(state);
  assert.equal(promoteEvidence(state, pending.evidenceIds[1]).ok, false);
  assert.equal(JSON.stringify(state), snapshot, 'retired choice cannot replace the recommendation or activate it');
});

test('a well-reached world automatically recommends persuasion at completion', () => {
  const state = createGame(); state.coins = RULES.researchCosts[0];
  state.regions.forEach(region => Object.assign(region, { red: 20, exposed: 60, blue: 20, seeded: true }));
  startResearch(state, getResearchStatus(state).query); tick(state, 12);
  assert.equal(getPendingEvidence(state).focus, 'persuasion');
});

test('each of five publications is free and queues its own counterattack without replacing the active fight', () => {
  const state = firstResult();
  state.regions.forEach(region => Object.assign(region, { red: 40, exposed: 50, blue: 10, seeded: true }));
  state.points = 0;
  let firstAttack;
  for (let round = 0; round < 5; round++) {
    if (round > 0) {
      state.coins = RULES.researchCosts[round];
      assert.equal(startResearch(state, getResearchStatus(state).query).ok, true); tick(state, 16);
    }
    const preview = getPublishPreview(state), before = getStats(state), points = state.points, spent = state.totals.spent;
    assert.equal(preview.roundId, `round-${round + 1}`);
    assert.equal(preview.firstPublication, round === 0);
    if (round) close(preview.conversionFraction, RULES.followupPublicationConversion);
    const publication = publishEvidence(state);
    assert.equal(publication.ok, true); assert.equal(publication.material.id, preview.evidenceId);
    close(getStats(state).truth - before.truth, preview.gain); close(getStats(state).reached, before.reached);
    close(state.totals.spent, spent); assert.ok(state.points >= points);
    if (!round) firstAttack = state.event; else assert.equal(state.event, firstAttack);
    assert.equal(state.enemyWaves.length, round + 1);
    assert.equal(state.enemyWaves.at(-1).publicationId, preview.roundId);
    assert.equal(getCampaignStatus(state).queued, round);
    assert.equal(state.researchResults[round].promotedId, preview.evidenceId);
    assert.equal(state.researchResults[round].publishedAt, state.time);
    const snapshot = JSON.stringify(state);
    assert.equal(publishEvidence(state).ok, false); assert.equal(JSON.stringify(state), snapshot);
  }
  assert.equal(state.publications.length, 5); assert.equal(getResearchStatus(state).phase, 'complete');
  assert.equal(state.log.filter(entry => entry.type === 'warning').length, 1);
  assert.equal(state.log.filter(entry => entry.type === 'publication').length, 5);
});

test('publication that reaches the support target wins without scheduling another counterattack', () => {
  const empty = createGame(), snapshot = JSON.stringify(empty);
  assert.equal(getPublishPreview(empty).available, false); assert.equal(publishEvidence(empty).ok, false);
  assert.equal(JSON.stringify(empty), snapshot);
  const state = firstResult();
  state.regions.forEach(region => Object.assign(region, { red: 0, exposed: 100 - RULES.winTruth + .5, blue: RULES.winTruth - .5, seeded: true }));
  const time = state.time;
  assert.ok(getPublishPreview(state).gain >= .5);
  assert.equal(publishEvidence(state).ok, true);
  assert.equal(state.phase, 'won');
  assert.equal(state.victoryAt, time);
  assert.equal(state.publications.length, 1);
  assert.equal(state.enemyWaves.length, 0);
  assert.equal(state.event, null);
  assert.ok(getStats(state).truth >= RULES.winTruth);
  const frozen = JSON.stringify(state);
  tick(state, 60);
  assert.equal(JSON.stringify(state), frozen);
});

test('a paid demo search finishes after victory while the world and its elapsed time stay frozen', () => {
  const state = createGame(); state.coins = RULES.researchCosts[0];
  startResearch(state, getResearchStatus(state).query); tick(state, 3);
  state.regions.forEach(region => Object.assign(region, { red: 0, exposed: 100 - RULES.winTruth, blue: RULES.winTruth }));
  tick(state, 0);
  assert.equal(state.phase, 'won'); assert.equal(state.victoryAt, 3);
  assert.equal(state.victoryResearchId, null);
  const snapshot = () => structuredClone({ time: state.time, regions: state.regions, points: state.points, totals: state.totals, waves: state.enemyWaves, transit: state.transit, publications: state.publications });
  const world = snapshot(), elapsed = state.research.elapsed;
  tick(state, 2);
  assert.equal(state.research.elapsed, elapsed + 2); assert.deepEqual(snapshot(), world);
  tick(state, 100);
  assert.equal(state.research, null); assert.deepEqual(snapshot(), world);
  assert.equal(state.researchResults.length, 1); assert.equal(state.evidence.length, 1);
  assert.equal(state.researchResults[0].storedAt, state.victoryAt);
  assert.equal(state.researchResults[0].promotedId, null);
  assert.equal(getEvidenceBonuses(state).spreadBonus, 0);
  assert.equal(publishEvidence(state).ok, false);
  const archived = JSON.stringify(state); tick(state, 100);
  assert.equal(JSON.stringify(state), archived);
});

test('only the real support value wins, and crossing the threshold freezes at the crossing time', () => {
  const state = createGame();
  state.regions.forEach(region => Object.assign(region, { red: 0, exposed: 100 - RULES.winTruth + .05, blue: RULES.winTruth - .05 }));
  tick(state, 0); assert.equal(state.phase, 'playing', '98.95% is below a real 99% target');
  state.levels.persuasion = 3;
  tick(state, 100);
  assert.equal(state.phase, 'won'); assert.ok(getStats(state).truth >= RULES.winTruth);
  assert.ok(state.victoryAt > 0 && state.victoryAt < 100);
  assert.equal(state.time, state.victoryAt);
  const frozen = JSON.stringify(state); tick(state, 100);
  assert.equal(JSON.stringify(state), frozen);
});
