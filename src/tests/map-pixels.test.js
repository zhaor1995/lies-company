import test from 'node:test';
import assert from 'node:assert/strict';
import { orderPopulationPixels, populationPixelCounts } from '../dist/map-pixels.js';

test('map pixels partition every region with less than one pixel of rounding error', () => {
  for (const total of [0, 1, 17, 143, 677, 2101]) {
    for (let blue = 0; blue <= 100; blue += 2.5) {
      for (let exposed = 0; exposed <= 100 - blue; exposed += 2.5) {
        const counts = populationPixelCounts(total, { blue, exposed });
        assert.equal(counts.blue + counts.exposed + counts.red, total);
        assert.ok(Math.abs(counts.blue - total * blue / 100) <= .5);
        assert.ok(Math.abs(counts.exposed - total * exposed / 100) < 1.000001);
        assert.ok(Math.abs(counts.red - total * (100 - blue - exposed) / 100) <= .500001);
        assert.ok(Object.values(counts).every(count => count >= 0));
      }
    }
  }
});

test('zero and full audiences have no misleading pixels from other groups', () => {
  assert.deepEqual(populationPixelCounts(731, { blue: 0, exposed: 0 }), { blue: 0, exposed: 0, red: 731 });
  assert.deepEqual(populationPixelCounts(731, { blue: 100, exposed: 0 }), { blue: 731, exposed: 0, red: 0 });
  assert.deepEqual(populationPixelCounts(731, { blue: 0, exposed: 100 }), { blue: 0, exposed: 731, red: 0 });
});

test('conversion advances fixed pixels and a reversal returns the exact earlier layout', () => {
  const tiles = Array.from({length: 1200}, (_, index) => ({x: index % 40, y: Math.floor(index / 40), path: String(index)}));
  const ordered = orderPopulationPixels(tiles);
  assert.deepEqual(orderPopulationPixels([...tiles].reverse()), ordered);
  assert.equal(new Set(ordered.map(tile => tile.path)).size, tiles.length);
  const supporters = population => ordered.slice(0, populationPixelCounts(ordered.length, population).blue).map(tile => tile.path);
  const before = supporters({blue: 25, exposed: 40});
  const after = supporters({blue: 40, exposed: 25});
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(supporters({blue: 25, exposed: 40}), before);
  assert.deepEqual(tiles[0], {x: 0, y: 0, path: '0'}, 'sorting must not change source geometry');
});

test('nearby audience pixels form stable patches instead of per-frame random noise', () => {
  const tiles = Array.from({length: 1600}, (_, index) => ({x: index % 40, y: Math.floor(index / 40), path: String(index)}));
  const blue = new Set(orderPopulationPixels(tiles).slice(0, 800).map(tile => tile.path));
  let same = 0, pairs = 0;
  for (const tile of tiles) if (tile.x < 39) { pairs++; if (blue.has(tile.path) === blue.has(String(Number(tile.path) + 1))) same++; }
  assert.ok(same / pairs > .8, `neighboring colors should form patches: ${same / pairs}`);
});
