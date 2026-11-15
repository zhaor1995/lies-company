import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SOUND_PROGRAMS } from '../dist/audio-score.js';
import { AUDIO_DEFAULTS, AUDIO_LIMITS, createAudioMix, createGameAudio, synthesizeProgram } from '../dist/game-audio.js';

const settle = () => new Promise(resolve => queueMicrotask(resolve));
const settleMusic = async () => { for (let i = 0; i < 8; i += 1) await settle(); };
const TEST_TRACKS = {
  normal: { url: 'test:normal', gain: .6, loopStart: 2, loopEnd: 10 },
  danger: { url: 'test:danger', gain: .55, loopStart: 0, loopEnd: 8 },
};
const digest = samples => createHash('sha256').update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)).digest('hex');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

function mockContext() {
  const param = value => ({
    value, changes: [],
    cancelAndHoldAtTime(time) { this.changes.push(['hold', time]); },
    cancelScheduledValues(time) { this.changes.push(['cancel', time]); },
    setValueAtTime(value, time) { this.value = value; this.changes.push(['set', value, time]); },
    setTargetAtTime(value, time, tau) { this.value = value; this.changes.push(['target', value, time, tau]); },
    setValueCurveAtTime(curve, time, duration) { this.value = curve.at(-1); this.changes.push(['curve', [...curve], time, duration]); },
  });
  const node = type => ({
    type, connections: [], disconnected: false,
    connect(destination) { this.connections.push(destination); return destination; },
    disconnect() { this.disconnected = true; this.connections = []; },
  });
  const context = {
    state: 'suspended', currentTime: 0, sources: [], nodes: [], resumes: 0, suspends: 0, closes: 0,
    rejectResume: false, destination: node('destination'),
    createGain() { const result = { ...node('gain'), gain: param(1) }; this.nodes.push(result); return result; },
    createBiquadFilter() { return { ...node('filter'), frequency: param(0), Q: param(0) }; },
    createDynamicsCompressor() {
      return { ...node('compressor'), threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) };
    },
    createBuffer(channels, length, sampleRate) {
      assert.ok(length > 0 && Number.isInteger(length));
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / sampleRate, length, sampleRate, getChannelData: index => data[index] };
    },
    createBufferSource() {
      const source = {
        ...node('source'), buffer: null, started: false, ended: false, stopAt: Infinity,
        loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1),
        start(when, offset = 0) {
          assert.equal(this.started, false, 'a buffer source must only start once');
          assert.ok(Number.isFinite(when) && when >= context.currentTime - 1e-8, 'schedule on the audio clock');
          this.started = true; this.startAt = when; this.offset = offset;
        },
        stop(when = context.currentTime) { this.stopAt = Math.min(this.stopAt, when); },
      };
      this.sources.push(source); return source;
    },
    resume() {
      this.resumes += 1;
      if (this.rejectResume) return Promise.reject(new Error('audio gesture rejected'));
      this.state = 'running'; return Promise.resolve();
    },
    suspend() { this.suspends += 1; this.state = 'suspended'; return Promise.resolve(); },
    close() { this.closes += 1; this.state = 'closed'; return Promise.resolve(); },
    advance(seconds) {
      if (this.state !== 'running') return;
      this.currentTime += seconds;
      for (const source of this.sources) {
        if (source.started && !source.ended && Math.min(source.stopAt, source.loop ? Infinity : source.startAt + source.buffer.duration) <= this.currentTime) {
          source.ended = true; source.onended?.();
        }
      }
    },
  };
  return context;
}

function harness(t, overrides = {}) {
  const context = mockContext(), timers = new Map(), saved = new Map(), loads = [];
  let creations = 0, timerId = 0, wallTime = 0;
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const audio = createGameAudio({
    contextFactory: () => { creations += 1; return context; }, storage,
    setInterval: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id), musicTracks: TEST_TRACKS, ...overrides,
    nowMs: overrides.nowMs || (() => wallTime),
    loadMusic: (track, device, signal) => {
      loads.push({ track, device, signal });
      return overrides.loadMusic ? overrides.loadMusic(track, device, signal) : { duration: 20, tag: track.url };
    },
  });
  t.after(() => audio.dispose());
  return {
    audio, context, timers, storage, saved, loads, creations: () => creations,
    tick(seconds) {
      for (let remaining = seconds; remaining > 1e-9;) {
        const delta = Math.min(.025, remaining); remaining -= delta; wallTime += delta * 1000; context.advance(delta);
        for (const callback of timers.values()) callback();
      }
    },
  };
}

