import { REGIONS, CHANNELS, REGION_MEDIA_WEIGHTS, REGION_PRIMARY_MEDIA, getCampaignStatus, getCounterStatus, getMediaEvent, getPacing, UPGRADE_DEFS, RULES, createGame, tick, buyUpgrade, getTransports, startResearch, publishEvidence, getPublishPreview, getStats, getResearchStatus, getSelectedEvidence, counterWithSource, getEvidenceBonuses, getEvidenceEvent, upgradeCost, collectCoin, getCoinEconomy, getEvidenceMaterial, completeLiveResearch, failLiveResearch, setInvestigationPlan, failInvestigationPlan, startLeadRefresh, completeLeadRefresh, failLeadRefresh, startFinalReview, completeFinalReview, failFinalReview } from './engine.js';
import { getMaterialEffect, getCaseEnding, ASSESSMENT_LABELS } from './investigation-contract.js';
import { buildCaseReport, downloadCaseReport, caseReportText } from './case-report.js';
import { CASE, MOCK_SEARCH_STEPS, getSourceById } from './content.js';
import { RESEARCH_ROUNDS, RESEARCH_SOURCES, RESEARCH_MEMES, RESEARCH_EVENTS } from './research-content.js';
import { getJourney } from './journey.js';
import { createFieldFeed, syncFieldFeed, addFieldMessage, updateFieldInvestigation, getInvestigationFlow } from './field-feed.js';
import { MEDIA_STORIES, MEDIA_FLAVOR } from './media-content.js';
import { WORLD } from './assets/world.js';
import { worldTime, worldDuration, worldRemaining, WORLD_SECONDS_PER_HOUR, WORLD_SECONDS_PER_DAY } from './world-time.js';
import { orderPopulationPixels, populationPixelCounts } from './map-pixels.js';
import { createGameAudio } from './game-audio.js';
import { createPitch } from './pitch.js';
import { createTutorial } from './tutorial.js';

function newUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const $ = id => document.getElementById(id);
const gameAudio = createGameAudio();
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const locs = {north_america:[210,169],south_america:[350,330],europe:[530,135],africa:[540,277],asia:[746,170],oceania:[860,375]};
const endingImages={truth:'./assets/cinematic/ending-truth.png','new-company':'./assets/cinematic/ending-new-company.png',defeat:'./assets/intro-world.webp',unreviewed:'./assets/intro-detective.webp'};
const upgradeNames = {spread:'提升传播',persuasion:'增强说服',defense:'稳住阵地'};
const claimPresets = [
  ['Claude Code中国公司','Claude Code 是一家中国公司。'],
  ['DeepSeek最贵','DeepSeek 是价格最贵的模型。'],
  ['雪碧曼妥思胃爆炸','雪碧 + 曼妥思喝下去会胃爆炸。'],
  ['登月是摄影棚拍的','登月是假的，在摄影棚拍的。'],
  ['AI只会复制粘贴','大语言模型只会复制粘贴训练数据，不能生成新的内容。'],
  ['参数多就一定强','大模型的参数越多，在所有任务上的表现就一定越好。'],
  ['AI联网就不瞎编','只要让 AI 联网搜索，它就不会再编造事实。'],
  ['月球看长城','从月球上，能用肉眼看见长城。'],
  ['金鱼记忆7秒','金鱼的记忆只有7秒。'],
  ['闪电不劈同一处','闪电不会击中同一个地方两次。'],
  ['玻璃会流动','玻璃是会缓慢流动的液体。'],
  ['变色龙只为伪装','变色龙变色只是为了伪装。'],
  ['太空没有重力','太空里完全没有重力。'],
  ['纸最多折7次','一张纸最多只能对折7次。'],
  ['金星一天比一年长','金星上的一天比一年长。'],
];
let game = null, selectedRegion = 'europe', speed = 2, manualPaused = false, firstMovePending = false, guided = true;
let lastFrame = performance.now(), lastDraw = 0, celebrationUntil = 0, resultShown = false, detailType = '', detailResultId = null, detailPauseBeforeOpen = null;
let seenLog = 0, seenResults = 0, researchSeen = false, shownFirstResult = false, enemyIntros = new Set();
let enemyNotice = null, publicationScene = null;
let victoryPresentation = null, finalReviewRequest = null, endingScene = null;
let lastAction = null, intent = null, currentJourney = null, previousJourney = null, activeFeedback = null;
let feedbackQueue = [], receipts = [], interrupts = [], seenClues = new Set(), regionContacts = new Set(), freedRegions = new Set();
let truthMilestones = new Set(), affordability = new Map(), caches = new Map(), timers = new Set();
let publicationSnapshot = null, recoveryAnnounced = false, largestHit = 0;
let seenTransportEvent = 0, firstTruthSent = false, watchedTripId = null, transportNotice = null, lastBlockNotice = -Infinity, feedbackClock = 0;
let lastMediaEventId = null, mediaEnding = null, lastPacingStage = 'opening';
let researchSeenRound = 0, lastEvidenceEventId = null, lastConversionFeedback = -Infinity;
const uiResearchRound = id => RESEARCH_ROUNDS.find(round => round.id === id);
const liveSearch = location.protocol !== 'file:';
let liveRequest = null, planRequest = null, leadRefreshRequest = null, planRequestId = null, activeReport = null;
const cancelledInvestigationSessions = new WeakMap();
let presetDirection = 1, presetPosition = 0, presetHoldUntil = 0;
let pendingStart = null, cinematicPage = 0, cinematicElapsed = 0, cinematicPlaying = true;
let fieldFeed=createFieldFeed(),fieldFollowing=true,fieldSequence=0;
const fieldNodes=new Map(),fieldUnread=new Set();
let fieldCollapsed=false,fieldHeight=null,fieldDrag=null,fieldSavedReading=null,fieldScrollFrame=0;
let tutorialFieldState=null;
const tutorial=createTutorial({
  onOpen(){
    finishFieldResize();
    tutorialFieldState={collapsed:fieldCollapsed,reading:fieldCollapsed?fieldSavedReading:captureFieldReading(),savedReading:fieldSavedReading,following:fieldFollowing};
    lastFrame=performance.now();gameAudio.emit('open');
  },
  onStep(index){
    const collapsed=index===3?false:tutorialFieldState.collapsed;
    if(fieldCollapsed!==collapsed)toggleFieldHistory();
    layoutFieldFeed();
  },
  onClose(){
    if(tutorialFieldState){
      if(fieldCollapsed!==tutorialFieldState.collapsed)toggleFieldHistory();
      fieldFollowing=tutorialFieldState.following;
      fieldSavedReading=tutorialFieldState.savedReading;
      restoreFieldReading(tutorialFieldState.reading);tutorialFieldState=null;
    }
    lastFrame=performance.now();gameAudio.emit('close');render();
  },
});
const isAgentGame = state => Boolean(state?.investigation);
const isVictorySettling = (state=game) => Boolean(state?.phase==='won'&&state.research);
const uiEvidenceMaterial = id => getEvidenceMaterial(game,id);
const uiSafeSourceUrl = value => {try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const sourceDate = value => value ? String(value).slice(0,10) : '';
const excerpt = (value,max=90) => {const words=Array.from(String(value||''));let width=0,index=0;for(;index<words.length;index++){width+=words[index].charCodeAt(0)<128?1:2;if(width>max*2)break;}return words.slice(0,index).join('')+(index<words.length?'…':'');};
function cancelLiveRequest() {
  if(leadRefreshRequest)failLeadRefresh(leadRefreshRequest.state,leadRefreshRequest.requestId,'换题已取消。');
  for(const request of [liveRequest,leadRefreshRequest])if(request){clearTimeout(request.timer);clearTimeout(request.progressTimer);request.progressController?.abort();request.controller.abort();}
  // Let an abandoned plan return its session ID so it can be closed. Its original deadline still applies.
  liveRequest=null;planRequest=null;leadRefreshRequest=null;
}
async function cancelInvestigationSession(state,sessionId=state?.investigation?.sessionId) {
  if(!state||!sessionId)return;
  if(!cancelledInvestigationSessions.has(state))cancelledInvestigationSessions.set(state,new Set());
  const cancelled=cancelledInvestigationSessions.get(state);
  if(cancelled.has(sessionId))return;
  cancelled.add(sessionId);
  try{
    const response=await fetch('/api/investigation/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Lie-Company':'research'},body:JSON.stringify({requestId:newUuid(),sessionId}),keepalive:true});
    if(!response.ok)cancelled.delete(sessionId);
  }catch{cancelled.delete(sessionId);}
}
const uiPercent = value => `${Math.round(value * 100)}%`;
const uiEvidenceEffect = material => material?.id === 'collage-spread' ? `真相转载成功落地时，让当地 ${uiPercent(RULES.evidenceArrivalConversion)} 的观望者转为相信。` : '';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const regionName = id => REGIONS.find(region=>region.id===id)?.name || id;
const channelName = id => CHANNELS.find(channel=>channel.id===id)?.name || id;
const mapPixelRegions = new Map();
const mediaHabit = id => Object.entries(REGION_MEDIA_WEIGHTS[id]).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([key])=>channelName(key)).join(' · ');
function routeCurve(from,to,offset=0) {
  const [x,y]=locs[from],[xx,yy]=locs[to];
  return {x,y,xx,yy,cx:(x+xx)/2,cy:Math.min(y,yy)-Math.abs(xx-x)*.15-18-offset};
}
function routePath(curve) {return `M${curve.x},${curve.y} Q${curve.cx},${curve.cy} ${curve.xx},${curve.yy}`;}

function later(fn, ms) { const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer; }
function setHTML(id, html) { if(caches.get(id)!==html){caches.set(id,html);$(id).innerHTML=html;} }
function text(id, value) { if($(id).textContent!==String(value))$(id).textContent=value; }
function isPaused() { return tutorial.isOpen() || document.hidden || $('pitch-dialog')?.open || $('sound-dialog').open || $('leaderboard-dialog').open || manualPaused || $('detail-dialog').open || $('intro-dialog').open || $('cinematic-dialog').open || $('ending-dialog').open || $('result-dialog').open || $('publication-dialog').open || performance.now()<celebrationUntil; }
function animate(element, name, duration=1000) { if(!element)return;element.classList.remove(name);void element.offsetWidth;element.classList.add(name);later(()=>element.classList.remove(name),duration); }
function chooseSpeed(value) { if(speed!==value)gameAudio.emit('speed');speed=value;document.querySelectorAll('[data-speed]').forEach(button=>{button.classList.toggle('active',Number(button.dataset.speed)===speed);button.setAttribute('aria-pressed',String(Number(button.dataset.speed)===speed));}); }
function updateAudioScene() {
  const scene=tutorial.isOpen()||$('pitch-dialog')?.open?'reading':publicationScene?'publication':game?.phase==='won'?'won':game?.phase==='lost'?'lost':$('cinematic-dialog').open?'cinematic':$('intro-dialog').open?'menu':manualPaused?'paused':$('detail-dialog').open||$('sound-dialog').open||$('leaderboard-dialog').open?'reading':game?.event&&!game.event.resolved?'danger':'investigation';
  gameAudio.setScene(scene);
}
function renderSoundSettings() {
  const settings=gameAudio.getSettings();
  for(const key of ['music','sfx']){const value=Math.round(settings[key]*100);$('sound-'+key).value=value;$('sound-'+key).style.setProperty('--volume',value+'%');$('sound-'+key+'-value').value=value+'%';}
  $('sound-mute').setAttribute('aria-pressed',String(settings.muted));text('sound-mute-label',settings.muted?'取消静音':'全部静音');
  document.querySelectorAll('[data-open-sound]').forEach(button=>button.classList.toggle('sound-muted',settings.muted));
}
function openSoundSettings() {
  renderSoundSettings();if(!$('sound-dialog').open)$('sound-dialog').showModal();lastFrame=performance.now();gameAudio.emit('open');updateAudioScene();
}
function closeSoundSettings() {
  $('sound-dialog').close();lastFrame=performance.now();gameAudio.emit('close');render();
}
function renderWorldClock(time) {
  const date=worldTime(time),node=$('world-clock'),changed=node.dateTime!==date.iso;
  const [year,month,day]=date.date.split('.').map(Number);
  text('clock-date',`${year} 年 ${month} 月 ${day} 日`);text('clock',`${date.hour}时`);node.dateTime=date.iso;node.setAttribute('aria-label',date.label);
  if(changed&&game)animate($('clock'),'world-hour-tick',500);
}
function walletFeedback(amount) {
  const node=document.createElement('span');node.className=`wallet-float ${amount<0?'cost':'gain'}`;node.textContent=`${amount>0?'+':''}${amount}`;$('points-wallet').append(node);later(()=>node.remove(),1500);
}
function feedback(title, detail='', metric='', tone='success', priority=30, duration=5500, metadata={}) {
  const item={title,detail,metric,tone,priority,duration,...metadata};
  if(!activeFeedback || activeFeedback.priority<priority){activeFeedback={...item,until:feedbackClock+duration};}
  else {feedbackQueue.push(item);feedbackQueue.sort((a,b)=>b.priority-a.priority);feedbackQueue=feedbackQueue.slice(0,3);}
}
function renderFeedback(now) {
  if(activeFeedback&&now>activeFeedback.until&&!$('detail-dialog').open){const next=feedbackQueue.shift();activeFeedback=next?{...next,until:now+next.duration}:null;}
  text('battle-message',activeFeedback?`${activeFeedback.title}。${activeFeedback.metric}。${activeFeedback.detail}`:'');
}

function fieldActionMarkup(action) {
  if(!action)return '';
  if(action.type==='mediaStory')return `<button data-media-story="${esc(action.id)}">看看这个梗 ↗</button>`;
  if(action.type==='evidenceStory')return `<button data-evidence-story="${esc(action.id)}">看看这个梗 ↗</button>`;
  if(action.type==='research-result'&&game?.researchResults.some(result=>result.roundId===action.roundId))return `<button data-feed-report="${esc(action.roundId)}">查看这轮证据 ↗</button>`;
  return '';
}
function fieldEntryMarkup(entry) {
  const source=entry.source||(entry.kind==='investigation'?'调查员':entry.kind==='event'?'现场事件':'行动记录');
  const avatar=entry.kind==='investigation'?'查':entry.kind==='event'?'!':source.includes('流量')?'币':source.includes('传播')?'转':'侦';
  const date=worldTime(entry.time);
  const meta=`<div class="field-meta"><span class="field-avatar" aria-hidden="true">${avatar}</span><span>${esc(source)}</span><time datetime="${date.iso}" title="${date.label}">${date.shortDate} · ${date.hour}时</time></div>`;
  const action=fieldActionMarkup(entry.action);
  if(entry.kind==='investigation'){
    if(entry.demo){
      const progress=entry.status==='completed'?100:Math.round((entry.progress||0)*100);
      return `${meta}<h3>${esc(entry.title)}</h3><p>${esc(entry.query)}</p><div class="field-demo-progress"><span>核对预置资料</span><b>${progress}%</b><i style="--progress:${progress}%"></i></div>${entry.status==='completed'?`<p class="field-finding">${esc(entry.detail)}</p>`:''}${action?`<div class="field-action">${action}</div>`:''}`;
    }
    const flow=getInvestigationFlow(entry);
    const phases=flow.nodes.slice(1).map((node,i)=>`<span class="${node.state==='done'?'done':node.state==='active'?'active':node.state==='failed'?'failed':''}">${node.state==='done'?'✓ ':node.state==='failed'?'! ':''}${['检索','判定','报告'][i]}</span>`).join('');
    const steps=(entry.steps||[]).map(step=>`<li><strong>${esc(step.title)}</strong>${step.detail?`<span>${esc(step.detail)}</span>`:''}</li>`).join('');
    return `${meta}<h3>${esc(entry.title)}</h3>${entry.query?`<p>${esc(entry.query)}</p>`:''}<div class="field-phases" aria-label="调查步骤">${phases}</div><ol class="field-steps">${steps||'<li><strong>调查已提交，等待检索开始</strong></li>'}</ol>${entry.detail&&entry.status!=='running'?`<p class="field-finding">${esc(entry.detail)}</p>`:''}<div class="field-action"><button data-investigation-progress="${esc(entry.requestId)}">${entry.status==='running'?'查看调查进度':'回看调查过程'} ↗</button>${action}</div>`;
  }
  return `${meta}<h3>${esc(entry.title)}</h3>${entry.quip?`<p class="field-quip">${esc(entry.quip)}</p>`:''}${entry.detail?`<p>${esc(entry.detail)}</p>`:''}${entry.metric?`<strong class="field-metric">${esc(entry.metric)}</strong>`:''}${action||Number.isFinite(entry.endsAt)?`<div class="field-event-footer"><span data-event-status></span>${action}</div>`:''}`;
}
function fieldAtBottom() {const box=$('field-history');return box.scrollHeight-box.scrollTop-box.clientHeight<18;}
function captureFieldReading() {
  const box=$('field-history'),top=box.getBoundingClientRect().top;
  const node=fieldFollowing?null:[...$('field-messages').children].find(item=>item.getBoundingClientRect().bottom>top);
  return {node,offset:node?node.getBoundingClientRect().top-top:0,top:box.scrollTop};
}
function restoreFieldReading(reading) {
  const box=$('field-history');
  // 布局变化引起的 scroll 不是玩家主动翻页，不能改变是否跟随最新消息。
  cancelAnimationFrame(fieldScrollFrame);
  fieldScrollFrame=requestAnimationFrame(()=>{fieldScrollFrame=0;});
  if(fieldFollowing)box.scrollTop=box.scrollHeight;
  else if(reading?.node?.isConnected)box.scrollTop+=reading.node.getBoundingClientRect().top-box.getBoundingClientRect().top-reading.offset;
  else if(reading)box.scrollTop=reading.top;
}
function fieldHeightBounds() {
  const panel=$('field-feed'),stage=panel.parentElement;
  const max=Math.max(0,Math.floor(stage.clientHeight-parseFloat(getComputedStyle(panel).bottom)-$('transport-status').offsetHeight-10));
  const fixed=panel.querySelector('header').offsetHeight+$('field-current').offsetHeight+2;
  return {min:Math.min(max,fixed+120),max};
}
function layoutFieldFeed() {
  if(!game||fieldCollapsed)return;
  const {min,max}=fieldHeightBounds(),panel=$('field-feed'),handle=$('field-resize');
  const height=Math.round(Math.min(max,Math.max(min,fieldHeight??Math.min(440,panel.parentElement.clientHeight*.82))));
  if(panel.style.getPropertyValue('--field-height')!==`${height}px`){
    const reading=captureFieldReading();panel.style.setProperty('--field-height',`${height}px`);restoreFieldReading(reading);
  }
  handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));
  handle.setAttribute('aria-valuenow',String(height));handle.setAttribute('aria-valuetext',`${height} 像素高`);
}
function finishFieldResize(event) {
  const handle=$('field-resize'),drag=fieldDrag;fieldDrag=null;
  if(drag&&event?.type==='pointerup')gameAudio.emit('click');
  $('field-feed').classList.remove('is-resizing');document.body.classList.remove('resizing-field');
  if(drag&&handle.hasPointerCapture(drag.id))handle.releasePointerCapture(drag.id);
}
function setFieldHeight(height) {
  const {min,max}=fieldHeightBounds();fieldHeight=Math.min(max,Math.max(min,height));layoutFieldFeed();
}
function toggleFieldHistory() {
  finishFieldResize();
  if(!fieldCollapsed)fieldSavedReading=captureFieldReading();
  fieldCollapsed=!fieldCollapsed;
  $('field-feed').classList.toggle('is-collapsed',fieldCollapsed);
  $('field-history').hidden=fieldCollapsed;$('field-resize').hidden=fieldCollapsed;
  $('field-toggle').setAttribute('aria-expanded',String(!fieldCollapsed));
  $('field-toggle').setAttribute('aria-label',fieldCollapsed?'展开调查历程':'收起调查历程');
  text('field-toggle-label',fieldCollapsed?'展开':'收起');updateFieldJump();
  if(!fieldCollapsed){layoutFieldFeed();restoreFieldReading(fieldSavedReading);renderFieldFeed();}
}
function updateFieldJump() {
  const button=$('field-jump');button.hidden=fieldCollapsed||fieldFollowing;
  text('field-jump',fieldUnread.size?`${fieldUnread.size} 条新动态 · 回到最新 ↓`:'回到最新 ↓');
}
function resetFieldFeed() {
  finishFieldResize();fieldSavedReading=null;
  fieldFeed=createFieldFeed();fieldNodes.clear();fieldUnread.clear();fieldFollowing=true;fieldSequence=0;
  $('field-messages').replaceChildren();$('field-history').scrollTop=0;updateFieldJump();
}

