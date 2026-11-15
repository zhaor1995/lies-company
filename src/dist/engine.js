import { RESEARCH_ROUNDS, RESEARCH_EVENTS } from './research-content.js';
import { INVESTIGATION_EFFECTS, ASSESSMENT_LABELS, getMaterialEffect, snapshotFinalVerdict } from './investigation-contract.js';
import { CHANNELS, REGION_MEDIA_WEIGHTS } from './media-network.js';
import { worldRemaining } from './world-time.js';
export { CHANNELS, REGION_MEDIA_WEIGHTS, REGION_PRIMARY_MEDIA } from './media-network.js';

// Equal-size fictional regions. Rates and population are game mechanics, not
// demographic estimates or a claim about real-world information spreading.
export const REGIONS = Object.freeze([
  { id: 'north_america', name: '北美洲', x: 20, y: 31, trait: '跨洋起步', description: '从这里建立第一批支持者，再用媒体接力走向世界。', neighbors: ['south_america', 'europe', 'asia'] },
  { id: 'south_america', name: '南美洲', x: 30, y: 69, trait: '南方起点', description: '从南方铺开社群，等待媒体带来第一批跨区触达。', neighbors: ['north_america', 'africa'] },
  { id: 'europe', name: '欧洲', x: 50, y: 28, trait: '推荐起点', description: '从这里开始第一局，观察不同媒体怎样把真相送往各地。', neighbors: ['north_america', 'africa', 'asia'] },
  { id: 'africa', name: '非洲', x: 52, y: 59, trait: '南北接力', description: '先建立本地支持，让已有媒体交通把真相带往外地。', neighbors: ['south_america', 'europe', 'asia'] },
  { id: 'asia', name: '亚洲', x: 73, y: 34, trait: '东方起点', description: '从东方扩散，真相将随各类媒体交通扩散。', neighbors: ['north_america', 'europe', 'africa', 'oceania'] },
  { id: 'oceania', name: '大洋洲', x: 84, y: 77, trait: '远洋起点', description: '从远洋出发，各种媒体本来就在跨区往来。', neighbors: ['asia'] },
]);

export const UPGRADE_DEFS = Object.freeze({
  spread: { key: 'spread', name: '传播能力', description: '让真相更容易被媒体带走、在外地落地，并加快已有地区的传播。', costs: [10, 24, 72], levels: ['易转发图文', '跨圈层表达', '多语改写'], effect: ['本地触达 +60% · 跨区 ↑', '本地触达 +56% · 跨区 ↑', '本地触达 +40% · 跨区 ↑'] },
  persuasion: { key: 'persuasion', name: '说服', description: '把已经接触澄清的人，变成真相的传播者。', costs: [10, 24, 72], levels: ['一句话澄清', '证据可视化', '共识形成'], effect: ['接受真相速度 +80%', '接受真相速度 +67%', '接受真相速度 +50%'] },
  defense: { key: 'defense', name: '稳住阵地', description: '减少反扑流失与转载拦截，同时加快正在进行的澄清。', costs: [10, 18, 40], levels: ['来源留档', '交叉核验', '公众免疫'], effect: ['反扑损失 −28% · 澄清速度 +25%', '反扑损失 −50% · 澄清速度 +50%', '反扑损失 −65% · 澄清速度 +75%'] },
});

export const RULES = Object.freeze({
  winTruth: 99,
  pacingStart: 300,
  pacingRamp: 180,
  collapseReach: 2,
  collapseTruth: 0.5,
  collapseGrace: 8,
  publicationCost: 0,
  followupPublicationConversion: 0.10,
  counterCost: 12,
  counterDuration: 60,
  counterDefenseSpeed: 0.25,
  counterEvidenceProgress: 15,
  counterRecoveryDuration: 28,
  counterReward: 8,
  evidenceBonusPerRound: 0.18,
  evidenceArrivalConversion: 0.03,
  income: 0.16,
  researchCosts: Object.freeze([18, 24, 28, 32, 36]),
  coinExchangeRate: 6,
  coinFirstAt: 6,
  coinIntervalMin: 8,
  coinIntervalMax: 11,
  coinAdvanceIntervalMultiplier: 2,
  coinCashoutIntervalMin: 20,
  coinCashoutIntervalMax: 28,
  coinMaxDrops: 3,
  worldPopulation: 7_200_000_000,
});

const LOCAL = [0.028, 0.0448, 0.070, 0.098];
const CARRY = [0.5, 1, 1.25, 1.5];
const LAND = [0.72, 0.88, 0.94, 0.98];
const SEED_AMOUNT = [1.8, 3.6, 5.4, 7.2];
const DEPARTURE_INTERVAL = 2;
const CONVERT = [0.00028, 0.000505, 0.000842, 0.001262];
const DEFENSE = [1, 0.72, 0.50, 0.35];

// Each publication commits one wave. A live fight is never replaced by a
// newer publication, and every wave needs its own clarification response.
export const ENEMY_WAVES = Object.freeze([
  { name: '截图围攻', targets: 2, warning: 42, duration: 60, strength: 1, hit: .36 },
  { name: '断章取义', targets: 3, warning: 36, duration: 66, strength: 1.4, hit: .42 },
  { name: '热搜围堵', targets: 4, warning: 30, duration: 72, strength: 1.9, hit: .48 },
  { name: '全网封锁', targets: 5, warning: 24, duration: 78, strength: 2.5, hit: .54 },
  { name: '终局反扑', targets: 6, warning: 18, duration: 84, strength: 3.2, hit: .60 },
].map(Object.freeze));
const MILESTONES = [6, 12, 25, 45, 70, 90];
const STEP = 0.1;
const EPS = 1e-7;
export function getEvidenceMaterial(state, id) {
  if (!id) return undefined;
  if (state.researchMode === 'live') return state.researchResults.flatMap(result => result.materials || []).find(material => material.id === id);
  return RESEARCH_ROUNDS.flatMap(definition => definition.materials).find(material => material.id === id);
}
const normalizeQuery = query => typeof query === 'string' ? query.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '') : '';
const round = value => Math.round(value * 1e7) / 1e7;
const fail = reason => ({ ok: false, reason });

function log(state, type, title, detail = '') {
  state.log.push({ id: ++state.logSequence, time: state.time, type, title, detail });
}

export function createGame({ regionId = 'europe', seed = 1, researchMode = 'demo', claim = '从月球上，能用肉眼看见长城。', investigationMode = null } = {}) {
  const selected = REGIONS.find(region => region.id === regionId) || REGIONS[2];
  const state = {
    phase: 'playing', operationPhase: 'preparing', time: 0, points: 24, seed, startRegionId: selected.id,
    claim: typeof claim === 'string' ? [...claim.trim()].slice(0, 160).join('') : '从月球上，能用肉眼看见长城。',
    investigation: researchMode === 'live' && investigationMode === 'agent' ? { sessionId: null, leads: [], planError: null, refresh: null, refreshError: null } : null,
    coins: 0, coinDrops: [],
    coinEconomy: { rng: ((Number(seed) >>> 0) ^ 0x9e3779b9) >>> 0, sequence: 0, nextAt: RULES.coinFirstAt, activity: Object.fromEntries(REGIONS.map(region => [region.id, 0])), generated: 0, collected: 0, spent: 0, refreshSpent: 0, converted: 0, pointsEarned: 0, clicks: 0, researchPaid: 0 },
    regions: REGIONS.map(region => ({ id: region.id, red: region.id === selected.id ? 80 : 100, exposed: region.id === selected.id ? 12 : 0, blue: region.id === selected.id ? 8 : 0, seeded: region.id === selected.id, firstContactAt: region.id === selected.id ? 0 : null })),
    levels: { spread: 0, persuasion: 0, defense: 0 },
    transit: { active: [], sequence: 0, nextDeparture: 2, departureIndex: 0, rng: (Number(seed) >>> 0) || 1, stats: { departed: 0, carrying: 0, arrived: 0, seeded: 0, blocked: 0, missed: 0, suspended: 0 } },
    transportEvents: [], transportSequence: 0,
    mediaEvents: [], evidenceEvents: [],
    counter: 0, counterActive: false,
    evidence: [], research: null, researchedIds: [], researchResults: [], researchMode: researchMode === 'live' ? 'live' : 'demo', researchError: null,
    publications: [], finalReview: null,
    specialization: null, specializationAvailable: false,
    event: null, eventTriggered: false, enemyWaves: [], recoveryUntil: 0, milestones: [],
    log: [], logSequence: 0, truthRate: 0, enemyLossRate: 0, worldLossRate: 0,
    collapseFor: 0, defeatReason: null, victoryAt: null, victoryResearchId: null,
    totals: { spent: 0, earned: 24, refunded: 0, relapsed: 0, reclaimed: 0 },
  };
  initializeTraffic(state);
  log(state, 'start', `从${selected.name}铺开传播网络`, '先让更多人接触澄清。公布实锤会引来反扑，时机由你决定。');
  return state;
}

export function upgradeCost(state, key) {
  const definition = UPGRADE_DEFS[key];
  return definition && state.levels[key] < 3 ? definition.costs[state.levels[key]] : null;
}


