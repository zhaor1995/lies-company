import { generateChipSamples } from './vendor/zzfx-synth.js';
import { SOUND_PROGRAMS } from './audio-score.js';
import { MUSIC_TRACKS } from './music-tracks.js';

export const AUDIO_DEFAULTS = Object.freeze({music:.48,sfx:.7,muted:false});
export const AUDIO_LIMITS = Object.freeze({sampleRate:44100,musicVoices:2,effectGroups:2,cacheSize:64,crossfade:.35,musicRetryMs:5000});
const audioClamp = (value,fallback=0) => Number.isFinite(Number(value)) ? Math.max(0,Math.min(1,Number(value))) : fallback;
const audioHz = note => 440*2**((note-69)/12);
const audioStorageKey = 'lie-company-audio-v1';
const audioScenes = new Set(['menu','cinematic','investigation','danger','reading','paused','publication','won','lost']);
const sceneLevels = {menu:.58,cinematic:.5,investigation:1,danger:1,reading:.38,paused:.23,publication:.18,won:0,lost:0};

// 交互音效由 ZzFX 合成；背景音乐使用独立的录制曲目。
export function synthesizeNote({voice,note,duration,gain=1,slide=0}) {
  duration=Math.max(.012,Math.min(4,duration));
  let frequency=typeof note==='number'?audioHz(note):100,shape=5,curve=.5,noise=0,frequencySlide=0;
  let attack=.004,release=Math.min(.055,duration*.4),decay=Math.min(.035,duration*.2),sustainVolume=.55,level=.65;
  if(voice==='bass'||voice==='triangle'){shape=1;curve=1;level=.9;sustainVolume=.78;release=Math.min(.025,duration*.25);}
  if(voice==='arp'){curve=1;level=.48;release=Math.min(.045,duration*.5);sustainVolume=.3;}
  if(voice==='noise'||voice==='drums'){
    shape=4;curve=1;frequency=note==='hat'?4200:note==='snare'?190:frequency;noise=.65;sustainVolume=.12;attack=.001;release=duration*.75;decay=duration*.2;level=.5;
    if(note==='kick'){shape=0;frequency=115;frequencySlide=-.48;noise=0;level=1;sustainVolume=.2;}
    if(note==='hat')level=.24;
  }
  if(slide)frequencySlide=(frequency*(2**(slide/12)-1))/(duration*500);
  const sustain=Math.max(0,duration-attack-release-decay);
  return generateChipSamples(level*audioClamp(gain,1),0,frequency,attack,sustain,release,shape,curve,frequencySlide,0,0,0,0,noise,0,0,0,sustainVolume,decay,0,0);
}

export function synthesizeProgram(program) {
  const samples=new Float32Array(Math.ceil(program.duration*AUDIO_LIMITS.sampleRate));
  for(const note of program.notes){
    const wave=synthesizeNote(note),offset=Math.round(note.at*AUDIO_LIMITS.sampleRate);
    for(let i=0;i<wave.length&&offset+i<samples.length;i++)samples[offset+i]+=wave[i];
  }
  // 节目内留出余量，事件之间的余量交给统一总线处理。
  let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
  if(peak>.85)for(let i=0;i<samples.length;i++)samples[i]*=.85/peak;
  return samples;
}

export function createAudioMix(context,settings=AUDIO_DEFAULTS) {
  const music=context.createGain(),sfx=context.createGain(),duck=context.createGain(),master=context.createGain();
  const warmth=context.createBiquadFilter(),dc=context.createBiquadFilter(),limiter=context.createDynamicsCompressor();
  warmth.type='lowpass';warmth.frequency.value=12000;warmth.Q.value=.55;
  dc.type='highpass';dc.frequency.value=35;dc.Q.value=.5;
  limiter.threshold.value=-6;limiter.knee.value=8;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.12;
  music.gain.value=settings.music;sfx.gain.value=settings.sfx;duck.gain.value=1;master.gain.value=settings.muted?0:.8;
  music.connect(warmth).connect(duck).connect(dc);sfx.connect(dc);dc.connect(limiter).connect(master).connect(context.destination);
  return {music,sfx,duck,master,warmth,limiter};
}