let fieldNoticeState=null,fieldNoticeSeen=new Set(),fieldNoticeQueue=[],fieldNoticeBusy=false;
function presentFieldEvents() {
  if(fieldNoticeState!==game){fieldNoticeState=game;fieldNoticeSeen.clear();fieldNoticeQueue=[];}
  for(const entry of fieldFeed.entries){
    if(fieldNoticeSeen.has(entry.id))continue;
    fieldNoticeSeen.add(entry.id);
    // Publications, attacks and endings already have dedicated presentations.
    if(entry.kind==='event'&&['media','evidence','milestone','forgery','reinforcement'].includes(entry.eventType)){
      if(['forgery','reinforcement'].includes(entry.eventType))fieldNoticeQueue.unshift(entry);else fieldNoticeQueue.push(entry);
    }
  }
  if(fieldNoticeBusy||!fieldNoticeQueue.length||game.phase!=='playing'||isPaused()||document.hidden)return;
  const entry=fieldNoticeQueue.shift(),state=game;
  if(entry.endsAt!=null&&entry.endsAt<=game.time)return;
  fieldNoticeBusy=true;
  if(['media','evidence','reinforcement'].includes(entry.eventType))gameAudio.emit(entry.tone==='danger'||entry.tone==='warning'?'warning':'breakthrough');
  const card=document.createElement('section');card.className='field-event-notice';card.setAttribute('role','status');
  card.innerHTML=`<span>${esc(entry.source||'最新动态')}</span><h2>${esc(entry.title)}</h2>${entry.quip?`<p class="notice-quip">${esc(entry.quip)}</p>`:''}<p>${esc(entry.detail)}</p>`;
  document.body.append(card);
  const reduced=reducedMotion.matches;
  const arrival=card.animate(reduced?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(18px) scale(.94)'},{opacity:1,transform:'none'}],{duration:180,fill:'both'});
  const finish=async()=>{
    try{
      await arrival.finished;
      await new Promise(resolve=>setTimeout(resolve,1700));
      if(game!==state)return;
      const target=document.querySelector('.field-feed-heading').getBoundingClientRect(),from=card.getBoundingClientRect();
      await card.animate(reduced?[{opacity:1},{opacity:0}]:[{opacity:1,transform:'none'},{opacity:0,transform:`translate(${target.x+target.width/2-from.x-from.width/2}px,${target.y+target.height/2-from.y-from.height/2}px) scale(.12)`}],{duration:reduced?150:380,easing:'cubic-bezier(.5,0,.3,1)',fill:'forwards'}).finished;
      animate(document.querySelector('.field-feed-heading'),'just-bought',700);
    }finally{card.remove();fieldNoticeBusy=false;}
  };
  void finish();
}

function renderFieldFeed() {
  $('field-feed').hidden=!game;
  if(!game)return;
  syncFieldFeed(fieldFeed,game);
  presentFieldEvents();
  text('field-feed-state',isVictorySettling()?'胜利已锁定 · 收录中':game.phase!=='playing'?'本局结束':game.research?'正在查证':isPaused()?'暂歇片刻':`调查第 ${worldTime(game.time).day} 天`);
  // 收起时继续记录，但不重排隐藏内容；展开后一次补齐，保留原来的阅读位置。
  if(fieldCollapsed)return;
  layoutFieldFeed();
  const box=$('field-history'),container=$('field-messages');
  const reading=captureFieldReading();
  let changed=false,index=0,previousDay='';
  for(const entry of fieldFeed.entries){
    const date=worldTime(entry.time);
    if(date.date!==previousDay){
      const dayId=`day:${date.date}`;let divider=fieldNodes.get(dayId);
      if(!divider){divider=document.createElement('div');divider.className='field-day';divider.innerHTML=`<time datetime="${date.iso}">${date.date}</time><span>第 ${date.day} 天</span>`;fieldNodes.set(dayId,divider);}
      if(container.children[index]!==divider)container.insertBefore(divider,container.children[index]||null);
      index++;previousDay=date.date;
    }
    let node=fieldNodes.get(entry.id);const markup=fieldEntryMarkup(entry);
    if(!node){node=document.createElement('article');node.dataset.feedId=entry.id;fieldNodes.set(entry.id,node);}
    if(node._feedMarkup!==markup){
      node._feedMarkup=markup;node.className=`field-entry field-${entry.kind}`;node.dataset.tone=entry.tone||'neutral';node.dataset.status=entry.status||'';node.innerHTML=markup;changed=true;
      if(!fieldFollowing)fieldUnread.add(entry.id);
    }
    if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);
    index++;
    if(Number.isFinite(entry.endsAt)){
      const label=node.querySelector('[data-event-status]'),remaining=Math.max(0,entry.endsAt-game.time);
      if(label)label.textContent=game.phase!=='playing'?'本局已结束':remaining?`生效中 · 还剩${worldRemaining(remaining)}`:'效果已结束';
    }
  }
  if(changed){
    if(fieldFollowing)fieldUnread.clear();
    updateFieldJump();
    restoreFieldReading(reading);
  }else if(fieldFollowing)box.scrollTop=box.scrollHeight;
}
function fieldMessage(input) {if(game)addFieldMessage(fieldFeed,{id:`player-${++fieldSequence}`,time:game.time,kind:'message',...input});}
async function readInvestigationProgress(request,final=false) {
  if(!isAgentGame(request.state)||game!==request.state||(!final&&request.finished))return;
  try{
    const response=await fetch('/api/investigation/progress',{method:'POST',headers:{'Content-Type':'application/json','X-Lie-Company':'research'},body:JSON.stringify({sessionId:request.state.investigation.sessionId,requestId:request.requestId}),signal:AbortSignal.any([request.progressController.signal,AbortSignal.timeout(2500)])});
    const payload=await response.json();
    if(!response.ok||!payload.ok||game!==request.state||request.progressController.signal.aborted)return;
    const result=payload.result,previousSeq=request.audioProgressSeq||0;request.progress=result;
    const steps=(result.events||[]).filter(item=>item.seq>previousSeq);
    request.audioProgressSeq=Math.max(previousSeq,...steps.map(item=>item.seq));
    if(!request.finished&&steps.some(item=>['sources','analyzing','reporting'].includes(item.stage)))gameAudio.emit('progress');
    updateFieldInvestigation(fieldFeed,{requestId:request.requestId,round:request.round,roundId:request.roundId,query:request.query,time:request.gameTime,events:result.events,status:request.finished?request.finalStatus:'running'});
    renderFieldFeed();renderResearch();renderInvestigationProgress();
  }catch{/* A lost progress update must never fail or refund a valid investigation. */}
}
async function pollInvestigationProgress(request) {
  await readInvestigationProgress(request);
  if(liveRequest===request&&!request.finished&&game===request.state&&!request.progressController.signal.aborted)request.progressTimer=setTimeout(()=>pollInvestigationProgress(request),1000);
}

function pulseRegion(id, label, tone='') {
  animate(document.querySelector(`.region-label[data-region="${id}"]`),'region-pulse',2000);
  if(!label)return;
  const [x,y]=locs[id],point=new DOMPoint(x,y).matrixTransform($('world-map').getScreenCTM()),bounds=$('map-wrap').getBoundingClientRect();
  const node=document.createElement('span');node.className=`map-float ${tone}`;node.style.left=`${point.x-bounds.left}px`;node.style.top=`${point.y-bounds.top}px`;node.textContent=label;$('map-effects').append(node);later(()=>node.remove(),2500);
}

function coinWalletFeedback(amount) {
  const node=document.createElement('span');node.className=`wallet-float coin-receipt ${amount<0?'cost':''}`;node.textContent=`${amount>0?'+':''}${amount} 金币`;$('coin-wallet').append(node);later(()=>node.remove(),1300);
  animate($('coin-wallet'),'coin-collected',650);
}

function renderCoins() {
  const economy=game?getCoinEconomy(game):null,drops=game?.coinDrops||[],layer=$('coin-layer');
  text('coins-value',game?.coins||0);
  text('coin-note',economy?.allActionsFinished?'能力全满，守住风向':economy?.cashoutActive?`${economy.exchangeRate} 金币换 1 点`:economy?.savingNextRound?(economy.fundingPaused?(game.coins>=economy.fundingCap?'下轮经费已备齐':'点地图收齐下轮经费'):'为下轮攒经费'):economy?.fundingPaused?(game.research?'本轮经费已预付':game.coins>=economy.fundingCap?'本轮经费已备齐':'点地图收齐经费'):'点地图金币收取');
  for(const button of layer.querySelectorAll('[data-coin]'))if(!drops.some(drop=>String(drop.id)===button.dataset.coin))button.remove();
  if(!drops.length)return;
  const bounds=$('map-wrap').getBoundingClientRect(),matrix=$('world-map').getScreenCTM();
  for(const drop of drops){
    let button=layer.querySelector(`[data-coin="${drop.id}"]`);
    if(!button){button=document.createElement('button');button.className='map-coin';button.dataset.coin=drop.id;button.innerHTML='<span class="coin-token" aria-hidden="true"><i></i></span><strong class="coin-value"></strong>';layer.append(button);animate(button,'coin-spawn',750);}
    button.classList.toggle('jackpot',Boolean(drop.jackpot));button.disabled=game.phase!=='playing';
    button.setAttribute('aria-label',`${regionName(drop.regionId)}${drop.jackpot?'爆款':''}流量收益，领取 ${drop.value} 金币`);
    const count=button.querySelector('.coin-value');if(count.textContent!==`+${drop.value}`){if(count.textContent)animate(button,'coin-merged',650);count.textContent=`+${drop.value}`;}
    const [x,y]=locs[drop.regionId],point=new DOMPoint(x,y).matrixTransform(matrix),side=drop.regionId==='oceania'?-36:36;
    button.style.left=`${Math.max(30,Math.min(bounds.width-30,point.x-bounds.left+side))}px`;
    button.style.top=`${Math.max(36,Math.min(bounds.height-30,point.y-bounds.top-40))}px`;
  }
}

function runCollectCoin(id,button) {
  if(!game||document.querySelector('dialog[open]'))return;
  const before=getResearchStatus(game),start=button.getBoundingClientRect(),outcome=collectCoin(game,id);if(!outcome.ok)return;
  gameAudio.emit(outcome.jackpot?'jackpot':'coin');
  const destination=$('coin-wallet').getBoundingClientRect(),fly=document.createElement('span');fly.className='coin-flight';fly.textContent='¤';fly.style.left=`${start.x+start.width/2}px`;fly.style.top=`${start.y+start.height/2}px`;fly.style.setProperty('--coin-dx',`${destination.x+destination.width/2-start.x-start.width/2}px`);fly.style.setProperty('--coin-dy',`${destination.y+20-start.y-start.height/2}px`);document.body.append(fly);later(()=>fly.remove(),700);
  const focused=document.activeElement===button;button.remove();coinWalletFeedback(outcome.value);
  if(outcome.pointsEarned)walletFeedback(outcome.pointsEarned);
  const label=outcome.pointsEarned?`+${outcome.value} 金币 → +${outcome.pointsEarned} 行动点`:`${outcome.jackpot?'爆了！':''}+${outcome.value} 金币`;
  pulseRegion(outcome.regionId,label,'coin-gain');
  const after=getResearchStatus(game);
  if(!before.available&&after.available){animate($('search-button'),'affordable-once',1400);feedback('搜证经费，攒够了',`花 ${after.cost} 金币，${after.roundNumber===1?'选一条线索开查':'顺着上一条线索继续深挖'}。`,'去挖实锤','success',80,5000);}
  render();
  if(focused)(document.querySelector('#coin-layer [data-coin]')||$('search-button')).focus({preventScroll:true});
}

function buildMap() {
  // 图集只加载一次，各条传播线路复用同一组图标。
  const iconOrder=['press','green','facecook','x','weibo','readit','whatsgua','telegram','africanow','absee'];
  const iconDefs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  iconDefs.innerHTML=`<image id="media-icon-atlas" href="./assets/media-icons.png" width="1983" height="793"/>`+iconOrder.map((id,index)=>`<symbol id="media-icon-${id}" viewBox="${index%5*396.6} ${index<5?30:396.5} 396.6 366.5" overflow="hidden"><use href="#media-icon-atlas"/></symbol>`).join('');
  $('world-map').prepend(iconDefs);
  const size=6,canvas=document.createElement('canvas');canvas.width=168;canvas.height=84;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.scale(1/size,1/size);context.translate(0,28);
  for(const country of WORLD){const index=REGIONS.findIndex(region=>region.id===country.region);if(index<0)continue;context.fillStyle=`rgb(${30+index*30},0,0)`;context.fill(new Path2D(country.d));}
  const pixels=context.getImageData(0,0,168,84).data,tiles=REGIONS.map(()=>[]);
  for(let y=0;y<84;y++)for(let x=0;x<168;x++){const i=(y*168+x)*4;if(pixels[i+3]<180)continue;const region=Math.round((pixels[i]-30)/30);if(tiles[region])tiles[region].push({x,y,path:`M${x*size} ${y*size}h4.5v4.5h-4.5z`});}
  const colors={blue:'#91bc50',exposed:'#a69148',red:'#6b3935'};
  $('land-layer').innerHTML=REGIONS.map(region=>Object.entries(colors).map(([audience,color])=>`<path data-region="${region.id}" data-audience="${audience}" fill="${color}"/>`).join('')).join('');
  REGIONS.forEach((region,index)=>mapPixelRegions.set(region.id,{tiles:orderPopulationPixels(tiles[index]).map(tile=>tile.path),counts:null,paths:Object.fromEntries(Object.keys(colors).map(audience=>[audience,document.querySelector(`#land-layer [data-region="${region.id}"][data-audience="${audience}"]`)]))}));
  $('route-layer').innerHTML='';
  $('region-layer').innerHTML=REGIONS.map(region=>{const [x,y]=locs[region.id];return `<g class="region-label" data-region="${region.id}" transform="translate(${x} ${y})"><rect class="pulse-ring" x="-8" y="-8" width="16" height="16"/><rect class="region-dot" x="-5" y="-5" width="10" height="10"/><text text-anchor="middle" y="29">${region.name}</text><text class="value" text-anchor="middle" y="49">未触达</text></g>`;}).join('');
}

function renderStartRegions() {
  $('start-regions').innerHTML=REGIONS.map(region=>`<button data-start-region="${region.id}" class="${selectedRegion===region.id?'active':''}" aria-pressed="${selectedRegion===region.id}">${region.name}<span class="region-check" aria-hidden="true">${selectedRegion===region.id?'■':'□'}</span></button>`).join('');
  text('start-summary',`${regionName(selectedRegion)}主场 · ${channelName(REGION_PRIMARY_MEDIA[selectedRegion])}`);
}

function updateClaimPresets() {
  const list=$('claim-presets'),claim=$('claim-input').value.trim();
  $('claim-input').classList.toggle('needs-claim',liveSearch&&!claim);
  for(const button of list.querySelectorAll('[data-claim-preset]'))button.setAttribute('aria-pressed',String(claimPresets[Number(button.dataset.claimPreset)][1]===claim));
  $('claim-presets-prev').disabled=list.scrollLeft<=1;
  $('claim-presets-next').disabled=list.scrollLeft+list.clientWidth>=list.scrollWidth-1;
}
function renderClaimPresets() {
  presetDirection=1;presetPosition=0;presetHoldUntil=performance.now()+1800;
  $('claim-preset-row').hidden=!liveSearch;
  $('claim-presets').innerHTML=claimPresets.map(([label,claim],index)=>`<button type="button" data-claim-preset="${index}" title="${esc(claim)}">${esc(label)}</button>`).join('');
  $('claim-presets').scrollLeft=0;updateClaimPresets();
}
function advanceClaimPresets(now,dt) {
  const list=$('claim-presets'),row=$('claim-preset-row');
  if(!liveSearch||!$('intro-dialog').open||document.hidden||reducedMotion.matches||row.matches(':hover,:focus-within')||now<presetHoldUntil){presetPosition=list.scrollLeft;return;}
  const end=list.scrollWidth-list.clientWidth;if(end<=0)return;
  presetPosition=Math.max(0,Math.min(end,presetPosition+presetDirection*18*dt));list.scrollLeft=presetPosition;
  if(presetPosition>=end||presetPosition<=0){presetDirection*=-1;presetHoldUntil=now+1600;}
}
function scrollClaimPresets(direction) {
  presetHoldUntil=performance.now()+4500;
  const list=$('claim-presets');list.scrollBy({left:direction*list.clientWidth*.8,behavior:reducedMotion.matches?'instant':'smooth'});
}

