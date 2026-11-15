/**
 * A self-contained, pre-verified demonstration scenario.
 * Nothing in this module makes a network or Yuanbao API request.
 * Source pages were checked on 2026-10-22; game effects are fictional.
 */
export const CASE = {
  id: 'great-wall-moon',
  title: '长城，月球与一张照片',
  claim: '从月球上，能用肉眼看见长城。',
  truth: '从月球上无法用肉眼看见长城。空间站的长焦照片不能证明这一说法。',
  description: '传澄清、收金币、挖证据，再择机公布实锤。风向转过来的那一刻，谎言公司也会开始反击。',
  label: '内置关卡 01',
  searchLabel: '云元宝搜索',
  opponentNote: '敌方官方截图是本关编写的模拟伪证，不是现实中的已知传播事件。',
  disclaimer: '联网版调用云元宝搜索；离线演示使用预置资料。搜索摘要可打开原文核对，不自动判定真假；人口、传播与反扑均为游戏模拟。',
  sourceNote: '开局基础反证来自 NASA；联网调查保存当次搜索来源，离线调查使用 NASA 与 ESA 预置资料。搜证成长及能力加成属于游戏设定。',
  verifiedAt: '2026-10-22',
  initialEvidence: {
    id: 'initial-answer',
    title: '已核实：月球肉眼不可见',
    summary: 'NASA 的地月问答明确指出：无法从月球用肉眼看见长城。',
    sourceIds: ['nasa-moon-answer'],
    detail: '问题限定了“从月球”和“用肉眼”。本局只核验这个具体说法，不把“从任何太空位置都看不见任何人造物”当作结论。',
  },
  briefing: [
    { title: '铺开传播', detail: '选择起点，让澄清自动扩散。行动点用于升级；点地图金币收取流量收益，花金币搜证。' },
    { title: '公布实锤', detail: '查到新证据就能免费公布，让积累的受众转为支持。每份实锤都会引来更强的一波反扑。' },
    { title: '顶住反扑', detail: '谎言公司会封锁传播、夺回人群。发起澄清、稳住阵地，支持率达到 99% 就立即获胜。' },
  ],
  sources: [
    {
      id: 'nasa-moon-answer',
      title: 'See Great Wall from the Moon?',
      organization: 'NASA · Cosmicopia',
      url: 'https://science.gsfc.nasa.gov/attic/cosmicopia.gsfc.nasa.gov/qa_earth.html',
      summary: '第 99 个问答直接回答：从月球无法用肉眼看见长城。',
    },
    {
      id: 'nasa-wall-photo',
      title: 'Great Wall',
      organization: 'NASA',
      url: 'https://www.nasa.gov/image-article/great-wall/',
      summary: '长城照片由国际空间站上的 Leroy Chiao 拍摄；原文说明使用了高倍率镜头，并否定月球肉眼可见的说法。',
    },
    {
      id: 'nasa-night-lights',
      title: 'City lights of Rio De Janeiro, Brazil',
      organization: 'NASA',
      url: 'https://www.nasa.gov/image-article/city-lights-of-rio-de-janeiro-brazil/',
      summary: '这是一张从国际空间站拍摄的里约热内卢夜景，不是从月球观察长城的记录。',
    },
    {
      id: 'nasa-moon-distance',
      title: 'Moon Facts · Size and Distance',
      organization: 'NASA Science',
      url: 'https://science.nasa.gov/moon/facts/',
      summary: '月球与地球的平均距离约为 384,400 千米。',
    },
    {
      id: 'nasa-iss-facts',
      title: 'International Space Station Facts and Figures',
      organization: 'NASA',
      url: 'https://www.nasa.gov/international-space-station/space-station-facts-and-figures/',
      summary: '国际空间站处于近地轨道，距离地面为数百千米量级；它的观测条件不能等同于月面。',
    },
  ],
};

export const MOCK_SEARCH_STEPS = [
  '检索公开资料',
  '追溯原始来源',
  '比对观测条件',
  '整理证据链',
];

export const BASE_SEARCH_RESULT = {
  mode: 'built-in-mock',
  label: '内置模拟结果 · 非实时检索',
  query: CASE.claim,
  verdict: '该说法不成立',
  summary: CASE.truth,
  sourceIds: CASE.initialEvidence.sourceIds,
};

export function getSourceById(id) {
  return CASE.sources.find((source) => source.id === id);
}
