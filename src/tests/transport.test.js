import { queueEvidence } from './evidence-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, REGIONS, REGION_MEDIA_WEIGHTS, createGame, buyUpgrade, getTransports, getTransportStats, getTransportBlockChance, getMediaEvent, publishEvidence, startResearch, getResearchStatus, counterWithSource, tick, getStats } from '../dist/engine.js';
import { REGION_PRIMARY_MEDIA } from '../dist/media-network.js';
import { play } from './balance.mjs';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const reached = region => region.blue + region.exposed;
function advanceUntil(state, predicate, limit = 180) {
  while (!predicate(state) && state.time < limit) tick(state, .1);
  assert.ok(predicate(state), `condition not met by ${state.time}s`);
}

// These replace the removed channel-purchasing tests: outlets are ambient
// world traffic, not abilities bought or owned by the player.
test('the world begins with ordinary messages in flight and no purchased media network', () => {
  const state = createGame();
  assert.equal('channels' in state, false);
  assert.equal('networkCoverage' in state, false);
  assert.ok(CHANNELS.every(channel => !('routes' in channel) && channel.travelTime > 0));
  const trips = getTransports(state);
  assert.equal(trips.length, 2);
  assert.ok(trips.every(trip => !trip.carryingTruth && trip.progress > 0 && trip.progress < 1));
  assert.equal(getTransportStats(state).firstReached, 1);
  assert.equal(state.regions.find(region => region.id === 'europe').firstContactAt, 0);
});

test('ordinary traffic visits every origin but never seeds truth when the entire world has no truth', () => {
  const state = createGame(); state.levels.spread = 3;
  state.regions.forEach(region => { region.red = 100; region.exposed = 0; region.blue = 0; region.seeded = false; region.firstContactAt = null; });
  tick(state, 120);
  assert.equal(getStats(state).reached, 0);
  assert.equal(getTransportStats(state).carrying, 0);
  assert.equal(getTransportStats(state).seeded, 0);
  assert.ok(getTransportStats(state).arrived > 20);
  assert.deepEqual([...new Set(state.transportEvents.filter(event => event.type === 'departure').map(event => event.from))].sort(), REGIONS.map(region => region.id).sort());
  assert.ok(state.transportEvents.every(event => !event.carryingTruth));
});

test('no region leaks continuously into another: first contact happens at a real arrival time', () => {
  const state = createGame({ seed: 1 }); buyUpgrade(state, 'spread');
  tick(state, 2);
  const trip = getTransports(state).find(item => item.carryingTruth);
  assert.ok(trip);
  assert.equal(trip.departedAt, 2);
  assert.ok(trip.arrivesAt > trip.departedAt);
  tick(state, trip.arrivesAt - state.time - .1);
  assert.ok(state.regions.filter(region => region.id !== state.startRegionId).every(region => reached(region) === 0));
  assert.equal(getTransportStats(state).firstReached, 1);
  tick(state, .1);
  const destination = state.regions.find(region => region.id === trip.to);
  assert.ok(destination.seeded && destination.exposed > 0);
  assert.equal(destination.firstContactAt, trip.arrivesAt);
  const event = state.transportEvents.find(event => event.tripId === trip.id && event.type === 'first-seed');
  assert.equal(event.time, trip.arrivesAt);
  assert.equal(event.carryingTruth, true);
  assert.equal(event.seedAmount, 3.6);
  assert.equal(getTransportStats(state).firstReached, 2);
});

test('successful imported seed grows locally and untouched regions remain exactly untouched without more trips', () => {
  const state = createGame(); buyUpgrade(state, 'spread');
  advanceUntil(state, s => getTransportStats(s).firstReached === 2);
  const imported = state.regions.find(region => region.seeded && region.id !== state.startRegionId);
  const before = reached(imported);
  // Isolate local growth after a real, tested arrival; no future transport.
  state.transit.active = []; state.transit.nextDeparture = Infinity;
  tick(state, 15);
  assert.ok(reached(imported) > before);
  assert.ok(state.regions.filter(region => !region.seeded).every(region => reached(region) === 0));
});