test('实际交互都有独立音效程序，声音有效、确定且保留峰值余量', () => {
  const required = 'hover click select type page open close start coin jackpot upgrade defense search evidence store publish impact counter warning damage breakthrough milestone win lose error pause resume speed copy download'.split(' ');
  for (const name of required) assert.ok(SOUND_PROGRAMS[name], `${name} is missing`);
  const signatures = new Set();
  for (const [name, program] of Object.entries(SOUND_PROGRAMS)) {
    assert.ok(program.notes.length > 0 && program.duration > 0 && program.duration <= 5, name);
    assert.ok(program.description.length > 0);
    assert.ok(program.cooldown >= 0 && program.priority >= 0 && program.duck >= 0 && program.duck <= 1);
    for (const note of program.notes) {
      assert.ok(note.at >= 0 && note.duration > 0 && note.at + note.duration <= program.duration + 1e-8, name);
      assert.ok(note.gain > 0 && note.gain <= 1, name);
    }
    const samples = synthesizeProgram(program);
    assert.equal(samples.length, Math.ceil(program.duration * AUDIO_LIMITS.sampleRate));
    let peak = 0, energy = 0;
    for (const value of samples) { assert.ok(Number.isFinite(value), name); peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    assert.ok(peak <= .85001, `${name} exceeds headroom: ${peak}`);
    assert.ok(Math.sqrt(energy / samples.length) > .002, `${name} is effectively silent`);
    const signature = digest(samples); signatures.add(signature);
    assert.equal(signature, digest(synthesizeProgram(program)), `${name} must not change timbre on every play`);
  }
  assert.equal(signatures.size, Object.keys(SOUND_PROGRAMS).length, 'distinct interactions should not share identical waveforms');
});

test('音乐与音效分别混音，且所有信号都经过统一保护及静音总线', () => {
  const context = mockContext(), mix = createAudioMix(context, { music: .3, sfx: .8, muted: true });
  close(mix.music.gain.value, .3); close(mix.sfx.gain.value, .8); close(mix.master.gain.value, 0);
  assert.equal(mix.music.connections[0], mix.warmth);
  assert.equal(mix.warmth.connections[0], mix.duck);
  assert.equal(mix.sfx.connections[0], mix.duck.connections[0]);
  assert.equal(mix.duck.connections[0].connections[0], mix.limiter);
  assert.equal(mix.limiter.connections[0], mix.master);
  assert.equal(mix.master.connections[0], context.destination);
  assert.ok(mix.limiter.threshold.value < 0 && mix.limiter.ratio.value > 1);
});

test('加载阶段不创建音频设备，首次手势解锁后才有声音，重复解锁不重复起播放器', async t => {
  const h = harness(t);
  assert.equal(h.audio.emit('click'), false); assert.equal(h.audio.emit('unknown'), false);
  assert.equal(h.creations(), 0); assert.equal(h.timers.size, 0);
  assert.equal(h.audio.getDiagnostics().emissions, 1);
  assert.equal(await h.audio.unlock(), true); await settleMusic();
  assert.equal(h.creations(), 1); assert.equal(h.context.resumes, 1); assert.equal(h.timers.size, 1);
  assert.ok(h.context.sources.length > 0);
  const sources = h.context.sources.length;
  await h.audio.unlock();
  assert.equal(h.creations(), 1); assert.equal(h.timers.size, 1); assert.equal(h.context.sources.length, sources);
  assert.equal(h.audio.emit('click'), true); await settle();
  assert.equal(h.audio.getDiagnostics().played, 1);
});

test('独立音量、静音和保存的设置生效，音乐静音不影响音效', async t => {
  const h = harness(t); h.audio.configure({ music: 0, sfx: .31 }); await h.audio.unlock();
  assert.equal(h.context.sources.length, 0);
  assert.equal(h.audio.emit('coin'), true); await settle();
  assert.equal(h.audio.getDiagnostics().activeEffects, 1);
  h.audio.configure({ muted: true });
  assert.equal(h.audio.getDiagnostics().activeSources, 0); assert.equal(h.audio.emit('click'), false);
  h.audio.configure({ music: .27 });
  assert.deepEqual(h.audio.getSettings(), { music: .27, sfx: .31, muted: true });
  const savedAudio = createGameAudio({ storage: h.storage }); t.after(() => savedAudio.dispose());
  assert.deepEqual(savedAudio.getSettings(), h.audio.getSettings());
  h.audio.configure({ muted: false, sfx: 0 });
  assert.equal(h.audio.emit('evidence'), false); await settleMusic(); h.tick(.2);
  assert.ok(h.audio.getDiagnostics().musicStarts > 0);
  h.audio.configure({ music: 3, sfx: -1 });
  assert.deepEqual(h.audio.getSettings(), { music: 1, sfx: 0, muted: false });
});

test('损坏或禁止访问的存储不会阻断游戏声音', async t => {
  for (const storage of [
    { getItem: () => '{', setItem() { throw new Error('private mode'); } },
    { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } },
  ]) {
    const h = harness(t, { storage }); assert.deepEqual(h.audio.getSettings(), AUDIO_DEFAULTS);
    assert.doesNotThrow(() => h.audio.configure({ music: .2 }));
    assert.equal(await h.audio.unlock(), true);
  }
});

