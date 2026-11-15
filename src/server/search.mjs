import sdk from 'tencentcloud-sdk-nodejs-common';
import { RESEARCH_ROUNDS } from '../dist/research-content.js';
import { withRetries, temporaryNetworkError, transientStatus, retryAfterMs } from './retry.mjs';

export class SearchError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

const clean = (value, length = 800) => typeof value === 'string' ? [...value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, length).join('') : '';
const caseTopic = /长城|長城|great\s*wall/i;
const queryTopic = /长城|長城|月球|月亮|肉眼|太空|空间站|空間站|照片|拍摄|拍攝|宇航|航天|相机|相機|镜头|鏡頭|NASA|ESA|great\s*wall|moon|space/i;
const insightKinds = new Set(['moon', 'location', 'lens', 'observation', 'context']);

export function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    url.hash = ''; return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

// These images belong to this exact returned page. Favicons and model output
// are never treated as article illustrations; absent images stay optional.
function sourceImage(page) {
  for (const picture of (Array.isArray(page?.pics) ? page.pics : []).slice(0, 10)) {
    const imageUrl = safeSourceUrl(picture?.origin_url);
    if (imageUrl) return { imageUrl, imageCaption: clean(picture.caption, 180) };
  }
  return {};
}

export function validateResearchInput(body) {
  if (!body || typeof body !== 'object' || !RESEARCH_ROUNDS.some(round => round.id === body.roundId)) throw new SearchError('INVALID_REQUEST', '调查轮次不正确，请重新打开寻找证据。', 400);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if ([...query].length < 2 || [...query].length > 64 || /[\u0000-\u001f\u007f]/.test(query)) throw new SearchError('INVALID_QUERY', '请用 2–64 个字描述想查的问题。', 400);
  if (!queryTopic.test(query)) throw new SearchError('OFF_TOPIC', '这一局在查“月球肉眼看长城”，请围绕照片、观测条件或原始出处提问。', 400);
  if (typeof body.requestId !== 'string' || !/^[\w-]{16,80}$/.test(body.requestId)) throw new SearchError('INVALID_REQUEST', '调查请求无效，请重新发起。', 400);
  let previous = null;
  if (body.roundId !== 'round-1') {
    const url = safeSourceUrl(body.previous?.url);
    if (!url || !clean(body.previous?.title, 120)) throw new SearchError('MISSING_CLUE', '先主推上一轮材料，再顺着它继续查。', 400);
    previous = { title: clean(body.previous.title, 120), url, query: clean(body.previous.query, 64) };
    if (body.previous.finding) previous.finding = clean(body.previous.finding, 400);
    if (body.previous.sourceTitle) previous.sourceTitle = clean(body.previous.sourceTitle, 180);
    if (insightKinds.has(body.previous.kind)) previous.kind = body.previous.kind;
  }
  return { query, roundId: body.roundId, requestId: body.requestId, previous };
}

export function buildSearchQuery(input) {
  // Preserve the player's entire question. Context only uses the remaining
  // documented 64-character budget; no silent truncation of player input.
  const parts = [input.query];
  if (!caseTopic.test(input.query)) parts.push('长城');
  if (!/NASA|ESA|央视|人民网|央广|新华社|中科院/i.test(input.query) && input.roundId === 'round-1') parts.push('NASA 原始资料');
  if (input.previous) {
    const titleWords = `${input.previous.sourceTitle || input.previous.title} ${input.previous.finding || ''}`.match(/NASA|ESA|宇航员|航天员|相机|镜头|照片|空间站/gi) || [];
    const words = [...new Set(titleWords)].filter(word => !input.query.toLowerCase().includes(word.toLowerCase())).slice(0, 2);
    parts.push(...words);
  }
  let output = parts.shift();
  for (const part of parts) if ([...`${output} ${part}`].length <= 64) output += ` ${part}`;
  return output;
}

