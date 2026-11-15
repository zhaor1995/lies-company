import { RULES, REGIONS, CHANNELS, UPGRADE_DEFS, getStats, getCoinEconomy, getPacing, getTransports, getTransportStats, getResearchStatus, getCampaignStatus, getCounterStatus, getPublishPreview, upgradeCost } from './engine.js';
import { worldDuration, worldRemaining } from './world-time.js';

const NORMAL_HOLD_MS = 4000;
const ACTION_FEEDBACK_MS = 5000;
const COUNTER_COST = RULES.counterCost;
const UPGRADE_LABELS = { spread: '升级传播', persuasion: '增强说服', defense: '稳住阵地' };
const NORMAL_STAGES = new Set(['prepare-network', 'observe', 'recovery', 'public-growth', 'finish']);
const terminal = game => game && game.phase !== 'playing';
const pointGap = (cost, points) => Math.max(0, Math.ceil(cost - points - 1e-7));
const attention = (target, tone = 'neutral') => ({ target, tone });
const action = (type, label, options = {}) => ({ type, label, disabled: false, ...options });
const view = (id, stage, title, body, primaryAction = null, focus = null) => ({ id, stage, title, body, primaryAction, attention: focus });
const waitText = (gap, income) => income > 0 ? `${worldRemaining(gap / income)}攒够。` : '等待行动点收入恢复。';

function pointFunding(game, cost, income, purpose) {
  const economy = getCoinEconomy(game), onMap = (game.coinDrops || []).reduce((sum, drop) => sum + drop.value, 0);
  if (!economy.cashoutActive || !onMap) return { text: waitText(cost - game.points, income), target: 'points' };
  const convertible = Math.floor((game.coins + onMap) / economy.exchangeRate);
  const remaining = pointGap(cost, game.points + convertible);
  const text = !convertible ? `点地图金币先收钱，凑满 ${economy.exchangeRate} 枚换 1 行动点。`
    : !remaining ? `点地图金币可换 ${convertible} 行动点，够做${purpose}。`
    : `点地图金币先补 ${convertible} 行动点，${purpose}还差 ${remaining} 点。`;
  return { text, target: 'coins' };
}

function upgradeAction(game, key, label) {
  const cost = upgradeCost(game, key);
  if (cost == null) return null;
  return action('upgrade', label || `${UPGRADE_LABELS[key]} · ${cost} 点`, { key, cost, disabled: game.points + 1e-7 < cost });
}

function intentDetails(game, intent) {
  if (!intent) return null;
  if (intent.type === 'upgrade') {
    if (!UPGRADE_DEFS[intent.key]) return null;
    const cost = upgradeCost(game, intent.key);
    return cost == null ? null : { cost, label: UPGRADE_LABELS[intent.key], target: `upgrade-${intent.key}`, action: upgradeAction(game, intent.key) };
  }
  if (intent.type === 'publish' && getPublishPreview(game).available) {
    return { cost: 0, label: '公布这份证据', target: 'publish', action: action('publish', '公布这份证据', { cost: 0 }) };
  }
  if (intent.type === 'counter' && game.event && !game.event.resolved && !getCounterStatus(game).active) {
    return { cost: COUNTER_COST, label: '发起澄清', target: 'enemy', action: action('counter', `发起澄清 · ${COUNTER_COST} 点`, { cost: COUNTER_COST }) };
  }
  if (intent.type === 'research') {
    const research = getResearchStatus(game);
    if (research.phase !== 'ready' || (intent.roundId && intent.roundId !== research.roundId)) return null;
    return { cost: research.cost, currency: 'coins', label: `第 ${research.roundNumber} 轮搜证`, target: 'search', action: action('open-search', '回到寻找证据', { cost: research.cost, currency: 'coins' }) };
  }
  return null;
}

