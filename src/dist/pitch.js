// 品牌图形：Simple Icons（CC0），https://github.com/simple-icons/simple-icons；新闻、广播与纸媒使用类别图标。
const pitchMediaIcons = {
  "reddit": "<path d=\"M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z\"/>",
  "whatsapp": "<path d=\"M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z\"/>",
  "telegram": "<path d=\"M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z\"/>",
  "xiaohongshu": "<path d=\"M22.405 9.879c.002.016.01.02.07.019h.725a.797.797 0 0 0 .78-.972.794.794 0 0 0-.884-.618.795.795 0 0 0-.692.794c0 .101-.002.666.001.777zm-11.509 4.808c-.203.001-1.353.004-1.685.003a2.528 2.528 0 0 1-.766-.126.025.025 0 0 0-.03.014L7.7 16.127a.025.025 0 0 0 .01.032c.111.06.336.124.495.124.66.01 1.32.002 1.981 0 .01 0 .02-.006.023-.015l.712-1.545a.025.025 0 0 0-.024-.036zM.477 9.91c-.071 0-.076.002-.076.01a.834.834 0 0 0-.01.08c-.027.397-.038.495-.234 3.06-.012.24-.034.389-.135.607-.026.057-.033.042.003.112.046.092.681 1.523.787 1.74.008.015.011.02.017.02.008 0 .033-.026.047-.044.147-.187.268-.391.371-.606.306-.635.44-1.325.486-1.706.014-.11.021-.22.03-.33l.204-2.616.022-.293c.003-.029 0-.033-.03-.034zm7.203 3.757a1.427 1.427 0 0 1-.135-.607c-.004-.084-.031-.39-.235-3.06a.443.443 0 0 0-.01-.082c-.004-.011-.052-.008-.076-.008h-1.48c-.03.001-.034.005-.03.034l.021.293c.076.982.153 1.964.233 2.946.05.4.186 1.085.487 1.706.103.215.223.419.37.606.015.018.037.051.048.049.02-.003.742-1.642.804-1.765.036-.07.03-.055.003-.112zm3.861-.913h-.872a.126.126 0 0 1-.116-.178l1.178-2.625a.025.025 0 0 0-.023-.035l-1.318-.003a.148.148 0 0 1-.135-.21l.876-1.954a.025.025 0 0 0-.023-.035h-1.56c-.01 0-.02.006-.024.015l-.926 2.068c-.085.169-.314.634-.399.938a.534.534 0 0 0-.02.191.46.46 0 0 0 .23.378.981.981 0 0 0 .46.119h.59c.041 0-.688 1.482-.834 1.972a.53.53 0 0 0-.023.172.465.465 0 0 0 .23.398c.15.092.342.12.475.12l1.66-.001c.01 0 .02-.006.023-.015l.575-1.28a.025.025 0 0 0-.024-.035zm-6.93-4.937H3.1a.032.032 0 0 0-.034.033c0 1.048-.01 2.795-.01 6.829 0 .288-.269.262-.28.262h-.74c-.04.001-.044.004-.04.047.001.037.465 1.064.555 1.263.01.02.03.033.051.033.157.003.767.009.938-.014.153-.02.3-.06.438-.132.3-.156.49-.419.595-.765.052-.172.075-.353.075-.533.002-2.33 0-4.66-.007-6.991a.032.032 0 0 0-.032-.032zm11.784 6.896c0-.014-.01-.021-.024-.022h-1.465c-.048-.001-.049-.002-.05-.049v-4.66c0-.072-.005-.07.07-.07h.863c.08 0 .075.004.075-.074V8.393c0-.082.006-.076-.08-.076h-3.5c-.064 0-.075-.006-.075.073v1.445c0 .083-.006.077.08.077h.854c.075 0 .07-.004.07.07v4.624c0 .095.008.084-.085.084-.37 0-1.11-.002-1.304 0-.048.001-.06.03-.06.03l-.697 1.519s-.014.025-.008.036c.006.01.013.008.058.008 1.748.003 3.495.002 5.243.002.03-.001.034-.006.035-.033v-1.539zm4.177-3.43c0 .013-.007.023-.02.024-.346.006-.692.004-1.037.004-.014-.002-.022-.01-.022-.024-.005-.434-.007-.869-.01-1.303 0-.072-.006-.071.07-.07l.733-.003c.041 0 .081.002.12.015.093.025.16.107.165.204.006.431.002 1.153.001 1.153zm2.67.244a1.953 1.953 0 0 0-.883-.222h-.18c-.04-.001-.04-.003-.042-.04V10.21c0-.132-.007-.263-.025-.394a1.823 1.823 0 0 0-.153-.53 1.533 1.533 0 0 0-.677-.71 2.167 2.167 0 0 0-1-.258c-.153-.003-.567 0-.72 0-.07 0-.068.004-.068-.065V7.76c0-.031-.01-.041-.046-.039H17.93s-.016 0-.023.007c-.006.006-.008.012-.008.023v.546c-.008.036-.057.015-.082.022h-.95c-.022.002-.028.008-.03.032v1.481c0 .09-.004.082.082.082h.913c.082 0 .072.128.072.128V11.19s.003.117-.06.117h-1.482c-.068 0-.06.082-.06.082v1.445s-.01.068.064.068h1.457c.082 0 .076-.006.076.079v3.225c0 .088-.007.081.082.081h1.43c.09 0 .082.007.082-.08v-3.27c0-.029.006-.035.033-.035l2.323-.003c.098 0 .191.02.28.061a.46.46 0 0 1 .274.407c.008.395.003.79.003 1.185 0 .259-.107.367-.33.367h-1.218c-.023.002-.029.008-.028.033.184.437.374.871.57 1.303a.045.045 0 0 0 .04.026c.17.005.34.002.51.003.15-.002.517.004.666-.01a2.03 2.03 0 0 0 .408-.075c.59-.18.975-.698.976-1.313v-1.981c0-.128-.01-.254-.034-.38 0 .078-.029-.641-.724-.998z\"/>",
  "sinaweibo": "<path d=\"M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.737 5.439l-.002.004zM9.05 17.219c-.384.616-1.208.884-1.829.602-.612-.279-.793-.991-.406-1.593.379-.595 1.176-.861 1.793-.601.622.263.82.972.442 1.592zm1.27-1.627c-.141.237-.449.353-.689.253-.236-.09-.313-.361-.177-.586.138-.227.436-.346.672-.24.239.09.315.36.18.601l.014-.028zm.176-2.719c-1.893-.493-4.033.45-4.857 2.118-.836 1.704-.026 3.591 1.886 4.21 1.983.64 4.318-.341 5.132-2.179.8-1.793-.201-3.642-2.161-4.149zm7.563-1.224c-.346-.105-.57-.18-.405-.615.375-.977.42-1.804 0-2.404-.781-1.112-2.915-1.053-5.364-.03 0 0-.766.331-.571-.271.376-1.217.315-2.224-.27-2.809-1.338-1.337-4.869.045-7.888 3.08C1.309 10.87 0 13.273 0 15.348c0 3.981 5.099 6.395 10.086 6.395 6.536 0 10.888-3.801 10.888-6.82 0-1.822-1.547-2.854-2.915-3.284v.01zm1.908-5.092c-.766-.856-1.908-1.187-2.96-.962-.436.09-.706.511-.616.932.09.42.511.691.932.602.511-.105 1.067.044 1.442.465.376.421.466.977.316 1.473-.136.406.089.856.51.992.405.119.857-.105.992-.512.33-1.021.12-2.178-.646-3.035l.03.045zm2.418-2.195c-1.576-1.757-3.905-2.419-6.054-1.968-.496.104-.812.587-.706 1.081.104.496.586.813 1.082.707 1.532-.331 3.185.15 4.296 1.383 1.112 1.246 1.429 2.943.947 4.416-.165.48.106 1.007.586 1.157.479.165.991-.104 1.157-.586.675-2.088.241-4.478-1.338-6.235l.03.045z\"/>",
  "facebook": "<path d=\"M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z\"/>",
  "x": "<path d=\"M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z\"/>",
  "news": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><ellipse cx=\"12\" cy=\"12\" rx=\"4\" ry=\"9\"/><path d=\"M3 12h18M5 6h14M5 18h14\"/></g>",
  "broadcast": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"1.7\"/><path d=\"m12 10-5 11h10l-5-11M8.2 4.2a5.4 5.4 0 0 0 0 7.6m7.6-7.6a5.4 5.4 0 0 1 0 7.6M5.4 1.4a9.3 9.3 0 0 0 0 13.2m13.2-13.2a9.3 9.3 0 0 1 0 13.2M9.4 16h5.2\"/></g>",
  "newspaper": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 3h14v16a2 2 0 0 0 4 0V7h-4M4 3v16a2 2 0 0 0 2 2h14M2 7v12a2 2 0 0 0 2 2\"/><path d=\"M7 7h7M7 15h7M7 18h7M7 10h3v2H7zM13 10h1M13 12h1\"/></g>"
};
function pitchMediaIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${pitchMediaIcons[name]}</svg>`;
}

// 路演只展示玩法示意，不读写战局或伪造调查结果。
export function createPitch({ onChange = () => {} } = {}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'pitch-dialog';
  dialog.className = 'pitch';
  dialog.setAttribute('aria-label', '谎言公司游戏介绍');
  dialog.innerHTML = `
    <div class="pitch-shell">
      <header class="pitch-header"><a class="pitch-brand" href="#intro" aria-label="回到介绍首页"><span>谎</span>谎言公司</a><div class="pitch-tools"><button data-pitch-fullscreen>全屏 ↗</button><button data-pitch-close>返回游戏 ×</button></div></header>
      <div class="pitch-viewport">
        <section class="pitch-slide pitch-cover" aria-labelledby="pitch-title-0">
          <img class="pitch-cover-art" src="./assets/intro-world.webp" alt="红色传闻笼罩谎言公司的广播高塔">
          <div class="pitch-cover-shade"></div><div class="pitch-cover-copy">
            <p class="pitch-eyebrow">一款用真实证据推进的全球策略游戏</p>
            <h1 id="pitch-title-0">谎言公司<span class="pitch-title-dot">▪</span></h1>
            <h2>让真相，<br><em>传播到全世界。</em></h2>
            <p class="pitch-cover-bottom">元宝搜索，给 Agent<br>一双<span>可溯源的眼睛。</span></p>
          </div><div class="pitch-year" aria-hidden="true">2077<br><span>传闻笼罩世界。侦探，该你出场了。</span></div>
        </section>
        <section class="pitch-slide pitch-dense pitch-world" aria-labelledby="pitch-title-1" hidden>
          <div class="pitch-heading"><p class="pitch-eyebrow">世界观与关键机制</p><h2 id="pitch-title-1">真相，也需要一张传播网络。</h2></div>
          <div class="world-premise"><strong>2077</strong><p>谎言公司靠传闻统治世界。你化身侦探，用真实证据争取支持，让核查内容从一地走向六洲。</p></div>
          <div class="world-design-line"><span>借鉴《瘟疫公司》</span><b>地区起点</b><i>→</i><b>跨区传播</b><i>→</i><b>能力进化</b><p>把全球扩散的策略，变成事实核查与舆论攻防。</p></div>
          <div class="world-diagrams">
            <section class="world-media-panel"><div class="diagram-heading"><h3>六洲 · 十种媒体</h3><span>各有主场，跨区接力</span></div>
              <div class="world-media-grid">
                <div><span>北美洲 · 社区热帖</span><strong>ReadIt</strong><p class="world-media-prototype">${pitchMediaIcon('reddit')}<span>Reddit</span></p></div><div><span>南美洲 · 亲友群转发</span><strong>Whats瓜</strong><p class="world-media-prototype">${pitchMediaIcon('whatsapp')}<span>WhatsApp</span></p></div><div><span>欧洲 · 频道接力</span><strong>电饭报</strong><p class="world-media-prototype">${pitchMediaIcon('telegram')}<span>Telegram</span></p></div>
                <div><span>非洲 · 双语新闻</span><strong>AfricaNow</strong><p class="world-media-prototype">${pitchMediaIcon('news')}<span>Africanews</span></p></div><div><span>亚洲 · 图文笔记</span><strong>小绿书</strong><p class="world-media-prototype">${pitchMediaIcon('xiaohongshu')}<span>小红书</span></p></div><div><span>大洋洲 · 广播新闻</span><strong>ABSee</strong><p class="world-media-prototype">${pitchMediaIcon('broadcast')}<span>澳大利亚 ABC</span></p></div>
              </div>
              <div class="world-media-common" aria-label="共同流动的媒体"><div><b>报纸</b><p class="world-media-prototype">${pitchMediaIcon('newspaper')}<span>传统纸媒</span></p></div><div><b>围脖</b><p class="world-media-prototype">${pitchMediaIcon('sinaweibo')}<span>微博</span></p></div><div><b>Z</b><p class="world-media-prototype">${pitchMediaIcon('x')}<span>X / Twitter</span></p></div><div><b>FaceCook</b><p class="world-media-prototype">${pitchMediaIcon('facebook')}<span>Facebook</span></p></div></div>
              <p class="world-media-rule"><strong>不同媒体，不同转载速度。</strong>转载有出发与抵达时间，落地后才在当地扩散。</p>
            </section>
            <section class="world-conversion-panel"><div class="diagram-heading"><h3>看见，不等于相信</h3><span>传播 × 说服 × 防守</span></div>
              <div class="population-flow"><div class="population-red"><b>未接受</b><span>未接触或已回流</span></div><div class="population-arrow"><b>传播</b><i>→</i><span>扩大触达</span></div><div class="population-yellow"><b>观望</b><span>已经听过</span></div><div class="population-arrow"><b>说服</b><i>→</i><span>证据转化</span></div><div class="population-green"><b>支持</b><span>愿意继续传播</span></div></div>
              <div class="population-backflow"><i>←</i><p><strong>谎言反扑：支持流失、转载受阻</strong><br>防守升级与主动澄清，减少损失、加快化解。</p></div>
              <div class="world-upgrades"><div><b>传播进化</b><p>易转发 → 跨圈层 → 多语</p></div><div><b>说服进化</b><p>一句话澄清 → 证据可视化</p></div></div>
              <div class="world-goal"><span>胜利目标</span><strong>99%</strong><p>模拟人群支持核查<br>打破谎言公司的统治</p></div>
            </section>
          </div>
          <div class="world-memes"><div class="meme-intro"><h3>梗，真的会<br>改变战局。</h3><p>现实网络现象 → 游戏事件</p></div><div><span>显眼包</span><p>原图对照引来围观<br><b>传播能力增强</b></p></div><div class="meme-risk"><span>已读乱回</span><p>争议带来更多转载<br><b>该材料的说服加成受损</b></p></div><div><span>真香</span><p>补齐条件，让观望者改观<br><b>说服能力增强</b></p></div></div>
        </section>
        <section class="pitch-slide pitch-dense pitch-journey-page" aria-labelledby="pitch-title-2" hidden>
          <div class="pitch-heading"><p class="pitch-eyebrow">完整游戏旅程</p><h2 id="pitch-title-2">查清一条传闻，打赢一场传播战。</h2></div>
          <div class="journey-entry"><span>从这里开始</span><strong>输入一句想查证的传闻</strong><i>→</i><strong>选择起点地区</strong><p>一局约 10 分钟，查证与经营同步推进。</p></div>
          <div class="journey-main" aria-label="铺网、搜证、公布与反击的循环">
            <article><span class="journey-number">01</span><h3>铺开传播网</h3><p>媒体自动转载，触达更多地区。<br>升级传播、说服与防守，<br>点击地图金币筹集调查经费。</p><div class="journey-result">更多触达 → 更多搜证机会</div></article>
            <article><span class="journey-number">02</span><h3>沿线找证据</h3><p>花金币，从两条方向中选一条。<br>Agent 调用元宝搜索，带回报告；<br>读发现、核对原句、打开来源。</p><div class="journey-result">等待搜证时，仍可经营地图</div></article>
            <article><span class="journey-number">03</span><h3>决定何时公布</h3><p>公布：转化观望者，激活加成，<br>同时引来新一波反扑。<br>暂存：先铺开传播，再择机出手。</p><div class="journey-result">每份证据免费公布一次</div></article>
            <article><span class="journey-number">04</span><h3>反击，继续追查</h3><p>用行动点发起澄清，防守减损。<br>澄清中公布新证据，推进化解；<br>击破反扑，抓住反攻窗口。</p><div class="journey-result">公布后，沿新线索进入下一轮</div></article>
          </div>
          <div class="journey-return"><span>↶</span><p><strong>传播赚经费 → 经费找证据 → 证据改变战局 → 沿线继续追问</strong><br>最多五轮搜证；前四轮的调查发现，都会生成下一轮的两条线索。</p></div>
          <div class="journey-bottom"><section class="journey-economy"><h3>两种资源，两种决策</h3><div><span class="resource-coin">金币</span><p>实际传播产出，点击收取</p><i>→</i><b>搜证</b></div><div><span class="resource-action">行动点</span><p>随时间积累，化解反扑可获奖励</p><i>→</i><b>升级 / 澄清</b></div></section><section class="journey-waves"><div class="diagram-heading"><h3>每公布一份证据，攻势再升级</h3><span>最多五波</span></div><ol><li><i></i><b>截图围攻</b></li><li><i></i><b>断章取义</b></li><li><i></i><b>热搜围堵</b></li><li><i></i><b>全网封锁</b></li><li><i></i><b>终局反扑</b></li></ol></section></div>
          <div class="journey-finish"><strong>99% 支持 → 传播胜利 → 证据复核 → 结案战报</strong><p>游戏胜负看传播结果，传闻真假仍由证据判断。</p></div>
        </section>
        <section class="pitch-slide pitch-dense pitch-evidence" aria-labelledby="pitch-title-3" hidden>
          <div class="pitch-heading"><p class="pitch-eyebrow">主 Agent · 证据链判断</p><h2 id="pitch-title-3">查的是反例，判断仍由证据决定。</h2></div>
          <div class="agent-memory"><span>↶ 调查上下文</span><p>原始观点 <i>＋</i> 可检验的判据 <i>＋</i> 历轮材料与引文 <i>＋</i> 尚未解决的关键缺口</p><b>计划随证据修正</b></div>
          <div class="agent-pipeline" aria-label="制定判据、玩家选路、元宝检索、证据重排、引文验收、更新证据链">
            <article><span>01 · 主 Agent</span><h3>制定判据</h3><p>保留主体与适用范围<br>明确量词与反证目标</p><div>什么事实能推翻原话？</div></article>
            <article><span>02 · 玩家决策</span><h3>选择路径</h3><p>一条检验核心条件<br>一条追查间接关联</p><div>不标优劣，玩家自己选</div></article>
            <article class="agent-search-node"><span>03 · 元宝搜索</span><h3>实时检索</h3><p>SearchPro 查找反证<br>返回网页与原文片段</p><div>标题 / 日期 / URL</div></article>
            <article><span>04 · 主 Agent</span><h3>证据重排</h3><p>逐条评估来源的作用<br>从最高可用等级选材</p><div>反驳、支持都如实保留</div></article>
            <article class="agent-verify-node"><span>05 · 服务端校验</span><h3>引文验收</h3><p>按引句编号回填原文<br>逐字核对出处与链接</p><div>拒绝无新发现的重复材料</div></article>
            <article><span>06 · 主 Agent</span><h3>更新证据链</h3><p>核对对象、范围、时间<br>交付一份材料供公布</p><div>前四轮生成下一轮线索</div></article>
          </div>
          <div class="agent-loops"><div class="agent-search-loop"><span>06 → 01｜沿关键缺口继续追问</span><p>只追会影响结论的缺口；未搜到不等于不存在。</p></div><div class="agent-repair-loop"><span>定向补查 · 校验修复</span><p>每轮最多 2 次检索、4 次研判与修复；最终失败退款，不消耗轮次。</p></div></div>
          <div class="agent-outputs"><section><div class="diagram-heading"><h3>证据怎样排序？</h3><span>弱反例不能压过强支持</span></div><dl class="agent-criteria"><div><dt>关联度</dt><dd>是否直接检验本轮关键条件？</dd></div><div><dt>证明力</dt><dd>原始性、独立性与适用范围如何？</dd></div><div><dt>材料关系</dt><dd>反驳 / 限制 / 支持 / 背景 / 不明</dd></div></dl><p>来源名气 ≠ 证明力　·　同稿转载 ≠ 独立验证</p></section><section><div class="diagram-heading"><h3>结案时，独立复核一次</h3><span>只审实际公布的材料</span></div><p class="agent-audit-flow">服务端取回原文 <i>→</i> 引用依据 <i>→</i> 核对决定性判据</p><div class="agent-verdicts"><b>足以反驳</b><b>支持原观点</b><b>条件或冲突</b><b>证据不足</b></div><p>保留相反上下文；支持率、调查轮数不能代替证明。</p></section></div>
          <div class="agent-guard"><p>证伪是任务，不是预设结论。</p><b>可信、适用的反例，足以推翻绝对断言。</b></div>
        </section>
        <section class="pitch-slide pitch-demo" aria-labelledby="pitch-title-4" hidden>
          <div class="pitch-demo-copy"><p class="pitch-eyebrow">进入真实战局</p><h2 id="pitch-title-4">这一次，<br>让证据<span>上场。</span></h2><div class="pitch-demo-steps"><span>查原文</span><i>→</i><span>甩实锤</span><i>→</i><span>看世界改变</span></div><button class="pitch-launch" data-pitch-demo>进入游戏演示 <span>↗</span></button></div><div class="pitch-demo-visual"><img src="./assets/intro-rumor.webp" alt="被同一句传闻包围的城市人群"><div class="pitch-demo-question"><span>你一定也听过——</span><p>“从月球上，<br>能用肉眼看见长城。”</p><b>真的？</b></div></div>
        </section>
        <section class="pitch-slide pitch-dense pitch-outcomes" aria-labelledby="pitch-title-5" hidden>
          <div class="pitch-heading"><p class="pitch-eyebrow">双结局 · 同一场胜利，两种答案</p><h2 id="pitch-title-5">世界相信了你。然后呢？</h2></div>
          <div class="outcomes-gate"><strong>99%</strong><p>模拟人群已相信：<b>原始观点是一个谎言。</b></p><span>终局复核完成 <i>→</i> 揭晓两种尾声</span></div>
          <div class="outcomes-pair">
            <article class="outcome-truth"><div class="outcome-art"><img src="./assets/cinematic/ending-truth.png" alt="侦探与市民共同核对公开档案，城市迎来晨光"><span>已公布证据，足以反驳原观点</span></div><div class="outcome-copy"><h3>真相战胜谎言。</h3><p>证据支持你传播的反驳。<br>广播塔熄灭，人们有了可以自己核对的理由。</p><b>你终结了这场谎言的传播。</b></div></article>
            <article class="outcome-dragon"><div class="outcome-art"><img src="./assets/cinematic/ending-new-company.png" alt="侦探接管广播控制台，红色广播重新覆盖城市"><span>证据不足、仍有条件或冲突，或支持原观点</span></div><div class="outcome-copy"><h3>屠龙勇者终成龙。</h3><p>世界接受的确定结论，超过了证据能证明的范围。<br>你接管了广播塔，新的谎言公司诞生。</p><b>你赢得了信任，却没有证明自己的反驳。</b></div></article>
          </div>
          <div class="outcomes-meaning"><h3>赢得信任之后，更要对结论负责。</h3><p>途中不显示真相分数，结局留到最后揭晓。<br>未能证伪，并不等于原观点为真。</p></div>
        </section>
        <section class="pitch-slide pitch-ending" aria-labelledby="pitch-title-6" hidden>
          <img class="pitch-ending-art" src="./assets/intro-detective.webp" alt="侦探迎向绿色曙光，走向谎言公司的高塔"><div class="pitch-ending-shade"></div><div class="pitch-ending-copy"><p class="pitch-eyebrow">把证据带出游戏</p><h2 id="pitch-title-6">让更多人<br><span>了解真相，<br>也传播真相。</span></h2><p class="pitch-ending-line">不止一个人的侦探游戏。<br>是用事实，改变世界。</p></div><div class="pitch-next"><span>从一局游戏，到一次分享</span><p>已有：带出处的调查战报<br>下一步：让分享卡也能一键查原文</p></div>
        </section>
      </div>
      <footer class="pitch-footer"><nav aria-label="介绍章节">${['出场','世界','旅程','证据','演示','结局','之后'].map((name,index)=>`<button data-pitch-page="${index}" aria-label="第 ${index+1} 页：${name}"><span>0${index+1}</span>${name}</button>`).join('')}</nav><div class="pitch-paging"><span data-pitch-count aria-live="polite">01 / 07</span><button data-pitch-prev aria-label="上一页，左方向键">←</button><button data-pitch-next aria-label="下一页，右方向键">→</button></div></footer>
    </div>`;
  document.body.append(dialog);
  const get = selector => dialog.querySelector(selector);
  const slides = [...dialog.querySelectorAll('.pitch-slide')];
  const demoReturnPage = slides.findIndex(slide => slide.classList.contains('pitch-outcomes'));
  let page = 0, demo = false, opener = null;
  const returnButtons = [];
  function show(index) {
    const next = Math.max(0, Math.min(slides.length - 1, index));
    // Keep keyboard focus out of the slide being hidden.
    if (slides[page].contains(document.activeElement)) get('[data-pitch-next]').focus({preventScroll:true});
    page = next;
    slides.forEach((slide, index) => { slide.hidden = index !== page; });
    dialog.querySelectorAll('[data-pitch-page]').forEach((button,index) => { button.setAttribute('aria-current',index===page?'step':'false'); });
    get('[data-pitch-count]').textContent = `0${page+1} / ${String(slides.length).padStart(2,'0')}`;
    get('[data-pitch-prev]').disabled = page === 0;
    get('[data-pitch-next]').disabled = page === slides.length-1;
  }
  function setDemo(active) { demo = active; returnButtons.forEach(button => {button.hidden = !active;}); }
  function open(index) {
    if (dialog.open) { if (Number.isInteger(index)) show(index); return; }
    opener = document.activeElement;
    if (demo) { setDemo(false); show(demoReturnPage); } else if (Number.isInteger(index)) show(index);
    dialog.showModal(); document.body.classList.add('pitch-open'); onChange(true);
    get('[data-pitch-next]').focus({preventScroll:true});
  }
  function close(forDemo = false) {
    setDemo(forDemo); dialog.close(); document.body.classList.remove('pitch-open'); onChange(false);
    if (opener?.isConnected && !opener.closest('#pitch-dialog')) opener.focus({preventScroll:true});
  }
  async function fullscreen() {
    try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { get('[data-pitch-fullscreen]').textContent = '请用浏览器全屏'; }
  }
  document.addEventListener('fullscreenchange',()=>{get('[data-pitch-fullscreen]').textContent=document.fullscreenElement?'退出全屏 ↙':'全屏 ↗';});
  get('.pitch-brand').addEventListener('click',event=>{event.preventDefault();show(0);});
  get('[data-pitch-close]').addEventListener('click',()=>close());
  get('[data-pitch-demo]').addEventListener('click',()=>close(true));
  get('[data-pitch-fullscreen]').addEventListener('click',fullscreen);
  get('[data-pitch-prev]').addEventListener('click',()=>show(page-1));
  get('[data-pitch-next]').addEventListener('click',()=>show(page+1));
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open){document.body.classList.remove('pitch-open');onChange(false);}});
  document.querySelectorAll('[data-open-pitch]').forEach(button=>button.addEventListener('click',()=>open()));
  // Native dialogs occupy the top layer: give each one an accessible way back.
  for (const host of [document.body, ...document.querySelectorAll('dialog:not(#pitch-dialog)')]) {
    const button = document.createElement('button'); button.className='pitch-return'; button.hidden=true; button.textContent='继续路演 →';
    button.addEventListener('click',()=>open(demoReturnPage)); host.append(button); returnButtons.push(button);
  }
  dialog.querySelectorAll('[data-pitch-page]').forEach(button=>button.addEventListener('click',()=>show(Number(button.dataset.pitchPage))));
  document.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,[contenteditable="true"]'))return;
    if(!dialog.open){if(demo&&event.key.toLowerCase()==='p'){event.preventDefault();event.stopImmediatePropagation();open(demoReturnPage);}return;}
    if(['ArrowRight','PageDown','ArrowLeft','PageUp','Home','End','f','F'].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
      if(['ArrowRight','PageDown'].includes(event.key))show(page+1);
      else if(['ArrowLeft','PageUp'].includes(event.key))show(page-1);
      else if(event.key==='Home')show(0);else if(event.key==='End')show(slides.length-1);else fullscreen();
    }
  },true);
  show(0);
  window.addEventListener('hashchange',()=>{if(location.hash==='#intro')open(0);});
  return {open, isOpen:()=>dialog.open};
}
