const TUTORIAL_SEEN_KEY = 'lies-company.tutorial.v1';
const TUTORIAL_CURSOR = '<path d="M0 0v28l7-7 7 15 7-3-7-14h11Z" fill="#f2f4df" stroke="#0b1308" stroke-width="3"/>';
const TUTORIAL_STEPS = [
  {
    title: '让真相从这里出发', region: '世界地图',
    targets: ['#map-wrap'],
    copy: '<p>从你选择的大洲出发，向世界传播。</p><div class="tutorial-colors"><span><i class="tutorial-green"></i>支持你</span><span><i class="tutorial-yellow"></i>观望中</span><span><i class="tutorial-red"></i>不支持</span></div><p>传播带来金币，<strong>点击地图上的金币领取。</strong></p>',
    scene: `<svg viewBox="0 0 320 116" aria-hidden="true"><path d="M25 71h51l22-24h43l20 24h120" fill="none" stroke="#617d3d" stroke-width="2" stroke-dasharray="4 6"/><g fill="#384b26"><path d="M15 64h18V53h18v11h18v18H51v10H33V82H15Z"/><path d="M237 63h18V52h27v11h18v20h-18v12h-27V83h-18Z"/></g><rect class="tutorial-travel" x="25" y="66" width="10" height="10" fill="#b7f55b"/><g class="tutorial-demo-coin" transform="translate(113 24)"><path d="M8 0h24v5h6v6h5v25h-5v6h-6v5H8v-5H2v-6h-5V11h5V5h6Z" fill="#f4d477" stroke="#a7782b" stroke-width="3"/><path d="M12 10h15v26H12Z" fill="#d6a947" stroke="#fff0b8" stroke-width="3"/></g><g class="tutorial-coin-click" transform="translate(145 55)">${TUTORIAL_CURSOR}</g><g class="tutorial-coin-received"><rect x="224" y="10" width="68" height="34" fill="#292411" stroke="#b18a3e"/><text x="258" y="33" text-anchor="middle" fill="#ffe09a">+6 金币</text></g><text x="132" y="106" text-anchor="middle" fill="#c2cdb8">点击领取</text></svg>`,
  },
  {
    title: '一边传播，一边搜证', region: '资源与行动',
    targets: ['aside > .time-controls', '#wallet', '#upgrades', '.research-control'],
    copy: '<p><strong>行动点随时间增加</strong>，用来提升传播、说服和防守。</p><p>金币攒够后，点击<strong>「寻找证据」</strong>，选一条线索。</p>',
    scene: `<svg viewBox="0 0 320 116" aria-hidden="true"><g transform="translate(17 15)" stroke="#b7f55b" stroke-width="3" fill="none"><path d="M6 0h22v5h6v24h-6v5H6v-5H0V5h6Z"/><path class="tutorial-clock-hand" d="M17 6v12h10"/></g><text x="34" y="77" text-anchor="middle">时间</text><path d="M70 31h34m-7-7 7 7-7 7" stroke="#6c8849" fill="none" stroke-width="2"/><rect x="118" y="11" width="76" height="42" fill="#223416" stroke="#6c8849"/><text x="156" y="39" text-anchor="middle" fill="#b7f55b">行动点 +</text><path d="M207 31h31m-7-7 7 7-7 7" stroke="#6c8849" fill="none" stroke-width="2"/><g class="tutorial-upgrade-bars" fill="#b7f55b"><rect x="253" y="36" width="11" height="17"/><rect x="271" y="25" width="11" height="28"/><rect x="289" y="11" width="11" height="42"/></g><text x="277" y="77" text-anchor="middle">升级</text><path d="M106 94h108" stroke="#e5be64" stroke-width="2" stroke-dasharray="3 5"/><text x="95" y="101" text-anchor="end" fill="#e5be64">金币</text><text x="225" y="101" fill="#e5be64">搜证</text></svg>`,
  },
  {
    title: '找到证据，甩出实锤', region: '公布实锤',
    targets: ['#publish-box'],
    copy: '<p>证据可以立即<strong>「甩出实锤」</strong>，也可以「收入囊中」，再从这里公布。</p><p>每次公布，都会引来<strong class="tutorial-danger">更强一波反扑。</strong></p>',
    scene: `<svg viewBox="0 0 320 116" aria-hidden="true"><g transform="translate(36 10)"><path d="M0 0h105v88H0Z" fill="#dbe2c5" stroke="#82916c" stroke-width="2"/><text x="13" y="25" fill="#303d26">证据报告</text><path d="M13 38h76m-76 10h76m-76 10h52m-52 10h64" stroke="#9eab88" stroke-width="4" stroke-dasharray="8 3"/><g class="tutorial-stamp" transform="translate(59 51) rotate(-12)"><rect x="-27" y="-17" width="60" height="32" fill="#dbe2c5e0" stroke="#a64b38" stroke-width="3"/><text x="3" y="6" text-anchor="middle" fill="#a64b38" style="font-size:24px">实锤</text></g></g><path d="M158 49h34m-7-7 7 7-7 7" stroke="#9f7643" fill="none" stroke-width="2"/><g class="tutorial-retaliation"><path d="M222 16h57v6h6v51h-6v6h-57v-6h-6V22h6Z" fill="#2b1812" stroke="#ee776d" stroke-width="2"/><path d="M237 32h9v9h-9zm20 0h9v9h-9zm-20 20h29v7h-29z" fill="#ee776d"/><text x="251" y="104" text-anchor="middle" fill="#eea595">公司反扑</text></g></svg>`,
  },
  {
    title: '反扑来了，在这里回应', region: '调查现场',
    targets: ['#field-feed'],
    copy: '<p>世界新闻、搜证过程都留在这里，<strong>向上滚动就能回看。</strong></p><p>遭遇反扑时，在<strong>置顶消息里发起澄清</strong>，稳住支持者。</p>',
    scene: `<svg viewBox="0 0 320 116" aria-hidden="true"><rect x="21" y="8" width="278" height="100" fill="#0e160b" stroke="#465a34"/><path d="M23 37h274" stroke="#465a34"/><text x="35" y="28" fill="#e5be64">置顶 · 正在遭遇反扑</text><g class="tutorial-clarify"><rect x="34" y="48" width="100" height="33" fill="#b7f55b"/><text x="84" y="70" fill="#17200f" text-anchor="middle">发起澄清</text></g><path d="M152 65h105" stroke="#293e1c" stroke-width="7"/><path class="tutorial-clarify-fill" d="M152 65h105" stroke="#b7f55b" stroke-width="7"/><g class="tutorial-clarify-cursor" transform="translate(114 61)">${TUTORIAL_CURSOR}</g><path d="M35 94h110m18 0h69" stroke="#486036" stroke-width="3" stroke-dasharray="4 4"/></svg>`,
  },
  {
    title: '让世界站到你这边', region: '传播进度',
    targets: ['.match-hud'],
    copy: '<p>支持率达到<strong>99%</strong>，你就赢下这场传播之战。</p><p>支持者流失殆尽、传播网络瓦解，则行动失败。</p>',
    scene: `<svg viewBox="0 0 320 116" aria-hidden="true"><text x="19" y="29" fill="#c3d3af">支持核查</text><text class="tutorial-victory-number" x="300" y="32" fill="#b7f55b" text-anchor="end" style="font-size:32px">99%</text><rect x="20" y="45" width="280" height="20" fill="#663e3a"/><rect x="20" y="45" width="230" height="20" fill="#e5be64"/><rect class="tutorial-world-support" x="20" y="45" width="277" height="20" fill="#b7f55b"/><path d="M48 45v20m28-20v20m28-20v20m28-20v20m28-20v20m28-20v20m28-20v20m28-20v20m28-20v20" stroke="#192210"/><path d="M297 39v32" stroke="#edf5dc" stroke-width="2"/><g class="tutorial-victory-label"><text x="160" y="99" text-anchor="middle" fill="#b7f55b">证据 → 公布 → 澄清 → 赢得支持</text></g></svg>`,
  },
];