test('arrival decides seeding; an ordinary message cannot pick up truth while already in flight', () => {
  const state = createGame();
  const ordinary = getTransports(state)[0];
  const source = state.regions.find(region => region.id === ordinary.from);
  source.red = 0; source.exposed = 0; source.blue = 100;
  tick(state, ordinary.arrivesAt);
  const arrival = state.transportEvents.find(event => event.tripId === ordinary.id && event.type === 'arrival');
  assert.equal(arrival.outcome, 'ordinary');
  assert.equal(arrival.seedAmount, 0);
  assert.equal(arrival.carryingTruth, false);
});

test('in-flight progress freezes without ticking and read APIs return independent snapshots', () => {
  const state = createGame(); buyUpgrade(state, 'spread'); tick(state, 3);
  const before = JSON.stringify(state), first = getTransports(state);
  getTransportStats(state); getTransports(state);
  assert.equal(JSON.stringify(state), before);
  const snapshot = first.find(trip => trip.carryingTruth), id = snapshot.id, progress = snapshot.progress;
  snapshot.progress = 1; snapshot.carryingTruth = false;
  assert.equal(getTransports(state).find(trip => trip.id === id).progress, progress);
  tick(state, 1);
  assert.ok(getTransports(state).find(trip => trip.id === id).progress > progress);
});

test('the same seed and elapsed game time reproduce departures, carried truth, arrivals and population', () => {
  const a = createGame({ seed: 23 }), b = createGame({ seed: 23 });
  buyUpgrade(a, 'spread'); buyUpgrade(b, 'spread');
  for (let i = 0; i < 120; i++) tick(a, 1);
  tick(b, 120);
  assert.deepEqual(a.transportEvents, b.transportEvents);
  assert.deepEqual(a.transit, b.transit);
  a.regions.forEach((region, i) => { close(region.red, b.regions[i].red); close(region.exposed, b.regions[i].exposed); close(region.blue, b.regions[i].blue); });
  const different = createGame({ seed: 99 }); buyUpgrade(different, 'spread'); tick(different, 120);
  assert.notDeepEqual(a.transportEvents.map(event => [event.from, event.to, event.channelId, event.carryingTruth]), different.transportEvents.map(event => [event.from, event.to, event.channelId, event.carryingTruth]));
});

test('propagation remains an ordinary shared-budget upgrade without choosing or owning a media brand', () => {
  const state = createGame();
  assert.equal(buyUpgrade(state, 'spread').ok, true);
  assert.equal(state.points, 14); assert.equal(state.levels.spread, 1);
  assert.equal(getTransports(state).length, 2);
  assert.equal('channels' in state, false);
  const before = JSON.stringify(state);
  assert.equal(buyUpgrade(state, 'spread').ok, false);
  assert.equal(JSON.stringify(state), before);
});

test('propagation improvements increase carried messages and successful landing without buying more traffic', () => {
  const weak = createGame({ seed: 11 }), strong = createGame({ seed: 11 });
  buyUpgrade(strong, 'spread');
  tick(weak, 90); tick(strong, 90);
  const a = getTransportStats(weak), b = getTransportStats(strong);
  assert.equal(a.departed, b.departed);
  assert.ok(b.carrying > a.carrying);
  assert.ok(b.seeded > a.seeded);
  assert.ok(getStats(strong).reached > getStats(weak).reached + 10);
});

test('a young local audience exports substantially less truth than a developed region at the same ability level', () => {
  let youngCarried = 0, developedCarried = 0, departures = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const young = createGame({ seed }), developed = createGame({ seed });
    for (const state of [young, developed]) buyUpgrade(state, 'spread');
    Object.assign(young.regions.find(region => region.id === 'europe'), { red: 96.4, exposed: 3.6, blue: 0 });
    Object.assign(developed.regions.find(region => region.id === 'europe'), { red: 0, exposed: 0, blue: 100 });
    tick(young, 30); tick(developed, 30);
    const outgoing = state => state.transportEvents.filter(event => event.type === 'departure' && event.from === 'europe');
    const a = outgoing(young), b = outgoing(developed);
    assert.equal(a.length, b.length);
    departures += a.length;
    youngCarried += a.filter(event => event.carryingTruth).length;
    developedCarried += b.filter(event => event.carryingTruth).length;
  }
  assert.ok(youngCarried < departures * .5);
  assert.ok(developedCarried > departures * .9);
  assert.ok(developedCarried > youngCarried * 2);
});