function coinRandom(state) {
  const economy = state.coinEconomy;
  economy.rng = (Math.imul(economy.rng, 1664525) + 1013904223) >>> 0;
  return economy.rng / 4294967296;
}

function coinFunding(state) {
  const economy = state.coinEconomy, cashoutActive = economy.researchPaid >= RESEARCH_ROUNDS.length;
  let promotedRounds = 0;
  while (state.researchResults[promotedRounds]?.promotedId) promotedRounds++;
  const savingNextRound = !cashoutActive && promotedRounds < RESEARCH_ROUNDS.length - 1
    && Boolean(state.research || state.researchResults[promotedRounds]);
  const fundingRound = Math.min(promotedRounds + Number(savingNextRound), RESEARCH_ROUNDS.length - 1);
  const fundingCap = cashoutActive ? null : RULES.researchCosts[fundingRound];
  // Starting a search opens one round of advance funding. Payments, refunds
  // and unclaimed drops all count, so retrying cannot open the same budget twice.
  const budget = RULES.researchCosts.slice(0, fundingRound + 1).reduce((sum, cost) => sum + cost, 0);
  const onMap = state.coinDrops.reduce((sum, drop) => sum + drop.value, 0);
  // Only completed refreshes open room to earn back their cost. Pending or
  // refunded refreshes must not mint a second copy of that gold.
  const fundingRemaining = cashoutActive ? null : Math.max(0, budget - economy.spent + (economy.refreshSpent || 0) - state.coins - onMap);
  const allActionsFinished = cashoutActive && Object.values(state.levels).every(level => level >= 3) && getCampaignStatus(state).complete;
  return { cashoutActive, savingNextRound, fundingRound, fundingCap, fundingRemaining, fundingPaused: !cashoutActive && fundingRemaining === 0, allActionsFinished };
}

/** Gold is funded by actual local propagation and successful truth arrivals.
 * Its separate random stream never changes routes or landing probabilities. */
function updateCoins(state) {
  const economy = state.coinEconomy;
  if (state.time + EPS < economy.nextAt) return;
  const funding = coinFunding(state);
  const candidates = state.regions.filter(region => region.blue + region.exposed > EPS && economy.activity[region.id] > EPS);
  if (candidates.length && !funding.fundingPaused && !funding.allActionsFinished) {
    let weight = coinRandom(state) * candidates.reduce((sum, region) => sum + Math.sqrt(economy.activity[region.id]), 0);
    let source = candidates.at(-1);
    for (const region of candidates) { weight -= Math.sqrt(economy.activity[region.id]); if (weight < 0) { source = region; break; } }
    const rolledJackpot = coinRandom(state) < .15;
    const rolledValue = funding.cashoutActive ? (rolledJackpot ? 12 : 6) : rolledJackpot ? 6 : 3 + Math.floor(coinRandom(state) * 2);
    const value = funding.cashoutActive ? rolledValue : Math.min(rolledValue, funding.fundingRemaining);
    const jackpot = rolledJackpot && value === rolledValue;
    let drop = state.coinDrops.find(item => item.regionId === source.id);
    // Never expire or discard missed clicks. At the visual cap, another pile
    // holds this income until the player is ready to collect it.
    if (!drop && state.coinDrops.length >= RULES.coinMaxDrops) drop = state.coinDrops.reduce((smallest, item) => item.value < smallest.value ? item : smallest);
    if (drop) { drop.value += value; drop.jackpot ||= jackpot; }
    else state.coinDrops.push({ id: ++economy.sequence, regionId: source.id, value, jackpot, createdAt: round(state.time) });
    economy.generated += value;
  }
  for (const id of Object.keys(economy.activity)) economy.activity[id] = 0;
  const pacingRound = funding.fundingRound - Number(funding.savingNextRound);
  const minimum = funding.cashoutActive ? RULES.coinCashoutIntervalMin : Math.max(2, RULES.coinIntervalMin - pacingRound * 2.25);
  const maximum = funding.cashoutActive ? RULES.coinCashoutIntervalMax : Math.max(5, RULES.coinIntervalMax - pacingRound * 2.25);
  const interval = (minimum + coinRandom(state) * (maximum - minimum)) * (funding.savingNextRound ? RULES.coinAdvanceIntervalMultiplier : 1);
  economy.nextAt = round(state.time + interval);
}

function cashoutCoins(state) {
  if (state.coinEconomy.researchPaid < RESEARCH_ROUNDS.length) return 0;
  const points = Math.floor(state.coins / RULES.coinExchangeRate);
  if (points > 0) {
    const spent = points * RULES.coinExchangeRate;
    state.coins -= spent;
    state.coinEconomy.converted += spent;
    state.coinEconomy.pointsEarned += points;
    state.points += points;
    state.totals.earned += points;
  }
  return points;
}

export function getCoinEconomy(state) {
  const economy = state.coinEconomy;
  return { balance: state.coins, generated: economy.generated, collected: economy.collected, spent: economy.spent, converted: economy.converted, pointsEarned: economy.pointsEarned, clicks: economy.clicks, ...coinFunding(state), exchangeRate: RULES.coinExchangeRate, nextCost: RULES.researchCosts[economy.researchPaid] ?? null };
}

export function collectCoin(state, id) {
  if (state.phase !== 'playing') return fail('本局已结束');
  const index = state.coinDrops.findIndex(drop => drop.id === id);
  if (index < 0) return fail('这笔流量收益已领取');
  const [drop] = state.coinDrops.splice(index, 1);
  state.coins += drop.value;
  state.coinEconomy.collected += drop.value;
  state.coinEconomy.clicks++;
  const pointsEarned = cashoutCoins(state);
  return { ok: true, value: drop.value, pointsEarned, regionId: drop.regionId, jackpot: drop.jackpot, cashoutActive: state.coinEconomy.researchPaid >= RESEARCH_ROUNDS.length };
}

function trafficRandom(state) {
  state.transit.rng = (Math.imul(state.transit.rng, 1664525) + 1013904223) >>> 0;
  return state.transit.rng / 4294967296;
}

function weightedTrafficChoice(state, items, weight) {
  let choice = trafficRandom(state) * items.reduce((sum, item) => sum + weight(item), 0);
  for (const item of items) { choice -= weight(item); if (choice < 0) return item; }
  return items.at(-1);
}

export function getMediaEvent(state) {
  const event = state.mediaEvents.find(item => item.startedAt <= state.time + EPS && item.endsAt > state.time + EPS);
  return event ? { ...event, remaining: Math.max(0, event.endsAt - state.time) } : null;
}

function updateMediaEvents(state) {
  if (getMediaEvent(state) || getEvidenceEvent(state)) return;
  const seen = type => state.mediaEvents.some(event => event.type === type);
  let type, duration;
  if (!seen('migration') && state.time + EPS >= 60) { type = 'migration'; duration = 45; }
  else if (!seen('notes') && state.time + EPS >= 150 && state.evidence.length > 0) { type = 'notes'; duration = 40; }
  else if (!seen('outage') && state.time + EPS >= 240 && !(state.event && !state.event.resolved)) { type = 'outage'; duration = 24; }
  if (!type) return;
  const startedAt = round(state.time);
  state.mediaEvents.push({ id: type, type, startedAt, endsAt: round(startedAt + duration) });
}

export function getEvidenceEvent(state) {
  const event = state.evidenceEvents.find(item => item.startedAt <= state.time + EPS && item.endsAt > state.time + EPS);
  return event ? { ...event, remaining: Math.max(0, event.endsAt - state.time) } : null;
}

export function getEvidenceBonuses(state) {
  let spreadBonus = 0, persuasionBonus = 0, arrivalConversion = 0;
  for (const result of state.researchResults) {
    const material = getEvidenceMaterial(state, result.promotedId);
    if (material) {
      const effect = getMaterialEffect(material);
      spreadBonus += effect.spreadBonus;
      persuasionBonus += effect.persuasionBonus;
    }
    if (material?.id === 'collage-spread') arrivalConversion = RULES.evidenceArrivalConversion;
  }
  const activeEvent = getEvidenceEvent(state);
  if (activeEvent) {
    spreadBonus += activeEvent.spreadBonus;
    persuasionBonus += activeEvent.persuasionBonus;
    // Only this promoted material's optional persuasion bonus is reduced.
    // Neither the earned evidence count nor purchased levels can be revoked.
    const activeMaterial = getEvidenceMaterial(state, activeEvent.evidenceId);
    if (activeMaterial?.focus === 'persuasion') persuasionBonus -= Math.min(getMaterialEffect(activeMaterial).persuasionBonus, activeEvent.persuasionPenalty);
  }
  return { spreadBonus, persuasionBonus, spreadMultiplier: 1 + spreadBonus, persuasionMultiplier: 1 + persuasionBonus, arrivalConversion, activeEvent };
}

