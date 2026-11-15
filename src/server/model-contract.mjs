import { SearchError } from './search.mjs';

const statuses = ['supported', 'refuted', 'mixed', 'insufficient'];
const relevance = ['direct', 'indirect', 'irrelevant'];
const strength = ['strong', 'limited', 'weak'];
const relations = ['contradicts', 'limits', 'supports', 'context', 'unclear'];
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;
const description = (value, fallback) => typeof value === 'string' ? value : fallback;
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = (hint, maxLength, minLength = 1) => ({ type: 'string', description: hint, minLength, maxLength, pattern: '^[^\\u0000-\\u001f\\u007f-\\u009f]*$' });
const choice = (values, hint) => ({ type: 'string', enum: values, description: hint });
const array = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const ids = items => [...new Set(items)];
const formatIssues = new WeakMap();
const formatError = issues => {
  const error = new SearchError('MODEL_FORMAT', '调查员提交的报告格式不完整，请重试。');
  if (issues?.length) formatIssues.set(error, issues.slice(0, 16).join('; '));
  return error;
};

// Only constraints generated here may enter diagnostics or repair prompts.
// Never echo provider values or unknown object keys through an error property.
export const modelFormatIssue = error => formatIssues.get(error);

// Validate the same small schema subset sent to the provider. Rebuild each
// object from allowed properties, never merge untrusted tool arguments.
function read(schema, value, definitions = {}, path = 'arguments', issues = []) {
  if (schema.$ref) return read(definitions[schema.$ref.slice('#/$defs/'.length)], value, definitions, path, issues);
  const fail = rule => { issues.push(`${path}: ${rule}`); };
  if (schema.anyOf) {
    let closest;
    for (const branch of schema.anyOf) {
      const branchIssues = [], result = read(branch, value, definitions, path, branchIssues);
      if (!branchIssues.length) return result;
      // Keep field errors from the submitted action, not the other union arm.
      if (branch.properties?.action?.enum.includes(value?.action)) { issues.push(...branchIssues); return; }
      if (!closest || branchIssues.length < closest.length) closest = branchIssues;
    }
    issues.push(...closest);
    return;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('expected one object, not an array or string'); return; }
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) fail('remove unexpected fields; use only the declared properties');
    return Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => {
      const fieldPath = `${path}.${key}`;
      if (key === 'searchQuery' && schema.properties.question) {
        // This is an optional query suggestion in the application contract.
        // A complete, validated question is the existing safe fallback.
        const queryIssues = [], query = read(field, value[key], definitions, fieldPath, queryIssues);
        if (!queryIssues.length) return [key, query];
        return [key, read(schema.properties.question, value.question, definitions, `${path}.question`, issues)];
      }
      if (!Object.hasOwn(value, key)) { issues.push(`${fieldPath}: required field is missing`); return [key, undefined]; }
      return [key, read(field, value[key], definitions, fieldPath, issues)];
    }));
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) { fail('expected an array'); return; }
    if (value.length < schema.minItems || value.length > schema.maxItems) { fail(`expected ${schema.minItems}-${schema.maxItems} items; received ${value.length}`); return; }
    return value.map((item, index) => read(schema.items, item, definitions, `${path}[${index}]`, issues));
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') { fail('expected a boolean'); return; }
    return value;
  }
  if (schema.type !== 'string' || typeof value !== 'string') { fail('expected a string'); return; }
  if (schema.enum) {
    if (!schema.enum.includes(value)) fail(`choose one of ${schema.enum.join(', ')}`);
  } else {
    const length = [...value.trim()].length;
    if (length < schema.minLength || length > schema.maxLength) fail(`expected ${schema.minLength}-${schema.maxLength} characters; received ${length}; count each English letter and space`);
    if (controlCharacters.test(value)) fail('use one line without control characters');
  }
  return value;
}

// A source review or lead has the same fields in every fixed slot. Define it
// once so ten sources do not repeat the schema and its instructions ten times.
function sharedDefinitions(root) {
  const counts = new Map();
  const children = schema => [...Object.values(schema.properties || {}), ...(schema.items ? [schema.items] : []), ...(schema.anyOf || [])];
  const count = schema => {
    if (schema.type === 'object') counts.set(schema, (counts.get(schema) || 0) + 1);
    children(schema).forEach(count);
  };
  count(root);
  const names = new Map([...counts].filter(([, count]) => count > 1).map(([schema], index) => [schema, `fields${index + 1}`]));
  const copy = (schema, defining = false) => {
    if (!defining && names.has(schema)) return { $ref: `#/$defs/${names.get(schema)}` };
    return { ...schema,
      ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => [key, copy(field)])) } : {}),
      ...(schema.items ? { items: copy(schema.items) } : {}),
      ...(schema.anyOf ? { anyOf: schema.anyOf.map(branch => copy(branch)) } : {}),
    };
  };
  return { ...copy(root), ...(names.size ? { $defs: Object.fromEntries([...names].map(([schema, name]) => [name, copy(schema, true)])) } : {}) };
}