test('a dwindling audience cannot keep exporting through a fixed carrying-probability floor', () => {
  let remnant = 0, viable = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    for (const reach of [.3, 3.6]) {
      const state = createGame({ seed }); buyUpgrade(state, 'spread');
      Object.assign(state.regions.find(region => region.id === 'europe'), { red: 100 - reach, exposed: reach, blue: 0 });
      tick(state, 2);
      const carrying = state.transportEvents.find(event => event.type === 'departure' && event.time === 2).carryingTruth;
      if (carrying) { if (reach === .3) remnant++; else viable++; }
    }
  }
  assert.ok(remnant < 80);
  assert.ok(viable > 250 && viable > remnant * 5);
});

test('a real in-flight truth message gets its arrival before a low audience can be declared collapsed', () => {
  const state = createGame(); state.levels = { spread: 3, persuasion: 3, defense: 3 };
  tick(state, 480);
  const rescue = s => s.transit.active.find(trip => trip.channelId === 'press' && trip.carryingTruth && trip.departedAt >= 480 && trip.arrivesAt - s.time > 8 && trip.landingRoll < .98);
  advanceUntil(state, rescue, 600);
  const trip = rescue(state);
  // Preserve the real scheduled trip; isolate its chance to rescue a weakened
  // network instead of fabricating a guaranteed carrying message.
  state.transit.active = [trip]; state.transit.nextDeparture = Infinity;
  for (const region of state.regions) Object.assign(region, { red: 99.5, exposed: .3, blue: .2 });
  tick(state, 8.1);
  assert.equal(state.phase, 'playing'); assert.equal(state.collapseFor, 0);
  assert.ok(getStats(state).reached < 2 && getStats(state).truth < .5);
  const beforeArrival = state.regions.find(region => region.id === trip.to).exposed;
  tick(state, trip.arrivesAt - state.time);
  const arrival = state.transportEvents.find(event => event.tripId === trip.id && event.type === 'arrival');
  assert.equal(arrival.outcome, 'seeded'); assert.equal(arrival.seedAmount, 7.2);
  assert.ok(state.regions.find(region => region.id === trip.to).exposed > beforeArrival + 7);
  assert.equal(state.phase, 'playing');
});

test('public attacks cause actual intercepted arrivals, defense mitigates and clarification gradually restores passage', () => {
  const state = createGame(); buyUpgrade(state, 'spread'); tick(state, 120);
  state.points = 100; queueEvidence(state); publishEvidence(state); tick(state, 43);
  const from = state.event.regionIds[0], to = REGIONS.find(region => !state.event.regionIds.includes(region.id)).id;
  assert.equal(getTransportBlockChance(state, from, to), .75);
  buyUpgrade(state, 'defense');
  close(getTransportBlockChance(state, from, to), .75 * .72);
  tick(state, 30);
  assert.ok(getTransportStats(state).blocked > 0);
  assert.ok(state.transportEvents.some(event => event.type === 'blocked' && event.carryingTruth && event.seedAmount === 0));
  counterWithSource(state);
  assert.equal(state.event.resolved, false);
  tick(state, 24);
  close(getTransportBlockChance(state, from, to), .75 * .72 * .5);
  tick(state, 24);
  assert.equal(state.event.resolved, true);
  assert.equal(getTransportBlockChance(state, from, to), 0);
  const blocked = getTransportStats(state).blocked;
  tick(state, 50);
  assert.equal(getTransportStats(state).blocked, blocked);
  assert.equal('networkCoverage' in state, false);
});

