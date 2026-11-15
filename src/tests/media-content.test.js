import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS } from '../dist/engine.js';
import { REGION_PRIMARY_MEDIA } from '../dist/media-network.js';
import { MEDIA_STORIES, MEDIA_FLAVOR } from '../dist/media-content.js';

test('every scheduled media story has a complete compact display and source contract', () => {
  assert.deepEqual(Object.keys(MEDIA_STORIES).sort(), ['migration', 'notes', 'outage']);
  for (const story of Object.values(MEDIA_STORIES)) {
    for (const key of ['title', 'quip', 'effect', 'historyLabel', 'history', 'sourceTitle', 'sourceUrl', 'tone']) {
      assert.equal(typeof story[key], 'string', key);
      assert.ok(story[key].trim(), `${key} must be usable by the story panel`);
    }
    assert.ok(story.title.length <= 24, 'headline must fit the compact event strip');
    assert.ok(story.quip.length <= 40, 'flavour is one short line, not a second tutorial');
    assert.ok(['success', 'warning', 'neutral'].includes(story.tone));
    assert.match(story.historyLabel, /历史彩蛋|机制彩蛋/, 'the visible label distinguishes references from live news');
    assert.match(story.history, /游戏设定|游戏演绎/, 'historical facts and match mechanics stay separate');
  }
});

test('story citations point to the named publisher or an official mechanism document', () => {
  const publishers = { migration: 'apnews.com', notes: 'communitynotes.x.com', outage: 'engineering.fb.com' };
  for (const [id, story] of Object.entries(MEDIA_STORIES)) {
    const source = new URL(story.sourceUrl);
    assert.equal(source.protocol, 'https:');
    assert.equal(source.hostname, publishers[id]);
    assert.equal(source.username + source.password + source.search, '');
  }
  for (const id of ['migration', 'outage']) assert.match(MEDIA_STORIES[id].historyLabel, /\d{4}-\d{2}-\d{2}/);
  assert.match(MEDIA_STORIES.notes.historyLabel, /机制/);
  assert.match(MEDIA_STORIES.notes.history, /不表示本案在现实中/, 'a sourced mechanism is not evidence that this match was fact-checked');
});

test('routine carriers use clear verbs and leave sourced jokes to actual events', () => {
  assert.deepEqual(Object.keys(MEDIA_FLAVOR).sort(), CHANNELS.map(channel => channel.id).sort());
  for (const item of Object.values(MEDIA_FLAVOR)) {
    assert.deepEqual(Object.keys(item).sort(), ['quip', 'verb']);
    assert.ok(item.verb.length > 0 && item.verb.length <= 12);
    assert.equal(item.quip, '', 'ordinary traffic should not cycle invented jokes');
    assert.doesNotMatch(item.quip, /[×+−]\s*\d|\d+%/, 'routine media flavour cannot silently promise a buff');
  }
});

test('six different regional media have traceable real-world prototypes', () => {
  const ids = Object.values(REGION_PRIMARY_MEDIA);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, 'overseas regions cannot all show the same platform');
  const publishers = { green: 'www.xiaohongshu.com', readit: 'www.sec.gov', whatsgua: 'about.fb.com', telegram: 'telegram.org', africanow: 'www.africanews.com', absee: 'www.abc.net.au' };
  for (const id of ids) {
    const channel = CHANNELS.find(item => item.id === id);
    assert.ok(channel?.prototype && channel?.description && channel?.sourceTitle);
    const source = new URL(channel.sourceUrl);
    assert.equal(source.protocol, 'https:');
    assert.equal(source.hostname, publishers[id]);
  }
});