function updateEvidenceEvents(state) {
  if (getEvidenceEvent(state) || getMediaEvent(state)) return;
  const result = state.researchResults.find(item => item.promotedId && state.time + EPS >= item.promotedAt + 45 && !state.evidenceEvents.some(event => event.roundId === item.roundId));
  if (!result) return;
  const material = getEvidenceMaterial(state, result.promotedId), definition = RESEARCH_EVENTS[material?.eventId];
  if (!definition) return;
  const effect = definition.effectKey || (material.focus === 'persuasion' ? 'controversy' : 'spread');
  const startedAt = round(state.time);
  state.evidenceEvents.push({
    id: `${result.roundId}:${material.eventId}`, eventId: material.eventId, roundId: result.roundId, evidenceId: material.id,
    startedAt, endsAt: round(startedAt + 45),
    spreadBonus: effect === 'controversy' ? .80 : effect === 'spread' ? .50 : 0,
    persuasionBonus: effect === 'persuasion' ? .35 : 0,
    persuasionPenalty: effect === 'controversy' ? .10 : 0,
  });
  log(state, 'evidence-event', definition.title, definition.gameEffectHint);
}

function transportEvent(state, trip, type, outcome, seedAmount = 0, firstSeed = false, convertedAmount = 0) {
  state.transportEvents.push({ id: ++state.transportSequence, type, outcome, time: type === 'departure' ? trip.departedAt : trip.arrivesAt, tripId: trip.id, channelId: trip.channelId, from: trip.from, to: trip.to, carryingTruth: trip.carryingTruth, eventId: trip.eventId, boostName: trip.boostName, landingMultiplier: trip.landingMultiplier, seedMultiplier: trip.seedMultiplier, seedAmount, firstSeed, convertedAmount });
  if (state.transportEvents.length > 80) state.transportEvents.splice(0, state.transportEvents.length - 80);
}

function initializeTraffic(state) {
  // These ordinary messages were already in transit when the player joined.
  // Their origins contain no truth, and they can never seed a destination.
  const others = state.regions.filter(region => region.id !== state.startRegionId);
  for (let i = 0; i < 2; i++) {
    const origin = others[i], channel = [...CHANNELS].sort((a, b) => REGION_MEDIA_WEIGHTS[origin.id][b.id] - REGION_MEDIA_WEIGHTS[origin.id][a.id])[0], departedAt = -4 + i * 2;
    const trip = { id: ++state.transit.sequence, channelId: channel.id, from: origin.id, to: others[(i + 2) % others.length].id, departedAt, arrivesAt: departedAt + channel.travelTime, carryingTruth: false, landingRoll: 1, blockRoll: 1, eventId: null, boostName: '', landingMultiplier: 1, seedMultiplier: 1 };
    state.transit.active.push(trip); state.transit.stats.departed++;
    transportEvent(state, trip, 'departure', 'ordinary');
  }
}

/** Traffic projections are snapshots; reading them cannot advance a trip. */
export function getTransports(state) {
  return state.transit.active.map(({ landingRoll, blockRoll, ...trip }) => ({ ...trip, progress: Math.max(0, Math.min(1, (state.time - trip.departedAt) / (trip.arrivesAt - trip.departedAt))) }));
}

export function getTransportStats(state) {
  const seededRegions = state.regions.filter(region => region.seeded).length;
  return { ...state.transit.stats, firstReached: seededRegions, seededRegions, active: state.transit.active.length };
}

/** The world heats up to a cap, but pressure is determined by the live board.
 * More support reverses the pressure; elapsed time can never decide a loss. */
export function getPacing(state) {
  const stats = getStats(state), elapsed = state.time - RULES.pacingStart;
  const heat = elapsed > EPS ? Math.min(1, elapsed / RULES.pacingRamp) : 0;
  return {
    stage: heat === 0 ? 'opening' : heat < 1 ? 'heating' : 'heated',
    heat, populationMultiplier: 1 + 0.5 * heat,
    pressureFactor: heat * Math.max(0, 1 - stats.truth / 85),
    networkCritical: heat > 0 && stats.reached < 10 && stats.truth < 3,
  };
}

export function getTransportBlockChance(state, from, to) {
  const event = state.event;
  if (!event || event.resolved || !event.regionIds.some(id => id === from || id === to)) return 0;
  return (event.stage === 'warning' ? 0.35 : 0.75) * DEFENSE[state.levels.defense] * counterResistance(event);
}

function departTransport(state, departedAt) {
  const start = REGIONS.findIndex(region => region.id === state.startRegionId);
  const source = state.regions[(start + state.transit.departureIndex++) % REGIONS.length];
  const mediaEvent = getMediaEvent(state), migrating = mediaEvent?.type === 'migration';
  const migrationOrigin = source.id === 'asia' || source.id === 'north_america';
  const channel = weightedTrafficChoice(state, CHANNELS, item => REGION_MEDIA_WEIGHTS[source.id][item.id] * (migrating && migrationOrigin && item.id === 'green' ? 3 : 1));
  // An outage cancels that carrier's scheduled departure. It neither deletes
  // in-flight messages nor silently replaces them with another platform.
  if (mediaEvent?.type === 'outage' && channel.id === 'facecook') { state.transit.stats.suspended++; return; }
  const destinations = state.regions.filter(region => region.id !== source.id);
  const counterpart = source.id === 'asia' ? 'north_america' : source.id === 'north_america' ? 'asia' : null;
  const target = weightedTrafficChoice(state, destinations, item => REGION_MEDIA_WEIGHTS[item.id][channel.id] * (migrating && channel.id === 'green' && item.id === counterpart ? 4 : 1));
  const reached = source.blue + source.exposed;
  // A newly planted audience is still a weak exporter. Propagation ability
  // improves carriage, but cannot substitute for local audience growth.
  const carryChance = reached > EPS ? Math.min(.98, CARRY[state.levels.spread] * (.15 + .85 * Math.sqrt(reached / 100)) * Math.min(1, reached / 3) * getEvidenceBonuses(state).spreadMultiplier) : 0;
  const migrationBoost = migrating && channel.id === 'green' && target.id === counterpart;
  const notesBoost = mediaEvent?.type === 'notes' && channel.id === 'x';
  const trip = { id: ++state.transit.sequence, channelId: channel.id, from: source.id, to: target.id, departedAt, arrivesAt: departedAt + channel.travelTime, carryingTruth: trafficRandom(state) < carryChance, landingRoll: trafficRandom(state), blockRoll: trafficRandom(state), eventId: migrationBoost || notesBoost ? mediaEvent.id : null, boostName: migrationBoost ? '跨洋串门 · 更易落地' : notesBoost ? '证据笔记 · 落地 ×1.5' : '', landingMultiplier: migrationBoost ? 1.15 : 1, seedMultiplier: notesBoost ? 1.5 : 1 };
  state.transit.active.push(trip); state.transit.stats.departed++;
  if (trip.carryingTruth) state.transit.stats.carrying++;
  transportEvent(state, trip, 'departure', trip.carryingTruth ? 'carrying' : 'ordinary');
}

function arriveTransport(state, trip) {
  state.transit.stats.arrived++;
  if (!trip.carryingTruth) { transportEvent(state, trip, 'arrival', 'ordinary'); return; }
  if (trip.blockRoll < getTransportBlockChance(state, trip.from, trip.to)) {
    state.transit.stats.blocked++; transportEvent(state, trip, 'blocked', 'blocked'); return;
  }
  if (trip.landingRoll >= Math.min(.99, LAND[state.levels.spread] * trip.landingMultiplier)) {
    state.transit.stats.missed++; transportEvent(state, trip, 'arrival', 'missed'); return;
  }
  const target = state.regions.find(region => region.id === trip.to);
  state.coinEconomy.activity[target.id] += 1;
  // Repeated, successful delivery can convince an audience that already heard
  // the claim. It cannot convert people newly seeded by this same arrival.
  const converted = target.exposed * getEvidenceBonuses(state).arrivalConversion;
  target.exposed -= converted; target.blue += converted;
  const amount = Math.min(target.red, SEED_AMOUNT[state.levels.spread] * trip.seedMultiplier);
  if (amount <= EPS) { transportEvent(state, trip, 'arrival', converted > EPS ? 'reinforced' : 'saturated', 0, false, converted); return; }
  const firstSeed = !target.seeded;
  target.red -= amount; target.exposed += amount;
  target.seeded = true;
  if (firstSeed) target.firstContactAt = trip.arrivesAt;
  state.transit.stats.seeded++;
  transportEvent(state, trip, firstSeed ? 'first-seed' : 'arrival', 'seeded', amount, firstSeed, converted);
}

function updateTransports(state) {
  // Ordered event times keep departure snapshots and arrival causes explicit.
  while (true) {
    const arrival = [...state.transit.active].sort((a, b) => a.arrivesAt - b.arrivesAt || a.id - b.id)[0];
    const nextArrival = arrival?.arrivesAt ?? Infinity;
    if (Math.min(nextArrival, state.transit.nextDeparture) > state.time + EPS) break;
    if (nextArrival <= state.transit.nextDeparture) {
      state.transit.active = state.transit.active.filter(trip => trip.id !== arrival.id);
      arriveTransport(state, arrival);
    } else {
      const departure = state.transit.nextDeparture;
      state.transit.nextDeparture = round(departure + DEPARTURE_INTERVAL);
      departTransport(state, departure);
    }
  }
}

