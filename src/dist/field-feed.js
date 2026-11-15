import { REGIONS, getEvidenceMaterial } from './engine.js';
import { CHANNELS } from './media-network.js';
import { MEDIA_STORIES } from './media-content.js';
import { RESEARCH_EVENTS, RESEARCH_MEMES } from './research-content.js';

const feedEventTypes = new Set(['publication', 'warning', 'reinforcement', 'backlash', 'forgery', 'milestone', 'win', 'lose', 'counter-start']);
const feedResearchTypes = new Set(['research', 'evidence', 'research-failed', 'evidence-event']);
const feedStageNames = Object.freeze({ searching: '检索线索', sources: '材料已找到', analyzing: '核对材料', reporting: '整理报告', repairing: '补全报告', complete: '报告已完成', failed: '调查暂未完成' });
const feedRegionName = id => REGIONS.find(region => region.id === id)?.name || id;
const feedChannelName = id => CHANNELS.find(channel => channel.id === id)?.name || id;
const feedTimestamp = value => typeof value === 'number' ? value : Date.parse(value);
const investigationNodes = Object.freeze([
  { id: 'lead', label: '锁定线索', actor: 'Agent 调查员' },
  { id: 'search', label: '检索来源', actor: '元宝搜索' },
  { id: 'verify', label: '核对材料', actor: 'Agent 调查员' },
  { id: 'report', label: '证据报告', actor: '调查档案' },
]);
const investigationStageNode = Object.freeze({ waiting: 'lead', searching: 'search', sources: 'verify', analyzing: 'verify', repairing: 'verify', reporting: 'report', complete: 'report' });
const investigationStepActor = stage => ['searching', 'sources'].includes(stage) ? '元宝搜索' : ['reporting', 'complete'].includes(stage) ? '调查档案' : 'Agent 调查员';
const investigationExecutionStage = event => event?.stage === 'repairing' && event.retry === true ? event.retryStage === 'searching' ? 'searching' : 'analyzing' : event?.stage;

export function createFieldFeed() {
  return { entries: [], revision: 0, _byId: new Map(), _seen: new Set(), _sequence: 0, _transportId: 0 };
}

function feedPatch(store, entry, values) {
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || JSON.stringify(entry[key]) === JSON.stringify(value)) continue;
    entry[key] = value;
    changed = true;
  }
  if (changed) { entry.revision = (entry.revision || 0) + 1; store.revision++; }
  return entry;
}

// IDs make repeated renders harmless. Time and insertion order never change
// when a live investigation card receives another update.
export function addFieldMessage(store, input) {
  const id = String(input.id || `message:${++store._sequence}`);
  let entry = store._byId.get(id);
  if (!entry) {
    entry = { id, kind: 'message', time: Number.isFinite(input.time) ? input.time : 0, title: '', detail: '', tone: 'neutral', order: ++store._sequence, revision: 0 };
    store._byId.set(id, entry);
    store.entries.push(entry);
    store.entries.sort((a, b) => a.time - b.time || a.order - b.order);
  }
  const { time, order, revision, ...content } = input;
  return feedPatch(store, entry, content);
}

function feedProgressSources(sources) {
  const seen = new Set(), result = [];
  for (const source of sources) {
    if (!source || typeof source.title !== 'string' || !source.title.trim() || typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url) || /[\u0000-\u001f\u007f]/.test(source.url)) continue;
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
    const key = url.origin + url.pathname + url.search;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = { title: source.title.trim(), url: url.href };
    for (const field of ['organization', 'date']) if (typeof source[field] === 'string' && source[field].trim()) item[field] = source[field].trim();
    result.push(item);
  }
  return result;
}

