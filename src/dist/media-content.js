import { worldDuration, worldRemaining } from './world-time.js';

// Historical references supply the joke, not live news or claims about this
// match. Durations and benefits below describe the game's simulated events.
export const MEDIA_STORIES = Object.freeze({
  migration: Object.freeze({
    title: '新来的朋友，先交猫税',
    quip: '猫照先交，正事也顺便聊明白。',
    effect: `${worldDuration(45)}内，小绿书在亚洲与北美之间的转载机会增加。`,
    historyLabel: '历史彩蛋 · 2025-01-14',
    history: 'AP 曾报道美国 TikTok 用户涌入小红书，友好交流中出现了交猫照的玩笑。本局借这个历史片段增加跨区往来，时间与增益均为游戏设定。',
    sourceTitle: 'AP：美国 TikTok 用户涌入小红书（2025-01-14）',
    sourceUrl: 'https://apnews.com/article/c7f440803128ef50f0ade44d16068f01',
    tone: 'success',
  }),
  notes: Object.freeze({
    title: '主帖很自信，补充说明来了',
    quip: '评论区先别吵，出处贴在这里了。',
    effect: `${worldDuration(40)}内出发的 Z 转载，成功落地时新增受众 ×1.5。`,
    historyLabel: '机制彩蛋 · X 社区附注',
    history: 'X 社区附注由贡献者撰写和评级，需要以往观点不同的贡献者认可其有用性。这里只借鉴补充语境的机制；本局证据加成为游戏演绎，不表示本案在现实中获得过社区附注或官方核查。',
    sourceTitle: 'X 社区附注官方机制说明',
    sourceUrl: 'https://communitynotes.x.com/guide/en/about/introduction',
    tone: 'success',
  }),
  outage: Object.freeze({
    title: '不是你家 Wi-Fi 的问题',
    quip: '亲友群突然安静，大家先别重启路由器。',
    effect: `FaceCook 暂停新转载${worldRemaining(24)}；在途内容继续行程，其他媒体照常运行。`,
    historyLabel: '历史彩蛋 · 2021-10-04',
    history: `Meta 在 2021 年 10 月 4 日说明，骨干路由器的配置变更导致数据中心通信中断，服务随后恢复。本局只用这一历史故障作彩蛋，停运${worldRemaining(24)}是游戏设定。`,
    sourceTitle: 'Meta 工程团队：10 月 4 日故障说明（2021）',
    sourceUrl: 'https://engineering.fb.com/2021/10/04/networking-traffic/outage/',
    tone: 'warning',
  }),
});

// Routine traffic carries no invented joke; sourced memes appear as events.
export const MEDIA_FLAVOR = Object.freeze({
  press: Object.freeze({ verb: '刊出报道', quip: '' }),
  green: Object.freeze({ verb: '分享图文笔记', quip: '' }),
  weibo: Object.freeze({ verb: '转发话题', quip: '' }),
  facecook: Object.freeze({ verb: '转进亲友群', quip: '' }),
  x: Object.freeze({ verb: '转发热帖', quip: '' }),
  readit: Object.freeze({ verb: '顶起社区热帖', quip: '' }),
  whatsgua: Object.freeze({ verb: '转进聊天群', quip: '' }),
  telegram: Object.freeze({ verb: '推送频道消息', quip: '' }),
  africanow: Object.freeze({ verb: '播出双语报道', quip: '' }),
  absee: Object.freeze({ verb: '播出新闻', quip: '' }),
});
