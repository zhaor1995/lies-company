import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SearchError, safeSourceUrl } from './search.mjs';
import { RULES } from '../dist/engine.js';
import { snapshotFinalVerdict, getCaseEnding, ASSESSMENT_LABELS } from '../dist/investigation-contract.js';

const invalid = () => { throw new SearchError('INVALID_LEADERBOARD', '探案记录不完整，请重新打开结案战报后再试。', 400); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const tokenHash = value => createHash('sha256').update(value.toLowerCase()).digest('hex');
function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value; }
function text(value, max = 300, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || [...value].length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  return value;
}
function number(value, max, min = 0) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(); return value; }
function integer(value, max, min = 0) { if (!Number.isInteger(value)) invalid(); return number(value, max, min); }
function list(value, max, convert) { if (!Array.isArray(value) || value.length > max) invalid(); return value.map(convert); }
function strings(value, fields) { record(value); return Object.fromEntries(Object.entries(fields).map(([key, length]) => [key, text(value[key], length)])); }
function sourceUrl(value) { const url = text(value, 2048); if (url && !safeSourceUrl(url)) invalid(); return url; }
function name(value) { const result = text(value, 100, true).trim(); if ([...result].length > 20 || /[\r\n\t]/.test(result)) invalid(); return result; }
function identity(value) { if (!uuid(value)) invalid(); return value.toLowerCase(); }

// Store only the public report fields. Client results are validated, not anti-cheat attested.
function report(value) {
  record(value); record(value.stats);
  if (value.outcome !== 'won') throw new SearchError('VICTORY_REQUIRED', '胜利结案后才能加入侦探排行。', 400);
  const elapsed = number(value.stats.elapsed, 86400, Number.EPSILON);
  const stats = { support: number(value.stats.support, 100.000001, RULES.winTruth - 1e-7), reached: number(value.stats.reached, 100.000001), elapsed,
    timeLabel: text(value.stats.timeLabel, 100, true), evidenceCount: integer(value.stats.evidenceCount, 5), totalRounds: integer(value.stats.totalRounds, 5, 1),
    regions: integer(value.stats.regions, 6), coinsCollected: number(value.stats.coinsCollected, 1000000), publishedGain: number(value.stats.publishedGain, 10000), countered: value.stats.countered === true };
  if (stats.evidenceCount > stats.totalRounds) invalid();
  const steps = list(value.steps, 5, item => {
    record(item);
    return { ...strings(item, { roundId: 80, materialId: 80, timeLabel: 100, question: 1000, selectedTitle: 500, publicationState: 50, publishedTimeLabel: 100, finding: 6000, quote: 12000, sourceTitle: 1000, sourceName: 300, sourceDate: 100, fetchedAt: 100, effectLabel: 300 }),
      round: integer(item.round, 5, 1), time: number(item.time, elapsed), published: item.published === true,
      publishedAt: item.publishedAt == null ? null : number(item.publishedAt, elapsed), sourceUrl: sourceUrl(item.sourceUrl),
      materials: list(item.materials, 4, material => ({ ...strings(material, { title: 500, finding: 6000, quote: 12000, organization: 300, sourceDate: 100, fetchedAt: 100, effectLabel: 300 }), url: sourceUrl(material.url), selected: material.selected === true })) };
  });
  if (steps.length !== stats.evidenceCount) invalid();
  const verdict = strings(value.verdict, { status: 40, label: 100, summary: 6000 });
  if (!['supported', 'refuted', 'mixed', 'insufficient'].includes(verdict.status)) invalid();
  const finalVerdict = value.finalVerdict == null ? null : snapshotFinalVerdict(value.finalVerdict);
  if (value.finalVerdict != null && !finalVerdict) invalid();
  if (finalVerdict) {
    const published = steps.filter(step => step.published);
    if (published.length !== finalVerdict.reviewedPublications.length
      || !published.every(step => finalVerdict.reviewedPublications.some(item => item.roundId === step.roundId && item.materialId === step.materialId))) invalid();
    if (!Array.isArray(value.sources)) invalid();
    const sources = new Set(value.sources.map(source => sourceUrl(source?.url)));
    if (finalVerdict.chain.some(link => !published.some(step => step.roundId === link.roundId && step.question === link.question) || link.sourceUrls.some(url => !sources.has(url)))) invalid();
    Object.assign(verdict, { status: finalVerdict.status, label: ASSESSMENT_LABELS[finalVerdict.status], summary: finalVerdict.summary });
  }
  const ending = getCaseEnding('won', finalVerdict, value.claim);
  if (value.ending != null && value.ending.id !== ending.id) invalid();
  const style = strings(value.style, { name: 100, description: 1000 });
  if (value.style.levels != null) {
    record(value.style.levels);
    style.levels = Object.fromEntries(['spread', 'persuasion', 'defense'].map(key => [key, integer(value.style.levels[key], 3)]));
  }
  text(value.title, 300, true);
  return { title: ending.title, claim: text(value.claim, 500, true), outcome: 'won', caseId: text(value.caseId, 80, true),
    period: strings(value.period, { start: 100, end: 100, duration: 100 }), narrative: text(value.narrative, 1000),
    verdict, ending, finalVerdict, stats, style, steps,
    timeline: list(value.timeline, 500, item => ({ ...strings(item, { kind: 50, timeLabel: 100, title: 1000, detail: 6000, roundId: 80 }), time: number(item.time, elapsed) })),
    sources: list(value.sources, 60, source => ({ ...strings(source, { title: 1000, organization: 300, date: 100, fetchedAt: 100 }), url: sourceUrl(source.url) })) };
}