function feedProgressStep(event, firstAt) {
  const stage = event.stage, at = feedTimestamp(event.at);
  if (!feedStageNames[stage]) return null;
  const retry = stage === 'repairing' && event.retry === true;
  let detail = '';
  if (stage === 'searching') detail = event.query || '';
  if (stage === 'sources' && Number.isFinite(event.sourceCount)) detail = `找到 ${event.sourceCount} 条来源`;
  if (stage === 'analyzing') detail = '对照出处，判断材料与这条线索是否相关';
  if (stage === 'reporting') detail = '整理证据，选出适合当前战局的一份材料';
  if (stage === 'repairing') detail = retry ? '连接暂时不稳，正在重试' : '材料还需补充，正在继续整理';
  if (stage === 'failed') detail = '这条线索暂时没查完，可以重试';
  return { id: `step:${event.seq}`, seq: event.seq, stage, title: retry ? '正在重试' : feedStageNames[stage], detail,
    ...(retry ? { retry: true, retryStage: investigationExecutionStage(event) } : {}),
    ...(stage === 'sources' && Array.isArray(event.sources) ? { sources: feedProgressSources(event.sources) } : {}),
    ...(Number.isInteger(event.sourceCount) && event.sourceCount >= 0 ? { sourceCount: event.sourceCount } : {}),
    ...(Number.isInteger(event.searchAttempt) && event.searchAttempt > 0 ? { searchAttempt: event.searchAttempt } : {}),
    ...(Number.isFinite(at) && Number.isFinite(firstAt) ? { elapsed: Math.max(0, (at - firstAt) / 1000) } : {}) };
}

// The sidebar and the expanded card share the same public milestones. A
// follow-up search really returns to search; elapsed time cannot advance it.
export function getInvestigationFlow(entry = {}) {
  const status = ['completed', 'failed'].includes(entry.status) ? entry.status : 'running';
  const events = (entry._events || []).filter(event => feedStageNames[event.stage]).slice().sort((a, b) => a.seq - b.seq);
  const steps = (entry.steps || []).filter(step => feedStageNames[step.stage]).map(({ sources, ...step }) => ({ ...step, actor: investigationStepActor(investigationExecutionStage(step)),
    ...(step.stage === 'sources' && Array.isArray(sources) ? { sources: feedProgressSources(sources) } : {}),
  }));
  const recorded = events.length ? events : steps;
  const last = recorded.at(-1);
  const lastActive = [...recorded].reverse().find(event => investigationStageNode[event.stage] && event.stage !== 'complete');
  const recordedStage = last?.stage || (feedStageNames[entry.stage] ? entry.stage : 'waiting');
  const stage = status === 'completed' ? 'complete' : status === 'failed' ? 'failed' : recordedStage;
  const sourceEvent = [...recorded].reverse().find(event => ['sources', 'complete'].includes(event.stage) && Number.isInteger(event.sourceCount) && event.sourceCount >= 0)
    || [...recorded].reverse().find(event => Number.isInteger(event.sourceCount) && event.sourceCount >= 0);
  const sourceCount = sourceEvent?.sourceCount ?? (Number.isInteger(entry.sourceCount) && entry.sourceCount >= 0 ? entry.sourceCount : null);
  const searches = recorded.filter(event => event.stage === 'searching');
  const attempts = recorded.map(event => event.searchAttempt).filter(attempt => Number.isInteger(attempt) && attempt > 0);
  const searchCount = searches.length || attempts.length ? Math.max(searches.length, ...attempts) : null;
  const followup = searchCount != null && searchCount > 1;
  const failureStage = investigationExecutionStage(lastActive) || 'waiting';
  const activeNode = status === 'completed' ? null : investigationStageNode[stage === 'failed' ? failureStage : investigationExecutionStage(last) || stage] || 'lead';
  const activeIndex = investigationNodes.findIndex(node => node.id === activeNode);
  const nodes = investigationNodes.map((node, index) => ({ ...node,
    state: status === 'completed' || index < activeIndex ? 'done' : index === activeIndex ? status === 'failed' ? 'failed' : 'active' : 'queued',
  }));
  const labels = {
    waiting: ['正在提交调查', '线索已选定，正在提交这次调查。'],
    searching: [followup ? '元宝补查中' : '元宝检索中', searches.at(-1)?.query || searches.at(-1)?.detail || entry.query || '正在检索与线索相关的来源。'],
    sources: ['核对材料中', sourceCount == null ? '来源已返回，正在核对材料。' : `已找到 ${sourceCount} 条来源，正在核对与线索的关系。`],
    analyzing: ['核对材料中', '对照出处，判断材料与这条线索是否相关。'],
    repairing: ['补全报告中', '报告还需要补全，调查员正在继续整理。'],
    reporting: ['整理报告中', '整理证据，选出适合当前战局的一份材料。'],
    complete: status === 'completed' ? ['证据已到', entry.finding || entry.detail || '调查已完成，证据已存档。'] : ['正在接收报告', '报告已整理，正在接收本轮证据。'],
    failed: status === 'failed' ? [entry.interrupted ? '调查已中止' : '调查未完成', entry.detail || '这条线索暂时没查完，可以重试。'] : ['正在接收结果', '本轮执行已结束，正在接收调查结果。'],
  };
  let [buttonLabel, detail] = labels[stage] || labels.waiting;
  if (stage === 'repairing' && last?.retry === true) [buttonLabel, detail] = ['正在重试', '连接暂时不稳，正在重试'];
  if (entry.demo && status === 'running') [buttonLabel, detail] = ['核对预置资料', '正在整理本轮预置材料。'];
  if (stage === 'failed') {
    for (const step of steps) if (step.stage === 'failed') {
      step.actor = investigationNodes.find(node => node.id === activeNode)?.actor || 'Agent 调查员';
      if (status === 'running') step.title = '正在接收结果';
      step.detail = detail;
    }
  }
  return { status, stage, buttonLabel, title: buttonLabel, detail, activeNode, sourceCount, searchCount, followup, nodes, steps, hasRecordedSteps: steps.length > 0 };
}

