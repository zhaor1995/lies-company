import { queueEvidence } from './evidence-fixture.mjs';
import { pathToFileURL } from 'node:url';
import { createGame, tick, buyUpgrade, startResearch, publishEvidence, getStats, getResearchStatus, counterWithSource, collectCoin, getCoinEconomy, getCounterStatus, getCampaignStatus, ENEMY_WAVES, REGIONS, RULES } from '../dist/engine.js';

// Declared, fixed policies compare timing and responses. There is no route
// optimization or injected currency in these integration simulations.
export function play({ regionId = 'europe', launchAt = 'ready', research = true, maxResearch = 5, counter = true, counterDelay = 0, counterWaves = 5, reserve = 0, prepOrder = ['spread', 'spread', 'persuasion'], postOrder = ['defense', 'persuasion', 'defense', 'persuasion', 'defense', 'spread'], randomUpgrades = false, seed = 1, maxSimulationTime = 2400, collectEvery = .5 } = {}) {
  const state = createGame({ regionId, seed });
  const before = [...prepOrder], after = [...postOrder];
  const spend = key => buyUpgrade(state, key);
  let random = seed;
  const rand = () => ((random = (random * 1664525 + 1013904223) >>> 0) / 4294967296);
  const timeline = [], battles = new Map();
  const observeBattle = () => {
    const event = state.event;
    if (!event) return;
    const truth = getStats(state).truth;
    if (!battles.has(event.waveNumber)) battles.set(event.waveNumber, {
      wave: event.waveNumber, name: event.waveName, started: event.startedAt,
      targets: event.regionIds.length, strength: event.strength,
      startTruth: truth, lowestTruth: truth, peakTruth: truth, maxDrop: 0,
    });
    const row = battles.get(event.waveNumber);
    // Keep each wave's trough distinct from the recovery before the next wave.
    if (!row.clearedAt) {
      row.peakTruth = Math.max(row.peakTruth, truth);
      row.lowestTruth = Math.min(row.lowestTruth, truth);
      row.maxDrop = Math.max(row.maxDrop, row.peakTruth - truth);
      row.endTruth = truth;
      row.responseDelay = event.counterStartedAt == null ? null : event.counterStartedAt - event.startedAt;
      row.clearedAt = event.counteredAt ?? null;
      row.duration = (event.counteredAt ?? state.time) - event.startedAt;
      row.prevented = event.prevented;
    }
  };
  let nextCollection = 0, peakWallet = 0, peakMapPiles = 0;
  let lastLie = getStats(state).lie, redRiseSeconds = 0, maxDrop = 0, peak = getStats(state).truth;
  // This is a diagnostic ceiling for the test runner, never a game outcome.
  // An unresolved match remains 'playing' and is reported as such.
  while (state.phase === 'playing' && state.time < maxSimulationTime) {
    peakWallet = Math.max(peakWallet, state.coins);
    peakMapPiles = Math.max(peakMapPiles, state.coinDrops.length);
    if (Number.isFinite(collectEvery) && state.time >= nextCollection) {
      for (const drop of [...state.coinDrops]) collectCoin(state, drop.id);
      peakWallet = Math.max(peakWallet, state.coins);
      nextCollection = state.time + Math.max(.5, collectEvery);
    }
    const status = getResearchStatus(state);
    if (status.pendingEvidence && state.operationPhase === 'public') publishEvidence(state);
    if (research && state.evidence.length < maxResearch && !state.research) {
      const next = getResearchStatus(state);
      if (next.available) startResearch(state, next.query);
    }
    const stats = getStats(state);
    const wantsLaunch = launchAt === 'ready' ? stats.reached >= 70 && (!research || state.evidence.length >= 1 || state.time >= 180) : Number.isFinite(launchAt) && state.time >= launchAt;
    if (state.operationPhase === 'preparing' && wantsLaunch && state.points >= reserve) publishEvidence(state);
    if (randomUpgrades) {
      // Affordable random spending, with no attempt to anticipate the attack.
      const keys = ['spread', 'persuasion', 'defense'];
      for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
      for (const key of keys) if (spend(key).ok) break;
    } else if (state.operationPhase === 'preparing') {
      if (!wantsLaunch) {
        if (before.length) { if (spend(before[0]).ok) before.shift(); }

      }
    } else {
      if (counter && state.event && !state.event.resolved && state.event.waveNumber <= counterWaves) {
        if (state.time >= state.event.startedAt + counterDelay) counterWithSource(state);
      }
      if ((!counter || state.event?.counterStartedAt != null) && after.length && spend(after[0]).ok) after.shift();
    }
    observeBattle();
    peak = Math.max(peak, getStats(state).truth);
    tick(state, Math.min(.5, maxSimulationTime - state.time));
    const current = getStats(state);
    observeBattle();
    maxDrop = Math.max(maxDrop, peak - current.truth);
    if (current.lie > lastLie + 1e-7) redRiseSeconds += .5;
    lastLie = current.lie;
    if (Math.floor(state.time) % 30 === 0 && (!timeline.length || state.time - timeline.at(-1).time >= 29)) timeline.push({ time: state.time, truth: current.truth, reached: current.reached, points: state.points, levels: { ...state.levels }, phase: state.operationPhase });
  }
  state.diagnostics = { maxDrop, redRiseSeconds, timeline, waves: [...battles.values()], campaign: getCampaignStatus(state), coins: getCoinEconomy(state), peakWallet, peakMapPiles,
    searchTimes: state.log.filter(entry => entry.type === 'research').map(entry => entry.time),
    researchStages: state.researchResults.map(result => ({ started: state.log.find(entry => entry.type === 'research' && entry.detail === result.query)?.time, completed: result.time, promoted: result.promotedAt })),
    simulationLimitReached: state.phase === 'playing' };
  return state;
}