function openIntro() {
  tutorial.close({remember:false});
  rankingRunId=newUuid();rankingRequest++;rankingReportRequest++;rankingReturnToReport=false;
  gameAudio.reset();
  finalReviewRequest?.controller.abort();finalReviewRequest=null;endingScene=null;
  void cancelInvestigationSession(game);
  cancelLiveRequest();resetFieldFeed();
  pendingStart=null;cinematicElapsed=0;publicationScene=null;victoryPresentation=null;
  planRequestId=null;activeReport=null;$('report-button').hidden=true;$('claim-error').hidden=true;$('claim-input').disabled=!liveSearch;
  $('claim-input').value=liveSearch?'':CASE.claim;$('claim-input').removeAttribute('aria-invalid');
  for(const timer of timers)clearTimeout(timer);timers.clear();
  game=null;manualPaused=false;detailPauseBeforeOpen=null;firstMovePending=false;guided=true;celebrationUntil=0;resultShown=false;detailType='';detailResultId=null;
  seenLog=0;seenResults=0;researchSeen=false;shownFirstResult=false;enemyIntros.clear();lastAction=null;intent=null;previousJourney=null;currentJourney=null;
  feedbackQueue=[];receipts=[];interrupts=[];activeFeedback=null;seenClues=new Set();regionContacts=new Set();freedRegions=new Set();truthMilestones=new Set();affordability=new Map();caches=new Map();
  publicationSnapshot=null;recoveryAnnounced=false;largestHit=0;
  seenTransportEvent=0;firstTruthSent=false;watchedTripId=null;transportNotice=null;lastBlockNotice=-Infinity;feedbackClock=0;lastMediaEventId=null;mediaEnding=null;lastPacingStage='opening';researchSeenRound=0;lastEvidenceEventId=null;lastConversionFeedback=-Infinity;
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());document.querySelectorAll('.wallet-float,.coin-flight').forEach(node=>node.remove());$('coin-layer').replaceChildren();
  $('map-effects').innerHTML='';$('burst').hidden=true;document.body.classList.remove('paused');chooseSpeed(2);renderStartRegions();render();window.scrollTo({top:0,behavior:'instant'});$('intro-dialog').showModal();renderClaimPresets();renderSoundSettings();updateAudioScene();
}
function startGame() {
  if(!$('intro-dialog').open||pendingStart)return;
  const claim=liveSearch?$('claim-input').value.trim():CASE.claim;
  if([...claim].length<2||[...claim].length>160||/[\u0000-\u001f\u007f]/u.test(claim)){text('claim-error',!claim?'先写一句传闻，或点选下方题目。':'请写一句 2–160 字的具体说法，不要换行。');$('claim-error').hidden=false;$('claim-input').setAttribute('aria-invalid','true');$('claim-input').focus();animate($('claim-input'),'claim-invalid',450);gameAudio.emit('error');return;}
  pendingStart={claim,regionId:selectedRegion};cinematicPlaying=!reducedMotion.matches;
  text('cinematic-play',cinematicPlaying?'暂停播放':'自动播放');
  $('intro-dialog').close();showCinematicPage(0,false);gameAudio.emit('start');$('cinematic-dialog').showModal();$('cinematic-next').focus({preventScroll:true});lastFrame=performance.now();updateAudioScene();
}
function showCinematicPage(page,withSound=true) {
  if(!pendingStart)return;
  if(withSound)gameAudio.emit('page');
  cinematicPage=Math.max(0,Math.min(2,page));cinematicElapsed=0;
  const stage=$('cinematic-stage');stage.dataset.page=String(cinematicPage);stage.style.setProperty('--shot-progress','0');
  document.querySelectorAll('[data-shot]').forEach(shot=>{shot.hidden=Number(shot.dataset.shot)!==cinematicPage;});
  document.querySelectorAll('[data-cinematic-page]').forEach(button=>{const active=Number(button.dataset.cinematicPage)===cinematicPage;button.setAttribute('aria-current',active?'step':'false');button.style.setProperty('--page-progress',Number(button.dataset.cinematicPage)<cinematicPage?'1':'0');});
  const caption=$('cinematic-caption');
  caption.classList.toggle('long-claim',[...pendingStart.claim].length>65);
  caption.innerHTML=[
    '<h2>谎言公司，统治着世界。</h2><p>全世界，都浸泡在它散发的传闻之下。</p>',
    `<p>这一次，它居然让全世界都相信——</p><blockquote>“<span>${esc(pendingStart.claim)}</span>”</blockquote>`,
    '<p>勇敢的侦探啊，</p><h2>出发，拯救世界吧！</h2>',
  ][cinematicPage];
  // Restart the short caption entrance when revisiting a page.
  caption.classList.remove('caption-enter');void caption.offsetWidth;caption.classList.add('caption-enter');
  $('cinematic-next').innerHTML=cinematicPage===2?'开始调查 <span>→</span>':'下一页 <span>→</span>';
}
function nextCinematicPage() {if(cinematicPage<2)showCinematicPage(cinematicPage+1);else finishCinematic();}
function advanceCinematic(dt) {
  if(!pendingStart||!$('cinematic-dialog').open||!cinematicPlaying||document.hidden)return;
  const image=document.querySelector(`[data-shot="${cinematicPage}"] img`);
  if(!image.complete)return;
  const duration=1;
  cinematicElapsed+=dt;const progress=Math.min(1,cinematicElapsed/duration);
  $('cinematic-stage').style.setProperty('--shot-progress',String(progress));
  document.querySelector(`[data-cinematic-page="${cinematicPage}"]`).style.setProperty('--page-progress',String(progress));
  if(progress>=1)nextCinematicPage();
}
function finishCinematic() {
  if(!pendingStart)return;
  const {claim,regionId}=pendingStart;pendingStart=null;gameAudio.emit('resume');$('cinematic-dialog').close();
  game=createGame({regionId,researchMode:liveSearch?'live':'demo',claim,investigationMode:liveSearch?'agent':undefined});firstMovePending=true;manualPaused=false;lastFrame=performance.now();regionContacts.add(regionId);
  feedback('侦探，调查开始了',liveSearch?'先升级传播、收金币，调查方向准备好后会提醒你。':'升级传播，让转载把真相带到更多地区。','24 点起步','success',40);render();document.querySelector('[data-upgrade="spread"]').focus({preventScroll:true});
  if(tutorial.shouldAutoStart())showHelp();
  if(liveSearch)prepareInvestigation(game);
}
async function prepareInvestigation(state) {
  if(planRequest||state!==game||state.phase!=='playing')return;
  if(state.investigation&&!state.investigation.sessionId)state.investigation.planError=null;
  const controller=new AbortController(),request={controller,state,timedOut:false,timer:null};planRequest=request;planRequestId ||= newUuid();
  request.timer=setTimeout(()=>{request.timedOut=true;controller.abort();},100000);
  const current=()=>game===state&&state.phase==='playing'&&planRequest===request;
  try{
    const response=await fetch('/api/investigation/plan',{method:'POST',headers:{'Content-Type':'application/json','X-Lie-Company':'research'},body:JSON.stringify({requestId:planRequestId,claim:state.claim}),signal:controller.signal});
    let payload;try{payload=await response.json();}catch{throw new Error('调查方向暂时没有准备好，请重试。');}
    if(!current()){
      if(response.ok&&payload.ok&&payload.result?.sessionId)void cancelInvestigationSession(state,payload.result.sessionId);
      return;
    }
    if(!response.ok||!payload.ok)throw Object.assign(new Error(payload.error?.message||'暂时连不上调查服务，请重试。'),{code:payload.error?.code});
    const applied=setInvestigationPlan(state,payload.result);if(applied?.ok===false)throw new Error(applied.reason||'调查方向不完整，请重试。');
    gameAudio.emit('evidence');
    fieldMessage({source:'调查员',title:'两条调查方向已准备好',detail:'选一条线索，开始追查。',tone:'success'});
    feedback('有两条线索值得查','选一条开查，结果会决定下一步怎么追。','方向已就绪','success',65);
  }catch(error){if(current()){gameAudio.emit('error');failInvestigationPlan(state,request.timedOut||error.code==='MODEL_TIMEOUT'?'调查方向准备超时，请重新准备。':error.message==='Failed to fetch'?'暂时连不上调查服务，请重试。':error.message||'调查方向暂时不可用，请重试。');}}
  finally{clearTimeout(request.timer);if(planRequest===request)planRequest=null;if(game===state){if(['search','agent-search'].includes(detailType))showAgentSearch();else render();}}
}
function skipGuidance() {
  gameAudio.emit('resume');
  firstMovePending=false;guided=false;manualPaused=false;lastFrame=performance.now();feedback('自由行动已开始','地图自动传播，右上方可以暂停规划。','','neutral',40);render();
}
function markAction(type,key) {lastAction={type,key,at:performance.now()};intent=null;previousJourney=null;}
function setManualPause() { if(performance.now()<celebrationUntil)return;manualPaused=!manualPaused;gameAudio.emit(manualPaused?'pause':'resume');lastFrame=performance.now();render(); }
function resumeGame() { if(!game||game.phase!=='playing')return;gameAudio.emit('resume');manualPaused=false;lastFrame=performance.now();$('pause-dialog').close();render(); }
function renderPauseSummary() {
  const dialog=$('pause-dialog'),visible=manualPaused&&game?.phase==='playing'&&!tutorial.isOpen()&&!$('detail-dialog').open&&!$('intro-dialog').open&&!$('result-dialog').open&&!publicationScene;
  if(!visible){if(dialog.open)dialog.close();return;}
  const stats=getStats(game);
  text('pause-claim',game.claim);text('pause-time',worldTime(game.time).stamp);text('pause-support',`${stats.truth.toFixed(1)}%`);text('pause-reach',`${stats.reached.toFixed(0)}%`);text('pause-points',Math.floor(game.points));text('pause-coins',game.coins);
  text('pause-support-label',isAgentGame(game)?'支持核查':'相信真相');
  if(!dialog.open){dialog.showModal();$('pause-resume').focus({preventScroll:true});}
}
function shortage(cost) {const missing=Math.max(0,Math.ceil(cost-(game?.points||0)));const seconds=Math.ceil(missing/Math.max(.01,game?getStats(game).income:.16));return {missing,seconds};}

function renderMap() {
  const scale=Math.max(.4,Math.min($('map-wrap').clientWidth/1000,$('map-wrap').clientHeight/500));
  $('world-map').style.setProperty('--region-font',`${Math.max(20,16/scale)}px`);
  $('world-map').style.setProperty('--region-value-font',`${Math.max(17,14/scale)}px`);
  $('world-map').style.setProperty('--media-icon-scale',String(1/scale));
  const populations=new Map(game?.regions.map(region=>[region.id,region])||[]);
  for(const region of REGIONS){
    const p=populations.get(region.id)||{red:100,exposed:0,blue:0},pixels=mapPixelRegions.get(region.id);
    const counts=populationPixelCounts(pixels.tiles.length,p),key=`${counts.blue}:${counts.exposed}`;
    if(pixels.counts!==key){
      let offset=0;
      for(const audience of ['blue','exposed','red']){pixels.paths[audience].setAttribute('d',pixels.tiles.slice(offset,offset+counts[audience]).join(''));pixels.paths[audience].dataset.count=counts[audience];offset+=counts[audience];}
      pixels.counts=key;
    }
    const attacked=Boolean(game?.phase==='playing'&&game.event&&!game.event.resolved&&game.event.regionIds.includes(region.id));
    Object.values(pixels.paths).forEach(path=>path.classList.toggle('under-attack',attacked));
    const label=document.querySelector(`.region-label[data-region="${region.id}"]`);label.querySelector('.value').textContent=attacked?`${p.blue.toFixed(0)}% 相信 · 限流`:!p.seeded?'未触达':game?.operationPhase==='public'?`${p.blue.toFixed(0)}% 相信`:`${(p.blue+p.exposed).toFixed(0)}% 触达`;
    label.querySelector('text').setAttribute('y',Math.max(29,21/scale));label.querySelector('.value').setAttribute('y',Math.max(49,40/scale));
    label.classList.toggle('under-attack',attacked);label.querySelector('.region-dot').style.fill=p.blue>40?'var(--blue)':p.exposed>20?'var(--gold)':'var(--red)';
  }
  renderMediaRoutes();
  const pacing=game?getPacing(game):null,heated=game?.phase==='playing'&&pacing&&pacing.stage!=='opening';
  $('map-caption').hidden=!heated;$('map-caption').classList.toggle('heated',Boolean(heated));
  text('map-caption',pacing?.networkCritical?'传播网络濒危':pacing?.stage==='heating'?'舆论升温，回流加剧':'舆论白热化');
}
function renderMediaRoutes() {
  const trips=game?getTransports(game).filter(trip=>trip.carryingTruth===true):[];
  const candidates=[...trips].sort((a,b)=>Number(game.regions.find(r=>r.id===a.to).seeded)-Number(game.regions.find(r=>r.id===b.to).seeded)||a.arrivesAt-b.arrivesAt);
  if(!candidates.some(trip=>trip.id===watchedTripId))watchedTripId=candidates[0]?.id??null;
  const markup=trips.map(trip=>{
    const channel=CHANNELS.find(item=>item.id===trip.channelId),curve=routeCurve(trip.from,trip.to,(trip.id%3)*9);
    return `<g class="media-trip carrying ${trip.id===watchedTripId?'watched':''} ${trip.eventId?'event-boosted':''}" data-trip="${trip.id}"><title>${esc(channel.name)}：${regionName(trip.from)} → ${regionName(trip.to)} · 携带核查内容${trip.boostName?' · '+esc(trip.boostName):''}</title><path class="transit-path" d="${routePath(curve)}"/><g class="transit-token"><g class="transit-icon"><path class="transit-boost" d="M-20-11v-9h9 M11-20h9v9 M20 11v9h-9 M-11 20h-9v-9"/><use href="#media-icon-${channel.id}" x="-20" y="-20" width="40" height="40"/></g></g></g>`;
  }).join('');
  setHTML('media-route-layer',markup);
  for(const trip of trips){
    const curve=routeCurve(trip.from,trip.to,(trip.id%3)*9),t=reducedMotion.matches?.5:trip.progress;
    const x=(1-t)**2*curve.x+2*(1-t)*t*curve.cx+t*t*curve.xx,y=(1-t)**2*curve.y+2*(1-t)*t*curve.cy+t*t*curve.yy;
    document.querySelector(`[data-trip="${trip.id}"] .transit-token`).setAttribute('transform',`translate(${x} ${y})`);
  }
  const reached=game?.regions.filter(region=>region.seeded).length||0;
  setHTML('channel-legend',`<span><i class="traffic-sample carrying"></i>核查内容转载</span><span class="reach-count">已抵达 <b>${reached} / 6</b> 地区</span><button data-media-overview>媒体习惯</button>`);
  if(game&&game.phase!=='playing'){
    $('transport-status').classList.remove('arrival','blocked','in-transit');
    text('transport-title',game.phase==='won'?'胜利已锁定':'本局已结束');
    text('transport-detail',game.phase==='won'?'传播胜利已锁定，反扑与传播停止。':'回看本局历程，再接一案。');
    $('transport-progress').style.width=game.phase==='won'?'100%':'0%';return;
  }
  const notice=transportNotice&&feedbackClock<transportNotice.until?transportNotice:null,watch=trips.find(trip=>trip.id===watchedTripId);
  $('transport-status').classList.toggle('arrival',Boolean(notice&&notice.kind==='first-seed'));
  $('transport-status').classList.toggle('blocked',Boolean(notice&&notice.kind==='blocked'));
  $('transport-status').classList.toggle('in-transit',Boolean(!notice&&watch));
  if(notice){text('transport-title',notice.title);text('transport-detail',notice.detail);$('transport-progress').style.width='100%';}
  else if(watch){
    text('transport-title',`${channelName(watch.channelId)}${MEDIA_FLAVOR[watch.channelId]?.verb||'转载'} · ${regionName(watch.from)} → ${regionName(watch.to)}`);
    text('transport-detail',`${worldRemaining(watch.arrivesAt-game.time)}后抵达 · ${watch.boostName|| (game.regions.find(region=>region.id===watch.to).seeded?'继续扩大受众':'正在前往尚未触达的地区')}`);
    $('transport-progress').style.width=`${watch.progress*100}%`;
  }else{
    text('transport-title',game?'等待下一次真相转载':'媒体会自动往来');
    text('transport-detail',game?'支持者与传播能力，让真相更易被带走':'选择起点，开始传播');
    $('transport-progress').style.width='0%';
  }
}
function renderMediaEvent() {
  renderEvidenceHotspot();
  const current=game?getMediaEvent(game):null;
  if(current&&current.id!==lastMediaEventId){lastMediaEventId=current.id;}
  else if(!current&&lastMediaEventId)lastMediaEventId=null;
}
function uiEvidenceEventEffect(event) {
  const parts=[];
  if(event.spreadBonus)parts.push(`传播额外 +${uiPercent(event.spreadBonus)}`);
  if(event.persuasionBonus)parts.push(`说服额外 +${uiPercent(event.persuasionBonus)}`);
  if(event.persuasionPenalty){const bonus=getMaterialEffect(uiEvidenceMaterial(event.evidenceId)).persuasionBonus;parts.push(`这份证据的说服加成 +${uiPercent(bonus)} → +${uiPercent(Math.max(0,bonus-event.persuasionPenalty))}`);}
  return parts.join(' · ');
}
function evidenceStoryCopy(eventId) {
  const story=RESEARCH_EVENTS[eventId];if(!story||game?.researchMode!=='live')return story;
  const quips={
    'source-goes-viral':'有人把你的资料连同出处转发了，评论区围了上来。',
    'bot-misreads':story.quip,
    'show-the-receipts':'评论区要出处，你把原文链接贴了出来。',
    'changed-my-mind':'刚才还在反驳的人，开始转发你附上的资料。',
  };
  return {...story,quip:quips[eventId]||story.quip,gameEffectHint:story.effectKey==='controversy'?'本局虚构账号转述错了你的解释：争议增加转载，暂时削弱一部分说服加成。':story.effectKey==='spread'?'你公布的证据带上出处，更多人开始转载。':'你公布的证据得到更多支持，本局说服能力增强。',realityNote:'本局虚构互动；真实梗的出处见上方。转载、态度变化和能力增益均为游戏演绎。'};
}
function renderEvidenceHotspot() {
  const event=game?getEvidenceEvent(game):null;
  if(!event){if(lastEvidenceEventId){lastEvidenceEventId=null;feedback('这轮热点退去了','临时加成已结束，已公布证据的长期加成保留。','','neutral',30,4500);}return false;}
  const story=evidenceStoryCopy(event.eventId);if(!story)return false;
  if(lastEvidenceEventId!==event.id){
    lastEvidenceEventId=event.id;
    feedback(story.title,story.gameEffectHint,uiEvidenceEventEffect(event),'success',65,7000);
    for(const key of ['spread','persuasion'])animate(document.querySelector(`[data-card="${key}"]`),'just-bought',1500);
  }
  return true;
}
function showEvidenceStory(eventId) {
  const story=evidenceStoryCopy(eventId);if(!story)return;
  const meme=RESEARCH_MEMES[story.memeId],event=(game?.evidenceEvents||[]).find(item=>item.eventId===eventId&&item.startedAt!=null);
  const material=event?uiEvidenceMaterial(event.evidenceId):null;
  openDetail(`<span class="tag">真实网络现象 · 本局玩法演绎</span><h2>${esc(story.title)}</h2><p>${esc(story.quip)}</p><div class="story-effect"><b>为什么在这局出现</b><p>${material?`你公布了「${esc(material.title)}」。`:''}${esc(story.gameEffectHint)}</p>${event?`<p>${esc(uiEvidenceEventEffect(event))} · 持续 ${worldDuration(45)}</p>`:''}</div><h3>梗的真实出处</h3><p>${esc(meme.summary)}</p><p><a href="${esc(meme.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(meme.sourceTitle)} ↗</a></p>${(meme.relatedSources||[]).map(source=>`<p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a></p>`).join('')}<p class="subtle">${esc(story.realityNote)}</p>`,'evidence-story');
}
function showMediaStory(type) {
  const story=MEDIA_STORIES[type];if(!story)return;
  openDetail(`<span class="tag">${esc(story.historyLabel)}</span><h2>${esc(story.title)}</h2><p>${esc(story.quip)}</p><div class="story-effect"><b>本局效果</b><p>${esc(story.effect)}</p></div><h3>这个梗从哪来</h3><p>${esc(story.history)}</p><p><a href="${esc(story.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(story.sourceTitle)} ↗</a></p><p class="subtle">历史事件／平台机制的游戏改编，不是实时新闻。不会自动生成证据或判定本案真伪。</p>`,'media-story');
}
function showMediaOverview() {
  const history=game?.mediaEvents||[];
  const profiles=REGIONS.map(region=>{const media=CHANNELS.find(item=>item.id===REGION_PRIMARY_MEDIA[region.id]);return `<div><b>${region.name}</b><span>${esc(media.name)}<a class="media-origin" href="${esc(media.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(media.prototype)} ↗</a></span></div>`;}).join('');
  openDetail(`<h2>六个主场，真相跨区接力。</h2><p>主场媒体更常出发；其他平台照样往来。当地有人看、有人信，转载才会带上你的内容。</p><div class="media-profile-list">${profiles}</div><p class="subtle">按地区特色选择原型，主场权重是游戏设定，不是各洲真实市场份额。</p>${history.length?`<h3>本局遇到的彩蛋</h3><div class="story-history">${history.map(event=>`<button data-media-story="${event.type}"><span>${esc(MEDIA_STORIES[event.type].title)}</span><small>${esc(MEDIA_STORIES[event.type].historyLabel)} ↗</small></button>`).join('')}</div>`:'<p>媒体热点会自动出现。看到有趣的新闻条时，可以点“梗的出处”。</p>'}`,'media-overview');
}

function renderUpgrades() {
  const levels=game?.levels||{spread:0,persuasion:0,defense:0},bonuses=game?getEvidenceBonuses(game):{spreadBonus:0,persuasionBonus:0};
  const hotspot=game?.event&&!game.event.resolved?bonuses.activeEvent:null,hotspotKey=hotspot?.spreadBonus?'spread':'persuasion';
  setHTML('upgrades',Object.entries(UPGRADE_DEFS).map(([key,definition])=>{
    const level=levels[key],full=level===3,bonus=bonuses[key+'Bonus'],counter=game&&key==='defense'?getCounterStatus(game):null;
    const defensePreview=counter?.active&&!full?'<div class="upgrade-bonus" id="defense-counter-preview"></div>':'';
    return `<div class="upgrade" data-card="${key}"><div class="upgrade-title"><h3>${upgradeNames[key]}</h3><span class="levels" aria-label="${level} / 3 级">${[1,2,3].map(n=>`<i class="${n<=level?'on':''}"></i>`).join('')}</span></div><button data-upgrade="${key}" aria-label="${upgradeNames[key]}，${full?'已满级':definition.costs[level]+'行动点'}">${full?'满级':`${definition.costs[level]} 点`}</button><p>${key==='defense'?full?definition.effect[2]:counter?.active?`反扑减损 ${uiPercent(counter.defenseReduction)} → ${uiPercent(counter.nextDefenseReduction)}`:`升级后 ${definition.effect[level]}`:full?'能力已满级':definition.effect[level]}</p>${defensePreview}${bonus||key==='spread'&&bonuses.arrivalConversion?`<div class="upgrade-bonus">${bonus?`额外加成 +${uiPercent(bonus)}`:''}${key==='spread'&&bonuses.arrivalConversion?` · 落地说服 ${uiPercent(bonuses.arrivalConversion)}`:''}${hotspot&&key===hotspotKey?` · ${esc(RESEARCH_EVENTS[hotspot.eventId].title)} <span id="upgrade-hotspot-time"></span>`:''}</div>`:''}</div>`;
  }).join(''));
  if(hotspot)text('upgrade-hotspot-time',worldRemaining(hotspot.remaining));
  if($('defense-counter-preview')){const counter=getCounterStatus(game);text('defense-counter-preview',`澄清 ${worldRemaining(counter.remaining)} → ${worldRemaining(counter.remaining*counter.rate/counter.nextRate)}`);}
  for(const [key] of Object.entries(UPGRADE_DEFS)){
    const button=document.querySelector(`[data-upgrade="${key}"]`),cost=upgradeCost(game||{levels},key),can=Boolean(game&&game.phase==='playing'&&cost!==null&&game.points+1e-7>=cost);
    button.disabled=!can;button.title=cost!==null&&game&&!can?`还差 ${shortage(cost).missing} 行动点`:'';
    if(affordability.has(key)&&!affordability.get(key)&&can&&!firstMovePending)animate(button,'affordable-once',1300);affordability.set(key,can);
  }
}