export function buyUpgrade(state, key) {
  if (state.phase !== 'playing') return fail('本局已结束');
  if (!UPGRADE_DEFS[key]) return fail('未知进化方向');
  const cost = upgradeCost(state, key);
  if (cost == null) return fail('已达到最高等级');
  if (state.points + EPS < cost) return fail('行动点不足');
  state.points = Math.max(0, state.points - cost);
  state.totals.spent += cost;
  const level = ++state.levels[key];
  log(state, 'upgrade', `${UPGRADE_DEFS[key].levels[level - 1]} · Lv.${level}`, UPGRADE_DEFS[key].effect[level - 1]);
  Object.assign(state.log.at(-1), { upgradeKey: key, level });
  return { ok: true };
}

// Retained only so older clients fail explicitly instead of silently buying a
// removed power. The redesign replaces specialization with one public launch.
export function chooseSpecialization() {
  return fail('高阶专精已替换为公布实锤');
}

/** The recommendation is fixed when the investigation completes. Reading or
 * saving the result never changes which evidence will be published. */
export function getSelectedEvidence(state, result) {
  return getEvidenceMaterial(state, result?.selectedId || result?.promotedId);
}

export function getPendingEvidence(state) {
  return getSelectedEvidence(state, state.researchResults.find(result => !result.promotedId));
}

function selectResearchEvidence(state, result) {
  const materials = result.evidenceIds.map(id => getEvidenceMaterial(state, id)).filter(Boolean);
  const recommended = materials.find(material => material.id === result.recommendation?.materialId);
  const stats = getStats(state);
  const focus = stats.reached < 65 ? 'spread' : 'persuasion';
  result.selectedId = (recommended || materials.find(material => material.focus === focus) || materials[0])?.id;
}

export function getPublishPreview(state) {
  const stats = getStats(state), result = state.researchResults.find(item => !item.promotedId);
  const material = getSelectedEvidence(state, result), firstPublication = state.publications.length === 0;
  const conversionFraction = firstPublication
    ? Math.min(0.68, 0.35 + 0.08 * state.levels.persuasion + 0.06 * state.evidence.length)
    : RULES.followupPublicationConversion;
  const gain = material ? stats.exposed * conversionFraction : 0;
  let blockedReason = '';
  if (state.phase !== 'playing') blockedReason = '本局已结束';
  else if (!material) blockedReason = state.research ? '正在查证，材料整理好后即可公布' : '先寻找一份新证据，再公布实锤';
  const isolated = state.regions.filter(region => region.exposed + region.blue < 15).length;
  const waveNumber = state.publications.length + 1;
  const warning = `公布将引来第 ${waveNumber} / ${ENEMY_WAVES.length} 波反扑：${ENEMY_WAVES[waveNumber - 1]?.name || '终局反扑'}。${getCounterStatus(state).active ? '当前澄清推进 15%，下一波随后来袭。' : '提前稳住阵地，准备发起澄清。'}`;
  return { available: !blockedReason, cost: 0, reached: stats.reached, gain, conversionFraction, blockedReason, warning,
    isolatedRegions: isolated, roundId: result?.roundId || null, evidenceId: material?.id || null,
    title: material?.insight?.headline || material?.title || '', material, firstPublication, waveNumber };
}

export function publishEvidence(state) {
  const preview = getPublishPreview(state);
  if (!preview.available) return fail(preview.blockedReason);
  const result = state.researchResults.find(item => item.roundId === preview.roundId);
  result.promotedId = preview.evidenceId;
  result.promotedAt = result.publishedAt = round(state.time);
  state.operationPhase = 'public';
  for (const region of state.regions) {
    const converted = region.exposed * preview.conversionFraction;
    region.exposed -= converted;
    region.blue += converted;
  }
  const counterProgressGain = preview.firstPublication ? 0 : reinforceCounter(state);
  result.counterProgressGain = counterProgressGain;
  const publication = { time: round(state.time), gain: preview.gain, reached: preview.reached, evidenceCount: state.evidence.length,
    roundId: result.roundId, evidenceId: preview.evidenceId, title: preview.title, firstPublication: preview.firstPublication, counterProgressGain, waveNumber: preview.waveNumber };
  state.publications.push(publication);
  const decisive = getStats(state).truth + EPS >= RULES.winTruth;
  log(state, 'publication', `实锤公布：${preview.title}`,
    `支持率 +${preview.gain.toFixed(1)}%；${getMaterialEffect(preview.material).label}。${decisive ? `支持率达到 ${RULES.winTruth}%，胜利已锁定。` : preview.firstPublication
      ? '说服速度提升至准备期的 4 倍；对手开始组织反扑。'
      : `第 ${preview.waveNumber} 波反扑即将加入。${counterProgressGain ? `当前澄清再推进 ${counterProgressGain.toFixed(0)}%。` : ''}`}`);
  Object.assign(state.log.at(-1), { roundId: result.roundId, evidenceId: preview.evidenceId });
  awardMilestones(state);
  checkOutcome(state);
  if (state.phase === 'playing') queueEnemyWave(state, publication);
  return { ok: true, ...publication, material: preview.material };
}

export function getResearchStatus(state) {
  const pending = state.researchResults.find(result => !result.promotedId);
  const index = pending ? RESEARCH_ROUNDS.findIndex(item => item.id === pending.roundId) : state.evidence.length;
  const definition = RESEARCH_ROUNDS[index] || null;
  const previous = index > 0 ? state.researchResults.find(result => result.roundId === RESEARCH_ROUNDS[index - 1]?.id) : null;
  const followup = getEvidenceMaterial(state, previous?.promotedId)?.nextQuestion;
  const query = (state.investigation ? state.investigation.leads[0]?.question : followup) || (state.researchMode === 'live' && index === 0 ? '从月球用肉眼能看见长城吗？' : definition?.defaultQuery) || '';
  const queries = definition ? [...new Set([query, definition.defaultQuery, ...(definition.querySuggestions || []), ...(definition.queryAliases || [])].filter(Boolean))] : [];
  const reachedRegions = state.regions.filter(region => region.seeded).length, requiredRegions = index === 0 ? 1 : 3;
  const gate = pending ? 'publication' : index === 0 || !definition ? null : !previous?.promotedId ? 'publication' : reachedRegions < requiredRegions ? 'network' : null;
  const unlocked = !gate;
  const availableAt = unlocked ? 0 : Infinity;
  const cost = RULES.researchCosts[index], duration = state.researchMode === 'live' ? null : index === 0 ? 12 : 16;
  let phase = !definition ? 'complete' : pending ? 'ready-to-publish' : state.research ? 'searching' : !unlocked ? 'locked' : 'ready';
  if (phase === 'ready' && state.investigation?.refresh) phase = 'refreshing';
  if (phase === 'ready' && state.investigation && !state.investigation.sessionId) phase = state.investigation.planError ? 'plan-error' : 'planning';
  const actionLabel = gate === 'publication' ? '先公布手中的实锤' : gate === 'network' ? `先传到 ${requiredRegions} 个地区` : '';
  let reason = phase === 'complete' ? '本局五轮沿线调查已完成' : phase === 'ready-to-publish' ? pending.storedAt != null ? '证据已收入囊中，公布后继续追查' : '新证据已到，查看后即可公布' : phase === 'searching' ? '正在整理本轮证据' : phase === 'locked' ? gate === 'publication' ? '先公布手中的实锤，再沿线追查。' : `真相触达 ${requiredRegions} 个地区后，可沿线追查（${reachedRegions}/${requiredRegions}）` : state.coins < cost ? '金币不足，点击地图金币赚取搜证经费' : '';
  if (state.phase !== 'playing') reason = '本局已结束';
  else if (phase === 'refreshing') reason = '正在换一组调查方向';
  else if (phase === 'planning') reason = '正在整理调查方向，先经营传播网络';
  else if (phase === 'plan-error') reason = state.investigation.planError;
  return {
    phase, roundId: definition?.id || null, roundNumber: definition?.round || Math.min(index + 1, RESEARCH_ROUNDS.length), totalRounds: RESEARCH_ROUNDS.length, completed: state.evidence.length,
    cost: definition ? cost : null, duration: definition ? duration : null, availableAt, requiredRegions, reachedRegions, gate, actionLabel, currency: 'coins',
    available: state.phase === 'playing' && phase === 'ready' && state.coins >= cost,
    reason, query, queries, mode: state.researchMode, error: state.researchError ? { ...state.researchError } : null,
    agent: Boolean(state.investigation), leads: state.investigation?.leads.map(lead => ({ ...lead })) || [], planError: state.investigation?.planError || null,
    pendingEvidence: pending ? { ...pending, evidenceIds: [...pending.evidenceIds] } : null,
    pendingChoice: pending ? { ...pending, evidenceIds: [...pending.evidenceIds] } : null,
  };
}