export const SCENARIOS = [
  { name: '公开后及时应对', options: {} },
  { name: '公开后止损翻盘', options: { counterDelay: 45 } },
  { name: '每波迟缓15秒应对', options: { counterDelay: 15 } },
  { name: '只应战第一波', options: { counterWaves: 1 } },
  { name: '昂贵输出优先再防守', options: { postOrder: ['defense', 'persuasion', 'persuasion', 'spread', 'defense'] } },
  { name: '每波澄清但不防守', options: { postOrder: ['persuasion', 'persuasion', 'spread'] } },
  { name: '预留澄清费再公开', options: { reserve: 12 } },
  { name: '过早公开', options: { launchAt: 90, prepOrder: ['spread', 'persuasion'], postOrder: ['spread', 'persuasion', 'defense', 'persuasion', 'defense', 'defense', 'spread'] } },
  { name: '小网络提前出击', options: { launchAt: 140, prepOrder: ['spread', 'persuasion'], postOrder: ['spread', 'persuasion', 'defense', 'persuasion'] } },
  { name: '公开太晚', options: { launchAt: 560 } },
  { name: '始终不公开', options: { launchAt: Infinity } },
  { name: '只管输出忽略反扑', options: { counter: false, postOrder: ['persuasion', 'defense', 'persuasion', 'spread', 'defense', 'defense'] } },
  { name: '硬扛并进化反攻', options: { counter: false, postOrder: ['defense', 'defense', 'persuasion', 'defense', 'persuasion'] } },
  { name: '公开后完全不应对', options: { counter: false, postOrder: [], maxResearch: 1 } },
  { name: '完全不操作', options: { launchAt: Infinity, research: false, prepOrder: [], collectEvery: Infinity } },
  { name: '每30秒领取流量收益', options: { collectEvery: 30 } },
  { name: '不领取流量收益', options: { collectEvery: Infinity } },
  { name: '不搜证只发起澄清', options: { research: false, postOrder: ['persuasion', 'defense', 'persuasion', 'spread', 'defense', 'defense'] } },
  { name: '不进化只搜证应对', options: { prepOrder: [], postOrder: [] } },
  ...[1, 2, 3, 4].map(seed => ({ name: `不看局势随机花钱 ${seed}`, options: { randomUpgrades: true, research: false, counter: false, seed } })),
  ...REGIONS.filter(region => region.id !== 'europe').map(region => ({ name: `地区 ${region.name}`, options: { regionId: region.id } })),
];

export function scanEvidenceRoutes({ seeds = [1, 2, 3, 4, 7, 11, 23, 99], regionIds = REGIONS.map(region => region.id) } = {}) {
  return [
    { name: '均衡推进', options: {} },
    { name: '传播优先', options: { prepOrder: ['spread', 'spread'], postOrder: ['spread', 'defense', 'persuasion', 'defense', 'persuasion'] } },
    { name: '说服优先', options: { prepOrder: ['spread', 'persuasion'], postOrder: ['persuasion', 'defense', 'spread', 'defense', 'persuasion'] } },
  ].map(({ name, options }) => {
    const matches = regionIds.flatMap(regionId => seeds.map(seed => play({ regionId, seed, ...options })));
    return { route: name, matches: matches.length,
      won: matches.filter(state => state.phase === 'won').length,
      lost: matches.filter(state => state.phase === 'lost').length,
      unresolved: matches.filter(state => state.phase === 'playing').length,
      earliest: Math.min(...matches.map(state => state.time)), latest: Math.max(...matches.map(state => state.time)),
      fiveRounds: matches.filter(state => state.evidence.length === 5).length };
  });
}