function publicationThreat() {
  const campaign=getCampaignStatus(game),counter=getCounterStatus(game),next=campaign.published+1;
  if(campaign.activeWave||campaign.recoveryRemaining>0)return `第 ${next} 波将候场${counter.active?'；当前澄清 +15%':'，逐波交锋'}。`;
  return `公布后，第 ${next} / ${campaign.total} 波反扑来袭。`;
}
function renderPublish() {
  const preview=game?getPublishPreview(game):{available:false,gain:0},pending=game?.researchResults.find(result=>!result.promotedId);
  const isPublic=game?.operationPhase==='public';
  text('phase-title',isPublic?'舆论对决':'传播准备');$('publish-box').classList.toggle('published',Boolean(isPublic&&!pending));
  $('publish-button').hidden=false;$('publish-button').disabled=!preview.available;
  $('publish-box').classList.toggle('evidence-ready',Boolean(preview.available));
  if(game&&game.phase!=='playing'){
    setHTML('publish-preview',`<div class="publish-preview"><span>${game.phase==='won'?'胜利已锁定':'本局已结束'}</span><strong>${game.publications.length} 份实锤</strong></div>`);
    text('publish-warning',isVictorySettling()?'最后一轮调查完成后，自动收入结案战报。':'查到的材料已收入结案战报。');
    text('publish-label','本局已结束');text('publish-cost','');return;
  }
  if(pending){
    const material=getSelectedEvidence(game,pending),effect=getMaterialEffect(material);
    setHTML('publish-preview',`<div class="publish-evidence-name">${esc(preview.title||material?.title||'新证据已到')}</div><div class="publish-preview"><span>${esc(effect.label)}</span><strong>+${preview.gain.toFixed(1)}%</strong></div>`);
    text('publish-warning',publicationThreat());
  }else{
    setHTML('publish-preview',`<div class="publish-preview"><span>${isPublic?'已公布的证据持续生效':'先找到证据，再让世界看见'}</span>${isPublic?`<strong>${game.publications.length} 份</strong>`:''}</div>`);
    text('publish-warning',game?.publications.length===RESEARCH_ROUNDS.length?`证据已全部公布，支持率达到 ${RULES.winTruth}% 即获胜。`:'每份实锤，引来更强一波反扑。');
  }
  text('publish-label',pending?'公布实锤':'等待新证据');text('publish-cost','↗');
}

function currentInvestigationEntry() {
  const entries=fieldFeed.entries.filter(entry=>entry.kind==='investigation');
  if(game?.research?.requestId)return entries.find(entry=>entry.requestId===game.research.requestId)||null;
  return entries.at(-1)||null;
}
function renderResearch() {
  const job=game?.research,status=game?getResearchStatus(game):null,entry=currentInvestigationEntry();
  const ended=game&&game.phase!=='playing',flow=entry&&!entry.demo?getInvestigationFlow(entry):null;
  const watching=Boolean(job||ended&&entry||status?.phase==='complete');
  $('search-button').disabled=!game||!canOpenResearch(status);
  $('search-button').classList.toggle('unread',Boolean(status&&(status.phase==='ready-to-publish'||status.available)));
  $('search-button').dataset.investigationState=job?({lead:'queued',search:'searching',verify:'verifying',report:'reporting'}[flow?.activeNode]||'queued'):ended?(flow?.status==='failed'?'failed':'completed'):status?.phase==='ready-to-publish'?'completed':status?.phase==='planning'||status?.phase==='refreshing'?'queued':'';
  const label=job?(entry?.demo?'核对预置资料':flow?.buttonLabel||'正在提交调查'):ended||status?.phase==='complete'?'回看调查过程':status?.phase==='planning'?'规划调查方向':status?.phase==='refreshing'?'更换调查方向':status?.phase==='ready-to-publish'?'查看证据报告':status?.phase==='plan-error'?'重新准备调查':'寻找证据';
  text('search-label',label);
  const balance=game?.coins||0,gap=status?.cost?Math.max(0,status.cost-balance):0;
  let note=!status?'五轮调查，沿线深挖':status.phase==='planning'?'正在拆解传闻 · 点击查看':status.phase==='refreshing'?'换两个新问题 · 点击查看':status.phase==='plan-error'?'调查方向未就绪 · 点击重试':status.phase==='ready-to-publish'?(status.pendingEvidence?.storedAt!=null?'证据已收入囊中 · 查看报告':'新证据已到 · 查看报告'):status.phase==='locked'?`${status.actionLabel||status.reason}${status.gate==='network'?` · ${status.reachedRegions}/${status.requiredRegions}`:''}`:gap?`第 ${status.roundNumber}/${RESEARCH_ROUNDS.length} 轮 · ${balance}/${status.cost} 金币`:`第 ${status.roundNumber} / ${RESEARCH_ROUNDS.length} 次 · ${status.cost} 金币，选线索`;
  if(watching)note=job?`${isVictorySettling()?'胜利已锁定 · ':''}第 ${status.roundNumber} 轮${flow?.sourceCount!=null?` · ${flow.sourceCount} 条来源`:''} · 查看进度`:`${entry?.round?`第 ${entry.round} 轮 · `:''}${entry?.publicationState||'调查已结束'} · 查看过程`;
  text('search-count',note);
  $('research-job').hidden=!job||isAgentGame(game);
  if(job&&!isAgentGame(game)){if(job.kind==='live')setHTML('research-job','<div class="job-info"><span>元宝正在联网搜索</span><b class="search-live-dot" aria-hidden="true">•••</b></div>');else{const progress=job.elapsed/job.duration;setHTML('research-job',`<div class="job-info"><span>${isPaused()?'调查已暂停':'正在核对原文'}</span><b>${worldRemaining(job.duration-job.elapsed)}</b></div><div class="job-track"><i style="width:${progress*100}%"></i></div>`);}}
}

function renderOpponent() {
  const event=game?.event,campaign=game?getCampaignStatus(game):null,recovery=campaign?.recoveryRemaining>0;
  const visible=Boolean(game?.phase==='playing'&&event&&(!event.resolved||recovery)&&performance.now()>=celebrationUntil);$('opponent').hidden=!visible;if(!visible)return;
  if(event.resolved){
    $('opponent').className='opponent resolved';
    const next=(game.enemyWaves||[]).find(wave=>wave.stage==='queued');
    setHTML('opponent',`<div class="enemy-copy"><strong>第 ${event.waveNumber} 波击破 · 趁势反攻</strong><p>说服 ×2.2 · 传播 ×1.35</p></div><span class="enemy-time"><small>反攻窗口</small><b>${worldRemaining(campaign.recoveryRemaining)}</b></span><p class="enemy-queue">${next?`接下来：第 ${next.waveNumber} 波 · ${esc(next.waveName)}${campaign.queued>1?`（共 ${campaign.queued} 波候场）`:''}`:`支持率达到 ${RULES.winTruth}% 即获胜。收金币、补证据，稳住优势。`}</p>`);
    return;
  }
  const counter=getCounterStatus(game),names=event.regionIds.map(regionName).join('、'),need=shortage(counter.cost);
  $('opponent').className=`opponent ${event.stage}${counter.active?' counter-running':''}`;
  setHTML('opponent',`<div class="enemy-copy"><strong id="enemy-heading"></strong><p>${esc(names)}</p><p id="enemy-detail"></p></div><span class="enemy-time" id="enemy-time"><small>主攻前</small><b id="enemy-countdown"></b></span>${counter.active?'<div class="counter-progress"><div><b id="counter-progress-label"></b><span id="counter-remaining"></span></div><div class="counter-track" role="progressbar" aria-label="澄清进度" aria-valuemin="0" aria-valuemax="100"><i></i></div><small>稳住阵地可提速 · 新实锤推进 15%</small></div>':'<div class="enemy-actions"><button data-counter id="counter-button"><span>发起澄清</span><small id="counter-cost"></small></button></div>'}${counter.queued?`<p class="enemy-queue">还有 ${counter.queued} 波候场 · 当前进度保留</p>`:''}`);
  text('enemy-heading',`第 ${counter.waveNumber} / ${campaign.total} 波 · ${counter.waveName}`);
  text('enemy-detail',counter.active?event.stage==='warning'?`预计主攻损失 ${counter.projectedHit.toFixed(1)}% 支持率 · 澄清越快，损失越小`:`每小时流失 ${(counter.damagePerSecond*WORLD_SECONDS_PER_HOUR).toFixed(2)}% 支持率 · 攻击随澄清减弱`:`转载受阻，支持者流失 · 澄清需${worldRemaining(100/counter.rate)}`);
  $('enemy-time').hidden=event.stage!=='warning';text('enemy-countdown',worldRemaining(event.remaining||0));
  if(counter.active){text('counter-progress-label',`澄清 ${Math.floor(counter.progress)}%`);text('counter-remaining',worldRemaining(counter.remaining));const track=document.querySelector('.counter-track');track.setAttribute('aria-valuenow',Math.floor(counter.progress));track.querySelector('i').style.width=`${counter.progress}%`;}
  else{$('counter-button').disabled=!counter.available;text('counter-cost',need.missing?`差 ${need.missing} 点`:`${counter.cost} 点 · 持续化解反扑`);}
}


function renderJourney(now) {
  currentJourney=now<celebrationUntil?{id:'publication-celebration',stage:'celebration',title:'实锤公布，世界开始转向',body:'你的传播网络，正在变成支持者。',primaryAction:null,attention:null,shownAt:now}:getJourney(game,{paused:!tutorial.isOpen()&&isPaused(),modalOpen:$('detail-dialog').open||$('intro-dialog').open||$('result-dialog').open,firstMovePending,researchSeen,researchSeenRound,lastAction,previous:previousJourney,nowMs:now,intent});previousJourney=currentJourney;
  const j=currentJourney;if(!j)return;
  const feedbackStages=['action-feedback','transport-arrival','transport-travelling','prepare-network','consider-publication','public-growth','finish','recovery','funding-auto','observe','enemy-counter-running'];
  const receipt=activeFeedback&&activeFeedback.priority>=60&&feedbackStages.includes(j.stage)?activeFeedback:null;
  $('journey').hidden=!$('opponent').hidden;text('journey-step','当前行动');text('journey-title',receipt?receipt.title:j.title);text('journey-body',receipt?receipt.detail:j.body);$('journey-metric').hidden=!receipt?.metric;if(receipt?.metric)text('journey-metric',receipt.metric);
  if(j.stage==='researching'){
    const investigation=fieldFeed.entries.findLast(entry=>entry.kind==='investigation'&&entry.status==='running'),step=investigation?.steps.at(-1);
    if(step){text('journey-title',step.title);text('journey-body',step.detail||'正在整理这轮发现，期间可以继续行动。');}
  }
  const action=j.primaryAction,inlineAction=action&&['resume','restart','start'].includes(action.type)&&!receipt;
  $('journey-primary').hidden=!inlineAction;if(inlineAction){text('journey-primary',action.label);$('journey-primary').disabled=Boolean(action.disabled);}
  $('journey-secondary').hidden=!firstMovePending;text('journey-secondary','自由行动');
  const targets={map:$('map-wrap'),'upgrade-spread':document.querySelector('[data-card="spread"]'),'upgrade-persuasion':document.querySelector('[data-card="persuasion"]'),'upgrade-defense':document.querySelector('[data-card="defense"]'),upgrades:$('upgrades'),search:$('search-button'),publish:$('publish-box'),enemy:$('opponent'),'research-progress':$('field-feed'),points:$('wallet'),coins:$('coin-layer')};
  const focusKey=j.attention?.target==='coins'?'coins':action?.type==='upgrade'?`upgrade-${action.key}`:j.attention?.target,focused=tutorial.isOpen()?null:targets[focusKey];
  document.querySelectorAll('.attention').forEach(node=>{if(node!==focused)node.classList.remove('attention');});if(focused&&!focused.classList.contains('attention'))focused.classList.add('attention');$('journey').classList.toggle('critical',j.attention?.tone==='warning');
}

function detectEvents() {
  if(!game||game.phase!=='playing')return;
  queueEnemyIntro();
  const pacing=getPacing(game);
  if(pacing.stage!==lastPacingStage){
    if(pacing.stage==='heating')feedback('全网争夺正在升温','传播与说服正在加快，对面也在带节奏。加强防守，别让支持者被带走。','','neutral',60,7500);
    if(pacing.stage==='heated')feedback('舆论进入白热化','本地传播与说服已加速。支持者越多，谎言回流越弱；现在仍然可以翻盘。','','neutral',45,6500);
    lastPacingStage=pacing.stage;
  }
  for(const event of (game.transportEvents||[]).filter(item=>item.id>seenTransportEvent)){
    const route=`${channelName(event.channelId)} · ${regionName(event.from)} → ${regionName(event.to)}`;
    if(event.type!=='departure'){
      const obsolete=item=>item?.transportStage==='departure'&&item.tripId===event.tripId;
      feedbackQueue=feedbackQueue.filter(item=>!obsolete(item));
      if(obsolete(activeFeedback))activeFeedback=null;
    }
    if(event.type==='departure'&&event.carryingTruth&&!firstTruthSent){
      firstTruthSent=true;watchedTripId=event.tripId;
      feedback('第一条真相转载出发了',`${route}。抵达后，才有机会在当地传开。`,'看绿色转载','success',65,5000,{tripId:event.tripId,transportStage:'departure'});
    }
    if(event.type==='first-seed'){
      gameAudio.emit('breakthrough');
      regionContacts.add(event.to);pulseRegion(event.to,'真相首次抵达');
      transportNotice={kind:'first-seed',title:`真相首次抵达${regionName(event.to)}`,detail:`${route} · 当地传播已开始`,until:feedbackClock+6000};
      feedback(`突破！真相抵达${regionName(event.to)}`,'第一批受众已经出现。当地会继续扩散，并成为新的转载来源。',`${game.regions.filter(region=>region.seeded).length} / 6 地区`,'success',75,6000);
    }
    if(event.type==='arrival'&&event.outcome==='missed'&&event.tripId===watchedTripId&&(!transportNotice||feedbackClock>transportNotice.until)){
      transportNotice={kind:'missed',title:`转载抵达${regionName(event.to)}，这次没有传开`,detail:'当地未新增受众。提升传播能力，能提高下一次落地的机会。',until:feedbackClock+4500};
    }
    if(event.convertedAmount>=.1&&feedbackClock-lastConversionFeedback>=3500&&(!transportNotice||feedbackClock>transportNotice.until)){
      lastConversionFeedback=feedbackClock;
      pulseRegion(event.to,`转载说服 +${event.convertedAmount.toFixed(1)}%`);
      transportNotice={kind:'reinforced',title:`证据又到了${regionName(event.to)}，观望者转为相信`,detail:`${route} · 当地相信真相的人 +${event.convertedAmount.toFixed(1)} 个百分点`,until:feedbackClock+3500};
    }
    if(event.type==='blocked'&&game.time-lastBlockNotice>=12){
      gameAudio.emit('warning');
      lastBlockNotice=game.time;
      [event.from,event.to].filter(id=>game.event?.regionIds.includes(id)).forEach(id=>pulseRegion(id,'转载被拦','loss'));
      transportNotice={kind:'blocked',title:`${channelName(event.channelId)}转载受阻 · ${regionName(event.from)} → ${regionName(event.to)}`,detail:'澄清越深入，拦截越弱；稳住阵地能减轻损失并加快澄清。',until:feedbackClock+5000};
    }
    seenTransportEvent=event.id;
  }
  for(const entry of game.log.filter(item=>item.id>seenLog)){
    if(entry.type==='forgery'){
      gameAudio.emit('breakthrough');
      if(entry.reward)walletFeedback(entry.reward);
      transportNotice={kind:'restored',title:`第 ${entry.waveNumber} 波击破，转载恢复`,detail:'反攻窗口已打开 · 说服 ×2.2，传播 ×1.35',until:feedbackClock+6500};
      feedback(`第 ${entry.waveNumber} 波，扛过去了`,entry.detail,`+${entry.reward||RULES.counterReward} 行动点`,'success',110,7000);
      eventTargets().forEach(id=>pulseRegion(id,'转载恢复'));
    }
    if(entry.type==='counter-progress')feedback('新证据补上，澄清加速','证据正在削弱对手的攻击。',entry.title.match(/\+[\d.]+%/)?.[0]||'澄清加速','success',85,5500);
    if(entry.type==='milestone'){gameAudio.emit('milestone');walletFeedback(4);feedback(entry.title,'新的支持者加入，行动点已到账。','+4 点','success',25);}
    if(entry.type==='backlash'){
      gameAudio.emit('damage');
      const loss=Number(entry.title.match(/−([\d.]+)/)?.[1]||0);largestHit=Math.max(largestHit,loss);feedback('主攻命中，支持者正在流失','澄清进度和阵地防守共同减轻这次冲击；继续查证能推进澄清。',`−${loss.toFixed(1)}%`,'danger',100,8500);animate($('map-wrap'),'hit-flash',1200);eventTargets().forEach(id=>pulseRegion(id, '遭到反扑','loss'));
    }
    seenLog=entry.id;
  }
  for(const result of game.researchResults.slice(seenResults)){
    const round=uiResearchRound(result.roundId);if(!round)continue;
    gameAudio.emit('evidence');
    feedback(game.researchMode==='live'?'搜到新材料了':'这条线索查明了',result.investigation?.delta||result.detail||round.finding,game.researchMode==='live'?'证据 +1':'有效证据 +1','success',70,7000);
    animate($('truth-value'),'just-bought',1600);
    interrupts.unshift({type:'research-result',result});
    markAction('research-result',result.roundId);
  }
  seenResults=game.researchResults.length;
  const researchStatus=getResearchStatus(game);
  if(researchStatus.available&&!seenClues.has(researchStatus.roundId)){
    seenClues.add(researchStatus.roundId);researchSeen=false;
    animate($('search-button'),'affordable-once',1500);
    feedback(researchStatus.roundNumber===1?'可以寻找第一条证据了':'上一条线索，可以继续追了',researchStatus.roundNumber===1?'选择一条线索，查回证据就能甩出实锤。':researchStatus.query,'','neutral',35,6000);
  }
  for(const region of game.regions){
    const name=REGIONS.find(item=>item.id===region.id).name;
    if(!freedRegions.has(region.id)&&region.blue>=90){gameAudio.emit('milestone');freedRegions.add(region.id);pulseRegion(region.id,'90% 相信');feedback(`${name}多数人站到了你这一边`,'这个地区的多数人也会继续传播。','地区突破','success',25);}
  }
  const stats=getStats(game);
  for(const threshold of [25,50,75,90])if(stats.truth>=threshold&&!truthMilestones.has(threshold)){
    if(game.operationPhase!=='public'||performance.now()<=celebrationUntil)continue;
    truthMilestones.add(threshold);gameAudio.emit('milestone');const keyMilestone=threshold===50||threshold===90;
    if(keyMilestone)animate($('truth-value'),'just-bought',1600);
    feedback(threshold===50?'超过一半的世界站在你这边':threshold===90?'九成支持，守住优势！':'更多人开始相信你',threshold===90?`冲到 ${RULES.winTruth}% 就能夺回世界，胜利后反扑立即停止。`:'支持者会继续带动传播，也会增加行动点收入。',`${threshold}% 相信`,'success',keyMilestone?70:20);
  }
  if(game.event?.resolved&&publicationSnapshot&&!recoveryAnnounced&&largestHit>0&&eventTargets().every(id=>game.regions.find(region=>region.id===id).blue>=publicationSnapshot[id])){recoveryAnnounced=true;gameAudio.emit('breakthrough');feedback('失地夺回！','被反扑击退的地区，已经恢复到甩锤时的支持水平。','反攻成功','success',65);eventTargets().forEach(id=>pulseRegion(id,'失地夺回'));}
}
function eventTargets() {return game?.event?.regionIds||[];}
function queueEnemyIntro() {
  const event=game?.event;
  if(game?.phase!=='playing'||!event||event.resolved||enemyIntros.has(event.id))return;
  enemyIntros.add(event.id);
  publicationSnapshot=Object.fromEntries(game.regions.map(region=>[region.id,region.blue]));
  recoveryAnnounced=false;largestHit=0;
  interrupts.unshift({type:'enemy-intro',waveId:event.id});
}
function flushInterrupts(now) {
  if(!game||game.phase!=='playing'||tutorial.isOpen()||document.hidden||$('pitch-dialog')?.open||$('sound-dialog').open||$('leaderboard-dialog').open||$('result-dialog').open||manualPaused||$('detail-dialog').open||$('intro-dialog').open||now<celebrationUntil)return;
  const next=interrupts.shift();if(!next)return;
  if(next.type==='enemy-intro'&&game.event?.id===next.waveId&&!game.event.resolved)showEnemyDecision();
  if(next.type==='research-result'&&!next.result.promotedId)showResearchResult(next.result);
}
function showVictorySettlement() {
  if(!isVictorySettling())return;
  if(victoryPresentation)victoryPresentation.waitingShown=true;
  const entry=currentInvestigationEntry();
  if(entry)showInvestigationProgress(entry.requestId);
}