export function startResearch(state, query, { requestId, leadId } = {}) {
  if (state.phase !== 'playing') return fail('本局已结束');
  const status = getResearchStatus(state);
  if (status.phase !== 'ready') return fail(status.reason);
  const live = state.researchMode === 'live';
  const selectedLead = state.investigation?.leads.find(lead => lead.id === leadId);
  if (state.investigation && (!selectedLead || selectedLead.question !== query?.trim())) return fail('请选择本轮的一条调查方向；未扣金币。');
  if (live) {
    if (!validLiveQuery(query)) return fail('请输入 2–64 字的问题，不要包含控制字符；未扣金币。');
    if (!validText(requestId, 160)) return fail('搜索请求未准备好，请重试；未扣金币。');
  } else {
    const normalized = normalizeQuery(query);
    if (!normalized || !status.queries.some(candidate => normalizeQuery(candidate) === normalized)) return fail('当前为本案预置模拟检索，请使用推荐问题或本轮已提供的追问；未扣金币。');
  }
  if (state.coins < status.cost) return fail('金币不足，点击地图金币赚取搜证经费');
  state.coins -= status.cost;
  state.coinEconomy.spent += status.cost;
  // Both modes reserve gold first. Only a completed result opens cashout,
  // so pending or refunded investigations cannot fund unrelated upgrades.
  const pointsEarned = 0;
  state.researchError = null;
  if (state.investigation) state.investigation.refreshError = null;
  state.research = { roundId: status.roundId, clueId: status.roundId, query: query.trim(), elapsed: 0, duration: status.duration, cost: status.cost, kind: live ? 'live' : 'evidence', ...(live ? { requestId: requestId.trim() } : {}) };
  if (state.investigation) Object.assign(state.research, { sessionId: state.investigation.sessionId, leadId, chosenLead: { ...selectedLead }, claim: state.claim });
  log(state, 'research', `第 ${status.roundNumber} 轮沿线调查`, query.trim());
  return { ok: true, pointsEarned };
}

const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const validLiveQuery = value => typeof value === 'string' && [...value.trim()].length >= 2 && validText(value.trim(), 64) && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

function snapshotLeads(leads) {
  if (!Array.isArray(leads) || leads.length !== 2) return null;
  if (new Set(leads.map(lead => lead?.id)).size !== 2 || new Set(leads.map(lead => lead?.question)).size !== 2) return null;
  if (!leads.every(lead => validText(lead?.id, 80) && /^[\w-]+$/.test(lead.id) && validText(lead.title, 50) && validLiveQuery(lead.question) && validText(lead.reason, 180))) return null;
  return leads.map(lead => ({ id: lead.id, title: lead.title.trim(), question: lead.question.trim(), reason: lead.reason.trim() }));
}

export function setInvestigationPlan(state, plan) {
  if (state.phase !== 'playing' || !state.investigation || state.investigation.sessionId) return fail('调查计划不属于当前战局');
  const leads = snapshotLeads(plan?.leads);
  if (!plan || plan.claim !== state.claim || !validText(plan.sessionId, 100) || !leads) return fail('调查方向没有准备完整，可以重新整理。');
  state.investigation = { sessionId: plan.sessionId, leads, planError: null, refresh: null, refreshError: null };
  return { ok: true };
}

export function startLeadRefresh(state, requestId) {
  if (state.phase !== 'playing') return fail('本局已结束');
  const investigation = state.investigation, status = getResearchStatus(state);
  if (state.researchMode !== 'live' || !investigation || !validText(investigation.sessionId, 100) || !snapshotLeads(investigation.leads)) return fail('当前调查还没有可刷新的问题');
  if (status.phase !== 'ready' || investigation.refresh) return fail(status.reason || '当前无法刷新调查方向');
  if (!validText(requestId, 160)) return fail('刷新请求未准备好，请重试；未扣金币。');
  if (state.coins < 1) return fail('需要 1 金币刷新调查方向');
  const previous = state.researchResults.find(result => result.roundId === RESEARCH_ROUNDS[status.roundNumber - 2]?.id);
  const job = { requestId: requestId.trim(), roundId: status.roundId, cost: 1,
    sessionId: investigation.sessionId, claim: state.claim, promotedId: previous?.promotedId || null,
    leadIds: investigation.leads.map(lead => lead.id), questions: investigation.leads.map(lead => normalizeQuery(lead.question)) };
  state.coins -= job.cost;
  state.coinEconomy.spent += job.cost;
  investigation.refresh = job;
  investigation.refreshError = null;
  return { ok: true, ...job, leadIds: [...job.leadIds], questions: [...job.questions] };
}

export function completeLeadRefresh(state, requestId, payload) {
  const investigation = state.investigation, job = investigation?.refresh;
  if (!job || job.requestId !== requestId) return fail('这次刷新已结束，或不属于当前战局');
  if (state.phase !== 'playing') return fail('本局已结束');
  const leads = snapshotLeads(payload?.leads), questions = leads?.map(lead => normalizeQuery(lead.question));
  if (state.research || getResearchStatus(state).roundId !== job.roundId
    || job.sessionId !== investigation.sessionId || job.claim !== state.claim
    || payload?.sessionId !== job.sessionId || payload?.claim !== job.claim || payload?.roundId !== job.roundId
    || !leads || new Set(questions).size !== 2 || leads.some(lead => job.leadIds.includes(lead.id))
    || questions.some(question => job.questions.includes(question))) return fail('新问题没有准备完整，请重试。');
  investigation.leads = leads;
  if (state.researchError?.roundId === job.roundId) state.researchError = null;
  investigation.refresh = null;
  investigation.refreshError = null;
  state.coinEconomy.refreshSpent = (state.coinEconomy.refreshSpent || 0) + job.cost;
  return { ok: true };
}

export function failLeadRefresh(state, requestId, reason = '这次没能换到新问题，请重试。') {
  const investigation = state.investigation, job = investigation?.refresh;
  if (!job || job.requestId !== requestId) return fail('这次刷新已结束，或不属于当前战局');
  state.coins += job.cost;
  state.coinEconomy.spent -= job.cost;
  investigation.refresh = null;
  const message = validText(reason, 500) ? reason.trim() : '这次没能换到新问题，请重试。';
  investigation.refreshError = `${message} 1 金币已退回，原问题保留。`;
  return { ok: false, reason: investigation.refreshError, refund: job.cost };
}

export function failInvestigationPlan(state, reason) {
  if (state.phase !== 'playing' || !state.investigation || state.investigation.sessionId) return fail('调查计划不属于当前战局');
  state.investigation.planError = validText(reason, 500) ? reason.trim() : '调查方向暂时没有准备好，可以重试。';
  return { ok: false, reason: state.investigation.planError };
}

function publishedReviewMaterials(state) {
  const publications = [];
  for (const publication of state.publications || []) {
    const result = state.researchResults.find(item => item.roundId === publication.roundId);
    if (!result || !publication.evidenceId || result.promotedId !== publication.evidenceId
      || result.publishedAt == null || !result.materials?.some(material => material.id === publication.evidenceId)
      || publications.some(item => item.roundId === publication.roundId)) return null;
    publications.push({ roundId: publication.roundId, materialId: publication.evidenceId });
  }
  return publications;
}
const samePublications = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length
  && left.every(item => right.some(other => other.roundId === item.roundId && other.materialId === item.materialId));

/** Victory freezes the game first; reviewing the published chain never spends
 * resources or changes the outcome, clock, evidence selection or bonuses. */
export function startFinalReview(state, requestId) {
  if (state.phase !== 'won' || state.research || state.researchMode !== 'live' || !validText(state.investigation?.sessionId, 100)) return fail('当前战报还不能复核调查材料');
  if (state.finalReview && state.finalReview.status !== 'failed') return fail('结案审查已经提交');
  if (!validText(requestId, 160)) return fail('结案请求尚未准备好');
  const publications = publishedReviewMaterials(state);
  if (!publications) return fail('已公布的证据记录不完整');
  const request = { requestId: requestId.trim(), sessionId: state.investigation.sessionId, publications };
  state.finalReview = { ...request, publications: publications.map(item => ({ ...item })), claim: state.claim, status: 'pending', error: null, verdict: null };
  return { ok: true, request };
}

function activeFinalReview(state, requestId) {
  const review = state.finalReview;
  return state.phase === 'won' && !state.research && review?.status === 'pending' && review.requestId === requestId
    && review.sessionId === state.investigation?.sessionId && review.claim === state.claim
    && samePublications(review.publications, publishedReviewMaterials(state));
}

export function completeFinalReview(state, requestId, payload) {
  if (!activeFinalReview(state, requestId)) return fail('这份结案审查不属于当前战局');
  const review = state.finalReview, verdict = snapshotFinalVerdict(payload?.finalVerdict);
  if (payload?.requestId !== requestId || payload?.sessionId !== review.sessionId || !verdict
    || !samePublications(verdict.reviewedPublications, review.publications)) return fail('结案审查返回的证据链不完整');
  for (const link of verdict.chain) {
    const publication = review.publications.find(item => item.roundId === link.roundId);
    const result = state.researchResults.find(item => item.roundId === link.roundId);
    const material = result.materials.find(item => item.id === publication.materialId);
    const knownUrls = new Set(material.sources.map(source => safeSourceUrl(source.url)));
    if (link.question !== (result.chosenLead?.question || result.query) || link.sourceUrls.some(url => !knownUrls.has(url))) return fail('结案审查引用了未公布的材料');
  }
  review.verdict = verdict;
  review.status = 'complete';
  review.error = null;
  return { ok: true, verdict };
}