export function updateFieldInvestigation(store, input) {
  if (!input.requestId) return null;
  const requestId = String(input.requestId), roundId = input.roundId || (input.round ? `round-${input.round}` : undefined);
  let entry = store.entries.find(item => item.kind === 'investigation' && item.requestId === requestId);
  // A demo job or recovered engine log can precede the first network poll.
  if (!entry) entry = store.entries.find(item => item.kind === 'investigation' && item.recovered && item.status === 'running' && item.roundId === roundId && item.query === input.query && item.time === input.time);
  if (!entry) entry = addFieldMessage(store, { id: `investigation:${requestId}`, kind: 'investigation', time: input.time, requestId, round: input.round, roundId, query: input.query || '', steps: [], status: 'running', stage: null });
  const interrupted = Boolean(entry.interrupted || input.interrupted && entry.status !== 'completed');
  const events = [...(entry._events || [])];
  for (const event of interrupted ? [] : input.events || []) if (Number.isFinite(event.seq) && !events.some(existing => existing.seq === event.seq)) {
    const { sources, ...milestone } = event;
    events.push({ ...milestone, ...(event.stage === 'sources' && Array.isArray(sources) ? { sources: feedProgressSources(sources) } : {}) });
  }
  events.sort((a, b) => a.seq - b.seq);
  const firstAt = feedTimestamp(events[0]?.at);
  const steps = events.map(event => feedProgressStep(event, firstAt)).filter(Boolean);
  const status = interrupted ? 'failed' : entry.status !== 'running' ? entry.status : input.status || entry.status;
  const result = interrupted ? null : input.result;
  const sourceEvent = [...events].reverse().find(event => Number.isFinite(event.sourceCount));
  const round = input.round || entry.round || Number(roundId?.match(/\d+$/)?.[0]);
  const published = result ? result.publishedAt != null || Boolean(!result.selectedId && result.promotedId) : Boolean(entry.published);
  const stored = result ? result.storedAt != null : entry.publicationState === '已收入囊中';
  const phase = status === 'completed' ? published ? '已公布' : stored ? '已收入囊中' : '证据已到' : status === 'failed' ? interrupted ? '已中止' : '可以重试' : input.demo ? '核对预置资料' : '正在查证';
  const error = typeof input.error === 'string' && /[\u4e00-\u9fff]/.test(input.error) ? input.error : '这条线索暂时没查完，金币已退回，可再次调查。';
  const selectedId = result?.selectedId || result?.promotedId;
  const material = result?.materials?.find(item => item.id === selectedId);
  const materialCount = result ? selectedId ? 1 : 0 : entry.materialCount;
  const evidenceTitle = material?.insight?.headline || material?.title || entry.evidenceTitle;
  const finding = material?.insight?.explanation || material?.finding || result?.finding || result?.detail || entry.finding;
  const values = { requestId, round, roundId, query: input.query || entry.query, status,
    title: `${round ? `第 ${round} 轮调查` : '沿线调查'} · ${phase}`,
    detail: interrupted ? '本局已结束，这轮调查已中止。' : status === 'completed' ? finding || '材料已存档，可以回看。' : status === 'failed' ? input.error ? error : entry.status === 'failed' ? entry.detail || error : error : input.query || entry.query,
    tone: status === 'completed' ? 'success' : status === 'failed' ? 'warning' : 'neutral',
    stage: status === 'completed' ? 'complete' : status === 'failed' ? 'failed' : events.at(-1)?.stage || entry.stage,
    steps, _events: events, sourceCount: sourceEvent?.sourceCount, materialCount, finding, evidenceTitle, published,
    publicationState: status === 'completed' ? phase : undefined,
    metric: status === 'completed' && materialCount ? `${materialCount} 份证据` : entry.metric,
    ...(status === 'completed' ? { action: { type: 'research-result', roundId } } : {}),
    ...(interrupted ? { interrupted: true } : {}),
    ...(input.demo ? { demo: true, progress: input.progress } : {}),
  };
  return feedPatch(store, entry, values);
}