// Controlled same-population comparison isolates combat from route luck and
// income. The normal play() simulations above never inject currency or levels.
export function compareCounterDefense() {
  return [0, 1, 2, 3].map(defense => {
    const state = createGame({ seed: 23 });
    state.regions.forEach(region => Object.assign(region, { red: 30, exposed: 30, blue: 40, seeded: true }));
    state.points = 100; queueEvidence(state); publishEvidence(state); state.levels.defense = defense;
    state.transit.active = []; state.transit.nextDeparture = Infinity;
    counterWithSource(state);
    while (!state.event.resolved) tick(state, .1);
    return { defense, clarificationSeconds: state.event.counteredAt, supportLost: Number((state.totals.relapsed / 6).toFixed(3)), damageReduction: `${Math.round(getCounterStatus(state).defenseReduction * 100)}%` };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.table(SCENARIOS.map(({ name, options }) => {
    const state = play(options);
    return { scenario: name, outcome: state.phase, time: state.time, truth: getStats(state).truth.toFixed(1), published: state.publications[0]?.time.toFixed(1), reachAtLaunch: state.publications[0]?.reached.toFixed(1), gain: state.publications[0]?.gain.toFixed(1), maxDrop: state.diagnostics.maxDrop.toFixed(1), redRiseSeconds: state.diagnostics.redRiseSeconds, levels: Object.values(state.levels).join('/'), evidence: state.evidence.length, cleared: getCampaignStatus(state).cleared };
  }));
  console.table([
    { policy: '及时应战', options: {} },
    { policy: '迟缓15秒', options: { counterDelay: 15 } },
    { policy: '无防守', options: { postOrder: ['persuasion', 'persuasion', 'spread'] } },
    { policy: '仅应战首波', options: { counterWaves: 1 } },
  ].flatMap(({ policy, options }) => play(options).diagnostics.waves.map(wave => ({
    policy, wave: wave.wave, started: wave.started.toFixed(1), targets: wave.targets,
    responseDelay: wave.responseDelay?.toFixed(1) ?? '未应战',
    startTruth: wave.startTruth.toFixed(1), lowTruth: wave.lowestTruth.toFixed(1),
    maxDrop: wave.maxDrop.toFixed(1), endTruth: wave.endTruth.toFixed(1),
    duration: wave.duration.toFixed(1), cleared: Boolean(wave.clearedAt),
  }))));
  console.table(scanEvidenceRoutes());
  console.table(compareCounterDefense());
  console.table([.5, 30, Infinity].map(collectEvery => {
    const matches = [1, 2, 3, 4, 7, 11, 23, 99].map(seed => play({ seed, collectEvery }));
    const range = values => values.length ? `${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}` : '未搜证';
    return { policy: Number.isFinite(collectEvery) ? `每${collectEvery}秒领取` : '不领取', wins: matches.filter(state => state.phase === 'won').length, firstSearch: range(matches.map(state => state.diagnostics.searchTimes[0]).filter(Number.isFinite)), secondSearch: range(matches.map(state => state.diagnostics.searchTimes[1]).filter(Number.isFinite)), fifthSearch: range(matches.map(state => state.diagnostics.searchTimes[4]).filter(Number.isFinite)), gameSeconds: range(matches.map(state => state.time)), clicks: range(matches.map(state => state.coinEconomy.clicks)), convertedPoints: range(matches.map(state => state.coinEconomy.pointsEarned)), peakWallet: range(matches.map(state => state.diagnostics.peakWallet)), maxPiles: Math.max(...matches.map(state => state.diagnostics.peakMapPiles)) };
  }));
  console.log(`时长为模拟游戏秒。共 ${ENEMY_WAVES.length} 波反扑；五轮费用 ${RULES.researchCosts.join('/')}，经费按当前调查阶段封顶；每轮自动选定证据，公布后再继续追查。金币来自实际传播，不注入资金。拒绝搜证或长期不公开的策略允许超过十分钟。2400秒仅为脚本诊断上限，未收束显示 playing/unresolved，不会伪造败局。`);
}
