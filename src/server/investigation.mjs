import { randomUUID, randomInt } from 'node:crypto';
import { SearchError, safeSourceUrl, sourceKey } from './search.mjs';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';
import { INVESTIGATION_EFFECTS } from '../dist/investigation-contract.js';
import { abortableDelay } from './retry.mjs';
import { modelFormatIssue } from './model-contract.mjs';

const text = (value, max, min = 1) => typeof value === 'string' && [...value.trim()].length >= min && [...value.trim()].length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const validationErrors = new WeakSet();
function invalid(issue = 'result: expected an object', repairFields = []) {
  const error = new SearchError('INVESTIGATION_FORMAT', '调查材料还没整理完整，请重试。', 422);
  error.validationIssue = issue;
  error.repairFields = repairFields;
  validationErrors.add(error);
  return error;
}
const statuses = new Set(['supported', 'refuted', 'mixed', 'insufficient']);
const requestIdValid = value => typeof value === 'string' && /^[\w-]{16,80}$/.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const privateLeadDesign = new WeakMap();
const strengthValues = ['strong', 'limited', 'weak'];
const relevanceValues = ['direct', 'indirect', 'irrelevant'];
const relationValues = ['contradicts', 'limits', 'supports', 'context', 'unclear'];
const relationRanks = { contradicts: 0, limits: 0, supports: 1, context: 2, unclear: 3 };

function evidencePlan(raw, claim) {
  if (!raw || !text(raw.proposition, 240) || !text(raw.scope, 300) || !Array.isArray(raw.criteria) || !raw.criteria.length || raw.criteria.length > 5) throw invalid('evidencePlan: proposition, scope and 1-5 testable criteria required');
  if (raw.proposition.trim() !== claim) throw invalid('evidencePlan.proposition: copy the original claim exactly; preserve subject, relation direction, location, quantifiers and conditions');
  if (!text(raw.refutationTarget, 300) || raw.refutationTarget.trim() === claim) throw invalid('evidencePlan.refutationTarget: state a testable counterclaim or failing condition that would refute the original proposition, not the original assertion or an assumed conclusion');
  return { proposition: raw.proposition.trim(), refutationTarget: raw.refutationTarget.trim(), scope: raw.scope.trim(), criteria: raw.criteria.map((item, index) => {
    if (!text(item.question, 240) || !text(item.requiredEvidence, 400) || !text(item.counterEvidence, 400)) throw invalid('evidencePlan.criteria: question, requiredEvidence and counterEvidence required');
    return { id: `c${index + 1}`, question: item.question.trim(), requiredEvidence: item.requiredEvidence.trim(), counterEvidence: item.counterEvidence.trim() };
  }) };
}

const PLAN_SHAPE = { proposition: '原样复制claim，不增删改写', refutationTarget: '足以推翻原观点的待查反例或必要条件失败；保留范围与量词，不是既定结论', scope: '按通常语义明确主体、关系、范围与量词；产品或品牌被称为公司时明确其开发或经营主体，主体关联仍须查证；只保留影响结论的真实歧义', criteria: [{ question: '哪个核心条件或反例能影响原观点真假？不把相关背景全列为必要前提', requiredEvidence: '哪些直接记录会使这条反驳失败？', counterEvidence: '哪些记录或可组合的证据能形成反例，适用什么范围？区分全称与存在命题的证明责任' }] };
const FALSIFICATION_TASK = '调查任务是尝试证伪原始claim，按日常查证的合理标准寻找有据反例，不要求穷尽所有资料。refutationTarget是待检验目标，不是既定事实；含否定的原句按逻辑反向检验，不机械加“不”。“最、所有、从不、一定”等绝对说法，一个适用的可信反例即可推翻；存在性主张不能这样反推。反例须与原句逻辑矛盾：最高或最多需要更高或更多的对照，较低或较少不能推翻最高或最多；最低或最少反向检验。保留主体、范围与量词，不偷换条件。产品或品牌被口语称为公司时查实际开发或经营主体，不靠类别错误取巧。evidencePlan是可纠正的计划，不是必须查完的清单。只追仍会改变结论的缺口，不因缺少原始凭证就否定有具体事实的可信报道。检索方向不决定结论：支持原观点的资料不能改写成反证；未搜到不等于不存在，保留挑战反驳的证据。';
const PATH_DESIGN = '两条路径都尝试反驳原观点，一条direct检查核心反例或补齐证明所缺环节；另一条indirect追查表面相关但证明力有限的关联、个案或转述。问题须写明待查反例或失败条件，不只改写原观点能否实现，也不复现正向操作方案。question、reason与searchQuery围绕同一标准，criterionId绑定evidencePlan.criteria的c1等编号；不把旁支升级为原命题必要条件。searchQuery须独立可读，建议40字符内，最多64字符，英文每个字母、空格均计1字符；保留主体、必要范围及反例或限制，不整句前置正向claim。标题、问题和理由用中性调查动作，不预告结论，不出现正确、错误、陷阱或推荐标记；routeRole、criterionId仅内部使用，不决定结论。';

function leadsFrom(value, round, plan) {
  const field = round === 1 ? 'leads' : 'nextLeads';
  if (!Array.isArray(value) || value.length !== 2) throw invalid(`${field}: exactly 2 items required`);
  const issues = [], hasDesign = value.some(lead => lead?.routeRole !== undefined);
  if (hasDesign && (value.filter(lead => lead?.routeRole === 'direct').length !== 1 || value.filter(lead => lead?.routeRole === 'indirect').length !== 1)) issues.push(`${field}.routeRole: one direct and one indirect required`);
  // Repair positions refer to the model's original order. Report every field
  // issue together before shuffling, so one repair can fix both directions.
  value.forEach((lead, index) => {
    for (const [key, min, max] of [['title', 1, 50], ['question', 2, 64], ['reason', 1, 180]]) {
      if (!text(lead?.[key], max, min)) issues.push(`${field}[${index}].${key}: ${min}-${max} characters required; received ${typeof lead?.[key] === 'string' ? [...lead[key].trim()].length : 'no text'}; count each English letter and space`);
    }
    if (!plan.criteria.some(item => item.id === lead?.criterionId)) issues.push(`${field}[${index}].criterionId: bind this direction to an existing evidencePlan criterion`);
  });
  if (['title', 'question'].some(key => typeof value[0]?.[key] === 'string' && typeof value[1]?.[key] === 'string' && value[0][key].trim() === value[1][key].trim())) issues.push(`${field}: titles and questions must be distinct`);
  if (issues.length) throw invalid(issues.join('; '));
  const leads = value.map(lead => {
    const result = { title: lead.title.trim(), question: lead.question.trim(), reason: lead.reason.trim() };
    // The complete validated question is already a usable search query. Fall
    // back to it verbatim instead of paying to shorten an optional suggestion.
    if (hasDesign) privateLeadDesign.set(result, { routeRole: lead.routeRole, criterionId: lead.criterionId,
      searchQuery: text(lead.searchQuery, 64, 2) ? lead.searchQuery.trim() : result.question });
    return result;
  });
  // Neither order nor public IDs disclose the internal route design.
  const ordered = hasDesign && randomInt(2) ? [...leads].reverse() : leads;
  ordered.forEach((lead, index) => { lead.id = `r${round}-${index + 1}`; });
  return ordered;
}

function sameDirection(left, right) {
  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
  const a = normalize(left), b = normalize(right);
  if (a === b) return true;
  // Catch cosmetic rewrites as well as shuffled cards; semantic novelty is
  // also required explicitly in the planning prompt and its repair request.
  const pairs = value => { const chars = Array.from(value); return new Set(chars.slice(1).map((char, index) => chars[index] + char)); };
  const aa = pairs(a), bb = pairs(b);
  return 2 * [...aa].filter(pair => bb.has(pair)).length / Math.max(1, aa.size + bb.size) >= 0.88;
}

function leadGroups(session, index, promotedId) {
  const initial = index === 0 ? session.leads : session.rounds[index - 1].result.nextLeads;
  return [initial, ...(session.refreshedLeads.get(index) || []).filter(group => group.promotedId === promotedId).map(group => group.leads)];
}

function gameContext(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const number = (key, max) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? Math.round(Math.max(0, Math.min(max, value[key])) * 10) / 10 : 0;
  return { reached: number('reached', 100), truth: number('truth', 100), exposed: number('exposed', 100), regions: Math.floor(number('regions', 6)), operationPhase: value.operationPhase === 'public' ? 'public' : 'preparation', underAttack: value.underAttack === true };
}

function investigationHistory(session, promotedId) {
  return session.rounds.map((round, index) => ({ round: index + 1, question: round.result.query,
    assessment: round.result.assessment, chain: analysisRecords.get(round.result)?.chainAssessment,
    materials: round.result.materials.map(material => ({ headline: material.insight.headline, finding: material.insight.explanation,
      quote: material.insight.quote, sourceUrl: material.sources[0].url,
      promoted: material.id === (session.rounds[index + 1]?.promotedId || promotedId) })),
  }));
}