export function sourceKey(url) {
  // A gateway, tracking link or old ESA image path is not another source.
  const unwrapped = url.replace(/^https?:\/\/big5\.(?:cntv\.cn|cctv\.com)\/gate\/big5\//, 'https://');
  const normalized = new URL(safeSourceUrl(unwrapped) || url);
  normalized.protocol = 'https:';
  normalized.hostname = normalized.hostname.replace(/^www\./, '').replace(/^cctv\.cn$/, 'cctv.com');
  normalized.pathname = normalized.pathname.replace('/spaceinimages/Images/', '/ESA_Multimedia/Images/').replace(/\/$/, '');
  for (const key of [...normalized.searchParams.keys()]) if (/^utm_|^(?:from|spm|ref)$/i.test(key)) normalized.searchParams.delete(key);
  return normalized.href;
}

function institutionPriority(source) {
  const host = new URL(source.url).hostname;
  return /(^|\.)(nasa\.gov|esa\.int|cas\.cn|cast\.org\.cn|cmse\.gov\.cn)$/.test(host) ? 3
    : /(^|\.)(cctv\.com|cctv\.cn|people\.com\.cn|xinhuanet\.com|news\.cn|cnr\.cn)$/.test(host) ? 2 : 1;
}

function queryKind(query) {
  if (/镜头|鏡頭|焦距|相机|相機|lens|camera|\bmm\b/i.test(query)) return 'lens';
  if (/哪里|哪裡|位置|高度|空间站|空間站|拍摄|拍攝|照片|photo|station|\bISS\b/i.test(query)) return 'location';
  if (/月球|月亮|moon/i.test(query)) return 'moon';
  if (/肉眼|naked|观测|觀測/i.test(query)) return 'observation';
  return 'context';
}

export function buildFocusedSearch(input) {
  const kind = queryKind(input.query);
  // A follow-up compares observation conditions using a different record. It
  // never claims ESA's photograph is NASA's photograph or invents its lens.
  const fromNasa = input.previous && /(^|\.)nasa\.gov$/.test(new URL(input.previous.url).hostname);
  const fromEsa = input.previous && /(^|\.)esa\.int$/.test(new URL(input.previous.url).hostname);
  const observation = /\bESA\b/i.test(input.query) || (input.roundId !== 'round-1' && !fromEsa
    && (['lens', 'location', 'observation'].includes(kind) || fromNasa || input.previous?.kind === 'moon'));
  return observation ? { Query: 'Great Wall of China from space', Site: 'esa.int' }
    : { Query: 'Great Wall China Moon naked eye', Site: 'nasa.gov' };
}

const boilerplate = /\bviews\b.*\blikes\b|Download|COOKIES|HI-RES|ID Like|Thank you for liking|already liked|CREDIT|LICENCE/i;
const relevantObservation = /肉眼|naked|unaided|月球|moon|照片|拍摄|拍攝|photo|lens|镜头|鏡頭|相机|相機|观测|觀測|看[到见見]|可见|可見|visible|\bsee\b/i;
const disputedStatement = /(?:claim|statement|assertion)\b[^.!?。]{0,100}\b(?:wrong|false|incorrect|not true)\b|(?:wrong|false|incorrect)\s+(?:claim|statement|assertion)|\b(?:no|insufficient)\s+(?:credible\s+)?evidence\b|\b(?:unverified|unconfirmed|unsupported)\b|(?:说法|說法|結論|结论)[^。！？!?]{0,50}(?:不成立|不正确|不正確|错误|錯誤)|(?:缺乏|尚无|尚無|没有|沒有)[^。！？!?]{0,15}(?:证据|證據)/i;

function excerpts(text, title) {
  const offset = text.startsWith(title) ? title.length : 0;
  const body = text.slice(offset);
  // Slice the original text, rather than joining sentences, so every quote can
  // be traced to an exact contiguous span. A decimal point is not a boundary.
  const parts = [...body.matchAll(/.+?(?:[。！？!?](?:["”’']*)|\.(?=\s|$)|$)/gu)]
    .map(match => ({ start: offset + match.index, end: offset + match.index + match[0].length, text: match[0].trim() }));
  const windows = [];
  for (let index = 0; index < parts.length; index++) {
    if (parts[index].text.length < 8 || boilerplate.test(parts[index].text)) continue;
    for (let size = 1; size <= 4 && index + size <= parts.length; size++) {
      const segment = parts.slice(index, index + size);
      if (segment.some(part => boilerplate.test(part.text))) break;
      const quote = text.slice(segment[0].start, segment.at(-1).end).trim();
      if (quote.length <= 800 && caseTopic.test(quote) && relevantObservation.test(quote)) windows.push(quote);
    }
  }
  // Ordinary short source records may name the case without a specific finding.
  if (!windows.length && body.length <= 500 && caseTopic.test(body) && !boilerplate.test(body)
    && /资料|摘要|观测|觀測|照片|photo|observation/i.test(body)) windows.push(body.trim());
  return [...new Set(windows)];
}

function excerptWeight(text, kind) {
  return 4 * Number(caseTopic.test(text)) + 3 * Number(/肉眼|naked|unaided/i.test(text))
    + 2 * Number(/月球|moon/i.test(text)) + 2 * Number(/photo|镜头|lens|拍摄|拍攝/i.test(text))
    + 2 * Number(/\d+(?:\.\d+)?\s*(?:mm|毫米)/i.test(text))
    + 4 * Number(kind === 'lens' && /\d+(?:\.\d+)?\s*(?:mm|毫米)|镜头|lens/i.test(text))
    + 3 * Number(kind === 'location' && /空间站|International Space Station|\bISS\b|拍摄|拍攝/i.test(text))
    - text.length / 500;
}

function statementAllowed(source, quote, match, kind) {
  const field = [source.summary, source.content || ''].find(text => text.includes(quote));
  if (!field) return false;
  const offset = field.indexOf(quote) + match.index;
  const before = field.slice(0, offset), tail = field.slice(offset + match[0].length);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('。'), before.lastIndexOf('?'), before.lastIndexOf('!')) + 1;
  const end = tail.search(/[。！？!?]|\.(?=\s|$)/u);
  const sentence = field.slice(start, offset + match[0].length + (end < 0 ? tail.length : end + 1));
  if (/[？?]["”']?$/.test(sentence.trim())) return false;
  // Consult neighboring text in the returned field, not just the chosen quote:
  // cropping “This statement is wrong” must not rescue a rejected assertion.
  const context = field.slice(Math.max(0, start - 100), offset + match[0].length + 180);
  if (disputedStatement.test(context)) return false;
  if (kind === 'lens' && /\bwithout\b|\b(?:not|never|no)\s+(?:\w+\s+){0,4}\d+(?:\.\d+)?\s*mm\b|\b(?:didn['’]t|wasn['’]t)\b/i.test(sentence)) return false;
  if (kind === 'location' && /\b(?:not|never|wasn['’]t|isn['’]t)\b/i.test(sentence)) return false;
  return true;
}

function factQuote(source, quote, match, kind) {
  const field = [source.summary, source.content || ''].find(text => text.includes(quote));
  const offset = field.indexOf(quote) + match.index;
  const before = field.slice(0, offset), tail = field.slice(offset + match[0].length);
  let start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('。'), before.lastIndexOf('?'), before.lastIndexOf('!')) + 1;
  const end = tail.search(/[。！？!?]|\.(?=\s|$)/u);
  // The lens sentence's immediate predecessor can be the naked-eye answer.
  // Keep that short qualifier, rather than the unrelated biography before it.
  if (kind === 'lens') {
    const prior = before.slice(0, start - 1), priorStart = Math.max(prior.lastIndexOf('.'), prior.lastIndexOf('。'), prior.lastIndexOf('?'), prior.lastIndexOf('!')) + 1;
    if (/Next to impossible with the naked eye/i.test(field.slice(priorStart, start))) start = priorStart;
  }
  return field.slice(start, offset + match[0].length + (end < 0 ? tail.length : end + 1)).trim().replace(/^["”’']\s*/, '');
}

function sourceInsight(source, kind) {
  const windows = [...excerpts(source.summary, source.title), ...excerpts(source.content || '', source.title)];
  if (!windows.length) return null;
  const ranked = windows.sort((a, b) => excerptWeight(b, kind) - excerptWeight(a, kind));
  const facts = [];
  for (const quote of ranked) {
    // These are bounded, case-specific readings of explicit statements, not a
    // generic truth classifier. Questions, hypothetical claims and recantations
    // must not be promoted into a conclusion.
    const uncertain = /\b(?:if|suppose|claim(?:s|ed)? that|incorrect|not true|false|not taken|not photographed|not use|never used|didn['’]t use)\b|假如|假设|假設|假说|假說|有人声称|有人聲稱|误以为|誤以為|并非|並非/i.test(quote);
    if (uncertain) continue;
    const lens = quote.match(/\b(?:tried|taken|photographed|shot|used)\b[^.!?。]{0,100}?\b(?:an?\s+)?(\d{2,4}(?:\.\d+)?)\s*mm\s+(?:tele(?:photo)?\s+)?lens\b/i);
    if (lens && /great\s*wall/i.test(quote) && statementAllowed(source, quote, lens, 'lens')) facts.push({ kind: 'lens', headline: `这份拍摄记录用了 ${lens[1]} mm 镜头`, explanation: `记录提到 ${lens[1]} mm 镜头。这提供了拍摄条件，不能把相机拍到当成肉眼看见。`, quote: factQuote(source, quote, lens, 'lens') });
    const moon = quote.match(/(?:the\s+)?wall\s+(?:isn['’]t|is not|cannot be)\s+visible\s+from\s+the\s+moon\b/i);
    if (moon && statementAllowed(source, quote, moon, 'moon')) facts.push({ kind: 'moon', headline: '资料明确否定“月球看见长城”', explanation: '这份资料写明，从月球看不见长城。', quote: factQuote(source, quote, moon, 'moon') });
    const location = quote.match(/(?:photographed|took this photo|picture was taken)[^.!?。]{0,160}International Space Station/i);
    if (/great\s*wall/i.test(quote) && location && statementAllowed(source, quote, location, 'location')) facts.push({ kind: 'location', headline: '照片拍自空间站', explanation: '这份照片记录写明拍摄地点是国际空间站，不能用来证明“从月球肉眼可见”。', quote: factQuote(source, quote, location, 'location') });
    const observation = quote.match(/Next to impossible with the naked eye/i);
    if (/great\s*wall/i.test(quote) && observation && statementAllowed(source, quote, observation, 'observation')) facts.push({ kind: 'observation', headline: '当事人说：肉眼几乎看不到', explanation: '这份观测记录描述了肉眼辨认的困难；照片与肉眼观测需要分开看。', quote: factQuote(source, quote, observation, 'observation') });
    // Preserve the scope of a particular Chinese astronaut's report. Do not
    // expand “this time I did not see it” into a law for all orbital conditions.
    const personal = quote.match(/(?:杨利伟|楊利偉)[^。！？!?]{0,150}(?:没有看到|沒有看到|没有看见|沒有看見|无法看到|無法看到)/);
    if (/长城|長城/.test(quote) && personal && statementAllowed(source, quote, personal, 'observation')) facts.push({ kind: 'observation', headline: '航天员说，这次没有看见', explanation: '资料记录了航天员没有看见长城的经历。这是一次观测，不能替代所有条件下的结论。', quote: factQuote(source, quote, personal, 'observation') });
  }
  const preferred = kind === 'lens' ? ['lens', 'location', 'observation', 'moon']
    : kind === 'location' ? ['location', 'lens', 'observation', 'moon']
    : kind === 'moon' ? ['moon', 'observation', 'location', 'lens'] : ['lens', 'moon', 'observation', 'location'];
  facts.sort((a, b) => preferred.indexOf(a.kind) - preferred.indexOf(b.kind) || excerptWeight(b.quote, kind) - excerptWeight(a.quote, kind));
  if (facts.length) return { ...facts[0], excerpt: ranked[0] };
  const fallback = ranked.find(quote => disputedStatement.test(quote)) || ranked[0];
  return { kind: 'context', headline: '找到一份长城观测资料', explanation: '摘要提供了相关说法，尚未提取出明确的观测条件。可以打开原文核对。', quote: fallback, excerpt: fallback };
}

function nextLead(insight, source) {
  if (insight.kind === 'lens') return { kind: 'moon', question: '相机能拍到长城，能证明从月球用肉眼看见吗？', reason: '镜头条件找到了，继续核对“月球”和“肉眼”的说法。' };
  if (['moon', 'location', 'observation'].includes(insight.kind)) return { kind: 'lens', question: '有哪些长城太空照片记录写明了镜头和肉眼观测条件？', reason: '沿着这条观测线索，找另一份写明条件的记录作对照。' };
  const name = /NASA|ESA/i.exec(`${source.title} ${source.organization}`)?.[0];
  return { kind: 'location', question: `${name ? `${name} ` : ''}长城观测资料的拍摄地点、镜头和肉眼条件是什么？`, reason: '摘要还不够具体，继续追查观测条件。' };
}

const titleKey = title => title.toLowerCase().replace(/[從長這關於謠過幾個]/g, char => ({ 從: '从', 長: '长', 這: '这', 關: '关', 於: '于', 謠: '谣', 過: '过', 幾: '几', 個: '个' })[char]).replace(/[^\p{L}\p{N}]/gu, '');
function sameArticle(a, b) {
  if (sourceKey(a.url) === sourceKey(b.url)) return true;
  const title = titleKey(a.title);
  if ((title.length >= 24 || (title.match(/\p{Script=Han}/gu)?.length || 0) >= 14) && title === titleKey(b.title)) return true;
  const compact = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const one = compact(a.finding), two = compact(b.finding);
  return Math.min(one.length, two.length) >= 80 && (one.includes(two) || two.includes(one));
}

export function normalizeSearchResponse(raw, input, fetchedAt = new Date().toISOString()) {
  const response = raw?.Response || raw;
  if (!response || !Array.isArray(response.Pages)) throw new SearchError('INVALID_RESPONSE', '搜索结果暂时无法读取，请稍后重试。');
  const kind = queryKind(input.query), candidates = [];
  for (const item of response.Pages.slice(0, 50)) {
    let page; try { page = typeof item === 'string' ? JSON.parse(item) : item; } catch { continue; }
    const url = safeSourceUrl(page?.url), title = clean(page?.title, 180);
    if (!url || !title || (input.previous && sourceKey(url) === sourceKey(input.previous.url))) continue;
    const source = { title, url, organization: clean(page.site, 60) || new URL(url).hostname,
      summary: clean(page.passage, 1600), content: clean(page.content, 3000), date: clean(page.date, 40), ...sourceImage(page) };
    // Both fields are dynamic excerpts. A longer field may omit this case;
    // inspect each independently and retain the original for the evidence file.
    if (!source.summary) source.summary = source.content.slice(0, 1600);
    const result = sourceInsight(source, kind);
    if (result) {
      const { excerpt, ...insight } = result;
      candidates.push({ ...source, insight, finding: excerpt });
    }
  }
  const quality = source => Number(source.insight.kind !== 'context') * 10 + Number(source.insight.kind === kind) * 3 + institutionPriority(source);
  candidates.sort((a, b) => quality(b) - quality(a));
  const sources = [];
  for (const candidate of candidates) if (!sources.some(source => sameArticle(source, candidate))) sources.push(candidate);
  if (sources.length < 2) throw new SearchError('INSUFFICIENT_SOURCES', '这次没有找到两份可追溯的相关材料。换个问法再查，金币会退回。', 422);
  // A search relevance score is not a truth score. Prefer useful, explicit
  // observations, then original institutions; never manufacture endorsement.
  const authority = sources[0];
  const spread = sources.find(source => source !== authority && source.insight.kind !== authority.insight.kind && source.insight.kind !== 'context')
    || sources.find(source => source !== authority && new URL(source.url).hostname !== new URL(authority.url).hostname)
    || sources.find(source => source !== authority);
  const definition = RESEARCH_ROUNDS.find(round => round.id === input.roundId);
  const materials = definition.materials.map(template => {
    const { insight, finding, ...source } = template.focus === 'spread' ? spread : authority;
    const lead = definition.round < RESEARCH_ROUNDS.length ? nextLead(insight, source) : null;
    return { id: template.id, focus: template.focus, eventId: template.eventId, title: source.title,
      finding, insight, lead, sources: [source], sourceIds: [], nextQuestion: lead?.question || null };
  });
  const strongest = authority.insight;
  const previousFinding = input.previous?.finding || '';
  const lens = strongest.kind === 'lens' ? strongest.headline.match(/([\d.]+) mm/)?.[1] : null;
  const newCondition = definition.round > 1 && strongest.kind !== 'context'
    && (strongest.kind !== input.previous?.kind || (lens && !previousFinding.includes(`${lens} mm`)));
  const investigation = { question: input.query, previousFinding,
    summary: strongest.kind === 'context' ? '找到相关资料，观测条件还需要核对。' : strongest.headline,
    delta: definition.round === 1 ? strongest.explanation
      : newCondition ? (lens ? `另一份记录写明使用 ${lens} mm 镜头，补充了拍摄条件。` : `另一份记录补充了线索：${strongest.headline}。`) : '这轮找到补充资料，但还不能据此宣称所有疑点都已查清。',
    openQuestion: definition.round < RESEARCH_ROUNDS.length ? nextLead(strongest, authority).question : '' };
  return { provider: '腾讯云元宝搜索', requestId: clean(response.RequestId, 100), version: clean(response.Version, 30), fetchedAt,
    query: input.query, searchQuery: response.SearchQueries?.join('；') || buildSearchQuery(input), parent: input.previous,
    finding: investigation.summary, investigation, materials };
}

function searchTransportError(error) {
  if (error instanceof SearchError) return error;
  const code = String(error?.code || ''), httpStatus = Number(error?.httpCode || error?.status);
  let result;
  if (/^(?:AuthFailure|UnauthorizedOperation)(?:\.|$)/.test(code) || [401, 403].includes(httpStatus)) {
    result = new SearchError('SEARCH_AUTH', '元宝搜索暂时无法通过鉴权，请联系开发者检查密钥权限。', 503);
  } else if (/^(?:InvalidParameter|MissingParameter|UnsupportedOperation|InvalidAction)(?:\.|$)/.test(code) || httpStatus === 400) {
    result = new SearchError('INVALID_QUERY', '调查问题无法提交，请换一条线索。', 400);
  } else if (httpStatus === 429 || /^(?:RequestLimitExceeded|LimitExceeded\.(?:RequestLimitExceeded|QpsLimitExceeded|FrequencyLimitExceeded))(?:\.|$)/i.test(code)) {
    result = new SearchError('SEARCH_LIMIT', '搜索请求有点多，请稍后再试。', 429);
    result.retryable = true;
  } else {
    result = new SearchError('SEARCH_UNAVAILABLE', '元宝搜索暂时不可用，请稍后重试；金币会退回。', 502);
    // Account balance, service activation and unknown SDK failures are not
    // repaired by retrying. Only explicit transient failures qualify.
    result.retryable = transientStatus(httpStatus) || /^(?:InternalError|ServiceUnavailable|FailedOperation.SystemError|ResourceUnavailable.ServiceUnavailable)(?:\.|$)/.test(code) || temporaryNetworkError(error);
  }
  if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) result.httpStatus = httpStatus;
  return result;
}

// The SDK discards Retry-After and leaves non-200 bodies unread. Intercept
// only that path; request signing and successful parsing remain in the SDK.
class YuanbaoClient extends sdk.CommonClient {
  async parseResponse(response) {
    if (response.status === 200) return super.parseResponse(response);
    const error = searchTransportError({ httpCode: response.status });
    error.retryAfterMs = retryAfterMs(response.headers.get('retry-after'));
    try {
      if (typeof response.body?.destroy === 'function') response.body.destroy();
      else await response.body?.cancel();
    } catch { /* The response may already be closed by cancellation. */ }
    throw error;
  }
}

export function createYuanbaoSearch(env = process.env, { clientImpl, timeoutMs = 20000, sleep, random, diagnostic = entry => console.info('[元宝搜索]', JSON.stringify(entry)) } = {}) {
  const configured = Boolean(env.TENCENTCLOUD_SECRET_ID && env.TENCENTCLOUD_SECRET_KEY);
  const client = clientImpl || (configured ? new YuanbaoClient('wsa.tencentcloudapi.com', '2025-05-08', {
    credential: { secretId: env.TENCENTCLOUD_SECRET_ID, secretKey: env.TENCENTCLOUD_SECRET_KEY, ...(env.TENCENTCLOUD_TOKEN ? { token: env.TENCENTCLOUD_TOKEN } : {}) },
    region: '', profile: { signMethod: 'TC3-HMAC-SHA256', httpProfile: { endpoint: 'wsa.tencentcloudapi.com', reqTimeout: 18 } },
  }) : null);
  return { configured, async retrieve(query, { signal, retryAttempts = 1, onRetry } = {}) {
    if (!client) throw new SearchError('NOT_CONFIGURED', '搜索服务还未配置，请联系开发者。', 503);
    if (typeof query !== 'string' || [...query.trim()].length < 2 || [...query.trim()].length > 64 || /[\u0000-\u001f\u007f]/.test(query)) throw new SearchError('INVALID_QUERY', '调查问题需要重新整理，请重试。', 400);
    const abortError = () => new SearchError('SEARCH_TIMEOUT', '检索超时，请稍后重试；金币会退回。', 504);
    return withRetries(async attempt => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const started = performance.now(), stats = { code: 'OK', retryAttempt: attempt };
      try {
        requestSignal.throwIfAborted();
        const raw = await client.request('SearchPro', { Query: query.trim() }, { signal: requestSignal });
        requestSignal.throwIfAborted();
        if (!Array.isArray(raw?.Pages)) throw new SearchError('INVALID_RESPONSE', '搜索结果暂时无法读取，请稍后重试。');
        const sources = [], seen = new Set();
        for (const item of raw.Pages.slice(0, 10)) {
          let page; try { page = typeof item === 'string' ? JSON.parse(item) : item; } catch { continue; }
          const url = safeSourceUrl(page?.url), title = clean(page?.title, 180), summary = clean(page?.passage || page?.content, 1600), content = clean(page?.content, 3000);
          if (!url || !title || !summary || seen.has(sourceKey(url))) continue;
          seen.add(sourceKey(url));
          sources.push({ title, url, summary, content, organization: clean(page.site, 100) || new URL(url).hostname, date: clean(page.date, 40), ...sourceImage(page) });
        }
        return { query: query.trim(), requestId: clean(raw.RequestId, 100), version: clean(raw.Version, 30), sources };
      } catch (error) {
        let failure;
        if (requestSignal.aborted) { failure = abortError(); failure.retryable = !signal?.aborted; }
        else failure = searchTransportError(error);
        stats.code = failure.code;
        if (failure.httpStatus) stats.httpStatus = failure.httpStatus;
        throw failure;
      } finally {
        clearTimeout(timer);
        try { diagnostic({ ...stats, elapsedMs: Math.round(performance.now() - started) }); } catch { /* Logging cannot change a result. */ }
      }
    }, { signal, retryAttempts, onRetry, sleep, random, abortError });
  }, async search(input) {
    if (!client) throw new SearchError('NOT_CONFIGURED', '搜索服务还未配置，请联系开发者。', 503);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      // Query alone works for lite, standard and flagship; no service upgrade.
      const query = buildSearchQuery(input);
      const raw = await client.request('SearchPro', { Query: query }, { signal: controller.signal });
      // One bounded original-source lookup improves this case's provenance.
      // The player's query still runs unchanged above. Do not manufacture a
      // NASA/ESA card if this second real search yields no matching material.
      if (['standard', 'flagship'].includes(raw.Version)) {
        const focused = buildFocusedSearch(input);
        try {
          const original = await client.request('SearchPro', focused, { signal: controller.signal });
          if (Array.isArray(original.Pages)) {
            raw.Pages = [...original.Pages, ...(raw.Pages || [])];
            raw.RequestId = [raw.RequestId, original.RequestId].filter(Boolean).join(',');
            raw.SearchQueries = [query, `${focused.Query} · ${focused.Site}`];
          }
        } catch { /* Keep actual first-search results when the optional lookup fails. */ }
      }
      return normalizeSearchResponse(raw, input);
    } catch (error) {
      if (error instanceof SearchError) throw error;
      const code = String(error.code || '');
      if (controller.signal.aborted || /timeout|timed out|abort/i.test(error.message || '')) throw new SearchError('SEARCH_TIMEOUT', '搜索有点慢，金币已退回，可以稍后重试。', 504);
      if (/AuthFailure|UnauthorizedOperation/.test(code)) throw new SearchError('SEARCH_AUTH', '元宝搜索暂时无法通过鉴权，请联系开发者检查密钥权限。', 503);
      if (/ResourceNotFound|ResourceUnavailable|FailedOperation/.test(code)) throw new SearchError('SEARCH_UNAVAILABLE', '元宝搜索服务暂不可用，请检查服务开通状态与账户余额。', 503);
      if (/LimitExceeded/.test(code)) throw new SearchError('SEARCH_LIMIT', '搜索请求有点多，请稍后再试。', 429);
      // Never serialize raw SDK errors: they may contain a signed request.
      throw new SearchError('SEARCH_UNAVAILABLE', '暂时连不上元宝搜索，金币会退回，请稍后再试。', 502);
    } finally { clearTimeout(timer); }
  } };
}