function smoothAudioParam(param,value,now,tau=.035) {
  if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);
  else {param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);}
  param.setTargetAtTime(value,now,tau);
}

export function createGameAudio(options={}) {
  let settings={...AUDIO_DEFAULTS},storage=options.storage;
  try{storage??=globalThis.localStorage;const saved=JSON.parse(storage?.getItem(audioStorageKey)||'null');if(saved)settings={music:audioClamp(saved.music,AUDIO_DEFAULTS.music),sfx:audioClamp(saved.sfx,AUDIO_DEFAULTS.sfx),muted:saved.muted===true};}catch{}
  let context=null,mix=null,timer=null,visible=true,activated=false,resuming=false,disposed=false;
  let scene='menu',intensity='normal',duckLevel=1,queue=[],flushPending=false,generation=0;
  let currentMusic=null,pendingMusic=null,musicRequest=0;
  const sources=new Set(),groups=new Set(),cache=new Map(),cooldowns=new Map(),history=[];
  const musicSources=new Set(),musicLoads=new Map(),musicPositions=new Map();
  const musicTracks=options.musicTracks??MUSIC_TRACKS;
  const diagnostics={emissions:0,played:0,dropped:0,musicStarts:0,musicLoads:0,musicErrors:0,maxMusicSources:0,maxEffects:0,maxSources:0,errors:0};
  const now=()=>context?.currentTime||0;
  const wallNow=options.nowMs||(()=>Date.now());
  const trace=(event,status)=>{history.push({event,status,time:now()});if(history.length>80)history.shift();};
  const eligible=()=>!disposed&&visible&&activated&&!settings.muted;
  const wantsMusic=()=>eligible()&&settings.music>0&&sceneLevels[scene]>0&&context?.state==='running';

  function trackConfig(kind=intensity){
    const track=musicTracks[kind]||musicTracks.normal;
    if(!track||typeof track.url!=='string'||!track.url)return null;
    return {...track,kind:musicTracks[kind]?kind:'normal',id:`${track.url}|${track.loopStart??0}|${track.loopEnd??''}`,gain:audioClamp(track.gain,.65)};
  }
  function positionOf(entry){
    const position=entry.offset+Math.max(0,now()-entry.startedAt);
    return position<entry.loopEnd?position:entry.loopStart+(position-entry.loopStart)%(entry.loopEnd-entry.loopStart);
  }
  function cleanupSource(entry){
    sources.delete(entry);entry.group?.sources.delete(entry);musicSources.delete(entry);
    if(currentMusic===entry)currentMusic=null;
    if(entry.group&&!entry.group.sources.size)groups.delete(entry.group);
    try{entry.source.disconnect();entry.volume.disconnect();}catch{}
  }
  function stopEntry(entry,fade=.012){
    if(!sources.has(entry))return;
    try{smoothAudioParam(entry.volume.gain,0,now(),.003);entry.source.stop(now()+fade);}catch{}
    sources.delete(entry);entry.group?.sources.delete(entry);
    if(fade===0)cleanupSource(entry);
  }
  function stopGroup(group){for(const source of group.sources)stopEntry(source);groups.delete(group);}
  function updateDucking(){
    if(!mix)return;
    const level=Math.max(.15,1-Math.max(0,...[...groups].map(group=>group.duck)));
    if(level!==duckLevel){smoothAudioParam(mix.duck.gain,level,now(),level<duckLevel?.012:.1);duckLevel=level;}
  }
  function fadeMusic(entry,target,duration){
    const param=entry.volume.gain,t=now(),from=param.value;
    if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(t);else {param.cancelScheduledValues(t);param.setValueAtTime(from,t);}
    if(param.setValueCurveAtTime){
      const curve=new Float32Array(33);
      for(let i=0;i<curve.length;i++){const ratio=i/(curve.length-1);curve[i]=target>from?from+(target-from)*Math.sin(ratio*Math.PI/2):target+(from-target)*Math.cos(ratio*Math.PI/2);}
      param.setValueCurveAtTime(curve,t,duration);
    }else param.setTargetAtTime(target,t,duration/6);
  }
  function stopMusicEntry(entry,remember=true,fade=0){
    if(!musicSources.has(entry))return;
    if(remember&&!entry.stopping)musicPositions.set(entry.id,positionOf(entry));
    if(currentMusic===entry)currentMusic=null;
    if(fade>0){
      entry.stopping=true;entry.ends=now()+fade;
      fadeMusic(entry,0,fade);try{entry.source.stop(entry.ends);}catch{cleanupSource(entry);}
    }else {try{entry.source.stop(now());}catch{}cleanupSource(entry);}
  }
  function stopMusic(remember=true){
    musicRequest++;pendingMusic=null;
    for(const entry of [...musicSources])stopMusicEntry(entry,remember);
  }
  function stopAll(rememberMusic=true){
    stopMusic(rememberMusic);
    for(const source of [...sources])stopEntry(source,0);
    groups.clear();queue=[];generation++;updateDucking();
  }
  function setMix(){
    if(!mix)return;const t=now();
    smoothAudioParam(mix.master.gain,settings.muted||!visible?0:.8,t,.018);
    smoothAudioParam(mix.music.gain,settings.music*sceneLevels[scene],t,.16);
    smoothAudioParam(mix.sfx.gain,settings.sfx,t);
    smoothAudioParam(mix.warmth.frequency,['reading','paused'].includes(scene)?4000:12000,t,.18);
  }
  async function defaultLoadMusic(track,audioContext,signal){
    const response=await fetch(track.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    if(!response.ok)throw new Error(`Music request failed: ${response.status}`);
    return audioContext.decodeAudioData(await response.arrayBuffer());
  }
  function loadMusic(track){
    const previous=musicLoads.get(track.url);
    if(previous?.status==='failed'&&wallNow()-previous.failedAt<AUDIO_LIMITS.musicRetryMs)return null;
    if(previous&&previous.status!=='failed')return previous.promise;
    const controller=new AbortController(),load={status:'loading',controller,failedAt:0,promise:null};
    diagnostics.musicLoads++;
    load.promise=Promise.resolve().then(()=>(options.loadMusic||defaultLoadMusic)(track,context,controller.signal)).then(data=>{
      if(!data||!Number.isFinite(data.duration)||data.duration<=0)throw new Error('Music has no playable duration');
      load.status='ready';return data;
    }).catch(error=>{load.status='failed';load.failedAt=wallNow();if(!disposed){diagnostics.musicErrors++;trace(track.kind,'music-failed');}throw error;});
    musicLoads.set(track.url,load);return load.promise;
  }
  function startMusic(track,data){
    if(!wantsMusic())return;
    // 快速切换也只保留正在播放与正在淡出的两条音乐。
    for(const entry of [...musicSources])if(entry!==currentMusic)stopMusicEntry(entry,false);
    const previous=currentMusic;
    const loopStart=Math.max(0,Math.min(Number(track.loopStart)||0,Math.max(0,data.duration-.01)));
    const loopEnd=Number.isFinite(Number(track.loopEnd))&&Number(track.loopEnd)>loopStart?Math.min(Number(track.loopEnd),data.duration):data.duration;
    let offset=musicPositions.get(track.id)||0;
    if(offset>=loopEnd)offset=loopStart+(offset-loopStart)%(loopEnd-loopStart);
    const source=context.createBufferSource(),volume=context.createGain();
    source.buffer=data;source.loop=true;source.loopStart=loopStart;source.loopEnd=loopEnd;volume.gain.value=0;
    source.connect(volume).connect(mix.music);
    const entry={source,volume,id:track.id,kind:track.kind,offset,loopStart,loopEnd,startedAt:now(),ends:Infinity,group:null,stopping:false};
    source.onended=()=>cleanupSource(entry);sources.add(entry);musicSources.add(entry);currentMusic=entry;
    try{source.start(entry.startedAt,offset);}catch(error){cleanupSource(entry);throw error;}
    fadeMusic(entry,track.gain,AUDIO_LIMITS.crossfade);
    if(previous)stopMusicEntry(previous,true,AUDIO_LIMITS.crossfade);
    diagnostics.musicStarts++;diagnostics.maxMusicSources=Math.max(diagnostics.maxMusicSources,musicSources.size);diagnostics.maxSources=Math.max(diagnostics.maxSources,sources.size);
    trace(track.kind,'music-started');
  }
  function ensureMusic(){
    if(!wantsMusic())return;
    const track=trackConfig();if(!track){stopMusic();return;}
    if(currentMusic?.id===track.id)return;
    if(pendingMusic?.id===track.id)return;
    const request=++musicRequest,promise=loadMusic(track);if(!promise)return;
    pendingMusic={id:track.id,request};
    promise.then(data=>{
      if(request!==musicRequest||disposed)return;
      pendingMusic=null;
      if(wantsMusic()&&trackConfig()?.id===track.id)startMusic(track,data);
    }).catch(()=>{if(pendingMusic?.request===request)pendingMusic=null;});
  }
  function preloadMusic(){
    if(!eligible()||settings.music===0||!context)return;
    for(const kind of ['normal','danger']){const track=trackConfig(kind);if(track)loadMusic(track)?.catch(()=>{});}
  }
  function maintain(){
    if(!context||context.state!=='running'||!eligible())return;
    const t=now();
    for(const group of groups)if(group.ends<=t)groups.delete(group);
    for(const entry of [...musicSources])if(entry.stopping&&entry.ends<=t)cleanupSource(entry);
    updateDucking();
  }
  function ensureTimer(){if(timer===null)timer=(options.setInterval||globalThis.setInterval)(maintain,25);}
  function buffer(key,make){
    if(cache.has(key))return cache.get(key);
    const samples=make(),result=context.createBuffer(1,samples.length,AUDIO_LIMITS.sampleRate);result.getChannelData(0).set(samples);
    if(cache.size>=AUDIO_LIMITS.cacheSize)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  }
  function playEffect(data,when,group){
    const source=context.createBufferSource(),volume=context.createGain();source.buffer=data;volume.gain.value=1;
    source.connect(volume).connect(mix.sfx);
    const entry={source,volume,group,ends:when+data.duration};sources.add(entry);group.sources.add(entry);
    source.onended=()=>cleanupSource(entry);source.start(when);diagnostics.maxSources=Math.max(diagnostics.maxSources,sources.size);
  }
  function flush(){
    flushPending=false;const pending=queue;queue=[];
    if(!eligible()||settings.sfx===0||!context||context.state!=='running'){for(const item of pending)trace(item.name,'inactive');return;}
    const t=now();pending.sort((a,b)=>b.program.priority-a.program.priority);
    for(const item of pending){
      if(item.generation!==generation||t-item.time>.35)continue;
      const {name,program}=item;
      if(groups.size>=AUDIO_LIMITS.effectGroups){
        const oldest=[...groups].sort((a,b)=>a.priority-b.priority)[0];
        if(!oldest||oldest.priority>=program.priority){diagnostics.dropped++;trace(name,'priority-drop');continue;}
        stopGroup(oldest);
      }
      const data=buffer(`s:${name}`,()=>synthesizeProgram(program));
      const group={sources:new Set(),priority:program.priority,duck:program.duck,ends:t+.008+data.duration};groups.add(group);
      playEffect(data,t+.008,group);diagnostics.played++;diagnostics.maxEffects=Math.max(diagnostics.maxEffects,groups.size);trace(name,'played');
    }
    updateDucking();
  }
  function unlock(){
    if(disposed||!visible)return Promise.resolve(false);
    try{
      if(!context){const Factory=options.contextFactory||(()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)({latencyHint:'interactive'}));context=Factory();mix=createAudioMix(context,settings);setMix();}
      activated=true;ensureTimer();preloadMusic();
      if(context.state==='running'){ensureMusic();return Promise.resolve(true);}
      if(resuming)return Promise.resolve(false);
      resuming=true;
      return Promise.resolve(context.resume()).then(()=>{resuming=false;if(disposed||!visible){stopAll();return false;}setMix();flush();ensureMusic();return true;}).catch(()=>{resuming=false;diagnostics.errors++;stopAll();return false;});
    }catch{diagnostics.errors++;return Promise.resolve(false);}
  }
  function emit(name){
    const program=SOUND_PROGRAMS[name];if(!program)return false;
    diagnostics.emissions++;
    if(!eligible()||settings.sfx===0||!context)return false;
    const t=now();
    if(t-(cooldowns.get(name)??-Infinity)<program.cooldown){diagnostics.dropped++;return false;}
    cooldowns.set(name,t);queue.push({name,program,time:t,generation});
    if(!flushPending){flushPending=true;queueMicrotask(()=>{if(context?.state==='running')flush();else flushPending=false;});}
    return true;
  }
  function setScene(value){
    if(!audioScenes.has(value)||scene===value)return;scene=value;
    if(value==='danger')intensity='danger';else if(['menu','cinematic','investigation'].includes(value))intensity='normal';
    setMix();if(!sceneLevels[scene])stopMusic();else ensureMusic();
  }
  function setVisible(value){
    value=Boolean(value);if(visible===value)return;visible=value;setMix();
    if(!visible){stopAll();if(context)Promise.resolve(context.suspend()).then(()=>{if(visible&&activated&&!settings.muted&&!disposed)unlock();}).catch(()=>{diagnostics.errors++;});}
    else if(activated&&!settings.muted)unlock();
  }
  function configure(patch){
    if('music'in patch)settings.music=audioClamp(patch.music,settings.music);
    if('sfx'in patch)settings.sfx=audioClamp(patch.sfx,settings.sfx);
    if('muted'in patch)settings.muted=Boolean(patch.muted);
    try{storage?.setItem(audioStorageKey,JSON.stringify(settings));}catch{}
    setMix();
    if(settings.muted)stopAll();else if(context&&visible){if(context.state==='running')ensureMusic();else unlock();}
    if(settings.sfx===0){queue=[];for(const group of [...groups])stopGroup(group);updateDucking();}
    if(settings.music===0)stopMusic();
  }
  function reset(){stopAll(false);musicPositions.clear();cooldowns.clear();intensity='normal';ensureMusic();}
  function dispose(){
    disposed=true;stopAll(false);musicPositions.clear();
    for(const load of musicLoads.values())load.controller.abort();musicLoads.clear();cache.clear();
    if(timer!==null)(options.clearInterval||globalThis.clearInterval)(timer);timer=null;
    if(context)Promise.resolve(context.close()).catch(()=>{});
  }
  return {unlock,emit,setScene,setVisible,configure,reset,dispose,getSettings:()=>({...settings}),getDiagnostics:()=>({...diagnostics,scene,intensity,activated,visible,state:context?.state||'locked',activeSources:sources.size,activeEffects:groups.size,activeMusic:musicSources.size,musicTrack:currentMusic?.kind||null,musicOffset:currentMusic?positionOf(currentMusic):null,musicLoading:Boolean(pendingMusic),cacheSize:cache.size,history:history.map(item=>({...item}))})};
}
