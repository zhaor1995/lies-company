import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, buyUpgrade } from '../dist/engine.js';
import { buildCaseReport, caseReportText } from '../dist/case-report.js';

function reportGame(phase = 'won') {
  const game = createGame({ researchMode: 'live' });
  game.phase = phase; game.time = 150;
  game.researchResults = [15, 75].map((time, index) => ({
    time, roundId: `round-${index + 1}`, query: `核对第${index + 1}条线索`, promotedId: `material-${index}`,
    fetchedAt: '2026-10-23T03:30:00Z', assessment: { status: 'insufficient', summary: '资料未能支持这个绝对表述。' },
    materials: [{ id: `material-${index}`, title: '原始调查记录', focus: 'persuasion', effectId: 'authority', finding: '资料只记录了有限条件。',
      sources: [{ title: '研究原文', organization: '记录机构', url: `https://example.org/source-${index}`, date: '2025-01-14' }] }],
  }));
  game.log = [{ type: 'start', time: 0, title: '侦探出发', detail: '' }, { type: 'publication', time: 60, title: '公布实锤', detail: '' }];
  game.regions.find(region => region.id !== game.startRegionId).firstContactAt = 35;
  game.evidenceEvents = [{ eventId: 'source-goes-viral', startedAt: 90, spreadBonus: .2 }];
  return game;
}

test('reports share one world calendar for the case period, evidence and turning points', () => {
  const game = reportGame(), snapshot = JSON.stringify(game), report = buildCaseReport(game);
  assert.deepEqual(report.period, { start: '2077年4月1日 00时', end: '2077年4月3日 12时', duration: '2天12小时' });
  assert.equal(report.stats.elapsed, 150, 'simulation seconds remain available without rescaling the engine');
  assert.equal(report.stats.timeLabel, '2天12小时');
  assert.deepEqual(report.steps.map(step => step.timeLabel), ['2077.04.01 · 06时', '2077.04.02 · 06时']);
  assert.equal(report.timeline.find(entry => entry.kind === 'publication').timeLabel, '2077.04.02 · 00时');
  assert.equal(report.timeline.find(entry => entry.kind === 'arrival').timeLabel, '2077.04.01 · 14时');
  assert.equal(report.timeline.find(entry => entry.kind === 'hotspot').timeLabel, '2077.04.02 · 12时');
  assert.match(report.narrative, /2077年4月1日立案。历经2天12小时/);
  assert.equal(report.verdict.status, 'insufficient', 'a victory never upgrades the evidence conclusion');
  assert.equal(JSON.stringify(game), snapshot, 'building the report does not rewrite the match');
});

test('share text retains real publication and retrieval dates beside the fictional case dates', () => {
  const report = buildCaseReport(reportGame()), text = caseReportText(report);
  assert.equal(report.steps[0].sourceDate, '2025-01-14');
  assert.equal(report.steps[0].fetchedAt, '2026-10-23T03:30:00Z');
  assert.equal(report.steps[0].materials[0].sourceDate, '2025-01-14');
  assert.equal(report.sources[0].date, '2025-01-14');
  assert.equal(report.sources[0].fetchedAt, '2026-10-23T03:30:00Z');
  assert.match(text, /立案：2077年4月1日 00时\n结案：2077年4月3日 12时/);
  assert.match(text, /2077\.04\.02 · 06时 · 第2轮/);
  assert.match(text, /原文日期：2025-01-14 · 取材时间：2026-10-23T03:30:00Z/);
  assert.match(text, /https:\/\/example.org\/source-0/);
});

test('zero-hour, unfinished and lost reports do not invent a completed victory', () => {
  const game = reportGame('playing'); game.time = 0; game.researchResults = []; game.evidenceEvents = [];
  const first = buildCaseReport(game);
  assert.equal(first.period.start, first.period.end); assert.equal(first.stats.timeLabel, '不足1小时');
  assert.match(first.narrative, /调查已进行不足1小时/);
  assert.match(caseReportText(first), /记录截至：2077年4月1日 00时/);
  assert.doesNotMatch(caseReportText(first), /结案：|你夺回了/);
  const lost = buildCaseReport(reportGame('lost'));
  assert.match(lost.narrative, /持续了2天12小时.*未能打破/);
  assert.doesNotMatch(lost.narrative, /你夺回了/);
  for (const report of [first, lost]) assert.doesNotMatch(caseReportText(report), /你让全世界都相信/);
});