test('transport events are bounded, first-contact history is durable, and population remains conserved', () => {
  const state = play();
  assert.ok(state.transportEvents.length <= 80);
  assert.equal(state.regions.filter(region => region.seeded).length, 6);
  assert.ok(state.regions.every(region => Number.isFinite(region.firstContactAt)));
  for (const region of state.regions) { close(region.red + region.exposed + region.blue, 100); assert.ok(region.red >= 0 && region.exposed >= 0 && region.blue >= 0); }
  const frozen = JSON.stringify(state); tick(state, 100);
  assert.equal(JSON.stringify(state), frozen);
});

test('six starts and varied seeds give a visible early breakthrough and a viable funded strategy', () => {
  for (const region of REGIONS) for (const seed of [1, 7, 23]) {
    const start = createGame({ regionId: region.id, seed }); buyUpgrade(start, 'spread');
    advanceUntil(start, state => getTransportStats(state).firstReached > 1, 60);
    const result = play({ regionId: region.id, seed });
    assert.equal(result.phase, 'won', `${region.id}: seed ${seed}`);
    assert.ok(result.time < 600);
  }
});

test('ignoring propagation investment cannot match a funded strategy even when evidence and counterplay are handled', () => {
  const inactive = play({ prepOrder: [], postOrder: [] }), prepared = play();
  assert.equal(inactive.phase, 'lost');
  assert.equal(prepared.phase, 'won');
  assert.ok(getStats(inactive).truth < 85);
});

function evidenceReadyGame(options = {}) {
  const state = createGame(options); buyUpgrade(state, 'spread'); tick(state, 35);
  state.coins = getResearchStatus(state).cost;
  assert.equal(startResearch(state, getResearchStatus(state).query).ok, true); tick(state, 12);
  assert.equal(state.evidence.length, 1);
  return state;
}

function departures(state, fromTime = 0, toTime = Infinity) {
  return state.transportEvents.filter(event => event.type === 'departure' && event.time >= fromTime && event.time < toTime);
}

test('six distinct home media lead their regions without closing cross-region routes', () => {
  assert.equal(CHANNELS.find(channel => channel.id === 'x').name, 'Z');
  assert.ok(CHANNELS.some(channel => channel.id === 'facecook'));
  for (const region of REGIONS) {
    assert.ok(CHANNELS.every(channel => REGION_MEDIA_WEIGHTS[region.id][channel.id] > 0));
    assert.equal(Object.values(REGION_MEDIA_WEIGHTS[region.id]).reduce((a, b) => a + b, 0), 100);
  }
  const counts = Object.fromEntries(REGIONS.map(region => [region.id, Object.fromEntries(CHANNELS.map(channel => [channel.id, 0]))]));
  let greenToAsia = 0, greenForeign = 0, faceToAsia = 0, faceForeign = 0;
  const destinations = Object.fromEntries(REGIONS.map(region => [region.id, new Set()]));
  for (let seed = 1; seed <= 1000; seed++) {
    const state = createGame({ seed }); tick(state, 59.9);
    for (const trip of departures(state, 0, 60)) {
      counts[trip.from][trip.channelId]++;
      destinations[trip.from].add(trip.to);
      if (trip.from !== 'asia' && trip.channelId === 'green') { greenForeign++; if (trip.to === 'asia') greenToAsia++; }
      if (trip.from !== 'asia' && trip.channelId === 'facecook') { faceForeign++; if (trip.to === 'asia') faceToAsia++; }
    }
  }
  for (const region of REGIONS) {
    const count = counts[region.id], total = Object.values(count).reduce((a, b) => a + b, 0);
    assert.equal(destinations[region.id].size, 5, `${region.id} can reach every other region`);
    assert.ok(Object.values(count).every(value => value > 0));
    const primary = REGION_PRIMARY_MEDIA[region.id];
    assert.equal(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0], primary, `${region.id} has its own common carrier`);
    assert.ok(count[primary] / total > .25 && count[primary] / total < .60, 'a home platform leads without monopolizing traffic');
    if (region.id === 'asia') {
      assert.ok((count.green + count.weibo) / total > .68);
      assert.ok(count.facecook < count.green && count.x < count.weibo);
    } else {
      assert.ok(count.green / total < .13);
    }
  }
  assert.ok(greenToAsia / greenForeign > .55);
  assert.ok(greenToAsia / greenForeign > faceToAsia / faceForeign * 6);
});