function enemyJourney(game, stats, context, nowMs, pacing) {
  const event = game.event;
  if (!event || event.resolved) return null;
  const status = getCounterStatus(game), research = getResearchStatus(game);
  if (status.active) {
    if (research.available) return view(`enemy:research:${research.roundId}`, 'enemy-research', '新证据能让澄清更快', `第 ${status.waveNumber} 波澄清 ${Math.floor(status.progress)}%。公布新证据可再推进 15%，也会让更强一波进入候场。`, action('open-search', '沿线索继续查', { cost: research.cost, currency: 'coins' }), attention('search', 'success'));
    const defense = upgradeAction(game, 'defense');
    const body = defense && !defense.disabled ? `稳住阵地可减少损失，并把剩余时间从${worldRemaining(status.remaining)}缩短至${worldRemaining(status.remaining * status.rate / status.nextRate)}。` : `${worldRemaining(status.remaining)}完成；攻击会随进度减弱。${game.research ? '正在查的证据公布后，还能推进 15%。' : '收金币继续查证，公布后也能推进澄清。'}`;
    return view(`enemy:counter-running:${event.id}`, 'enemy-counter-running', `第 ${status.waveNumber} 波 · 澄清 ${Math.floor(status.progress)}%`, body, defense && !defense.disabled ? defense : null, attention(defense && !defense.disabled ? 'upgrade-defense' : 'enemy', 'warning'));
  }
  const gap = pointGap(COUNTER_COST, game.points);
  const counter = action('counter', gap ? `发起澄清 · 还差 ${gap} 点` : `发起澄清 · ${COUNTER_COST} 点`, { cost: COUNTER_COST, disabled: gap > 0 });
  const funding = gap ? pointFunding(game, COUNTER_COST, stats.income, '发起澄清') : null;
  const focus = attention(funding?.target || 'enemy', 'warning');
  if (game.levels.defense >= 1) {
    const recent = context.lastAction;
    const justDefended = recent?.type === 'upgrade' && recent.key === 'defense' && Number.isFinite(recent.at) && nowMs >= recent.at && nowMs - recent.at < ACTION_FEEDBACK_MS;
    const body = `防守减损 ${Math.round(status.defenseReduction * 100)}%，澄清只需${worldRemaining(100 / status.rate)}。${gap ? `发起还差 ${gap} 点，${funding.text}` : '现在发起，逐步削弱这次反扑。'}`;
    return view(justDefended ? `enemy:defense-feedback:${recent.at}` : `enemy:defended:${event.stage}`, justDefended ? 'enemy-defense-feedback' : 'enemy-defended', '阵地守住，澄清也能更快', body, counter, focus);
  }
  if (gap > 0) {
    const body = `对手仍在抢人；发起澄清还差 ${gap} 点，${funding.text}`;
    return view('enemy:funding', 'enemy-funding', funding.target === 'coins' ? '收金币，补澄清经费' : '留点数，准备发起澄清', body, counter, focus);
  }
  const warning = event.stage === 'warning';
  const body = `${warning ? `${worldRemaining(event.remaining)}后发动主攻；` : ''}澄清需要${worldRemaining(100 / status.rate)}，越早发起，冲击越小。稳住阵地可减损、提速。`;
  return view(`enemy:${event.id}:${warning ? 'warning' : 'active'}`, warning ? 'enemy-warning' : 'enemy-active', `第 ${status.waveNumber} 波 · ${status.waveName}`, body, counter, focus);
}