function feedResultMaterials(state, result) {
  if (!result || result.materials) return result;
  const id = result.selectedId || result.promotedId;
  const material = id ? getEvidenceMaterial(state, id) : null;
  return { ...result, materials: material ? [material] : [] };
}

function feedSyncInvestigations(store, state) {
  // Associate a start with its actual end log, including repeated attempts of
  // the same round. Network progress stays in its original card and position.
  let attempt = null, completed = 0;
  const attempts = [];
  for (const item of state.log || []) {
    if (item.type === 'research') { attempt = { start: item, round: completed + 1 }; attempts.push(attempt); }
    if (item.type === 'evidence') { if (attempt) attempt.result = state.researchResults?.[completed]; completed++; attempt = null; }
    if (item.type === 'research-failed' && attempt) { attempt.error = item.detail; attempt = null; }
  }
  for (const item of attempts) {
    const roundId = `round-${item.round}`, result = feedResultMaterials(state, item.result);
    const existing = store.entries.find(entry => entry.kind === 'investigation' && (entry.engineLogId === item.start.id || !entry.engineLogId && entry.roundId === roundId && entry.query === item.start.detail && entry.time === item.start.time));
    const active = !item.result && !item.error && item === attempts.at(-1) ? state.research : null;
    const requestId = existing?.requestId || result?.requestId || active?.requestId || `engine-${item.start.id}`;
    const entry = updateFieldInvestigation(store, {
      requestId, round: item.round, roundId, query: item.start.detail, time: item.start.time,
      status: result ? 'completed' : item.error ? 'failed' : 'running', result, error: item.error,
      interrupted: state.phase === 'lost' && !result && !item.error,
      demo: state.researchMode === 'demo',
      ...(active?.kind === 'evidence' ? { progress: Math.min(1, active.elapsed / active.duration) } : {}),
    });
    feedPatch(store, entry, { engineLogId: item.start.id, recovered: existing?.recovered ?? !existing });
  }
  // Also support states that contain a result without retained engine logs.
  for (const saved of state.researchResults || []) {
    const result = feedResultMaterials(state, saved);
    const entry = store.entries.find(item => item.kind === 'investigation' && (item.requestId === result.requestId || item.roundId === result.roundId && item.status !== 'failed'));
    updateFieldInvestigation(store, { requestId: entry?.requestId || result.requestId || `result-${result.roundId}`, roundId: result.roundId, query: result.query, time: entry?.time ?? result.time, status: 'completed', result });
  }
}