test('migration starts at 60, ends at 105, and adds real green cross-ocean departures without forcing truth', () => {
  let boosted = 0, ordinary = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const live = createGame({ seed, regionId: 'asia' }), control = createGame({ seed, regionId: 'asia' });
    // Suppress only this event in the control; both keep the same ambient network.
    control.mediaEvents.push({ id: 'migration', type: 'migration', startedAt: -100, endsAt: -55 });
    tick(live, 59.9); assert.equal(getMediaEvent(live), null); tick(live, .1);
    assert.equal(getMediaEvent(live).type, 'migration'); assert.equal(getMediaEvent(live).remaining, 45);
    tick(live, 45); tick(control, 105);
    assert.equal(getMediaEvent(live), null);
    const cross = state => departures(state, 60, 105).filter(trip => trip.channelId === 'green' && [trip.from, trip.to].sort().join('/') === 'asia/north_america');
    boosted += cross(live).length; ordinary += cross(control).length;
    for (const trip of cross(live)) { assert.equal(trip.eventId, 'migration'); assert.equal(trip.landingMultiplier, 1.15); }
  }
  assert.ok(boosted > ordinary * 2);
});

test('event effects are fixed at departure and survive only on the original in-flight message', () => {
  const state = createGame({ regionId: 'asia', seed: 1 }); buyUpgrade(state, 'spread'); tick(state, 104.9);
  const boosted = getTransports(state).find(trip => trip.eventId === 'migration' && trip.arrivesAt > 105);
  assert.ok(boosted);
  const before = { ...boosted }; tick(state, .2);
  assert.equal(getMediaEvent(state), null);
  const after = getTransports(state).find(trip => trip.id === boosted.id);
  assert.ok(after.progress > before.progress);
  for (const key of ['eventId', 'boostName', 'landingMultiplier', 'seedMultiplier', 'carryingTruth', 'from', 'to', 'arrivesAt']) assert.equal(after[key], before[key]);
  tick(state, boosted.arrivesAt - state.time);
  const arrival = state.transportEvents.find(event => event.tripId === boosted.id && event.type !== 'departure');
  assert.equal(arrival.eventId, 'migration');
  tick(state, 10);
  assert.ok(departures(state, 105).every(trip => trip.eventId !== 'migration'));
});

test('community notes require earned evidence and only boost Z landing amount on new departures', () => {
  const withoutEvidence = createGame(); tick(withoutEvidence, 200);
  assert.ok(!withoutEvidence.mediaEvents.some(event => event.type === 'notes'));
  assert.deepEqual(withoutEvidence.evidence, []);
  const state = evidenceReadyGame(); tick(state, 149.9 - state.time);
  assert.equal(getMediaEvent(state), null);
  const existing = getTransports(state).map(trip => ({ ...trip }));
  tick(state, .1);
  assert.equal(getMediaEvent(state).type, 'notes');
  assert.equal(getMediaEvent(state).endsAt, 190);
  for (const trip of getTransports(state).filter(trip => existing.some(old => old.id === trip.id))) assert.equal(trip.eventId, existing.find(old => old.id === trip.id).eventId);
  tick(state, 40);
  const boosted = state.transportEvents.filter(event => event.eventId === 'notes');
  assert.ok(boosted.length > 0 && boosted.every(event => event.channelId === 'x' && event.seedMultiplier === 1.5));
  assert.ok(boosted.some(event => event.outcome === 'seeded' && Math.abs(event.seedAmount - 5.4) < 1e-7));
  assert.equal(state.evidence.length, 1);
  assert.equal(getMediaEvent(state), null);
});