export function failFinalReview(state, requestId, reason = '调查材料暂时未能完成复核，可以稍后重试。') {
  if (!activeFinalReview(state, requestId)) return fail('这份结案审查不属于当前战局');
  state.finalReview.status = 'failed';
  state.finalReview.error = validText(reason, 500) ? reason.trim() : '调查材料暂时未能完成复核，可以稍后重试。';
  return { ok: false, reason: state.finalReview.error };
}

function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    url.hash = '';
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

function snapshotLiveResult(job, payload) {
  const definition = RESEARCH_ROUNDS.find(item => item.id === job.roundId);
  if (!definition || !payload || payload.query !== job.query || !validText(payload.provider, 100) || !validText(payload.requestId, 160) || !validText(payload.fetchedAt, 80) || !Number.isFinite(Date.parse(payload.fetchedAt)) || !validText(payload.searchQuery, 256) || !validText(payload.finding, 1600) || !Array.isArray(payload.materials) || (payload.materials.length !== 2 && (!job.sessionId || payload.materials.length !== 1))) return null;
  // Agent investigations deliver one selected report; older two-card results
  // remain readable. Every received card must match one distinct round template.
  const templates = definition.materials.filter(template => payload.materials.some(material => material?.id === template.id));
  if (templates.length !== payload.materials.length) return null;
  const materials = [];
  for (const template of templates) {
    const material = payload.materials.find(item => item?.id === template.id);
    if (!material || material.focus !== template.focus || material.eventId !== template.eventId || !validText(material.title, 240) || !validText(material.finding, 1600) || !Array.isArray(material.sources) || !material.sources.length || material.sources.length > 5 || (definition.round < RESEARCH_ROUNDS.length && !validLiveQuery(material.nextQuestion))) return null;
    const sources = [];
    for (const source of material.sources) {
      const url = safeSourceUrl(source?.url);
      if (!url || !validText(source.title, 240) || !validText(source.summary, 2500) || !validText(source.organization, 160)) return null;
      if (source.content !== undefined && source.content !== '' && !validText(source.content, 3000)) return null;
      const imageUrl = safeSourceUrl(source.imageUrl);
      sources.push({ title: source.title.trim(), url, summary: source.summary.trim(), organization: source.organization.trim(), date: typeof source.date === 'string' ? source.date.slice(0, 80) : '', ...(source.content ? { content: source.content.trim() } : {}), ...(imageUrl ? { imageUrl, imageCaption: validText(source.imageCaption, 180) ? source.imageCaption.trim() : '' } : {}) });
    }
    // Case-specific interpretations must travel with an exact returned passage.
    // Snapshot only known display fields; provider data cannot supply game effects.
    const kinds = ['moon', 'location', 'lens', 'observation', 'context'];
    let insight, lead;
    if (material.insight !== undefined) {
      const value = material.insight;
      if (!value || !kinds.includes(value.kind) || !validText(value.headline, 120) || !validText(value.explanation, 500) || !validText(value.quote, 800)
        || !sources.some(source => [source.summary, source.content].some(text => text?.includes(value.quote.trim())))) return null;
      insight = { kind: value.kind, headline: value.headline.trim(), explanation: value.explanation.trim(), quote: value.quote.trim() };
    }
    if (material.lead != null) {
      const value = material.lead;
      if (definition.round >= RESEARCH_ROUNDS.length || !kinds.includes(value.kind) || !validLiveQuery(value.question) || value.question.trim() !== material.nextQuestion.trim() || !validText(value.reason, 300)) return null;
      lead = { kind: value.kind, question: value.question.trim(), reason: value.reason.trim() };
    }
    let effectFields = {};
    if (material.effectId !== undefined || job.sessionId) {
      if (!INVESTIGATION_EFFECTS[material.effectId] || INVESTIGATION_EFFECTS[material.effectId].focus !== template.focus || !validText(material.effectReason, 180)) return null;
      effectFields = { effectId: material.effectId, effectReason: material.effectReason.trim() };
    }
    materials.push({ id: template.id, focus: template.focus, eventId: template.eventId, title: material.title.trim(), finding: material.finding.trim(), sources, nextQuestion: definition.round < RESEARCH_ROUNDS.length ? material.nextQuestion.trim() : null, ...(insight ? { insight } : {}), ...(lead ? { lead } : {}), ...effectFields });
  }
  if (materials.length === 2 && materials[0].sources[0].url === materials[1].sources[0].url) return null;
  let investigation;
  if (payload.investigation !== undefined) {
    const value = payload.investigation;
    if (!value || value.question !== job.query || !validText(value.summary, 600) || !validText(value.delta, 600)) return null;
    for (const key of ['previousFinding', 'openQuestion']) if (typeof value[key] !== 'string' || (value[key] !== '' && !validText(value[key], 600))) return null;
    investigation = Object.fromEntries(['question', 'previousFinding', 'summary', 'delta', 'openQuestion'].map(key => [key, value[key].trim()]));
  }
  let agentFields = {};
  if (job.sessionId) {
    if (payload.sessionId !== job.sessionId || payload.leadId !== job.leadId || payload.claim !== job.claim || !materials.every(material => material.insight)) return null;
    const assessment = payload.assessment, recommendation = payload.recommendation;
    if (!assessment || !Object.hasOwn(ASSESSMENT_LABELS, assessment.status) || !validText(assessment.summary, 400)
      || !recommendation || !materials.some(material => material.id === recommendation.materialId) || !validText(recommendation.reason, 180)) return null;
    const nextLeads = definition.round < RESEARCH_ROUNDS.length ? snapshotLeads(payload.nextLeads) : Array.isArray(payload.nextLeads) && payload.nextLeads.length === 0 ? [] : null;
    if (!nextLeads) return null;
    agentFields = { sessionId: job.sessionId, leadId: job.leadId, chosenLead: { ...job.chosenLead }, claim: job.claim, nextLeads,
      assessment: { status: assessment.status, summary: assessment.summary.trim() }, recommendation: { materialId: recommendation.materialId, reason: recommendation.reason.trim() } };
  }
  return { materials, provider: payload.provider.trim(), requestId: payload.requestId.trim(), fetchedAt: payload.fetchedAt, query: job.query, searchQuery: payload.searchQuery.trim(), finding: payload.finding.trim(), ...(investigation ? { investigation } : {}), ...agentFields };
}

function activeLiveJob(state, requestId) {
  const accepting = state.phase === 'playing' || (state.phase === 'won' && state.victoryAt != null && state.victoryResearchId === requestId);
  return accepting && state.researchMode === 'live' && state.research?.kind === 'live' && state.research.requestId === requestId;
}

export function failLiveResearch(state, requestId, reason = '搜索暂时没能完成，请重试。') {
  if (!activeLiveJob(state, requestId)) return fail('这次搜索已结束，或不属于当前战局');
  const job = state.research;
  state.coins += job.cost;
  state.coinEconomy.spent -= job.cost;
  state.research = null;
  const message = validText(reason, 500) ? reason.trim() : '搜索暂时没能完成，请重试。';
  state.researchError = { message, query: job.query, roundId: job.roundId };
  log(state, 'research-failed', '本次搜证未完成，金币已退回', message);
  return { ok: false, reason: message, refund: job.cost };
}

export function completeLiveResearch(state, requestId, payload) {
  if (!activeLiveJob(state, requestId)) return fail('这次搜索已结束，或不属于当前战局');
  const job = state.research, snapshot = snapshotLiveResult(job, payload);
  if (!snapshot) return failLiveResearch(state, requestId, '返回材料不完整，请换一条线索再试；金币已退回。');
  const result = {
    kind: 'useful', roundId: job.roundId, clueId: job.roundId, query: job.query, time: round(state.time),
    evidenceIds: snapshot.materials.map(material => material.id), promotedId: null, promotedAt: null,
    title: '找到新的搜证材料', detail: snapshot.finding, refund: 0,
    ...snapshot,
  };
  state.evidence.push(job.roundId);
  state.researchedIds.push(job.roundId);
  state.researchResults.push(result);
  selectResearchEvidence(state, result);
  if (state.investigation) state.investigation.leads = snapshot.nextLeads.map(lead => ({ ...lead }));
  state.research = null;
  state.researchError = null;
  state.coinEconomy.researchPaid++;
  const pointsEarned = state.phase === 'playing' ? cashoutCoins(state) : 0;
  if (state.phase === 'won') result.storedAt = state.time;
  log(state, 'evidence', result.title, state.phase === 'won' ? '最后一份调查已归档，收进结案战报。' : '搜证进度 +1；已锁定本轮证据，公布后能力生效。');
  result.counterProgressGain = 0;
  return { ok: true, pointsEarned, result };
}