test('隐藏页面停止并丢弃瞬时事件，返回不会补播旧音效', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); await h.audio.unlock();
  assert.equal(h.audio.emit('evidence'), true);
  h.audio.setVisible(false); await settle();
  assert.equal(h.context.state, 'suspended'); assert.equal(h.audio.getDiagnostics().activeSources, 0);
  assert.equal(h.audio.emit('coin'), false);
  assert.equal(h.audio.getDiagnostics().played, 0);
  h.audio.setVisible(true); await settle(); await settle();
  assert.equal(h.context.state, 'running'); assert.equal(h.audio.getDiagnostics().played, 0);
  h.tick(.4); assert.equal(h.audio.emit('coin'), true); await settle();
  assert.equal(h.audio.getDiagnostics().played, 1);
  h.tick(2); assert.equal(h.audio.getDiagnostics().played, 1);
});

test('重开停止现有音源、取消待播事件、重置冷却，同时保留用户设置', async t => {
  const h = harness(t); h.audio.configure({ music: 0, sfx: .42 }); await h.audio.unlock();
  h.audio.emit('win'); await settle(); const sounding = h.context.sources.at(-1);
  h.audio.emit('coin'); h.audio.reset(); await settle();
  assert.ok(Number.isFinite(sounding.stopAt)); assert.equal(h.audio.getDiagnostics().activeSources, 0);
  assert.equal(h.audio.getDiagnostics().activeEffects, 0); assert.equal(h.audio.getDiagnostics().musicTrack, null);
  assert.deepEqual(h.audio.getSettings(), { music: 0, sfx: .42, muted: false });
  assert.equal(h.audio.getDiagnostics().played, 1);
  assert.equal(h.audio.emit('win'), true); await settle();
  assert.equal(h.audio.getDiagnostics().played, 2);
  h.audio.dispose(); const sourceCount = h.context.sources.length; h.tick(1);
  assert.equal(h.timers.size, 0); assert.equal(h.context.state, 'closed');
  assert.equal(await h.audio.unlock(), false); assert.equal(h.audio.emit('click'), false);
  assert.equal(h.context.sources.length, sourceCount);
});

test('同一批反馈只播放最重要的两组，连续低优先级事件不能遮住结算', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); await h.audio.unlock();
  for (const event of ['hover', 'click', 'error', 'warning', 'win']) h.audio.emit(event);
  await settle();
  const first = h.audio.getDiagnostics();
  assert.equal(first.activeEffects, 2); assert.equal(first.played, 2); assert.equal(first.dropped, 3);
  assert.deepEqual(first.history.filter(item => item.status === 'played').map(item => item.event), ['win', 'warning']);
  h.tick(.1); h.audio.emit('click'); await settle();
  assert.equal(h.audio.getDiagnostics().played, 2);
  assert.ok(h.audio.getDiagnostics().maxEffects <= AUDIO_LIMITS.effectGroups);
});