test('FaceCook outage pauses its new departures while old messages finish and other media keep moving', () => {
  const state = createGame({ seed: 5 }); tick(state, 239.9);
  const inFlight = getTransports(state).filter(trip => trip.channelId === 'facecook');
  assert.ok(inFlight.length > 0);
  tick(state, .1);
  assert.equal(getMediaEvent(state).type, 'outage');
  assert.equal(getMediaEvent(state).endsAt, 264);
  for (const old of inFlight) {
    if (old.arrivesAt <= 240) assert.ok(state.transportEvents.some(event => event.tripId === old.id && event.type === 'arrival'));
    else assert.equal(getTransports(state).find(trip => trip.id === old.id).carryingTruth, old.carryingTruth);
  }
  tick(state, 24);
  assert.equal(getMediaEvent(state), null);
  const during = departures(state, 240, 264);
  assert.ok(during.length > 0 && during.every(trip => trip.channelId !== 'facecook'));
  assert.ok(getTransportStats(state).suspended > 0);
  for (const old of inFlight) assert.ok(state.transportEvents.some(event => event.tripId === old.id && event.type !== 'departure'));
  const suspended = getTransportStats(state).suspended;
  tick(state, 36);
  assert.ok(departures(state, 264).some(trip => trip.channelId === 'facecook'));
  assert.equal(getTransportStats(state).suspended, suspended);
});

test('outage waits for unresolved counterplay and media events never overlap or trigger twice', () => {
  const state = createGame(); buyUpgrade(state, 'spread'); tick(state, 230);
  queueEvidence(state); assert.equal(publishEvidence(state).ok, true); tick(state, 10);
  assert.ok(!state.mediaEvents.some(event => event.type === 'outage'));
  assert.equal(counterWithSource(state).ok, true); tick(state, 60);
  assert.equal(state.event.resolved, true);
  tick(state, 20); // The published evidence hotspot finishes before the queued outage.
  assert.equal(getMediaEvent(state).type, 'outage');
  assert.equal(getMediaEvent(state).startedAt, 320);
  const queued = createGame(); tick(queued, 245);
  assert.equal(getMediaEvent(queued).type, 'outage');
  queued.coins = getResearchStatus(queued).cost;
  assert.equal(startResearch(queued, getResearchStatus(queued).query).ok, true); tick(queued, 12);
  assert.equal(queued.evidence.length, 1);
  assert.equal(getMediaEvent(queued).type, 'outage');
  tick(queued, 7);
  assert.equal(getMediaEvent(queued).type, 'notes');
  assert.equal(getMediaEvent(queued).startedAt, 264);
  tick(queued, 200);
  assert.equal(queued.mediaEvents.length, 3);
  assert.equal(new Set(queued.mediaEvents.map(event => event.type)).size, 3);
  queued.mediaEvents.forEach((event, i) => { if (i) assert.ok(event.startedAt >= queued.mediaEvents[i - 1].endsAt); });
});

test('hotspots are reproducible, pause with game time and cannot create truth without a carried seed', () => {
  const a = evidenceReadyGame({ seed: 23 }), b = evidenceReadyGame({ seed: 23 });
  for (const state of [a, b]) {
    state.regions.forEach(region => { region.red = 100; region.exposed = 0; region.blue = 0; region.seeded = false; region.firstContactAt = null; });
    state.transit.active.forEach(trip => { trip.carryingTruth = false; });
  }
  const initialPoints = a.points, initialTime = a.time;
  tick(a, 100 - a.time);
  const paused = JSON.stringify(a), remaining = getMediaEvent(a).remaining;
  const projection = getMediaEvent(a); projection.remaining = 0;
  assert.equal(getMediaEvent(a).remaining, remaining);
  assert.equal(JSON.stringify(a), paused);
  tick(a, 300 - a.time);
  while (b.time < 300) tick(b, Math.min(1, 300 - b.time));
  assert.deepEqual(a.mediaEvents, b.mediaEvents);
  assert.deepEqual(a.transportEvents, b.transportEvents);
  assert.equal(a.mediaEvents.length, 3);
  assert.equal(getStats(a).reached, 0);
  close(a.points - initialPoints, (a.time - initialTime) * .16);
  assert.equal(getTransportStats(a).seeded, getTransportStats(b).seeded);
  assert.ok(a.transportEvents.every(event => !event.carryingTruth && event.seedAmount === 0));
});