const LEAD_SHAPE = { title: '核对反例或失败条件的调查动作，建议8-16字', question: '包含原观点主体、范围与待查反证的自然问句，建议16-36字', reason: '这一步要查清的反例或限制，中性表述，建议30字以内', searchQuery: '独立反证检索词，建议40字符以内，最多64字符，英文按字母计数；保留主体与条件，不照抄正向claim', routeRole: 'direct或indirect，仅内部使用', criterionId: '对应的证据标准编号c1等' };
const LEAD_PAIR_SHAPE = ['direct', 'indirect'].map(routeRole => ({ ...LEAD_SHAPE, routeRole }));
const ANALYSIS_SHAPE = {
  action: 'final',
  finding: '本轮发现，60字以内；不把网页命中当事实认证',
  assessment: { status: 'supported=材料支持原始传闻；refuted=材料否定原始传闻；mixed=原传闻只在部分条件成立或材料相互冲突；insufficient=证据不足以判断原始传闻', summary: '综合本轮与历史材料评价原始传闻，说明本轮补齐的环节与边界，120字以内' },
  evidence: { headline: '本条反驳得到的依据、限制或缺口，25字以内', explanation: '原文如何支持或挑战这条反驳，保留事实与边界，60字以内', quoteId: '最高可用等级中的一段新原文passages.id；原文由服务器填回' },
  sourceRanking: [['给定sources.id，不得自造', 'direct | indirect | irrelevant，相对于本轮criterion和反证问题', 'strong | limited | weak', 'contradicts | limits | supports | context | unclear，相对于原始claim；限制条件不自动等于完全否定', '20字内，依据引句说明关系、原始性或局限，不以站点或排名代替判断']],
  chainAssessment: { unresolved: ['跨轮核对后仍阻断结论的关键缺口；已补齐或不影响原命题的旁支不列入'] },
};

function analysisSchema(round) {
  const { action, sourceRanking, evidence, finding, assessment, chainAssessment } = ANALYSIS_SHAPE;
  return { action, sourceRanking, evidence, finding, assessment, chainAssessment, nextLeads: round < RESEARCH_ROUNDS.length ? LEAD_PAIR_SHAPE : [] };
}

function repairHint(error) {
  if (validationErrors.has(error)) return error.validationIssue;
  if (modelFormatIssue(error)) return modelFormatIssue(error);
  if (error?.code === 'NO_NEW_EVIDENCE') return 'evidence: selected evidence was already used; choose a relevant passage with previouslyUsed=false and explain its new condition or finding; if none is suitable and canSearch=true, return action=search with a different targeted followupQuery';
  if (error?.code === 'UNTRACEABLE_QUOTE') return 'evidence.quoteId: select an existing full passages.id; do not supply sourceId or quote';
  if (['MODEL_FORMAT', 'MODEL_TRUNCATED'].includes(error?.code)) return 'result: submit exactly one call to the provided tool; fill every required slot with its declared type, allowed identifier and length; do not add fields or surrounding text';
  return null;
}

function previouslyUsed(session, url, quote) {
  return session.rounds.some(round => round.result.materials.some(material =>
    sourceKey(material.sources[0].url) === sourceKey(url) && material.insight.quote === quote));
}

const compareRanks = (a, b) => relevanceValues.indexOf(a.relevance) - relevanceValues.indexOf(b.relevance)
  || strengthValues.indexOf(a.strength) - strengthValues.indexOf(b.strength)
  || relationRanks[a.relation] - relationRanks[b.relation];

function rankedSources(raw, availableSources) {
  if (raw === undefined) return [];
  // Compact rows keep every source and every judgment while avoiding repeated
  // field names. Read older object responses as well, including saved drafts.
  const rows = Array.isArray(raw) ? raw.map(item => Array.isArray(item) && item.length === 5
    ? { sourceId: item[0], relevance: item[1], strength: item[2], relation: item[3], reason: item[4] } : item) : raw;
  const expectedIds = availableSources.map(source => source.id);
  const rankedIds = Array.isArray(rows) ? rows.map(item => item?.sourceId) : [];
  if (!Array.isArray(rows) || rankedIds.length !== expectedIds.length || new Set(rankedIds).size !== rankedIds.length || rankedIds.some(id => !expectedIds.includes(id))) {
    const missing = expectedIds.filter(id => !rankedIds.includes(id));
    throw invalid(`sourceRanking: rank all ${expectedIds.length} sources exactly once; required sourceIds: ${expectedIds.join(', ')}; missing sourceIds: ${missing.join(', ') || 'none'}; remove repeated or unknown IDs`);
  }
  const issues = [];
  rows.forEach((item, index) => {
    for (const [field, values] of [['relevance', relevanceValues], ['strength', strengthValues], ['relation', relationValues]]) {
      if (!values.includes(item[field])) issues.push(`sourceRanking[${index}].${field}: ${values.join(' | ')} required`);
    }
    if (!text(item.reason, 300)) issues.push(`sourceRanking[${index}].reason: a grounded reason of 1-300 characters required`);
  });
  // Tell one repair about every invalid row without echoing model-supplied
  // values, which may contain unrelated source text or private material.
  if (issues.length) throw invalid(issues.join('; '));
  return rows.map(item => ({ sourceId: item.sourceId, relevance: item.relevance, strength: item.strength, relation: item.relation, reason: item.reason.trim() })).sort(compareRanks);
}

function chainFinding(raw, finding) {
  if (raw === undefined) return { relation: 'unclear', finding, unresolved: ['尚未取得足以回答原观点的材料。'], nextCriterionId: '' };
  if (!raw || !relationValues.includes(raw.relation)) throw invalid('chainAssessment.relation: contradicts | limits | supports | context | unclear, relative to the original claim');
  if ((raw.finding !== undefined && !text(raw.finding, 400)) || !Array.isArray(raw.unresolved) || raw.unresolved.length > 6 || !raw.unresolved.every(item => text(item, 300))) throw invalid('chainAssessment: unresolved (0-6 concise gaps) required');
  return { relation: raw.relation, finding: raw.finding?.trim() || finding, unresolved: raw.unresolved.map(item => item.trim()) };
}