// 使用实际区域的位置，避免为不同桌面尺寸维护多套坐标。
export function tutorialLayout({target, viewport, card = {}, step = 0}) {
  const vw = viewport.width, vh = viewport.height, margin = 18, gap = 20;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const left = target.left ?? target.x ?? 0, top = target.top ?? target.y ?? 0;
  const right = target.right ?? left + target.width, bottom = target.bottom ?? top + target.height;
  const focusLeft = clamp(left - 7, 5, vw - 5), focusTop = clamp(top - 7, 5, vh - 5);
  const focusRight = clamp(right + 7, focusLeft, vw - 5), focusBottom = clamp(bottom + 7, focusTop, vh - 5);
  const spotlight = {x: focusLeft, y: focusTop, width: focusRight - focusLeft, height: focusBottom - focusTop};
  let width = Math.min(card.width || 400, vw - margin * 2);
  // 地图占满主区域，首步借用右侧栏放说明，保留大陆与传播路线的全貌。
  if (step === 0) width = Math.min(width, Math.max(328, vw - right - margin - 16));
  const height = Math.min(card.height || 420, vh - margin * 2);
  let x, y;
  if (step === 0) {
    x = vw - width - margin;
    y = top + (bottom - top - height) / 2;
  } else if (step === 1 || step === 2) {
    x = focusLeft - width - gap;
    y = step === 1 ? focusTop + 30 : focusBottom - height;
  } else if (step === 3) {
    x = focusRight + gap;
    y = focusTop + (spotlight.height - height) / 2;
  } else {
    x = focusLeft + (spotlight.width - width) / 2;
    y = focusBottom + gap;
  }
  return {
    spotlight,
    card: {x: clamp(x, margin, vw - width - margin), y: clamp(y, margin, vh - height - margin), width, height},
  };
}