function renderOutcome(now) {
  if(!game||game.phase==='playing'||resultShown||tutorial.isOpen()||publicationScene||$('pitch-dialog')?.open)return;
  if(game.phase==='won'){
    if(!victoryPresentation||victoryPresentation.state!==game){
      victoryPresentation={state:game,until:now+1000,waitingShown:false};
      gameAudio.emit('win');interrupts=[];detailPauseBeforeOpen=null;enemyNotice=null;
      document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());detailType='';detailResultId=null;
      $('burst').innerHTML=`<strong>${RULES.winTruth}%</strong><span>世界，相信了你的反驳。</span>`;$('burst').hidden=false;
    }
    if(now<victoryPresentation.until)return;
    $('burst').hidden=true;
    if(isVictorySettling()){
      if(!victoryPresentation.waitingShown)showVictorySettlement();
      return;
    }
  }else{
    gameAudio.emit('lose');
    game.research=null;
    renderFieldFeed();renderResearch();
  }
  void cancelInvestigationSession(game);
  cancelLiveRequest();resultShown=true;interrupts=[];detailPauseBeforeOpen=null;enemyNotice=null;
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());detailType='';detailResultId=null;
  if(game.phase==='won'&&isAgentGame(game))void requestFinalVerdict();else showEndingCinematic();
}
function render() {
  const agent=isAgentGame(game);
  text('support-heading',agent?'支持核查':'相信真相');text('reach-heading',agent?'内容触达':'听过真相');
  text('red-legend',agent?'未接受核查':'相信谎言');text('blue-legend',agent?'支持核查':'相信真相');
  setHTML('victory-target',`<span>支持率达到 <b>${RULES.winTruth}%</b> 即获胜</span>`);
  document.querySelector('.truth-track').style.setProperty('--win-target',`${RULES.winTruth}%`);
  const now=performance.now(),stats=game?getStats(game):{truth:0,reached:0,income:0};
  text('case-claim',game?.claim||CASE.claim);$('report-button').hidden=!game||game.phase==='playing'||isVictorySettling()||!resultShown;
  $('leaderboard-button').disabled=isVictorySettling()||game?.finalReview?.status==='pending';
  detectEvents();
  const displayedTruth=game?.phase==='playing'&&stats.truth<RULES.winTruth?Math.min(stats.truth,RULES.winTruth-.1):stats.truth;
  setHTML('truth-value',`${displayedTruth.toFixed(1)}<small>%</small>`);$('truth-value').classList.toggle('falling',game?.phase==='playing'&&(stats.netRate||0)<-.015);$('truth-bar').style.width=`${stats.truth}%`;
  setHTML('reach-value',`${stats.reached.toFixed(0)}<small>%</small>`);$('reach-bar').style.width=`${stats.reached}%`;renderWorldClock(game?.time||0);
  text('points-value',Math.floor(game?.points??24));text('income-note',game?`每小时 +${(stats.income*WORLD_SECONDS_PER_HOUR).toFixed(2)} 点`:'自动积累');
  const paused=isPaused();$('pause-button').disabled=!game||game.phase!=='playing'||now<celebrationUntil;text('pause-button',paused?'▶':'Ⅱ');$('pause-button').setAttribute('aria-label',now<celebrationUntil?'实锤公布中':paused?'继续':'暂停');document.body.classList.toggle('paused',paused);
  renderMap();renderCoins();renderMediaEvent();renderUpgrades();renderResearch();renderPublish();renderOpponent();renderFeedback(feedbackClock);renderJourney(now);renderFieldFeed();renderInvestigationProgress();
  renderOutcome(now);
  if(game?.phase==='playing'){renderPauseSummary();flushInterrupts(now);}
  updateAudioScene();
}

function openDetail(html,type='other',resultId=null) {
  const dialog=$('detail-dialog');
  if($('pause-dialog').open)$('pause-dialog').close();
  dialog.classList.remove('enemy-folding');
  if(!dialog.open)detailPauseBeforeOpen=manualPaused;
  detailType=type;detailResultId=resultId;dialog.dataset.view=type;dialog.querySelector('.dialog-status').textContent=game?.phase==='won'?'✓ 胜利已锁定':game?.phase==='lost'?'本局已结束':'Ⅱ 战局已暂停';$('detail-content').innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;lastFrame=performance.now();renderJourney(performance.now());updateAudioScene();const heading=$('detail-content').querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
function closeDetail(redraw=true) {
  enemyNotice=null;
  const stored=game?.phase==='playing'&&detailType==='research-result'?game.researchResults.find(result=>result.roundId===detailResultId&&!result.promotedId):null;
  if(stored&&stored.storedAt==null){if(redraw!==false)gameAudio.emit('store');stored.storedAt=game.time;const material=getSelectedEvidence(game,stored);addFieldMessage(fieldFeed,{id:`stored:${stored.roundId}`,time:game.time,source:'证据档案',title:'证据已收入囊中',detail:material?.insight?.headline||material?.title,action:{type:'research-result',roundId:stored.roundId}});feedback('证据已收入囊中','随时点击右下角公布实锤。','','success',60);}
  else if(redraw!==false&&$('detail-dialog').open)gameAudio.emit('close');
  if(detailPauseBeforeOpen!==null)manualPaused=detailPauseBeforeOpen;
  detailPauseBeforeOpen=null;$('detail-dialog').classList.remove('enemy-folding');$('detail-dialog').close();detailType='';detailResultId=null;lastFrame=performance.now();
  if(redraw!==false)render();
}
function canOpenResearch(status) {
  if(!game||!status)return false;
  if(game.phase!=='playing')return Boolean(currentInvestigationEntry());
  return Boolean(status.available||['searching','planning','refreshing','ready-to-publish','complete','plan-error'].includes(status.phase));
}
function showSearch() {
  if(!game)return;const status=getResearchStatus(game);if(!canOpenResearch(status))return;
  if(game.research||game.phase!=='playing'||status.phase==='complete'){
    const entry=currentInvestigationEntry();if(entry){showInvestigationProgress(entry.requestId);return;}
  }
  researchSeen=true;if(['ready','ready-to-publish','searching'].includes(status.phase))researchSeenRound=Math.max(researchSeenRound,status.roundNumber);
  if(status.phase==='ready-to-publish'){showResearchResult(status.pendingEvidence);return;}
  if(status.phase==='complete'){showArchive();return;}
  if(isAgentGame(game)){showAgentSearch(status);return;}
  const round=uiResearchRound(status.roundId),previous=game.researchResults.findLast(result=>result.promotedId),material=previous?getSelectedEvidence(game,previous):null;
  const questions=[...new Set([status.query,...(round?.querySuggestions||[])])].filter(Boolean).slice(0,2);
  const trail=material?`<div class="research-trail"><span>上轮查到</span><p>${esc(material.finding)}</p></div>`:'';
  const choices=questions.map((question,index)=>`<article class="lead-option"><span class="lead-number">0${index+1}</span><h3>${esc(question)}</h3><button class="primary" data-search-query="${esc(question)}" ${status.available?'':'disabled'}>查这条 · ${status.cost} 金币 <span>→</span></button></article>`).join('');
  openDetail(`<span class="tag">第 ${status.roundNumber} / ${RESEARCH_ROUNDS.length} 次调查</span><h2>${previous?'接着查哪条线索？':'先从哪条线索下手？'}</h2>${trail}<p class="research-intro">选一个方向，查回一份能出手的证据。</p>${status.error?`<p class="research-error" role="alert">${esc(status.error.message)}</p>`:''}<div class="lead-options demo-leads">${choices}</div><div class="search-footer"><p>离线演示 · 使用预置调查资料</p><button class="secondary" id="search-return">回到战局</button></div>`,'search');
}

function showAgentSearch(status=getResearchStatus(game)) {
  const pending=Boolean(planRequest)||status.phase==='planning',planError=status.planError||game.investigation?.planError;
  if(pending||status.phase==='plan-error'){
    openDetail(`<span class="tag">调查准备 · 不花金币</span><h2>${pending?'先找突破口，你先铺开传播。':'调查还没准备好。'}</h2><p class="investigation-claim">${esc(game.claim)}</p><div class="investigation-wait"><span class="search-live-dot" aria-hidden="true">${pending?'•••':'↻'}</span><p>${pending?'正在把这句传闻拆成值得追查的问题。回到地图升级、收金币，准备好会提醒你。':esc(typeof planError==='string'?planError:planError?.message||'暂时没有取得调查方向，可以重新准备。')}</p></div><div class="dialog-actions">${pending?'':`<button class="primary" id="retry-plan">重新准备调查 <span>→</span></button>`}<button class="${pending?'primary':'secondary'}" id="search-return">回地图收金币</button></div>`,'search');return;
  }
  const previous=game.researchResults.findLast(result=>result.promotedId),material=previous?uiEvidenceMaterial(previous.promotedId):null,need=Math.max(0,(status.cost||0)-game.coins),ready=status.phase==='ready',refreshing=status.phase==='refreshing',searching=status.phase==='searching',leads=status.leads||game.investigation?.leads||[];
  const trail=material?`<div class="research-trail"><span>上轮查到</span><p>${esc(material.insight?.explanation||material.finding)}</p>${materialSourceLinks(material,true)}</div>`:'';
  const refreshError=game.investigation?.refreshError;
  const error=refreshError?`<p class="research-error" role="alert">${esc(refreshError.message||refreshError)}</p>`:game.researchError?.roundId===status.roundId?`<p class="research-error" role="alert">${esc(game.researchError.message)} 金币已退回，这次机会还在。</p>`:'';
  if(searching){
    const chosen=game.research?.chosenLead||leads.find(lead=>lead.id===game.research?.leadId);
    openDetail(`<span class="tag">第 ${status.roundNumber} / ${RESEARCH_ROUNDS.length} 次调查 · 本轮经费已付</span><h2>正在查：${esc(chosen?.title||'这条线索')}</h2><p class="investigation-claim">${esc(chosen?.question||game.research?.query||game.claim)}</p><div class="investigation-wait"><span class="search-live-dot" aria-hidden="true">•••</span><p>正在查找来源、对照材料，整理本轮证据。查完会把最适合当前战局的证据交给你。</p></div><div class="search-footer"><p>留在这里，战局暂停；回到地图可以继续经营。完成后会提醒你。</p><button class="secondary" id="search-return">回到战局</button></div>`,'agent-search');return;
  }
  const choices=leads.map((lead,index)=>`<article class="lead-option"><span class="lead-number">0${index+1}</span><h3>${esc(lead.title)}</h3><p class="lead-question">${esc(lead.question)}</p><p class="lead-reason">${esc(lead.reason)}</p><button class="primary" data-investigate="${esc(lead.id)}" ${!ready||need?'disabled':''}>${refreshing?'正在换题…':!ready?(status.actionLabel||status.reason):need?`还差 ${need} 金币`:`查这条 · ${status.cost} 金币`} <span>→</span></button></article>`).join('');
  openDetail(`<span class="tag">第 ${status.roundNumber} / ${RESEARCH_ROUNDS.length} 次调查 · 持有 ${game.coins} 金币</span><h2>${material?'线索有了，接着查哪边？':'先从哪条线索下手？'}</h2>${trail}<div class="research-choice-toolbar"><p class="research-intro" role="status">${refreshing?'沿着已有线索，换两个新问题…':'选一个方向，查回一份能出手的证据。'}</p><button class="secondary refresh-leads" id="refresh-leads" ${!ready||game.coins<1?'disabled':''} aria-busy="${refreshing}"><span class="refresh-glyph" aria-hidden="true">↻</span>${refreshing?'正在换题…':'换一组 · 1 金币'}</button></div>${error}<div class="lead-options${refreshing?' refreshing':''}" aria-busy="${refreshing}">${choices}</div><div class="search-footer"><p>${refreshing?'换题不占调查次数，可以回到战局等待。':!ready?esc(status.reason):'查证未完成会退回查证经费；换题不占调查次数。'}</p><button class="secondary" id="search-return">${need?'回地图收金币':'回到战局'}</button></div>`,'agent-search');
}

const flowIconPaths={
  lead:'M10 5h12v4h3v4H7V9h3zM4 13h24v4H4zM9 19h5v3H9zm9 0h5v3h-5zM11 25h10v3H11z',
  search:'M4 8h6v5h12V8h6v11h-3v6H7v-6H4zM12 5h8v5h-8z',
  verify:'M5 4h16v3H8v22H5zM10 9h10v3H10zm0 6h7v3h-7zm9 7h3v-3h3v-3h3v6h-3v3h-3v3h-6v-3h-3v-3h3v-3h3z',
  report:'M6 3h16v3h4v23H6zm3 4v3h10V7zm0 7v2h12v-2zm0 5v2h8v-2zm9 4v3h5v-3z',
};
function investigationSourcesMarkup(step,stepIndex) {
  if(step.stage!=='sources'||!step.sources?.length)return '';
  const sources=step.sources.map((source,index)=>{
    const url=uiSafeSourceUrl(source.url);if(!url)return '';
    const host=new URL(url).hostname.replace(/^www\./,''),site=source.organization&&source.organization!==host?`${source.organization} · ${host}`:host;
    return `<li><a id="progress-source-${stepIndex}-${index}" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="investigation-source-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span class="investigation-source-copy"><b>${esc(source.title||host)}</b><span>${esc(site)}</span></span><span class="investigation-source-arrow" aria-hidden="true">↗</span></a></li>`;
  }).join('');
  return sources?`<ol class="investigation-sources" aria-label="检索找到的来源">${sources}</ol>`:'';
}
function investigationProgressMarkup(entry) {
  if(entry.demo)return `<div class="investigation-console"><span class="tag">第 ${entry.round} 轮 · 预置资料</span><h2>核对调查资料</h2>${fieldEntryMarkup(entry)}<div class="investigation-console-actions"><button class="secondary" id="search-return">回到战局</button></div></div>`;
  const flow=getInvestigationFlow(entry),result=game?.researchResults.find(item=>item.roundId===entry.roundId),running=flow.status==='running';
  const settling=running&&isVictorySettling()&&entry.requestId===game.research.requestId;
  const state=flow.status==='completed'?(entry.publicationState||'证据已到'):flow.status==='failed'?'本轮未完成':'查证中';
  const nodeStatus={queued:'待开始',active:'进行中',done:'已完成',failed:'未完成'};
  const nodes=flow.nodes.map((node,index)=>`<article class="flow-node" data-node="${node.id}" data-state="${node.state}" ${node.state==='active'?'aria-current="step"':''}><span class="flow-node-number">0${index+1}</span><span class="flow-node-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="currentColor" shape-rendering="crispEdges"><path fill-rule="evenodd" d="${flowIconPaths[node.id]}"></path></svg></span><b>${esc(node.label)}</b><span class="actor">${esc(node.actor)}</span><small class="flow-node-state">${nodeStatus[node.state]||''}</small></article>`).join('');
  const steps=flow.steps.map((step,index)=>`<li data-current="${running&&index===flow.steps.length-1}"><span class="step-actor">${esc(step.actor)}</span><strong>${esc(step.title)}</strong>${step.detail?`<span class="step-detail">${esc(step.detail)}</span>`:''}${investigationSourcesMarkup(step,index)}</li>`).join('');
  const metrics=[flow.sourceCount!=null?`<div><b>${flow.sourceCount}</b><span>条来源已找到</span></div>`:'',flow.searchCount?`<div><b>${flow.searchCount}</b><span>次检索已发起</span></div>`:''].join('');
  const question=entry.query||game?.claim||'';
  return `<div class="investigation-console"><div class="investigation-console-heading"><span class="tag">第 ${entry.round} / ${RESEARCH_ROUNDS.length} 轮调查</span><span class="investigation-state" data-status="${flow.status}">${settling?'胜利已锁定 · 调查继续':state}</span></div><h2>追查现场</h2><div class="investigation-question"><span>本轮追查</span><p>${esc(question)}</p></div><div class="investigation-flow" aria-label="调查执行流程">${nodes}</div><div class="investigation-workspace"><section class="investigation-current" data-status="${flow.status}" aria-live="polite"><span class="kicker">${running?'正在推进':flow.status==='completed'?'本轮发现':'调查反馈'}</span><h3>${esc(flow.status==='completed'&&entry.evidenceTitle?entry.evidenceTitle:flow.title)}</h3><p>${esc(flow.status==='completed'?entry.finding||flow.detail:flow.status==='failed'?entry.detail||flow.detail:flow.detail)}</p>${metrics?`<div class="investigation-metrics">${metrics}</div>`:''}${running&&flow.followup?'<p class="investigation-loop">↶ 调查员发现缺口，已交给元宝继续补查。</p>':''}${settling?'<p>通关时间已记下。这份材料查完后会收入战报。</p>':''}</section><section class="investigation-journal"><h3>执行记录</h3><ol class="investigation-timeline">${steps||`<li><strong>${running?'调查已提交':'过程已结束'}</strong><span class="step-detail">${running?'等待元宝返回检索进度。':'这轮没有保存详细执行记录。'}</span></li>`}</ol></section></div><div class="investigation-console-actions">${flow.status==='completed'&&result?`<button class="primary" id="progress-evidence" data-feed-report="${esc(entry.roundId)}">查看这份证据 <span>↗</span></button>`:flow.status==='failed'&&game?.phase==='playing'?`<button class="primary" id="progress-retry" ${getResearchStatus(game).available?'':'disabled'}>重新选择调查方向 <span>→</span></button>`:''}<button class="secondary" id="search-return">回到战局</button></div></div>`;
}
function showInvestigationProgress(requestId) {
  const entry=fieldFeed.entries.find(item=>item.kind==='investigation'&&item.requestId===requestId);if(!entry)return;
  const markup=investigationProgressMarkup(entry);
  openDetail(markup,'investigation-progress',requestId);$('detail-content')._progressMarkup=markup;
  if(game?.phase==='playing'&&entry.status==='running')$('detail-dialog').querySelector('.dialog-status').textContent='Ⅱ 战局已暂停 · 调查继续';
}
function renderInvestigationProgress() {
  if(detailType!=='investigation-progress'||!$('detail-dialog').open)return;
  const entry=fieldFeed.entries.find(item=>item.kind==='investigation'&&item.requestId===detailResultId);if(!entry)return;
  const content=$('detail-content'),markup=investigationProgressMarkup(entry);if(content._progressMarkup===markup)return;
  const dialog=$('detail-dialog'),scroll=dialog.scrollTop,journal=content.querySelector('.investigation-timeline');
  const journalScroll=journal?.scrollTop||0,following=!journal||journal.scrollHeight-journal.scrollTop-journal.clientHeight<24;
  const sourceLists=journal?.querySelectorAll('.investigation-sources').length||0;
  const focused=document.activeElement?.id;
  content._progressMarkup=markup;content.innerHTML=markup;dialog.scrollTop=scroll;
  const next=content.querySelector('.investigation-timeline');
  if(next){
    const lists=next.querySelectorAll('.investigation-sources');
    if(following&&lists.length>sourceLists){const step=lists[lists.length-1].parentElement;next.scrollTop=step.getBoundingClientRect().top-next.getBoundingClientRect().top+next.scrollTop;}
    else next.scrollTop=following?next.scrollHeight:journalScroll;
  }
  if(focused&&content.querySelector(`#${CSS.escape(focused)}`))$(focused).focus({preventScroll:true});
  if(game?.phase==='playing')dialog.querySelector('.dialog-status').textContent=entry.status==='running'?'Ⅱ 战局已暂停 · 调查继续':'Ⅱ 战局已暂停';
}

function askPublish() {
  if(game&&getPublishPreview(game).available&&!publicationScene)performPublish();
}

function performPublish() {
  if(!game||publicationScene)return;
  const outcome=publishEvidence(game);if(!outcome.ok){gameAudio.emit('error');feedback(outcome.reason,'','','neutral',80);return;}
  firstMovePending=false;
    markAction('publish',outcome.roundId);closeDetail(false);
  publicationScene={state:game,outcome,elapsed:0,reduced:reducedMotion.matches,impactPlayed:reducedMotion.matches};
  gameAudio.setScene('publication');gameAudio.emit(publicationScene.reduced?'impact':'publish');
  celebrationUntil=Infinity;
  const dialog=$('publication-dialog');dialog.dataset.stage=publicationScene.reduced?'sealed':'arriving';
  dialog.classList.toggle('reduced-motion',publicationScene.reduced);
  dialog.classList.toggle('long-title',[...outcome.title].length>48);
  text('publication-title',outcome.title);text('publication-date',worldTime(game.time).label);
  text('publication-number',`证据 ${String(game.publications.length).padStart(2,'0')}`);
  text('publication-gain',`+${outcome.gain.toFixed(1)}% 支持率`);
  text('publication-effect',getMaterialEffect(outcome.material).label+(outcome.counterProgressGain?` · 澄清 +${Math.round(outcome.counterProgressGain)}%`:''));
  dialog.showModal();lastFrame=performance.now();render();
}
function finishPublicationScene() {
  const scene=publicationScene;if(!scene)return;
  publicationScene=null;celebrationUntil=0;$('publication-dialog').close();
  if(game!==scene.state)return;
  const {outcome}=scene;
  animate(document.querySelector(`[data-card="${outcome.material.focus}"]`),'just-bought',1600);
  animate($('map-wrap'),'map-flash',1000);
  feedback('实锤已甩出',outcome.title,`+${outcome.gain.toFixed(1)}% · ${getMaterialEffect(outcome.material).label}`,'success',95,6000);
  const region=[...game.regions].sort((a,b)=>b.blue-a.blue)[0];if(region)pulseRegion(region.id,'实锤落地');
  queueEnemyIntro();
  lastFrame=performance.now();render();
}
function advancePublicationScene(dt) {
  const scene=publicationScene;if(!scene||document.hidden)return;
  if(scene.state!==game){publicationScene=null;$('publication-dialog').close();return;}
  scene.elapsed+=dt*1000;
  if(!scene.impactPlayed&&scene.elapsed>=1000){scene.impactPlayed=true;gameAudio.emit('impact');}
  const end=scene.reduced?1500:2850;
  if(scene.elapsed>=end){finishPublicationScene();return;}
  const stage=scene.reduced?'sealed':scene.elapsed<400?'arriving':scene.elapsed<1000?'approach':scene.elapsed<1250?'impact':scene.elapsed<2500?'sealed':'leaving';
  if($('publication-dialog').dataset.stage!==stage)$('publication-dialog').dataset.stage=stage;
}

function showEnemyDecision() {
  const event=game?.event;if(!event||event.resolved)return;
  const state=game,names=eventTargets().map(regionName).join('、');
  openDetail(`<span class="tag">谎言公司的反击 · 第 ${event.waveNumber} / ${getCampaignStatus(game).total} 波</span><h2>${esc(event.waveName)}</h2><p>${esc(names)}被盯上了。${event.waveNumber===1?'发起澄清，逐步击破反扑。':'攻势升级。发起新一轮澄清，守住阵地。'}</p><p class="enemy-notice-impact"><b>${worldRemaining(event.remaining||0)}后发动主攻</b></p><div class="enemy-notice-track" aria-hidden="true"><i></i></div>`,'enemy');
  gameAudio.emit('warning');enemyNotice={state,remaining:2000};
}
function advanceEnemyNotice(dt) {
  if(!enemyNotice)return;
  if(game!==enemyNotice.state||detailType!=='enemy'||!$('detail-dialog').open){enemyNotice=null;return;}
  if(document.hidden)return;
  enemyNotice.remaining-=dt*1000;
  const track=document.querySelector('.enemy-notice-track i');if(track)track.style.transform=`scaleX(${Math.max(0,enemyNotice.remaining/2000)})`;
  if(enemyNotice.remaining>0)return;
  const state=enemyNotice.state;enemyNotice=null;
  if(reducedMotion.matches){closeDetail();return;}
  const dialog=$('detail-dialog'),from=dialog.getBoundingClientRect(),to=$('opponent').getBoundingClientRect();
  dialog.style.setProperty('--enemy-fold-x',`${to.x+to.width/2-from.x-from.width/2}px`);dialog.style.setProperty('--enemy-fold-y',`${to.y+to.height/2-from.y-from.height/2}px`);dialog.classList.add('enemy-folding');
  later(()=>{if(game===state&&detailType==='enemy'){closeDetail();animate($('opponent'),'just-bought',900);}},340);
}

function sourceLinks(ids) {return (ids||[]).map(id=>RESEARCH_SOURCES[id]||getSourceById(id)).filter(Boolean).map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.organization||'原始资料')} · ${esc(source.title)} ↗</a>`).join('');}
function materialSourceLinks(material,compact=false) {
  if(!material.sources)return `<div class="source-links">${sourceLinks(material.sourceIds)}</div>`;
  return `<div class="source-links live-source-links">${material.sources.filter(source=>uiSafeSourceUrl(source.url)).map(source=>`<a href="${esc(uiSafeSourceUrl(source.url))}" target="_blank" rel="noopener noreferrer" title="${esc(source.title)}">${esc(source.organization||new URL(source.url).hostname)}${compact?' · 原文':` · ${esc(excerpt(source.title,34))}`} ↗</a>${!compact&&source.date?`<span>${esc(sourceDate(source.date))}</span>`:''}`).join('')}</div>`;
}
const textArticleImage='./assets/text-article.png';
function materialSourceImage(material) {
  const sources=material.sources||(material.sourceIds||[]).map(id=>RESEARCH_SOURCES[id]||getSourceById(id)).filter(Boolean);
  const source=sources.find(item=>uiSafeSourceUrl(item.imageUrl))||sources[0],imageUrl=uiSafeSourceUrl(source?.imageUrl),url=uiSafeSourceUrl(source?.url);
  const picture=`<img src="${esc(imageUrl||textArticleImage)}" alt="${esc(imageUrl?source.imageCaption||'原文配图':'像素风文字报道插图')}" ${imageUrl?'data-article-image':''} referrerpolicy="no-referrer" decoding="async"><figcaption>${imageUrl?'原文配图':'文字报道 · 暂无配图'}</figcaption>`;
  return `<figure class="evidence-image ${imageUrl?'has-source-image':'text-article'}">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="查看原始报道">${picture}</a>`:picture}</figure>`;
}
function investigationFinding(result) {
  if(result.assessment){const label={supported:'材料支持原说法',refuted:'材料不支持原说法',mixed:'需要补上条件',insufficient:'暂时无法下结论'}[result.assessment.status]||'本轮发现';return `<div class="investigation-finding"><p><strong>${label}</strong>${esc(result.assessment.summary)}</p></div>`;}
  const investigation=result.investigation;
  if(!investigation)return '';
  const finding=investigation.delta||investigation.summary;
  return `<div class="investigation-finding">${investigation.previousFinding?`<p class="previous-finding"><span>接着上轮</span>${esc(investigation.previousFinding)}</p>`:''}<p><strong>本轮新发现</strong>${esc(finding)}</p></div>`;
}
function showResearchResult(result) {
  if(!result)return;interrupts=interrupts.filter(item=>item.type!=='research-result'||item.result.roundId!==result.roundId);
  const round=uiResearchRound(result.roundId),material=getSelectedEvidence(game,result);if(!round||!material)return;
  const published=Boolean(result.promotedId),ended=game.phase!=='playing',effect=getMaterialEffect(material),preview=getPublishPreview(game),headline=material.insight?.headline||material.title;
  const quote=material.insight?.quote,explanation=material.insight?.explanation||material.finding;
  const sourceSummary=(material.sources?.[0]||RESEARCH_SOURCES[material.sourceIds?.[0]]||getSourceById(material.sourceIds?.[0]))?.summary;
  const assessment=result.assessment?.summary,context=result.chosenLead?.question||result.query;
  const ability=material.effectReason||(material.focus==='spread'?'让证据更容易被转载，更多地区会听到你的发现。':'让已经听过真相的人更快转为支持。');
  const extra=uiEvidenceEffect(material);
  openDetail(`<div class="evidence-report-top"><span class="tag">第 ${round.round} 份证据 / ${RESEARCH_ROUNDS.length}</span><span class="evidence-report-state">${published?'已公布':'证据 +1 · 已归档'}</span></div><h2 class="evidence-report-title">${esc(headline)}</h2><p class="evidence-report-question">追查：${esc(context)}</p><div class="evidence-report-body"><div class="evidence-report-source">${materialSourceImage(material)}${materialSourceLinks(material)}<div class="evidence-power"><span>${ended?published?'本局已生效':'本局未公布':published?'持续生效':'公布后生效'}</span><strong>${effect.label.split(' · ').map(part=>`<span>${esc(part)}</span>`).join('')}</strong><p>${esc(ability)}</p>${extra?`<p>${esc(extra)}</p>`:''}</div></div><div class="evidence-report-reading"><section><h3>查到了什么</h3><p>${esc(explanation)}</p></section>${quote?`<blockquote class="evidence-original"><span>原文依据</span><p>${esc(quote)}</p></blockquote>`:sourceSummary&&sourceSummary!==explanation?`<section class="evidence-conclusion"><h3>资料说明</h3><p>${esc(sourceSummary)}</p></section>`:''}${assessment&&assessment!==explanation?`<section class="evidence-conclusion"><h3>这说明什么</h3><p>${esc(assessment)}</p></section>`:''}</div></div>${published||ended?'<div class="evidence-report-actions"><button class="secondary" id="continue-battle">回到战局</button></div>':`<div class="evidence-publish-impact"><span>${esc(publicationThreat())}</span><strong>支持率 +${preview.gain.toFixed(1)}%</strong></div><div class="evidence-report-actions"><button class="primary" id="throw-evidence" ${preview.available?'':'disabled'}>甩出实锤 <span>↗</span></button><button class="secondary" id="store-evidence">收入囊中</button></div>`}`,'research-result',result.roundId);
}