function criticalNetworkJourney(game, stats, pacing) {
  if (!pacing.networkCritical) return null;
  const job = game.research, choices = [];
  const threatened = game.event && !game.event.resolved;
  const addUpgrade = (key, detail) => {
    const purchase = upgradeAction(game, key);
    if (purchase) choices.push({ action: purchase, detail, target: `upgrade-${key}` });
  };
  addUpgrade('defense', '加强防守，减少全网回流。');
  if (threatened && !getCounterStatus(game).active) {
    choices.push({ action: action('counter', `发起澄清 · ${COUNTER_COST} 点`, { cost: COUNTER_COST, disabled: pointGap(COUNTER_COST, game.points) > 0 }), detail: '发起澄清会逐步化解这次反扑，防守能减损并加快进度。', target: 'enemy' });
  }
  if (getPublishPreview(game).available) {
    const preview = getPublishPreview(game);
    if (preview.gain >= 0.1) choices.push({ action: action('publish', '公布这份证据', { cost: preview.cost, disabled: !preview.available }), detail: `公布实锤可增加 ${preview.gain.toFixed(1)} 个百分点并加快说服，也会招来反扑。`, target: 'publish' });
  }
  const growth = stats.exposed <= stats.truth || game.levels.spread <= game.levels.persuasion ? ['spread', 'persuasion'] : ['persuasion', 'spread'];
  for (const key of growth) addUpgrade(key, key === 'spread' ? '加强传播，让更多人听见真相。' : '增强说服，把观望者变成支持者。');
  if (!job) {
    const research = getResearchStatus(game);
    if (research.phase === 'ready') {
      const cost = research.cost;
      choices.push({ action: action('open-search', '寻找证据', { cost, currency: 'coins', disabled: !research.available }), detail: '寻找证据需要时间，先保住现有受众。', target: 'search' });
    }
  }
  const directChoices = choices.filter(choice => choice.action.type !== 'open-search');
  const chosen = choices.find(choice => !choice.action.disabled) || [...(directChoices.length ? directChoices : choices)].sort((a, b) => a.action.cost - b.action.cost)[0];
  const status = `仅 ${stats.reached.toFixed(1)}% 听过真相。`;
  const purpose = chosen?.action.key ? UPGRADE_LABELS[chosen.action.key] : chosen?.action.type === 'counter' ? '发起澄清' : '公布实锤';
  const needsCoins = chosen?.action.disabled && chosen.action.currency === 'coins';
  const funding = chosen?.action.disabled && !needsCoins ? pointFunding(game, chosen.action.cost, stats.income, purpose) : null;
  const waiting = !chosen ? (getTransports(game).some(trip => trip.carryingTruth) ? '真相仍在途中，成功落地还有机会翻盘。' : (job?.kind === 'live' ? '正在联网寻找材料，先守住已有受众。' : '等待核查结果，争取新的支持。')) : needsCoins ? `搜证还差 ${pointGap(chosen.action.cost, game.coins)} 金币，点击地图金币收钱。` : funding ? `还差 ${pointGap(chosen.action.cost, game.points)} 点，${funding.text}` : chosen.detail;
  return view(`network:critical:${chosen?.action.type || 'watch'}:${chosen?.action.key || ''}`, 'network-critical', '传播网络濒危', status + waiting, chosen?.action || null, attention(needsCoins ? (game.coinDrops.length ? 'coins' : 'map') : funding?.target || chosen?.target || (job ? 'research-progress' : 'map'), 'warning'));
}

function publicLossJourney(game, stats) {
  if (game.operationPhase !== 'public' || stats.netRate >= -0.015) return null;
  const defense = upgradeAction(game, 'defense');
  const growth = (stats.exposed > 1 ? ['persuasion', 'spread'] : ['spread', 'persuasion'])
    .map(key => upgradeAction(game, key)).filter(Boolean);
  const chosen = defense || growth.find(candidate => !candidate.disabled) || growth.sort((a, b) => a.cost - b.cost)[0];
  const funding = chosen?.disabled ? pointFunding(game, chosen.cost, stats.income, chosen.key === 'defense' ? '加强防守' : UPGRADE_LABELS[chosen.key]) : null;
  let body;
  if (!chosen) body = '能力已满，真相仍在传播，留意受众能否回升。';
  else if (funding) body = `${chosen.key === 'defense' ? '加强防守' : UPGRADE_LABELS[chosen.key]}还差 ${pointGap(chosen.cost, game.points)} 点，${funding.text}`;
  else if (chosen.key === 'defense') body = '流失超过新增支持，先加强防守，减少回流。';
  else if (chosen.key === 'persuasion') body = '防守已满，增强说服，把观望者争取过来。';
  else body = '防守已满，提升传播，让更多人听见真相。';
  return view(`public:loss:${chosen?.key || 'watch'}`, 'public-loss', '支持者正在流失', body, chosen || null, attention(funding?.target || (chosen ? `upgrade-${chosen.key}` : 'map'), 'warning'));
}

