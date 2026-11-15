import test from 'node:test';
import assert from 'node:assert/strict';
import { tutorialLayout } from '../dist/tutorial.js';

const desktops = [
  {width: 1280, height: 720},
  {width: 1366, height: 768},
  {width: 1920, height: 1080},
];

// 代表桌面战局中的五个实际区域；断言布局关系，不绑定卡片的具体坐标。
function battleRegions({width, height}) {
  const edge = width <= 1360 ? 20 : 28;
  const asideWidth = width <= 1360 ? 320 : 344;
  const asideLeft = width - edge - asideWidth;
  const mapRight = asideLeft - 24;
  const hudTop = height <= 800 ? 76 : 96;
  const mapTop = hudTop + 152;
  const feedWidth = Math.min(460, Math.max(330, (mapRight - edge) * .35));
  return [
    {left: edge, top: mapTop, right: mapRight, bottom: height - 52},
    {left: asideLeft + 18, top: hudTop + 18, right: width - edge - 18, bottom: Math.min(hudTop + 530, height - 150)},
    {left: asideLeft + 18, top: height - 140, right: width - edge - 18, bottom: height - 34},
    {left: edge, top: Math.max(mapTop, height - 490), right: edge + feedWidth, bottom: height - 50},
    {left: edge, top: hudTop, right: mapRight, bottom: hudTop + 108},
  ];
}

function edges(box) {
  return {left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height};
}

function insideViewport(box, viewport, label) {
  const rect = edges(box);
  assert.ok(Object.values(box).every(Number.isFinite), `${label}: all coordinates are finite`);
  assert.ok(box.width > 0 && box.height > 0, `${label}: dimensions are positive`);
  assert.ok(rect.left >= 0 && rect.top >= 0, `${label}: starts inside viewport`);
  assert.ok(rect.right <= viewport.width && rect.bottom <= viewport.height, `${label}: ends inside viewport`);
}

function disjoint(a, b) {
  return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
}

for (const viewport of desktops) {
  test(`all five tutorial steps remain readable at ${viewport.width} × ${viewport.height}`, () => {
    const cardHeights = [450, 420, 400, 410, 390];
    battleRegions(viewport).forEach((target, step) => {
      const result = tutorialLayout({target, viewport, card: {width: 400, height: cardHeights[step]}, step});
      const focus = edges(result.spotlight);
      const label = `step ${step + 1}`;
      insideViewport(result.card, viewport, `${label} card`);
      insideViewport(result.spotlight, viewport, `${label} spotlight`);
      assert.ok(focus.left <= target.left && focus.top <= target.top, `${label}: spotlight includes target start`);
      assert.ok(focus.right >= target.right && focus.bottom >= target.bottom, `${label}: spotlight includes target end`);
      assert.ok(result.card.width <= 400 && result.card.height <= cardHeights[step], `${label}: does not enlarge content`);
      if (step > 0) {
        assert.ok(disjoint(edges(result.card), focus), `${label}: explanation does not cover the highlighted controls`);
      }
    });
  });
}

test('tutorial follows resized desktop regions instead of retaining old spotlight coordinates', () => {
  const small = desktops[0], large = desktops[2];
  for (let step = 0; step < 5; step++) {
    const before = tutorialLayout({target: battleRegions(small)[step], viewport: small, step});
    const after = tutorialLayout({target: battleRegions(large)[step], viewport: large, step});
    assert.notDeepEqual(after.spotlight, before.spotlight, `step ${step + 1}: focus follows changed region`);
    assert.notDeepEqual(after.card, before.card, `step ${step + 1}: card follows changed viewport`);
    insideViewport(after.card, large, `step ${step + 1} resized card`);
  }
});

test('moving or resizing the field panel repositions the explanation without changing the inputs', () => {
  const viewport = Object.freeze({width: 1920, height: 1080});
  const original = Object.freeze({left: 28, top: 580, right: 488, bottom: 1030});
  const moved = Object.freeze({left: 88, top: 350, right: 548, bottom: 1030});
  const before = tutorialLayout({target: original, viewport, step: 3});
  const after = tutorialLayout({target: moved, viewport, step: 3});
  assert.ok(after.spotlight.x > before.spotlight.x);
  assert.ok(after.spotlight.y < before.spotlight.y);
  assert.ok(after.spotlight.height > before.spotlight.height);
  assert.ok(after.card.x > before.card.x && after.card.y < before.card.y);
  assert.ok(disjoint(edges(after.card), edges(after.spotlight)));
  assert.deepEqual(tutorialLayout({target: original, viewport, step: 3}), before, 'returning to a step has no accumulated layout drift');
});

test('short desktop viewports contain tall cards and clip partially scrolled targets', () => {
  const viewport = {width: 1280, height: 540};
  const targets = [
    {left: 20, top: 160, right: 916, bottom: 680},
    {left: 958, top: -90, right: 1242, bottom: 410},
    {left: 958, top: 440, right: 1242, bottom: 650},
    {left: 20, top: -35, right: 430, bottom: 490},
    {left: 20, top: -40, right: 916, bottom: 95},
  ];
  targets.forEach((target, step) => {
    const {card, spotlight} = tutorialLayout({target, viewport, card: {width: 400, height: 900}, step});
    insideViewport(card, viewport, `step ${step + 1} short card`);
    insideViewport(spotlight, viewport, `step ${step + 1} clipped focus`);
    assert.ok(card.height < 900, 'oversized content receives a viewport-bounded scrolling area');
    assert.ok(!disjoint(edges(spotlight), target), 'focus remains attached to the visible part of its target');
    if (target.top >= 0) assert.ok(spotlight.y <= target.top, 'visible target top stays inside focus');
    if (target.bottom <= viewport.height) assert.ok(spotlight.y + spotlight.height >= target.bottom, 'visible target bottom stays inside focus');
  });
});

test('rectangle dimensions and edge coordinates produce the same tutorial placement', () => {
  const viewport = desktops[1];
  battleRegions(viewport).forEach((target, step) => {
    const dimensions = {x: target.left, y: target.top, width: target.right - target.left, height: target.bottom - target.top};
    assert.deepEqual(
      tutorialLayout({target: dimensions, viewport, step}),
      tutorialLayout({target, viewport, step}),
      `step ${step + 1}: accepts rectangle dimensions without losing bounds`,
    );
  });
});