function showArchive(roundId=null) {
  const entries=(game?.researchResults||[]).map(result=>{
    const round=uiResearchRound(result.roundId),material=getSelectedEvidence(game,result);if(!round||!material)return '';
    const state=result.promotedId?'已公布':result.storedAt!=null?'已收入囊中':'待公布';
    return `<article class="evidence-entry" id="archive-${esc(result.roundId)}"><small>第 ${round.round} 轮 · ${worldTime(result.time).stamp} · ${state}</small><h3>${esc(material.insight?.headline||material.title)}</h3><p>追查：${esc(result.chosenLead?.question||result.query)}</p><p>${esc(material.insight?.explanation||material.finding)}</p>${result.assessment?investigationFinding(result):''}${material.insight?.quote?`<blockquote class="evidence-quote"><span>原文依据</span>${esc(material.insight.quote)}</blockquote>`:''}${materialSourceLinks(material)}<p class="archive-effect">${result.promotedId?'已生效':'公布后生效'} · ${esc(getMaterialEffect(material).label)}</p><button class="secondary" data-feed-report="${esc(result.roundId)}">${result.promotedId?'查看证据报告':'查看待公布证据'} ↗</button></article>`;
  }).join('');
  const events=(game?.evidenceEvents||[]).filter(event=>event.startedAt!=null&&event.startedAt<=game.time);
  openDetail(`<h2>这局沿着哪些线索走过。</h2><p class="investigation-claim">${esc(game?.claim||CASE.claim)}</p><p>已完成 ${game?.evidence.length||0} / ${RESEARCH_ROUNDS.length} 轮调查 · 已公布 ${game?.publications.length||0} 份证据</p>${entries||'<p>选择调查方向，查到的证据会存放在这里。</p>'}${events.length?`<h3>证据引发的热点</h3><div class="story-history">${events.map(event=>`<button data-evidence-story="${esc(event.eventId)}"><span>${esc(RESEARCH_EVENTS[event.eventId]?.title||event.eventId)}</span><small>查看出处 ↗</small></button>`).join('')}</div>`:''}`,'archive');
  if(typeof roundId==='string')document.getElementById(`archive-${roundId}`)?.scrollIntoView({block:'start'});
}

function showHelp() {
  if(!game)return;
  tutorial.start();lastFrame=performance.now();render();
}

// A match has its own ID; revisiting the ranking never submits another score.
let rankingRunId=newUuid(),rankingRequest=0,rankingReportRequest=0,rankingData=null,rankingReturnToReport=false;
const detectiveProfile=(()=>{
  let saved;try{saved=JSON.parse(localStorage.getItem('lie-company-detective'));}catch{}
  const ownerToken=/^[a-f0-9-]{36}$/i.test(saved?.ownerToken||'')?saved.ownerToken:newUuid();
  return {ownerToken,name:typeof saved?.name==='string'&&saved.name.trim()?saved.name.slice(0,20):`侦探${ownerToken.slice(0,4).toUpperCase()}`,lastRunId:typeof saved?.lastRunId==='string'?saved.lastRunId:null};
})();
function saveDetectiveProfile(){try{localStorage.setItem('lie-company-detective',JSON.stringify(detectiveProfile));}catch{}}
async function rankingAPI(path='',options={}){
  const response=await fetch(`/api/leaderboard${path}`,{...options,headers:{'Content-Type':'application/json','X-Lie-Company':'research'},signal:AbortSignal.timeout(15000)});
  let payload;try{payload=await response.json();}catch{throw new Error('排行暂时没有加载出来，请重试。');}
  if(!response.ok||!payload.ok)throw new Error(payload.error?.message||'排行暂时没有加载出来，请重试。');
  return payload.result;
}
function rankingError(error){text('leaderboard-status',error.name==='TimeoutError'?'排行加载超时，请重试。':error instanceof TypeError?'暂时连不上排行榜，请重试。':error.message||'排行暂时不可用，请重试。');}
function rankingRow(entry,currentId){
  return `<tr class="${entry.id===currentId?'is-you':''}"><td><b class="rank-number">${entry.rank}</b></td><td>${esc(entry.name)}${entry.id===currentId?'<span class="ranking-you">你</span>':''}</td><td class="ranking-claim">${esc(entry.claim)}</td><td class="ranking-time">${esc(worldDuration(entry.elapsed))}</td><td><button class="ranking-report" data-ranking-report="${esc(entry.id)}">查看报告 ↗</button></td></tr>`;
}
function renderLeaderboard(data){
  rankingData=data;const current=data.current;
  $('leaderboard-own').hidden=!current;
  text('leaderboard-total',`${data.total} 次成功结案 · 消耗时间升序`);
  if(current){
    text('leaderboard-rank',`第 ${current.rank} 名`);text('leaderboard-time',worldDuration(current.elapsed));
    text('leaderboard-own-label',current.id===rankingRunId?'本次名次':'你最近的结案');
    $('detective-name').value=current.name;$('leaderboard-save-name').disabled=false;
  }
  $('leaderboard-rows').innerHTML=data.entries.map(entry=>rankingRow(entry,current?.id)).join('')||'<tr><td colspan="5" class="leaderboard-empty">还没有结案记录，第一席等你来。</td></tr>';
  const outside=$('leaderboard-outside');outside.hidden=!current||current.rank<=100;
  outside.innerHTML=current&&current.rank>100?`<span>本次未进入前 100 名</span><div><b>第 ${current.rank} 名</b><strong>${esc(current.name)}</strong><span>${esc(current.claim)}</span><time>${esc(worldDuration(current.elapsed))}</time><button class="ranking-report" data-ranking-report="${esc(current.id)}">查看报告 ↗</button></div>`:'';
}
async function loadLeaderboard(){
  if(needsFinalReview()){text('leaderboard-status','结案档案整理完成后即可入榜。');return;}
  if(isVictorySettling()){text('leaderboard-status','胜利已锁定，最后一轮调查收录后即可入榜。');return;}
  const request=++rankingRequest,state=game,runId=rankingRunId,won=state?.phase==='won';rankingReportRequest++;rankingData=null;
  $('leaderboard-retry').hidden=true;$('leaderboard-own').hidden=true;$('leaderboard-outside').hidden=true;
  $('leaderboard-rows').replaceChildren();text('leaderboard-status',won?'正在将本次结案写入排行…':'正在加载侦探排行…');
  if(!liveSearch){text('leaderboard-status','离线试玩不参与排行，请从本地联网版打开侦探排行。');return;}
  try{
    saveDetectiveProfile();
    const data=won?await rankingAPI('',{method:'POST',body:JSON.stringify({runId,ownerToken:detectiveProfile.ownerToken,name:detectiveProfile.name,report:buildCaseReport(state)})}):await rankingAPI(detectiveProfile.lastRunId?`?runId=${encodeURIComponent(detectiveProfile.lastRunId)}`:'');
    if(won){detectiveProfile.lastRunId=runId;saveDetectiveProfile();}
    if(request!==rankingRequest||!$('leaderboard-dialog').open)return;
    renderLeaderboard(data);text('leaderboard-status',won?'本次结案已入榜。':'');
  }catch(error){if(request===rankingRequest&&$('leaderboard-dialog').open){rankingError(error);$('leaderboard-retry').hidden=false;}}
}
function openLeaderboard(){
  if(needsFinalReview()){showFinalReviewStatus();return;}
  if(isVictorySettling()){showVictorySettlement();return;}
  rankingReturnToReport=$('result-dialog').open;
  if(rankingReturnToReport)$('result-dialog').close();
  if(!$('leaderboard-dialog').open)$('leaderboard-dialog').showModal();
  void loadLeaderboard();
}
function closeLeaderboard(){
  rankingRequest++;rankingReportRequest++;$('leaderboard-dialog').close();
  if(rankingReturnToReport&&game)showResult();rankingReturnToReport=false;lastFrame=performance.now();render();
}
async function renameDetective(event){
  event.preventDefault();const current=rankingData?.current,name=$('detective-name').value.trim();
  if(!current||$('leaderboard-save-name').disabled)return;
  if(!name||[...name].length>20){text('leaderboard-status','请输入 1–20 字的侦探名称。');$('detective-name').focus();return;}
  const request=rankingRequest;$('leaderboard-save-name').disabled=true;
  try{
    const data=await rankingAPI(`/${encodeURIComponent(current.id)}`,{method:'PATCH',body:JSON.stringify({ownerToken:detectiveProfile.ownerToken,name})});
    detectiveProfile.name=name;saveDetectiveProfile();
    if(request===rankingRequest&&$('leaderboard-dialog').open){renderLeaderboard(data);text('leaderboard-status','名字已保存。');}
  }catch(error){if(request===rankingRequest)rankingError(error);}
  finally{if(request===rankingRequest)$('leaderboard-save-name').disabled=false;}
}
async function openRankedReport(id,button){
  if(button.disabled)return;
  const request=rankingRequest,reportRequest=++rankingReportRequest;
  $('leaderboard-dialog').querySelectorAll('[data-ranking-report]').forEach(node=>{node.disabled=true;});
  try{const data=await rankingAPI(`/${encodeURIComponent(id)}`);if(request===rankingRequest&&reportRequest===rankingReportRequest&&$('leaderboard-dialog').open)showResult(data.report);}
  catch(error){if(request===rankingRequest&&reportRequest===rankingReportRequest)rankingError(error);}
  finally{if(reportRequest===rankingReportRequest)$('leaderboard-dialog').querySelectorAll('[data-ranking-report]').forEach(node=>{node.disabled=false;});}
}
$('leaderboard-button').addEventListener('click',openLeaderboard);
$('leaderboard-close').addEventListener('click',closeLeaderboard);
$('leaderboard-dialog').addEventListener('cancel',event=>{event.preventDefault();closeLeaderboard();});
$('leaderboard-name-form').addEventListener('submit',renameDetective);
$('leaderboard-retry').addEventListener('click',loadLeaderboard);