function feedbackJourney(game, context, nowMs) {
  const recent = context.lastAction;
  if (!recent || !Number.isFinite(recent.at) || nowMs < recent.at || nowMs - recent.at >= ACTION_FEEDBACK_MS) return null;
  // Research and publication already have their own stronger live-state views.
  if (recent.type !== 'upgrade' || !UPGRADE_DEFS[recent.key]) return null;
  const text = {
    spread: ['传播增强', '绿色转载更容易带上真相，成功落地后会扩大当地受众。'],
    persuasion: ['说服增强', '听过真相的人，现在更容易相信并继续传播。'],
    defense: ['阵地加固', '流失和转载拦截都减少，澄清推进更快。已经失去的人群仍需争回。'],
  }[recent.key];
  return view(`action:${recent.type}:${recent.key}:${recent.at}`, 'action-feedback', text[0], text[1], null, attention('map', 'success'));
}

function noAffordableAction(game) {
  const costs = Object.keys(UPGRADE_DEFS).map(key => upgradeCost(game, key)).filter(cost => cost != null);
  if (getPublishPreview(game).available) costs.push(0);
  const cheapest = Math.min(...costs);
  return Number.isFinite(cheapest) && game.points + 1e-7 < cheapest ? cheapest : null;
}

function coinJourney(game, economy, research) {
  const total = (game.coinDrops || []).reduce((sum, drop) => sum + drop.value, 0);
  if (!total) return null;
  const gap = research.cost == null ? 0 : pointGap(research.cost, game.coins);
  const body = economy.cashoutActive ? `地图上有 ${total} 金币；每 ${economy.exchangeRate} 金币自动换 1 行动点。`
    : research.phase === 'ready' && gap ? `地图上有 ${total} 金币，搜证还差 ${gap} 金币。` : '点击地图金币收钱，给下一轮搜证攒经费。';
  return view('coins:collect', 'collect-coins', '流量到账，点金币收钱', body, null, attention('coins', 'success'));
}

function transportJourney(game) {
  const arrivals = game.transportEvents.filter(event => event.type === 'first-seed' && event.firstSeed);
  const firstArrival = arrivals[0];
  if (firstArrival) {
    if (game.time - firstArrival.time > 10) return null;
    const destination = REGIONS.find(region => region.id === firstArrival.to)?.name || firstArrival.to;
    return view(`transport:first-arrival:${firstArrival.id}`, 'transport-arrival', `真相首次抵达${destination}`, '当地已出现第一批受众，真相可以继续传往下一站。', null, attention('map', 'success'));
  }
  if (getTransportStats(game).firstReached > 1) return null;
  const trip = getTransports(game).filter(item => item.carryingTruth).sort((a, b) => a.arrivesAt - b.arrivesAt)[0];
  if (!trip) return null;
  const destination = REGIONS.find(region => region.id === trip.to)?.name || trip.to;
  const channel = CHANNELS.find(item => item.id === trip.channelId)?.name || '媒体';
  return view(`transport:first-trip:${trip.id}`, 'transport-travelling', `真相正在前往${destination}`, `${channel}${worldRemaining(trip.arrivesAt - game.time)}后抵达，成功落地才能在当地传开。`, null, attention('map'));
}

