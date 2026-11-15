import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEARCH_DISCLAIMER,
  RESEARCH_ROUNDS,
  RESEARCH_SOURCES,
  RESEARCH_MEMES,
  RESEARCH_EVENTS,
} from '../dist/research-content.js';

const normalized = text => text.normalize('NFKC').replace(/[\s，。！？、,.!?]/gu, '').toLowerCase();
const questions = round => [round.defaultQuery, ...round.querySuggestions, ...(round.queryAliases || [])];

test('five investigations offer both tactics and every selection resolves to a matching sourced event', () => {
  assert.deepEqual(RESEARCH_ROUNDS.map(round => round.round), [1, 2, 3, 4, 5]);
  const materialIds = new Set();
  const usedEvents = new Set();
  for (const round of RESEARCH_ROUNDS) {
    assert.ok(round.finding && round.followupPrompt);
    assert.equal(round.materials.length, 2);
    assert.deepEqual(round.materials.map(material => material.focus).sort(), ['persuasion', 'spread']);
    for (const material of round.materials) {
      assert.ok(!materialIds.has(material.id), 'selections must not alias another material');
      materialIds.add(material.id);
      assert.ok(material.title && material.finding);
      assert.ok(material.sourceIds.length > 0);
      assert.equal(new Set(material.sourceIds).size, material.sourceIds.length, 'the same source cannot be counted twice within a material');
      for (const id of material.sourceIds) assert.ok(RESEARCH_SOURCES[id], `unresolved source: ${id}`);
      const event = RESEARCH_EVENTS[material.eventId];
      assert.ok(event, `unresolved event: ${material.eventId}`);
      assert.equal(event.triggerFocus, material.focus, 'the event must follow the tactic the player actually selected');
      assert.ok(RESEARCH_MEMES[event.memeId], 'events require a real, cited meme');
      usedEvents.add(material.eventId);
    }
  }
  assert.equal(materialIds.size, 10);
  assert.deepEqual([...usedEvents].sort(), Object.keys(RESEARCH_EVENTS).sort(), 'no unrelated random events belong in the five-search content');
});

test('every non-final investigation points to a supported deeper question', () => {
  const [first, second] = RESEARCH_ROUNDS;
  for (const round of RESEARCH_ROUNDS) {
    assert.ok(round.querySuggestions.length >= 2 && round.querySuggestions.length <= 3);
    assert.ok(round.querySuggestions.includes(round.defaultQuery));
    assert.ok(questions(round).every(query => typeof query === 'string' && query.trim()));
  }
  const firstRoutes = new Set(questions(first).map(normalized));
  const secondRoutes = new Set(questions(second).map(normalized));
  assert.ok([...firstRoutes].every(query => !secondRoutes.has(query)), 'round two must not reuse the same question as a new discovery');
  for (const material of first.materials) {
    assert.ok(second.querySuggestions.includes(material.nextQuestion) || second.queryAliases.includes(material.nextQuestion), 'a follow-up button must route to supported local evidence');
  }
  for (const [index, round] of RESEARCH_ROUNDS.entries()) {
    const next = RESEARCH_ROUNDS[index + 1];
    for (const material of round.materials) {
      if (next) assert.ok(questions(next).includes(material.nextQuestion), 'every branch must reach the next round');
      else assert.equal(material.nextQuestion, null, 'the final round must not promise a sixth search');
    }
  }
  assert.equal(new Set(RESEARCH_ROUNDS.flatMap(round => round.materials.map(material => material.finding))).size, 10);
  for (const query of ['任意新闻是真的吗？', '月球人偷走长城', '长城']) {
    assert.ok(!firstRoutes.has(normalized(query)) && !secondRoutes.has(normalized(query)), 'a topic keyword alone is not a supported verified question');
  }
  assert.match(RESEARCH_DISCLAIMER, /本地模拟/);
  assert.match(RESEARCH_DISCLAIMER, /不调用实时搜索/);
});

test('case evidence preserves source identity across both stages of the chain', () => {
  const [first, second] = RESEARCH_ROUNDS;
  const firstSources = [...new Set(first.materials.flatMap(material => material.sourceIds))];
  assert.deepEqual([...new Set(firstSources.map(id => RESEARCH_SOURCES[id].organization))], ['NASA'], 'two NASA pages are one organization');
  assert.ok(firstSources.length > 1, 'the first investigation offers image metadata and a direct answer');
  const sharedFollowupSources = second.materials[0].sourceIds.filter(id => second.materials[1].sourceIds.includes(id));
  assert.ok(sharedFollowupSources.some(id => RESEARCH_SOURCES[id].organization === 'ESA'), 'both treatments must retain their common observation source');
  assert.ok(sharedFollowupSources.every(id => !firstSources.includes(id)), 'the follow-up must add a new observation rather than rename the original');
  const observations = sharedFollowupSources.map(id => RESEARCH_SOURCES[id].summary).join(' ');
  assert.match(observations, /Thomas Pesquet/);
  assert.match(observations, /不能套到 Leroy Chiao/, 'instrument details from one photo set must not leak into the other');
});

test('citations use public source pages and explain what each source supports', () => {
  const evidencePublishers = new Set(['www.nasa.gov', 'science.gsfc.nasa.gov', 'www.esa.int', 'science.nasa.gov', 'eol.jsc.nasa.gov']);
  const memePublishers = new Set(['news.cctv.cn', 'news.sina.com.cn', 'ccl.pku.edu.cn', 'www.cnr.cn']);
  for (const source of Object.values(RESEARCH_SOURCES)) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(evidencePublishers.has(url.hostname));
    assert.ok(source.title && source.organization && source.summary);
    assert.equal(url.username + url.password + url.search, '');
  }
  for (const meme of Object.values(RESEARCH_MEMES)) {
    const url = new URL(meme.sourceUrl);
    assert.equal(url.protocol, 'https:');
    assert.ok(memePublishers.has(url.hostname));
    assert.ok(meme.title && meme.sourceTitle && meme.summary);
  }
});

test('fictional match effects stay distinguishable from the cited historical phenomenon', () => {
  const effects = new Set(['spread', 'persuasion', 'controversy']);
  for (const event of Object.values(RESEARCH_EVENTS)) {
    assert.equal(event.fictional, true);
    assert.ok(effects.has(event.effectKey), 'the engine uses a category, not an inferred joke meaning');
    assert.ok(event.title.length <= 24);
    assert.ok(event.quip.length <= 48);
    assert.ok(event.gameEffectHint);
    assert.match(event.realityNote, /本局虚构/);
    assert.match(event.realityNote, /游戏演绎|游戏设定/);
    assert.doesNotMatch(event.gameEffectHint, /[+×−]\s*\d|\d+%/, 'balance numbers have one owner in the engine');
  }
  const controversy = Object.values(RESEARCH_EVENTS).filter(event => event.effectKey === 'controversy');
  assert.equal(controversy.length, 1);
  assert.equal(controversy[0].triggerFocus, 'persuasion');
  assert.match(controversy[0].realityNote, /不是罗伯特的真实回复/);
  assert.match(controversy[0].realityNote, /不是 NASA 资料出错/, 'a fictional account misreading an expert source does not invalidate that source');
});

test('shared content cannot be mutated by one run and leak into the next run', () => {
  assert.throws(() => RESEARCH_ROUNDS[0].materials.push({}), TypeError);
  assert.throws(() => { RESEARCH_ROUNDS[0].materials[0].sourceIds[0] = 'fake'; }, TypeError);
  assert.throws(() => { RESEARCH_EVENTS['bot-misreads'].fictional = false; }, TypeError);
});