test('已播放的低优先级反馈可被更重要事件替换，最大并发仍为两组', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); await h.audio.unlock();
  h.audio.emit('page'); h.audio.emit('coin'); await settle(); const old = [...h.context.sources];
  h.tick(.04); h.audio.emit('impact'); h.audio.emit('lose'); await settle();
  assert.equal(h.audio.getDiagnostics().activeEffects, 2); assert.equal(h.audio.getDiagnostics().played, 4);
  assert.ok(old.every(source => Number.isFinite(source.stopAt)));
  h.tick(2); assert.equal(h.audio.getDiagnostics().activeEffects, 0); assert.equal(h.audio.getDiagnostics().activeSources, 0);
});

test('同一毫秒内的胜利提示仍可抢占刚触发的悬停和选择反馈', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); await h.audio.unlock();
  h.audio.emit('hover'); h.audio.emit('select'); await settle();
  assert.equal(h.audio.getDiagnostics().activeEffects, 2);
  h.audio.emit('win'); await settle();
  const diagnostics = h.audio.getDiagnostics();
  assert.equal(h.context.currentTime, 0);
  assert.ok(diagnostics.history.some(item => item.event === 'win' && item.status === 'played'));
  assert.equal(diagnostics.played, 3); assert.equal(diagnostics.dropped, 0);
  assert.equal(diagnostics.activeEffects, 2); assert.equal(diagnostics.maxEffects, 2);
  assert.equal(h.context.sources.filter(source => Number.isFinite(source.stopAt)).length, 1);
});

test('背景压低取活跃音效的最强值，强音效结束后仍保留弱音效所需压低', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); await h.audio.unlock();
  const musicBus = h.context.nodes.find(node => node.connections[0]?.type === 'lowpass');
  const duck = musicBus.connections[0].connections[0].gain;
  h.audio.emit('breakthrough'); h.audio.emit('coin'); await settle();
  close(duck.value, 1 - SOUND_PROGRAMS.breakthrough.duck);
  // 在突破提示快结束时收另一枚金币，让较弱提示持续到强提示之后。
  h.tick(SOUND_PROGRAMS.breakthrough.duration - .08);
  h.audio.emit('coin'); await settle();
  close(duck.value, 1 - SOUND_PROGRAMS.breakthrough.duck);
  h.tick(.1); close(duck.value, 1 - SOUND_PROGRAMS.coin.duck);
  assert.equal(h.audio.getDiagnostics().activeEffects, 1);
  h.tick(SOUND_PROGRAMS.coin.duration); close(duck.value, 1);
  assert.equal(h.audio.getDiagnostics().activeEffects, 0);
});

test('同一反馈的冷却防止连点爆音，到期后可再次播放', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); await h.audio.unlock();
  assert.equal(h.audio.emit('click'), true); assert.equal(h.audio.emit('click'), false); await settle();
  assert.equal(h.audio.getDiagnostics().played, 1);
  h.tick(SOUND_PROGRAMS.click.cooldown + .001);
  assert.equal(h.audio.emit('click'), true); await settle();
  assert.equal(h.audio.getDiagnostics().played, 2); assert.equal(h.audio.getDiagnostics().emissions, 3);
});

test('音频解锁被拒绝时安全退化，并允许下一次真实手势恢复', async t => {
  const h = harness(t); h.audio.configure({ music: 0 }); h.context.rejectResume = true;
  const failed = h.audio.unlock(); h.audio.emit('start');
  assert.equal(await failed, false); await settle();
  assert.equal(h.audio.getDiagnostics().activeSources, 0); assert.equal(h.audio.getDiagnostics().errors, 1);
  h.context.rejectResume = false; assert.equal(await h.audio.unlock(), true); await settle();
  assert.equal(h.audio.getDiagnostics().played, 0, 'failed unlock must discard its queued start jingle');
  assert.equal(h.audio.emit('click'), true); await settle(); assert.equal(h.audio.getDiagnostics().played, 1);
});

