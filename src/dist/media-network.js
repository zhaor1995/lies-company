// 六洲各有熟悉的传播载体，但没有独占线路。主场权重是游戏节奏参数，
// 不是市场占有率；单一媒体也不代表整洲所有人的使用习惯。
export const CHANNELS = Object.freeze([
  { id: 'press', name: '报纸', short: '报', color: '#d6bc85', travelTime: 11 },
  { id: 'green', name: '小绿书', short: '绿', color: '#8fcfa9', travelTime: 8,
    prototype: '小红书', description: '图文笔记接力，跨圈交流。', sourceTitle: '小红书：生活兴趣社区', sourceUrl: 'https://www.xiaohongshu.com/' },
  { id: 'facecook', name: 'FaceCook', short: 'F', color: '#82b5ef', travelTime: 8 },
  { id: 'x', name: 'Z', short: 'Z', color: '#b7cee3', travelTime: 6 },
  { id: 'weibo', name: '围脖', short: '围', color: '#e5a28a', travelTime: 7 },
  { id: 'readit', name: 'ReadIt', short: 'R', color: '#e9a477', travelTime: 7,
    prototype: 'Reddit', description: '社区热帖，版友接力讨论。', sourceTitle: 'Reddit：2025 年年报（美国与国际用户）', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1713445/000171344526000062/redditinc10-k2025.pdf' },
  { id: 'whatsgua', name: 'Whats瓜', short: '瓜', color: '#a7d98a', travelTime: 7,
    prototype: 'WhatsApp', description: '亲友群转发，从聊天传到聊天。', sourceTitle: 'WhatsApp：巴西、哥伦比亚等地的服务', sourceUrl: 'https://about.fb.com/news/2022/11/find-and-buy-from-businesses-on-whatsapp/' },
  { id: 'telegram', name: '电饭报', short: '电', color: '#87cadc', travelTime: 7,
    prototype: 'Telegram', description: '频道消息，订阅者跨群转发。', sourceTitle: 'Telegram：欧洲服务与公开频道说明', sourceUrl: 'https://telegram.org/tos/eu-dsa' },
  { id: 'africanow', name: 'AfricaNow', short: '非', color: '#dcbd71', travelTime: 10,
    prototype: 'Africanews', description: '泛非新闻，英法双语报道。', sourceTitle: 'Africanews：关于我们与覆盖地区', sourceUrl: 'https://www.africanews.com/page/about/' },
  { id: 'absee', name: 'ABSee', short: 'A', color: '#c7b9e7', travelTime: 10,
    prototype: '澳大利亚 ABC', description: '广播与新闻，远洋接力。', sourceTitle: 'ABC：澳大利亚广播公司介绍', sourceUrl: 'https://www.abc.net.au/about' },
].map(Object.freeze));

export const REGION_PRIMARY_MEDIA = Object.freeze({
  north_america: 'readit', south_america: 'whatsgua', europe: 'telegram',
  africa: 'africanow', asia: 'green', oceania: 'absee',
});

// 每行合计 100。公共平台保留存在感，小平台也始终可能跨洲转载。
export const REGION_MEDIA_WEIGHTS = Object.freeze({
  north_america: Object.freeze({ press: 10, green: 5, facecook: 17, x: 18, weibo: 1, readit: 36, whatsgua: 5, telegram: 4, africanow: 1, absee: 3 }),
  south_america: Object.freeze({ press: 10, green: 2, facecook: 23, x: 12, weibo: 1, readit: 4, whatsgua: 39, telegram: 5, africanow: 2, absee: 2 }),
  europe: Object.freeze({ press: 12, green: 2, facecook: 16, x: 13, weibo: 1, readit: 7, whatsgua: 9, telegram: 35, africanow: 3, absee: 2 }),
  africa: Object.freeze({ press: 10, green: 1, facecook: 20, x: 8, weibo: 1, readit: 2, whatsgua: 16, telegram: 5, africanow: 36, absee: 1 }),
  asia: Object.freeze({ press: 6, green: 42, facecook: 6, x: 5, weibo: 30, readit: 2, whatsgua: 3, telegram: 4, africanow: 1, absee: 1 }),
  oceania: Object.freeze({ press: 10, green: 3, facecook: 19, x: 12, weibo: 1, readit: 9, whatsgua: 4, telegram: 3, africanow: 1, absee: 38 }),
});
