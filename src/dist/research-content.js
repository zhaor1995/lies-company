// Hand-checked source excerpts for the built-in case, not live search results.
// Mechanics live in engine.js; a historical meme is never evidence for the case.
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const RESEARCH_DISCLAIMER = '离线演示 · 本地模拟：以下为预置问题与已核对资料，不调用实时搜索；联网版本使用当次元宝搜索返回的材料。';

export const RESEARCH_SOURCES = freeze({
  'nasa-photo': {
    title: 'Great Wall',
    organization: 'NASA',
    url: 'https://www.nasa.gov/image-article/great-wall/',
    summary: 'NASA 2009 年发布的图文说明：照片由 Leroy Chiao 在国际空间站拍摄，使用高倍镜头；页面明确说从月球看不到长城。它不是月球上的肉眼观测记录。',
  },
  'nasa-answer': {
    title: 'Cosmicopia — Ask Us — Earth and Moon：See Great Wall from the Moon?',
    organization: 'NASA',
    url: 'https://science.gsfc.nasa.gov/attic/cosmicopia.gsfc.nasa.gov/qa_earth.html',
    summary: 'NASA Cosmicopia 的第 99 个问答直接回答：从月球不可能用肉眼看见长城。这和 NASA 图片说明属于同一机构，不能算成两家独立机构的验证。',
  },
  'esa-observation': {
    title: 'Great Wall of China from space',
    organization: 'ESA',
    url: 'https://www.esa.int/ESA_Multimedia/Images/2021/05/Great_Wall_of_China_from_space',
    summary: 'ESA 2021 年发布 Thomas Pesquet 的另一批空间站照片：约 400 km 高度、1150 mm 长焦，图像在地面旋转并拼接。宇航员说明定位和拍摄并不容易。这些参数只属于这批照片，不能套到 Leroy Chiao 的照片上。',
  },
  'nasa-photo-faq': {
    title: 'Gateway to Astronaut Photography — Frequently Asked Questions',
    organization: 'NASA',
    url: 'https://eol.jsc.nasa.gov/FAQ/',
    summary: 'NASA 摄影资料库说明长焦会缩小视野、放大细节，并建议保留照片的唯一编号以便追溯原件。这些说明不能替代具体照片的观测记录。',
  },
  'nasa-contrast': {
    title: 'December Puzzler Answer',
    organization: 'NASA',
    url: 'https://science.nasa.gov/blogs/earth-matters/2012/12/24/december-puzzler-answer/',
    summary: 'NASA 2012 年解释：长城与周边植被对比不足；文中的 2001 年 ASTER 卫星图像借助低太阳角度和薄雪突出墙体。这是卫星传感器图像，不是宇航员的肉眼视野。',
  },
  'nasa-observers': {
    title: 'Interesting Fact of the Month 2020 — Great Wall',
    organization: 'NASA',
    url: 'https://www.nasa.gov/space-science-and-astrobiology-at-ames/interesting-fact-of-the-month-current/interesting-fact-of-the-month-2020/',
    summary: 'NASA 回顾长城观测：墙体与地表颜色、纹理接近；Leroy Chiao 拍下照片却表示自己没有看见长城；阿波罗 12 号宇航员 Alan Bean 的月球观测描述也不支持月球肉眼可见人造物。',
  },
  'nasa-moon-distance': {
    title: 'Moon Facts — Size and Distance',
    organization: 'NASA',
    url: 'https://science.nasa.gov/moon/facts/',
    summary: 'NASA 给出的地月平均距离约为 384,400 km，可帮助区分月球与近地轨道。距离差提供背景，不能单独代替完整的肉眼分辨率论证。',
  },
});