test('录音只加载一次并按循环点持续播放，阅读和暂停仅调整混音', async t => {
  const h = harness(t); h.audio.setScene('investigation');
  assert.equal(h.loads.length, 0);
  await h.audio.unlock(); await settleMusic();
  assert.deepEqual(h.loads.map(load => load.track.url).sort(), ['test:danger', 'test:normal']);
  assert.ok(h.loads.every(load => load.device === h.context && load.signal instanceof AbortSignal));
  const source = h.context.sources.find(item => item.loop);
  assert.equal(source.buffer.tag, 'test:normal'); assert.equal(source.offset, 0);
  assert.equal(source.loopStart, 2); assert.equal(source.loopEnd, 10);
  const musicBus = source.connections[0].connections[0], fullLevel = musicBus.gain.value;
  for (const scene of ['reading', 'paused', 'publication']) {
    h.audio.setScene(scene); await settleMusic();
    assert.ok(musicBus.gain.value < fullLevel);
    assert.equal(h.audio.getDiagnostics().musicStarts, 1);
  }
  h.audio.setScene('investigation'); await h.audio.unlock(); await settleMusic();
  h.tick(28.25);
  close(h.audio.getDiagnostics().musicOffset, 4.25);
  assert.equal(source.ended, false); assert.equal(h.audio.getDiagnostics().activeMusic, 1);
  assert.equal(h.audio.getDiagnostics().musicStarts, 1); assert.equal(h.loads.length, 2);
});

test('同一录音被两个场景引用时共享加载与解码，不重复起轨', async t => {
  const track = { url: 'test:shared', loopStart: 1, loopEnd: 12 };
  const h = harness(t, { musicTracks: { normal: track, danger: track } });
  await h.audio.unlock(); await settleMusic();
  h.audio.setScene('danger'); await settleMusic();
  assert.equal(h.loads.length, 1); assert.equal(h.audio.getDiagnostics().musicStarts, 1);
  assert.equal(h.context.sources.filter(source => source.loop).length, 1);
});

test('隐藏页面恢复时从循环内原位置继续，不重载或重播片头', async t => {
  const h = harness(t); await h.audio.unlock(); await settleMusic();
  h.tick(12.3); close(h.audio.getDiagnostics().musicOffset, 4.3);
  const first = h.context.sources.find(source => source.loop);
  h.audio.setVisible(false); await settleMusic();
  assert.equal(h.audio.getDiagnostics().activeMusic, 0); assert.ok(first.disconnected);
  h.tick(25); close(h.context.currentTime, 12.3);
  h.audio.setVisible(true); await settleMusic();
  const resumed = h.context.sources.filter(source => source.loop).at(-1);
  assert.notEqual(resumed, first); close(resumed.offset, 4.3);
  assert.equal(h.audio.getDiagnostics().activeMusic, 1); assert.equal(h.loads.length, 2);
  h.tick(.7); close(h.audio.getDiagnostics().musicOffset, 5);
});

test('迟到的异步录音加载不能在隐藏、静音、结算或销毁后发声', async t => {
  for (const action of ['hidden', 'muted', 'won', 'dispose']) {
    const pending = [];
    const h = harness(t, { loadMusic: () => new Promise(resolve => pending.push(resolve)) });
    await h.audio.unlock(); await settleMusic();
    assert.equal(pending.length, 2); assert.equal(h.audio.getDiagnostics().activeMusic, 0);
    if (action === 'hidden') h.audio.setVisible(false);
    if (action === 'muted') h.audio.configure({ muted: true });
    if (action === 'won') h.audio.setScene('won');
    if (action === 'dispose') h.audio.dispose();
    for (const resolve of pending) resolve({ duration: 20 });
    await settleMusic();
    assert.equal(h.audio.getDiagnostics().musicStarts, 0, action);
    assert.equal(h.context.sources.length, 0, action);
    if (action === 'dispose') assert.ok(h.loads.every(load => load.signal.aborted));
  }
});

test('切歌时旧曲先完成下载也不会误播，新曲就绪后才开始播放', async t => {
  const pending = new Map();
  const h = harness(t, { loadMusic: track => new Promise(resolve => pending.set(track.url, resolve)) });
  await h.audio.unlock(); await settleMusic(); h.audio.setScene('danger');
  pending.get('test:normal')({ duration: 20, tag: 'normal' }); await settleMusic();
  assert.equal(h.audio.getDiagnostics().musicStarts, 0);
  pending.get('test:danger')({ duration: 20, tag: 'danger' }); await settleMusic();
  assert.equal(h.audio.getDiagnostics().musicTrack, 'danger');
  assert.equal(h.context.sources[0].buffer.tag, 'danger');
});