test('every victory describes spreading the refutation while preserving the original claim and evidence judgment', () => {
  for (const status of ['refuted', 'supported', 'mixed', 'insufficient']) {
    const game = reportGame();
    game.claim = 'DeepSeek 是中国的模型';
    game.finalReview = { status: 'complete', verdict: {
      status, confidence: 'high', summary: '本次复核仅依据已公布的材料。', rationale: '逐项比对材料与原观点。',
      unresolved: status === 'refuted' ? [] : ['材料尚有适用范围需要核对。'],
      reviewedPublications: game.researchResults.map(result => ({ roundId: result.roundId, materialId: result.promotedId })),
      chain: game.researchResults.map(result => ({ roundId: result.roundId, question: result.query,
        finding: '比对原始记录。', strength: 'strong', relevance: 'direct', sourceUrls: [result.materials[0].sources[0].url], gap: '' })),
    } };
    const before = JSON.stringify(game), report = buildCaseReport(game), text = caseReportText(report);
    assert.equal(report.claim, game.claim, 'the Agent must still investigate the original proposition');
    assert.equal(report.ending.campaign, '你让全世界都相信：“DeepSeek 是中国的模型”是一个谎言。');
    assert.ok(text.includes(report.ending.campaign));
    assert.ok(report.narrative.includes(report.ending.campaign));
    assert.equal(report.finalVerdict.status, status, 'popular acceptance must not change the factual verdict');
    assert.equal(report.ending.id, status === 'refuted' ? 'truth' : 'new-company');
    assert.ok(text.includes(`证据判断（针对原观点）· ${report.verdict.label}`));
    if (status === 'supported') {
      assert.match(report.ending.summary, /材料.*支持原观点/);
      assert.match(report.ending.summary, /与本局证据相反/);
      assert.doesNotMatch(report.ending.summary, /并不证明原观点是真的|证据.*不充分/);
    } else if (status === 'mixed') assert.match(report.ending.summary, /条件限制或彼此冲突/);
    else if (status === 'insufficient') assert.match(report.ending.summary, /未能证伪不等于原观点为真/);
    assert.equal(JSON.stringify(game), before);
  }
});

test('legacy share reports rebuild the campaign without inventing a final verdict', () => {
  const report = buildCaseReport(reportGame());
  report.claim = '原始观点';
  report.title = '过时的真相胜利标题';
  report.ending = { id: 'truth', title: report.title };
  report.narrative = '过时的传播叙述';
  delete report.finalVerdict;
  const before = JSON.stringify(report), text = caseReportText(report);
  assert.match(text, /你让全世界都相信：“原始观点”是一个谎言。/);
  assert.match(text, /原观点尚未完成终审/);
  assert.doesNotMatch(text, /过时的|真相战胜了谎言/);
  assert.equal(JSON.stringify(report), before, 'displaying an old report does not rewrite the archive');
});