function normalizeAnalysis(raw, { session, roundId, lead, sources, availableSources, searches, context, promotedId, fetchedAt }) {
  const definition = RESEARCH_ROUNDS.find(round => round.id === roundId);
  if (!raw || typeof raw !== 'object') throw invalid();
  const issues = [], repairFields = new Set();
  const check = (field, validate) => {
    try { return validate(); } catch (error) {
      if (!validationErrors.has(error)) throw error;
      issues.push(error.validationIssue); repairFields.add(field);
    }
  };
  check('finding', () => { if (!text(raw.finding, 400)) throw invalid('finding: 1-400 characters'); });
  check('assessment', () => { if (!statuses.has(raw.assessment?.status)) throw invalid('assessment.status: supported | refuted | mixed | insufficient'); });
  check('assessment', () => { if (!text(raw.assessment?.summary, 400)) throw invalid('assessment.summary: 1-400 characters'); });
  const compact = raw.evidence !== undefined;
  if (compact ? !raw.evidence || typeof raw.evidence !== 'object' || Array.isArray(raw.evidence) : !Array.isArray(raw.materials) || raw.materials.length !== 2) throw invalid('evidence: one grounded evidence card required');
  if (raw.sourceRanking === undefined || raw.chainAssessment === undefined) throw invalid('sourceRanking and chainAssessment: both required for evidence-chain investigations');
  const ranking = check('sourceRanking', () => rankedSources(raw.sourceRanking, availableSources));
  const chainAssessment = check('chainAssessment', () => chainFinding(compact ? { relation: 'unclear', unresolved: raw.chainAssessment?.unresolved } : raw.chainAssessment, typeof raw.finding === 'string' ? raw.finding.trim() : ''));
  if (!compact && !['spread', 'persuasion'].every(focus => raw.materials.filter(material => material?.focus === focus).length === 1)) throw invalid('materials.focus: one spread and one persuasion required');
  const nextLeads = check('nextLeads', () => {
    if (definition.round === RESEARCH_ROUNDS.length && (!Array.isArray(raw.nextLeads) || raw.nextLeads.length)) throw invalid('nextLeads: final round requires an empty array');
    const next = definition.round < RESEARCH_ROUNDS.length ? leadsFrom(raw.nextLeads, definition.round + 1, session.evidencePlan) : [];
    if (next.some(lead => !privateLeadDesign.has(lead))) throw invalid('nextLeads.routeRole: one direct and one indirect required');
    return next;
  });
  const cardIssueStart = issues.length;
  // The model selects facts; the game supplies its own bonus after selection.
  // Older two-card responses remain readable without manufacturing a second card.
  const templates = compact ? definition.materials.filter(template => template.focus === (context.reached < 60 ? 'spread' : 'persuasion')) : definition.materials;
  const entries = templates.map(template => {
    const value = compact ? { headline: raw.evidence.headline, explanation: raw.evidence.explanation, quoteId: raw.evidence.quoteId,
      effectId: template.focus === 'spread' ? 'viral' : 'authority',
      effectReason: template.focus === 'spread' ? '让更多人接触这份调查材料。' : '将调查材料带给正在观望的人。' } : raw.materials.find(material => material?.focus === template.focus);
    const source = value?.quoteId === undefined ? sources.find(item => item.id === value?.sourceId) : sources.find(item => sourcePassages(item).some(passage => passage.id === value.quoteId));
    for (const [field, max] of [['headline', 120], ['explanation', 500], ['effectReason', 180]]) {
      if (!text(value[field], max)) issues.push(`${compact ? 'evidence' : `materials.${template.focus}`}.${field}: 1-${max} characters`);
    }
    const effect = INVESTIGATION_EFFECTS[value.effectId];
    if (!effect || effect.focus !== template.focus) issues.push(`materials.${template.focus}.effectId: ${template.focus === 'spread' ? 'viral | relay' : 'authority | explain'}`);
    return { template, value, source };
  });
  if (entries.length === 2 && entries[0].source && entries[0].source.id === entries[1].source?.id) {
    const alternatives = availableSources.filter(source => source.id !== entries[0].source.id).flatMap(source => source.passages.map(passage => passage.id));
    issues.push(`materials.persuasion.quoteId: choose two different sources; spread already uses ${entries[0].source.id}; select one of ${alternatives.join(', ')}`);
  }
  if (!compact && !['spread', 'persuasion'].includes(raw.recommendation?.focus)) issues.push('recommendation.focus: spread | persuasion');
  if (!compact && !text(raw.recommendation?.reason, 180)) issues.push('recommendation.reason: 1-180 characters');
  if (issues.length > cardIssueStart) repairFields.add(compact ? 'evidence' : 'materials');
  const formatError = issues.length ? invalid(issues.join('; '), [...repairFields]) : null;
  // A next-direction repair is narrow only after the existing evidence passes
  // traceability, novelty and ranking. Other structural faults repair together.
  if (formatError && (repairFields.size !== 1 || !repairFields.has('nextLeads'))) throw formatError;
  const materials = entries.map(({ template, value, source }) => {
    if (value?.quoteId !== undefined && (!source || (value.sourceId !== undefined && value.sourceId !== source.id))) throw new SearchError('UNTRACEABLE_QUOTE', '有一段证据还对不上原文，请重试；金币会退回。', 422);
    if (!source) throw invalid(`materials.${template.focus}.source: select a provided source`);
    const quote = value.quoteId === undefined ? (typeof value.quote === 'string' ? value.quote.trim() : undefined) : sourcePassages(source).find(passage => passage.id === value.quoteId)?.text;
    if (!text(quote, 800) || ![source.summary, source.content].some(body => body?.includes(quote))) throw new SearchError('UNTRACEABLE_QUOTE', '有一段证据还对不上原文，请重试；金币会退回。', 422);
    const { id, ...record } = source;
    return { id: template.id, focus: template.focus, eventId: template.eventId, title: source.title, finding: value.explanation.trim(),
      insight: { headline: value.headline.trim(), explanation: value.explanation.trim(), quote, kind: 'context' },
      sources: [record], nextQuestion: nextLeads?.[0]?.question || null, effectId: value.effectId, effectReason: value.effectReason.trim() };
  });
  // A tactical bonus never decides which fact is published. Choose the best
  // grounded candidate after relevance/strength ranking, regardless of map.
  const chosen = ranking.flatMap(item => entries.filter(entry => entry.source?.id === item.sourceId)).find(entry => {
    const material = materials.find(item => item.id === entry.template.id);
    return !previouslyUsed(session, material.sources[0].url, material.insight.quote);
  });
  const bestFresh = ranking.find(item => availableSources.find(source => source.id === item.sourceId)?.passages.some(passage => !passage.previouslyUsed));
  // Equal grades are ties, not a factual reason to reject an otherwise valid
  // choice merely because another source appeared first in the search response.
  if (bestFresh && (!chosen || compareRanks(ranking.find(item => item.sourceId === chosen.source.id), bestFresh) > 0)) {
    const eligible = ranking.filter(item => compareRanks(item, bestFresh) === 0).map(item => item.sourceId);
    throw invalid(`materials: include a previouslyUsed=false passage from the highest-ranked usable sources: ${eligible.join(', ')}; or correct their relevance ranking with evidence`);
  }
  const selected = materials.find(material => material.id === chosen?.template.id) || materials[0];
  if (compact && chosen) chainAssessment.relation = ranking.find(item => item.sourceId === chosen.source.id).relation;
  if (previouslyUsed(session, selected.sources[0].url, selected.insight.quote)) {
    throw new SearchError('NO_NEW_EVIDENCE', '这轮还没整理出可用的新证据，换一条线再查；金币会退回。', 422);
  }
  if (formatError) throw formatError;
  const parent = session.rounds.at(-1)?.result.materials.find(material => material.id === promotedId);
  const assessment = { status: raw.assessment.status, summary: raw.assessment.summary.trim() };
  const providerRequestId = searches.map(item => item.requestId).filter(value => text(value, 160)).join(',');
  const result = {
    provider: '腾讯云元宝搜索 · 调查员', requestId: text(providerRequestId, 160) ? providerRequestId : randomUUID(), fetchedAt,
    query: lead.question, searchQuery: searches.map(item => item.query).join('；'), finding: raw.finding.trim(),
    sessionId: session.id, leadId: lead.id, claim: session.claim, materials, nextLeads, assessment,
    recommendation: { materialId: selected.id, reason: chosen ? ranking.find(item => item.sourceId === chosen.source.id).reason.slice(0, 180) : raw.recommendation.reason.trim() },
    investigation: { question: lead.question, previousFinding: parent?.insight.explanation || '', summary: assessment.summary, delta: raw.finding.trim(), openQuestion: nextLeads[0]?.question || '' },
  };
  // The game sees facts and limits, not hidden path scores or ending hints.
  analysisRecords.set(result, { ranking, chainAssessment, sources: clone(sources), plan: session.evidencePlan });
  return result;
}

const analysisRecords = new WeakMap();

const VERDICT_SHAPE = {
  status: 'refuted | supported | mixed | insufficient，相对于原始claim', confidence: 'high=依据扎实；medium=已有可信反例但资料仍有边界；low=反驳只有猜测或关键依据不足',
  summary: '按通常语义说明原观点是否被反例推翻，100字内', rationale: '最关键的事实或反例为何成立，兼述边界，250字内，不输出私有思考', unresolved: ['仍可补充的资料或疑点，每项60字内；说明是否影响反例，非空不等于反驳失败'],
  chain: [{ roundId: '原样使用publications.roundId', finding: '材料实际证明什么，60字内', strength: 'strong=扎实依据；limited=可用但有局限的具体事实；weak=猜测或空泛断言', relevance: 'direct | indirect | irrelevant，按是否回答关键问题判断，不按一手或二手划分', gap: '材料边界或待补充细节，已补齐的说明依据，60字内；不自动阻挡结论，没有则为空' }],
  criteriaReview: [{ criterionId: '选取真正影响结论的evidencePlan.criteria.id，无须覆盖全部计划项', outcome: 'supports | refutes | mixed | unresolved | not_required；not_required用于不影响原命题判断的旁支', decisive: '布尔：是否已有合理充分的反例或依据回答原命题，不要求资料完备；旁支为false', publicationRefs: [{ quoteId: '选择已公布passages.id，可引用多轮，不抄写原文', basis: 'primary-observation | reproducible-analysis | original-document | secondary-assertion；可信具体报道可用secondary-assertion，不自动降级' }], explanation: '引用中的反例如何推翻原话，或为何仍不能判断，80字内' }],
};