test('加载失败不会被定时器无限重试，冷却后允许新手势重试', async t => {
  const h = harness(t, { loadMusic: () => Promise.reject(new Error('offline')) });
  await h.audio.unlock(); await settleMusic();
  assert.equal(h.loads.length, 2); assert.equal(h.audio.getDiagnostics().musicErrors, 2);
  h.tick(AUDIO_LIMITS.musicRetryMs / 1000 - .1);
  await h.audio.unlock(); await settleMusic(); assert.equal(h.loads.length, 2);
  h.tick(20); await settleMusic(); assert.equal(h.loads.length, 2);
  await h.audio.unlock(); await settleMusic(); assert.equal(h.loads.length, 4);
  assert.equal(h.audio.getDiagnostics().activeMusic, 0);
  assert.equal(h.audio.emit('click'), true); await settle();
  assert.equal(h.audio.getDiagnostics().played, 1, 'music failure must not disable interaction sounds');
});

test('快速切歌最多保留两条录音，静音和音乐音量归零会立即清除旧尾音', async t => {
  const h = harness(t); await h.audio.unlock(); await settleMusic();
  for (const scene of ['danger', 'investigation', 'danger', 'investigation']) {
    const previous = h.context.sources.filter(source => source.loop).at(-1);
    h.audio.setScene(scene); await settleMusic();
    close(previous.stopAt, h.context.currentTime + AUDIO_LIMITS.crossfade);
    const fade = previous.connections[0].gain.changes.findLast(change => change[0] === 'curve');
    assert.ok(fade[1][0] > fade[1].at(-1)); close(fade[3], AUDIO_LIMITS.crossfade);
    assert.ok(h.audio.getDiagnostics().activeMusic <= 2);
    assert.ok(h.context.sources.filter(source => source.loop && !source.disconnected).length <= 2);
  }
  assert.equal(h.audio.getDiagnostics().maxMusicSources, 2);
  h.audio.configure({ muted: true });
  assert.equal(h.audio.getDiagnostics().activeMusic, 0);
  assert.ok(h.context.sources.filter(source => source.loop).every(source => source.disconnected && source.stopAt <= h.context.currentTime));
  h.audio.configure({ muted: false }); await settleMusic();
  assert.equal(h.audio.getDiagnostics().activeMusic, 1);
  h.audio.configure({ music: 0 });
  assert.equal(h.audio.getDiagnostics().activeMusic, 0);
  assert.ok(h.context.sources.filter(source => source.loop).every(source => source.disconnected));
  assert.equal(h.loads.length, 2);
});

test('重开清除录音播放位置并从头播放，同场景也会重新启动', async t => {
  const h = harness(t); await h.audio.unlock(); await settleMusic(); h.tick(3.5);
  const previous = h.context.sources.find(source => source.loop);
  h.audio.reset(); await settleMusic();
  const restarted = h.context.sources.filter(source => source.loop).at(-1);
  assert.notEqual(restarted, previous); assert.ok(previous.disconnected);
  assert.equal(restarted.offset, 0); assert.equal(h.audio.getDiagnostics().musicStarts, 2);
  assert.equal(h.audio.getDiagnostics().activeMusic, 1); assert.equal(h.loads.length, 2);
});

test('游戏加速反馈不会改变录音速度，结算停止后也不会自行重新开播', async t => {
  const h = harness(t); h.audio.setScene('investigation'); await h.audio.unlock(); await settleMusic();
  const source = h.context.sources.find(item => item.loop);
  for (let index = 0; index < 3; index += 1) {
    h.audio.emit('speed'); await settle(); h.tick(.2);
  }
  assert.equal(source.playbackRate.value, 1); assert.deepEqual(source.playbackRate.changes, []);
  close(h.audio.getDiagnostics().musicOffset, .6);
  assert.equal(h.audio.getDiagnostics().musicStarts, 1);
  h.audio.setScene('won'); const starts = h.audio.getDiagnostics().musicStarts;
  h.tick(10); await settleMusic();
  assert.equal(h.audio.getDiagnostics().activeMusic, 0); assert.equal(h.audio.getDiagnostics().musicStarts, starts);
});