test('reports preserve a reasonable refutation with local limits and noncritical follow-up questions', () => {
  const game = reportGame();
  game.claim = '凌云工具由乙国公司开发';
  const findings = ['产品原始发布记录将开发主体列为云山公司。', '公司登记记录确认云山公司注册于甲国。'];
  const limits = ['产品发布记录本身不记载公司的注册国家。', '公司登记记录本身不列举公司的全部产品。'];
  game.finalReview = { status: 'complete', verdict: {
    status: 'refuted', confidence: 'medium', summary: '产品归属和同一主体的公司登记相互衔接，足以反驳原观点。',
    rationale: '两份材料对产品开发主体及其注册国家的记载相符，各自的局部限制不影响对原观点的判断。',
    unresolved: ['尚未逐一核对该公司开发的其他产品，这不影响已确认的产品归属。'],
    reviewedPublications: game.researchResults.map(result => ({ roundId: result.roundId, materialId: result.promotedId })),
    chain: game.researchResults.map((result, index) => ({ roundId: result.roundId, question: result.query,
      finding: findings[index], strength: 'limited', relevance: 'direct', sourceUrls: [result.materials[0].sources[0].url], gap: limits[index] })),
  } };
  const report = buildCaseReport(game), archived = JSON.parse(JSON.stringify(report)), text = caseReportText(archived);
  assert.equal(report.ending.id, 'truth');
  assert.deepEqual(archived.finalVerdict, game.finalReview.verdict, 'report export retains the evidence and its local boundaries');
  assert.deepEqual(archived.finalVerdict.unresolved, game.finalReview.verdict.unresolved);
  for (const question of archived.finalVerdict.unresolved) assert.ok(text.includes(question));
  for (const limit of limits) assert.ok(text.includes(`材料边界：${limit}`));
  assert.match(text, /真相战胜了谎言/);
  assert.doesNotMatch(text, /证据缺口：|新的谎言公司|完整证明|medium|limited/);

  for (const change of [
    verdict => { verdict.confidence = 'low'; },
    verdict => { verdict.chain.forEach(link => { link.strength = 'weak'; }); },
    verdict => { verdict.chain.forEach(link => { link.relevance = 'indirect'; }); },
    verdict => { verdict.chain[0].strength = 'weak'; verdict.chain[1].relevance = 'indirect'; },
    verdict => { verdict.chain.forEach(link => { link.sourceUrls = []; }); },
  ]) {
    const incomplete = structuredClone(game); change(incomplete.finalReview.verdict);
    const ending = buildCaseReport(incomplete).ending;
    assert.equal(ending.id, 'unreviewed', 'local limits are allowed, but unsupported refutations are still rejected');
    assert.match(ending.summary, /公布材料尚未完成复核/);
    assert.doesNotMatch(ending.summary, /完整证据链/);
  }
  for (const status of ['insufficient', 'mixed']) {
    const incomplete = structuredClone(game);
    Object.assign(incomplete.finalReview.verdict, { status, unresolved: ['两份记录尚不能确定指向同一家公司。'] });
    const report = buildCaseReport(incomplete);
    assert.equal(report.finalVerdict.status, status);
    assert.equal(report.ending.id, 'new-company', 'a critical missing link belongs in the factual judgment');
  }
});

test('world dates carry through month changes in report exports', () => {
  const game = reportGame(); game.time = 30 * 60 + 2.5;
  const report = buildCaseReport(game);
  assert.equal(report.period.end, '2077年5月1日 01时');
  assert.equal(report.period.duration, '30天1小时');
});

test('reports include one fixed evidence per round and distinguish saved evidence from published effects', () => {
  const game = reportGame('playing'), result = game.researchResults[0];
  game.researchResults = [result]; game.log = []; game.evidenceEvents = [];
  result.selectedId = result.promotedId; delete result.promotedId;
  result.storedAt = 20;
  result.materials.push({ id: 'alternative', title: '未采用候选', focus: 'spread', effectId: 'relay', finding: '未采用发现', sources: [{ title: '候选出处', url: 'https://example.org/alternative' }] });
  const stored = buildCaseReport(game);
  assert.equal(stored.steps[0].publicationState, '已收入囊中'); assert.equal(stored.steps[0].published, false);
  assert.match(stored.steps[0].effectLabel, /^公布后：/);
  assert.equal(stored.steps[0].materials.length, 1); assert.equal(stored.sources.length, 1);
  assert.doesNotMatch(caseReportText(stored), /未采用|alternative/);
  assert.equal(stored.style.name, '原装出厂');
  result.promotedId = result.selectedId; result.publishedAt = 60;
  game.log = [{ type: 'publication', roundId: result.roundId, time: 60, title: '实锤公布', detail: '能力生效' }];
  const published = buildCaseReport(game);
  assert.equal(published.steps[0].publicationState, '已公布'); assert.equal(published.steps[0].published, true);
  assert.equal(published.steps[0].publishedTimeLabel, '2077.04.02 · 00时');
  assert.doesNotMatch(published.steps[0].effectLabel, /公布后/);
  assert.equal(published.timeline.filter(event => event.kind === 'publication').length, 1);
  assert.match(published.timeline.find(event => event.kind === 'publication').title, /原始调查记录/);
  assert.equal(published.verdict.status, 'insufficient');
});