function completeResearch(state) {
  const job = state.research, definition = RESEARCH_ROUNDS.find(item => item.id === job.roundId);
  if (!definition || state.evidence.includes(job.roundId)) { state.research = null; return; }
  state.evidence.push(job.roundId);
  state.researchedIds.push(job.roundId);
  const result = {
    kind: 'useful', roundId: job.roundId, clueId: job.roundId, query: job.query, time: round(state.time),
    evidenceIds: definition.materials.map(material => material.id), promotedId: null, promotedAt: null,
    title: '新的证据链成立', detail: definition.finding, refund: 0,
  };
  state.researchResults.push(result);
  selectResearchEvidence(state, result);
  state.research = null;
  state.coinEconomy.researchPaid++;
  if (state.phase === 'playing') cashoutCoins(state);
  if (state.phase === 'won') result.storedAt = state.time;
  log(state, 'evidence', result.title, state.phase === 'won' ? '最后一份调查已归档，收进结案战报。' : '有效证据 +1；已锁定本轮证据，公布后能力生效。');
  result.counterProgressGain = 0;
}

// Retired entry point: material selection is automatic and never grants
// abilities without publication, including calls from an older client.
export function promoteEvidence() {
  return fail('本轮证据已自动选定，请公布实锤使它生效');
}

function counterResistance(event) {
  return event?.resolved ? 0 : Math.max(0, 1 - (event?.counterProgress || 0) / 100);
}

function counterRate(state, defenseLevel = state.levels.defense) {
  return 100 / (state.event?.clearDuration || RULES.counterDuration) * (1 + RULES.counterDefenseSpeed * defenseLevel);
}

function attackPower(event) {
  return (event.strength || 1) * (event.stage === 'warning' ? 0.18 : 0.75 + Math.min(2.25, event.activeFor / 80));
}

/** The same forecast drives the controls and the simulation. Loss values are
 * world support percentage points, never a count of exposed people. */
export function getCounterStatus(state) {
  const event = state.event, attacking = state.phase === 'playing' && Boolean(event && !event.resolved);
  const active = attacking && event.counterStartedAt != null;
  const resistance = counterResistance(event), defense = DEFENSE[state.levels.defense];
  const targets = event ? state.regions.filter(region => event.regionIds.includes(region.id)) : [];
  const support = targets.reduce((sum, region) => sum + region.blue, 0) / state.regions.length;
  const rate = counterRate(state), progress = event?.counterProgress || 0;
  const nextLevel = Math.min(3, state.levels.defense + 1);
  return {
    available: state.phase === 'playing' && Boolean(event && !event.resolved) && !active && state.points + EPS >= RULES.counterCost,
    active, progress, remaining: active ? Math.max(0, (100 - progress) / rate) : 0, rate,
    defenseReduction: 1 - defense, nextDefenseReduction: 1 - DEFENSE[nextLevel], nextRate: counterRate(state, nextLevel),
    damagePerSecond: attacking ? support * 0.006 * attackPower(event) * defense * resistance : 0,
    prevented: event?.prevented || 0,
    projectedHit: attacking && event.stage === 'warning' ? support * (event.hit || .36) * defense * Math.max(0, resistance - (active ? rate * event.remaining / 100 : 0)) : 0,
    cost: RULES.counterCost, phase: !event ? 'idle' : event.resolved ? 'resolved' : event.stage,
    waveNumber: event?.waveNumber || 0, waveName: event?.waveName || '',
    queued: (state.enemyWaves || []).filter(wave => wave.stage === 'queued').length,
    recoveryRemaining: Math.max(0, (state.recoveryUntil || 0) - state.time),
  };
}

export function getCampaignStatus(state) {
  const waves = state.enemyWaves || [];
  const cleared = waves.filter(wave => wave.resolved).length;
  return { total: ENEMY_WAVES.length, published: state.publications.length, cleared,
    queued: waves.filter(wave => wave.stage === 'queued').length,
    activeWave: state.event && !state.event.resolved ? state.event.waveNumber : 0,
    recoveryRemaining: Math.max(0, (state.recoveryUntil || 0) - state.time),
    complete: cleared === ENEMY_WAVES.length && state.publications.length === ENEMY_WAVES.length };
}

function finishCounter(state) {
  Object.assign(state.event, { resolved: true, stage: 'resolved', remaining: 0, pressure: 0, counterProgress: 100, counteredAt: round(state.time) });
  state.enemyLossRate = 0; state.counterActive = false; state.counter = 0;
  state.recoveryUntil = round(state.time + RULES.counterRecoveryDuration);
  state.points += RULES.counterReward; state.totals.earned += RULES.counterReward;
  log(state, 'forgery', `第 ${state.event.waveNumber} 波击破：${state.event.waveName}`,
    `行动点 +${RULES.counterReward}；反攻窗口${worldRemaining(RULES.counterRecoveryDuration)}，说服速度 ×2.2、传播速度 ×1.35。`);
  Object.assign(state.log.at(-1), { waveNumber: state.event.waveNumber, reward: RULES.counterReward });
}

function reinforceCounter(state) {
  if (!getCounterStatus(state).active) return 0;
  const gain = Math.min(RULES.counterEvidenceProgress, 100 - state.event.counterProgress);
  state.event.counterProgress += gain;
  log(state, 'counter-progress', `新证据让澄清推进 +${gain.toFixed(0)}%`, '反扑与限流随澄清进度减弱。');
  if (state.event.counterProgress + EPS >= 100) finishCounter(state);
  return gain;
}

function updateCounter(state, dt) {
  if (!getCounterStatus(state).active) return;
  state.event.counterProgress = Math.min(100, state.event.counterProgress + counterRate(state) * dt);
  if (state.event.counterProgress + EPS >= 100) finishCounter(state);
}

export function counterWithSource(state) {
  if (state.phase !== 'playing') return fail('本局已结束');
  if (!state.event || state.event.resolved) return fail('当前没有需要澄清的反扑');
  if (state.event.counterStartedAt != null) return fail('澄清正在推进，不需要重复花费');
  if (state.points + EPS < RULES.counterCost) return fail('行动点不足');
  state.points = Math.max(0, state.points - RULES.counterCost); state.totals.spent += RULES.counterCost;
  Object.assign(state.event, { counterStartedAt: round(state.time), counterProgress: 0 });
  const detail = '澄清逐步削弱流失与限流。稳住阵地可加快澄清；新证据公布时再推进 15%。';
  log(state, 'counter-start', '开始澄清，逐步化解反扑', detail);
  return { ok: true, kind: 'counter-start', title: '澄清已经开始', detail, progress: 0, remaining: getCounterStatus(state).remaining };
}

function queueEnemyWave(state, publication) {
  const waveNumber = publication.waveNumber, definition = ENEMY_WAVES[waveNumber - 1];
  const wave = { id: `counter-wave-${waveNumber}`, type: 'forgery', waveNumber, waveName: definition.name,
    stage: 'queued', queuedAt: round(state.time), publicationId: publication.roundId,
    strength: definition.strength, hit: definition.hit, clearDuration: definition.duration,
    targetCount: definition.targets, warningDuration: definition.warning,
    counterStartedAt: null, counterProgress: 0, prevented: 0, remaining: definition.warning,
    regionIds: [], resolved: false, pressure: 0, activeFor: 0 };
  state.enemyWaves.push(wave);
  if (!activateNextWave(state)) log(state, 'reinforcement', `第 ${waveNumber} 波增援：${definition.name}`,
    '这份实锤引来了更强的反扑。当前战斗不会重置，反攻窗口结束后迎战下一波。');
}

function activateNextWave(state) {
  if ((state.event && !state.event.resolved) || state.time + EPS < state.recoveryUntil) return false;
  const wave = state.enemyWaves.find(item => item.stage === 'queued');
  if (!wave) return false;
  const targets = [...state.regions].sort((a, b) => b.blue - a.blue).slice(0, wave.targetCount);
  state.event = wave; state.eventTriggered = true;
  Object.assign(wave, { stage: 'warning', startedAt: round(state.time),
    title: `第 ${wave.waveNumber} 波：${wave.waveName}`, regionId: targets[0].id,
    regionIds: targets.map(region => region.id), pressure: .18 * wave.strength * DEFENSE[state.levels.defense] });
  wave.description = `${targets.map(target => REGIONS.find(region => region.id === target.id).name).join('、')}被锁定。${worldRemaining(wave.remaining)}后发动主攻。`;
  log(state, 'warning', `第 ${wave.waveNumber} / ${ENEMY_WAVES.length} 波 · ${wave.waveName}`,
    `${wave.targetCount === 6 ? '全球' : wave.targetCount + ' 个地区'}遭到围攻；${worldRemaining(wave.remaining)}后发动主攻。发起澄清削弱攻击，稳住阵地减损并提速。`);
  Object.assign(state.log.at(-1), { waveId: wave.id, waveNumber: wave.waveNumber });
  return true;
}

