// The investigator chooses a tactic; only the game owns its numeric effects.
export const INVESTIGATION_EFFECTS = Object.freeze({
  viral: Object.freeze({ name: '传播突破', focus: 'spread', spreadBonus: .35, persuasionBonus: 0, label: '传播 +35%' }),
  relay: Object.freeze({ name: '带着解释转发', focus: 'spread', spreadBonus: .25, persuasionBonus: .15, label: '传播 +25% · 说服 +15%' }),
  authority: Object.freeze({ name: '原文说话', focus: 'persuasion', spreadBonus: 0, persuasionBonus: .50, label: '说服 +50%' }),
  explain: Object.freeze({ name: '把疑点讲清', focus: 'persuasion', spreadBonus: .15, persuasionBonus: .35, label: '说服 +35% · 传播 +15%' }),
});

export function getMaterialEffect(material) {
  const selected = INVESTIGATION_EFFECTS[material?.effectId];
  return selected?.focus === material?.focus ? selected : INVESTIGATION_EFFECTS[material?.focus === 'persuasion' ? 'authority' : 'viral'];
}

export const ASSESSMENT_LABELS = Object.freeze({
  supported: '证据支持原观点', refuted: '证据足以反驳原观点', mixed: '原观点仍有条件或争议', insufficient: '原观点仍无法判定',
});

const boundedText = (value, max, empty = false) => typeof value === 'string' && (empty || Boolean(value.trim())) && [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const enumValue = (value, options) => options.includes(value);
const publicUrl = value => {
  if (!boundedText(value, 2048)) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    url.hash = ''; return url.href;
  } catch { return null; }
};

/** A final review is distinct from any one round's provisional assessment. */
export function snapshotFinalVerdict(value) {
  if (!value || !Object.hasOwn(ASSESSMENT_LABELS, value.status) || !enumValue(value.confidence, ['high', 'medium', 'low'])
    || !boundedText(value.summary, 1600) || !boundedText(value.rationale, 4000)
    || !Array.isArray(value.unresolved) || value.unresolved.length > 12 || !value.unresolved.every(item => boundedText(item, 600))
    || !Array.isArray(value.reviewedPublications) || value.reviewedPublications.length > 5
    || !Array.isArray(value.chain) || value.chain.length !== value.reviewedPublications.length) return null;
  const reviewedPublications = [];
  for (const item of value.reviewedPublications) {
    if (!boundedText(item?.roundId, 80) || !boundedText(item.materialId, 80) || reviewedPublications.some(previous => previous.roundId === item.roundId)) return null;
    reviewedPublications.push({ roundId: item.roundId, materialId: item.materialId });
  }
  const chain = [];
  for (const item of value.chain) {
    if (!reviewedPublications.some(publication => publication.roundId === item?.roundId) || chain.some(previous => previous.roundId === item.roundId)
      || !boundedText(item.question, 500) || !boundedText(item.finding, 1600) || !boundedText(item.gap, 600, true)
      || !enumValue(item.strength, ['strong', 'limited', 'weak']) || !enumValue(item.relevance, ['direct', 'indirect', 'irrelevant'])
      || !Array.isArray(item.sourceUrls) || item.sourceUrls.length > 5 || item.sourceUrls.some(url => !publicUrl(url))) return null;
    chain.push({ roundId: item.roundId, question: item.question.trim(), finding: item.finding.trim(), strength: item.strength,
      relevance: item.relevance, sourceUrls: [...new Set(item.sourceUrls.map(publicUrl))], gap: item.gap.trim() });
  }
  // Follow-up questions do not veto a judgment; critical gaps belong in its
  // status and confidence. Refutation still needs a cited, non-weak direct finding.
  if (value.status === 'refuted' && (value.confidence === 'low'
    || !chain.some(item => item.strength !== 'weak' && item.relevance === 'direct' && item.sourceUrls.length))) return null;
  return { status: value.status, confidence: value.confidence, summary: value.summary.trim(), rationale: value.rationale.trim(),
    unresolved: value.unresolved.map(item => item.trim()), reviewedPublications, chain };
}

export function getCaseEnding(outcome, finalVerdict, claim = '') {
  const proposition = claim ? `“${claim}”` : '最初的观点';
  const campaign = outcome === 'won' ? `你让全世界都相信：${proposition}是一个谎言。`
    : outcome === 'lost' ? `你试图让全世界相信：${proposition}是一个谎言，但这次没有成功。`
      : `你正在让世界相信：${proposition}是一个谎言。`;
  if (outcome === 'lost') return { id: 'defeat', label: '行动失利', title: '这次，谎言公司依旧执掌世界。', campaign, summary: '这次未能让世界接受你的反驳。传播失败不代表原观点已经被证实。' };
  if (outcome !== 'won') return { id: 'ongoing', label: '调查进行中', title: '调查还在继续。', campaign, summary: '反驳还在传播，原观点也仍需查证。' };
  const verdict = snapshotFinalVerdict(finalVerdict);
  if (!verdict) return { id: 'unreviewed', label: '传播胜利 · 尚未审定', title: '世界接受了你的反驳，证据仍待复核。', campaign, summary: '世界已把原观点当作谎言，但公布材料尚未完成复核。传播成功不能代替事实判断。' };
  if (verdict.status === 'refuted') return { id: 'truth', label: '真相胜利', title: '这一次，真相战胜了谎言。', campaign, summary: '你传播的是对原观点的反驳，本局公布的材料也足以支持这个反驳。人们有了可以核对的理由。' };
  const summaries = {
    supported: '你让世界把原观点当成了谎言，公布的材料却反而支持原观点。你赢得了信任，也让世界相信了一个与本局证据相反的结论。',
    mixed: '你把原观点说成了确定的谎言，材料却仍有条件限制或彼此冲突。世界接受的确定结论，超过了本局证据能证明的范围。',
    insufficient: '你让世界把原观点当成了谎言，却没有足够的证据证明这一点。未能证伪不等于原观点为真，传播成功也不能补上证据缺口。',
  };
  return { id: 'new-company', label: '屠龙勇者终成龙', title: '新的谎言公司，诞生了。', campaign, summary: summaries[verdict.status] };
}