function feedSyncTransport(store, event) {
  if (!event.carryingTruth || event.type === 'departure') return;
  const route = `${feedChannelName(event.channelId)} · ${feedRegionName(event.from)} → ${feedRegionName(event.to)}`;
  const base = { id: `transport:${event.id}`, time: event.time, source: feedChannelName(event.channelId), detail: route };
  if (event.firstSeed || event.type === 'first-seed') {
    addFieldMessage(store, { ...base, title: `首次抵达${feedRegionName(event.to)}`, tone: 'success', metric: '新地区' });
  } else if (event.type === 'blocked' || event.outcome === 'blocked') {
    addFieldMessage(store, { ...base, title: '转载遭到谎言公司拦截', tone: 'danger' });
  } else if (event.outcome === 'missed') {
    addFieldMessage(store, { ...base, title: '转载抵达，这次没有传开', tone: 'warning' });
  } else if (event.seedAmount > 0 || event.convertedAmount > 0) {
    const id = `transport-relay:${Math.floor(event.time / 15)}`;
    const previous = store._byId.get(id), count = (previous?.count || 0) + 1;
    addFieldMessage(store, { ...base, id, title: '媒体接力，内容继续传开', tone: 'neutral', count, metric: `${count} 次转载` });
  }
}

function feedEvidenceEffect(event) {
  const effects = [];
  if (event.spreadBonus > 0) effects.push(`传播能力 +${Math.round(event.spreadBonus * 100)}%`);
  if (event.persuasionBonus > 0) effects.push(`说服能力 +${Math.round(event.persuasionBonus * 100)}%`);
  if (event.persuasionPenalty > 0) effects.push(`本轮材料的说服加成最多减少 ${Math.round(event.persuasionPenalty * 100)} 个百分点`);
  return `公布的证据引发讨论，${effects.join('；') || '热点正在传播'}。`;
}

export function syncFieldFeed(store, state) {
  if (!state) return store;
  const pending = [];
  for (const item of state.log || []) {
    const id = `log:${item.id}`;
    if (store._seen.has(id)) continue;
    store._seen.add(id);
    if (feedResearchTypes.has(item.type)) continue;
    pending.push({ id, time: item.time, kind: feedEventTypes.has(item.type) ? 'event' : 'message',
      title: item.title, detail: item.detail,
      tone: ['warning', 'backlash', 'lose'].includes(item.type) ? 'danger' : item.type === 'reinforcement' ? 'warning' : ['upgrade', 'promotion', 'milestone', 'publication', 'forgery', 'win', 'counter-progress'].includes(item.type) ? 'success' : 'neutral',
      eventType: item.type, source: ['warning', 'reinforcement', 'backlash', 'lose'].includes(item.type) ? '谎言公司' : item.type === 'forgery' ? '反攻时刻' : '行动记录' });
  }
  for (const event of state.mediaEvents || []) {
    const story = MEDIA_STORIES[event.type], id = `media:${event.id}`;
    if (!story || event.startedAt == null || event.startedAt > state.time || store._seen.has(id)) continue;
    store._seen.add(id);
    pending.push({ id, kind: 'event', time: event.startedAt, endsAt: event.endsAt, title: story.title, detail: story.effect, tone: story.tone,
      source: '媒体热点', quip: story.quip, eventType: 'media', action: { type: 'mediaStory', id: event.type } });
  }
  for (const event of state.evidenceEvents || []) {
    const story = RESEARCH_EVENTS[event.eventId], id = `evidence-event:${event.id}`;
    if (!story || event.startedAt == null || event.startedAt > state.time || store._seen.has(id)) continue;
    store._seen.add(id);
    pending.push({ id, kind: 'event', time: event.startedAt, endsAt: event.endsAt, title: story.title, detail: state.researchMode === 'live' ? feedEvidenceEffect(event) : story.gameEffectHint,
      tone: event.persuasionPenalty > 0 ? 'warning' : 'success', source: '证据热点', quip: state.researchMode === 'live' ? '' : story.quip, eventType: 'evidence',
      sourceTitle: RESEARCH_MEMES[story.memeId]?.sourceTitle, action: { type: 'evidenceStory', id: event.eventId } });
  }
  for (const event of state.transportEvents || []) if (event.id > store._transportId) pending.push({ transport: event, time: event.time });
  pending.sort((a, b) => a.time - b.time);
  for (const item of pending) {
    if (item.transport) { feedSyncTransport(store, item.transport); store._transportId = Math.max(store._transportId, item.transport.id); }
    else addFieldMessage(store, item);
  }
  feedSyncInvestigations(store, state);
  return store;
}