export function createTutorial({onOpen = () => {}, onClose = () => {}, onStep = () => {}} = {}) {
  let step = 0, active = false, remembered = false, frame = 0, previousFocus, asideScroll = 0;
  const dialog = document.createElement('dialog');
  dialog.id = 'tutorial-dialog';
  dialog.className = 'tutorial-dialog';
  dialog.setAttribute('aria-labelledby', 'tutorial-title');
  dialog.setAttribute('aria-describedby', 'tutorial-copy');
  dialog.innerHTML = `<div class="tutorial-spotlight" aria-hidden="true"><span class="tutorial-region"></span><i></i><i></i><i></i><i></i></div><section class="tutorial-card"><header class="tutorial-header"><span>Ⅱ 战局已暂停</span><button type="button" class="tutorial-skip">跳过引导 ×</button></header><div class="tutorial-position"><span class="tutorial-count"></span><div class="tutorial-progress" aria-hidden="true">${TUTORIAL_STEPS.map(() => '<i></i>').join('')}</div></div><h2 id="tutorial-title"></h2><div id="tutorial-copy" class="tutorial-copy"></div><div class="tutorial-scene" aria-hidden="true"></div><footer class="tutorial-controls"><button type="button" class="tutorial-back">← 上一步</button><button type="button" class="tutorial-next">下一步 →</button></footer></section><span class="sr-only tutorial-announcement" role="status" aria-live="polite"></span>`;
  document.body.append(dialog);
  const select = selector => dialog.querySelector(selector);
  const focusFrame = select('.tutorial-spotlight'), panel = select('.tutorial-card');
  const nextButton = select('.tutorial-next'), backButton = select('.tutorial-back');
  const aside = document.querySelector('main > aside');
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(queueLayout) : null;

  function shouldAutoStart() {
    if (remembered) return false;
    try { return localStorage.getItem(TUTORIAL_SEEN_KEY) !== 'done'; } catch { return true; }
  }
  function targetBounds() {
    const rects = TUTORIAL_STEPS[step].targets.map(selector => document.querySelector(selector))
      .filter(element => element && element.getClientRects().length)
      .map(element => element.getBoundingClientRect());
    if (!rects.length) return {left: 24, top: 100, right: innerWidth - 24, bottom: innerHeight - 24};
    let left = Math.min(...rects.map(rect => rect.left)), top = Math.min(...rects.map(rect => rect.top));
    let right = Math.max(...rects.map(rect => rect.right)), bottom = Math.max(...rects.map(rect => rect.bottom));
    if ((step === 1 || step === 2) && aside) {
      const boundary = aside.getBoundingClientRect();
      left = Math.max(left, boundary.left + 2); right = Math.min(right, boundary.right - 2);
      top = Math.max(top, boundary.top + 2); bottom = Math.min(bottom, boundary.bottom - 2);
    }
    return {left, top, right, bottom};
  }
  function layout() {
    frame = 0;
    if (!active) return;
    const target = targetBounds(), viewport = {width: innerWidth, height: innerHeight};
    let placement = tutorialLayout({target, viewport, card: {width: 400}, step});
    panel.style.width = `${placement.card.width}px`;
    const height = panel.getBoundingClientRect().height;
    placement = tutorialLayout({target, viewport, card: {width: 400, height}, step});
    const setBox = (element, box, size = true) => {
      element.style.left = `${Math.round(box.x)}px`; element.style.top = `${Math.round(box.y)}px`;
      if (size) { element.style.width = `${Math.round(box.width)}px`; element.style.height = `${Math.round(box.height)}px`; }
    };
    setBox(focusFrame, placement.spotlight);
    setBox(panel, placement.card, false);
    dialog.classList.add('tutorial-ready');
  }
  function queueLayout() {
    if (active && !frame) frame = requestAnimationFrame(layout);
  }
  function showStep(index) {
    step = Math.max(0, Math.min(index, TUTORIAL_STEPS.length - 1));
    dialog.dataset.step = String(step);
    if (aside && (step === 1 || step === 2)) aside.scrollTop = step === 1 ? 0 : aside.scrollHeight;
    onStep(step);
    const definition = TUTORIAL_STEPS[step];
    select('#tutorial-title').textContent = definition.title;
    select('#tutorial-copy').innerHTML = definition.copy;
    select('.tutorial-region').textContent = definition.region;
    select('.tutorial-scene').innerHTML = definition.scene;
    select('.tutorial-count').textContent = `${String(step + 1).padStart(2, '0')} / 05`;
    select('.tutorial-announcement').textContent = `第 ${step + 1} 步，共 5 步。${definition.title}`;
    select('.tutorial-progress').querySelectorAll('i').forEach((node, index) => {
      node.classList.toggle('complete', index < step); node.classList.toggle('current', index === step);
    });
    backButton.disabled = step === 0;
    nextButton.textContent = step === TUTORIAL_STEPS.length - 1 ? '开始行动 →' : '下一步 →';
    if (document.activeElement === backButton && backButton.disabled) nextButton.focus({preventScroll: true});
    layout();
    queueLayout();
  }
  function start() {
    if (active) { showStep(0); nextButton.focus({preventScroll: true}); return; }
    previousFocus = document.activeElement;
    asideScroll = aside?.scrollTop || 0;
    active = true;
    dialog.showModal();
    onOpen();
    showStep(0);
    for (const selector of TUTORIAL_STEPS.flatMap(item => item.targets)) {
      const element = document.querySelector(selector);
      if (element) resizeObserver?.observe(element);
    }
    nextButton.focus({preventScroll: true});
  }
  function close({remember = true} = {}) {
    if (!active) return;
    active = false;
    cancelAnimationFrame(frame); frame = 0;
    resizeObserver?.disconnect();
    if (remember) {
      remembered = true;
      try { localStorage.setItem(TUTORIAL_SEEN_KEY, 'done'); } catch { /* 本次会话仍记住完成状态。 */ }
    }
    dialog.close();
    dialog.classList.remove('tutorial-ready');
    if (aside) aside.scrollTop = asideScroll;
    onClose();
    if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({preventScroll: true});
  }
  nextButton.addEventListener('click', () => step === TUTORIAL_STEPS.length - 1 ? close() : showStep(step + 1));
  backButton.addEventListener('click', () => showStep(step - 1));
  select('.tutorial-skip').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (active) close(); });
  dialog.addEventListener('keydown', event => {
    // 引导使用自己的按键，避免传入底层战局快捷键。
    event.stopPropagation();
    if (event.key === 'ArrowRight') { event.preventDefault(); if (step < TUTORIAL_STEPS.length - 1) showStep(step + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); if (step > 0) showStep(step - 1); }
  });
  window.addEventListener('resize', queueLayout);
  window.addEventListener('scroll', queueLayout, true);
  return {start, close, isOpen: () => active && dialog.open, shouldAutoStart};
}