test('victory archives unpublished evidence without claiming a publication or granting its effect', () => {
  const game = reportGame(), result = game.researchResults[0];
  result.selectedId = result.promotedId; result.promotedId = null; result.storedAt = game.time;
  const report = buildCaseReport(game), step = report.steps[0];
  assert.equal(step.publicationState, '已归档');
  assert.equal(step.published, false);
  assert.equal(step.effectLabel, '未公布，未获得加成');
  assert.equal(step.materials[0].effectLabel, step.effectLabel);
  assert.equal(report.stats.evidenceCount, 2);
  assert.equal(report.stats.elapsed, 150);
  assert.ok(report.sources.some(source => source.url === step.sourceUrl));
});

test('playstyle reflects purchased upgrades even when every recommended evidence favors persuasion', () => {
  for (const [levels, expected] of [
    [{ spread: 3, persuasion: 1, defense: 2 }, '显眼包'],
    [{ spread: 1, persuasion: 3, defense: 2 }, '课代表'],
    [{ spread: 1, persuasion: 2, defense: 3 }, '叠甲大师'],
  ]) {
    const game = reportGame(); game.levels = levels;
    const before = JSON.stringify(game), report = buildCaseReport(game);
    assert.equal(report.style.name, expected);
    assert.deepEqual(report.style.levels, levels);
    assert.equal(JSON.stringify(game), before);
    report.style.levels.spread = 0;
    assert.equal(game.levels.spread, levels.spread, 'report allocation is a separate snapshot');
  }
});

test('tied upgrades produce mixed or balanced styles, while no purchases are stated honestly', () => {
  for (const [levels, expected] of [
    [{ spread: 2, persuasion: 2, defense: 1 }, '互联网嘴替'],
    [{ spread: 3, persuasion: 1, defense: 3 }, '弹幕护体'],
    [{ spread: 0, persuasion: 2, defense: 2 }, '人间清醒'],
    [{ spread: 1, persuasion: 1, defense: 1 }, '端水大师'],
    [{ spread: 3, persuasion: 3, defense: 3 }, '六边形战士'],
    [{ spread: 0, persuasion: 0, defense: 0 }, '原装出厂'],
  ]) {
    const game = reportGame(); game.levels = levels;
    const report = buildCaseReport(game);
    assert.equal(report.style.name, expected);
    assert.deepEqual(report.style.levels, levels);
    assert.match(caseReportText(report), new RegExp(`传播 ${levels.spread}/3 · 说服 ${levels.persuasion}/3 · 防守 ${levels.defense}/3`));
    assert.doesNotMatch(report.style.description, /率先/, 'missing purchase history cannot imply a first priority');
  }
});

test('full builds retain their first maxed attribute using purchase order, independent of prices and timestamps', () => {
  const game = createGame(); game.points = 0;
  assert.equal(buyUpgrade(game, 'spread').ok, false);
  game.points = 400;
  for (const key of ['defense', 'spread', 'persuasion']) {
    for (let level = 1; level <= 3; level++) {
      assert.equal(buyUpgrade(game, key).ok, true);
      assert.equal(game.log.at(-1).upgradeKey, key);
      assert.equal(game.log.at(-1).level, level);
    }
    assert.equal(buyUpgrade(game, key).ok, false);
  }
  assert.equal(game.log.filter(entry => entry.type === 'upgrade').length, 9);
  const report = buildCaseReport(game);
  assert.equal(report.style.name, '六边形战士');
  assert.match(report.style.description, /率先点满防守/);
  assert.deepEqual(report.style.levels, { spread: 3, persuasion: 3, defense: 3 });
  for (const entry of game.log) { delete entry.upgradeKey; delete entry.level; }
  assert.equal(buildCaseReport(game).style.description, report.style.description, 'earlier exact upgrade titles retain the same priority');
});