export function createLeaderboardStore({ path, now = () => Date.now() }) {
  let entries, pending = Promise.resolve();
  async function load() {
    if (entries) return;
    try {
      const saved = JSON.parse(await readFile(path, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.entries)) throw new Error('invalid leaderboard storage');
      entries = saved.entries;
    } catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  }
  function serial(action) {
    const result = pending.then(async () => {
      try { await load(); return await action(); }
      catch (error) { if (error instanceof SearchError) throw error; throw new SearchError('LEADERBOARD_UNAVAILABLE', '侦探排行暂时无法读取或保存，请稍后重试。', 503); }
    });
    pending = result.catch(() => {}); return result;
  }
  async function save(next) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify({ version: 1, entries: next }), { mode: 0o600, flag: 'wx' }); await rename(temporary, path); entries = next; }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  function ranked() {
    return [...entries].sort((a, b) => a.report.stats.elapsed - b.report.stats.elapsed).map((item, index) => ({ id: item.id, rank: index + 1, name: item.name, claim: item.report.claim, elapsed: item.report.stats.elapsed, createdAt: item.createdAt }));
  }
  function snapshot(id) { const ordered = ranked(); return { entries: ordered.slice(0, 100), current: ordered.find(item => item.id === id) || null, total: ordered.length }; }
  function owned(entry, token) {
    if (!timingSafeEqual(Buffer.from(entry.ownerHash, 'hex'), Buffer.from(tokenHash(identity(token)), 'hex'))) throw new SearchError('LEADERBOARD_OWNER', '只能修改自己的侦探名称。', 403);
  }
  return {
    list: id => serial(() => snapshot(id ? identity(id) : undefined)),
    get: id => serial(() => {
      id = identity(id); const item = entries.find(item => item.id === id);
      if (!item) throw new SearchError('LEADERBOARD_NOT_FOUND', '这份探案记录不存在。', 404);
      return { entry: ranked().find(entry => entry.id === id), report: structuredClone(item.report) };
    }),
    add: input => serial(async () => {
      record(input); const id = identity(input.runId), ownerToken = identity(input.ownerToken), detective = name(input.name);
      const existing = entries.find(item => item.id === id);
      if (existing) { owned(existing, ownerToken); return snapshot(id); }
      const result = report(input.report);
      await save([...entries, { id, ownerHash: tokenHash(ownerToken), name: detective, createdAt: new Date(now()).toISOString(), report: result }]);
      return snapshot(id);
    }),
    rename: (id, input) => serial(async () => {
      id = identity(id); record(input); const detective = name(input.name), item = entries.find(item => item.id === id);
      if (!item) throw new SearchError('LEADERBOARD_NOT_FOUND', '这份探案记录不存在。', 404);
      owned(item, input.ownerToken);
      await save(entries.map(item => item.id === id ? { ...item, name: detective } : item));
      return snapshot(id);
    }),
  };
}
