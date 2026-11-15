import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { WORLD_SECONDS_PER_DAY, WORLD_SECONDS_PER_HOUR, worldTime, worldDuration, worldRemaining } from '../dist/world-time.js';

test('世界从 2077 年 4 月 1 日零时开始，每游戏分钟推进一天', () => {
  assert.equal(WORLD_SECONDS_PER_DAY, 60);
  assert.equal(WORLD_SECONDS_PER_HOUR, 2.5);
  assert.deepEqual(worldTime(0), {
    date: '2077.04.01', shortDate: '04.01', hour: '00', day: 1,
    label: '2077年4月1日 00时', stamp: '2077.04.01 · 00时', iso: '2077-04-01T00:00:00.000Z',
  });
  assert.equal(worldTime(2.499).hour, '00');
  assert.equal(worldTime(2.5).hour, '01');
  assert.equal(worldTime(59.999).stamp, '2077.04.01 · 23时');
  assert.equal(worldTime(60).stamp, '2077.04.02 · 00时');
  assert.equal(worldTime(60).day, 2);
  assert.equal(worldTime(62.5).iso, '2077-04-02T01:00:00.000Z');
});

test('日期跨月、跨年及闰日保持正确，日序从第一天连续累计', () => {
  assert.equal(worldTime(30 * 60).stamp, '2077.05.01 · 00时');
  assert.equal(worldTime(275 * 60).stamp, '2078.01.01 · 00时');
  assert.equal(worldTime(275 * 60).day, 276);
  assert.equal(worldTime(334 * 60).stamp, '2078.03.01 · 00时');
  assert.equal(worldTime(1064 * 60).stamp, '2080.02.29 · 00时');
  assert.equal(worldTime(1065 * 60).stamp, '2080.03.01 · 00时');
  assert.equal(worldTime(1065 * 60).day, 1066);
});

test('日期小时向下取整，ISO 与玩家看到的小时保持一致', () => {
  const result = worldTime(75.499);
  assert.equal(result.hour, '06');
  assert.equal(result.label, '2077年4月2日 06时');
  assert.equal(result.iso, '2077-04-02T06:00:00.000Z');
});

test('报告经过时间向下取整且省略零天和零小时', () => {
  assert.equal(worldDuration(0), '不足1小时');
  assert.equal(worldDuration(2.499), '不足1小时');
  assert.equal(worldDuration(2.5), '1小时');
  assert.equal(worldDuration(12.5), '5小时');
  assert.equal(worldDuration(59.999), '23小时');
  assert.equal(worldDuration(60), '1天');
  assert.equal(worldDuration(75), '1天6小时');
  assert.equal(worldDuration(120), '2天');
});

test('剩余时间不足一小时直说，其余向上取整，不会提前显示完成', () => {
  assert.equal(worldRemaining(0), '已完成');
  assert.equal(worldRemaining(0.001), '不到1小时');
  assert.equal(worldRemaining(2.499), '不到1小时');
  assert.equal(worldRemaining(2.5), '约1小时');
  assert.equal(worldRemaining(2.501), '约2小时');
  assert.equal(worldRemaining(7.4), '约3小时');
  assert.equal(worldRemaining(59.999), '约1天');
  assert.equal(worldRemaining(60), '约1天');
  assert.equal(worldRemaining(60.001), '约1天1小时');
  assert.equal(worldRemaining(74.9), '约1天6小时');
});

test('无效、负数及无法表示的数值统一视为零', () => {
  for (const invalid of [-1, NaN, Infinity, -Infinity, undefined, null, '60', {}, [], Number.MAX_VALUE]) {
    assert.deepEqual(worldTime(invalid), worldTime(0));
    assert.equal(worldDuration(invalid), '不足1小时');
    assert.equal(worldRemaining(invalid), '已完成');
  }
});

test('世界日期不受运行设备所在时区影响', () => {
  const moduleUrl = new URL('../dist/world-time.js', import.meta.url).href;
  const script = `import {worldTime} from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(worldTime(275 * 60 + 2.5)));`;
  for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), worldTime(275 * 60 + 2.5));
  }
});
