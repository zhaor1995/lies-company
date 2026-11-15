import { getStats, getEvidenceMaterial, REGIONS, UPGRADE_DEFS } from './engine.js';
import { CASE } from './content.js';
import { RESEARCH_SOURCES, RESEARCH_EVENTS, RESEARCH_ROUNDS } from './research-content.js';
import { getMaterialEffect, ASSESSMENT_LABELS, snapshotFinalVerdict, getCaseEnding } from './investigation-contract.js';
import { worldTime, worldDuration } from './world-time.js';

const reportSourceTiming = source => [source.date ? `原文日期：${source.date}` : '', source.fetchedAt ? `取材时间：${source.fetchedAt}` : ''].filter(Boolean).join(' · ');
const reportUrl = value => {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};
const reportHash = value => {
  let code = 2166136261;
  for (const char of value) code = Math.imul(code ^ char.codePointAt(0), 16777619);
  return (code >>> 0).toString(36).toUpperCase().padStart(7, '0');
};

function summarizePlaystyle(state) {
  // Every successful purchase adds one level. Prices and evidence bonuses
  // differ between attributes, so neither measures the player's allocation.
  const keys = ['spread', 'persuasion', 'defense'];
  const levels = Object.fromEntries(keys.map(key => [key, state.levels?.[key] ?? 0]));
  const highest = Math.max(...Object.values(levels));
  if (!highest) return { name: '原装出厂', description: '本局未购买能力升级。', levels };
  const leaders = keys.filter(key => levels[key] === highest);
  const styles = {
    spread: ['显眼包', '加点最偏重传播，让更多人先看见你的证据。'],
    persuasion: ['课代表', '加点最偏重说服，把观望者争取到你这边。'],
    defense: ['叠甲大师', '加点最偏重防守，减少反扑损失，加快澄清。'],
    'spread+persuasion': ['互联网嘴替', '传播与说服加点并列最多，既让人看见，也让人相信。'],
    'spread+defense': ['弹幕护体', '传播与防守加点并列最多，扩大声量，也守住阵地。'],
    'persuasion+defense': ['人间清醒', '说服与防守加点并列最多，争取支持，也抵御反扑。'],
    'spread+persuasion+defense': ['端水大师', '三项加点相同，传播、说服和防守一起推进。'],
  };
  let [name, description] = styles[leaders.join('+')];
  if (leaders.length === 3 && highest === 3) {
    name = '六边形战士';
    // Log order retains choices even when several upgrades share a paused
    // timestamp. Exact title matching also reads earlier, unstructured logs.
    const firstMaxed = (state.log || []).filter(entry => entry.type === 'upgrade')
      .map(entry => keys.find(key => entry.upgradeKey === key && entry.level === 3 || entry.title === `${UPGRADE_DEFS[key].levels[2]} · Lv.3`)).find(Boolean);
    const labels = { spread: '传播', persuasion: '说服', defense: '防守' };
    description = firstMaxed ? `你率先点满${labels[firstMaxed]}，随后补齐另外两项，最终三项全满。` : '传播、说服和防守全部点满，三路都投入。';
  }
  return { name, description, levels };
}