function derive(game, context, nowMs) {
  if (!game) return view('start', 'start', '侦探，选一个调查起点', `循着线索找证据，让 ${RULES.winTruth}% 的人站在你这边，就能夺回世界。`, action('start', '出发，拯救世界'), attention('map'));
  if (terminal(game)) {
    const won = game.phase === 'won';
    if (won && game.research) return view('result:settling', 'result-settling', '胜利已锁定，收录最后一份材料', '反扑已停止，通关时间已记下。已付费的调查还在继续，完成后自动收入结案战报，无需再公布。', null, attention('research-progress', 'success'));
    const collapsed = game.defeatReason === 'network-collapse';
    return view(`result:${game.phase}`, 'result', won ? '世界接受了你的反驳' : collapsed ? '传播网络已经瓦解' : '这一局结束了', won ? `历经${worldDuration(game.victoryAt ?? game.time)}，人们已把原观点当作谎言。回看这次调查的完整战报。` : collapsed ? '受众已经流失殆尽，下一局试着更早公布实锤或加强防守。' : '谎言公司仍掌控着世界。回看线索，再调查一次。', action('restart', '再试一局'), attention('map', won ? 'success' : 'neutral'));
  }
  const stats = getStats(game), pacing = getPacing(game), research = getResearchStatus(game), economy = getCoinEconomy(game), campaign = getCampaignStatus(game);
  if (context.modalOpen) return view('modal', 'modal', '战局已暂停', '完成选择后回到地图。', null, null);
  if (context.paused) return view('paused', 'paused', '战局已暂停', '准备好后继续，世界会从这里接着运行。', action('resume', '继续行动'), attention('map'));
  if (research.phase === 'ready-to-publish') {
    const result = research.pendingEvidence, preview = getPublishPreview(game);
    const stored = result?.storedAt != null;
    return view(`research:publish:${research.roundId}:${stored ? 'stored' : 'new'}`, 'evidence-ready', stored ? '证据已收入囊中' : '新证据已到', stored ? `《${preview.title}》已保存。公布后能力生效，也能继续追查下一条线索。` : `《${preview.title}》已整理好。看完就能甩出实锤，也可以先收好。`, action(stored ? 'publish' : 'open-search', stored ? '公布这份证据' : '查看证据', { cost: 0 }), attention(stored ? 'publish' : 'search', 'success'));
  }
  const critical = criticalNetworkJourney(game, stats, pacing);
  if (critical) return critical;
  const enemy = enemyJourney(game, stats, context, nowMs, pacing);
  if (enemy) return enemy;
  if (campaign.recoveryRemaining > 0) {
    const next = (game.enemyWaves || []).find(wave => wave.stage === 'queued');
    const after = next ? `冲到 ${RULES.winTruth}% 即获胜；若仍未达到，随后迎战第 ${next.waveNumber} 波「${next.waveName}」。` : `冲到 ${RULES.winTruth}% 即获胜，补充证据、升级能力能加快进度。`;
    return view(`public:recovery:${campaign.cleared}`, 'recovery', `第 ${campaign.cleared} 波击破，轮到你反攻`, `接下来${worldRemaining(campaign.recoveryRemaining)}，说服 ×2.2、传播 ×1.35。${after}`, null, attention('map', 'success'));
  }
  const losses = publicLossJourney(game, stats);
  if (losses) return losses;
  if (game.researchError && research.phase === 'ready') {
    return view(`research:error:${research.roundId}`, 'research-error', '搜证未完成，金币已退回', `${game.researchError.message} ${game.investigation ? '本轮机会还在，可以重试或换一条调查方向。' : '本轮搜证机会还在，可以修改问题再查。'}`, action('open-search', game.investigation ? '选择方向，重新查证' : '调整问题，重新搜索', { cost: research.cost, currency: 'coins' }), attention('search', 'warning'));
  }
  const coins = coinJourney(game, economy, research);
  if (coins && economy.clicks === 0) return coins;
  if (context.firstMovePending) {
    return view('first-move', 'first-move', '侦探，先把声音传出去', '提升传播，让往来的媒体更容易带上真相。', upgradeAction(game, 'spread', `升级传播 · ${upgradeCost(game, 'spread')} 点`), attention('upgrades'));
  }

  if (research.phase === 'plan-error') return view('research:plan-error', 'research-plan-error', '调查方向暂未整理好', '没有扣金币。重新整理一次，期间仍可以收金币、升级传播。', action('open-search', '重新整理调查方向'), attention('search', 'warning'));
  if (research.phase === 'refreshing') return view('research:refreshing', 'research-refreshing', '正在换两个调查方向', '沿着已有材料换个角度，准备好会提醒你。期间可以收金币、升级传播。', null, attention('search'));
  if (research.phase === 'planning') {
    if (coins) return coins;
    const spread = upgradeAction(game, 'spread');
    return view('research:planning', 'research-planning', '正在找值得查的方向', '先升级传播、点地图金币收钱，方向准备好会提醒你。', spread && !spread.disabled ? spread : null, attention('map'));
  }

  // Search remains visible in its own control while urgent threats lead guidance.
  // Opening a round acknowledges its invitation, not an unclaimed material.
  if (research.available) {
    const followUp = research.roundNumber > 1, unread = Number(context.researchSeenRound || 0) < research.roundNumber;
    const question = game.investigation ? (followUp ? '根据本轮发现继续查。两个方向，选一条补上关键缺口。' : '两个调查方向，选一条开查。公布查到的证据，就能增强能力。') : followUp && research.query ? research.query : game.researchMode === 'live' ? '从月球用肉眼能看见长城吗？选一条线索，查到后直接公布。' : '选一条方向，查清照片出处。';
    return view(`research:ready:${research.roundId}`, unread ? 'new-clue' : 'research-ready', followUp ? '经费够了，沿线索继续查' : '金币够了，去找实锤', question, action('open-search', followUp ? '沿线索继续追问' : '寻找证据', { cost: research.cost, currency: 'coins' }), attention('search', 'success'));
  }

  if (game.research) {
    if (coins) return coins;
    const job = game.research;
    if (job.kind === 'live') return view(`researching:${research.roundId}`, 'researching', research.roundNumber > 1 ? '正在联网核对后续线索' : '正在联网核对来源', '本轮经费已付。等待材料时可以升级、观察传播，结果到手后可直接公布。', null, attention('research-progress'));
    return view(`researching:${research.roundId}`, 'researching', research.roundNumber > 1 ? '正在核对后续线索' : '正在寻找证据', `${worldRemaining(job.duration - job.elapsed)}后完成，期间可以继续投资能力。结果到手后可直接公布。`, null, attention('research-progress'));
  }

  const intent = intentDetails(game, context.intent);
  if (intent) {
    const gap = pointGap(intent.cost, intent.currency === 'coins' ? game.coins : game.points);
    if (intent.currency === 'coins' && gap > 0) return coins || view('coins:funding', 'coin-funding', `搜证还差 ${gap} 金币`, '传播会赚到流量金币，点击地图金币收钱。', null, attention('map'));
    if (gap > 0 && coins) return coins;
    if (gap > 0) return view(`funds:${context.intent.type}:${context.intent.key || ''}`, 'funding', `${intent.label}还差 ${gap} 点`, `需要 ${intent.cost} 点，${waitText(intent.cost - game.points, stats.income)}`, { ...intent.action, disabled: true }, attention('points'));
    // A newly affordable intended action must immediately replace its wait hint.
    return view(`ready:${context.intent.type}:${context.intent.key || ''}`, 'intent-ready', '点数够了', `现在可以${intent.label}。`, { ...intent.action, disabled: false }, attention(intent.target));
  }

  if (research.phase === 'locked') {
    if (coins) return coins;
    if (research.gate === 'publication') {
      const preview = getPublishPreview(game);
      return view('research:publication', 'followup-publication', '先把这份证据公布出去', '公布后能力生效，下一条调查线索也会开放。', action('publish', '公布这份证据', { cost: 0, disabled: !preview.available }), attention('publish'));
    }
    const spread = upgradeAction(game, 'spread');
    return view('research:network', 'followup-network', '让线索传到更多地方', `真相已触达 ${research.reachedRegions}/${research.requiredRegions} 个地区；达到目标就能继续追查。`, spread && !spread.disabled ? spread : null, attention(spread && !spread.disabled ? 'upgrade-spread' : 'map'));
  }

  const feedback = feedbackJourney(game, context, nowMs);
  if (feedback) return feedback;
  const cheapest = noAffordableAction(game);
  if (cheapest != null) {
    if (coins) return coins;
    const gap = pointGap(cheapest, game.points);
    const note = economy.cashoutActive ? `流量金币每 ${economy.exchangeRate} 枚换 1 行动点。` : '地图金币出现后，点一下就能攒搜证经费。';
    return view('funds:auto', 'funding-auto', '传播也能赚经费', `下一步还差 ${gap} 行动点；${note}`, null, attention('map'));
  }
  if (Object.values(game.levels).every(level => level === 0)) {
    return view('first-upgrade', 'first-upgrade', '让真相传出去', '提升传播，让更多转载带上真相。', upgradeAction(game, 'spread', `升级传播 · ${upgradeCost(game, 'spread')} 点`), attention('upgrades'));
  }
  if (coins) return coins;
  const transport = transportJourney(game);
  if (transport) return transport;

  if (game.operationPhase !== 'public') {
    const spread = upgradeAction(game, 'spread', '继续提升传播');
    const next = spread && !spread.disabled ? spread : research.available ? action('open-search', '寻找证据') : null;
    return view('prepare:network', 'prepare-network', '让更多人听见真相', '提升传播、收金币查证，找到证据后就能公布。', next, attention('map'));
  }

  if (stats.truth >= 85) {
    const persuasion = upgradeAction(game, 'persuasion', '增强说服');
    return view('public:finish', 'finish', '稳住优势，夺回世界', `支持率达到 ${RULES.winTruth}% 即获胜，还差 ${Math.max(0.1, RULES.winTruth - stats.truth).toFixed(1)} 个百分点。增强说服可加快收尾。`, persuasion && !persuasion.disabled ? persuasion : null, attention('map', 'success'));
  }
  const persuasion = upgradeAction(game, 'persuasion', '继续增强说服');
  return view('public:growth', 'public-growth', pacing.heat > 0 ? '继续争取支持者' : '把观望者变成支持者', pacing.heat > 0 ? '增强说服能巩固支持，防守能减少全网回流。' : '增强说服，让听过真相的人更快相信。', persuasion && !persuasion.disabled ? persuasion : null, attention('map'));
}