function verdictEvidence(publications) {
  const references = new Map(), segmenter = new Intl.Segmenter('zh', { granularity: 'sentence' });
  const records = publications.map((publication, publicationIndex) => {
    let quoteId;
    const sources = publication.sources.map((source, sourceIndex) => {
      const passages = [];
      const append = value => {
        const quote = value.trim();
        if (!quote) return null;
        const existing = passages.find(passage => passage.text.includes(quote));
        if (existing) return existing.id;
        const id = `r${publicationIndex + 1}-s${sourceIndex + 1}-p${passages.length + 1}`;
        passages.push({ id, text: quote });
        references.set(id, { roundId: publication.roundId, materialId: publication.materialId, quote, source });
        return id;
      };
      // Keep every supplied sentence, including contrary context. Deduplicate
      // overlapping summary/body text; unlike research, final review has no
      // excerpt budget that could discard a limiting condition near the end.
      const bodies = [...new Set([source.summary, source.content].filter(Boolean))];
      for (const body of bodies.filter(value => !bodies.some(other => other !== value && other.includes(value)))) {
        let pending = '';
        for (const { segment } of segmenter.segment(body)) {
          if (pending.length + segment.length > 800) { append(pending); pending = ''; }
          if (segment.length > 800) append(segment);
          else pending += segment;
        }
        append(pending);
      }
      if ([source.summary, source.content].some(body => body?.includes(publication.quote))) quoteId ||= append(publication.quote);
      return { title: source.title, url: source.url, organization: source.organization, date: source.date, passages };
    });
    return { roundId: publication.roundId, materialId: publication.materialId, question: publication.question, finding: publication.finding, headline: publication.headline, quoteId, sources };
  });
  return { publications: records, references };
}

function normalizeVerdict(raw, session, publications, references) {
  if (!raw || !statuses.has(raw.status) || !['high', 'medium', 'low'].includes(raw.confidence)
    || !text(raw.summary, 1600) || !text(raw.rationale, 4000) || !Array.isArray(raw.unresolved) || raw.unresolved.length > 10 || !raw.unresolved.every(item => text(item, 600))) throw invalid('verdict: valid status, confidence, summary, rationale and unresolved required');
  if (!Array.isArray(raw.chain) || raw.chain.length !== publications.length || new Set(raw.chain.map(item => item?.roundId)).size !== publications.length) throw invalid('verdict.chain: exactly one entry per published round');
  const chain = publications.map(publication => {
    const item = raw.chain.find(item => item?.roundId === publication.roundId);
    if (!item || (item.materialId !== undefined && item.materialId !== publication.materialId) || !text(item.finding, 1600) || !strengthValues.includes(item.strength) || !relevanceValues.includes(item.relevance) || !text(item.gap, 600, 0)) throw invalid('verdict.chain: each entry must match a published material and contain finding, strength, relevance and gap');
    return { roundId: publication.roundId, question: publication.question, finding: item.finding.trim(), strength: item.strength, relevance: item.relevance, sourceUrls: publication.sources.map(source => source.url), gap: item.gap.trim() };
  });
  const criteria = session.evidencePlan.criteria;
  const reviews = raw.criteriaReview || [];
  if (!Array.isArray(reviews) || reviews.length > 5 || new Set(reviews.map(item => item?.criterionId)).size !== reviews.length) throw invalid('verdict.criteriaReview: one review per known criterion');
  const checkedReviews = reviews.map((item, index) => {
    const field = `verdict.criteriaReview[${index}]`;
    if (!criteria.some(criterion => criterion.id === item?.criterionId)) throw invalid(`${field}.criterionId: select one of ${criteria.map(criterion => criterion.id).join(', ')}`);
    if (!['supports', 'refutes', 'mixed', 'unresolved', 'not_required'].includes(item.outcome)) throw invalid(`${field}.outcome: supports | refutes | mixed | unresolved | not_required`);
    if (typeof item.decisive !== 'boolean') throw invalid(`${field}.decisive: a boolean is required`);
    if (item.outcome === 'not_required' && item.decisive) throw invalid(`${field}.decisive: a nonessential planning branch cannot decide the original claim`);
    if (!text(item.explanation, 1000)) throw invalid(`${field}.explanation: 1-1000 characters required`);
    if (!Array.isArray(item.publicationRefs) || item.publicationRefs.length > 5) throw invalid(`${field}.publicationRefs: 0-5 references to actually published evidence required`);
    const publicationRefs = item.publicationRefs.map(ref => {
      if (!ref || !['primary-observation', 'reproducible-analysis', 'original-document', 'secondary-assertion'].includes(ref.basis)) throw invalid('verdict.criteriaReview.publicationRefs: valid basis and existing quoteId required');
      if (ref.quoteId !== undefined) {
        const evidence = references.get(ref.quoteId);
        if (!evidence || (ref.roundId !== undefined && ref.roundId !== evidence.roundId) || (ref.materialId !== undefined && ref.materialId !== evidence.materialId)
          || (ref.proofQuote !== undefined && ref.proofQuote !== evidence.quote)
          || ![evidence.source.summary, evidence.source.content].some(body => body?.includes(evidence.quote))) throw invalid('verdict.criteriaReview.publicationRefs.quoteId: select an existing published passage; its round, material and source cannot be changed');
        return { roundId: evidence.roundId, materialId: evidence.materialId, basis: ref.basis };
      }
      // Accept existing structured drafts while new requests use server IDs.
      const publication = publications.find(item => item.roundId === ref.roundId && item.materialId === ref.materialId);
      if (!publication || !text(ref.proofQuote, 1000) || !publication.sources.some(source => [source.summary, source.content].some(body => body?.includes(ref.proofQuote)))) throw invalid('verdict.criteriaReview.publicationRefs: basis and verbatim proofQuote from the cited published source required');
      return { roundId: publication.roundId, materialId: publication.materialId, basis: ref.basis };
    });
    return { ...item, publicationRefs };
  });
  let status = raw.status, confidence = raw.confidence, summary = raw.summary.trim(), rationale = raw.rationale.trim();
  const unresolved = raw.unresolved.map(item => item.trim());
  const decisiveRefutation = checkedReviews.some(review => review.outcome === 'refutes' && review.decisive && review.publicationRefs.some(ref => chain.some(item => item.roundId === ref.roundId && item.relevance === 'direct' && item.strength !== 'weak')));
  const conflictingDecision = checkedReviews.some(review => review.decisive && ['supports', 'mixed'].includes(review.outcome));
  // Judge the cited counterexample, not checklist completeness. Remaining
  // questions can be nonessential; an explicit contrary decisive judgment
  // cannot coexist with an affirmative refutation.
  if (status === 'refuted' && (confidence === 'low' || !decisiveRefutation || conflictingDecision)) {
    if (conflictingDecision) unresolved.unshift('已公布材料对原观点存在影响判断的相反依据。');
    if (!unresolved.length) unresolved.push(!decisiveRefutation ? '尚未找到直接支撑反驳的可用事实或反例。' : '已公布材料对反驳的支持仍不够确定。');
    status = 'insufficient'; confidence = 'low';
    summary = '已公布的材料尚未形成充分反驳。';
    rationale = `这次反驳仍受到以下问题的限制：${unresolved[0]}这不代表原观点已被证实。`;
  }
  return { status, confidence, summary, rationale, unresolved, reviewedPublications: publications.map(({ roundId, materialId }) => ({ roundId, materialId })), chain };
}

function addSources(sources, incoming) {
  const compact = value => value.replace(/\s+/g, '').toLowerCase();
  for (const source of incoming || []) {
    const url = safeSourceUrl(source.url);
    if (!url || !text(source.title, 240) || !text(source.summary, 2500) || !text(source.organization, 160)) continue;
    const content = typeof source.content === 'string' ? [...source.content.trim()].slice(0, 3000).join('') : '';
    const imageUrl = safeSourceUrl(source.imageUrl);
    const record = { title: source.title.trim(), url, summary: source.summary.trim(), content: text(content, 3000) ? content : '', organization: source.organization.trim(), date: typeof source.date === 'string' ? source.date.slice(0, 80) : '', ...(imageUrl ? { imageUrl, imageCaption: text(source.imageCaption, 180) ? source.imageCaption.trim() : '' } : {}) };
    const existing = sources.find(item => sourceKey(item.url) === sourceKey(url));
    if (existing) {
      // A targeted search can return a different passage from the same page.
      // Use that intact excerpt, never join disconnected snippets into a quote.
      Object.assign(existing, record, { url: existing.url, content: record.content || existing.content });
      continue;
    }
    if (sources.length >= 16 || sources.some(item => (compact(item.title).length >= 20 && compact(item.title) === compact(record.title))
      || (record.summary.length >= 120 && compact(item.summary) === compact(record.summary)))) continue;
    sources.push({ id: `s${sources.length + 1}`, ...record });
  }
}

function sourcePassages(source) {
  const passages = [], segmenter = new Intl.Segmenter('zh', { granularity: 'sentence' });
  const content = source.content && !source.summary.includes(source.content) ? source.content : '';
  let remaining = 900;
  for (const body of [source.summary, content]) {
    if (!body || !remaining) continue;
    // Leave room for new details in the body even when the summary is long.
    // Skip repeated full sentences, not the entire body containing a summary.
    let budget = body === source.summary && content ? 450 : remaining;
    let pending = '';
    const append = value => {
      const quote = value.trim();
      if (!quote || quote.length > budget || quote.length > 800 || passages.some(passage => passage.text === quote)) return;
      passages.push({ id: `${source.id}-p${passages.length + 1}`, text: quote });
      remaining -= quote.length; budget -= quote.length;
    };
    for (const { segment } of segmenter.segment(body)) {
      if (body === content && source.summary.includes(segment.trim())) { append(pending); pending = ''; continue; }
      if (pending.length + segment.length > 350) { append(pending); pending = ''; }
      // Never chop a long sentence in half: its negation or scope may be at
      // the end. Oversized sentences are left for a more targeted search.
      if (segment.length > 350) { if (segment.trim().length <= 800) append(segment); }
      else pending += segment;
    }
    append(pending);
  }
  return passages;
}