/** Build from this match's saved evidence, never from a new search or model call. */
export function buildCaseReport(state) {
  const period = { start: worldTime(0).label, end: worldTime(state.time).label, duration: worldDuration(state.time) };
  const finalVerdict = state.finalReview?.status === 'complete' ? snapshotFinalVerdict(state.finalReview.verdict) : null;
  const ending = getCaseEnding(state.phase, finalVerdict, state.claim || CASE.claim);
  const narrative = `2077年4月1日立案。${state.phase === 'won' ? `历经${period.duration}，${ending.campaign}${ending.summary}` : state.phase === 'lost' ? `行动持续了${period.duration}，这次未能打破谎言公司的统治。` : `调查已进行${period.duration}，线索还在延伸。`}`;
  const stats = getStats(state), results = (state.researchResults || []).map(result => ({ ...result,
    materials: (result.materials || (result.evidenceIds || []).map(id => {
      const material = getEvidenceMaterial(state, id);
      return { ...material, sources: (material.sourceIds || []).map(sourceId => RESEARCH_SOURCES[sourceId]).filter(Boolean) };
    })).filter(material => material.id === (result.selectedId || result.promotedId)),
  }));
  const status = finalVerdict?.status || 'insufficient';
  const summary = finalVerdict?.summary || '公布材料尚未完成复核。游戏中的支持率不代表传闻已经被证实或证伪。';
  const steps = results.map((result, index) => {
    const chosen = result.materials[0];
    const published = result.publishedAt != null || Boolean(!result.selectedId && result.promotedId);
    const archived = !published && state.phase === 'won';
    const publicationState = published ? '已公布' : archived ? '已归档' : result.storedAt != null ? '已收入囊中' : '待公布';
    const effectLabel = material => archived ? '未公布，未获得加成' : `${published ? '' : '公布后：'}${getMaterialEffect(material).label}`;
    const source = chosen?.sources?.[0];
    return {
      round: index + 1, roundId: result.roundId, materialId: chosen?.id || '', time: result.time || 0, timeLabel: worldTime(result.time).stamp, question: result.chosenLead?.question || result.query,
      selectedTitle: chosen?.insight?.headline || chosen?.title || '证据尚未整理好',
      publicationState, published, publishedAt: result.publishedAt ?? null, publishedTimeLabel: result.publishedAt != null ? worldTime(result.publishedAt).stamp : '',
      finding: chosen?.insight?.explanation || chosen?.finding || result.finding,
      quote: chosen?.insight?.quote || '', sourceTitle: source?.title || '', sourceUrl: reportUrl(source?.url), sourceName: source?.organization || '', sourceDate: source?.date || '', fetchedAt: result.fetchedAt || '',
      effectLabel: chosen ? effectLabel(chosen) : '证据尚未整理好',
      materials: result.materials.map(material => ({
        title: material.insight?.headline || material.title, finding: material.insight?.explanation || material.finding,
        quote: material.insight?.quote || '', url: reportUrl(material.sources?.[0]?.url), organization: material.sources?.[0]?.organization || '',
        sourceDate: material.sources?.[0]?.date || '', fetchedAt: result.fetchedAt || '',
        selected: true, effectLabel: effectLabel(material),
      })),
    };
  });
  const sources = [];
  for (const result of results) for (const material of result.materials) for (const source of material.sources || []) {
    const url = reportUrl(source.url);
    if (url && !sources.some(existing => existing.url === url)) sources.push({ title: source.title, url, organization: source.organization, date: source.date || '', fetchedAt: result.fetchedAt || '' });
  }
  const timeline = (state.log || []).filter(entry => ['start', 'publication', 'warning', 'reinforcement', 'backlash', 'counter-start', 'forgery', 'win', 'lose'].includes(entry.type))
    .map(entry => {
      const publication = entry.type === 'publication' ? (state.publications || []).find(item => item.time === entry.time && (!entry.roundId || item.roundId === entry.roundId)) : null;
      const result = entry.type === 'publication' ? results.find(item => entry.roundId ? item.roundId === entry.roundId : entry.evidenceId ? (item.selectedId || item.promotedId) === entry.evidenceId : publication?.roundId ? item.roundId === publication.roundId : item.publishedAt === entry.time) : null;
      const material = result?.materials[0], title = material?.insight?.headline || material?.title || publication?.title;
      return { kind: entry.type, time: entry.time, timeLabel: worldTime(entry.time).stamp, title: title ? `公布实锤：${title}` : entry.title, detail: entry.detail, ...(result ? { roundId: result.roundId } : {}) };
    });
  for (const result of results) if (result.publishedAt != null && !timeline.some(entry => entry.kind === 'publication' && (entry.roundId === result.roundId || !entry.roundId && entry.time === result.publishedAt))) {
    const material = result.materials[0];
    timeline.push({ kind: 'publication', roundId: result.roundId, time: result.publishedAt, timeLabel: worldTime(result.publishedAt).stamp, title: `公布实锤：${material?.insight?.headline || material?.title || '调查证据'}`, detail: material ? getMaterialEffect(material).label : '' });
  }
  for (const step of steps) timeline.push({ kind: 'investigation', time: step.time, timeLabel: step.timeLabel, title: `第 ${step.round} 轮：${step.question}`, detail: step.selectedTitle });
  for (const event of state.evidenceEvents || []) {
    const story = RESEARCH_EVENTS[event.eventId];
    const effect = [event.spreadBonus ? `传播临时 +${Math.round(event.spreadBonus * 100)}%` : '', event.persuasionBonus ? `说服临时 +${Math.round(event.persuasionBonus * 100)}%` : '', event.persuasionPenalty ? `本卡说服加成临时减少 ${Math.round(event.persuasionPenalty * 100)} 个百分点` : ''].filter(Boolean).join('，');
    if (story && event.startedAt <= state.time) timeline.push({ kind: 'hotspot', time: event.startedAt, timeLabel: worldTime(event.startedAt).stamp, title: `本局热点：${story.title}`, detail: state.investigation ? `公布的证据引来一次热点，${effect}。（游戏演绎）` : `${story.quip}（游戏演绎）` });
  }
  const firstContact = state.regions.filter(region => region.id !== state.startRegionId && region.firstContactAt != null).sort((a, b) => a.firstContactAt - b.firstContactAt)[0];
  if (firstContact) timeline.push({ kind: 'arrival', time: firstContact.firstContactAt, timeLabel: worldTime(firstContact.firstContactAt).stamp, title: `首次传到${REGIONS.find(region => region.id === firstContact.id)?.name || firstContact.id}`, detail: '媒体把核查信息带到了新的地区。' });
  timeline.sort((a, b) => a.time - b.time);
  const style = summarizePlaystyle(state);
  return {
    title: ending.title,
    claim: state.claim || CASE.claim, outcome: state.phase, caseId: reportHash(`${state.claim}|${state.startRegionId}|${results.map(result => result.requestId || result.roundId).join('|')}`),
    period, narrative, ending, finalVerdict,
    verdict: { status, label: finalVerdict ? ASSESSMENT_LABELS[status] : '尚未审定', summary },
    stats: { support: stats.truth, reached: stats.reached, elapsed: state.time, timeLabel: period.duration, evidenceCount: results.length, totalRounds: RESEARCH_ROUNDS.length,
      regions: state.regions.filter(region => region.seeded).length, coinsCollected: state.coinEconomy?.collected || 0,
      publishedGain: (state.publications || []).reduce((sum, publication) => sum + publication.gain, 0), countered: Boolean(state.event?.resolved) },
    style, steps, timeline, sources,
  };
}