function canHold(previous, game, context, candidate, nowMs) {
  if (!previous || !NORMAL_STAGES.has(previous.stage) || !NORMAL_STAGES.has(candidate.stage)) return false;
  if (!Number.isFinite(previous.shownAt) || typeof previous.id !== 'string') return false;
  if (nowMs < previous.shownAt || nowMs - previous.shownAt >= NORMAL_HOLD_MS) return false;
  if (context.lastAction?.at >= previous.shownAt) return false;
  if (previous.id.startsWith('prepare:') && game.operationPhase === 'public') return false;
  const priorAction = previous.primaryAction;
  if (priorAction?.type === 'upgrade') {
    const cost = upgradeCost(game, priorAction.key);
    if (cost == null || cost !== priorAction.cost || game.points + 1e-7 < cost) return false;
  }
  if (priorAction?.type === 'publish' && !getPublishPreview(game).available) return false;
  if (priorAction?.type === 'open-search' && !getResearchStatus(game).available) return false;
  return true;
}

/** Pure UI guidance. It never buys, pauses, publishes, reads the clock, or
 * chooses an evidence outcome. `nowMs` and `lastAction.at` share milliseconds.
 * The caller may pass the previous result back to keep ordinary hints steady.
 */
export function getJourney(game, context = {}) {
  const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : (game?.time || 0) * 1000;
  const candidate = derive(game, context, nowMs);
  const previous = context.previous;
  if (previous?.id === candidate.id) return { ...candidate, shownAt: previous.shownAt ?? nowMs };
  if (canHold(previous, game, context, candidate, nowMs)) return { ...previous };
  return { ...candidate, shownAt: nowMs };
}