export const RESEARCH_MEMES = freeze({
  'main-character-style': {
    title: '显眼包',
    sourceTitle: '央视新闻：“汉语盘点2023”发布年度十大网络用语（2023-12-20）',
    sourceUrl: 'https://news.cctv.cn/2023/12/20/ARTIdiL3N6DaFWHPkCV2btGi231220.shtml',
    summary: '“显眼包”入选 2023 年度十大网络用语。本局用这一真实表达描述原图对照引来围观的场面；不声称来自某条小红书原帖。',
  },
  'read-and-misreply': {
    title: '已读乱回',
    relatedSources: [{ title: '都市快报：社交网络上的 AI 小助理“已读乱回”（2024-07-11，引语出处）', url: 'https://news.hangzhou.com.cn/jjxw/content/2024-07/11/content_8757608.htm' }],
    sourceTitle: '新榜采访，经新浪转载：对话微博 AI 幕后团队（2024-10-31）',
    sourceUrl: 'https://news.sina.com.cn/zx/2024-10-31/doc-incumwnf9717956.shtml',
    summary: '新榜采访微博 AI 团队，回顾“评论罗伯特”因已读乱回等互动引发关注。卡面引语则来自都市快报记录的微博 CEO 对博主夸赞 AI 小助理的回复。游戏借用真实现象与引语，不声称罗伯特回复过本案。',
  },
  'asked-for-proof': {
    title: '求锤得锤',
    sourceTitle: '北京大学中国语言学研究中心：现代汉语构式数据库“求+锤+得+锤”',
    sourceUrl: 'https://ccl.pku.edu.cn/ccgd/detail/2341',
    summary: '该词条记录了索要证据后得到证据的网络用法，“锤”指证据。游戏只借用这个表达，不复述或移植现实人物的绯闻。',
  },
  'smells-good': {
    title: '真香',
    sourceTitle: '新华社，经央广网转载：2018 年度网络热词（2019-01-03）',
    sourceUrl: 'https://www.cnr.cn/sxpd/ws/20190103/t20190103_524470486.shtml',
    summary: '年度热词报道记录“真香”的流行及其前后态度反转的喜剧意味。游戏把它用在虚构受众改变态度的片段中，不把梗当成证据。',
  },
});

export const RESEARCH_EVENTS = freeze({
  'source-goes-viral': {
    triggerFocus: 'spread',
    effectKey: 'spread',
    memeId: 'main-character-style',
    title: '显眼包',
    quip: '有人把原图和截图放在一起，评论区围了上来。',
    gameEffectHint: '你选的原图资料被连同出处转载，传播能力增强。',
    fictional: true,
    realityNote: '本局虚构事件。真实的是“显眼包”这一流行语；转载走红及能力增益均为游戏演绎。',
  },
  'bot-misreads': {
    triggerFocus: 'persuasion',
    effectKey: 'controversy',
    memeId: 'read-and-misreply',
    title: '已读乱回',
    quip: '“你别着急夸，过两天你就该骂了。”',
    gameEffectHint: '本局虚构账号转述错了你的解释：争议增加转载，同时削弱这份材料的一部分说服加成。',
    fictional: true,
    realityNote: '本局虚构事件，借鉴微博“评论罗伯特已读乱回”的历史现象；不是罗伯特的真实回复，也不是 NASA 资料出错。流量与加成变化为游戏设定。',
  },
  'show-the-receipts': {
    triggerFocus: 'spread',
    effectKey: 'spread',
    memeId: 'asked-for-proof',
    title: '求锤得锤',
    quip: '“证据呢？” 原文和出处一起贴上来了。',
    gameEffectHint: '你选的材料带上完整出处，核查结果被继续转载。',
    fictional: true,
    realityNote: '本局虚构评论与转载事件。“求锤得锤”有真实词条记录，材料可追溯原文；评论、传播增长均为游戏演绎。',
  },
  'changed-my-mind': {
    triggerFocus: 'persuasion',
    effectKey: 'persuasion',
    memeId: 'smells-good',
    title: '真香',
    quip: '刚才还在反驳的人，开始转发完整的拍摄说明。',
    gameEffectHint: '你补齐了观测条件，犹豫受众更容易改信真相。',
    fictional: true,
    realityNote: '本局虚构受众的态度变化，借用真实流行语“真香”；不代表某位真实人物的言行，说服增益为游戏设定。',
  },
});

