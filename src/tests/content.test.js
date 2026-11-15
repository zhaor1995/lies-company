import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE, BASE_SEARCH_RESULT } from '../dist/content.js';

test('all displayed evidence can resolve to an HTTPS primary source', () => {
  const ids = new Set(CASE.sources.map(source => source.id));
  assert.equal(ids.size, CASE.sources.length);
  for (const item of [CASE.initialEvidence, BASE_SEARCH_RESULT]) {
    assert.ok(item.sourceIds.length > 0);
    for (const sourceId of item.sourceIds) assert.ok(ids.has(sourceId), sourceId);
  }
  for (const source of CASE.sources) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.match(url.hostname, /(^|\.)nasa\.gov$/);
  }
});

test('fictional attack and live versus offline retrieval are disclosed', () => {
  assert.equal(BASE_SEARCH_RESULT.mode, 'built-in-mock');
  assert.match(CASE.disclaimer, /联网版调用云元宝搜索/);
  assert.match(CASE.disclaimer, /离线演示使用预置资料/);
  assert.match(CASE.disclaimer, /不自动判定真假/);
  assert.match(CASE.opponentNote, /模拟伪证/);
  assert.match(CASE.opponentNote, /不是现实/);
});
