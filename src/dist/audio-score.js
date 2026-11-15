// 交互音效乐谱；背景音乐使用独立的原曲录音。
const tone = (at, duration, voice, note, gain, slide = 0) =>
  ({ at, duration, voice, note, gain, ...(slide ? { slide } : {}) });

const sound = (description, notes, options = {}) => ({
  kind: 'sfx',
  priority: 2,
  cooldown: .06,
  duck: .04,
  duration: Math.max(...notes.map(note => note.at + note.duration)),
  notes,
  description,
  ...options,
});

// 高频交互短而轻；信息、危险、成就各有独立语汇，避免按钮全部唱上行琶音。
export const SOUND_PROGRAMS = {
  hover: sound('轻触光标', [tone(0, .032, 'triangle', 74, .09)],
    { priority: 0, cooldown: .085, duck: 0 }),
  click: sound('按键落点', [tone(0, .045, 'pulse', 74, .22, -2)],
    { priority: 1, duck: 0 }),
  select: sound('选定目标', [tone(0, .045, 'pulse', 69, .19), tone(.055, .075, 'pulse', 74, .23)],
    { priority: 1, duck: 0 }),
  type: sound('打字机轻击', [tone(0, .018, 'noise', 68, .065), tone(0, .025, 'triangle', 50, .08)],
    { priority: 0, cooldown: .075, duck: 0 }),
  page: sound('纸页轻翻', [tone(0, .09, 'noise', 62, .11, -7), tone(.035, .06, 'triangle', 69, .11, -2)],
    { priority: 1, cooldown: .12, duck: 0 }),
  open: sound('档案展开', [tone(0, .09, 'triangle', 62, .19, 7), tone(.07, .07, 'pulse', 69, .13)],
    { priority: 1, duck: 0 }),
  close: sound('档案合上', [tone(0, .09, 'triangle', 69, .16, -7), tone(.055, .03, 'noise', 50, .09)],
    { priority: 1, duck: 0 }),
  start: sound('侦探出发，短促行动信号', [
    tone(0, .11, 'pulse', 74, .26), tone(.14, .085, 'pulse', 69, .22),
    tone(.28, .09, 'pulse', 72, .25), tone(.42, .34, 'pulse', 74, .3),
    tone(.42, .3, 'triangle', 38, .36),
  ], { kind: 'jingle', priority: 6, cooldown: 1, duck: .4 }),
  coin: sound('金币清脆双响', [tone(0, .045, 'pulse', 81, .25), tone(.06, .135, 'triangle', 86, .33)],
    { priority: 3, cooldown: .065, duck: .02 }),
  jackpot: sound('奖金跳动落袋', [
    tone(0, .07, 'pulse', 74, .25), tone(.1, .07, 'pulse', 77, .26),
    tone(.2, .07, 'pulse', 74, .25), tone(.33, .09, 'pulse', 81, .27),
    tone(.47, .24, 'triangle', 86, .34), tone(.47, .23, 'triangle', 50, .25),
  ], { kind: 'jingle', priority: 5, cooldown: .6, duck: .22 }),
  upgrade: sound('能力就位，短促装填后确认', [
    tone(0, .04, 'noise', 50, .12), tone(.065, .055, 'pulse', 69, .21),
    tone(.14, .055, 'pulse', 72, .2), tone(.215, .055, 'pulse', 69, .2),
    tone(.3, .19, 'pulse', 74, .28), tone(.3, .16, 'triangle', 50, .29),
  ], { priority: 8, cooldown: .2, duck: .15 }),
  defense: sound('护盾张开，低频托住威胁', [
    tone(0, .27, 'triangle', 50, .35, 12), tone(.025, .055, 'noise', 57, .17),
    tone(.19, .19, 'pulse', 69, .18), tone(.26, .15, 'triangle', 74, .21),
  ], { priority: 8, cooldown: .3, duck: .2 }),
  search: sound('雷达两次探测', [tone(0, .13, 'triangle', 81, .24), tone(.21, .12, 'triangle', 81, .15)],
    { priority: 2, cooldown: 1.5, duck: .02 }),
  progress: sound('调查有进展，低声确认', [tone(0, .075, 'triangle', 69, .17), tone(.12, .13, 'triangle', 74, .2)],
    { priority: 2, cooldown: 1.5, duck: .02 }),
  evidence: sound('找到线索，悬念得到回应', [
    tone(0, .1, 'triangle', 73, .24), tone(.13, .12, 'pulse', 74, .24),
    tone(.29, .23, 'triangle', 81, .31),
  ], { priority: 4, cooldown: .3, duck: .14 }),
  store: sound('证据卡落入档案', [
    tone(0, .04, 'noise', 50, .14), tone(.025, .11, 'triangle', 50, .29),
    tone(.14, .09, 'pulse', 62, .2),
  ], { priority: 3, cooldown: .15, duck: .04 }),
  publish: sound('发布前半秒蓄势', [
    tone(0, .46, 'pulse', 50, .18, 24), tone(.08, .37, 'noise', 50, .14, 12),
    tone(.12, .055, 'triangle', 57, .2), tone(.25, .055, 'triangle', 62, .24),
    tone(.38, .12, 'triangle', 69, .28),
  ], { priority: 6, cooldown: .45, duck: .32 }),
  impact: sound('实锤重击', [
    tone(0, .3, 'triangle', 38, .54, -12), tone(0, .17, 'noise', 50, .29, -7),
    tone(.015, .085, 'pulse', 50, .3, -12),
  ], { priority: 9, cooldown: .2, duck: .44 }),
  counter: sound('主动澄清，坚定的回应向外传播', [
    tone(0, .11, 'triangle', 50, .33), tone(.025, .055, 'noise', 50, .13),
    tone(.12, .1, 'pulse', 74, .25), tone(.26, .2, 'pulse', 69, .23),
    tone(.29, .22, 'triangle', 74, .23),
  ], { priority: 8, cooldown: .8, duck: .2 }),
  warning: sound('危险提示，两次克制的警铃', [
    tone(0, .11, 'triangle', 69, .27), tone(.22, .13, 'triangle', 69, .25),
  ], { priority: 8, cooldown: 3, duck: .16 }),
  damage: sound('受击破音与下坠', [
    tone(0, .15, 'noise', 57, .25, -12), tone(0, .24, 'triangle', 45, .4, -12),
    tone(.025, .095, 'pulse', 62, .21, -5),
  ], { priority: 9, cooldown: .25, duck: .22 }),
  breakthrough: sound('突破防线，侦探动机昂扬回应', [
    tone(0, .11, 'pulse', 74, .28), tone(.14, .09, 'pulse', 69, .24),
    tone(.28, .1, 'pulse', 72, .26), tone(.43, .13, 'pulse', 74, .28),
    tone(.63, .3, 'pulse', 81, .32), tone(.63, .28, 'triangle', 50, .35),
  ], { kind: 'jingle', priority: 7, cooldown: 8, duck: .4 }),
  milestone: sound('调查推进，印章与确认和声', [
    tone(0, .065, 'noise', 50, .17), tone(0, .14, 'triangle', 38, .32),
    tone(.17, .13, 'pulse', 77, .24), tone(.36, .3, 'pulse', 74, .29),
    tone(.36, .29, 'triangle', 69, .21),
  ], { kind: 'jingle', priority: 6, cooldown: 6, duck: .3 }),
  win: sound('真相胜利，主题以 D 大三度明亮收束', [
    tone(0, .16, 'pulse', 74, .29), tone(.2, .13, 'pulse', 69, .24),
    tone(.4, .13, 'pulse', 72, .26), tone(.6, .28, 'pulse', 74, .3),
    tone(1, .15, 'pulse', 78, .28), tone(1.2, .16, 'pulse', 81, .28),
    tone(1.44, .84, 'pulse', 86, .3),
    tone(0, .35, 'triangle', 38, .33), tone(.6, .28, 'triangle', 45, .32),
    tone(1, .3, 'triangle', 50, .3), tone(1.44, .84, 'triangle', 50, .36),
    tone(1.44, .72, 'triangle', 66, .2),
  ], { kind: 'jingle', priority: 10, cooldown: 2.4, duck: .82 }),
  lose: sound('调查失利，主题缓慢下行但仍留悬念', [
    tone(0, .24, 'pulse', 74, .25), tone(.3, .23, 'pulse', 72, .23),
    tone(.6, .24, 'pulse', 69, .22), tone(.93, .58, 'pulse', 61, .2),
    tone(0, .45, 'triangle', 38, .3), tone(.6, .31, 'triangle', 34, .28),
    tone(.93, .58, 'triangle', 33, .28),
  ], { kind: 'jingle', priority: 10, cooldown: 1.8, duck: .8 }),
  error: sound('操作未完成，短促双低音', [tone(0, .07, 'pulse', 50, .2), tone(.1, .09, 'pulse', 49, .18)],
    { priority: 3, cooldown: .25, duck: .02 }),
  pause: sound('暂停，两阶落下', [tone(0, .07, 'triangle', 74, .21), tone(.1, .1, 'triangle', 69, .18)],
    { priority: 2, cooldown: .2, duck: 0 }),
  resume: sound('继续，两阶归位', [tone(0, .07, 'triangle', 69, .19), tone(.1, .1, 'triangle', 74, .22)],
    { priority: 2, cooldown: .2, duck: 0 }),
  speed: sound('齿轮加速，三次同音短击', [
    tone(0, .035, 'pulse', 69, .18), tone(.075, .03, 'pulse', 69, .17),
    tone(.13, .06, 'pulse', 74, .2),
  ], { priority: 2, cooldown: .15, duck: 0 }),
  copy: sound('复制，双份卡片合拍', [tone(0, .045, 'triangle', 74, .19), tone(.075, .055, 'triangle', 74, .17)],
    { priority: 2, cooldown: .15, duck: 0 }),
  download: sound('报告收妥，下降后落稳', [
    tone(0, .07, 'triangle', 81, .23), tone(.09, .07, 'triangle', 77, .21),
    tone(.18, .15, 'triangle', 74, .25), tone(.2, .08, 'noise', 45, .1),
  ], { priority: 3, cooldown: .3, duck: .05 }),
};