function modelSources(sources, hasFollowup, session) {
  // Keep passages verbatim so every model quote can still be checked against
  // the complete server-owned record. A follow-up must not be buried after
  // eight first-search hits, so include both ends when more results arrive.
  const available = sources.map(source => ({ id: source.id, url: source.url, title: source.title, organization: source.organization, date: source.date,
    passages: sourcePassages(source).map(passage => ({ ...passage, previouslyUsed: previouslyUsed(session, source.url, passage.text) })),
  })).filter(source => source.passages.length);
  const fresh = available.filter(source => source.passages.some(passage => !passage.previouslyUsed));
  const used = available.filter(source => source.passages.every(passage => passage.previouslyUsed));
  const preferred = hasFollowup && fresh.length > 8 ? [...fresh.slice(0, 4), ...fresh.slice(-4)] : fresh.slice(0, 8);
  return [...preferred, ...fresh.filter(source => !preferred.includes(source)), ...used].slice(0, 16);
}

export function createInvestigationService({ model, search, now = () => Date.now(), sessionTtlMs = 2 * 60 * 60 * 1000, maxSessions = 100, timeoutMs = 150000, diagnostic = entry => console.warn('[调查校验]', JSON.stringify(entry)) } = {}) {
  const sessions = new Map(), requests = new Map();
  const configured = Boolean(model?.configured && search?.configured && typeof search.retrieve === 'function');
  function recordValidationFailure(error, round) {
    const validationIssue = repairHint(error);
    if (!validationIssue) return;
    // Only our own field constraints reach logs, never a provider message,
    // source passage, draft, request credentials or private reasoning.
    try { diagnostic({ round, code: error.code, validationIssue }); } catch { /* Diagnostics must not change refunds or retries. */ }
  }
  function expire() {
    for (const [id, session] of sessions) if (session.expires < now() && !session.pending) { discardJobs(session); sessions.delete(id); }
    for (const [id, item] of requests) if (item.expires < now()) requests.delete(id);
  }
  function once(requestId, fingerprint, action, budgetMs = timeoutMs) {
    if (!requestIdValid(requestId)) throw new SearchError('INVALID_REQUEST', '调查请求无效，请重新发起。', 400);
    expire();
    const old = requests.get(requestId);
    if (old && old.fingerprint !== fingerprint) throw new SearchError('REQUEST_CONFLICT', '这次调查已提交，请不要修改同一请求。', 409);
    if (old) return old.promise.then(clone);
    if (!configured) throw new SearchError('INVESTIGATION_NOT_CONFIGURED', '调查服务还没有配置好，请联系开发者。', 503);
    const { type, sessionId } = JSON.parse(fingerprint);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(requestTimeout(type)), budgetMs);
    const promise = withSignal(Promise.resolve().then(() => action(controller.signal)), controller.signal).finally(() => clearTimeout(timer));
    requests.set(requestId, { fingerprint, promise, controller, type, sessionId, expires: now() + sessionTtlMs });
    promise.catch(() => { requests.delete(requestId); });
    return promise.then(clone);
  }
  const stopped = () => new SearchError('SESSION_CLOSED', '这局调查已结束，请重新开始。', 410);
  const timedOut = () => Object.assign(new SearchError('MODEL_TIMEOUT', '调查暂未完成，已找到的资料会保留，请稍后重试。', 504), { resumeCheckpoint: true });
  const requestTimeout = type => {
    const message = { plan: '调查方向准备超时，请重新准备；不会扣除金币。',
      refresh: '新问题准备超时，原来的方向仍可使用；本次刷新金币会退回。',
      verdict: '结案复核暂未完成，本局记录已保留，请稍后重试。' }[type];
    return message ? new SearchError('MODEL_TIMEOUT', message, 504) : timedOut();
  };
  function checkJob(job) {
    if (job.controller.signal.aborted) throw job.controller.signal.reason;
    if (job.session.closed) throw stopped();
    if (job.session.expires < now()) throw new SearchError('SESSION_EXPIRED', '这局调查记录已过期，请重新开始。', 410);
  }
  function withSignal(promise, signal, fallback = timedOut) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason instanceof SearchError ? signal.reason : fallback());
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  function discardJobs(session, keep) {
    for (const [key, job] of session.jobs) if (job !== keep) {
      job.controller.abort(stopped()); session.jobs.delete(key);
    }
  }
  function startJob(session, index, lead, promotedId) {
    const roundId = RESEARCH_ROUNDS[index].id;
    const signature = JSON.stringify({ roundId, leadId: lead.id, promotedId });
    const old = session.jobs.get(signature);
    if (old && old.state !== 'failed') return old;
    const controller = new AbortController(), resume = old?.canResume === true;
    const job = { session, index, roundId, lead, promotedId, signature,
      controller, state: 'running', notBefore: old?.notBefore || 0,
      progress: resume ? clone(old.progress) : { roundId, status: 'running', events: [] },
      checkpoint: resume ? old.checkpoint : { sources: [], searches: [], nextQuery: privateLeadDesign.get(lead).searchQuery,
        attempt: 0, validationIssue: '', previousDraft: undefined, repairFields: [], seenIssues: new Set() } };
    job.progress.status = 'running';
    job.emit = (stage, details = {}) => job.progress.events.push({ seq: job.progress.events.length + 1, stage, at: new Date(now()).toISOString(), ...details });
    // A player retry can resume a failed transport from its sources and draft.
    // No task is started before the player selects a direction.
    if (resume) job.emit('repairing', { retry: true, retryStage: job.checkpoint.nextQuery ? 'searching' : 'analyzing', sourceCount: job.checkpoint.sources.length });
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const abort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(timedOut()), timeoutMs);
    timer.unref?.();
    job.promise = pending.then(result => { job.state = 'completed'; return result; }, error => {
      job.state = 'failed'; job.progress.status = 'failed';
      job.canResume = error?.retryable === true || error?.resumeCheckpoint === true;
      job.notBefore = Math.max(now() + (error?.retryAfterMs || 0), job.checkpoint.notBefore || 0);
      const codes = ['MODEL_TIMEOUT', 'MODEL_UNAVAILABLE', 'MODEL_FORMAT', 'MODEL_TRUNCATED', 'INVESTIGATION_FORMAT', 'UNTRACEABLE_QUOTE', 'NO_NEW_EVIDENCE', 'INSUFFICIENT_SOURCES', 'SEARCH_TIMEOUT', 'SEARCH_UNAVAILABLE', 'SEARCH_AUTH', 'SEARCH_LIMIT'];
      job.emit('failed', { code: codes.includes(error?.code) ? error.code : 'INVESTIGATION_FAILED' });
      throw error;
    }).finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); });
    // Failed work keeps its checkpoint for an explicit retry, until the
    // direction changes or the session closes.
    job.promise.catch(() => {});
    session.jobs.set(signature, job);
    withSignal(executeJob(job), controller.signal).then(resolve, reject);
    return job;
  }
  async function executeJob(job) {
    checkJob(job);
    if (job.notBefore > now()) { await abortableDelay(job.notBefore - now(), job.controller.signal); checkJob(job); }
    const { session, index, roundId, lead, promotedId, checkpoint, progress, emit } = job;
    const signal = job.controller.signal, { sources, searches } = checkpoint;
    const design = privateLeadDesign.get(lead);
    const criterion = session.evidencePlan.criteria.find(item => item.id === design.criterionId);
    const retryProgress = retryStage => retry => {
      checkpoint.notBefore = now() + (retry.delayMs || 0);
      if (!signal.aborted) emit('repairing', { retry: true, retryStage, retryAttempt: retry.nextAttempt, sourceCount: sources.length });
    };
    const retrieve = async query => {
      checkpoint.nextQuery = query;
      if (progress.events.some(event => event.stage === 'searching' && event.searchAttempt === searches.length + 1)) {
        emit('repairing', { retry: true, retryStage: 'searching', sourceCount: sources.length });
      } else emit('searching', { query, searchAttempt: searches.length + 1 });
      const result = await search.retrieve(query, { signal, retryAttempts: 3, onRetry: retryProgress('searching') });
      checkJob(job);
      checkpoint.nextQuery = null;
      searches.push({ query, requestId: result.requestId || '' });
      addSources(sources, result.sources);
      emit('sources', { searchAttempt: searches.length, sourceCount: sources.length,
        // Snapshot the cumulative, validated list before later searches
        // extend it. Public progress needs links, never provider bodies.
        sources: sources.map(({ title, url, organization, date }) => ({ title, url, organization, date })) });
    };
    if (checkpoint.nextQuery) await retrieve(checkpoint.nextQuery);
    // Keep searches in the first two calls and reserve the last call for
    // report repair, even when a query itself needed correction.
    while (checkpoint.attempt < 4) {
      checkJob(job);
      const attempt = checkpoint.attempt;
      const canSearch = searches.length < 2 && attempt < 2;
      const availableSources = modelSources(sources, searches.length > 1, session);
      if (!canSearch && !availableSources.length) throw new SearchError('INSUFFICIENT_SOURCES', '这次还没找到能核对的材料，换一条线再查；金币会退回。', 422);
      try {
        emit(checkpoint.validationIssue ? 'repairing' : 'analyzing', { modelAttempt: attempt + 1, sourceCount: availableSources.length });
        // A direction-only repair plans the next move from the existing
        // finding. It cannot rewrite evidence or start another search.
        const selectedSources = availableSources.filter(source => source.passages.some(passage => passage.id === checkpoint.previousDraft?.evidence?.quoteId));
        const repairingLeads = checkpoint.repairFields.length === 1 && checkpoint.repairFields[0] === 'nextLeads' && selectedSources.length > 0;
        const draftContext = repairingLeads ? Object.fromEntries(['finding', 'assessment', 'evidence', 'chainAssessment', 'nextLeads'].map(key => [key, checkpoint.previousDraft[key]])) : checkpoint.previousDraft;
        const reply = await model.complete({
          task: repairingLeads ? FALSIFICATION_TASK + PATH_DESIGN + '本轮材料和判断保留不动。根据history、previousDraft的发现与缺口，仅修复validationIssue指出的nextLeads，返回下一轮的两个方向；最后一轮返回空数组。不要重写其他字段或要求补查。' : [
            FALSIFICATION_TASK,
            `当前是第${index + 1}轮调查。围绕criterion.counterEvidence、question和实际searches检验refutationTarget，只整理一份最合适的新证据evidence。headline与explanation说明原文对反驳原观点的作用、限制或缺口；若材料支持原观点，如实说明本条反驳未获支持，不复述宣传标题，也不抹去相反证据。相近研究不等于本命题已被检验。`,
            'assessment综合本轮与history评价原始claim，不评价本轮问题或辟谣。supported是原观点受支持，refuted是原观点被否定；局部条件或冲突用mixed，关键依据缺失用insufficient，不能推翻更强版本后宣称原句已被推翻。按同一对象、范围和时间连接跨轮证据，summary说明补齐了什么；单份局限不自动否定整链，不把背景问题升级成必要条件。',
            canSearch ? '存在影响本轮判断的具体缺口，且能提出不同查询补齐时，选择提交工具的search分支，在followupQuery填写主体、必要范围与待查条件，建议40字符内，最多64字符，英文按字母计数。支持原观点本身不构成补查理由。已有材料能交代本轮依据与局限时选择final分支；缺口可留给下一轮，勿为追求预设结论反复搜索。' : '补查阶段已结束，提交final分支的完整结果。仍有缺口如实说明，不能强行下结论。',
            'quoteId只选给定passages.id，原文由服务器填回。转载、投稿和商业教程不等于官方背书。history保留各轮引文与缺口，promoted是玩家沿用的材料，不是新的调查目标。逐项核对历史缺口是否被本轮补齐，chainAssessment.unresolved仅留仍阻断原命题判断的关键缺口。支持原观点时如实保留已核对条件。',
            'evidence必须引用previouslyUsed=false的片段，且有新增条件、数据或独立观察；换引句或同稿转载不自动构成新发现。没有可用新材料且canSearch时，换具体缺口补查。',
            index < RESEARCH_ROUNDS.length - 1 ? PATH_DESIGN + 'nextLeads严格两条，优先补齐核心反证链。缺口已被另一轮补齐则不重复追查；链已闭合可核对相反证据或适用边界，不为继续调查凭空增加必要条件。不要因材料支持原观点就转为完善正向方案；没有记录时换实质方向，不原地换词。' : '这是最后一轮，nextLeads为空。综合history和本轮资料评价原始观点，保留supported、mixed或insufficient；轮次用完不代表证伪成功。',
            `sourceRanking逐一覆盖全部${availableSources.length}个来源：${availableSources.map(source => source.id).join('、')}，无关项也标记。relevance针对本轮实际证明环节，直接支持原观点的材料也可direct；strength按原始性、独立性与适用范围判断，relation相对于claim。不能要求每份材料独自证明整个命题，也不能凭关联跳过必要环节。按关联度、证明力、关系分级，同档优先反例与边界，弱负面不得压过强直接支持。evidence选最高可用等级中的任一新片段，同等级不受来源顺序限制。`,
            checkpoint.validationIssue ? '上一份结果的具体校验问题在validationIssue。保留正确内容；结构或编号问题只修复对应字段，重复证据则重新选材并同步更新发现与推荐，必要时按canSearch补查。不得编造新增事实。' : '',
          ].filter(Boolean).join('\n'),
          data: { claim: session.claim, evidencePlan: session.evidencePlan, criterion, question: lead.question, round: index + 1, canSearch: repairingLeads ? false : canSearch,
            history: investigationHistory(session, promotedId),
            searches: searches.map(item => item.query), sources: repairingLeads ? selectedSources : availableSources,
            ...(checkpoint.validationIssue ? { validationIssue: checkpoint.validationIssue, ...(draftContext ? { previousDraft: draftContext } : {}) } : {}) },
          schema: repairingLeads ? { nextLeads: analysisSchema(index + 1).nextLeads } : analysisSchema(index + 1),
        }, { signal, retryAttempts: 3, onRetry: retryProgress('analyzing') });
        checkJob(job);
        const raw = repairingLeads ? { ...checkpoint.previousDraft, nextLeads: reply?.nextLeads } : reply;
        checkpoint.previousDraft = raw;
        if (raw.action !== undefined && !['search', 'final'].includes(raw.action)) throw invalid('action: search | final');
        // A legacy final answer may still contain a followupQuery. Validate
        // its complete materials instead of discarding them or paying again.
        const wantsSearch = raw.action === 'search' || (raw.action === undefined && raw.evidence === undefined && !Array.isArray(raw.materials) && text(raw.followupQuery, 64, 2));
        if (wantsSearch) {
          if (!canSearch) throw invalid('action: search is closed; return final with materials, assessment and nextLeads');
          if (!text(raw.followupQuery, 64, 2)) throw invalid('followupQuery: 2-64 characters required, count every English letter and space; aim below 40 while preserving subject and necessary scope');
          const query = raw.followupQuery.trim();
          if (searches.some(item => item.query === query)) throw invalid('followupQuery: choose a different unresolved question');
          checkpoint.previousDraft = undefined; checkpoint.validationIssue = ''; checkpoint.repairFields = []; checkpoint.seenIssues.clear();
          checkpoint.attempt++;
          await retrieve(query); continue;
        }
        emit('reporting', { modelAttempt: attempt + 1, sourceCount: availableSources.length });
        const fetchedAt = new Date(now()).toISOString();
        normalizeAnalysis(raw, { session, roundId, lead, sources, availableSources, searches, context: gameContext(), promotedId, fetchedAt });
        checkJob(job);
        progress.status = 'completed'; emit('complete', { sourceCount: sources.length });
        return { raw, availableSources, fetchedAt };
      } catch (error) {
        const issue = repairHint(error);
        if (!issue) throw error;
        checkpoint.validationIssue = issue;
        checkpoint.repairFields = validationErrors.has(error) ? error.repairFields : [];
        // Repeating the same failed repair is not another investigation.
        // Distinct repairs and one useful follow-up retain the 4-call cap.
        if (!checkpoint.validationIssue || checkpoint.seenIssues.has(checkpoint.validationIssue) || attempt === 3) {
          recordValidationFailure(error, roundId);
          if (validationErrors.has(error)) error.message = '资料已找到，但证据卡片没能整理完成，请重试。';
          throw error;
        }
        checkpoint.seenIssues.add(checkpoint.validationIssue);
        checkpoint.attempt++;
      }
    }
    throw invalid();
  }
  return { configured,
    verdict(input) {
      if (!text(input?.sessionId, 80) || !Array.isArray(input.publications) || input.publications.length > RESEARCH_ROUNDS.length
        || input.publications.some(item => !RESEARCH_ROUNDS.some(round => round.id === item?.roundId) || !text(item?.materialId, 80))
        || new Set(input.publications.map(item => item.roundId)).size !== input.publications.length) throw new SearchError('INVALID_PUBLICATIONS', '结案材料列表无效，请重新打开战报。', 400);
      const refs = input.publications.map(({ roundId, materialId }) => ({ roundId, materialId })).sort((a, b) => a.roundId.localeCompare(b.roundId));
      const signature = JSON.stringify(refs);
      return once(input.requestId, JSON.stringify({ type: 'verdict', sessionId: input.sessionId, publications: refs }), async signal => {
        const session = sessions.get(input.sessionId);
        if (!session || session.expires < now()) throw new SearchError('SESSION_EXPIRED', '这局调查记录已过期，暂时无法完成结案复核。', 410);
        if (session.pending) throw new SearchError('INVESTIGATION_BUSY', '本轮调查尚未完成，完成后再进行结案复核。', 409);
        const publications = refs.map(ref => {
          const round = session.rounds[RESEARCH_ROUNDS.findIndex(item => item.id === ref.roundId)];
          const material = round?.result.materials.find(item => item.id === ref.materialId);
          // Server-owned completed records are the only evidence. Never trust
          // client findings, quotes, URLs, scores or a supplied verdict.
          if (!material) throw new SearchError('INVALID_PUBLICATIONS', '公布材料与本局调查记录不一致，请重新打开战报。', 400);
          return { ...ref, question: round.result.query, finding: material.finding, headline: material.insight.headline, quote: material.insight.quote,
            sources: material.sources.map(({ title, url, organization, summary, content, date }) => ({ title, url, organization, summary, content, date })) };
        });
        let audited = session.verdicts.get(signature);
        if (!audited) {
          audited = (async () => {
            if (!publications.length) return { status: 'insufficient', confidence: 'low', summary: '尚未公布任何证据，不能证明原观点是谎言。', rationale: '传播上的成功不能代替事实查证；没有公布的材料不能作为本次传播结论的依据。', unresolved: ['没有可复核的已公布证据。'], reviewedPublications: [], chain: [] };
            const evidence = verdictEvidence(publications);
            const priorGaps = [...new Set(refs.flatMap(ref => analysisRecords.get(session.rounds[RESEARCH_ROUNDS.findIndex(round => round.id === ref.roundId)].result)?.chainAssessment.unresolved || []))];
            let validationIssue;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const draft = await model.complete({
                  task: '按日常查证的合理标准独立复核原始claim，只依据publications全部passages，不评价玩家输赢。先问公布材料是否已有足以让合理读者否定原话的具体事实或反例，不要求学术式完备证明。按通常语义保留主体、范围和量词；“最、所有、从不、一定”等绝对断言有一个可信适用反例即可反驳，不需排查全部对象或全部场景；存在性主张不能凭一个失败例子否定。将反例代回原句核对比较方向：反驳最高或最多必须有更高或更多的对照，较低或较少与原句相容；最低或最少反向检验，绝不能将支持关系当作反例。原文已给出可比关系或明确比较结论时，可信报道也可作为反例，不强制双方官方原件或所有背景凭证。数值比较需看主要单位、对象与适用条件是否可比，不虚构数据或换算依据；只有真实不一致且会改变结论的口径、条件或冲突才阻挡反驳，不因没写所有细节机械拒绝。evidencePlan与priorGaps是参考，不是必查清单；criteriaReview核对决定结论的核心项即可，旁支可省略或not_required。至少一项decisive refutes引用具体依据时可判refuted，confidence可为high或medium；不完整的资料不等于无效反例。已有依据支持原观点用supported；有实质条件差异或冲突用mixed；只有猜测或关键关联缺失用insufficient。不因微小保留意见改成mixed，不把未搜到当不存在。chain逐条说明材料作用，strong或limited的直接事实均可用；gap保留资料边界，unresolved记录尚可补充的事项并说明影响，不能因列表非空就否定已成立的反例。若缺口确实使反例无法成立，须将decisive设false、status用mixed或insufficient；若只是缺原件或未穷尽旁支，保留refuted并交代边界。publicationRefs选真实quoteId，可跨轮连接同一对象的材料，不能靠同名或相关性补造关联。primary-observation为原始观测，reproducible-analysis为可复算分析，original-document为原始文件，secondary-assertion为报道或转述；按具体内容判断可信度，不因来源类别一票否决，也不把空泛断言当事实。保留相反证据和来源上下文，同稿转载不算独立验证。只写简短公开依据，不输出私有思考或内部字段名称。',
                  data: { claim: session.claim, evidencePlan: session.evidencePlan, publications: evidence.publications, priorGaps, ...(validationIssue ? { validationIssue } : {}) }, schema: VERDICT_SHAPE,
                }, { signal, retryAttempts: 3 });
                if (signal.aborted) throw new SearchError('MODEL_TIMEOUT', '结案复核暂未完成，可以重试；调查记录仍保留。', 504);
                return normalizeVerdict(draft, session, publications, evidence.references);
              } catch (error) {
                validationIssue = repairHint(error);
                if (!validationIssue || attempt === 1) {
                  recordValidationFailure(error, 'verdict');
                  if (error instanceof SearchError) error.message = '结案复核暂未完成，调查记录已保留，可以重试。';
                  throw error;
                }
              }
            }
          })();
          session.verdicts.set(signature, audited);
          audited.catch(() => session.verdicts.delete(signature));
        }
        const finalVerdict = await audited;
        session.expires = now() + sessionTtlMs;
        return { requestId: input.requestId, sessionId: session.id, finalVerdict };
      // Each model call may take 60s. Leave a complete second call for one
      // validation repair, instead of starting it with only ~10s remaining.
      }, Math.min(timeoutMs, 130000));
    },
    plan(input) {
      if (!text(input?.claim, 160, 2)) throw new SearchError('INVALID_CLAIM', '用 2–160 个字写下想查的传闻。', 400);
      const claim = input.claim.trim();
      return once(input.requestId, JSON.stringify({ type: 'plan', claim }), async signal => {
        if (sessions.size >= maxSessions) throw new SearchError('SESSION_LIMIT', '当前调查较多，请稍后再开一局。', 429);
        let leads, plan, previousDraft, validationIssue, attemptsLeft = 2;
        // Transport retries and format repairs share two actual model calls.
        // A stalled first call must leave a full second attempt, not a few seconds.
        while (attemptsLeft > 0) {
          const retryAttempts = attemptsLeft--;
          try {
            previousDraft = await model.complete({
              task: '按通常语义明确scope与refutationTarget：后者是待检验目标，不是既定事实。只列影响原句真假的核心标准，默认1-2项，确有必要时可增至5项；可替代的查证路径不必同时证完。每项用短句说明反驳成立所需的counterEvidence，以及反驳失败所需的requiredEvidence。提供两条反证方向：direct核对核心反例或必要条件失败，indirect追查相关但证明力有限的个案、关联或转述；每条只引用一个已有标准，不必覆盖全部标准，也不转为提供让原观点成立的操作方案。标题、问题和理由中性简洁，不预告结论或标明强弱。question与searchQuery须包含主体及必要条件，独立可读；检索词建议40字符内，英文逐字母计数。scope、refutationTarget与各项说明均用短句，尚未检索，不假设实验结果、记录或权威结论已存在。若有validationIssue，按字段提示修正后提交完整计划。',
              data: { claim, ...(validationIssue ? { validationIssue, previousDraft } : {}) }, schema: { evidencePlan: PLAN_SHAPE, leads: LEAD_PAIR_SHAPE },
            }, { signal, retryAttempts, onRetry: () => { attemptsLeft--; } });
            if (signal.aborted) throw requestTimeout('plan');
            plan = evidencePlan(previousDraft.evidencePlan, claim); leads = leadsFrom(previousDraft.leads, 1, plan);
            if (leads.some(lead => !privateLeadDesign.has(lead))) throw invalid('leads.routeRole: one direct and one indirect required');
            break;
          } catch (error) {
            validationIssue = repairHint(error);
            if (!validationIssue || attemptsLeft === 0) {
              recordValidationFailure(error, 'plan');
              throw error?.code === 'MODEL_TIMEOUT' ? requestTimeout('plan') : error;
            }
          }
        }
        const id = randomUUID();
        sessions.set(id, { id, claim, leads, evidencePlan: plan, verdicts: new Map(), rounds: [], refreshedLeads: new Map(), progress: new Map(), jobs: new Map(), closed: false, expires: now() + sessionTtlMs, pending: null });
        return { sessionId: id, claim, leads };
      }, Math.min(timeoutMs, 95000));
    },
    refresh(input) {
      if (!input || !text(input.sessionId, 80) || !RESEARCH_ROUNDS.some(round => round.id === input.roundId)
        || !Array.isArray(input.leadIds) || input.leadIds.length !== 2 || new Set(input.leadIds).size !== 2 || !input.leadIds.every(id => text(id, 40))) {
        throw new SearchError('INVALID_REQUEST', '刷新请求无效，请重新打开搜证。', 400);
      }
      const index = RESEARCH_ROUNDS.findIndex(round => round.id === input.roundId), promotedId = index > 0 ? input.promotedId : null;
      return once(input.requestId, JSON.stringify({ type: 'refresh', sessionId: input.sessionId, roundId: input.roundId, promotedId, leadIds: input.leadIds }), async signal => {
        const session = sessions.get(input.sessionId);
        if (!session || session.expires < now()) throw new SearchError('SESSION_EXPIRED', '这局调查记录已过期，请重新开始；金币会退回。', 410);
        if (session.closed) throw stopped();
        if (session.rounds[index]) throw new SearchError('ROUND_CONFLICT', '这一轮已经完成，请查看已有证据。', 409);
        if (session.rounds.length !== index || (index > 0 && !session.rounds[index - 1].result.materials.some(item => item.id === promotedId))) throw new SearchError('MISSING_PARENT', '先主推上一轮材料，再沿线继续查。', 400);
        if (!leadGroups(session, index, promotedId).some(group => group.every(lead => input.leadIds.includes(lead.id)))) throw new SearchError('INVALID_LEAD', '当前调查方向已失效，请重新打开搜证。', 400);
        if (session.pending) throw new SearchError('INVESTIGATION_BUSY', '这局正在整理调查资料，请稍候。', 409);
        const perform = async () => {
          const issuedLeads = [session.leads, ...session.rounds.map(round => round.result.nextLeads), ...[...session.refreshedLeads.values()].flatMap(groups => groups.map(group => group.leads))].flat();
          const history = investigationHistory(session, promotedId);
          let previousDraft, validationIssue;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              previousDraft = await model.complete({
                task: FALSIFICATION_TASK + PATH_DESIGN + '沿同一refutationTarget把本轮两个方向换成实质不同的新问题，不执行搜索或增加轮次。history中promoted的材料是玩家沿用的线索，不是新的调查目标；若它支持原观点，应追查成立条件、反例或失败边界，不能转为完善正向方案。避开issuedLeads及已查方向，不靠换词或调顺序刷新。新问题绑定原evidencePlan的标准，可查独立记录或适用范围，不硬造研究和悬念。严格返回两条；若有validationIssue修复对应问题。',
                data: { claim: session.claim, evidencePlan: session.evidencePlan, round: index + 1,
                  history, issuedLeads: issuedLeads.map(({ title, question }) => ({ title, question })),
                  ...(validationIssue ? { validationIssue, previousDraft } : {}) },
                schema: { leads: LEAD_PAIR_SHAPE },
              }, { signal, retryAttempts: 3 });
              if (signal.aborted) throw new SearchError('MODEL_TIMEOUT', '刷新问题花的时间有点久，请重试；金币会退回。', 504);
              const leads = leadsFrom(previousDraft?.leads, index + 1, session.evidencePlan);
              if (leads.some(lead => !privateLeadDesign.has(lead))) throw invalid('leads.routeRole: one direct and one indirect required');
              if (sameDirection(leads[0].question, leads[1].question)
                || leads.some(lead => issuedLeads.some(issued => sameDirection(lead.question, issued.question) || sameDirection(lead.title, issued.title))
                  || history.some(round => sameDirection(lead.question, round.question)))) throw invalid('leads: choose genuinely new directions; do not repeat or cosmetically rewrite any issued title or question');
              if (session.expires < now()) throw new SearchError('SESSION_EXPIRED', '这局调查记录已过期，请重新开始；金币会退回。', 410);
              const groupId = randomUUID().replaceAll('-', '').slice(0, 16);
              leads.forEach((lead, i) => { lead.id = `r${index + 1}-${groupId}-${i + 1}`; });
              if (session.closed) throw stopped();
              discardJobs(session);
              const groups = session.refreshedLeads.get(index) || [];
              groups.push({ promotedId, leads }); session.refreshedLeads.set(index, groups);
              session.expires = now() + sessionTtlMs;
              return { sessionId: session.id, claim: session.claim, roundId: input.roundId, leads };
            } catch (error) {
              validationIssue = repairHint(error);
              if (!validationIssue || attempt === 1) {
                recordValidationFailure(error, `refresh-${input.roundId}`);
                if (validationErrors.has(error)) error.message = '还没想好新的调查方向，原问题已保留；金币会退回。';
                throw error;
              }
            }
          }
        };
        const promise = perform().finally(() => { session.pending = null; });
        session.pending = { signature: JSON.stringify({ type: 'refresh', requestId: input.requestId }), promise };
        return promise;
      }, Math.min(timeoutMs, 70000));
    },
    cancel(input) {
      if (!text(input?.sessionId, 80) || !requestIdValid(input?.requestId)) throw new SearchError('INVALID_REQUEST', '调查请求无效。', 400);
      const session = sessions.get(input.sessionId);
      if (session) { session.closed = true; discardJobs(session); }
      for (const request of requests.values()) if (request.sessionId === input.sessionId && request.type === 'refresh') request.controller.abort(stopped());
      return { sessionId: input.sessionId, cancelled: true };
    },
    close() {
      for (const session of sessions.values()) { session.closed = true; discardJobs(session); }
      for (const request of requests.values()) request.controller.abort(stopped());
    },
    progress(input) {
      if (!text(input?.sessionId, 80) || !requestIdValid(input?.requestId)) throw new SearchError('INVALID_REQUEST', '调查进度请求无效。', 400);
      expire();
      const session = sessions.get(input.sessionId);
      if (!session || session.expires < now()) throw new SearchError('SESSION_EXPIRED', '这局调查记录已过期，请重新开始。', 410);
      const record = session.progress.get(input.requestId);
      if (!record) throw new SearchError('PROGRESS_NOT_FOUND', '暂未找到这次调查的进度。', 404);
      return clone({ requestId: input.requestId, roundId: record.roundId, status: record.status, events: record.events });
    },
    research(input) {
      if (!input || !text(input.sessionId, 80) || !RESEARCH_ROUNDS.some(round => round.id === input.roundId) || !text(input.leadId, 40)) throw new SearchError('INVALID_REQUEST', '调查方向无效，请重新打开搜证。', 400);
      const index = RESEARCH_ROUNDS.findIndex(round => round.id === input.roundId);
      const context = gameContext(input.gameContext), promotedId = index > 0 ? input.promotedId : null;
      return once(input.requestId, JSON.stringify({ type: 'research', sessionId: input.sessionId, roundId: input.roundId, leadId: input.leadId, promotedId, context }), async signal => {
        const session = sessions.get(input.sessionId);
        if (!session || session.expires < now()) throw new SearchError('SESSION_EXPIRED', '这局调查记录已过期，请重新开始；金币会退回。', 410);
        const completed = session.rounds[index];
        if (completed) {
          if (completed.leadId !== input.leadId || completed.promotedId !== promotedId) throw new SearchError('ROUND_CONFLICT', '这一轮已经完成，请查看已有证据。', 409);
          session.progress.set(input.requestId, completed.progress);
          return completed.result;
        }
        if (session.rounds.length !== index || (index > 0 && !session.rounds[index - 1]?.result.materials.some(item => item.id === promotedId))) throw new SearchError('MISSING_PARENT', '先主推上一轮材料，再沿线继续查。', 400);
        const leads = leadGroups(session, index, promotedId).flat();
        const lead = leads.find(item => item.id === input.leadId);
        if (!lead) throw new SearchError('INVALID_LEAD', '请选择本轮给出的调查方向。', 400);
        if (session.closed) throw stopped();
        const signature = JSON.stringify({ roundId: input.roundId, leadId: input.leadId, promotedId });
        if (session.pending) {
          if (session.pending.signature !== signature) throw new SearchError('INVESTIGATION_BUSY', '这局正在查另一条线索，请等它返回。', 409);
          session.progress.set(input.requestId, session.pending.progress);
          return session.pending.promise;
        }
        const job = startJob(session, index, lead, promotedId);
        discardJobs(session, job);
        session.progress.set(input.requestId, job.progress);
        const perform = async () => {
          const prepared = await withSignal(job.promise, signal);
          checkJob(job);
          if (signal.aborted) throw timedOut();
          if (session.rounds.length !== index) throw new SearchError('ROUND_CONFLICT', '这一轮已经完成，请查看已有证据。', 409);
          const { sources, searches } = job.checkpoint;
          // Only a complete, validated report can commit the chosen round.
          // A retry cannot award evidence twice.
          const result = normalizeAnalysis(prepared.raw, { session, roundId: input.roundId, lead, sources,
            availableSources: prepared.availableSources, searches, context, promotedId, fetchedAt: prepared.fetchedAt });
          session.rounds.push({ leadId: lead.id, promotedId, result, progress: job.progress });
          session.expires = now() + sessionTtlMs;
          session.jobs.delete(signature);
          return result;
        };
        const promise = perform().finally(() => { session.pending = null; });
        session.pending = { signature, promise, progress: job.progress };
        return promise;
      });
    },
  };
}
