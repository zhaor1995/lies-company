import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, publishEvidence, counterWithSource, getCounterStatus, getCampaignStatus, getStats, ENEMY_WAVES, REGIONS, RULES } from '../dist/engine.js';
import { queueEvidence } from './evidence-fixture.mjs';
import { play } from './balance.mjs';

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
}

function combatState({ publications = 1, defense = 2 } = {}) {
  const state = createGame({ seed: 23 });
  state.regions.forEach(region => Object.assign(region, { red: 30, exposed: 30, blue: 40, seeded: true }));
  state.levels.defense = defense;
  state.points = 300;
  state.transit.active = [];
  state.transit.nextDeparture = Infinity;
  for (let i = 0; i < publications; i++) {
    queueEvidence(state);
    assert.equal(publishEvidence(state).ok, true);
  }
  return state;
}

test('every publication creates a distinct wave without replacing the current fight', () => {
  const state = combatState();
  assert.equal(counterWithSource(state).ok, true);
  tick(state, 5);
  const first = state.event, progress = first.counterProgress;
  for (let i = 1; i < ENEMY_WAVES.length; i++) {
    queueEvidence(state);
    assert.equal(publishEvidence(state).ok, true);
    assert.equal(state.event, first);
    assert.equal(state.enemyWaves.length, i + 1);
  }
  close(first.counterProgress, progress + 4 * RULES.counterEvidenceProgress);
  assert.equal(first.resolved, false);
  assert.deepEqual(state.enemyWaves.map(wave => wave.waveNumber), [1, 2, 3, 4, 5]);
  assert.equal(new Set(state.enemyWaves.map(wave => wave.id)).size, 5);
  assert.equal(getCampaignStatus(state).queued, 4);
  const snapshot = JSON.stringify(state);
  assert.equal(publishEvidence(state).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
});

test('each wave charges once and gives a distinct recovery window before the next attack', () => {
  const state = combatState({ publications: 5 });
  for (let index = 0; index < ENEMY_WAVES.length; index++) {
    // Keep this combat fixture below victory while exercising every queued wave.
    state.regions.forEach(region => Object.assign(region, { red: 80, exposed: 0, blue: 20 }));
    const wave = state.event, definition = ENEMY_WAVES[index];
    assert.equal(wave.waveNumber, index + 1);
    assert.equal(wave.regionIds.length, definition.targets);
    const spent = state.totals.spent;
    assert.equal(counterWithSource(state).ok, true);
    close(state.totals.spent - spent, RULES.counterCost);
    const snapshot = JSON.stringify(state);
    assert.equal(counterWithSource(state).ok, false);
    assert.equal(JSON.stringify(state), snapshot);
    while (!wave.resolved) tick(state, .1);
    close(wave.counterProgress, 100);
    assert.equal(getCampaignStatus(state).cleared, index + 1);
    assert.equal(state.log.filter(entry => entry.type === 'forgery').length, index + 1);
    assert.equal(state.log.find(entry => entry.type === 'forgery' && entry.waveNumber === index + 1).reward, RULES.counterReward);
    close(state.recoveryUntil - wave.counteredAt, RULES.counterRecoveryDuration);
    if (index + 1 < ENEMY_WAVES.length) {
      tick(state, state.recoveryUntil - state.time - .1);
      assert.equal(state.event, wave);
      assert.equal(state.enemyWaves[index + 1].stage, 'queued');
      tick(state, .2);
      assert.equal(state.event, state.enemyWaves[index + 1]);
      close(state.event.counterProgress, 0);
      assert.equal(state.event.counterStartedAt, null);
      assert.ok(state.event.startedAt >= wave.counteredAt + RULES.counterRecoveryDuration - 1e-6);
    }
  }
  close(state.totals.spent, 5 * RULES.counterCost);
  assert.equal(getCampaignStatus(state).complete, true);
});

test('successive waves cover more regions, hit harder and leave less preparation time', () => {
  assert.equal(ENEMY_WAVES.length, 5);
  for (let i = 1; i < ENEMY_WAVES.length; i++) {
    const previous = ENEMY_WAVES[i - 1], next = ENEMY_WAVES[i];
    assert.ok(next.targets > previous.targets);
    assert.ok(next.strength > previous.strength);
    assert.ok(next.hit > previous.hit);
    assert.ok(next.warning < previous.warning);
    assert.ok(next.duration > previous.duration);
  }
  assert.equal(ENEMY_WAVES.at(-1).targets, REGIONS.length);
});

test('a cleared wave creates an actual growth window, without instantly restoring population', () => {
  const state = combatState();
  counterWithSource(state);
  while (!state.event.resolved) tick(state, .1);
  const ordinary = structuredClone(state);
  ordinary.recoveryUntil = 0;
  assert.deepEqual(state.regions, ordinary.regions);
  const initial = getStats(state).truth;
  tick(state, 1);
  tick(ordinary, 1);
  assert.ok(getStats(state).truth - initial > getStats(ordinary).truth - initial);
  assert.ok(getStats(state).reached > getStats(ordinary).reached);
});

test('the support target wins immediately before a queued or active attack can remove it', () => {
  for (const publications of [0, 1, 5]) {
    const state = combatState({ publications, defense: 3 });
    state.regions.forEach(region => Object.assign(region, { red: 0, exposed: 100 - RULES.winTruth, blue: RULES.winTruth }));
    if (state.event) state.event.remaining = .01;
    state.collapseFor = RULES.collapseGrace;
    const time = state.time, population = structuredClone(state.regions), waves = structuredClone(state.enemyWaves);
    tick(state, 10);
    assert.equal(state.phase, 'won');
    assert.equal(state.victoryAt, time);
    assert.equal(state.time, time);
    assert.deepEqual(state.regions, population);
    assert.deepEqual(state.enemyWaves, waves);
    assert.ok(getStats(state).truth >= RULES.winTruth);
    assert.equal(getCampaignStatus(state).complete, false);
    const frozen = JSON.stringify(state);
    tick(state, 300);
    assert.equal(JSON.stringify(state), frozen);
  }
});

test('active play reaches the real support target without requiring all remaining waves', () => {
  for (const region of REGIONS) {
    const state = play({ regionId: region.id, maxSimulationTime: 1000 });
    assert.equal(state.phase, 'won', region.name);
    assert.ok(getStats(state).truth >= RULES.winTruth);
    assert.equal(state.victoryAt, state.time);
    assert.ok(state.publications.length <= ENEMY_WAVES.length);
    assert.ok(state.log.filter(entry => entry.type === 'counter-start').length <= ENEMY_WAVES.length);
  }
  const neglected = play({ counterWaves: 1, maxSimulationTime: 1000 });
  assert.notEqual(neglected.phase, 'won');
  assert.equal(getCampaignStatus(neglected).cleared, 1);
  assert.equal(neglected.event.waveNumber, 2);
  assert.ok(neglected.diagnostics.waves[1].maxDrop > 15);
});

test('defensive investment and prompt response both materially improve later waves', () => {
  const prepared = play();
  const delayed = play({ counterDelay: 15 });
  const exposed = play({ postOrder: ['persuasion', 'persuasion', 'spread'] });
  for (const state of [prepared, delayed, exposed]) assert.equal(state.phase, 'won');
  assert.ok(prepared.time < delayed.time);
  assert.ok(prepared.time < exposed.time);
  assert.ok(prepared.totals.relapsed < exposed.totals.relapsed);
  for (const wave of delayed.diagnostics.waves) assert.ok(wave.responseDelay >= 15 - 1e-6);
});

test('publishing near completion caps reinforcement, rewards once and preserves a fresh paid next wave', () => {
  const state = combatState({ defense: 2 });
  counterWithSource(state);
  tick(state, 87.5 / getCounterStatus(state).rate);
  const first = state.event;
  close(first.counterProgress, 87.5);
  const earned = state.totals.earned;
  queueEvidence(state);
  const publication = publishEvidence(state);
  assert.equal(publication.ok, true);
  close(publication.counterProgressGain, 12.5);
  close(first.counterProgress, 100);
  assert.equal(first.resolved, true);
  assert.equal(state.event, first);
  close(state.totals.earned - earned, RULES.counterReward);
  assert.equal(state.log.filter(entry => entry.type === 'forgery').length, 1);
  assert.equal(state.enemyWaves[1].stage, 'queued');
  assert.equal(getCampaignStatus(state).cleared, 1);

  tick(state, RULES.counterRecoveryDuration - .1);
  assert.equal(state.event, first);
  assert.equal(state.enemyWaves[1].stage, 'queued');
  assert.equal(state.log.filter(entry => entry.type === 'forgery').length, 1);
  tick(state, .2);
  assert.equal(state.event, state.enemyWaves[1]);
  assert.equal(state.event.counterStartedAt, null);
  close(state.event.counterProgress, 0);
  const spent = state.totals.spent, points = state.points;
  assert.equal(counterWithSource(state).ok, true);
  close(state.totals.spent - spent, RULES.counterCost);
  close(points - state.points, RULES.counterCost);
  const snapshot = JSON.stringify(state);
  assert.equal(counterWithSource(state).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(state.log.filter(entry => entry.type === 'forgery').length, 1);
});