function updateEnemyEvent(state, dt) {
  const event = state.event;
  if (!event || event.resolved || event.stage !== 'warning') return;
  event.remaining = Math.max(0, event.remaining - dt);
  if (event.remaining > EPS) return;
  let loss = 0;
  for (const id of event.regionIds) {
    const target = state.regions.find(region => region.id === id);
    const damageMultiplier = DEFENSE[state.levels.defense] * counterResistance(event);
    const blueLoss = target.blue * event.hit * damageMultiplier;
    const yellowLoss = target.exposed * event.hit * 2 / 3 * damageMultiplier;
    event.prevented += (target.blue * event.hit - blueLoss) / state.regions.length;
    target.blue -= blueLoss;
    target.exposed -= yellowLoss;
    target.red += blueLoss + yellowLoss;
    loss += blueLoss;
    state.totals.reclaimed += blueLoss + yellowLoss;
  }
  state.totals.relapsed += loss;
  event.stage = 'active';
  event.remaining = null;
  event.pressure = DEFENSE[state.levels.defense] * counterResistance(event);
  event.title = '对手正在夺回人群';
  event.description = '被围攻的地区持续由绿、黄退回红色。发起澄清会逐步削弱反扑；稳住阵地可减少流失并加快澄清。';
  log(state, 'backlash', `反扑命中：${state.investigation ? '本局支持率' : '全球清醒'} −${(loss / 6).toFixed(1)}%`, '敌人仍在夺回人群。现在的损失会持续，不能只等它自己消失。');
}

function awardMilestones(state) {
  const reached = getStats(state).reached;
  for (const threshold of MILESTONES) {
    if (reached + EPS >= threshold && !state.milestones.includes(threshold)) {
      state.milestones.push(threshold);
      state.points += 4;
      state.totals.earned += 4;
      log(state, 'milestone', `传播网触达 ${threshold}%`, '新的调查站加入：行动点 +4。');
    }
  }
}

function checkOutcome(state) {
  if (state.phase !== 'playing') return;
  if (getStats(state).truth + EPS >= RULES.winTruth) {
    state.phase = 'won';
    state.time = round(state.time);
    state.victoryAt = state.time;
    // The world ends here. Only this already-paid request may still add its
    // material to the report; it cannot extend the match or start another wave.
    state.victoryResearchId = state.research?.requestId || null;
    state.counterActive = false; state.counter = 0;
    state.truthRate = 0; state.enemyLossRate = 0; state.worldLossRate = 0;
    for (const result of state.researchResults) if (!result.promotedId && result.storedAt == null) result.storedAt = state.time;
    log(state, 'win', state.investigation ? '你赢下了这场舆论争夺' : '真相赢下了这场争夺', state.investigation ? `本局 ${RULES.winTruth}% 的模拟人群相信了你的反驳：最初的观点是一个谎言。` : `全球 ${RULES.winTruth}% 的人接受了真相。`);
  } else if (state.collapseFor + EPS >= RULES.collapseGrace) {
    state.phase = 'lost';
    state.defeatReason = 'network-collapse';
    log(state, 'lose', '传播网络已经崩溃', '接受或接触真相的人已所剩无几，也没有在途转载或调查能接上这一棒。');
  }
}

function advance(state, dt) {
  const before = getStats(state).truth;
  state.time += dt;
  const income = getStats(state).income * dt;
  state.points += income;
  state.totals.earned += income;
  if (state.research) {
    if (state.research.kind === 'live') state.research.elapsed += dt;
    else {
      state.research.elapsed = Math.min(state.research.duration, state.research.elapsed + dt);
      if (state.research.elapsed + EPS >= state.research.duration) completeResearch(state);
    }
  }
  activateNextWave(state);
  updateCounter(state, dt);
  updateEnemyEvent(state, dt);
  updateMediaEvents(state);
  updateEvidenceEvents(state);
  const bonuses = getEvidenceBonuses(state);
  const pacing = getPacing(state);
  const worldPressure = pacing.pressureFactor * DEFENSE[state.levels.defense];
  const sources = state.regions.map(region => (region.blue + 0.35 * region.exposed) / 100);
  const proofMultiplier = (1 + RULES.evidenceBonusPerRound * state.evidence.length);
  const publicMultiplier = state.operationPhase === 'public' ? 4 : 1;
  const recovery = state.time < state.recoveryUntil;
  let reclaimed = 0, blueLost = 0, worldReclaimed = 0;
  const transfers = state.regions.map((region, i) => {
    // No cross-region derivative: a region at zero stays at zero until a
    // carrying trip actually arrives and successfully seeds it.
    const seen = Math.min(region.red, region.red * LOCAL[state.levels.spread] * sources[i] * pacing.populationMultiplier * bonuses.spreadMultiplier * (recovery ? 1.35 : 1) * dt);
    const affected = state.event && !state.event.resolved && state.event.regionIds.includes(region.id);
    const power = affected ? attackPower(state.event) : 0;
    const pressure = affected ? DEFENSE[state.levels.defense] * power * counterResistance(state.event) : 0;
    const accepted = Math.min(region.exposed, region.exposed * CONVERT[state.levels.persuasion] * proofMultiplier * publicMultiplier * pacing.populationMultiplier * bonuses.persuasionMultiplier * (recovery ? 2.2 : 1) / (1 + pressure) * dt);
    const ambient = 0.0015 * region.red / 100 * DEFENSE[state.levels.defense];
    const yellowRate = ambient + 0.012 * pressure + 0.10 * worldPressure;
    const blueRate = 0.006 * pressure + 0.05 * worldPressure;
    const yellowLost = Math.min(region.exposed - accepted, region.exposed * yellowRate * dt);
    const blueToRed = Math.min(region.blue, region.blue * blueRate * dt);
    reclaimed += yellowLost + blueToRed;
    worldReclaimed += (blueRate > 0 ? blueToRed * 0.05 * worldPressure / blueRate : 0) + (yellowRate > 0 ? yellowLost * 0.10 * worldPressure / yellowRate : 0);
    blueLost += blueToRed;
    if (affected) state.event.prevented += region.blue * 0.006 * (power - pressure) * dt / state.regions.length;
    return { seen, accepted, yellowLost, blueToRed };
  });
  state.regions.forEach((region, i) => {
    const flow = transfers[i];
    state.coinEconomy.activity[region.id] += flow.seen;
    region.red = Math.max(0, region.red - flow.seen + flow.yellowLost + flow.blueToRed);
    region.exposed = Math.max(0, region.exposed + flow.seen - flow.accepted - flow.yellowLost);
    region.blue = Math.max(0, 100 - region.red - region.exposed);
  });
  state.totals.reclaimed += reclaimed;
  state.totals.relapsed += blueLost;
  state.enemyLossRate = getCounterStatus(state).damagePerSecond;
  state.worldLossRate = worldReclaimed / 6 / dt;
  if (state.event?.stage === 'active' && !state.event.resolved) {
    state.event.activeFor += dt;
    state.event.pressure = DEFENSE[state.levels.defense] * attackPower(state.event) * counterResistance(state.event);
  }
  if (state.event?.stage === 'warning') state.event.pressure = attackPower(state.event) * DEFENSE[state.levels.defense] * counterResistance(state.event);
  state.counterActive = Boolean(state.event && !state.event.resolved);
  state.counter = state.counterActive ? Math.min(100, state.event.pressure * 100) : 0;
  updateTransports(state);
  updateCoins(state);
  state.truthRate = (getStats(state).truth - before) / dt;
  awardMilestones(state);
  const stats = getStats(state);
  const collapsing = pacing.heat > 0 && stats.reached < RULES.collapseReach && stats.truth < RULES.collapseTruth
    && !state.research && !state.transit.active.some(trip => trip.carryingTruth);
  state.collapseFor = collapsing ? state.collapseFor + dt : 0;
  checkOutcome(state);
}

export function tick(state, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return fail('时间步长无效');
  checkOutcome(state);
  if (state.phase === 'won' && state.victoryAt != null && state.research?.kind === 'evidence') {
    // Offline investigations have no network callback. Finish their paid work
    // without advancing the world clock, resources, traffic or enemy attacks.
    state.research.elapsed = Math.min(state.research.duration, state.research.elapsed + seconds);
    if (state.research.elapsed + EPS >= state.research.duration) completeResearch(state);
  }
  if (state.phase !== 'playing') return { ok: true };
  let remaining = seconds;
  while (remaining > EPS && state.phase === 'playing') {
    const dt = Math.min(STEP, remaining);
    advance(state, dt);
    remaining -= dt;
  }
  state.time = round(state.time);
  return { ok: true };
}

export function getStats(state) {
  const totals = state.regions.reduce((sum, region) => ({ red: sum.red + region.red, exposed: sum.exposed + region.exposed, blue: sum.blue + region.blue }), { red: 0, exposed: 0, blue: 0 });
  const truth = totals.blue / state.regions.length;
  const exposed = totals.exposed / state.regions.length;
  const lie = totals.red / state.regions.length;
  return {
    truth, exposed, lie, reached: truth + exposed, rate: state.truthRate, netRate: state.truthRate,
    enemyLossRate: state.enemyLossRate, worldLossRate: state.worldLossRate,
    worldPopulation: RULES.worldPopulation,
    truthPopulation: RULES.worldPopulation * truth / 100,
    exposedPopulation: RULES.worldPopulation * exposed / 100,
    liePopulation: RULES.worldPopulation * lie / 100,
    income: RULES.income + 0.50 * truth / 100,
    evidenceMultiplier: (1 + RULES.evidenceBonusPerRound * state.evidence.length),
    influencedRegions: state.regions.filter(region => region.blue >= 1).length,
    liberatedRegions: state.regions.filter(region => region.blue >= 90).length,
  };
}