function needsFinalReview(){return game?.phase==='won'&&isAgentGame(game)&&game.finalReview?.status!=='complete';}
function showFinalReviewStatus() {
  const failed=game?.finalReview?.status!=='pending';
  const retryable=Boolean(game?.investigation?.sessionId)&&game?.finalReview?.retryable!==false;
  const failure=game?.finalReview?.error||(retryable?'复核服务暂时没有返回。可以重试，或先查看本局记录。':'本局未建立可复核的调查档案，无法完成终审。传播成绩已经保留，可以查看本局战报。');
  openDetail(`<span class="tag">行动已结束 · 时间已封存</span><h2>${failed?'档案还没有复核完':'正在整理结案档案'}</h2><p>${failed?esc(failure):'调查员正在对照你公布过的材料，整理这次行动的最后一页。'}</p>${failed?'':'<div class="review-working" role="status"><i></i><i></i><i></i><span>核对档案中</span></div>'}<div class="search-footer">${failed&&retryable?'<button id="review-retry" class="primary">继续整理 →</button>':''}<button id="review-report" class="secondary">先看战报</button></div>`,'final-review');
}
async function requestFinalVerdict() {
  if(!game||finalReviewRequest)return;
  const state=game,requestId=newUuid(),started=startFinalReview(state,requestId);
  if(!started.ok){if(state.finalReview?.status==='complete')showEndingCinematic();else showFinalReviewStatus();return;}
  $('result-dialog').close();
  const controller=new AbortController(),request={state,requestId,controller};finalReviewRequest=request;showFinalReviewStatus();
  const timer=setTimeout(()=>controller.abort(),140000);
  const current=()=>game===state&&finalReviewRequest===request;
  const readingReport=()=>$('result-dialog').open&&activeReport?.caseId===buildCaseReport(state).caseId;
  const refreshReport=()=>{const scroll=$('result-dialog').scrollTop;showResult();$('result-dialog').scrollTop=scroll;};
  try{
    const response=await fetch('/api/investigation/verdict',{method:'POST',headers:{'Content-Type':'application/json','X-Lie-Company':'research'},body:JSON.stringify(started.request),signal:controller.signal});
    let payload;try{payload=await response.json();}catch{throw new Error('档案暂时没有返回，请再试一次。');}
    if(!current())return;
    if(!response.ok||!payload.ok){const error=new Error('档案复核暂时没有完成。');error.code=payload.error?.code;throw error;}
    const completed=completeFinalReview(state,requestId,payload.result);
    if(!completed.ok)throw new Error(completed.reason||'档案内容不完整，请再试一次。');
    if(readingReport())refreshReport();else{closeDetail(false);showEndingCinematic();}
  }catch(error){
    if(!current())return;
    const code=error.name==='AbortError'?'MODEL_TIMEOUT':error.code;
    const message=({MODEL_TIMEOUT:'整理档案超时了，可以继续整理。',MODEL_LIMIT:'调查员现在有些忙，请稍后再试。',RATE_LIMIT:'调查员现在有些忙，请稍后再试。',MODEL_UNAVAILABLE:'复核服务暂时连接不上，请稍后再试。',MODEL_FORMAT:'档案内容没有完整返回，可以继续整理。',MODEL_TRUNCATED:'档案内容没有完整返回，可以继续整理。',INVESTIGATION_FORMAT:'档案中的证据引用还没有核对完整，可以继续整理。',SESSION_EXPIRED:'本局调查档案已过期，无法继续复核。',INVALID_PUBLICATIONS:'已公布材料没有对应完整，暂时无法完成复核。'})[code]||'档案复核暂时没能完成，可以稍后再试。';
    failFinalReview(state,requestId,`${message}本局成绩已经保留。`);
    state.finalReview.retryable=!['SESSION_EXPIRED','INVALID_PUBLICATIONS'].includes(code);
    if(readingReport())refreshReport();else showFinalReviewStatus();
  }finally{clearTimeout(timer);if(finalReviewRequest===request)finalReviewRequest=null;}
}
function showEndingCinematic() {
  if(!game)return;
  const report=buildCaseReport(game),id=report.ending?.id||'unreviewed';
  endingScene={state:game,report,id,page:0,elapsed:0,paused:reducedMotion.matches};
  $('ending-image').src=endingImages[id]||endingImages.unreviewed;
  $('ending-image').alt=id==='truth'?'晨光照亮公开的档案，人们开始自己核对真相':id==='new-company'?'侦探站进广播高塔的控制室，城市迎来了新的统治者':id==='defeat'?'城市仍然笼罩在广播高塔的阴影里':'侦探守着尚未复核完的档案';
  $('ending-stage').dataset.ending=id;showEndingPage(0);
  if(!$('ending-dialog').open)$('ending-dialog').showModal();$('ending-next').focus({preventScroll:true});updateAudioScene();
}
function showEndingPage(page) {
  if(!endingScene)return;
  const scene=endingScene;scene.page=page;scene.elapsed=0;
  const caption=$('ending-caption'),won=scene.report.outcome==='won';
  const stories={truth:['你把真相，带回了世界。','这一次，支撑结论的是可核对的证据。档案被打开，人们开始自己提问。'],
    'new-company':['屠龙的勇者，坐上了王座。',scene.report.finalVerdict?.status==='supported'?'你让世界把原观点当成谎言，证据却支持它。高塔里，只是换了一个人。':scene.report.finalVerdict?.status==='mixed'?'你把仍有条件和争议的观点，一口咬定为谎言。高塔里，只是换了一个人。':'你让世界把原观点当成谎言，证据却还不充分。高塔里，只是换了一个人。'],
    defeat:['这一次，高塔没有熄灭。','你的声音被淹没了。但留下的档案，仍然能成为下一次调查的起点。'],
    unreviewed:['故事结束了，答案还没有。','这份档案尚未完成复核。它记录了你赢得的信任，暂不为原观点的真假盖章。']};
  const [title,description]=stories[scene.id]||stories.unreviewed;
  caption.innerHTML=page===0?`<p class="ending-kicker">${esc(scene.report.period.end)}</p><h2 id="ending-title">${won?'世界，接受了你的反驳。':'城市，又一次陷入沉默。'}</h2><p class="ending-message">${esc(getCaseEnding(scene.report.outcome,scene.report.finalVerdict,scene.report.claim).campaign)}</p>`:`<p class="ending-kicker">${esc(scene.report.ending?.label||'未审定')}</p><h2 id="ending-title">${title}</h2><p class="ending-message">${description}</p>`;
  caption.scrollTop=0;
  $('ending-stage').dataset.page=String(page);$('ending-stage').style.setProperty('--ending-progress','0');
  caption.classList.remove('caption-enter');void caption.offsetWidth;caption.classList.add('caption-enter');
  text('ending-page',page?'02 / 02':'01 / 02');text('ending-play',scene.paused?'播放画面':'暂停画面');
  $('ending-next').innerHTML=page?'翻开结案战报 <span>→</span>':'继续 <span>→</span>';
}
function advanceEndingCinematic(dt) {
  if(!endingScene||!$('ending-dialog').open||endingScene.paused||document.hidden||!$('ending-image').complete)return;
  endingScene.elapsed+=dt;$('ending-stage').style.setProperty('--ending-progress',String(Math.min(1,endingScene.elapsed/8)));
}
function finishEndingCinematic() {if(!endingScene)return;endingScene=null;$('ending-dialog').close();showResult();}
function showResult(savedReport=null) {
  if(!savedReport&&isVictorySettling()){showVictorySettlement();return;}
  if(!game&&!savedReport)return;activeReport=savedReport||buildCaseReport(game);const report=activeReport,won=report.outcome==='won';
  const ending=getCaseEnding(report.outcome,report.finalVerdict,report.claim);
  const audit=report.finalVerdict,stamp=ending.id==='truth'?'反驳有据':won?'传播胜利':'行动结束';
  const appraisal=step=>{
    const link=audit?.chain?.find(item=>item.roundId===step.roundId);if(!link)return '';
    const relevance={direct:'直接证明链条中的环节',indirect:'提供间接关联',irrelevant:'未能回答原观点'};
    return `<div class="report-audit-link"><b>复核意见 · ${esc(relevance[link.relevance]||'材料待核对')}</b><p>${esc(link.finding)}</p>${link.gap?`<p>材料边界：${esc(link.gap)}</p>`:''}</div>`;
  };
  const steps=report.steps.map(step=>`<article class="report-step"><div class="report-step-heading"><b>0${step.round}</b><div><span>${esc(step.timeLabel)} · 第 ${step.round} 轮调查</span><h3>${esc(step.question)}</h3></div></div><div class="report-evidence"><span class="report-selected">${esc(step.publicationState)} · ${esc(step.effectLabel)}</span><h4>${esc(step.selectedTitle)}</h4><p>${esc(step.finding)}</p>${step.quote?`<blockquote>${esc(step.quote)}</blockquote>`:''}${uiSafeSourceUrl(step.sourceUrl)?`<a href="${esc(uiSafeSourceUrl(step.sourceUrl))}" target="_blank" rel="noopener noreferrer">${esc(step.sourceName||step.sourceTitle)} · 查看原文 ↗</a>`:''}${step.publishedTimeLabel?`<p class="subtle">${esc(step.publishedTimeLabel)} 公布</p>`:''}${appraisal(step)}</div></article>`).join('');
  const timeline=report.timeline.map(event=>`<li><time>${esc(event.timeLabel)}</time><div><strong>${esc(event.title)}</strong><p>${esc(event.detail)}</p></div></li>`).join('');
  const attributes=[['spread','传播'],['persuasion','说服'],['defense','防守']],levels=report.style.levels;
  const hasLevels=levels&&attributes.every(([key])=>Number.isInteger(levels[key])&&levels[key]>=0&&levels[key]<=3);
  const highestLevel=hasLevels?Math.max(...attributes.map(([key])=>levels[key])):0;
  const styleLevels=hasLevels?`<dl class="report-style-levels" aria-label="本局属性加点">${attributes.map(([key,label])=>`<div class="${levels[key]>0&&levels[key]===highestLevel?'leading':''}"><dt>${label}</dt><dd aria-label="升级 ${levels[key]} 次"><span class="report-level-pips" aria-hidden="true">${[1,2,3].map(level=>`<i class="${levels[key]>=level?'filled':''}"></i>`).join('')}</span><span>${levels[key]} 次</span></dd></div>`).join('')}</dl>`:'';
  const sceneImage=['truth','new-company'].includes(ending.id)?endingImages[ending.id]:null;
  const endingArt=sceneImage?`<div class="report-ending-scene"><img src="${sceneImage}" alt="${esc(ending.label)}"></div>`:'';
  const finalAction=needsFinalReview()?(game?.finalReview?.status==='pending'?'<button class="secondary" disabled>档案复核中…</button>':game?.investigation?.sessionId&&game?.finalReview?.retryable!==false?'<button class="secondary" id="report-review-retry">继续整理档案</button>':''):'<button class="secondary" id="view-leaderboard">查看侦探排行</button>';
  $('result-dialog').className=`result case-report ${won?'won':'lost'} ${esc(ending.id)}`;
  $('result-content').innerHTML=`<div class="report-masthead"><b>谎言公司 <span>／ 结案战报</span></b><span>${esc(report.caseId)}</span><button class="close" id="result-review" aria-label="${savedReport?'返回排行榜':'回看战局'}">×</button></div>${endingArt}<section class="report-hero"><div class="report-intro"><span class="report-outcome">${esc(ending.label)}</span><h2>${esc(ending.title)}</h2><p class="report-claim">${esc(ending.campaign)}</p><p class="report-period">${esc(report.period.start)} 立案<br>${esc(report.period.end)} ${report.outcome==='playing'?'调查仍在继续':'结案'}</p>${['won','lost'].includes(report.outcome)?`<div class="report-stamp"><span>${stamp}</span></div>`:''}</div><div class="report-style"><span>你的打法</span><b>${esc(report.style.name)}</b><p>${esc(report.style.description)}</p>${styleLevels}</div></section><div class="report-verdict ${esc(report.verdict.status)}"><span>证据判断 · ${esc(audit?ASSESSMENT_LABELS[audit.status]:'原观点尚未完成终审')}</span><p>${esc(report.verdict.summary)}</p>${audit?`<p>${esc(audit.rationale)}</p>`:''}</div><section class="report-stats" aria-label="本局游戏战绩"><div><strong>${Number(report.stats.support).toFixed(1)}<small>%</small></strong><span>支持你的反驳</span></div><div><strong>${esc(report.stats.timeLabel)}</strong><span>调查历时</span></div><div><strong>${report.stats.evidenceCount}<small> / ${report.stats.totalRounds}</small></strong><span>完成调查</span></div><div><strong>${report.stats.regions}<small> / 6</small></strong><span>传播抵达</span></div><p>以上为本局游戏模拟，不代表现实公众意见，也不决定传闻真假。</p></section><div class="report-body"><section class="report-chain"><h3>你是这样查下去的</h3>${steps||'<p class="report-empty">本局还没有完成调查，暂时没有可展示的证据链。</p>'}<p class="report-credit">power by 元宝搜索API</p></section><section class="report-turns"><h3>风向的几个转折</h3><ol>${timeline||'<li><p>还没有记录到关键转折。</p></li>'}</ol></section></div><footer class="report-actions"><div><button class="primary" id="download-report">保存分享战报 <span>↓</span></button>${savedReport?'':won?finalAction:'<button class="secondary" id="copy-report">复制结案摘要</button>'}${!savedReport&&sceneImage?'<button class="secondary" id="replay-ending">重看尾声</button>':''}</div>${savedReport?'<button class="secondary" id="ranking-report-back">返回排行榜 →</button>':'<button class="secondary" id="play-again">再接一案 →</button>'}<p id="report-status" role="status">战报带有证据出处和本局战绩，保存后可自行分享。</p><textarea id="report-copy-fallback" aria-label="结案摘要，选中后复制" hidden></textarea></footer>`;
  if(!savedReport&&game?.finalReview?.status==='failed')text('report-status',game.finalReview.error);
  if(!$('result-dialog').open)$('result-dialog').showModal();$('result-dialog').scrollTop=0;
}
async function saveReport() {
  if(!activeReport||isVictorySettling()||$('download-report').disabled)return;const report=activeReport,button=$('download-report');
  const download=downloadCaseReport(report,$('result-dialog'));button.disabled=true;button.textContent='正在生成战报…';
  try{await download;if(activeReport===report){gameAudio.emit('download');text('report-status','完整战报长图已保存，可在下载文件中查看并分享。');}}
  catch{if(activeReport===report){gameAudio.emit('error');text('report-status','图片暂时没能生成，请重试。');}}
  finally{if(activeReport===report&&button.isConnected){button.disabled=false;button.innerHTML='保存分享战报 <span>↓</span>';}}
}
async function copyReport() {
  if(!activeReport)return;const value=caseReportText(activeReport);
  try{await navigator.clipboard.writeText(value);gameAudio.emit('copy');text('report-status','结案摘要已复制，包含证据链接。');}
  catch{gameAudio.emit('error');const field=$('report-copy-fallback');field.hidden=false;field.value=value;field.focus();field.select();text('report-status','摘要已选中，按 ⌘C 或 Ctrl+C 复制。');}
}
function askRestart() {if(!game){openIntro();return;}openDetail('<h2>重新开始这一局？</h2><p>本局进度会清空，可以重新选择起点。</p><button class="primary" id="confirm-restart">重新开始 →</button>','restart');}