export const RESEARCH_ROUNDS = freeze([
  {
    id: 'round-1',
    round: 1,
    defaultQuery: '这张长城照片能证明从月球用肉眼看见长城吗？',
    querySuggestions: [
      '这张长城照片能证明从月球用肉眼看见长城吗？',
      '这张长城照片来自哪里？',
      '原文说的是照片可见，还是肉眼可见？',
    ],
    queryAliases: ['月球上能用肉眼看到长城吗？', '长城太空照片的原始出处是什么？'],
    finding: '找到了 NASA 原图及直接问答：这是空间站上的相机照片，不是从月球用肉眼看见长城的证据。两份资料同属 NASA。',
    followupPrompt: '结论已明确。下一步找另一批观测，查清为什么能拍到，却不能说肉眼看得到。',
    materials: [
      {
        id: 'photo-spread',
        focus: 'spread',
        title: '原图找到了：空间站拍摄',
        finding: 'NASA 标明拍摄者是 Leroy Chiao，地点是国际空间站，照片使用高倍镜头。把截图和原始说明放在一起，更方便转载澄清。',
        sourceIds: ['nasa-photo'],
        nextQuestion: '另一批更清晰的长城照片是怎样拍出来的？',
        eventId: 'source-goes-viral',
      },
      {
        id: 'answer-persuasion',
        focus: 'persuasion',
        title: '直接问答：月球肉眼看不到',
        finding: 'NASA Cosmicopia 直接回答了月球肉眼观测问题，和原图说明一致。它更适合解释结论，但仍是同一机构的第二份资料。',
        sourceIds: ['nasa-answer', 'nasa-photo'],
        nextQuestion: '另一位宇航员的观测条件，能否核对第一份资料？',
        eventId: 'bot-misreads',
      },
    ],
  },
  {
    id: 'round-2',
    round: 2,
    defaultQuery: '另一批更清晰的长城照片是怎样拍出来的？',
    querySuggestions: [
      '另一批更清晰的长城照片是怎样拍出来的？',
      '另一位宇航员的观测条件，能否核对第一份资料？',
      '这些照片为什么不能代表从月球用肉眼看见长城？',
    ],
    queryAliases: ['长城照片中的相机和肉眼有什么区别？', '还有其他宇航员拍摄长城的记录吗？'],
    finding: '又找到 ESA 2021 年的另一批观测：Thomas Pesquet 从约 400 km 高的空间站使用 1150 mm 长焦拍摄，照片在地面旋转、拼接。它补齐成像条件，不是 NASA 原图的器材说明。',
    followupPrompt: '相机能拍到，还需要什么条件？接着查光线与地面背景。',
    materials: [
      {
        id: 'collage-spread',
        focus: 'spread',
        title: '清晰图背后：长焦与地面拼接',
        finding: 'ESA 说明这组照片用了 1150 mm 长焦，并在地面旋转、拼接。真实照片的清晰呈现，不能直接当作肉眼视野；拼接本身也不等于造假。',
        sourceIds: ['esa-observation'],
        nextQuestion: '长城照片里的光线和积雪，会怎样影响辨认？',
        eventId: 'show-the-receipts',
      },
      {
        id: 'conditions-persuasion',
        focus: 'persuasion',
        title: '观测者说明：知道位置才拍得到',
        finding: '同一份 ESA 记录里，Pesquet 说定位和拍摄并不容易。这是在约 400 km 高的近地轨道用相机成像；月球平均距地球约 384,400 km，地点和观察方式都不同。',
        sourceIds: ['esa-observation', 'nasa-moon-distance'],
        nextQuestion: '长城为什么容易和周围的地面混在一起？',
        eventId: 'changed-my-mind',
      },
    ],
  },
  {
    id: 'round-3', round: 3,
    defaultQuery: '长城照片里的光线和积雪，会怎样影响辨认？',
    querySuggestions: ['长城照片里的光线和积雪，会怎样影响辨认？', '长城为什么容易和周围的地面混在一起？'],
    queryAliases: [],
    finding: '找到了影响成像的新条件：低角度阳光和积雪能增强对比；墙体与地表相近的颜色、纹理则让它难以辨认。',
    followupPrompt: '照片条件查清了。下一步核对：拍照的人，自己到底有没有看见？',
    materials: [
      { id: 'contrast-spread', focus: 'spread', title: '薄雪，帮长城露了个脸',
        finding: 'NASA 介绍的 ASTER 图像借低角度阳光和薄雪突出长城。这解释了为何有时图上更明显；卫星拍得清，不等于肉眼看得见。',
        sourceIds: ['nasa-contrast'], nextQuestion: '拍下长城照片的宇航员，自己用肉眼看见了吗？', eventId: 'show-the-receipts' },
      { id: 'terrain-persuasion', focus: 'persuasion', title: '不是太短，是融进了背景',
        finding: 'NASA 的地球观测专家指出：墙体和周边地表颜色、纹理接近，辨认困难。是否可见不能只看长城有多长。',
        sourceIds: ['nasa-observers'], nextQuestion: '宇航员相机拍到的视野，和肉眼相同吗？', eventId: 'changed-my-mind' },
    ],
  },
  {
    id: 'round-4', round: 4,
    defaultQuery: '拍下长城照片的宇航员，自己用肉眼看见了吗？',
    querySuggestions: ['拍下长城照片的宇航员，自己用肉眼看见了吗？', '宇航员相机拍到的视野，和肉眼相同吗？'],
    queryAliases: [],
    finding: '拍摄者的陈述和相机说明对上了：Chiao 表示自己没看见长城；长焦照片呈现的放大视野，不能直接当作眼睛所见。',
    followupPrompt: '最后核对月球上的实际观测，并把照片原件的追溯方法留下。',
    materials: [
      { id: 'witness-spread', focus: 'spread', title: '拍到了，本人却没看见',
        finding: 'NASA 记载 Chiao 自己表示没看见长城，起初也不确定照片是否拍到了它。照片里的识别结果，和拍摄者当时的肉眼体验是两回事。',
        sourceIds: ['nasa-observers'], nextQuestion: '从月球观察地球的宇航员，对人造物可见性怎么说？', eventId: 'show-the-receipts' },
      { id: 'lens-persuasion', focus: 'persuasion', title: '长焦给照片加了放大镜',
        finding: 'NASA 摄影问答把长焦视野类比为使用望远镜：放大细节，同时缩小范围。相机的画面不能直接用来证明肉眼分辨能力。',
        sourceIds: ['nasa-photo-faq'], nextQuestion: '转发长城照片时，保留什么才能让别人找到原件？', eventId: 'changed-my-mind' },
    ],
  },
  {
    id: 'round-5', round: 5,
    defaultQuery: '从月球观察地球的宇航员，对人造物可见性怎么说？',
    querySuggestions: ['从月球观察地球的宇航员，对人造物可见性怎么说？', '转发长城照片时，保留什么才能让别人找到原件？'],
    queryAliases: [],
    finding: '月球观测者的陈述进一步核对了地点条件；照片资料库则给出可追溯办法。证据链最终指向：从月球用肉眼看见长城的说法不成立。',
    followupPrompt: '五轮材料齐了。把来源、拍摄条件和观测记录一起公布。',
    materials: [
      { id: 'trace-spread', focus: 'spread', title: '截图能裁，照片编号不能丢',
        finding: 'NASA 建议转载时附上 Mission-Roll-Frame 照片编号和资料库链接，让读者找到原件。这是追溯方法，不是又一条独立的可见性证明。',
        sourceIds: ['nasa-photo-faq'], nextQuestion: null, eventId: 'show-the-receipts' },
      { id: 'moon-witness-persuasion', focus: 'persuasion', title: '月球上的观测，也对不上传闻',
        finding: 'NASA 引述阿波罗 12 号宇航员 Alan Bean：从月球看到的是地球的整体色块，在这个尺度看不到人造物。这补上了月球观察者的实际陈述。',
        sourceIds: ['nasa-observers'], nextQuestion: null, eventId: 'changed-my-mind' },
    ],
  },
]);