export function caseReportText(report) {
  const ending = getCaseEnding(report.outcome, report.finalVerdict, report.claim);
  const verdictLabel = report.finalVerdict ? ASSESSMENT_LABELS[report.finalVerdict.status] : '原观点尚未完成终审';
  return [
    `谎言公司 · ${ending.title}`, ending.campaign, ending.summary, `立案：${report.period.start}\n${report.outcome === 'won' || report.outcome === 'lost' ? '结案' : '记录截至'}：${report.period.end}`, `证据判断（针对原观点）· ${verdictLabel}：${report.verdict.summary}`,
    ...(report.finalVerdict ? [report.finalVerdict.rationale, ...report.finalVerdict.chain.map((link, index) => `${index + 1}. ${link.question}\n${link.finding}${link.gap ? `\n材料边界：${link.gap}` : ''}`), ...(report.finalVerdict.unresolved.length ? [`${report.finalVerdict.status === 'refuted' ? '仍可补充' : '仍待核对'}：${report.finalVerdict.unresolved.join('；')}`] : [])] : []),
    `本局模拟战绩：反驳支持率 ${report.stats.support.toFixed(1)}% · ${report.stats.timeLabel} · 完成 ${report.stats.evidenceCount}/${report.stats.totalRounds} 轮调查 · ${report.style.name}`,
    `${report.style.description}${report.style.levels ? `\n加点：传播 ${report.style.levels.spread}/3 · 说服 ${report.style.levels.persuasion}/3 · 防守 ${report.style.levels.defense}/3` : ''}`,
    ...report.steps.map(step => `${step.timeLabel} · 第${step.round}轮｜${step.question}\n${step.publicationState}：${step.selectedTitle}\n${step.finding}\n${step.effectLabel}`),
    ...report.timeline.filter(event => ['publication', 'counter-start', 'forgery', 'hotspot'].includes(event.kind)).map(event => `${event.timeLabel}｜${event.title}`),
    '材料出处：', ...report.sources.map((source, index) => `${index + 1}. ${source.organization}｜${source.title}\n${source.url}${reportSourceTiming(source) ? `\n${reportSourceTiming(source)}` : ''}`),
    '游戏支持率是模拟战绩；调查结论以材料及其限制为准。',
  ].join('\n\n');
}

/** Capture the displayed report before the save button enters its busy state. */
export async function downloadCaseReport(report, dialog) {
  if (!dialog?.isConnected || !dialog.open || !globalThis.htmlToImage?.toBlob) throw new Error('请打开结案战报后再保存。');
  const copy = dialog.cloneNode(true), style = getComputedStyle(dialog);
  // Exclude the scrollbar width so text wraps exactly as it does in the dialog.
  const width = dialog.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  copy.querySelector('#report-copy-fallback')?.remove();
  const status = copy.querySelector('#report-status');
  if (status) status.textContent = '战报带有证据出处和本局战绩，保存后可自行分享。';
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
  Object.assign(copy.style, { display: 'block', position: 'relative', inset: 'auto', margin: '0',
    width: `${width}px`, maxWidth: 'none', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none' });
  const footer = copy.querySelector('.report-actions');
  if (footer) { footer.style.position = 'static'; footer.style.bottom = 'auto'; }
  host.append(copy); document.body.append(host);
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    // Resolve the local font without the library's <base> element, blocked by our CSP.
    const fontRules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      .filter(rule => rule.type === CSSRule.FONT_FACE_RULE);
    const fontEmbedCSS = (await Promise.all(fontRules.map(async rule => {
      const css = rule.cssText, source = css.match(/url\(['"]?([^'"()]+)['"]?\)/);
      if (!source || source[1].startsWith('data:')) return css;
      const response = await fetch(new URL(source[1], rule.parentStyleSheet.href || document.baseURI));
      if (!response.ok) throw new Error('字体暂时无法读取，请重试。');
      const font = await response.blob();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(font);
      });
      return css.replace(source[0], `url("${data}")`);
    }))).join('\n');
    const height = Math.ceil(copy.getBoundingClientRect().height);
    const blob = await globalThis.htmlToImage.toBlob(copy, {
      width, height, pixelRatio: Math.min(2, 16384 / Math.max(width, height)),
      backgroundColor: style.backgroundColor, fontEmbedCSS,
    });
    if (!blob) throw new Error('图片暂时无法生成，请重试。');
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `谎言公司-调查战报-${report.caseId}.png`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally { host.remove(); }
}