function runUpgrade(key) {
  if(!game)return;const before=getCounterStatus(game),cost=upgradeCost(game,key),outcome=buyUpgrade(game,key);
  if(!outcome.ok){gameAudio.emit('error');intent={type:'upgrade',key,cost};feedback(outcome.reason,'行动点会自动积累。','','neutral',80);return;}
  gameAudio.emit(key==='defense'?'defense':'upgrade');
  walletFeedback(-cost);markAction('upgrade',key);firstMovePending=false;
  if(detailType==='enemy')closeDetail(false);
  render();animate(document.querySelector(`[data-card="${key}"]`),'just-bought',1500);animate($('map-wrap'),key==='defense'?'defense-flash':'map-flash',1300);
  if(key==='spread')pulseRegion(game.startRegionId,'传播进化');if(key==='persuasion')animate($('truth-value'),'just-bought',1500);
  if(key==='defense'&&before.active){const after=getCounterStatus(game);feedback('阵地稳住，澄清提速',`本波减损 ${uiPercent(after.defenseReduction)}，澄清从${worldRemaining(before.remaining)}缩短至${worldRemaining(after.remaining)}；后续每波也会生效。`,'防守生效','success',100,7000);eventTargets().forEach(id=>pulseRegion(id,'阵地加固'));}
  else feedback(`${upgradeNames[key]}已进化`,key==='spread'?'更多转载有机会带上真相；看绿色内容在哪里落地。':UPGRADE_DEFS[key].effect[game.levels[key]-1],`Lv.${game.levels[key]}`,'success',60,6500);lastFrame=performance.now();
}
function showLiveSearchFailure(outcome) {
  if(game?.phase==='won'){
    coinWalletFeedback(outcome.refund);
    fieldMessage({source:'证据档案',title:'最后一轮未能完成，金币已退回',detail:'胜利与通关时间不受影响；已查到的材料全部保留。'});
    render();return;
  }
  gameAudio.emit('error');
  coinWalletFeedback(outcome.refund);feedback('本轮调查未完成，金币已退回',outcome.reason,'本轮机会保留','neutral',100,8000);
  if(['search','agent-search'].includes(detailType))showSearch();else render();
}
async function refreshInvestigationLeads() {
  if(!game||leadRefreshRequest||liveRequest||planRequest)return;
  const state=game,status=getResearchStatus(state),requestId=newUuid();
  const body={requestId,sessionId:state.investigation?.sessionId,roundId:status.roundId,promotedId:state.researchResults.findLast(result=>result.promotedId)?.promotedId||null,leadIds:status.leads.map(lead=>lead.id)};
  const started=startLeadRefresh(state,requestId);
  if(!started.ok){gameAudio.emit('error');return;}
  const controller=new AbortController(),request={controller,state,requestId,timedOut:false,timer:null};leadRefreshRequest=request;
  request.timer=setTimeout(()=>{request.timedOut=true;controller.abort();},75000);
  const current=()=>game===state&&leadRefreshRequest===request;
  gameAudio.emit('search');coinWalletFeedback(-1);showAgentSearch();render();
  try{
    const response=await fetch('/api/investigation/refresh',{method:'POST',headers:{'Content-Type':'application/json','X-Lie-Company':'research'},body:JSON.stringify(body),signal:controller.signal});
    let payload;try{payload=await response.json();}catch{throw new Error('新问题暂时没准备好，请重试。');}
    if(!current())return;
    if(!response.ok||!payload.ok)throw new Error(payload.error?.message||'暂时连不上调查员，请重试。');
    const applied=completeLeadRefresh(state,requestId,payload.result);
    if(!applied.ok)throw new Error(applied.reason||'新问题暂时没准备好，请重试。');
    gameAudio.emit('evidence');
    fieldMessage({source:'调查员',title:`第 ${status.roundNumber} 轮 · 换了两个调查方向`,detail:state.investigation.leads.map(lead=>lead.title).join(' / ')});
    if(detailType!=='agent-search')feedback('新的调查方向已备好','沿着已有材料，换个角度继续查。','换题完成','success',60);
  }catch(error){
    if(current()){
      const message=request.timedOut?'换题等得有点久，请重试。':error.message==='Failed to fetch'?'暂时连不上调查员，请重试。':error.message||'新问题暂时没准备好，请重试。';
      const failed=failLeadRefresh(state,requestId,message);
      gameAudio.emit('error');coinWalletFeedback(failed.refund||0);
      if(detailType!=='agent-search'&&state.phase==='playing')feedback('换题未完成，1 金币已退回','原来的两个问题仍然可以查。','','neutral',70);
    }
  }finally{
    clearTimeout(request.timer);
    if(current()){
      // An ended match or rejected response must never leave paid planning pending.
      if(state.investigation?.refresh?.requestId===requestId)failLeadRefresh(state,requestId,'换题已取消。');
      leadRefreshRequest=null;
      if(state.phase==='playing'&&detailType==='agent-search'){
        showAgentSearch();
        if(!state.investigation.refreshError){animate(document.querySelector('.lead-options'),'just-bought',900);$('refresh-leads')?.focus({preventScroll:true});}
      }
      render();
    }
  }
}
function runInvestigation(leadId) {
  if(!game)return;const lead=(getResearchStatus(game).leads||game.investigation?.leads||[]).find(item=>item.id===leadId);
  if(lead)runResearch(lead.question,lead.id);
}
async function runResearch(query,leadId) {
  if(!game||liveRequest)return;
  const state=game,status=getResearchStatus(state),live=state.researchMode==='live',agent=isAgentGame(state),requestId=live?newUuid():null,outcome=startResearch(state,query,live?{requestId,leadId}:undefined);
  if(!outcome.ok){gameAudio.emit('error');if($('research-error')){text('research-error',outcome.reason);$('research-error').hidden=false;}else feedback(outcome.reason,'打开寻找证据，调整问题后重试。','','neutral',80);return;}
  gameAudio.emit('search');
  coinWalletFeedback(-status.cost);if(outcome.pointsEarned)walletFeedback(outcome.pointsEarned);firstMovePending=false;markAction('research',status.roundId);
  if($('detail-dialog').open)closeDetail(false);
  feedback(agent?'这条线，开查了':live?'元宝正在联网搜索':'开始沿线查证',live?'可以回地图继续升级，找到材料后会通知你。':`${worldRemaining(status.duration)}完成，期间可升级能力、观察传播。`,'搜证中','neutral',50);lastFrame=performance.now();render();
  if(!live)return;
  const controller=new AbortController(),request={controller,state,requestId,timedOut:false,timer:null,progressController:new AbortController(),progressTimer:null,progress:null,round:status.roundNumber,roundId:status.roundId,query,gameTime:state.time,finished:false,finalStatus:'running'};liveRequest=request;
  updateFieldInvestigation(fieldFeed,{requestId,round:status.roundNumber,roundId:status.roundId,query,time:state.time,status:'running',events:[]});
  request.timer=setTimeout(()=>{request.timedOut=true;controller.abort();},agent?180000:25000);
  const previous=state.researchResults.findLast(result=>result.promotedId),material=previous?getEvidenceMaterial(state,previous.promotedId):null;
  const stats=getStats(state),body=agent?{requestId,sessionId:state.investigation.sessionId,roundId:status.roundId,leadId,promotedId:previous?.promotedId||null,gameContext:{reached:stats.reached,truth:stats.truth,exposed:stats.exposed,regions:state.regions.filter(region=>region.seeded).length,operationPhase:state.operationPhase,underAttack:Boolean(state.event&&!state.event.resolved)}}:{requestId,roundId:status.roundId,query:query.trim(),previous:material?{title:material.title,url:material.sources?.[0]?.url||'',query:previous.query,finding:material.insight?.explanation||material.finding,kind:material.insight?.kind,sourceTitle:material.sources?.[0]?.title||material.title}:null};
  const stillCurrent=()=>game===state&&(state.phase==='playing'||state.phase==='won'&&state.victoryResearchId===requestId)&&state.research?.requestId===requestId&&liveRequest===request;
  try {
    const responsePending=fetch(agent?'/api/investigation/research':'/api/research',{method:'POST',headers:{'Content-Type':'application/json','X-Lie-Company':'research'},body:JSON.stringify(body),signal:controller.signal});
    if(agent)pollInvestigationProgress(request);
    const response=await responsePending;
    let payload;try{payload=await response.json();}catch{throw new Error('搜索服务暂时没有响应，请稍后再试。');}
    if(!stillCurrent())return;
    if(!response.ok||!payload.ok)throw new Error(payload.error?.message||'这次没有找到可用材料，请重新选择线索再试。');
    const completed=completeLiveResearch(state,requestId,payload.result);
    if(!completed.ok){request.finished=true;request.finalStatus='failed';updateFieldInvestigation(fieldFeed,{requestId,status:'failed',error:completed.reason});if(completed.refund){showLiveSearchFailure(completed);return;}throw new Error(completed.reason||'搜索结果不完整，请重试。');}
    request.finished=true;request.finalStatus='completed';updateFieldInvestigation(fieldFeed,{requestId,status:'completed',result:payload.result});
    if(state.phase==='won'){render();return;}
    if(completed.pointsEarned)walletFeedback(completed.pointsEarned);
    if(status.roundNumber===RESEARCH_ROUNDS.length)feedback('五轮搜证完成',`接下来每 ${RULES.coinExchangeRate} 金币自动换 1 行动点。`,'流量继续变现','success',55);
    if(['search','agent-search'].includes(detailType))closeDetail();else render();
  } catch(error) {
    if(!stillCurrent())return;
    const reason=request.timedOut?'搜索超时了，请再试一次。':error.name==='AbortError'?'搜索已取消。':error.message==='Failed to fetch'?'暂时连不上搜索服务，请稍后重试。':error.message||'这次搜索没成功，请稍后重试。';
    request.finished=true;request.finalStatus='failed';updateFieldInvestigation(fieldFeed,{requestId,status:'failed',error:reason});
    const failed=failLiveResearch(state,requestId,reason);
    if(failed.refund)showLiveSearchFailure(failed);
  } finally {clearTimeout(request.timer);clearTimeout(request.progressTimer);request.finished=true;if(agent&&game===state&&!request.progressController.signal.aborted)await readInvestigationProgress(request,true);request.progressController.abort();if(liveRequest===request)liveRequest=null;if(game===state)render();}
}

function runCounter() {
  if(!game)return;const outcome=counterWithSource(game);
  if(!outcome.ok){gameAudio.emit('error');intent={type:'counter',cost:RULES.counterCost};feedback(outcome.reason,'稳住阵地能减少这期间的流失。','','neutral',80);return;}
  gameAudio.emit('counter');
  walletFeedback(-RULES.counterCost);markAction('counter');firstMovePending=false;
  if(detailType==='enemy')closeDetail(false);
  const counter=getCounterStatus(game);
  feedback('澄清开始扩散',`第 ${counter.waveNumber} 波将在${worldRemaining(counter.remaining)}内化解。稳住阵地能提速；公布新证据再推进 15%。`,'澄清持续推进','success',100,7000);
  render();
}

function executeJourney() {
  const action=currentJourney?.primaryAction;if(!action||action.disabled)return;
  if(action.type==='upgrade')runUpgrade(action.key||'spread');
  else if(action.type==='open-search')showSearch();else if(action.type==='counter')runCounter();else if(action.type==='publish')askPublish();
  else if(action.type==='resume'){gameAudio.emit('resume');manualPaused=false;firstMovePending=false;lastFrame=performance.now();render();}
  else if(action.type==='accelerate'){chooseSpeed(2);feedback('已切换到 2 倍速','世界运行加快，联网搜索仍按实际响应。','','neutral',40);}
  else if(action.type==='restart')openIntro();else if(action.type==='start')startGame();
}

// 浏览器只允许在真实手势后启动声音；音频偏好始终以玩家的选择为准。
for(const name of ['pointerdown','keydown'])document.addEventListener(name,event=>{if(event.isTrusted)gameAudio.unlock();},{capture:true,passive:true});
const audioClicks=new WeakMap();
document.addEventListener('click',event=>{
  const target=event.target.closest('button,a[href]');if(!target||target.disabled||target.id==='sound-mute')return;
  const emissions=gameAudio.getDiagnostics().emissions;
  const name=target.id==='field-toggle'?(target.getAttribute('aria-expanded')==='true'?'close':'open'):target.matches('[data-start-region],[data-claim-preset]')?'select':target.matches('[data-cinematic-page],#cinematic-next,#claim-presets-prev,#claim-presets-next')?'page':target.matches('a[href],#help-button,#archive-button,#search-button,#restart-button,#report-button,[data-media-story],[data-evidence-story],[data-feed-report],[data-media-overview],[data-open-evidence]')?'open':target.matches('#result-review,#search-return,#continue-battle,#result-continue')?'close':'click';
  audioClicks.set(event,{emissions,name});
},true);
document.addEventListener('pointerover',event=>{
  const target=event.target.closest('button,a[href],input[type="range"],#field-resize');
  if(target&&!target.disabled&&target.id!=='sound-mute'&&!target.contains(event.relatedTarget))gameAudio.emit('hover');
});
document.addEventListener('focusin',event=>{if(event.target.matches('button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible')&&event.target.id!=='sound-mute')gameAudio.emit('hover');});
for(const name of ['input','compositionend'])document.addEventListener(name,event=>{
  if(event.isTrusted&&!event.isComposing&&event.target.matches('textarea,input:not([type]),input[type="text"],input[type="search"]'))gameAudio.emit('type');
});
document.querySelectorAll('[data-open-sound]').forEach(button=>button.addEventListener('click',openSoundSettings));
$('sound-close').addEventListener('click',closeSoundSettings);
$('sound-dialog').addEventListener('cancel',event=>{event.preventDefault();closeSoundSettings();});
$('sound-mute').addEventListener('click',()=>{gameAudio.configure({muted:!gameAudio.getSettings().muted});if(!gameAudio.getSettings().muted)gameAudio.emit('click');renderSoundSettings();});
for(const key of ['music','sfx']){
  $('sound-'+key).addEventListener('input',()=>{gameAudio.configure({[key]:Number($('sound-'+key).value)/100});renderSoundSettings();});
  $('sound-'+key).addEventListener('change',()=>gameAudio.emit('click'));
}
gameAudio.setVisible(!document.hidden);

$('start-button').addEventListener('click',startGame);$('intro-dialog').addEventListener('cancel',event=>event.preventDefault());
$('cinematic-next').addEventListener('click',nextCinematicPage);$('cinematic-skip').addEventListener('click',finishCinematic);
$('cinematic-dialog').addEventListener('cancel',event=>{event.preventDefault();finishCinematic();});
$('cinematic-play').addEventListener('click',()=>{cinematicPlaying=!cinematicPlaying;gameAudio.emit(cinematicPlaying?'resume':'pause');text('cinematic-play',cinematicPlaying?'暂停播放':'自动播放');});
$('cinematic-dialog').addEventListener('keydown',event=>{
  if(event.code==='ArrowRight'||event.code==='ArrowLeft'){event.preventDefault();if(!event.repeat){if(event.code==='ArrowRight')nextCinematicPage();else showCinematicPage(cinematicPage-1);}}
});
document.querySelectorAll('[data-cinematic-page]').forEach(button=>button.addEventListener('click',()=>showCinematicPage(Number(button.dataset.cinematicPage))));
$('pause-button').addEventListener('click',()=>{if(game?.phase==='playing')setManualPause();});$('journey-primary').addEventListener('click',executeJourney);$('journey-secondary').addEventListener('click',()=>{if(firstMovePending)skipGuidance();else {chooseSpeed(2);feedback('已切换到 2 倍速','世界运行加快，也可以随时暂停。','','neutral',40);render();}});
$('report-button').addEventListener('click',()=>showResult());
$('help-button').addEventListener('click',showHelp);$('archive-button').addEventListener('click',showArchive);$('restart-button').addEventListener('click',askRestart);$('search-button').addEventListener('click',showSearch);$('publish-button').addEventListener('click',askPublish);
$('claim-input').addEventListener('input',()=>{$('claim-error').hidden=true;$('claim-input').removeAttribute('aria-invalid');updateClaimPresets();});
$('claim-presets').addEventListener('click',event=>{const button=event.target.closest('[data-claim-preset]');if(!button)return;$('claim-input').value=claimPresets[Number(button.dataset.claimPreset)][1];$('claim-error').hidden=true;$('claim-input').removeAttribute('aria-invalid');updateClaimPresets();});
$('claim-presets').addEventListener('scroll',updateClaimPresets,{passive:true});
$('claim-presets').addEventListener('wheel',()=>{presetHoldUntil=performance.now()+4500;},{passive:true});
$('claim-presets').addEventListener('pointerdown',()=>{presetHoldUntil=performance.now()+4500;});
$('pause-resume').addEventListener('click',resumeGame);$('pause-dialog').addEventListener('cancel',event=>{event.preventDefault();resumeGame();});
$('claim-presets-prev').addEventListener('click',()=>scrollClaimPresets(-1));$('claim-presets-next').addEventListener('click',()=>scrollClaimPresets(1));
window.addEventListener('resize',updateClaimPresets);
$('detail-close').addEventListener('click',closeDetail);$('detail-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('result-dialog').addEventListener('cancel',()=>{gameAudio.emit('close');});
$('ending-next').addEventListener('click',()=>{if(endingScene?.page===0)showEndingPage(1);else finishEndingCinematic();});
$('ending-skip').addEventListener('click',finishEndingCinematic);
$('ending-dialog').addEventListener('cancel',event=>{event.preventDefault();finishEndingCinematic();});
$('ending-dialog').addEventListener('keydown',event=>{if(event.code==='ArrowRight'&&!event.repeat){event.preventDefault();if(endingScene?.page===0)showEndingPage(1);else finishEndingCinematic();}if(event.code==='ArrowLeft'){event.preventDefault();showEndingPage(0);}});
$('ending-play').addEventListener('click',()=>{if(endingScene){endingScene.paused=!endingScene.paused;text('ending-play',endingScene.paused?'播放画面':'暂停画面');}});
$('publication-dialog').addEventListener('cancel',event=>{event.preventDefault();finishPublicationScene();});
$('field-history').addEventListener('scroll',()=>{if(fieldCollapsed||fieldScrollFrame||fieldDrag)return;fieldFollowing=fieldAtBottom();if(fieldFollowing)fieldUnread.clear();updateFieldJump();});
$('field-jump').addEventListener('click',()=>{fieldFollowing=true;fieldUnread.clear();updateFieldJump();$('field-history').scrollTop=$('field-history').scrollHeight;});
$('field-toggle').addEventListener('click',toggleFieldHistory);
$('field-resize').addEventListener('pointerdown',event=>{
  if(event.button!==0||fieldCollapsed||!game)return;
  event.preventDefault();gameAudio.emit('select');fieldDrag={id:event.pointerId,y:event.clientY,height:$('field-feed').getBoundingClientRect().height};
  $('field-resize').setPointerCapture(event.pointerId);$('field-resize').focus({preventScroll:true});
  $('field-feed').classList.add('is-resizing');document.body.classList.add('resizing-field');
});
$('field-resize').addEventListener('pointermove',event=>{if(fieldDrag?.id===event.pointerId)setFieldHeight(fieldDrag.height+fieldDrag.y-event.clientY);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('field-resize').addEventListener(name,finishFieldResize);
$('field-resize').addEventListener('keydown',event=>{
  if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();gameAudio.emit('select');const {min,max}=fieldHeightBounds(),height=$('field-feed').getBoundingClientRect().height;
  setFieldHeight(event.key==='Home'?min:event.key==='End'?max:height+(event.key==='ArrowUp'?32:-32));
});
window.addEventListener('blur',finishFieldResize);
const fieldLayoutObserver=new ResizeObserver(layoutFieldFeed);
for(const node of [$('field-feed').parentElement,$('field-current'),document.querySelector('.field-feed-heading')])fieldLayoutObserver.observe(node);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.hasAttribute('data-media-overview'))showMediaOverview();
  if(button.dataset.mediaStory)showMediaStory(button.dataset.mediaStory);
  if(button.dataset.startRegion){selectedRegion=button.dataset.startRegion;renderStartRegions();}
  if(button.dataset.speed)chooseSpeed(Number(button.dataset.speed));
  if(button.dataset.coin)runCollectCoin(Number(button.dataset.coin),button);
  if(button.dataset.upgrade)runUpgrade(button.dataset.upgrade);
  if(button.dataset.searchQuery)runResearch(button.dataset.searchQuery);
  if(button.id==='throw-evidence')askPublish();
  if(button.id==='store-evidence')closeDetail();
  if(button.dataset.investigationProgress)showInvestigationProgress(button.dataset.investigationProgress);
  if(button.id==='progress-retry')showSearch();
  if(button.dataset.feedReport){const result=game?.researchResults.find(item=>item.roundId===button.dataset.feedReport);if(result)showResearchResult(result);}
  if(button.dataset.investigate)runInvestigation(button.dataset.investigate);
  if(button.id==='refresh-leads')refreshInvestigationLeads();
  if(button.id==='retry-plan'){closeDetail(false);prepareInvestigation(game);render();}
  if(button.id==='download-report')saveReport();
  if(button.id==='copy-report')copyReport();
  if(button.id==='review-retry'||button.id==='report-review-retry')void requestFinalVerdict();
  if(button.id==='review-report'){closeDetail(false);showResult();}
  if(button.id==='replay-ending'){$('result-dialog').close();showEndingCinematic();}
  if(button.id==='view-leaderboard')openLeaderboard();
  if(button.dataset.rankingReport)openRankedReport(button.dataset.rankingReport,button);
  if(button.id==='ranking-report-back')$('result-dialog').close();
  if(button.hasAttribute('data-open-evidence'))showSearch();
  if(button.dataset.evidenceStory)showEvidenceStory(button.dataset.evidenceStory);
  if(button.hasAttribute('data-counter'))runCounter();
  if(button.id==='search-return'){if(firstMovePending){firstMovePending=false;guided=false;}closeDetail();}
  if(['continue-battle','result-continue'].includes(button.id))closeDetail();
  if(button.id==='play-again'||button.id==='confirm-restart')openIntro();
  if(button.id==='result-review')$('result-dialog').close();
});
document.addEventListener('click',event=>{
  const candidate=audioClicks.get(event);if(!candidate)return;
  queueMicrotask(()=>{if(gameAudio.getDiagnostics().emissions===candidate.emissions)gameAudio.emit(candidate.name);});
});
document.addEventListener('error',event=>{
  const image=event.target;if(!(image instanceof HTMLImageElement)||!image.hasAttribute('data-article-image'))return;
  image.removeAttribute('data-article-image');image.src=textArticleImage;image.alt='像素风文字报道插图';const figure=image.closest('.evidence-image');figure?.classList.replace('has-source-image','text-article');const caption=figure?.querySelector('figcaption');if(caption)caption.textContent='文字报道 · 配图未能加载';
},true);
document.addEventListener('keydown',event=>{if($('sound-dialog').open||$('pitch-dialog')?.open)return;if(event.code==='Space'&&$('pause-dialog').open){event.preventDefault();resumeGame();return;}if(event.code==='Space'&&!document.querySelector('dialog[open]')&&!event.target.closest('button,a,input,textarea,summary')){event.preventDefault();if(game?.phase==='playing')setManualPause();}});
document.addEventListener('visibilitychange',()=>{gameAudio.setVisible(!document.hidden);lastFrame=performance.now();if(!document.hidden)render();});
window.addEventListener('pagehide',()=>{void cancelInvestigationSession(game);cancelLiveRequest();});
window.addEventListener('pageshow',event=>{if(event.persisted&&game)openIntro();});
function frame(now) {
  const dt=Math.min(.3,(now-lastFrame)/1000);lastFrame=now;advanceClaimPresets(now,dt);if(!$('pitch-dialog')?.open){advanceEnemyNotice(dt);advanceCinematic(dt);advanceEndingCinematic(dt);advancePublicationScene(dt);}
  if(game?.phase==='playing'&&!isPaused()){feedbackClock+=dt*1000;tick(game,dt*speed);}
  else if(isVictorySettling()&&game.research.kind!=='live'&&!document.hidden&&!tutorial.isOpen())tick(game,dt*speed);
  if(now-lastDraw>150){render();lastDraw=now;}requestAnimationFrame(frame);
}
buildMap();openIntro();
const pitch = createPitch({onChange:()=>{lastFrame=performance.now();updateAudioScene();}});
if(location.hash==='#intro')pitch.open(0);
requestAnimationFrame(frame);