// Planning has variable criteria but exactly two direction objects. Show its
// empty structure as well as the schema so models do not group leads by criterion.
function planningTemplate(schema, definitions) {
  if (schema.$ref) return planningTemplate(definitions[schema.$ref.slice('#/$defs/'.length)], definitions);
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, field]) => [key, planningTemplate(field, definitions)]));
  if (schema.type === 'array') return Array.from({ length: schema.minItems }, () => planningTemplate(schema.items, definitions));
  return '';
}

function leadPair(shape, criterionIds) {
  const hint = shape?.[0] || {};
  const lead = object({
    title: string(description(hint.title, '中性的调查动作'), 50),
    question: string(description(hint.question, '本次要核对的反例或限制条件'), 64, 2),
    reason: string(description(hint.reason, '这条线索能查清什么'), 180),
    searchQuery: string(description(hint.searchQuery, '独立可读的检索词，保留主体与必要条件'), 64, 2),
    criterionId: choice(criterionIds, description(hint.criterionId, '对应证据标准编号')),
  });
  return { ...object({ direct: lead, indirect: lead }),
    description: '恰好两条方向。direct 和 indirect 各填一个完整调查卡对象，不是数组，不是逐项标准的列表；每张卡仅含 title、question、reason、searchQuery、criterionId。',
  };
}

const assembleLeads = value => ['direct', 'indirect'].map(routeRole => ({ ...value[routeRole], routeRole }));

function planContract(schema, data) {
  const hint = schema.evidencePlan;
  const criterion = hint.criteria?.[0] || {};
  const parameters = object({
    evidencePlan: object({
      refutationTarget: string(description(hint.refutationTarget, '能够推翻原观点的待查反例，不预设结论'), 300),
      scope: string(description(hint.scope, '原观点的主体、范围与量词'), 300),
      criteria: array(object({
        question: string(description(criterion.question, '影响原观点真假的核心问题'), 240),
        requiredEvidence: string(description(criterion.requiredEvidence, '什么证据会使反驳失败'), 400),
        counterEvidence: string(description(criterion.counterEvidence, '什么证据可以构成反例'), 400),
      }), 5, 1),
    }),
    leads: leadPair(schema.leads, ['c1', 'c2', 'c3', 'c4', 'c5']),
  });
  return { phase: 'plan', parameters, assemble: args => ({ evidencePlan: { proposition: data.claim, ...args.evidencePlan }, leads: assembleLeads(args.leads) }) };
}

function directionContract(schema, data, field) {
  const empty = schema[field].length === 0;
  const parameters = object(empty ? {} : { [field]: leadPair(schema[field], data.evidencePlan.criteria.map(item => item.id)) });
  return { phase: field === 'nextLeads' ? 'repair_leads' : 'refresh', parameters,
    assemble: args => ({ [field]: empty ? [] : assembleLeads(args[field]) }) };
}

function researchContract(schema, data) {
  const freshIds = ids(data.sources.flatMap(source => source.passages.filter(passage => !passage.previouslyUsed).map(passage => passage.id)));
  const canSearch = data.canSearch === true;
  if (!freshIds.length && !canSearch) throw new SearchError('NO_NEW_EVIDENCE', '这轮还没整理出可用的新证据，换一条线再查；金币会退回。', 422);
  const search = object({ action: choice(['search'], '补查当前材料仍缺少的具体问题'), followupQuery: string('新的检索词，保留主体、必要范围与待查条件', 64, 2) });
  const branches = [];
  if (freshIds.length) {
    const rankingHint = schema.sourceRanking?.[0] || [];
    const rank = object({
      relevance: choice(relevance, description(rankingHint[1], '相对于本轮证据标准与问题的关联度')),
      strength: choice(strength, description(rankingHint[2], '证据的证明力')),
      relation: choice(relations, description(rankingHint[3], '相对于原始观点的关系')),
      reason: string(description(rankingHint[4], '依据引文说明关系、原始性或局限，建议20字内'), 300),
    });
    branches.push(object({
      action: choice(['final'], '提交本轮证据报告'),
      sourceRanking: object(Object.fromEntries(data.sources.map(source => [source.id, rank]))),
      evidence: object({
        headline: string(description(schema.evidence.headline, '本条证据的标题'), 120),
        explanation: string(description(schema.evidence.explanation, '原文对反驳的作用与边界'), 500),
        quoteId: choice(freshIds, description(schema.evidence.quoteId, '最高可用等级中的一段未使用原文编号')),
      }),
      finding: string(description(schema.finding, '本轮发现'), 400),
      assessment: object({
        status: choice(statuses, description(schema.assessment?.status, '材料对原始观点的判断')),
        summary: string(description(schema.assessment?.summary, '结合本轮与历史证据说明判断'), 400),
      }),
      chainAssessment: object({ unresolved: array(string(description(schema.chainAssessment?.unresolved?.[0], '仍影响结论的关键缺口'), 300), 6) }),
      ...(schema.nextLeads.length ? { nextLeads: leadPair(schema.nextLeads, data.evidencePlan.criteria.map(item => item.id)) } : {}),
    }));
  }
  if (canSearch) branches.push(search);
  const parameters = object({ result: branches.length === 1 ? branches[0] : { anyOf: branches } });
  return { phase: 'research', parameters, assemble: ({ result }) => {
    if (result.action === 'search') return { action: 'search', followupQuery: result.followupQuery };
    return { ...result, action: 'final',
      sourceRanking: data.sources.map(source => ({ sourceId: source.id, ...result.sourceRanking[source.id] })),
      nextLeads: schema.nextLeads.length ? assembleLeads(result.nextLeads) : [],
    };
  } };
}

function verdictContract(schema, data) {
  const chainHint = schema.chain?.[0] || {}, reviewHint = schema.criteriaReview?.[0] || {}, refHint = reviewHint.publicationRefs?.[0] || {};
  const passageIds = ids(data.publications.flatMap(publication => publication.sources.flatMap(source => source.passages.map(passage => passage.id))));
  const criterionIds = data.evidencePlan.criteria.map(item => item.id);
  const chain = object({
    finding: string(description(chainHint.finding, '这轮材料实际证明什么'), 1600),
    strength: choice(strength, description(chainHint.strength, '证据的证明力')),
    relevance: choice(relevance, description(chainHint.relevance, '材料是否回答关键问题')),
    gap: string(description(chainHint.gap, '材料边界；没有则留空'), 600, 0),
  });
  const review = object({
    criterionId: choice(criterionIds, description(reviewHint.criterionId, '选取真正影响结论的证据标准')),
    outcome: choice(['supports', 'refutes', 'mixed', 'unresolved', 'not_required'], description(reviewHint.outcome, '证据对这项标准的判断')),
    decisive: { type: 'boolean', description: description(reviewHint.decisive, '是否已有合理充分依据回答原命题') },
    publicationRefs: array(passageIds.length ? object({
      quoteId: choice(passageIds, description(refHint.quoteId, '已公布材料的原文编号')),
      basis: choice(['primary-observation', 'reproducible-analysis', 'original-document', 'secondary-assertion'], description(refHint.basis, '引用材料的依据类型')),
    }) : object({}), passageIds.length ? 5 : 0),
    explanation: string(description(reviewHint.explanation, '这些证据如何影响原始观点的判断'), 1000),
  });
  const parameters = object({
    status: choice(statuses, description(schema.status, '相对于原始观点的结论')),
    confidence: choice(['high', 'medium', 'low'], description(schema.confidence, '结论的依据是否充分')),
    summary: string(description(schema.summary, '结案判断摘要'), 1600),
    rationale: string(description(schema.rationale, '最关键事实或反例及边界'), 4000),
    unresolved: array(string(description(schema.unresolved?.[0], '仍可补充的资料，并说明是否影响结论'), 600), 10),
    chain: object(Object.fromEntries(data.publications.map(publication => [publication.roundId, chain]))),
    criteriaReview: array(review, 5),
  });
  return { phase: 'verdict', parameters, assemble: args => ({ ...args,
    chain: data.publications.map(publication => ({ roundId: publication.roundId, ...args.chain[publication.roundId] })),
  }) };
}

/** The program owns slots and identifiers; the model supplies their judgments. */
export function createModelContract({ schema, data }) {
  let contract;
  if (schema.evidencePlan) contract = planContract(schema, data);
  else if (data.publications) contract = verdictContract(schema, data);
  else if (Object.keys(schema).length === 1 && Array.isArray(schema.nextLeads)) contract = directionContract(schema, data, 'nextLeads');
  else if (schema.leads) contract = directionContract(schema, data, 'leads');
  else if (schema.evidence) contract = researchContract(schema, data);
  else throw formatError();
  const parameters = sharedDefinitions(contract.parameters);
  return { name: 'submit_investigation', description: '填写本次调查报告的固定字段，提交有材料依据的判断。', parameters, phase: contract.phase,
    ...(['plan', 'refresh', 'repair_leads'].includes(contract.phase) ? { template: planningTemplate(parameters, parameters.$defs) } : {}),
    assemble: args => {
      const issues = [], value = read(parameters, args, parameters.$defs, 'arguments', issues);
      if (issues.length) throw formatError(issues);
      return contract.assemble(value);
    } };
}
