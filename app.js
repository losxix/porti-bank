var TX_MIN=8,txShow=TX_MIN,TXF={kind:"all",who:null,why:null},sw=null,swiped=false,swDirty=false;
/* PORTI BANK — app da mesa.
   A partida fica no Supabase. Cada celular guarda uma cópia e uma fila de
   lançamentos ainda não enviados: sem internet, o jogo continua e a fila sobe
   sozinha quando o sinal volta. Todo lançamento tem um id criado no celular,
   então reenviar nunca duplica.
   Banqueiro: dinheiro que sai do banco para um jogador vira pedido até o
   banqueiro aprovar (a regra também vale no servidor). */
(function(){
"use strict";

const CFG=window.PORTI_CONFIG||{};
const COLORS=[
  {k:"vermelho",c:"#C8322D"},{k:"azul",c:"#2453C4"},{k:"verde",c:"#16855A"},{k:"amarelo",c:"#E8B424",dark:true},
  {k:"roxo",c:"#6A3DA6"},{k:"preto",c:"#23252B"},{k:"laranja",c:"#E2661C"},{k:"rosa",c:"#CC3A80"}];
const colorOf=k=>COLORS.find(x=>x.k===k)||COLORS[0];
const $=s=>document.querySelector(s);
/* only touch the DOM when the markup really changed: re-creating photos and lists on every sync is what makes weak phones stutter */
const setHTML=(el,h)=>{if(!el||el._h===h)return false;el._h=h;el.innerHTML=h;return true};
let lastPhotoHTML=null;
/* modo leve: Android com pouca memória (ex.: Galaxy A12) ou quem ligar na mão.
   Tira animações que ficam rodando, desfoques e o tabuleiro 3D animado. */
const LITE_AUTO=(()=>{try{const ua=navigator.userAgent||"",mem=navigator.deviceMemory||8,cores=navigator.hardwareConcurrency||8;return /Android/i.test(ua)&&(mem<=4||cores<=4)}catch(e){return false}})();
function liteOn(){try{const v=localStorage.getItem("pb-lite");if(v==="1")return true;if(v==="0")return false}catch(e){}return LITE_AUTO}
document.documentElement.classList.toggle("lite",liteOn());
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>"$ "+Math.abs(Math.round(n)).toLocaleString("pt-BR");
const fmt=n=>(n<0?"− ":"")+money(n);
const short=v=>v>=1e6&&v%1e5===0?(v/1e6).toLocaleString("pt-BR")+" mi":v>=1000&&v%1000===0?(v/1000).toLocaleString("pt-BR")+" mil":v.toLocaleString("pt-BR");
const parseAmt=s=>{const n=parseInt(String(s).replace(/\D/g,""),10);return isNaN(n)?0:n};
const fmtInput=el=>{const raw=el.value;const n=parseAmt(raw);el.value=raw.replace(/\D/g,"")===""?"":n.toLocaleString("pt-BR")};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const nowIso=()=>new Date().toISOString();
const tms=s=>{if(!s)return 0;const t=Date.parse(String(s).replace(" ","T").replace(/(\.\d{3})\d+/,"$1"));return isNaN(t)?0:t};
const uuid=()=>{
  if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=[...b].map(x=>x.toString(16).padStart(2,"0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const MASK="$ •••••";
const EPOCH="1970-01-01T00:00:00.000Z";
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);

/* ---------- backend ---------- */
function makeApi(){
  if(!CFG.supabaseUrl||!CFG.supabaseKey||/COLE/.test(CFG.supabaseUrl+CFG.supabaseKey)||!window.supabase)return null;
  const sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const fail=(error,status)=>{
    const e=new Error(error&&error.message||"Erro desconhecido");
    e.code=error&&error.code||"";
    e.status=status||0;
    e.config=e.code.startsWith("PGRST")||status===401||status===404;
    e.network=!e.config&&(!e.code||status===0||status>=500);
    return e;
  };
  return {
    async rpc(fn,args){const r=await sb.rpc(fn,args);if(r.error)throw fail(r.error,r.status);return r.data},
    async mesa(code){const r=await sb.from("pb_mesas").select("*").eq("codigo",code).limit(1);if(r.error)throw fail(r.error,r.status);return r.data[0]||null},
    async jogadores(code){const r=await sb.from("pb_jogadores").select("*").eq("mesa",code);if(r.error)throw fail(r.error,r.status);return r.data},
    async lancamentos(code,sinceMs){
      const out=[];
      for(let from=0;;from+=1000){
        let q=sb.from("pb_lancamentos").select("*").eq("mesa",code);
        if(sinceMs)q=q.gte("atualizado_em",new Date(sinceMs).toISOString());
        const r=await q.order("atualizado_em",{ascending:true}).order("id",{ascending:true}).range(from,from+999);
        if(r.error)throw fail(r.error,r.status);
        out.push(...r.data);
        if(r.data.length<1000)return out;
      }
    },
    async trocas(code){const r=await sb.from("pb_trocas").select("*").eq("mesa",code);if(r.error)throw fail(r.error,r.status);return r.data},
    async titulos(code){const r=await sb.from("pb_titulos").select("*").eq("mesa",code);if(r.error)throw fail(r.error,r.status);return r.data},
    subscribe(code,onRow,onStatus){
      const ch=sb.channel("mesa-"+code)
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_titulos",filter:"mesa=eq."+code},p=>p.new&&onRow("tit",p.new))
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_trocas",filter:"mesa=eq."+code},p=>p.new&&onRow("troca",p.new))
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_lancamentos",filter:"mesa=eq."+code},p=>p.new&&onRow("lanc",p.new))
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_jogadores",filter:"mesa=eq."+code},p=>p.new&&onRow("jog",p.new))
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_mesas",filter:"codigo=eq."+code},p=>p.new&&onRow("mesa",p.new))
        .subscribe(s=>onStatus(s));
      return()=>{try{sb.removeChannel(ch)}catch(e){}};
    },
    bumps(code,onBump,onPos){
      const ch=sb.channel("toque-"+code,{config:{broadcast:{self:false,ack:false}}})
        .on("broadcast",{event:"bump"},m=>m&&m.payload&&onBump(m.payload))
        .on("broadcast",{event:"pos"},m=>m&&m.payload&&onPos&&onPos(m.payload)).subscribe();
      return{send(p){try{ch.send({type:"broadcast",event:"bump",payload:p})}catch(e){}},sendPos(p){try{ch.send({type:"broadcast",event:"pos",payload:p})}catch(e){}},close(){try{sb.removeChannel(ch)}catch(e){}}};
    }
  };
}
const API=window.PORTI_TEST_API||makeApi();

/* ---------- sound ----------
   Phones only let a page make sound after a tap, and the iPhone pauses the
   sound engine when the screen locks or the app goes to the background. So
   every tap wakes the sound back up, and the speaker button shows when it is
   still asleep. On the iPhone the silent switch also mutes it. */
let soundOn=ls.get("pb-sound")!=="0",ac=null,soundReady=false;
function actx(){
  if(!ac){try{ac=new (window.AudioContext||window.webkitAudioContext)();ac.onstatechange=()=>{soundReady=ac.state==="running";drawSnd()}}catch(e){}}
  return ac;
}
/* iPhone: after the app goes to the background (or another app takes the
   audio — a call, dictation, a notification), the old sound engine can come
   back "running" but silent, and resume() can't fix it. So a sound engine
   that has been through the background is thrown away and a fresh one is
   made on the next tap, which iOS always lets play. */
let acStale=false,resumeT=null,resumeAt=0;
/* a sound asked for right after a tap waits for the engine to wake instead of being dropped */
const canPlay=a=>!!a&&(a.state==="running"||(a.state!=="closed"&&Date.now()-resumeAt<1200));
function freshSound(){
  const old=ac;ac=null;soundReady=false;longBus=null;sfxBus=null;
  if(old){try{old.onstatechange=null;old.close()}catch(e){}}
}
function wakeSound(){
  if(acStale){acStale=false;freshSound()}
  const a=actx();if(!a)return;
  if(a.state!=="running"){
    resumeAt=Date.now();
    try{const p=a.resume();if(p&&p.then)p.then(()=>{soundReady=a.state==="running";drawSnd()}).catch(()=>{})}catch(e){}
    try{const b=a.createBuffer(1,1,22050),s=a.createBufferSource();s.buffer=b;s.connect(a.destination);s.start(0)}catch(e){}
    /* still asleep a moment later: start over on the next tap */
    clearTimeout(resumeT);resumeT=setTimeout(()=>{if(ac===a&&a.state!=="running")acStale=true;drawSnd()},500);
  }
  soundReady=a.state==="running";
}
["pointerdown","touchend","keydown"].forEach(ev=>document.addEventListener(ev,wakeSound,{passive:true,capture:true}));
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden"){soundReady=false;if(ac)acStale=true}
  drawSnd();
});
window.addEventListener("pageshow",e=>{if(e.persisted&&ac){acStale=true;soundReady=false;drawSnd()}});
window.addEventListener("pagehide",()=>{if(ac){acStale=true;soundReady=false}});
function tone(f,t0,dur,type,vol,f2){
  const a=actx();if(!canPlay(a))return;const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+t0;
  o.type=type||"sine";o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.15,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g).connect(sfxBus||a.destination);o.start(t);o.stop(t+dur+.05);
}
function noise(t0,dur,vol,ftype,freq){
  const a=actx();if(!canPlay(a))return;const b=a.createBuffer(1,Math.floor(a.sampleRate*dur),a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);
  const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();f.type=ftype||"highpass";f.frequency.value=freq||3000;g.gain.value=vol;
  s.buffer=b;s.connect(f).connect(g).connect(sfxBus||a.destination);s.start(a.currentTime+t0);
}
const SFX={
  tap(){tone(880,0,.05,"triangle",.07)},
  pay(){noise(0,.08,.1);tone(1320,.02,.12,"triangle",.14);tone(1760,.1,.35,"sine",.16);tone(2637,.1,.3,"sine",.05)},
  recv(){tone(988,0,.08,"square",.07);tone(1319,.07,.35,"square",.07)},
  go(){[523,659,784,1047].forEach((f,i)=>tone(f,i*.08,.22,"triangle",.14));tone(1568,.34,.4,"sine",.08)},
  ask(){tone(660,0,.12,"triangle",.12);tone(880,.14,.12,"triangle",.12);tone(660,.28,.18,"triangle",.1)},
  undo(){tone(660,0,.14,"sine",.13,330)},
  broke(){[392,370,349,262].forEach((f,i)=>tone(f,i*.18,.24,"sawtooth",.06))},
  sync(){tone(784,0,.12,"sine",.1);tone(1175,.1,.25,"sine",.1)},
  chomp(){[0,.32,.64,.96].forEach((t,i)=>{noise(t,.09,.14);tone(170-i*12,t,.16,"square",.09,90)});noise(1.25,.08,.1);tone(1320,1.27,.12,"triangle",.12);tone(1760,1.35,.4,"sine",.14)},
  err(){tone(180,0,.18,"square",.07)},
  /* cell door sliding down, slamming and the key locking */
  jail(){tone(900,0,.55,"sawtooth",.05,220);noise(0,.5,.05);noise(.55,.12,.22);tone(120,.55,.35,"square",.12,70);[700,1400,2100].forEach(f=>tone(f,.56,.5,"triangle",.04));noise(1.05,.03,.18);tone(2400,1.06,.05,"square",.06);noise(1.15,.03,.18);tone(1900,1.16,.06,"square",.06)},
  /* heavy cell gate: rattling slide down, PÁ slam with steel ringing, rattle, key click */
  slam(){
    noise(0,.42,.05,"bandpass",1800);tone(420,0,.42,"sawtooth",.025,160);
    [0,.07,.14,.21,.28,.35].forEach(t=>noise(t,.02,.05,"bandpass",4200));
    const T=.44;
    tone(95,T,.5,"sine",.5,38);tone(60,T,.6,"sine",.35,30);
    noise(T,.22,.5,"lowpass",900);noise(T,.06,.35,"highpass",2500);
    [[523,.10,1.3],[1187,.07,1.0],[1861,.05,.8],[2693,.035,.6],[3520,.02,.45]].forEach(([f,v,d])=>tone(f,T+.005,d,"triangle",v,f*.985));
    [.62,.7,.79,.9].forEach((t,i)=>{noise(t,.025,.09-i*.015,"bandpass",3000);tone(1300-i*80,t,.08,"triangle",.03)});
    noise(1.35,.025,.2,"highpass",2000);tone(2400,1.36,.04,"square",.05);noise(1.48,.03,.22,"highpass",1800);tone(1700,1.49,.07,"square",.06)
  },
  /* little car: honk on arrival, engine revs, VUUM driving off */
  vacay(){
    tone(110,0,.9,"sawtooth",.035,140);noise(0,.9,.03,"lowpass",400);
    tone(440,.15,.14,"square",.06);tone(554,.15,.14,"square",.05);tone(440,.36,.2,"square",.06);tone(554,.36,.2,"square",.05);
    tone(90,1.0,.55,"sawtooth",.07,260);tone(180,1.0,.55,"square",.03,520);
    tone(320,1.55,.75,"sawtooth",.08,70);noise(1.5,.8,.14,"bandpass",900);noise(1.55,.6,.05,"highpass",4000)
  },
  /* 3D trip (6s): car rolls in ~0.2-1.6s, waits, honks, revs, leaves 3.2-4.9s */
  vacay3d(){
    tone(140,.2,1.4,"sawtooth",.04,95);noise(.2,1.4,.04,"lowpass",500);
    tone(440,1.75,.14,"square",.06);tone(554,1.75,.14,"square",.05);tone(440,1.96,.22,"square",.06);tone(554,1.96,.22,"square",.05);
    tone(85,2.3,.85,"sawtooth",.04,95);
    tone(90,2.75,.5,"sawtooth",.07,280);tone(180,2.75,.5,"square",.03,560);
    tone(330,3.2,1.5,"sawtooth",.08,60);noise(3.15,1.5,.13,"bandpass",900);noise(3.2,1.1,.05,"highpass",4000)
  },
  /* vacation (own style): umbrella drops and pops open, sunglasses land, beach jingle */
  vacay5(){
    noise(.4,.35,.06,"bandpass",1400);tone(900,.4,.35,"sine",.04,300);
    noise(.95,.08,.22,"bandpass",2200);tone(330,.95,.14,"triangle",.12,880);tone(660,1.0,.12,"triangle",.07,1320);
    noise(1.0,.45,.05,"bandpass",1200);tone(1600,1.0,.45,"sine",.03,500);
    tone(2637,1.45,.18,"triangle",.07);tone(3520,1.47,.22,"triangle",.05);noise(1.45,.04,.12,"highpass",5000);
    [523,659,784,1047,784,1047].forEach((f,i)=>{const t=1.6+i*.11;tone(f,t,.22,"triangle",.11);tone(f*2,t,.12,"sine",.03)});
  },
  back5(){
    noise(.35,.4,.07,"bandpass",1800);tone(400,.35,.4,"sine",.05,1400);
    tone(880,.75,.3,"triangle",.08,330);noise(.75,.2,.1,"bandpass",1500);
    [784,659,523,659,784].forEach((f,i)=>tone(f,1.35+i*.1,.2,"triangle",.11))
  },
  /* quad bike (3.8s): rolls in .25-.95, bag lands 1.2, umbrella pops 1.55, revs 1.5-2.4, leaves 2.45-3.2 */
  vacay4(){
    tone(120,.25,.75,"sawtooth",.05,90);noise(.25,.75,.06,"lowpass",600);
    tone(70,1.2,.18,"sine",.35,45);noise(1.2,.1,.2,"lowpass",900);tone(90,1.32,.12,"sine",.18,50);
    noise(1.55,.12,.12,"bandpass",2500);tone(900,1.56,.12,"triangle",.06,1500);
    [1.5,1.62,1.74,1.86,1.98,2.1,2.22].forEach(t=>tone(95,t,.1,"sawtooth",.05,110));
    tone(110,2.3,.25,"sawtooth",.07,260);
    tone(340,2.45,.85,"sawtooth",.08,70);noise(2.42,.85,.13,"bandpass",900);noise(2.45,.6,.05,"highpass",4000)
  },
  back4(){
    tone(60,0,.85,"sawtooth",.05,140);noise(0,.85,.09,"bandpass",700);tone(150,.83,.3,"sawtooth",.05,80);
    noise(1.45,.1,.1,"bandpass",2000);noise(1.6,.12,.1,"bandpass",2500);
    tone(110,2.25,.15,"sawtooth",.06,240);tone(320,2.37,.8,"sawtooth",.07,70);noise(2.37,.8,.1,"bandpass",900);
    tone(784,2.95,.12,"triangle",.12);tone(1175,3.05,.3,"triangle",.12)
  },
  back3d(){tone(70,.25,2.2,"sawtooth",.05,150);noise(.25,2.2,.08,"bandpass",700);tone(150,2.3,.5,"sawtooth",.05,80);tone(440,2.9,.14,"square",.06);tone(554,2.9,.14,"square",.05);tone(440,3.11,.22,"square",.06);tone(554,3.11,.22,"square",.05)},
  back(){tone(260,0,.8,"sawtooth",.06,110);noise(0,.8,.1,"bandpass",800);tone(440,.95,.14,"square",.06);tone(554,.95,.14,"square",.05);tone(440,1.16,.2,"square",.06);tone(554,1.16,.2,"square",.05)},
  /* key turning and the door opening */
  unlock(){noise(0,.03,.18);tone(2200,0,.05,"square",.06);noise(.12,.03,.18);tone(2600,.12,.05,"square",.06);tone(240,.3,.5,"sawtooth",.04,700);noise(.3,.45,.04);[523,659,784].forEach((f,i)=>tone(f,.85+i*.08,.2,"triangle",.11))}
};
let sfxBus=null,longBus=null;
const LONG_SFX={vacay3d:1,back3d:1,vacay4:1,back4:1,vacay5:1,back5:1};
function stopSfx(){const b=longBus;longBus=null;const a=ac;if(!b||!a)return;try{b.gain.setTargetAtTime(0,a.currentTime,.05);setTimeout(()=>{try{b.disconnect()}catch(e){}},400)}catch(e){}}
function play(k){
  if(soundOn)try{wakeSound();
    if(LONG_SFX[k]&&canPlay(ac)){stopSfx();longBus=ac.createGain();longBus.connect(ac.destination);sfxBus=longBus;try{SFX[k]()}finally{sfxBus=null}}
    else SFX[k]()}catch(e){sfxBus=null}
  try{if(navigator.vibrate)navigator.vibrate(k==="err"?[40,40,40]:k==="ask"?[60,60,60]:k==="pay"?25:12)}catch(e){}
}
function drawSnd(){
  const b=$("#sndBtn");if(!b)return;
  const locked=soundOn&&!soundReady;
  b.innerHTML=`<svg><use href="#${soundOn?"snd-on":"snd-off"}"/></svg>`;
  b.className="iconbtn"+(soundOn?(locked?" locked":""):" off");
  b.setAttribute("aria-label",!soundOn?"Ligar o som":locked?"Som travado: toque para ativar":"Som ligado: toque para desligar");
}
$("#sndBtn").onclick=()=>{
  wakeSound();
  if(soundOn&&!soundReady){setTimeout(()=>{drawSnd();play("recv");toast(isIOS?"Som ativado. Se não ouvir nada, tire o iPhone do modo silencioso.":"Som ativado.")},60);return}
  soundOn=!soundOn;ls.set("pb-sound",soundOn?"1":"0");drawSnd();
  if(soundOn){setTimeout(()=>play("recv"),60);toast(isIOS?"Som ligado. No iPhone, ele não toca no modo silencioso.":"Som ligado.")}
  else toast("Som desligado.");
};

/* ---------- local copy of a table ----------
   L = {v, codigo, mesa:{saldo_inicial,salario,banqueiro}, jog:{id:row}, lanc:{id:row}, out:[op], me, since}
   jog/lanc hold rows confirmed by the server; out holds what this phone still has to send. */
let L=null,net="idle",live=false,unsub=null,timer=null,firstSync=false,forceJoin=false;
let peek=ls.get("pb-mask")==="1";
const blank=code=>({v:1,codigo:code,mesa:null,jog:{},lanc:{},tit:{},out:[],me:null,since:0});
function loadMesa(code){try{const d=JSON.parse(ls.get("pb-mesa-"+code)||"null");if(d&&d.v===1)return d}catch(e){}return null}
function save(){if(L)ls.set("pb-mesa-"+L.codigo,JSON.stringify(L))}

/* who holds the bank, counting changes still waiting in the queue */
function banker(){
  let b=L&&L.mesa?L.mesa.banqueiro||null:null;
  if(!L)return null;
  for(const op of L.out){if(op.t==="banco")b=op.para;else if(op.t==="entrar"&&!b)b=op.id}
  return b;
}
const iAmBanker=()=>!!L&&!!L.me&&banker()===L.me;
/* bank money going to a player needs the banker, unless the banker launched it.
   money leaving a player's account, launched by someone else, waits for that player to confirm
   (the banker launches directly only when the money is not going to himself) */
const needsApproval=(de,para,por)=>{const bk=banker();if(!de)return !!para&&!!bk&&por!==bk;return por!==de&&!(!!bk&&por===bk&&para!==bk)};
/* who may confirm a pending entry */
const canDecide=t=>{const bk=banker();if(!t.de)return L.me===bk;return L.me===t.de||(L.me===bk&&t.para!==bk)};

/* merged view: server rows + what is still waiting in the queue */
function derive(){
  const P={},T={},Tit={},Tr={};
  for(const[id,x]of Object.entries(L.trocas||(L.trocas={})))Tr[id]={...x};
  for(const[id,p]of Object.entries(L.jog))P[id]={...p};
  for(const[id,t]of Object.entries(L.lanc))T[id]={...t};
  for(const[id,t]of Object.entries(L.tit||(L.tit={})))Tit[id]={...t};
  for(const op of L.out){
    if(op.t==="titulo"){applyTit(Tit,T,op);continue}
    if(op.t==="troca"){applyTroca(Tr,Tit,T,op);continue}
    if(op.t==="entrar"&&!P[op.id])P[op.id]={id:op.id,nome:op.nome,cor:op.cor,oculto:false,criado_em:op.em,pend:true};
    else if(op.t==="ocultar"&&P[op.id])P[op.id].oculto=op.oculto;
    else if(op.t==="remover"&&P[op.id])P[op.id].removido=true;
    else if(op.t==="foto"&&P[op.id])P[op.id].foto=op.foto;
    else if(op.t==="situacao"&&P[op.id]){P[op.id].situacao=op.situacao||null;P[op.id].rodadas=sitRounds(op.situacao)}
    else if(op.t==="vez"&&P[op.id])passVez(P[op.id]);
    else if(op.t==="lancar"&&!T[op.id])T[op.id]={id:op.id,de:op.de,para:op.para,valor:op.valor,motivo:op.motivo,lancado_por:op.por,feito_em:op.em,estornado_em:null,status:op.status||"aprovado",pend:true};
    else if(op.t==="estornar"&&T[op.id]&&!T[op.id].estornado_em&&T[op.id].status!=="recusado"){
      if(T[op.id].status==="pendente"){T[op.id].status="recusado";T[op.id].aprovado_por=op.por;T[op.id].stPend=true}
      else{T[op.id].estornado_em=op.em;T[op.id].estornado_por=op.por;T[op.id].estPend=true}
    }
    else if((op.t==="aprovar"||op.t==="recusar")&&T[op.id]&&T[op.id].status==="pendente"){T[op.id].status=op.t==="aprovar"?"aprovado":"recusado";T[op.id].aprovado_por=op.por;T[op.id].stPend=true}
  }
  return{P,T,Tit,Tr};
}
const counts=t=>!t.estornado_em&&(t.status||"aprovado")==="aprovado";
function balances(D){
  const b={},s=(L.mesa&&L.mesa.saldo_inicial)||0;
  for(const id in D.P)b[id]=s;
  for(const t of Object.values(D.T)){if(!counts(t))continue;if(t.de&&t.de in b)b[t.de]-=t.valor;if(t.para&&t.para in b)b[t.para]+=t.valor}
  return b;
}
const playersArr=D=>Object.values(D.P).filter(p=>!p.removido).sort((a,b)=>tms(a.criado_em)-tms(b.criado_em));
const txArr=D=>Object.values(D.T).sort((a,b)=>tms(b.feito_em)-tms(a.feito_em));
function nameOf(id,D){if(!id)return"Banco";const p=(D||derive()).P[id];return p?p.nome:"?"}
function tableAverage(D,exceptId){
  const b=balances(D);const ids=Object.keys(D.P).filter(id=>id!==exceptId&&!D.P[id].removido);
  if(!ids.length)return L.mesa.saldo_inicial;
  return Math.round(ids.reduce((s,id)=>s+b[id],0)/ids.length/1000)*1000;
}

/* ---------- cartas: Títulos de Posse do Banco Imobiliário Mundo ----------
   id = número no verso da carta. al = aluguel sem casa, 1..4 casas, condomínio. */
const GRUPOS=[
  {k:"verde",n:"Verde",c:"#3DAA4A",ids:[7,8,1]},
  {k:"laranja",n:"Laranja",c:"#E8641E",ids:[9,10,11]},
  {k:"azul",n:"Azul",c:"#2B8FDB",ids:[23,24,17]},
  {k:"rosa",n:"Rosa",c:"#C63FB8",ids:[18,19]},
  {k:"roxo",n:"Roxo",c:"#6E3CA8",ids:[13,20]},
  {k:"vinho",n:"Vinho",c:"#A11D33",ids:[4,3,2]},
  {k:"verdeesc",n:"Verde-escuro",c:"#2E8466",ids:[14,15,16]},
  {k:"amarelo",n:"Amarelo",c:"#E99B0C",ids:[12,5,6]},
  {k:"acao",n:"Ações",c:"#2A2A33",ids:[27,21,22,25,28,26]}
];
const CARDS={};
[[1,"Cidade do Cabo","África do Sul",60000,[2000,10000,30000,90000,160000,250000],50000,50000],
 [2,"Londres","Inglaterra",240000,[20000,100000,300000,750000,925000,1100000],150000,120000],
 [3,"Berlim","Alemanha",220000,[18000,90000,250000,700000,875000,1050000],150000,110000],
 [4,"Paris","França",220000,[18000,90000,250000,700000,875000,1050000],150000,110000],
 [5,"Ottawa","Canadá",260000,[22000,110000,330000,800000,975000,1150000],150000,150000],
 [6,"Washington","EUA",260000,[22000,110000,330000,800000,975000,1150000],150000,150000],
 [7,"Cairo","Egito",100000,[6000,30000,90000,270000,400000,500000],50000,50000],
 [8,"Luanda","Angola",75000,[4000,20000,60000,180000,320000,450000],50000,50000],
 [9,"Doha","Catar",320000,[28000,150000,450000,1000000,1200000,1400000],200000,160000],
 [10,"Riade","Arábia Saudita",300000,[26000,130000,390000,900000,1100000,1275000],200000,150000],
 [11,"Abu Dhabi","Emirados Árabes",300000,[26000,130000,390000,900000,1100000,1275000],200000,150000],
 [12,"Cidade do México","México",280000,[26000,130000,360000,850000,1125000,1200000],150000,140000],
 [13,"Cidade da Guatemala","Guatemala",100000,[6000,30000,90000,270000,400000,500000],50000,50000],
 [14,"Seul","Coreia do Sul",140000,[10000,50000,150000,450000,625000,750000],100000,70000],
 [15,"Pequim","China",160000,[12000,60000,180000,500000,700000,900000],100000,80000],
 [16,"Tóquio","Japão",140000,[10000,50000,150000,450000,625000,750000],100000,70000],
 [17,"Buenos Aires","Argentina",180000,[14000,70000,200000,550000,750000,950000],100000,100000],
 [18,"Camberra","Austrália",400000,[50000,200000,600000,1400000,1700000,2000000],200000,175000],
 [19,"Wellington","Nova Zelândia",350000,[35000,175000,500000,1100000,1300000,1500000],200000,200000],
 [20,"São José","Costa Rica",120000,[8000,40000,100000,300000,450000,600000],50000,60000],
 [23,"Santiago","Chile",200000,[16000,80000,220000,600000,800000,1000000],100000,100000],
 [24,"Montevidéu","Uruguai",180000,[14000,70000,200000,550000,750000,950000],100000,100000]
].forEach(([id,nome,pais,preco,al,casa,hip])=>{CARDS[id]={id,nome,pais,preco,al,casa,hip}});
[[21,"OMC","Org. Mundial do Comércio",200000,50000,100000],[22,"ONU","Nações Unidas",200000,50000,100000],
 [25,"OIT","Org. Internacional do Trabalho",200000,50000,100000],[26,"OTAN","Aliança do Atlântico Norte",200000,50000,100000],
 [27,"IPCC","Painel do Clima",150000,40000,75000],[28,"OMS","Org. Mundial da Saúde",150000,40000,75000]
].forEach(([id,nome,pais,preco,mult,hip])=>{CARDS[id]={id,nome,pais,preco,mult,casa:0,hip,acao:true}});
GRUPOS.forEach(g=>g.ids.forEach(id=>{CARDS[id].g=g.k;CARDS[id].cor=g.c}));
const blankTit=c=>({carta:c,dono:null,casas:0,casas_hip:0,hipotecada:false,oferta:null,pedido:null,venda_para:null,venda_preco:null});
/* the same rules the server applies, so the phone shows the result right away */
function applyTit(Tit,T,op,boss){
  const c=CARDS[op.carta];if(!c)return;
  const t=Tit[op.carta]=Object.assign(blankTit(op.carta),Tit[op.carta]);
  const money=(de,para,valor,motivo)=>{if(T&&!T[op.id])T[op.id]={id:op.id,mesa:L.codigo,de,para,valor,motivo,lancado_por:op.por,feito_em:op.em,estornado_em:null,status:"aprovado",pend:true}};
  const bossOp=!!op.por&&op.por===banker();
  if(op.acao==="ofertar"){if(!t.dono)t.oferta=op.para}
  else if(op.acao==="pedir"){if(!t.dono&&(!t.pedido||t.pedido===op.por))t.pedido=op.por}
  else if(op.acao==="recusar"){if(bossOp){t.oferta=null;t.pedido=null;t.venda_para=null;t.venda_preco=null}else{if(t.oferta===op.por)t.oferta=null;if(t.pedido===op.por)t.pedido=null;if(t.venda_para===op.por||t.dono===op.por){t.venda_para=null;t.venda_preco=null}}}
  else if(op.acao==="vender"){if(t.dono&&op.para&&op.para!==t.dono){t.venda_para=op.para;t.venda_preco=op.valor||0}}
  else if(op.acao==="aceitar_venda"){if(t.venda_para!==op.por)return;if(t.venda_preco>0)money(op.por,t.dono,t.venda_preco,("Compra: "+c.nome).slice(0,40));t.dono=op.por;t.oferta=null;t.pedido=null;t.venda_para=null;t.venda_preco=null}
  else if(op.acao==="comprar"){if(t.dono)return;const d=op.para||op.por;t.dono=d;t.oferta=null;t.pedido=null;t.venda_para=null;t.venda_preco=null;t.casas=0;t.casas_hip=0;t.hipotecada=false;money(d,null,c.preco,("Compra: "+c.nome).slice(0,40))}
  else if(op.acao==="construir"){if(!t.dono||c.acao||t.hipotecada||t.casas>=5||!groupGap(Tit,c,t.dono).ok)return;money(t.dono,null,c.casa,((t.casas===4?"Condomínio: ":"Construção: ")+c.nome).slice(0,40));t.casas++}
  else if(op.acao==="hipotecar"){if(!t.dono||t.hipotecada)return;t.hipotecada=true;money(null,t.dono,c.hip,("Hipoteca: "+c.nome).slice(0,40))}
  else if(op.acao==="resgatar"){if(!t.dono||!t.hipotecada)return;t.hipotecada=false;money(t.dono,null,c.hip,("Fim da hipoteca: "+c.nome).slice(0,40))}
  else if(op.acao==="tirar_casa"){t.casas=Math.max(0,t.casas-1);t.casas_hip=Math.min(t.casas_hip||0,t.casas)}
  else if(op.acao==="hipotecar_casas"){const n=Math.min(op.n||0,t.casas-(t.casas_hip||0));if(!t.dono||n<1)return;t.casas_hip=(t.casas_hip||0)+n;money(null,t.dono,n*houseHip(c),("Hipoteca de casas: "+c.nome).slice(0,40))}
  else if(op.acao==="resgatar_casas"){const n=Math.min(op.n||0,t.casas_hip||0);if(!t.dono||n<1)return;t.casas_hip-=n;money(t.dono,null,n*houseHip(c),("Fim hip. casas: "+c.nome).slice(0,40))}
  else if(op.acao==="devolver"){t.dono=null;t.oferta=null;t.pedido=null;t.venda_para=null;t.venda_preco=null;t.casas=0;t.casas_hip=0;t.hipotecada=false}
}
/* to build, the owner needs every card of the color, none mortgaged */
function groupGap(Tit,c,owner){
  const g=GRUPOS.find(x=>x.k===c.g);if(!g||c.acao)return{ok:false,missing:[],hip:[]};
  const missing=g.ids.filter(id=>!(Tit[id]&&Tit[id].dono===owner)),hip=g.ids.filter(id=>Tit[id]&&Tit[id].dono===owner&&Tit[id].hipotecada);
  return{ok:!missing.length&&!hip.length,missing,hip};
}

function applyTroca(Tr,Tit,T,op){
  if(op.acao==="propor"){if(!Tr[op.id])Tr[op.id]={id:op.id,de:op.por,para:op.para,carta_de:op.carta_de||null,carta_para:op.carta_para||null,valor:op.valor||0,status:"aberta",criada_em:op.em,pend:true};return}
  const x=Tr[op.id];if(!x||x.status!=="aberta")return;
  if(op.acao==="cancelar")x.status="cancelada";
  else if(op.acao==="recusar")x.status="recusada";
  else if(op.acao==="aceitar"){
    const okDe=!x.carta_de||(Tit[x.carta_de]&&Tit[x.carta_de].dono===x.de),okPara=!x.carta_para||(Tit[x.carta_para]&&Tit[x.carta_para].dono===x.para);
    if(!okDe||!okPara){x.status="cancelada";return}
    if(x.carta_de)Tit[x.carta_de]=Object.assign({},Tit[x.carta_de],{dono:x.para,oferta:null,pedido:null,venda_para:null,venda_preco:null});
    if(x.carta_para)Tit[x.carta_para]=Object.assign({},Tit[x.carta_para],{dono:x.de,oferta:null,pedido:null,venda_para:null,venda_preco:null});
    if(x.valor&&T&&!T[op.lanc]){const c=CARDS[x.carta_de||x.carta_para];T[op.lanc]={id:op.lanc,mesa:L.codigo,de:x.valor>0?x.para:x.de,para:x.valor>0?x.de:x.para,valor:Math.abs(x.valor),motivo:("Troca: "+c.nome).slice(0,40),lancado_por:op.por,feito_em:op.em,estornado_em:null,status:"aprovado",pend:true}}
    x.status="aceita";
  }
}
function trocaOp(acao,o){if(!L||!L.me)return;enqueue(Object.assign({t:"troca",id:o.id||uuid(),acao,por:L.me,em:nowIso(),lanc:uuid()},o))}
function titOp(carta,acao,para,valor){
  if(!L||!L.me)return;
  const op={t:"titulo",id:uuid(),carta,acao,para:para||null,por:L.me,em:nowIso()};
  if(acao==="hipotecar_casas"||acao==="resgatar_casas")op.n=valor;else if(valor!=null)op.valor=valor;
  enqueue(op);
}
function rentOf(c,t,dice){
  if(!t||!t.dono||t.hipotecada)return 0;
  if(c.acao)return (dice||0)*c.mult;
  return c.al[rentLvl(t)];
}
/* casas hipotecadas: cada uma rende metade do que custou e para de contar no aluguel */
function houseHip(c){return Math.round((c.casa||0)/2)}
function rentLvl(t){return Math.max(0,(t.casas||0)-(t.casas_hip||0))}
/* rodadas sem jogar: o banqueiro define; cada "passar a vez" desconta uma, e no fim a pessoa sai */
function sitRounds(sit){const m=(L&&L.mesa)||{};return sit==="preso"?(m.rcadeia||2):sit==="ferias"?(m.rferias||1):null}
function passVez(p){if(!p.situacao)return;const r=(p.rodadas==null?1:p.rodadas)-1;if(r<=0){p.situacao=null;p.rodadas=null}else p.rodadas=r}
function rdN(p){const r=p.rodadas==null?sitRounds(p.situacao):p.rodadas;return r?` · ${r}`:""}
function roundsTxt(p){const r=p.rodadas==null?sitRounds(p.situacao):p.rodadas;return r==null?"":r===1?"falta 1 rodada":`faltam ${r} rodadas`}
function doVez(id){
  const D=derive(),p=D.P[id];if(!p||!p.situacao)return;
  const r=p.rodadas==null?sitRounds(p.situacao):p.rodadas,was=p.situacao;
  enqueue({t:"vez",id,op:uuid(),por:L.me,em:nowIso()});
  if(r<=1){if(was==="preso")cellLater(id,false);else tripLater(id,false)}
  else{play("tap");toast((id===L.me?"Vez passada":nameOf(id,D)+" passou a vez")+" · "+(r-1===1?"falta 1 rodada":`faltam ${r-1} rodadas`))}
}

/* ---------- sync engine ---------- */
function enqueue(op){L.out.push(op);save();render();setTimeout(syncNow,0)}
function confirmOp(op){
  if(op.t==="titulo"){applyTit(L.tit||(L.tit={}),L.lanc,op);if(L.lanc[op.id])delete L.lanc[op.id].pend;return}
  if(op.t==="troca"){applyTroca(L.trocas||(L.trocas={}),L.tit||(L.tit={}),L.lanc,op);if(L.trocas[op.id])delete L.trocas[op.id].pend;if(L.lanc[op.lanc])delete L.lanc[op.lanc].pend;return}
  if(op.t==="entrar"&&!L.jog[op.id]){L.jog[op.id]={id:op.id,mesa:L.codigo,nome:op.nome,cor:op.cor,oculto:false,oculto_em:EPOCH,criado_em:op.em};if(L.mesa&&!L.mesa.banqueiro)L.mesa.banqueiro=op.id}
  else if(op.t==="lancar"&&!L.lanc[op.id])L.lanc[op.id]={id:op.id,mesa:L.codigo,de:op.de,para:op.para,valor:op.valor,motivo:op.motivo||null,lancado_por:op.por,feito_em:op.em,estornado_em:null,estornado_por:null,status:op.status||"aprovado"};
  else if(op.t==="estornar"&&L.lanc[op.id]&&!L.lanc[op.id].estornado_em){
    const t=L.lanc[op.id];
    if(t.status==="pendente"){t.status="recusado";t.aprovado_por=op.por}else if(t.status!=="recusado"){t.estornado_em=op.em;t.estornado_por=op.por}
  }
  else if((op.t==="aprovar"||op.t==="recusar")&&L.lanc[op.id]&&L.lanc[op.id].status==="pendente"){L.lanc[op.id].status=op.t==="aprovar"?"aprovado":"recusado";L.lanc[op.id].aprovado_por=op.por}
  else if(op.t==="ocultar"&&L.jog[op.id]){L.jog[op.id].oculto=op.oculto;L.jog[op.id].oculto_em=op.em}
  else if(op.t==="banco"&&L.mesa){L.mesa.banqueiro=op.para}
  else if(op.t==="remover"&&L.jog[op.id]){L.jog[op.id].removido=true}
  else if(op.t==="foto"&&L.jog[op.id]){L.jog[op.id].foto=op.foto}
  else if(op.t==="situacao"&&L.jog[op.id]){L.jog[op.id].situacao=op.situacao||null;L.jog[op.id].rodadas=sitRounds(op.situacao)}
  else if(op.t==="vez"&&L.jog[op.id]){if(L.jog[op.id].vez_op!==op.op){passVez(L.jog[op.id]);L.jog[op.id].vez_op=op.op}}
  else if(op.t==="rodadas"&&L.mesa){L.mesa.rcadeia=op.cadeia;L.mesa.rferias=op.ferias}
  else if(op.t==="esconder"&&L.mesa){L.mesa.esconder=op.permitido}
  else if(op.t==="valores"&&L.mesa){L.mesa.saldo_inicial=op.saldo;L.mesa.salario=op.salario}
  else if(op.t==="encerrar"&&L.mesa){L.mesa.encerrada=op.encerrada}
}
function sendOp(op){
  if(op.t==="entrar")return API.rpc("pb_entrar",{p_id:op.id,p_mesa:L.codigo,p_nome:op.nome,p_cor:op.cor});
  if(op.t==="lancar")return API.rpc("pb_lancar",{p_id:op.id,p_mesa:L.codigo,p_de:op.de,p_para:op.para,p_valor:op.valor,p_motivo:op.motivo||null,p_por:op.por,p_feito_em:op.em});
  if(op.t==="estornar")return API.rpc("pb_estornar",{p_id:op.id,p_por:op.por});
  if(op.t==="aprovar")return API.rpc("pb_aprovar",{p_id:op.id,p_por:op.por});
  if(op.t==="recusar")return API.rpc("pb_recusar",{p_id:op.id,p_por:op.por});
  if(op.t==="ocultar")return API.rpc("pb_ocultar",{p_id:op.id,p_oculto:op.oculto,p_quando:op.em});
  if(op.t==="banco")return API.rpc("pb_passar_banco",{p_mesa:L.codigo,p_de:op.por,p_para:op.para});
  if(op.t==="vez")return API.rpc("pb_passar_vez",{p_id:op.id,p_por:op.por,p_op:op.op});
  if(op.t==="rodadas")return API.rpc("pb_mesa_rodadas",{p_mesa:L.codigo,p_por:op.por,p_cadeia:op.cadeia,p_ferias:op.ferias});
  if(op.t==="situacao")return API.rpc("pb_situacao",{p_id:op.id,p_por:op.por,p_situacao:op.situacao||null});
  if(op.t==="foto")return API.rpc("pb_foto",{p_id:op.id,p_foto:op.foto});
  if(op.t==="remover")return API.rpc("pb_remover_jogador",{p_id:op.id,p_por:op.por});
  if(op.t==="esconder")return API.rpc("pb_mesa_esconder",{p_mesa:L.codigo,p_por:op.por,p_permitido:op.permitido});
  if(op.t==="titulo"&&(op.acao==="hipotecar_casas"||op.acao==="resgatar_casas"))return API.rpc("pb_casas_hip",{p_id:op.id,p_mesa:L.codigo,p_carta:op.carta,p_acao:op.acao==="hipotecar_casas"?"hipotecar":"resgatar",p_por:op.por,p_n:op.n});
  if(op.t==="titulo"){const a={p_id:op.id,p_mesa:L.codigo,p_carta:op.carta,p_acao:op.acao,p_por:op.por,p_para:op.para||null};if(op.valor!=null)a.p_valor=op.valor;return API.rpc("pb_titulo",a)}
  if(op.t==="encerrar")return API.rpc("pb_mesa_encerrar",{p_mesa:L.codigo,p_por:op.por,p_encerrada:op.encerrada});
  if(op.t==="troca")return API.rpc("pb_troca",{p_id:op.id,p_mesa:L.codigo,p_acao:op.acao,p_por:op.por,p_para:op.para||null,p_carta_de:op.carta_de||null,p_carta_para:op.carta_para||null,p_valor:op.valor||0,p_lanc:op.lanc||null});
  if(op.t==="valores")return API.rpc("pb_mesa_valores",{p_mesa:L.codigo,p_por:op.por,p_saldo_inicial:op.saldo,p_salario:op.salario});
  return Promise.resolve();
}
async function flush(cur){
  let sent=0;
  while(cur.out.length){
    const op=cur.out[0];
    try{await sendOp(op)}
    catch(e){
      if((op.t==="encerrar"||(op.t==="titulo"&&(op.acao==="pedir"||op.acao==="vender"||op.acao==="aceitar_venda"||op.acao==="hipotecar_casas"||op.acao==="resgatar_casas"||op.valor!=null)))&&/inv[aá]lida|p_valor|function|does not exist/i.test(e.message||"")&&L===cur){cur.out.shift();save();toast("Falta o banqueiro rodar o SQL novo no Supabase para isso funcionar.");play("err");continue}
      if((op.t==="vez"||op.t==="rodadas")&&(e.config||/function|does not exist|p_op|p_cadeia/i.test(e.message||""))&&L===cur){cur.out.shift();save();toast("Falta o banqueiro rodar o SQL novo no Supabase para contar as rodadas.");play("err");continue}
      if(e.config&&(op.t==="titulo"||op.t==="troca")&&L===cur){cur.out.shift();save();toast("As cartas ainda não estão ligadas no banco online: falta rodar o SQL novo.");play("err");continue}
      if(e.network||e.config)throw e;
      if(L!==cur)return sent;
      cur.out.shift();save();
      toast("Não foi registrado: "+(e.message||"erro"));play("err");
      continue;
    }
    if(L!==cur)return sent;
    cur.out.shift();confirmOp(op);save();sent++;
  }
  return sent;
}
function mergeMesa(m){
  if(!m||m.codigo!==L.codigo)return;
  const was=L.mesa&&L.mesa.banqueiro;
  L.mesa={saldo_inicial:m.saldo_inicial,salario:m.salario,banqueiro:m.banqueiro||null,esconder:m.esconder_permitido!==false,encerrada:!!m.encerrada,rcadeia:m.rodadas_cadeia||2,rferias:m.rodadas_ferias||1};
  for(const op of L.out)if(op.t==="rodadas"){L.mesa.rcadeia=op.cadeia;L.mesa.rferias=op.ferias}
  for(const op of L.out)if(op.t==="encerrar")L.mesa.encerrada=op.encerrada;
  for(const op of L.out)if(op.t==="esconder")L.mesa.esconder=op.permitido;
  for(const op of L.out)if(op.t==="valores"){L.mesa.saldo_inicial=op.saldo;L.mesa.salario=op.salario}
  if(firstSync&&was&&m.banqueiro&&was!==m.banqueiro&&L.me){
    const D=derive();
    if(m.banqueiro===L.me){toast("Agora você é o banqueiro da mesa.");play("go")}
    else toast(nameOf(m.banqueiro,D)+" agora é o banqueiro.");
  }
}
function mergeRows(kind,rows,notify){
  if(!L)return;
  const news=[],joined=[];
  for(const r of rows||[]){
    if(!r)continue;
    if(kind==="mesa"){mergeMesa(r);continue}
    if(!r.id||(r.mesa&&r.mesa!==L.codigo))continue;
    if(kind==="jog"){
      const wasSit=(L.jog[r.id]||{}).situacao||null;
      if(notify&&L.jog[r.id]&&(r.situacao||null)!==wasSit){
        const mine=r.id===L.me;
        if(r.situacao==="preso"){cellLater(r.id,true);if(mine)toast("Você foi para a cadeia! Só o banqueiro mexe na sua conta agora.")}
        else if(r.situacao==="ferias"){tripLater(r.id,true);if(mine)toast("Você está de férias. Só o banqueiro mexe na sua conta agora.")}
        else if(wasSit==="preso")cellLater(r.id,false);
        else if(wasSit==="ferias")tripLater(r.id,false);
        else if(mine){toast("Você voltou para o jogo!");play("unlock")}
      }
      if(notify&&r.id===L.me&&r.removido&&!(L.jog[r.id]||{}).removido){toast("O banqueiro tirou seu cartão da mesa.");play("err")}
      if(notify&&!L.jog[r.id]&&!L.out.some(o=>o.t==="entrar"&&o.id===r.id))joined.push(r);
      L.jog[r.id]={...L.jog[r.id],...r};
    }else{
      const old=L.lanc[r.id];
      const mine=L.out.some(o=>o.t==="lancar"&&o.id===r.id);
      if(notify&&!old&&!mine)news.push({...r,_new:true});
      else if(notify&&old){
        if(!old.estornado_em&&r.estornado_em&&r.estornado_por!==L.me)news.push({...r,_est:true});
        else if(old.status==="pendente"&&r.status&&r.status!=="pendente"&&r.aprovado_por!==L.me)news.push({...r,_dec:r.status});
      }
      L.lanc[r.id]=r;
    }
    const t=tms(r.atualizado_em);if(t>L.since)L.since=t;
  }
  if(joined.length)announceJoin(joined);
  if(news.length)announce(news);
}
function announceJoin(rows){
  if(!iAmBanker())return;
  const D=derive();
  const started=Object.keys(D.T).length>0;
  for(const p of rows){
    if(started)toast(p.nome+" entrou no meio do jogo. Quer equilibrar o saldo?",{label:"Ajustar",run:()=>openSheet("set",p.id)});
    else toast(p.nome+" entrou na mesa.");
    play("tap");
  }
}
function announce(news){
  const me=L.me;if(!me)return;
  const D=derive(),boss=iAmBanker();
  const eaten=news.filter(r=>r._new&&paysBank(r)&&(r.status||"aprovado")==="aprovado"&&r.lancado_por!==me);
  if(eaten.length){const r=eaten[eaten.length-1];bancoComeu(nameOf(r.de,D),r.valor)}
  const asks=news.filter(r=>r._new&&r.status==="pendente"&&boss&&!r.de&&r.lancado_por!==me);
  const bills=news.filter(r=>r._new&&r.status==="pendente"&&r.de===me&&r.lancado_por!==me);
  const mine=news.filter(r=>!asks.includes(r)&&!bills.includes(r)&&(r.de===me||r.para===me));
  if(bills.length){
    const r=bills[bills.length-1];
    toast(bills.length>1?bills.length+" cobranças esperando você pagar":nameOf(r.para,D)+" está te cobrando "+money(r.valor)+(r.motivo?" ("+r.motivo+")":""));
    play("ask");try{navigator.vibrate&&navigator.vibrate([80,60,80])}catch(e){}
  }
  if(asks.length){
    toast(asks.length>1?asks.length+" pedidos esperando você aprovar":nameOf(asks[0].lancado_por,D)+" pediu "+money(asks[0].valor)+(asks[0].motivo?" ("+asks[0].motivo+")":""));
    play("ask");
  }
  if(!mine.length)return;
  if(mine.length>3){toast(mine.length+" lançamentos novos na sua conta");play("recv");flashCard();return}
  for(const r of mine){
    if(r._est){toast(nameOf(r.estornado_por,D)+" estornou "+money(r.valor)+" ("+nameOf(r.de,D)+" → "+nameOf(r.para,D)+")");play("undo")}
    else if(r._dec&&r.de){
      if(r.de===me)continue;
      if(r._dec==="aprovado"){toast(nameOf(r.de,D)+" pagou "+money(r.valor)+(r.motivo?" ("+r.motivo+")":""));if(r.para===me){play("recv");flashCard()}else play("pay")}
      else toast(nameOf(r.aprovado_por||r.de,D)+" recusou a cobrança de "+money(r.valor)),play("err");
    }
    else if(r._dec){
      if(r.para===me&&r._dec==="aprovado"){toast("O banqueiro aprovou: + "+money(r.valor));play(r.motivo==="Passou pela partida"?"go":"recv");flashCard()}
      else if(r.para===me){toast("O banqueiro recusou o pedido de "+money(r.valor));play("err")}
    }
    else if(r.status==="pendente")continue;
    else if(r.para===me&&r.lancado_por!==me){toast("Recebeu "+money(r.valor)+" de "+nameOf(r.de,D));play("recv");flashCard()}
    else if(r.de===me&&r.lancado_por!==me){toast(nameOf(r.lancado_por,D)+" lançou "+money(r.valor)+" na sua conta");play("pay")}
  }
}
let syncing=false,again=false;
let titOff=false,trocaOff=false;
function mergeTrocas(rows,notify){
  if(!L)return;L.trocas=L.trocas||{};
  for(const r of rows||[]){
    if(!r||(r.mesa&&r.mesa!==L.codigo))continue;
    const was=L.trocas[r.id];
    L.trocas[r.id]={id:r.id,de:r.de,para:r.para,carta_de:r.carta_de||null,carta_para:r.carta_para||null,valor:r.valor||0,status:r.status,criada_em:r.criada_em};
    if(!notify)continue;
    if(!was&&r.para===L.me&&r.status==="aberta"){play("ask");try{navigator.vibrate&&navigator.vibrate([80,60,80])}catch(e){}}
    if(was&&was.status==="aberta"&&r.status!=="aberta"&&r.de===L.me){
      const nm=nameOf(r.para);
      if(r.status==="aceita"){play("go");toast(nm+" aceitou a troca!")}else if(r.status==="recusada"){play("undo");toast(nm+" recusou a troca.")}
    }
  }
}
function mergeTit(rows,notify){
  if(!L)return;L.tit=L.tit||{};
  for(const r of rows||[]){
    if(!r||(r.mesa&&r.mesa!==L.codigo)||!CARDS[r.carta])continue;
    const was=L.tit[r.carta]||blankTit(r.carta);
    L.tit[r.carta]={carta:r.carta,dono:r.dono||null,casas:r.casas||0,casas_hip:r.casas_hip||0,hipotecada:!!r.hipotecada,oferta:r.oferta||null,pedido:r.pedido||null,venda_para:r.venda_para||null,venda_preco:r.venda_preco==null?null:r.venda_preco};
    if(notify&&r.venda_para===L.me&&was.venda_para!==L.me){play("ask");if(navigator.vibrate)try{navigator.vibrate([80,60,80])}catch(e){}}
    if(notify&&was.dono===L.me&&was.venda_para&&r.dono===was.venda_para){const c=CARDS[r.carta];toast(`${nameOf(r.dono)} comprou ${c.nome}${was.venda_preco?" por "+money(was.venda_preco):""}`);play("recv")}
    else if(notify&&was.dono===L.me&&was.venda_para&&!r.venda_para&&r.dono===L.me){const c=CARDS[r.carta];toast(`${nameOf(was.venda_para)} não quis comprar ${c.nome}`);play("err")}
    if(notify&&r.oferta===L.me&&was.oferta!==L.me){play("ask");if(navigator.vibrate)try{navigator.vibrate([80,60,80])}catch(e){}}
    if(notify&&was.pedido===L.me&&r.pedido!==L.me&&!was.dono){const c=CARDS[r.carta];if(r.dono===L.me){toast(`O banqueiro autorizou: ${c.nome} é sua!`);play("go");setTimeout(flashCard,50)}else if(!r.dono||r.dono!==L.me){toast(`O banqueiro recusou seu pedido de ${c.nome}`);play("err")}}
    if(notify&&r.pedido&&r.pedido!==was.pedido&&!r.dono&&iAmBanker()&&r.pedido!==L.me){play("ask");if(navigator.vibrate)try{navigator.vibrate([80,60,80])}catch(e){}}
  }
}
async function syncNow(){
  if(!L||!API)return;
  if(syncing){again=true;return}
  syncing=true;
  const cur=L;let sent=0;
  try{
    sent=await flush(cur);
    if(L!==cur)return;
    const m=await API.mesa(cur.codigo);if(L!==cur)return;
    if(!m){mesaMissing();return}
    mergeMesa(m);
    const js=await API.jogadores(cur.codigo);if(L!==cur)return;mergeRows("jog",js,firstSync);
    const ts=await API.lancamentos(cur.codigo,cur.since?cur.since-5000:0);if(L!==cur)return;mergeRows("lanc",ts,firstSync);
    if(API.titulos&&!titOff){try{const tt=await API.titulos(cur.codigo);if(L!==cur)return;mergeTit(tt,firstSync)}catch(e){if(e.config)titOff=true;else throw e}}
    if(API.trocas&&!trocaOff){try{const tr=await API.trocas(cur.codigo);if(L!==cur)return;mergeTrocas(tr,firstSync)}catch(e){if(e.config)trocaOff=true;else throw e}}
    firstSync=true;save();
    const wasOff=net==="offline";
    setNet("online");
    if(wasOff){toast(sent?"Internet voltou · "+sent+(sent>1?" lançamentos enviados":" lançamento enviado"):"Internet voltou");play("sync")}
  }catch(e){
    if(L===cur){if(e.config)setNet("config");else if(e.network)setNet("offline");else{setNet("online");toast(e.message)}}
  }finally{
    syncing=false;
    if(L===cur){render();schedule()}
    if(again){again=false;setTimeout(syncNow,30)}
  }
}
function setNet(s){
  if(s===net)return;
  if(s==="offline"&&L&&net!=="offline"&&L.mesa){toast("Sem internet. Pode continuar: os lançamentos sobem quando o sinal voltar.")}
  net=s;render();
}
function schedule(){
  clearTimeout(timer);if(!L)return;
  const ms=net==="online"&&!L.out.length?(live?20000:4000):4000;
  timer=setTimeout(()=>{if(document.visibilityState==="visible")syncNow();else schedule()},ms);
}
window.addEventListener("online",()=>syncNow());
window.addEventListener("offline",()=>{if(L)setNet("offline")});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&L){syncNow();keepAwake()}});

/* ---------- opening and leaving a table ---------- */
function setHash(code){try{history.replaceState(null,"",code?"#"+code:location.pathname+location.search)}catch(e){location.hash=code||""}}
async function openMesa(code){
  code=String(code).toUpperCase();
  if(unsub){unsub();unsub=null}
  clearTimeout(timer);
  L=loadMesa(code)||blank(code);L.tit=L.tit||{};L.trocas=L.trocas||{};titOff=false;trocaOff=false;
  firstSync=!!L.since;forceJoin=false;live=false;net="idle";
  ls.set("pb-ultima",code);setHash(code);
  render();
  if(!API)return;
  if(API.subscribe){
    const cur=L;
    unsub=API.subscribe(code,(kind,row)=>{if(L===cur){if(kind==="tit"){titOff=false;mergeTit([row],firstSync)}else if(kind==="troca"){trocaOff=false;mergeTrocas([row],firstSync)}else mergeRows(kind,[row],firstSync);save();render()}},
      st=>{if(L!==cur)return;const was=live;live=st==="SUBSCRIBED";if(live&&!was)syncNow();schedule()});
  }
  bumpOpen(code);
  if(!L.mesa){
    const cur=L;
    try{
      const m=await API.mesa(code);if(L!==cur)return;
      if(!m){toast("Mesa "+code+" não encontrada. Confira o código.");play("err");leave(true);return}
      cur.mesa={saldo_inicial:m.saldo_inicial,salario:m.salario,banqueiro:m.banqueiro||null};save();
    }catch(e){
      if(L!==cur)return;
      toast(e.network?"Sem internet. Para entrar numa mesa pela primeira vez, precisa de sinal.":e.config?"O banco online não está configurado.":e.message);
      play("err");leave(true);return;
    }
  }
  syncNow();
}
function mesaMissing(){toast("Esta mesa não existe mais no banco.");leave(true)}
function leave(drop){
  if(unsub){unsub();unsub=null}
  clearTimeout(timer);
  if(drop&&L&&!L.mesa){ls.del("pb-mesa-"+L.codigo);if(ls.get("pb-ultima")===L.codigo)ls.del("pb-ultima")}
  L=null;net="idle";live=false;setHash("");closeSheets();render();
}

/* ---------- render ---------- */
function show(v){["vHome","vWait","vJoin","vMain"].forEach(x=>$("#"+x).hidden=x!==v)}
function statusInfo(){
  if(!L)return["dot","Edição Mundo"];
  const n=L.out.length,pend=n?` · ${n} na fila`:"";
  if(net==="config")return["dot bad","Banco não configurado"];
  if(net==="offline")return["dot warn","Sem sinal"+pend];
  if(n)return["dot warn",`Enviando ${n}…`];
  if(net==="online")return["dot on",`Mesa ${L.codigo} · ao vivo`];
  return["dot warn",`Mesa ${L.codigo} · conectando`];
}
function render(){
  drawSnd();
  const[dc,txt]=statusInfo();
  $("#status").innerHTML=`<span class="${dc}"></span><span>${esc(txt)}</span>`;
  $("#cfgBanner").hidden=!!API&&net!=="config";
  $("#offBanner").hidden=!(L&&L.mesa&&net==="offline");
  $("#inviteBtn").hidden=!(L&&L.mesa);
  if(!L){
    show("vHome");
    const last=ls.get("pb-ultima"),saved=last&&loadMesa(last);
    $("#resumeBox").hidden=!(saved&&saved.mesa);
    if(saved)$("#resumeBtn").textContent="Voltar para a mesa "+last;
    drawInstall();
    return;
  }
  if(!L.mesa){show("vWait");$("#waitTitle").textContent="Abrindo a mesa "+L.codigo+"…";return}
  const D=derive();
  const meP=L.me&&D.P[L.me];
  if(!meP||meP.removido||forceJoin){renderJoin(D);show("vJoin");return}
  show("vMain");keepAwake();
  if(!$("#sheet").hidden&&D.P[SH.actor])drawSheet();
  if(!$("#plSheet").hidden&&D.P[SH.actor])drawPlayer();
  if(!$("#cardsSheet").hidden&&!cdDrag)drawCards();
  if(!$("#cardSheet").hidden&&document.activeElement&&document.activeElement.id!=="tpVal")drawCard();
  if(!$("#b3d").hidden&&!b3.ptrs.size)drawBoard3d();
  drawOffer(D);
  drawEnd();
  drawMyCards(D);
  {const mine=Object.values(D.Tit).filter(t=>t.dono===L.me).length;$("#cardsSub").textContent=mine?`Você tem ${mine} ${mine===1?"carta":"cartas"} · propriedades, casas e hipotecas`:"Propriedades, casas e hipotecas"}
  const boss=iAmBanker(),bk=banker();
  const bal=balances(D),c=colorOf(meP.cor),card=$("#card");
  card.style.backgroundColor=c.c;
  card.style.backgroundImage=`linear-gradient(140deg,${c.c} 0%,color-mix(in oklab,${c.c} 62%,#000) 100%)`;
  card.classList.toggle("darktext",!!c.dark);
  setHTML(card,`<svg class="gl"><use href="#globe"/></svg>
    <div class="row"><span class="cw">PORTI BANK</span><span class="tier">${boss?"BANQUEIRO":"MUNDO"}</span></div>
    <div class="chiprow"><span class="chip"></span><svg class="nfc"><use href="#i-nfc"/></svg></div>
    <button class="balbtn" id="peekBtn" aria-label="${peek?"Mostrar saldo":"Tapar saldo"}"><div class="lbl">Saldo disponível<svg class="eye"><use href="#${peek?"i-eyeoff":"i-eye"}"/></svg></div><div class="bal">${peek?MASK:fmt(bal[L.me])}</div></button>
    <div class="row"><span class="holder">${esc(meP.nome)}</span><span class="cardnum">•••• ${last4(L.me)}</span></div>`);

  /* requests */
  const txs=txArr(D);
  const pending=txs.filter(t=>t.status==="pendente").reverse();
  const box=$("#reqBox");
  {
    const bills=pending.filter(t=>t.de===L.me&&t.lancado_por!==L.me);
    const asks=boss?pending.filter(t=>!t.de&&t.lancado_por!==L.me):[];
    const proxyBills=boss?pending.filter(t=>t.de&&t.de!==L.me&&t.para!==L.me&&t.lancado_por!==L.me):[];
    const myWait=pending.filter(t=>!bills.includes(t)&&!asks.includes(t)&&!proxyBills.includes(t)&&(t.lancado_por===L.me||(!t.de&&t.para===L.me)));
    let h="";
    if(bills.length)h+=`<h2>${bills.length>1?bills.length+" cobranças para você":"Cobrança para você"}</h2>`+bills.map(t=>`<div class="rq bill"><div class="who">${avatar(D.P[t.para],"sm")}<span class="n">${esc(nameOf(t.para,D))} está cobrando</span></div><div class="amt">− ${money(t.valor)}</div>
      <div class="meta" style="grid-column:1/-1">${t.motivo?`<span class="rtag"${rStyle(t.motivo)}>${rIcon(t.motivo)}${esc(t.motivo)}</span>`:"Sem motivo"}</div>
      <div class="btns"><button class="btn ghost small" data-deny="${esc(t.id)}">Recusar</button><button class="btn ok small" data-approve="${esc(t.id)}">Pagar ${money(t.valor)}</button></div></div>`).join("");
    if(asks.length)h+=`<h2>${asks.length>1?asks.length+" pedidos para aprovar":"Pedido para aprovar"}</h2>`+asks.map(t=>`<div class="rq"><div class="who">${avatar(D.P[t.para],"sm")}<span class="n">${esc(nameOf(t.para,D))}</span></div><div class="amt">+ ${money(t.valor)}</div>
      <div class="meta" style="grid-column:1/-1">${esc(t.motivo||"Receber do banco")}${t.lancado_por!==t.para?" · pedido por "+esc(nameOf(t.lancado_por,D)):""}</div>
      <div class="btns"><button class="btn ghost small" data-deny="${esc(t.id)}">Recusar</button><button class="btn ok small" data-approve="${esc(t.id)}">Aprovar ${money(t.valor)}</button></div></div>`).join("");
    if(proxyBills.length)h+=`<h2>Cobranças entre jogadores</h2>`+proxyBills.map(t=>`<div class="rq"><div class="who">${avatar(D.P[t.de],"sm")}<span class="n">${esc(nameOf(t.de,D))} → ${esc(nameOf(t.para,D))}</span></div><div class="amt">${money(t.valor)}</div>
      <div class="meta" style="grid-column:1/-1">${esc(t.motivo||"Cobrança")} · esperando ${esc(shortName(nameOf(t.de,D)))} confirmar. Celular dele apagou? Você pode confirmar por ele.</div>
      <div class="btns"><button class="btn ghost small" data-deny="${esc(t.id)}">Recusar</button><button class="btn small" data-approve="${esc(t.id)}">Confirmar por ${esc(shortName(nameOf(t.de,D)))}</button></div></div>`).join("");
    if(myWait.length)h+=`<h2>Aguardando confirmação</h2>`+myWait.map(t=>`<div class="rq"><div class="who"><span class="n">${t.de?`Cobrança para ${esc(nameOf(t.de,D))}`:esc(t.motivo||"Receber do banco")}</span></div><div class="amt">${t.de?"":"+ "}${money(t.valor)}</div>
      <div class="meta" style="grid-column:1/-1">${t.de?`${esc(t.motivo?t.motivo+" · ":"")}${esc(shortName(nameOf(t.de,D)))} precisa confirmar no celular.`:bk?esc(nameOf(bk,D))+" precisa aprovar.":"O banqueiro precisa aprovar."}</div>
      <div class="btns" style="grid-template-columns:1fr"><button class="btn ghost small" data-deny="${esc(t.id)}">${t.de?"Cancelar cobrança":"Cancelar pedido"}</button></div></div>`).join("");
    box.hidden=!h;setHTML($("#reqList"),h);
    box.classList.toggle("hasbill",!!bills.length);
  }

  /* action buttons */
  $("#salaryLbl").textContent=(boss?"+ $ ":"Pedir $ ")+short(L.mesa.salario);
  $("#aSalary").querySelector(".s").textContent=boss?"Passei pela partida":"Passei pela partida · o banqueiro aprova";
  $("#aRecv").querySelector(".s").textContent=boss?"Do banco":"Pedido ao banqueiro";
  $("#rules").textContent="Mesa "+L.codigo+" · Início "+money(L.mesa.saldo_inicial)+" · Partida "+money(L.mesa.salario);
  const sit=boss?null:meP.situacao;
  $("#bars").hidden=!meP.situacao;$("#bars").className="bars"+(meP.situacao==="ferias"?" ferias":"");
  $("#barsLbl").textContent=meP.situacao==="ferias"?"DE FÉRIAS":"NA CADEIA";
  $("#jailBanner").hidden=!meP.situacao;
  if(meP.situacao)setHTML($("#jailBanner"),`<div class="jbtxt"><b>${meP.situacao==="ferias"?"Você está de férias":"Você está na cadeia"} · ${roundsTxt(meP)}</b><span>Quando chegar a sua vez de jogar, toque em <b>Passar a vez</b>. Ao acabar as rodadas você volta sozinho.${sit?" Até lá, só o banqueiro mexe na sua conta.":""}</span></div><button class="btn small jbvez" type="button" data-vez="${esc(L.me)}">Passar a vez</button>`);
  ["#aPay","#aSalary","#aRecv","#aBump"].forEach(x=>{$(x).disabled=!!sit});
  $("#privBtn").setAttribute("aria-checked",String(!!meP.oculto));
  $("#liteBtn").setAttribute("aria-checked",String(liteOn()));$("#liteSub").textContent=liteOn()?(LITE_AUTO?"Ligado sozinho porque este celular é mais simples.":"Ligado: menos animação, mais rápido."):"Desligado. Ligue se o app travar ou ficar lento.";
  $("#privEye").innerHTML=`<use href="#${meP.oculto?"pe-eyeoff":"pe-eye"}"/>`;
  {const ph=avatar(meP,"big").replace('class="avatar big"','class="avatar big" id="photoPrev"');if(ph!==lastPhotoHTML){lastPhotoHTML=ph;$("#photoPrev").outerHTML=ph}}
  $("#photoSub").textContent=meP.foto?"Aparece no ranking da mesa. Toque para trocar.":"Aparece no ranking da mesa. Toque para escolher.";
  $("#privSub").textContent=meP.oculto?"Os outros veem $ ••••• no lugar do seu saldo":"Os outros jogadores veem seu saldo no ranking";
  $("#bankText").innerHTML=boss?"<b>Você é o banqueiro.</b> Você aprova o dinheiro que sai do banco para os jogadores.":bk?`Banqueiro da mesa: <b>${esc(nameOf(bk,D))}</b>. Dinheiro do banco só cai depois que ele aprova.`:"Esta mesa ainda não tem banqueiro.";
  $("#passBankBtn").hidden=!boss||playersArr(D).length<2;
  $("#valBtn").hidden=!boss;
  $("#swipeTip").hidden=!boss;
  {const ok=L.mesa.esconder!==false;
   $("#privBtn").hidden=!ok;
   $("#hideRuleBtn").hidden=!boss;$("#hideRuleBtn").setAttribute("aria-checked",String(ok));
   $("#hideRuleSub").textContent=ok?"Ligado: cada um pode esconder o próprio saldo da mesa.":"Desligado: todos os saldos aparecem para a mesa.";}

  /* ranking */
  const canHide=!L.mesa||L.mesa.esconder!==false;
  const hiddenFor=p=>canHide&&p.oculto&&p.id!==L.me;
  const all=playersArr(D);
  const vis=all.filter(p=>!hiddenFor(p)).sort((a,b)=>bal[b.id]-bal[a.id]);
  const hid=all.filter(hiddenFor);
  const max=Math.max(1,...vis.map(p=>bal[p.id]));
  if(sw&&sw.on){swDirty=true}else setHTML($("#players"),[...vis,...hid].map((p,i)=>{
    const cc=colorOf(p.cor).c,h=hiddenFor(p),w=h?0:Math.max(0,bal[p.id])/max*100;
    const tag=(p.id===L.me?(p.oculto?'<span class="you">você · oculto</span>':'<span class="you">você</span>'):h?'<span class="lock">oculto</span>':"")+(p.id===bk?'<span class="banker">banqueiro</span>':"")+(p.situacao==="preso"?'<span class="ps-status ps-preso" data-porti-status="preso" title="Preso"><img src="status-preso.svg" alt="" aria-hidden="true"><span>Preso${rdN(p)}</span></span>':p.situacao==="ferias"?'<span class="ps-status ps-ferias" data-porti-status="ferias" title="Férias"><img src="status-ferias.svg" alt="" aria-hidden="true"><span>Férias${rdN(p)}</span></span>':"");
    return `<button class="pl${p.situacao==="preso"?" jailed":p.situacao==="ferias"?" vac":""}" data-actor="${esc(p.id)}" aria-label="Lançar por ${esc(p.nome)}"><span class="pos">${h?"—":String(i+1).padStart(2,"0")}</span>
      <span class="nm">${avatar(p)}<span class="nmtxt">${esc(p.nome)}</span>${tag}</span>
      <span class="v ${!h&&bal[p.id]<0?"neg-t":""}">${h?MASK:fmt(bal[p.id])}</span>
      <span class="bar"><i style="width:${w}%;background:${cc}"></i></span></button>`}).join(""));

  /* laps: how many times each player got the GO money */
  {const laps={},lastLap={};
   for(const t of txs){if(t.motivo==="Passou pela partida"&&t.para&&counts(t)){laps[t.para]=(laps[t.para]||0)+1;if(!lastLap[t.para])lastLap[t.para]=t.feito_em}}
   const mx=Math.max(0,...all.map(p=>laps[p.id]||0));
   setHTML($("#laps"),all.map(p=>{
     const n=laps[p.id]||0,ago=lastLap[p.id]?Math.max(0,Math.round((Date.now()-tms(lastLap[p.id]))/60000)):null;
     const behind=n<mx&&p.situacao!=="preso";
     const sit=p.situacao==="preso"?"na cadeia":p.situacao==="ferias"?"de férias":"";
     return `<div class="lap ${behind?"behind":""}">${avatar(p,"sm")}<div class="lapinfo"><b>${esc(p.nome)}</b><span>${n} ${n===1?"volta":"voltas"}${ago!==null?" · última há "+(ago<1?"menos de 1 min":ago+" min"):""}${sit?" · "+sit:""}${behind?" · está atrás":""}</span></div>${boss?`<button class="btn small lapbtn" data-lap="${esc(p.id)}" ${p.situacao==="preso"?"disabled":""}>+ ${short(L.mesa.salario)}</button>`:`<span class="lapn">${n}</span>`}</div>`}).join(""));
   $("#lapsHint").textContent=boss?"Toque em + quando o jogador passar pela partida. Quem está preso não recebe; de férias recebe.":"Quantas vezes cada um recebeu a partida. Quem está atrás pode ter passado sem receber: avise o banqueiro.";}

  /* statement: everything that happened at the table */
  /* filters */
  {
    const KINDS=[["all","Tudo"],["frombank","Banco → pessoas"],["tobank","Pessoas → banco"],["between","Entre jogadores"],["partida","Partida"],["pend","Pedidos"],["est","Estornados"]];
    const okKind=t=>{const k=TXF.kind,st=t.status||"aprovado";
      return k==="all"||(k==="frombank"&&!t.de&&t.para)||(k==="tobank"&&t.de&&!t.para)||(k==="between"&&t.de&&t.para)||(k==="partida"&&t.motivo==="Passou pela partida")||(k==="pend"&&st!=="aprovado")||(k==="est"&&!!t.estornado_em)};
    const okWho=t=>!TXF.who||t.de===TXF.who||t.para===TXF.who;
    if(TXF.who&&!D.P[TXF.who])TXF.who=null;
    const base=txs.filter(t=>okKind(t)&&okWho(t));
    const whys=[...new Set(base.map(t=>t.motivo).filter(Boolean))].sort((x,y)=>x.localeCompare(y,"pt-BR"));
    if(TXF.why&&!whys.includes(TXF.why))TXF.why=null;
    const people=playersArr(D).filter(p=>!p.removido);
    const f=$("#txFilter");
    setHTML(f,`<div class="fchips">${KINDS.map(([k,l])=>`<button data-fk="${k}" aria-pressed="${TXF.kind===k}">${l}</button>`).join("")}</div>
      <div class="fchips who"><button data-fw="" aria-pressed="${!TXF.who}">Todos</button>${people.map(p=>`<button data-fw="${esc(p.id)}" aria-pressed="${TXF.who===p.id}">${avatar(p,"sm")}${esc(p.nome)}</button>`).join("")}</div>
      ${whys.length>1||TXF.why?`<div class="fchips why"><button data-fy="" aria-pressed="${!TXF.why}">Qualquer motivo</button>${whys.map(w=>`<button class="rchip" data-fy="${esc(w)}" aria-pressed="${TXF.why===w}"${rStyle(w)}>${rIcon(w)}${esc(w)}</button>`).join("")}</div>`:""}`);
    const fl=base.filter(t=>!TXF.why||t.motivo===TXF.why);
    const live=fl.filter(t=>!t.estornado_em&&(t.status||"aprovado")==="aprovado");
    let sum="";
    if(TXF.who){const inn=live.filter(t=>t.para===TXF.who).reduce((a,t)=>a+t.valor,0),out=live.filter(t=>t.de===TXF.who).reduce((a,t)=>a+t.valor,0);
      sum=`<b>${fl.length}</b> ${fl.length===1?"lançamento":"lançamentos"} · <span class="inc">entrou ${money(inn)}</span> · <span class="outc">saiu ${money(out)}</span>`}
    else sum=`<b>${fl.length}</b> ${fl.length===1?"lançamento":"lançamentos"} · movimentou ${money(live.reduce((a,t)=>a+t.valor,0))}`;
    const filtering=TXF.kind!=="all"||TXF.who||TXF.why;
    $("#txSum").innerHTML=sum+(filtering?' <button class="link" data-fclear="1">Limpar filtros</button>':"");
    txs.length=0;txs.push(...fl);
  }
  const tl=$("#txList"),more=$("#txMore");
  more.hidden=txs.length<=TX_MIN;
  if(!more.hidden){const rest=txs.length-txShow;more.innerHTML=rest>0?`<button data-txmore="1">Ver mais ${Math.min(rest,20)} lançamentos <span>(${rest} escondidos)</span></button>${rest>20?'<button data-txmore="all">Ver tudo</button>':""}`:`<button data-txmore="less">Mostrar menos</button>`}
  if(!txs.length&&(TXF.kind!=="all"||TXF.who||TXF.why)){setHTML(tl,'<p class="empty">Nada com esses filtros.</p>');return}
  if(!txs.length){setHTML(tl,'<p class="empty">Nenhum lançamento ainda. O primeiro pagamento aparece aqui em todos os celulares.</p>');return}
  setHTML(tl,txs.slice(0,txShow).map(t=>{
    const st=t.status||"aprovado",est=!!t.estornado_em,wait=st==="pendente",rec=st==="recusado";
    const cls=(t.para===L.me?"in":t.de===L.me?"out":"")+(est?" est":"")+(wait?" wait":"")+(rec?" rec":"");
    const time=new Date(tms(t.feito_em)).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    const canUndo=!est&&st==="aprovado"&&(boss||t.de===L.me||t.para===L.me||t.lancado_por===L.me);
    const via=t.lancado_por&&t.lancado_por!==t.de&&t.lancado_por!==t.para?`<span>lançado por ${esc(nameOf(t.lancado_por,D))}</span>`:"";
    const appr=st==="aprovado"&&!t.de&&t.aprovado_por&&t.aprovado_por!==t.lancado_por?`<span>aprovado por ${esc(nameOf(t.aprovado_por,D))}</span>`:"";
    const pend=t.pend?'<span class="pend">aguardando internet</span>':"";
    const stl=wait?`<span class="waitlbl">${t.de?"aguardando "+esc(shortName(nameOf(t.de,D)))+" confirmar":"aguardando o banqueiro"}</span>`:rec?`<span class="reclbl">${t.aprovado_por&&t.aprovado_por===t.lancado_por&&t.aprovado_por!==bk?"Pedido cancelado":"Recusado"}</span>`:"";
    const estl=est?`<span class="estlbl">${t.estPend?"Estornando…":"Estornado por "+esc(nameOf(t.estornado_por,D))}</span>`:"";
    let btns="";
    if(wait&&canDecide(t))btns=`<button class="okbtn" data-approve="${esc(t.id)}">${t.de===L.me?"Pagar":t.de?"Confirmar por "+esc(shortName(nameOf(t.de,D))):"Aprovar"}</button><button class="undo" data-deny="${esc(t.id)}">Recusar</button>`;
    else if(wait&&(t.lancado_por===L.me||t.para===L.me))btns=`<button class="undo" data-deny="${esc(t.id)}">Cancelar pedido</button>`;
    else if(canUndo)btns=`<button class="undo ${armedUndo===t.id?"arm":""}" data-undo="${esc(t.id)}">${armedUndo===t.id?"Confirmar estorno":"Estornar"}</button>`;
    const off=est||rec||wait;
    const sign=off?"":t.para===L.me?"+ ":t.de===L.me?"− ":"";
    return `<div class="t ${cls}"><span class="ar">${t.para===L.me?"↓":t.de===L.me?"↑":"⇄"}</span>
      <div class="who">${esc(nameOf(t.de,D))} → ${esc(nameOf(t.para,D))}</div>
      <div class="amt">${sign}${money(t.valor)}</div>
      <div class="meta"><span class="num">${time}</span>${t.motivo?`<span class="rtag"${rStyle(t.motivo)}>${rIcon(t.motivo)}${esc(t.motivo)}</span>`:""}${via}${appr}${pend}${stl}${estl}${btns}</div></div>`}).join(""));
}
$("#txFilter").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.fk!==undefined)TXF.kind=b.dataset.fk;else if(b.dataset.fw!==undefined)TXF.who=b.dataset.fw||null;else if(b.dataset.fy!==undefined)TXF.why=b.dataset.fy||null;else return;
  txShow=TX_MIN;play("tap");render()});
$("#txSum").addEventListener("click",e=>{if(!e.target.closest("[data-fclear]"))return;TXF={kind:"all",who:null,why:null};txShow=TX_MIN;play("tap");render()});
let joinColor=null;
$("#txMore").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;play("tap");
  const v=b.dataset.txmore;if(v==="less"){txShow=TX_MIN;render();$("#txList").scrollIntoView({block:"start"})}else{txShow=v==="all"?1e9:txShow+20;render()}});
function renderJoin(D){
  const bal=balances(D),all=playersArr(D);
  $("#claimWrap").hidden=!all.length;
  $("#claimList").innerHTML=all.map(p=>`<button data-claim="${esc(p.id)}">${avatar(p)}${esc(p.nome)}<span class="v">${p.oculto&&L.mesa.esconder!==false?MASK:fmt(bal[p.id])}</span></button>`).join("");
  const used=new Set(all.map(p=>p.cor));
  if(!joinColor||used.has(joinColor))joinColor=(COLORS.find(c=>!used.has(c.k))||COLORS[0]).k;
  $("#jColors").innerHTML=COLORS.map(c=>`<button type="button" class="sw" style="background:${c.c}" aria-label="${c.k}" aria-pressed="${c.k===joinColor}" data-color="${c.k}" ${used.has(c.k)?"disabled":""}></button>`).join("");
}
function last4(id){let h=7;for(const c of String(id))h=(h*31+c.charCodeAt(0))>>>0;return String(h%10000).padStart(4,"0")}

/* ---------- avatar ---------- */
function avatar(p,size){
  p=p||{};const c=colorOf(p.cor).c;
  const img=p.foto&&/^data:image\/(jpeg|webp|png);base64,/.test(p.foto)?`background-image:url('${p.foto}');`:"";
  return `<span class="avatar ${size||""}" style="--pc:${c};${img}">${img?"":esc((p.nome||"?").trim().charAt(0))}</span>`;
}
/* shrink any photo to a small square (~6 KB) before it goes to the table */
function shrinkPhoto(file){
  return new Promise((ok,fail)=>{
    const url=URL.createObjectURL(file),im=new Image();
    im.onload=()=>{
      try{
        const S=144,c=document.createElement("canvas");c.width=S;c.height=S;
        const x=c.getContext("2d"),m=Math.min(im.naturalWidth,im.naturalHeight);
        x.drawImage(im,(im.naturalWidth-m)/2,(im.naturalHeight-m)/2,m,m,0,0,S,S);
        let q=.72,d=c.toDataURL("image/jpeg",q);
        while(d.length>14000&&q>.3){q-=.1;d=c.toDataURL("image/jpeg",q)}
        URL.revokeObjectURL(url);ok(d);
      }catch(e){URL.revokeObjectURL(url);fail(e)}
    };
    im.onerror=()=>{URL.revokeObjectURL(url);fail(new Error("Não deu para abrir essa foto."))};
    im.src=url;
  });
}

/* ---------- toast ---------- */
let toastT;
function toast(text,action){
  const el=$("#toast");$("#toastText").textContent=text;
  const b=$("#toastBtn");b.hidden=!action;
  if(action){b.textContent=action.label;b.onclick=()=>{el.hidden=true;action.run()}}
  el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,action?6000:3200);
}
function flashCard(){const c=$("#card");if(!c)return;c.classList.remove("flash");void c.offsetWidth;c.classList.add("flash")}

/* ---------- "O banco comeu" ---------- */
let eatT;
function bancoComeu(nome,valor){
  const el=$("#eat");
  $("#eatText").textContent=nome+" pagou "+money(valor)+" ao banco";
  const bills=el.querySelector(".bills");
  bills.innerHTML=Array.from({length:16},(_,i)=>`<i class="${i%3?"":"c"}" style="left:${Math.round(Math.random()*92)}%;animation-delay:${(Math.random()*.9).toFixed(2)}s;--r:${Math.round(Math.random()*500-250)}deg"></i>`).join("");
  el.hidden=true;void el.offsetWidth;el.hidden=false;
  el.querySelectorAll("*").forEach(n=>{n.style.animation="none";void n.offsetWidth;n.style.animation=""});
  clearTimeout(eatT);eatT=setTimeout(()=>el.hidden=true,2600);
  play("chomp");
}
$("#eat").addEventListener("click",()=>{$("#eat").hidden=true;clearTimeout(eatT)});
/* cell gate dropping over the player, on every phone */
let cellT,cellSeen={};
/* vacation: a little car pulls up with the player, revs and zooms off (or comes back) */
let tripT;
function tripShow(id,leaving){
  const now=Date.now(),k=id+(leaving?"v":"b");if(cellSeen[k]&&now-cellSeen[k]<5000)return;cellSeen[k]=now;
  const p=derive().P[id];if(!p)return;
  const el=$("#trip");
  $("#tripWho").innerHTML=avatar(p,"big");
  $("#tripTxt").innerHTML=leaving?`<b>${esc(p.nome)}</b> saiu de férias!`:`<b>${esc(p.nome)}</b> voltou das férias!`;
  $("#tripSignTop").textContent=leaving?"DESTINO":"ATÉ A PRÓXIMA";
  el.className="trip "+(leaving?"leaving":"back");
  el.hidden=true;void el.offsetWidth;el.hidden=false;
  el.querySelectorAll("*").forEach(n=>{n.style.animation="none";void n.offsetWidth;n.style.animation=""});
  play(leaving?"vacay5":"back5");
  clearTimeout(tripT);tripT=setTimeout(()=>{el.hidden=true;stopSfx()},leaving?3300:2700);
}
function tripLater(id,leaving){setTimeout(()=>tripShow(id,leaving),30)}
function cellLater(id,closing){setTimeout(()=>cellShow(id,closing),30)}
function cellShow(id,closing){
  const now=Date.now(),k=id+(closing?"p":"s");if(cellSeen[k]&&now-cellSeen[k]<5000)return;cellSeen[k]=now;
  const p=derive().P[id];if(!p)return;
  const el=$("#cell");
  $("#cellWho").innerHTML=avatar(p,"big");
  $("#cellTxt").innerHTML=closing?`<b>${esc(p.nome)}</b> foi preso!`:`<b>${esc(p.nome)}</b> está livre!`;
  el.className="cell "+(closing?"closing":"opening");
  el.hidden=true;void el.offsetWidth;el.hidden=false;
  el.querySelectorAll("*").forEach(n=>{n.style.animation="none";void n.offsetWidth;n.style.animation=""});
  if(closing){play("slam");setTimeout(()=>{if(navigator.vibrate)try{navigator.vibrate([60,40,30])}catch(e){}},440)}else play("unlock");
  clearTimeout(cellT);cellT=setTimeout(()=>el.hidden=true,closing?2900:2400);
}
$("#cell").addEventListener("click",()=>{$("#cell").hidden=true;clearTimeout(cellT)});
$("#trip").addEventListener("click",()=>{$("#trip").hidden=true;clearTimeout(tripT);stopSfx()});
const paysBank=r=>!!r.de&&!r.para&&r.motivo!=="Ajuste de saldo";

/* ---------- actions ---------- */
function lancar(de,para,valor,motivo){
  const id=uuid();
  const status=needsApproval(de,para,L.me)?"pendente":"aprovado";
  enqueue({t:"lancar",id,de:de||null,para:para||null,valor,motivo:motivo||null,por:L.me,em:nowIso(),status});
  return{id,status};
}
function estornar(id){
  const D=derive(),t=D.T[id];if(!t||t.estornado_em||t.status==="recusado")return;
  enqueue({t:"estornar",id,por:L.me,em:nowIso()});
  play("undo");
  toast(t.status==="pendente"?"Pedido cancelado":"Estornado: "+nameOf(t.de,D)+" → "+nameOf(t.para,D)+" "+money(t.valor));
}
function decide(id,ok){
  const D=derive(),t=D.T[id];if(!t||t.status!=="pendente")return;
  if(ok){
    if(!canDecide(t)){toast(t.de?"Quem paga precisa confirmar no celular dele.":"Só o banqueiro pode aprovar.");play("err");return}
    enqueue({t:"aprovar",id,por:L.me,em:nowIso()});
    if(t.de){const bal=balances(derive())[t.de];play(bal<0?"broke":"pay");toast((t.de===L.me?"Pago: ":nameOf(t.de,D)+" pagou ")+money(t.valor)+" para "+nameOf(t.para,D));if(t.de===L.me)flashCard()}
    else{play(t.motivo==="Passou pela partida"?"go":"recv");toast("Aprovado: + "+money(t.valor)+" para "+nameOf(t.para,D))}
  }else{
    enqueue({t:"recusar",id,por:L.me,em:nowIso()});play("undo");
    toast(t.de?(t.lancado_por===L.me?"Cobrança cancelada":"Cobrança recusada"):iAmBanker()&&t.lancado_por!==L.me?"Pedido de "+nameOf(t.para,D)+" recusado":"Pedido cancelado");
  }
}
let armedUndo=null,armT;
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.claim){L.me=b.dataset.claim;forceJoin=false;save();play("tap");render()}
  else if(b.dataset.color){joinColor=b.dataset.color;play("tap");renderJoin(derive())}
  else if(b.dataset.approve){decide(b.dataset.approve,true)}
  else if(b.dataset.vez){doVez(b.dataset.vez);if(!$("#plSheet").hidden)drawPlayer()}
  else if(b.dataset.deny){decide(b.dataset.deny,false)}
  else if(b.dataset.undo){
    const id=b.dataset.undo;
    if(armedUndo!==id){armedUndo=id;clearTimeout(armT);armT=setTimeout(()=>{armedUndo=null;render()},4000);play("tap");render();return}
    armedUndo=null;estornar(id);
  }
  else if(b.dataset.lap){
    if(!iAmBanker())return;const id=b.dataset.lap,p=derive().P[id];if(!p||p.situacao==="preso"){if(p)toast(p.nome+" está preso e não recebe.");return}
    b.disabled=true;setTimeout(()=>{b.disabled=false},1500);
    const r=lancar(null,id,L.mesa.salario,"Passou pela partida");play("go");
    toast(p.nome+" passou pela partida: + "+money(L.mesa.salario),{label:"Desfazer",run:()=>estornar(r.id)});
  }
  else if(b.dataset.actor){play("tap");openPlayer(b.dataset.actor)}
  else if(b.dataset.bank){
    const to=b.dataset.bank;closeSheets();
    enqueue({t:"banco",para:to,por:L.me,em:nowIso()});play("go");
    toast(nameOf(to)+" agora é o banqueiro.");
  }
  else if(b.id==="peekBtn"){peek=!peek;ls.set("pb-mask",peek?"1":"0");play("tap");render()}
});
["#sStart","#sSalary"].forEach(s=>$(s).addEventListener("input",e=>fmtInput(e.target)));
$("#codeIn").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"")});
$("#joinCodeForm").onsubmit=e=>{
  e.preventDefault();
  const c=$("#codeIn").value.trim().toUpperCase();
  if(c.length!==4){play("err");toast("O código tem 4 letras ou números.");return}
  if(!API){toast("O banco online não está configurado.");return}
  play("tap");$("#codeIn").value="";openMesa(c);
};
$("#setupForm").onsubmit=async e=>{
  e.preventDefault();
  if(!API){toast("O banco online não está configurado.");return}
  const start=parseAmt($("#sStart").value),salary=parseAmt($("#sSalary").value);
  if(!start){play("err");toast("Coloque um saldo inicial.");return}
  const b=$("#createBtn");b.disabled=true;b.textContent="Abrindo…";
  try{const code=await API.rpc("pb_criar_mesa",{p_saldo_inicial:start,p_salario:salary});play("go");await openMesa(code)}
  catch(err){play("err");toast(err.network?"Sem internet. Para criar a mesa precisa de sinal.":err.config?"O banco online não está configurado.":err.message)}
  finally{b.disabled=false;b.textContent="Abrir o banco"}
};
/* ---------- entrar na mesa escaneando o QR code (como no WhatsApp Web) ----------
   Camera inside the app, so nobody has to open the phone camera and a browser.
   The QR from "Convidar" carries the table link; only its 4-letter code is used. */
let scanStream=null,scanRAF=0,scanT=0,scanCv=null;
function loadJsQR(){
  if(window.jsQR)return Promise.resolve();
  return new Promise((ok,bad)=>{const sc=document.createElement("script");sc.src="vendor/jsqr.js";sc.onload=()=>window.jsQR?ok():bad();sc.onerror=bad;document.head.appendChild(sc)});
}
function codeFromQR(txt){
  txt=String(txt||"").trim();
  let m=txt.match(/#([A-Za-z0-9]{4})\b/);if(m)return m[1].toUpperCase();
  m=txt.match(/^[A-Za-z0-9]{4}$/);if(m)return txt.toUpperCase();
  return null;
}
async function openScan(){
  if(!API){toast("O banco online não está configurado.");return}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){toast("Este celular não deixa o app usar a câmera. Digite o código da mesa.");play("err");return}
  play("tap");
  const box=$("#scan"),v=$("#scanVideo");box.classList.remove("hit");$("#scanMsg").textContent="Abrindo a câmera…";box.hidden=false;
  try{
    const [stream]=await Promise.all([navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false}),loadJsQR()]);
    if(box.hidden){stream.getTracks().forEach(t=>t.stop());return}
    scanStream=stream;v.srcObject=stream;try{await v.play()}catch(e){}
    $("#scanMsg").textContent="Aponte para o QR code da mesa";
    scanCv=scanCv||document.createElement("canvas");
    const tick=()=>{
      if(!scanStream)return;
      scanRAF=requestAnimationFrame(tick);
      const now=performance.now();if(now-scanT<120||v.readyState<2||!v.videoWidth)return;scanT=now;
      const k=Math.min(1,640/Math.max(v.videoWidth,v.videoHeight)),w=Math.round(v.videoWidth*k),h=Math.round(v.videoHeight*k);
      scanCv.width=w;scanCv.height=h;const cx=scanCv.getContext("2d",{willReadFrequently:true});cx.drawImage(v,0,0,w,h);
      let r=null;try{r=window.jsQR(cx.getImageData(0,0,w,h).data,w,h,{inversionAttempts:"dontInvert"})}catch(e){}
      if(!r||!r.data)return;
      const code=codeFromQR(r.data);
      if(!code){$("#scanMsg").textContent="Esse QR code não é de uma mesa do PORTI BANK";return}
      box.classList.add("hit");$("#scanMsg").textContent="Mesa "+code+"! Entrando…";play("go");
      try{navigator.vibrate&&navigator.vibrate(40)}catch(e){}
      stopScan(true);
      if(L&&L.codigo===code){setTimeout(()=>{$("#scan").hidden=true;toast("Você já está nessa mesa.")},350);return}
      setTimeout(()=>{$("#scan").hidden=true;openMesa(code)},350);
    };
    tick();
  }catch(e){
    stopScan();
    const denied=e&&(e.name==="NotAllowedError"||e.name==="SecurityError");
    toast(denied?"O app precisa da câmera para ler o QR code. Permita a câmera e tente de novo, ou digite o código.":"Não deu para abrir a câmera. Digite o código da mesa.");play("err");
  }
}
function stopScan(keep){
  cancelAnimationFrame(scanRAF);
  if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null}
  try{$("#scanVideo").srcObject=null}catch(e){}
  if(!keep)$("#scan").hidden=true;
}
$("#scanBtn").onclick=openScan;
$("#scanBtn2").onclick=openScan;
$("#scanClose").onclick=()=>{stopScan();play("tap")};
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&scanStream)stopScan()});
$("#resumeBtn").onclick=()=>{const last=ls.get("pb-ultima");if(last)openMesa(last)};
$("#waitBack").onclick=()=>leave(true);
$("#joinBack").onclick=()=>leave(false);
$("#joinForm").onsubmit=e=>{
  e.preventDefault();
  const name=$("#jName").value.trim();
  if(!name){play("err");toast("Escreva seu nome.");$("#jName").focus();return}
  const id=uuid(),first=!banker();
  L.me=id;forceJoin=false;
  enqueue({t:"entrar",id,nome:name,cor:joinColor,em:nowIso()});
  $("#jName").value="";play("go");
  toast(first?"Cartão emitido. Você é o banqueiro desta mesa.":"Cartão emitido: "+money(L.mesa.saldo_inicial));
};
$("#refreshBtn").onclick=async e=>{
  const b=e.currentTarget;b.textContent="Atualizando…";b.disabled=true;
  if(L)save();
  try{const r=await navigator.serviceWorker.getRegistration();if(r)await r.update()}catch(err){}
  try{for(const k of await caches.keys())await caches.delete(k)}catch(err){}
  location.reload();
};
$("#switchBtn").onclick=()=>{forceJoin=true;play("tap");render()};
let leaveT;$("#leaveBtn").onclick=e=>{
  const b=e.currentTarget;
  if(b.dataset.arm){clearTimeout(leaveT);delete b.dataset.arm;b.textContent="Sair da mesa";leave(false);return}
  b.dataset.arm="1";
  b.textContent=L&&L.out.length?`${L.out.length} lançamento(s) ainda não enviado(s). Toque de novo para sair`:"Toque de novo para sair";
  leaveT=setTimeout(()=>{delete b.dataset.arm;b.textContent="Sair da mesa"},4000);
};
$("#photoBtn").onclick=()=>{play("tap");$("#photoIn").value="";$("#photoIn").click()};
$("#photoIn").addEventListener("change",async e=>{
  const f=e.target.files&&e.target.files[0];if(!f||!L||!L.me)return;
  try{const d=await shrinkPhoto(f);enqueue({t:"foto",id:L.me,foto:d,em:nowIso()});play("recv");toast("Foto atualizada")}
  catch(err){play("err");toast(err.message||"Não deu para usar essa foto.")}
});
$("#liteBtn").onclick=()=>{
  const v=!liteOn();try{localStorage.setItem("pb-lite",v?"1":"0")}catch(e){}
  document.documentElement.classList.toggle("lite",v);play("tap");render();
  toast(v?"Modo leve ligado: menos animação, mais rápido.":"Modo leve desligado.");
};
$("#privBtn").onclick=()=>{
  const D=derive(),meP=D.P[L.me];if(!meP)return;const v=!meP.oculto;
  enqueue({t:"ocultar",id:L.me,oculto:v,em:nowIso()});play("tap");
  toast(v?"Seu saldo está oculto para a mesa":"Seu saldo voltou a aparecer");
};
$("#aPay").onclick=()=>{play("tap");openSheet("pay")};
$("#aRecv").onclick=()=>{play("tap");openSheet("recv")};
$("#aSalary").onclick=e=>{
  if(!iAmBanker()&&(derive().P[L.me]||{}).situacao){play("err");return}
  const b=e.currentTarget;b.disabled=true;setTimeout(()=>b.disabled=false,1500);
  const D=derive();
  if(!iAmBanker()&&txArr(D).some(t=>t.status==="pendente"&&t.para===L.me&&t.motivo==="Passou pela partida")){
    toast("Você já tem um pedido da partida esperando o banqueiro.");play("err");return;
  }
  const r=lancar(null,L.me,L.mesa.salario,"Passou pela partida");
  if(r.status==="pendente"){play("ask");toast("Pedido enviado ao banqueiro: + "+money(L.mesa.salario),{label:"Cancelar",run:()=>estornar(r.id)})}
  else{play("go");flashCard();toast("+ "+money(L.mesa.salario)+" na conta",{label:"Desfazer",run:()=>estornar(r.id)})}
};
$("#passBankBtn").onclick=()=>{
  const D=derive();
  $("#bankList").innerHTML=playersArr(D).filter(p=>p.id!==L.me).map(p=>`<button data-bank="${esc(p.id)}">${avatar(p)}${esc(p.nome)}</button>`).join("");
  $("#scrim").hidden=false;$("#bankSheet").hidden=false;play("tap");
};
$("#bankClose").onclick=closeSheets;
$("#shJail").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||!iAmBanker())return;
  const a=SH.actor,v=b.dataset.sit||null,nm=nameOf(a),was=(derive().P[a]||{}).situacao||null;closeSheets();
  enqueue({t:"situacao",id:a,situacao:v,por:L.me,em:nowIso()});
  if(v==="preso")cellLater(a,true);else if(v==="ferias")tripLater(a,true);else if(was==="preso")cellLater(a,false);else if(was==="ferias")tripLater(a,false);else{play("unlock");toast(nm+" voltou para o jogo!")}
});
let rmT;
$("#shRemove").onclick=e=>{
  const b=e.currentTarget,a=SH.actor;
  if(!iAmBanker()||a===L.me)return;
  if(!b.dataset.arm){b.dataset.arm="1";b.textContent="Toque de novo para remover "+nameOf(a);clearTimeout(rmT);rmT=setTimeout(()=>{delete b.dataset.arm;drawPlayer()},4000);play("tap");return}
  delete b.dataset.arm;clearTimeout(rmT);
  const nm=nameOf(a);closeSheets();
  enqueue({t:"remover",id:a,por:L.me,em:nowIso()});play("undo");toast(nm+" saiu da mesa.");
};
$("#valBtn").onclick=()=>{
  $("#vStart").value=L.mesa.saldo_inicial.toLocaleString("pt-BR");$("#vSalary").value=L.mesa.salario.toLocaleString("pt-BR");
  VR={cadeia:L.mesa.rcadeia||2,ferias:L.mesa.rferias||1};drawVR();
  $("#scrim").hidden=false;$("#valSheet").hidden=false;play("tap");
};
["#vStart","#vSalary"].forEach(x=>$(x).addEventListener("input",e=>fmtInput(e.target)));
var VR={cadeia:2,ferias:1};
function drawVR(){$("#vRounds").innerHTML=[["cadeia","Na cadeia","status-preso.svg"],["ferias","De férias","status-ferias.svg"]].map(([k,l,ic])=>`<div class="vr"><img src="${ic}" alt=""><span><b>${l}</b><small>fica ${VR[k]} ${VR[k]===1?"rodada":"rodadas"} sem jogar · volta na ${VR[k]+1}ª</small></span><div class="stp"><button type="button" data-vr="${k}" data-d="-1" aria-label="Menos">−</button><b>${VR[k]}</b><button type="button" data-vr="${k}" data-d="1" aria-label="Mais">+</button></div></div>`).join("")}
$("#vRounds").addEventListener("click",e=>{const b=e.target.closest("[data-vr]");if(!b)return;const k=b.dataset.vr;VR[k]=Math.max(1,Math.min(9,VR[k]+(+b.dataset.d)));play("tap");drawVR()});
$("#valClose").onclick=closeSheets;
$("#hideRuleBtn").onclick=()=>{
  if(!iAmBanker())return;
  const v=L.mesa.esconder===false;
  enqueue({t:"esconder",permitido:v,por:L.me,em:nowIso()});L.mesa.esconder=v;render();play("tap");
  toast(v?"Agora cada jogador pode esconder o saldo.":"Esconder saldo desligado: todos os saldos aparecem.");
};
$("#valSave").onclick=()=>{
  const saldo=parseAmt($("#vStart").value),salario=parseAmt($("#vSalary").value);
  if(!saldo){toast("Coloque o saldo inicial.");play("err");return}
  closeSheets();
  enqueue({t:"valores",saldo,salario,por:L.me,em:nowIso()});
  if(VR.cadeia!==(L.mesa.rcadeia||2)||VR.ferias!==(L.mesa.rferias||1)){enqueue({t:"rodadas",cadeia:VR.cadeia,ferias:VR.ferias,por:L.me,em:nowIso()});L.mesa.rcadeia=VR.cadeia;L.mesa.rferias=VR.ferias}
  L.mesa.saldo_inicial=saldo;L.mesa.salario=salario;render();
  play("go");toast("Valores da mesa atualizados: início "+money(saldo)+", partida "+money(salario));
};

/* ---------- swipe in the ranking (banker): right = vacation, left = jail ---------- */
function setSituacao(id,v){
  const nm=nameOf(id),was=(derive().P[id]||{}).situacao||null;
  enqueue({t:"situacao",id,situacao:v,por:L.me,em:nowIso()});
  if(v==="preso")cellLater(id,true);else if(v==="ferias")tripLater(id,true);else if(was==="preso")cellLater(id,false);else if(was==="ferias")tripLater(id,false);else{play("unlock");toast(nm+" voltou para o jogo!")}
}
$("#players").addEventListener("pointerdown",e=>{
  const row=e.target.closest(".pl");if(!row||!L||!iAmBanker())return;
  sw={row,id:row.dataset.actor,x:e.clientX,y:e.clientY,dx:0,on:false};
});
$("#players").addEventListener("pointermove",e=>{
  if(!sw)return;const dx=e.clientX-sw.x,dy=e.clientY-sw.y;
  if(!sw.on){if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){sw=null;return}if(Math.abs(dx)<12)return;sw.on=true;try{sw.row.setPointerCapture(e.pointerId)}catch(err){}}
  sw.dx=Math.max(-140,Math.min(140,dx));
  sw.row.style.transform=`translateX(${sw.dx}px)`;sw.row.style.transition="none";
  const kind=sw.dx>0?"ferias":"preso",p=derive().P[sw.id]||{},undo=p.situacao===kind;
  if(!sw.bg){sw.bg=document.createElement("div");$("#players").appendChild(sw.bg)}
  sw.bg.style.top=sw.row.offsetTop+"px";sw.bg.style.height=sw.row.offsetHeight+"px";
  sw.bg.className="swbg "+kind+(Math.abs(sw.dx)>80?" go":"");
  const ic=(id,vb)=>`<svg class="sticon" viewBox="${vb}"><use href="#${id}"/></svg>`;
  const lbl=kind+(undo?"u":"");
  if(sw.lbl!==lbl){sw.lbl=lbl;sw.bg.innerHTML="<b>"+(kind==="ferias"?'<img class="sticon" src="status-ferias.svg" alt="">'+(undo?"Tirar das férias":"Férias"):(undo?ic("pb-unlock","0 0 64 72"):'<img class="sticon" src="status-preso.svg" alt="">')+(undo?"Soltar":"Prender"))+"</b>";}
  sw.row.classList.toggle("armed",Math.abs(sw.dx)>80);
});
function endSwipe(){
  if(!sw)return;const {row,id,dx,on,bg}=sw;sw=null;
  row.style.transition="";row.style.transform="";row.classList.remove("armed");if(bg)setTimeout(()=>bg.remove(),260);
  if(swDirty){swDirty=false;setTimeout(render,0)}
  if(!on)return;swiped=true;setTimeout(()=>swiped=false,350);
  if(Math.abs(dx)<80)return;
  const p=derive().P[id];if(!p)return;
  if(dx>0)setSituacao(id,p.situacao==="ferias"?null:"ferias");
  else setSituacao(id,p.situacao==="preso"?null:"preso");
}
$("#players").addEventListener("pointerup",endSwipe);
$("#players").addEventListener("pointercancel",endSwipe);
$("#players").addEventListener("click",e=>{if(swiped){e.stopPropagation();e.preventDefault()}},true);

/* ---------- invite ---------- */
const shareLink=()=>location.origin+location.pathname+"#"+L.codigo;
$("#inviteBtn").onclick=()=>{
  play("tap");
  const link=shareLink();
  $("#invCode").textContent=L.codigo;$("#invLink").textContent=link;
  try{const q=qrcode(0,"M");q.addData(link);q.make();$("#qr").innerHTML=q.createSvgTag({cellSize:6,margin:0,scalable:true});$("#qr").hidden=false}
  catch(e){$("#qr").hidden=true}
  $("#scrim").hidden=false;$("#invSheet").hidden=false;
};
$("#invClose").onclick=closeSheets;
$("#copyBtn").onclick=async()=>{
  try{await navigator.clipboard.writeText(shareLink());toast("Link copiado")}
  catch(e){const r=document.createRange();r.selectNodeContents($("#invLink"));const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Link selecionado: copie com o dedo")}
};

/* ---------- payment sheet ---------- */
let SH={kind:"pay",actor:null,to:null,note:""};
/* each reason has its own color and symbol, the same everywhere (sheet, statement, filters) */
const RMETA={
  "Aluguel":{c:"#FF8A5B",d:"M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5"},
  "Compra":{c:"#5AA9FF",d:"M6 8h12l-1 12H7L6 8Zm3 0V6.5a3 3 0 0 1 6 0V8"},
  "Imposto":{c:"#B48CFF",d:"M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3.5 11.5 5-5M10 9.5h.01M14 14.5h.01"},
  "Construção":{c:"#FFB13B",d:"M3 20h18M5 20V12h6v8M11 20V8h8v12M14 11h2M14 14h2M7.5 15h1"},
  "Sorte/Revés":{c:"#4FD69C",d:"M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.8 6.2a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5M12 16.5h.01"},
  "Venda ao banco":{c:"#46D3D9",d:"M3 10 12 4l9 6M5 10v8M19 10v8M3 20h18M12 9v8m-3-3 3 3 3-3"},
  "Hipoteca":{c:"#E8A87C",d:"M7 3h7l4 4v14H7V3Zm7 0v4h4M10 17h5M10 13.5h5"},
  "Prêmio":{c:"#FF9EC4",d:"M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4M12 13v4m-4 3h8l-1-3H9l-1 3"},
  "Passou pela partida":{c:"#FFE79B",d:"M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"},
  "Ajuste de saldo":{c:"#D9D3C7",d:"M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M8 16v4"}
};
function rKey(r){r=String(r||"");const k=r.split(":")[0].trim();return k==="Condomínio"?"Construção":k==="Fim da hipoteca"?"Hipoteca":k}
function rIcon(r){r=rKey(r);if(r==="Passou pela partida")return `<span class="rbadge" style="--rc:#FFD12B"><svg class="ric go" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-orbit"/></svg></span>`;const m=RMETA[r];return m?`<span class="rbadge"><svg class="ric" viewBox="0 0 24 24" aria-hidden="true"><path d="${m.d}"/></svg></span>`:""}
function rStyle(r){const m=RMETA[rKey(r)];return m?` style="--rc:${m.c}"`:""}
const REASONS={pay:["Aluguel","Compra","Imposto","Construção","Sorte/Revés"],recv:["Sorte/Revés","Venda ao banco","Hipoteca","Prêmio"],salary:[],set:[]};
/* these only happen with the bank, never between players */
const BANK_ONLY=["Imposto","Construção","Sorte/Revés"];
function reasonsNow(){
  const r=REASONS[SH.kind]||[];
  return SH.kind==="pay"&&(SH.nfc||SH.to!=="bank")?r.filter(x=>!BANK_ONLY.includes(x)):r;
}
function quickValues(){
  const s=L.mesa.saldo_inicial,p=L.mesa.salario;
  if(s>=1e6||p>=1e5)return[1000,10000,45000,100000,250000,300000];
  if(s>=10000)return[100,500,1000,5000];
  return[10,50,100,500];
}
function chipsHTML(){ /* big shortcuts: one row */
  const v=quickValues();return v.slice(1,5).map(x=>`<button type="button" data-add="${x}">+${short(x)}</button>`).join("");
}
function moreHTML(sign){const v=quickValues();return v.map(x=>`<button type="button" data-add="${sign<0?"-":""}${x}">${sign<0?"−":"+"}${short(x)}</button>`).join("")}
function setAmount(n){$("#shAmount").value=n?"$ "+n.toLocaleString("pt-BR"):""}
function openSheet(kind,actor,nfc){
  if(L.me&&!iAmBanker()){const me=derive().P[L.me];if(me&&me.situacao){toast(me.situacao==="ferias"?"Você está de férias: só o banqueiro mexe na sua conta.":"Você está na cadeia: só o banqueiro mexe na sua conta.");play("err");return}}
  if(kind==="salary"){closeSheets();doSalary(actor||L.me);return}
  if(kind==="set"&&!iAmBanker())kind="pay";
  closeSheets();
  SH={kind,actor:actor||L.me,to:kind==="pay"&&!nfc?"bank":null,note:"",nfc:!!(nfc&&kind==="pay")};
  setAmount(0);closeCalc();shMore=false;shWhy=false;
  const step=quickValues()[0];
  $("#shMinus").dataset.add=-step;$("#shMinus").textContent="−"+short(step);
  $("#shPlus").dataset.add=step;$("#shPlus").textContent="+"+short(step);
  $("#shMorePlus").innerHTML=moreHTML(1);$("#shMoreMinus").innerHTML=moreHTML(-1);
  $("#shQuick").innerHTML=chipsHTML();
  $("#scrim").hidden=false;$("#sheet").hidden=false;$("#shBody").scrollTop=0;
  drawSheet();kbFit();
}
let shMore=false,shWhy=false;
function sheetOn(){document.body.classList.toggle("sheeton",!!document.querySelector(".sheet:not([hidden])"))}
new MutationObserver(sheetOn).observe(document.body,{subtree:true,attributes:true,attributeFilter:["hidden"]});
function closeSheets(){$("#scrim").hidden=true;["#sheet","#plSheet","#cardsSheet","#cardSheet","#invSheet","#bankSheet","#valSheet","#scoreSheet","#diceSheet"].forEach(s=>$(s).hidden=true);try{document.activeElement&&document.activeElement.blur()}catch(e){}}
function shortName(n){n=String(n||"").trim();const f=n.split(/\s+/)[0];return f.length>9?f.slice(0,8)+"…":f}
function drawSheet(){
  const D=derive(),a=SH.actor,proxy=a!==L.me,p=D.P[a]||{},bal=balances(D)[a]||0,boss=iAmBanker();
  const hiddenBal=p.oculto&&proxy&&L.mesa.esconder!==false;
  $("#shAv").innerHTML=avatar(p);
  $("#shName").textContent=SH.nfc?"Pagar por NFC":SH.kind==="set"?"Ajustar saldo · "+p.nome:proxy?"Lançando por "+p.nome:"Seu cartão";
  $("#shBal").textContent="Saldo "+(hiddenBal?MASK:fmt(bal));
  $("#shTabs").hidden=SH.kind==="set"||SH.nfc;
  document.querySelectorAll("#shTabs button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.kind===SH.kind)));
  $("#shToWrap").hidden=SH.kind!=="pay"||SH.nfc;
  $("#calcToggle").hidden=SH.kind!=="pay";if(SH.kind!=="pay")closeCalc();
  const RS=reasonsNow();
  if(SH.note&&REASONS[SH.kind]&&REASONS[SH.kind].includes(SH.note)&&!RS.includes(SH.note))SH.note="";
  $("#shReasonBtn").hidden=true;
  $("#shAmtLbl").textContent=SH.kind==="set"?"Saldo correto agora":SH.kind==="recv"?"Quanto vem do banco":"Valor";
  $("#shMore").hidden=!shMore;$("#shMoreBtn").setAttribute("aria-expanded",String(shMore));
  $("#shReasonWrap").hidden=!RS.length;
  $("#shReasonBtn").setAttribute("aria-expanded",String(!$("#shReasonWrap").hidden));
  $("#shReasonBtn").innerHTML=SH.note?`<span class="rtag"${rStyle(SH.note)}>${rIcon(SH.note)}${esc(SH.note)}</span>`:"Adicionar motivo";
  $("#shHint").hidden=SH.kind!=="set"&&!(SH.kind==="recv"&&!boss);
  const q=$("#shQuick");
  if(SH.kind==="set"){
    const avg=tableAverage(D,a);
    $("#shHint").textContent="Para corrigir o saldo, ou equilibrar quem entrou no meio do jogo. O banco lança a diferença no extrato.";
    q.classList.add("setq");
    q.innerHTML=[[L.mesa.saldo_inicial,"Início "+short(L.mesa.saldo_inicial)],[avg,"Média da mesa "+short(avg)]].map(([v,l])=>`<button type="button" data-setval="${v}">${l}</button>`).join("");
    if($("#shAmount").value==="")setAmount(bal);
  }else{
    $("#shHint").textContent="Dinheiro do banco só cai depois que o banqueiro aprovar.";
    if(q.classList.contains("setq")){q.classList.remove("setq");q.innerHTML=chipsHTML()}
  }
  const others=playersArr(D).filter(x=>x.id!==a);
  const bankAv='<span class="bankav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg></span>';
  const rc=$("#shTo"),sl=rc.scrollLeft;
  rc.innerHTML=[{id:"bank",nome:"Porti Bank"},...others].map(x=>`<button type="button" data-to="${esc(x.id)}" aria-pressed="${SH.to===x.id}" aria-label="${esc(x.nome)}"><span class="ring">${x.id==="bank"?'<span class="bankav pblogo"><img src="logo.webp" alt=""></span>':avatar(x)}</span><span class="nm">${esc(x.id==="bank"?"Porti Bank":shortName(x.nome))}</span></button>`).join("");
  rc.scrollLeft=sl;
  $("#shReason").innerHTML=RS.map(r=>`<button type="button" class="rchip" data-note="${esc(r)}" aria-pressed="${SH.note===r}"${rStyle(r)}>${rIcon(r)}${esc(r)}</button>`).join("");
  const amt=parseAmt($("#shAmount").value),has=$("#shAmount").value!=="";
  $("#shClear").hidden=!has;$("#shClear").parentElement.classList.toggle("empty",!has);
  const go=$("#shGo"),an=p.nome||"?",warn=$("#shWarn");
  go.className="btn";warn.textContent="";
  if(SH.nfc){
    go.textContent=amt?`Aproximar para enviar ${money(amt)}`:"Digite o valor";go.disabled=!(amt>0);go.className="btn nfcgo";
    if(amt>bal&&!hiddenBal&&!peek)warn.textContent="Seu saldo fica negativo: "+fmt(bal-amt);
  }else if(SH.kind==="pay"){
    const toName=SH.to==="bank"?"o Porti Bank":nameOf(SH.to,D);
    go.textContent=amt&&SH.to?(proxy?`${an} paga ${money(amt)} para ${toName}`:`Pagar ${money(amt)} para ${toName}`):SH.to?`Digite o valor para ${toName}`:"Escolha para quem";
    go.disabled=!(amt>0&&SH.to);
    if(amt>bal&&!hiddenBal&&!(a===L.me&&peek))warn.textContent=(proxy?"O saldo de "+an+" fica negativo: ":"Seu saldo fica negativo: ")+fmt(bal-amt);
  }else if(SH.kind==="recv"){
    go.textContent=!amt?"Digite o valor":boss?(proxy?`${an} recebe ${money(amt)} do banco`:`Receber ${money(amt)} do banco`):`Pedir ${money(amt)} ao banqueiro`;go.disabled=!(amt>0);
  }else{
    const d=amt-bal;
    go.textContent=has?`Deixar o saldo de ${an} em ${money(amt)}`:"Digite o saldo correto";go.disabled=!has||d===0;
    if(has&&d!==0)warn.textContent=(d>0?"O banco paga ":"O banco recebe ")+money(Math.abs(d));
  }
}
/* press and hold −/+: repeats, speeds up, and after a while jumps 10× */
(function(){
  let t=null,held=false,btn=null,n=0,t0=0;
  function bump(){
    const step=Math.abs(+btn.dataset.add)||1000,sign=+btn.dataset.add<0?-1:1,el=Date.now()-t0;
    const mult=el>2600?10:1;
    setAmount(Math.max(0,parseAmt($("#shAmount").value)+sign*step*mult));drawSheet();
    if(n%2===0)play("tap");n++;
    btn.classList.toggle("turbo",mult>1);
    t=setTimeout(bump,Math.max(45,170-n*12));
  }
  function stop(){clearTimeout(t);t=null;if(btn)btn.classList.remove("holding","turbo");btn=null}
  ["#shMinus","#shPlus"].forEach(id=>{
    const b=$(id);
    b.addEventListener("pointerdown",e=>{stop();btn=b;held=false;n=0;b.classList.add("holding");
      t=setTimeout(()=>{held=true;t0=Date.now();bump()},380)});
    ["pointerup","pointercancel","pointerleave"].forEach(ev=>b.addEventListener(ev,stop));
    b.addEventListener("contextmenu",e=>e.preventDefault());
    /* a hold already changed the value: swallow the click that follows */
    b.addEventListener("click",e=>{if(held){held=false;e.stopPropagation();e.preventDefault()}},true);
  });
})();
$("#shMoreBtn").onclick=()=>{shMore=!shMore;play("tap");drawSheet()};
$("#shReasonBtn").onclick=()=>{shWhy=$("#shReasonWrap").hidden;play("tap");drawSheet()};
/* passou pela partida for any player (player menu) */
function doSalary(id){
  const D=derive(),p=D.P[id];if(!p)return;
  if(p.situacao==="preso"){toast(p.nome+" está preso e não recebe do banco.");play("err");return}
  if(!iAmBanker()&&txArr(D).some(t=>t.status==="pendente"&&t.para===id&&t.motivo==="Passou pela partida")){toast(p.nome+" já tem um pedido da partida esperando o banqueiro.");play("err");return}
  const r=lancar(null,id,L.mesa.salario,"Passou pela partida");
  if(r.status==="pendente"){play("ask");toast("Pedido enviado ao banqueiro: + "+money(L.mesa.salario),{label:"Cancelar",run:()=>estornar(r.id)});return}
  play("go");if(id===L.me)flashCard();
  toast(p.nome+" passou pela partida: + "+money(L.mesa.salario),{label:"Desfazer",run:()=>estornar(r.id)});
}
/* player action menu: tap a name in the ranking */
function openPlayer(id){
  const D=derive();if(!D.P[id])return;
  closeSheets();SH={kind:"menu",actor:id,to:null,note:""};
  $("#scrim").hidden=false;$("#plSheet").hidden=false;drawPlayer();kbFit();
}
function drawPlayer(){
  const D=derive(),a=SH.actor,p=D.P[a]||{},boss=iAmBanker(),self=a===L.me,proxy=!self;
  const hiddenBal=p.oculto&&proxy&&L.mesa.esconder!==false;
  $("#plAv").innerHTML=avatar(p);
  $("#plName").textContent=p.nome+(self?" (você)":"");
  $("#plBal").textContent="Saldo "+(hiddenBal?MASK:fmt(balances(D)[a]||0))+(p.situacao==="preso"?" · na cadeia":p.situacao==="ferias"?" · de férias":"");
  $("#plPayLbl").textContent=self?"Pagar":"Pagar por "+shortName(p.nome);
  $("#plSalSub").textContent=(boss?"+ ":"Pedir + ")+short(L.mesa.salario)+(p.situacao==="preso"?" · preso não recebe":"");
  $("#plRecvSub").textContent=boss?"Venda, hipoteca, prêmio":"Vira pedido para o banqueiro";
  $("#plSet").hidden=!boss;
  $("#plBoss").hidden=!boss;
  $("#shJail").querySelectorAll("button").forEach(b=>{const v=b.dataset.sit||null;b.hidden=(v===(p.situacao||null))});
  {const el=$("#plRounds");el.hidden=!p.situacao||!(boss||self);
   if(p.situacao)setHTML(el,`<span>${p.situacao==="ferias"?"De férias":"Na cadeia"} · <b>${roundsTxt(p)}</b></span><button class="btn small" type="button" data-vez="${esc(a)}">${self?"Passar a vez":"Passou a vez"}</button>`)}
  const rm=$("#shRemove");rm.hidden=!(boss&&proxy);
  if(!rm.dataset.arm)rm.textContent="Remover "+(p.nome||"")+" da mesa";
}
$("#plClose").onclick=closeSheets;
$("#plActs").addEventListener("click",e=>{const b=e.target.closest("[data-pa]");if(!b)return;const a=SH.actor,k=b.dataset.pa;play("tap");
  if(k==="salary"){closeSheets();doSalary(a);return}
  if(k==="cards"){openCards(a);return}
  openSheet(k,a)});
/* keep the sheet above the on-screen keyboard (iPhone shrinks only the visual viewport) */
function kbFit(){
  const vv=window.visualViewport;
  document.querySelectorAll(".sheet").forEach(sh=>{
    if(sh.hidden||!vv){sh.style.bottom="";sh.style.maxHeight="";sh.classList.remove("kbd");return}
    const kb=Math.max(0,window.innerHeight-(vv.height+vv.offsetTop));
    sh.style.bottom=kb?kb+"px":"";
    sh.style.maxHeight=kb?(vv.height-8)+"px":"";
    sh.classList.toggle("kbd",kb>60);
  });
}
if(window.visualViewport){visualViewport.addEventListener("resize",kbFit);visualViewport.addEventListener("scroll",kbFit)}
$("#shAmount").addEventListener("focus",()=>setTimeout(()=>{kbFit();$("#shAmount").scrollIntoView({block:"nearest"})},300));
$("#shTabs").addEventListener("click",e=>{const b=e.target.closest("button");if(!b||b.dataset.kind===SH.kind)return;SH.kind=b.dataset.kind;SH.to=SH.kind==="pay"?"bank":null;SH.note="";shWhy=false;setAmount(0);closeCalc();play("tap");drawSheet()});
$("#shClose").onclick=closeSheets;$("#scrim").onclick=closeSheets;
$("#shAmount").addEventListener("input",e=>{const raw=e.target.value;setAmount(raw.replace(/\D/g,"")===""?0:parseAmt(raw));if(raw.replace(/\D/g,"")==="")e.target.value="";drawSheet()});
$("#sheet").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||b.closest("#shTabs")||b.closest("#calc")||b.id==="shMoreBtn"||b.id==="shReasonBtn")return;
  if(b.dataset.to){SH.to=b.dataset.to;play("tap");drawSheet()}
  else if(b.dataset.note){SH.note=SH.note===b.dataset.note?"":b.dataset.note;if(SH.note)shWhy=false;play("tap");drawSheet()}
  else if(b.dataset.setval){setAmount(+b.dataset.setval);play("tap");drawSheet()}
  else if(b.dataset.add!==undefined){const v=+b.dataset.add;setAmount(v?Math.max(0,parseAmt($("#shAmount").value)+v):0);play("tap");drawSheet()}
});

/* calculator: dice × value per point */
let calcDice=0;
function closeCalc(){$("#calc").hidden=true;$("#calcToggle").setAttribute("aria-expanded","false")}
function drawCalc(){
  $("#calcDice").innerHTML=Array.from({length:11},(_,i)=>i+2).map(n=>`<button type="button" data-dice="${n}" aria-pressed="${calcDice===n}">${n}</button>`).join("");
  const big=L.mesa.saldo_inicial>=1e6||L.mesa.salario>=1e5;
  $("#calcQuick").innerHTML=(big?[4000,10000,20000,40000,50000,100000]:[4,10,20,40,50,100]).map(v=>`<button type="button" data-cv="${v}">${short(v)}</button>`).join("");
  const v=parseAmt($("#calcVal").value);
  const ok=calcDice>0&&v>0;
  $("#calcExpr").textContent=ok?`${calcDice} × ${money(v)} = ${money(calcDice*v)}`:calcDice?`${calcDice} × ?`:"Escolha os dados e o valor";
  if(ok){const tot=calcDice*v;if(!SH.note&&reasonsNow().includes("Aluguel"))SH.note="Aluguel";if(parseAmt($("#shAmount").value)!==tot){setAmount(tot)}drawSheet()}
}
$("#calcToggle").onclick=()=>{
  const open=$("#calc").hidden;
  $("#calc").hidden=!open;$("#calcToggle").setAttribute("aria-expanded",String(open));
  if(open)drawCalc();play("tap");
};
$("#calc").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.dice){calcDice=+b.dataset.dice;play("tap");drawCalc()}
  else if(b.dataset.cv){$("#calcVal").value=(+b.dataset.cv).toLocaleString("pt-BR");play("tap");drawCalc()}
  else if(b.id==="calcUse"){closeCalc();play("tap");drawSheet()}
});
$("#calcVal").addEventListener("input",e=>{fmtInput(e.target);drawCalc()});

$("#shGo").onclick=()=>{
  const D=derive(),a=SH.actor,an=nameOf(a,D),proxy=a!==L.me,amt=parseAmt($("#shAmount").value);
  if(SH.nfc){if(!(amt>0))return;const pend={actor:a,amt,note:SH.note};closeSheets();bumpStart(pend);return}
  if(SH.kind==="recv"&&(D.P[a]||{}).situacao==="preso"){toast(an+" está preso e não recebe do banco.");play("err");return}
  const before=balances(D)[a];
  let r,msg,snd;
  if(SH.kind==="pay"){
    if(!(amt>0&&SH.to))return;
    const to=SH.to==="bank"?null:SH.to;
    r=lancar(a,to,amt,to&&BANK_ONLY.includes(SH.note)?"":SH.note);msg=(proxy?an+" pagou ":"Pago: ")+money(amt)+" para "+nameOf(to,D);snd="pay";
  }else if(SH.kind==="recv"){
    if(!(amt>0))return;
    r=lancar(null,a,amt,SH.note);msg=(proxy?an+" recebeu ":"Recebido: ")+money(amt);snd="recv";
  }else if(SH.kind==="set"){
    const d=amt-before;if(!d)return;
    r=d>0?lancar(null,a,d,"Ajuste de saldo"):lancar(a,null,-d,"Ajuste de saldo");
    msg="Saldo de "+an+" ajustado para "+money(amt);snd="recv";
  }else return;
  closeSheets();
  if(r.status==="pendente"){play("ask");toast(SH.kind==="pay"?"Cobrança enviada: "+an+" confirma no celular":"Pedido enviado ao banqueiro: + "+money(amt),{label:"Cancelar",run:()=>estornar(r.id)});return}
  const after=balances(derive())[a];
  if(SH.kind==="pay"&&SH.to==="bank"){bancoComeu(an,amt);toast(msg,{label:"Desfazer",run:()=>estornar(r.id)});return}
  if(before>=0&&after<0){play("broke");toast(an+" ficou no vermelho!",{label:"Desfazer",run:()=>estornar(r.id)})}
  else{play(snd);toast(msg,{label:"Desfazer",run:()=>estornar(r.id)})}
  if(!proxy&&SH.kind!=="pay")flashCard();
};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeSheets()});

/* ---------- install as an app ---------- */
let installEvt=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;drawInstall()});
window.addEventListener("appinstalled",()=>{installEvt=null;drawInstall()});
function isStandalone(){return(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true}
function drawInstall(){
  const box=$("#installBox");
  if(isStandalone()){box.hidden=true;return}
  box.hidden=false;
  $("#installBtn").hidden=!installEvt;
  $("#installText").textContent=isIOS
    ?"No Safari, toque em Compartilhar (o quadrado com a seta) e depois em \"Adicionar à Tela de Início\"."
    :installEvt?"Toque no botão abaixo para colocar o ícone na tela inicial.":"No Chrome, abra o menu ⋮ e toque em \"Instalar app\" ou \"Adicionar à tela inicial\".";
}
$("#installBtn").onclick=async()=>{if(!installEvt)return;installEvt.prompt();try{await installEvt.userChoice}catch(e){}installEvt=null;drawInstall()};

/* ---------- keep the screen on during the game ---------- */
let wake=null;
async function keepAwake(){try{if(!wake&&"wakeLock" in navigator&&document.visibilityState==="visible"){wake=await navigator.wakeLock.request("screen");wake.addEventListener("release",()=>{wake=null})}}catch(e){}}

/* ---------- feel like an app, not a web page ---------- */
document.addEventListener("contextmenu",e=>{if(!e.target.closest("input,textarea,.linkbox"))e.preventDefault()});
["gesturestart","gesturechange"].forEach(ev=>document.addEventListener(ev,e=>e.preventDefault(),{passive:false}));
document.addEventListener("dblclick",e=>e.preventDefault(),{passive:false});

/* ---------- start ---------- */
if("serviceWorker" in navigator&&location.protocol!=="file:"){
  /* a new version was published: reload once so everyone runs the same app */
  const hadController=!!navigator.serviceWorker.controller;let reloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(hadController&&!reloaded){reloaded=true;location.reload()}});
  navigator.serviceWorker.register("sw.js").then(r=>{try{r.update()}catch(e){}}).catch(()=>{});
}
/* ---------- encostar: pagar aproximando um celular do outro ----------
   Web apps can't use NFC on the iPhone, so this works like the old "Bump":
   both phones feel the knock at the same moment (motion sensor) and tell the
   table over the internet. The phone that pressed "Encostar para pagar" pairs
   with whoever knocked within ~1.5s and opens Pagar with that person chosen. */
/* Each phone stamps the knock with its own clock (phones keep their clocks in
   sync with the network, usually within a fraction of a second), so a slow
   connection that delivers the message seconds later still matches. */
const BUMP_WIN=1500,BUMP_SAME=900,BUMP_LATE=8000;
var bumpCh=null,bumpCode=null,motionOK=false,motionAsked=false,lastKnock=0,recentPeers=[],bumpMode=null,bumpT=null;
function bumpOpen(code){
  if(bumpCode===code)return;if(bumpCh){bumpCh.close();bumpCh=null}bumpCode=code;
  if(API&&API.bumps){bumpCh=API.bumps(code,bumpIn,posIn);setTimeout(()=>posSend(false),1500)}
}
function bumpSend(role){if(bumpCh&&L&&L.me)bumpCh.send({id:L.me,role,mesa:L.codigo,t:lastKnock})}
function askMotion(){
  if(motionAsked)return;motionAsked=true;
  const DM=window.DeviceMotionEvent;
  if(DM&&typeof DM.requestPermission==="function"){
    try{DM.requestPermission().then(r=>{motionOK=r==="granted";if(motionOK)listenMotion();else if(bumpMode)bumpFail("O celular não deixou usar o sensor de movimento. Feche e abra o app e toque em Permitir.")}).catch(()=>{motionAsked=false})}catch(e){motionAsked=false}
  }else if(DM){motionOK=true;listenMotion()}
}
/* Knock detector. An encostar is a short, sharp change in acceleration (high
   "jerk"); moving the phone around by hand changes it smoothly. So we look at
   how much the acceleration vector jumps between two readings, not only how big
   it is. Front/back touches (z axis, screen against screen or back against
   back) count with a light touch; side bumps need a bit more. Touching the
   screen also jolts the phone along z, so motion right after a finger tap is
   ignored. */
let motionOn=false,prevA=null,grav=null,lastTouch=0;
const KN_FRONT_JERK=2.4,KN_FRONT_ACC=1.8,KN_ANY_JERK=3.5,KN_ANY_ACC=3;
["pointerdown","pointerup","touchstart","touchend"].forEach(ev=>document.addEventListener(ev,()=>{lastTouch=Date.now()},{passive:true,capture:true}));
function listenMotion(){
  if(motionOn)return;motionOn=true;
  window.addEventListener("devicemotion",e=>{
    let a=e.acceleration&&e.acceleration.x!=null?{x:e.acceleration.x||0,y:e.acceleration.y||0,z:e.acceleration.z||0}:null;
    if(!a){ /* no gravity-free reading: take gravity out with a slow filter */
      const g=e.accelerationIncludingGravity;if(!g||g.x==null)return;
      const r={x:g.x||0,y:g.y||0,z:g.z||0};
      if(!grav)grav={...r};else for(const k of["x","y","z"])grav[k]=grav[k]*.9+r[k]*.1;
      a={x:r.x-grav.x,y:r.y-grav.y,z:r.z-grav.z};
    }
    const p=prevA;prevA=a;if(!p)return;
    if(Date.now()-lastTouch<300)return;
    const jx=a.x-p.x,jy=a.y-p.y,jz=a.z-p.z;
    const jerk=Math.hypot(jx,jy,jz),mag=Math.hypot(a.x,a.y,a.z),side=Math.hypot(jx,jy);
    const front=Math.abs(jz)>KN_FRONT_JERK&&Math.max(Math.abs(a.z),Math.abs(p.z))>KN_FRONT_ACC&&Math.abs(jz)>=side*.7;
    if(front||(jerk>KN_ANY_JERK&&Math.max(mag,Math.hypot(p.x,p.y,p.z))>KN_ANY_ACC))knock();
  });
}
function knock(byTap){
  const now=Date.now();if(now-lastKnock<(byTap?400:1200))return;lastKnock=now;
  if(!L||!L.me||document.visibilityState!=="visible")return;
  bumpSend(bumpMode?"pay":"any");
  if(bumpMode){$("#bumpTitle").textContent="Senti o toque! Procurando o outro celular…";try{navigator.vibrate&&navigator.vibrate(40)}catch(e){}bumpTry();
    const k=lastKnock;setTimeout(()=>{if(bumpMode&&lastKnock===k)$("#bumpTitle").textContent="A internet de alguém está lenta… espere um pouco ou aproxime de novo"},4000)}
}
function bumpIn(p){
  if(!L||!p||!p.id||p.id===L.me||(p.mesa&&p.mesa!==L.codigo))return;
  const now=Date.now();
  recentPeers=recentPeers.filter(x=>now-x.got<BUMP_LATE);recentPeers.push({id:p.id,role:p.role,got:now,t:+p.t||0});
  if(p.role==="pay"&&sameKnock(recentPeers[recentPeers.length-1])&&!bumpMode){play("ask");toast(nameOf(p.id)+" aproximou o NFC para te pagar")}
  if(bumpMode)bumpTry();
}
let bumpDecideT=null;
function sameKnock(x){
  if(!x||!lastKnock)return false;
  if(x.t&&Math.abs(x.t-lastKnock)<BUMP_SAME)return true;   // same moment by the clocks
  return Math.abs(x.got-lastKnock)<BUMP_WIN;               // or arrived right away
}
function bumpTry(again){
  if(!bumpMode||!lastKnock)return;
  const wait=lastKnock+600-Date.now();
  if(wait>0&&!again){clearTimeout(bumpDecideT);bumpDecideT=setTimeout(()=>bumpTry(),wait);return}
  const near=recentPeers.filter(sameKnock);
  let D=derive();
  if(again!=="synced"&&near.some(x=>!D.P[x.id])){const k=lastKnock;Promise.resolve(syncNow()).catch(()=>{}).then(()=>{if(lastKnock===k)bumpTry("synced")});return}
  const ids=[...new Set(near.filter(x=>D.P[x.id]&&!D.P[x.id].removido).map(x=>x.id))];
  if(ids.length!==1){if(ids.length>1)$("#bumpTitle").textContent="Mais de um celular foi aproximado. Tente de novo.";return}
  const to=ids[0];
  if(bumpPay){ /* value was chosen before: the tap pays right away */
    const P=bumpPay,D2=derive();bumpPay=null;bumpClose();
    const before=balances(D2)[P.actor];
    const r=lancar(P.actor,to,P.amt,P.note);
    const after=balances(derive())[P.actor];
    if(before>=0&&after<0)play("broke");else play("pay");
    if(P.actor===L.me)flashCard();
    toast(r.status==="pendente"?"Cobrança enviada: "+nameOf(P.actor)+" confirma no celular":"Pago: "+money(P.amt)+" para "+nameOf(to),{label:r.status==="pendente"?"Cancelar":"Desfazer",run:()=>estornar(r.id)});
    return;
  }
  bumpClose();play("recv");
  openSheet("pay");if($("#sheet").hidden)return;SH.to=to;drawSheet();toast("Pagar para "+nameOf(to));
  setTimeout(()=>{try{$("#shAmount").focus()}catch(e){}},250);
}
let bumpPay=null;
function bumpStart(pay){
  if(!L||!L.me)return;
  bumpPay=pay||null;
  $("#bumpAmt").hidden=!bumpPay;
  if(bumpPay)$("#bumpAmt").innerHTML=money(bumpPay.amt)+(bumpPay.note?`<small>${esc(bumpPay.note)}</small>`:"");
  if(!bumpCh){toast("O NFC precisa de internet. Use Pagar normalmente.");play("err");return}
  askMotion();
  bumpMode="pay";$("#bumpTitle").textContent="Aproxime do celular de quem vai receber";
  $("#bump").hidden=false;play("tap");
  clearTimeout(bumpT);bumpT=setTimeout(()=>{if(bumpMode)bumpFail("Não encontrei o outro celular. O app dele precisa estar aberto.")},25000);
}
function bumpFail(msg){bumpPay=null;bumpClose();toast(msg+" Nada foi enviado.");play("err")}
function bumpClose(){bumpMode=null;clearTimeout(bumpT);$("#bump").hidden=true}
$("#aBump").onclick=()=>{play("tap");openSheet("pay",null,true)};
$("#bumpTap").onclick=()=>{knock(true);play("tap");const b=$("#bumpTap");b.classList.remove("hit");void b.offsetWidth;b.classList.add("hit")};
/* the receiver taps their own card at the same moment: no need to touch the phones */

$("#bumpCancel").onclick=()=>{bumpPay=null;bumpClose();play("tap")};
$("#bumpList").onclick=()=>{const P=bumpPay;bumpPay=null;bumpClose();openSheet("pay",P&&P.actor);if(P&&!$("#sheet").hidden){SH.to=null;SH.note=P.note||"";setAmount(P.amt);drawSheet()}};
/* the receiver's phone must feel the knock too: ask for the motion sensor on the first tap inside a table */
document.addEventListener("pointerup",()=>{if(L&&L.me&&!motionAsked)askMotion()},{passive:true});
if(window.DeviceMotionEvent&&typeof DeviceMotionEvent.requestPermission!=="function")askMotion();
window.__pbBump={knock,bumpIn,setCh:c=>{bumpCh=c},state:()=>({bumpMode,motionOK,lastKnock,recentPeers})};
/* ================= CARTAS (UI) ================= */
var ccSale=null,ccSalePrice="",cdOpen=null,cdFilter="all",cdDrag=null,cdCard=null,ccDice=0,ccPayer=null,ccArm=null,ccSell=null,ccBuild=null,ccHipN=null,tp={};
const HOUSE_SVG='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 7.4 8 2.4l5.8 5v6.2H2.2z"/><path d="M6.4 13.6V10h3.2v3.6"/></svg>';
const TOWER_SVG='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 14V6h4v8M7 14V2h6v12M2 14h12"/><path d="M9 5h2M9 8h2M9 11h2"/></svg>';
const GLOBE_SVG='<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><ellipse cx="50" cy="50" rx="20" ry="46"/><ellipse cx="50" cy="50" rx="38" ry="46"/><path d="M50 4v92M4 50h92M10 28h80M10 72h80"/></svg>';
function cardOwnerHTML(t,D){
  if(t.dono){const p=D.P[t.dono];return `<span class="mown owned">${p?avatar(p,"sm"):""}<b>${t.dono===L.me?"Você":esc(p?shortName(p.nome):"?")}</b></span>`}
  if(t.oferta){const p=D.P[t.oferta];return `<span class="mown m-off"><i></i><span>Oferta: <b>${esc(p?shortName(p.nome):"?")}</b></span></span>`}
  if(t.pedido){const p=D.P[t.pedido];return `<span class="mown m-req"><i></i><span>${t.pedido===L.me?"<b>Você pediu</b>":`Pedido: <b>${esc(p?shortName(p.nome):"?")}</b>`}</span></span>`}
  return `<span class="mown m-free"><i></i><span>Livre no banco</span></span>`;
}
function housesHTML(c,t){
  if(c.acao)return `<span class="mhouses"><small>Dados ×</small><b>${short(c.mult)}</b></span>`;
  const hp=t.casas_hip||0,free=(t.casas||0)-hp;
  if(t.casas>=5)return `<span class="mhouses"><span class="condo${hp?" hipd":""}">${TOWER_SVG}Condomínio${hp?`<em>${hp} hip.</em>`:""}</span></span>`;
  return `<span class="mhouses"><small>Casas</small>${[1,2,3,4].map(i=>`<i class="${t.casas>=i?(i>free?"on hipd":"on"):""}">${HOUSE_SVG}</i>`).join("")}</span>`;
}
/* card names: biggest size (≤17px) that fits in up to 2 lines without breaking a word,
   measured on the real element so it works with whatever font the phone shows */
const fitCache={};let fontsDone=false;
function fitNames(root){
  (root||document).querySelectorAll(".pc .mname b").forEach(b=>{
    const n=b.textContent;
    if(fitCache[n]){b.style.fontSize=fitCache[n]+"px";return}
    if(!b.clientWidth)return;
    let f=17;b.style.fontSize=f+"px";
    while(f>9&&(b.scrollWidth>b.clientWidth+.5||b.offsetHeight>f*2.2+1)){f-=.5;b.style.fontSize=f+"px"}
    if(fontsDone)fitCache[n]=f;
  });
}
try{document.fonts.ready.then(()=>{fontsDone=true;if(L&&!$("#cardsSheet").hidden)drawCards()})}catch(e){fontsDone=true}
function miniCard(c,t,D){
  const nf=15;
  const art=window.PB_ART||{icon:()=>"",flag:()=>""};
  return `<button type="button" class="mcard pc${c.acao?" acao":""}${t.dono&&t.dono===L.me?" mine":""}${t.hipotecada?" hip":""}${!t.dono&&(t.oferta||t.pedido)?" pend":""}" data-card="${c.id}" style="--gc:${c.acao?"#3a3a46":c.cor};--nf:${nf}px${t.dono&&D.P[t.dono]?`;--oc:${colorOf(D.P[t.dono].cor).c}`:""}">
    <span class="mtop"><span>Título de posse</span><i>#${String(c.id).padStart(2,"0")}</i></span>
    <span class="mhead"><span class="mico">${art.icon(c.id)}</span><span class="mname"><b>${esc(c.nome)}</b><small>${esc(c.pais)}</small></span><span class="mflag">${art.flag(c)}</span></span>
    <span class="mglobe">${GLOBE_SVG}</span>
    <span class="mlbl">Valor de compra</span>
    <span class="mprice">${money(c.preco)}</span>
    <span class="mfoot">${cardOwnerHTML(t,D)}${!t.dono&&(t.oferta||t.pedido)?"":`<span class="msep"></span>${housesHTML(c,t)}`}</span>${t.hipotecada?'<span class="mhip">HIPOTECADA</span>':""}</button>`;
}
function openCards(filter){
  closeSheets();cdFilter=filter||"free";cdOpen=null;
  $("#scrim").hidden=false;$("#cardsSheet").hidden=false;$("#cdBody").scrollTop=0;drawCards();
  if(titOff)toast("As cartas ainda não estão ligadas no banco online: falta rodar o SQL novo.");
}
function drawCards(){
  const D=derive(),boss=iAmBanker(),people=playersArr(D);
  const Tit=id=>D.Tit[id]||blankTit(id);
  const count=id=>Object.values(D.Tit).filter(t=>t.dono===id).length;
  const free=Object.keys(CARDS).filter(id=>!Tit(+id).dono).length;
  $("#cdSub").textContent=`${free} livres no banco • ${28-free} com jogadores`;
  $("#cdDrop").hidden=!people.length;
  $("#cdHint").textContent=boss?"Solte a carta em cima de quem comprou":"Solte a carta em cima de você para pedir a compra";
  if(people.length){
    if(cdOpen&&!D.P[cdOpen])cdOpen=null;
    $("#cdPpl").innerHTML=people.map(p=>`<button type="button" class="cdp${cdOpen===p.id?" open":""}" data-drop="${esc(p.id)}" aria-expanded="${cdOpen===p.id}" style="--pc2:${colorOf(p.cor).c}">${avatar(p)}<span class="n">${esc(shortName(p.nome))}</span><span class="c">${count(p.id)} ${count(p.id)===1?"carta":"cartas"}</span></button>`).join("");
    drawOwned(D);
  }
  if(!["all","free","mine","others"].includes(cdFilter)&&!D.P[cdFilter])cdFilter="free";
  const all=GRUPOS.flatMap(g=>g.ids);
  const nFree=all.filter(id=>!Tit(id).dono).length,nMine=all.filter(id=>Tit(id).dono===L.me).length,nOth=all.filter(id=>Tit(id).dono&&Tit(id).dono!==L.me).length;
  const person=D.P[cdFilter]?cdFilter:null;
  const seg=[["free","Livres",nFree],["mine","Minhas",nMine],["others","Dos outros",nOth],["all","Todas",28]].map(([k,l,n])=>`<button type="button" data-cf="${k}" aria-pressed="${cdFilter===k||(k==="others"&&!!person)}"><b>${l}</b><small>${n}</small></button>`).join("");
  const ppl=cdFilter==="others"||person?`<div class="fchips cdwho">${people.filter(p=>p.id!==L.me).map(p=>`<button type="button" data-cf="${esc(p.id)}" aria-pressed="${cdFilter===p.id}">${avatar(p,"sm")}${esc(shortName(p.nome))} · ${count(p.id)}</button>`).join("")}</div>`:"";
  const hint=cdFilter==="free"?`<p class="cdtip">${boss?"Toque numa carta para vender, ou segure e arraste até quem comprou.":"Toque numa carta para pedir a compra ao banqueiro."}</p>`:cdFilter==="others"||person?`<p class="cdtip">Caiu na casa de alguém? Toque na carta e use <b>Pagar aluguel</b>. Para negociar, <b>Propor troca</b>.</p>`:cdFilter==="mine"?`<p class="cdtip">Toque numa carta para cobrar aluguel, construir, hipotecar ou trocar.</p>`:"";
  setHTML($("#cdFilter"),`<div class="cdseg">${seg}</div>${ppl}${hint}`);
  const ok=t=>cdFilter==="all"||(cdFilter==="free"&&!t.dono)||(cdFilter==="mine"&&t.dono===L.me)||(cdFilter==="others"&&t.dono&&t.dono!==L.me)||(person&&t.dono===person);
  const cs=all.filter(id=>ok(Tit(id)));
  const empty=cdFilter==="mine"?'<p class="empty">Você ainda não tem cartas. Veja as <button class="link" data-cf="free" type="button">cartas livres</button>.</p>':'<p class="empty">Nenhuma carta aqui.</p>';
  const html=cs.length?`<div class="cdgrid">${cs.map(id=>miniCard(CARDS[id],Tit(id),D)).join("")}</div>`:empty;
  if(!setHTML($("#cdGroups"),html))return;
  fitNames($("#cdGroups"));
}
/* tela inicial: as cartas da pessoa sempre à mão */
function drawMyCards(D){
  const art=window.PB_ART||{icon:()=>""};
  const order=GRUPOS.flatMap(g=>g.ids);
  const ids=order.filter(id=>{const t=D.Tit[id];return t&&t.dono===L.me});
  const owed=new Set(txArr(D).filter(t=>t.status==="pendente"&&t.para===L.me&&t.de).map(t=>t.motivo));
  const others=order.some(id=>{const t=D.Tit[id];return t&&t.dono&&t.dono!==L.me});
  const tiles=ids.map(id=>{const c=CARDS[id],t=D.Tit[id],hp=t.casas_hip||0;
    const rent=t.hipotecada?"hipotecada":c.acao?`dados × ${short(c.mult)}`:money(c.al[rentLvl(t)]);
    const houses=c.acao?'<span class="myh">ação</span>':t.casas>=5?`<span class="myh condo${hp?" hipd":""}">condomínio</span>`:`<span class="myh">${[1,2,3,4].map(i=>`<i class="${t.casas>=i?(i>t.casas-hp?"on hipd":"on"):""}"></i>`).join("")}</span>`;
    return `<button type="button" class="myc${t.hipotecada?" hip":""}" data-mycard="${id}" style="--gc:${c.acao?"#3a3a46":c.cor}"><span class="myb"><span class="myi">${art.icon(id)}</span><b>${esc(c.nome)}</b></span><span class="myr"><small>${t.hipotecada?"":"aluguel"}</small>${rent}</span>${houses}${owed.has(("Aluguel: "+c.nome).slice(0,40))?'<span class="myw">cobrando</span>':""}</button>`}).join("");
  const pay=others?`<button type="button" class="myc paytile" data-mypay="1"><span class="myb"><span class="myi"><svg viewBox="0 0 24 24"><path d="M3 7h18v11H3z"/><path d="M3 11h18M7 15h4"/></svg></span><b>Pagar aluguel</b></span><span class="myr"><small>caí na casa</small>de alguém</span></button>`:"";
  const none=ids.length?"":`<button type="button" class="myc freetile" data-myfree="1"><span class="myb"><b>Sem cartas ainda</b></span><span class="myr"><small>comprar do banco</small>ver cartas livres</span></button>`;
  $("#myCards").hidden=false;
  $("#myCardsSub").textContent=ids.length?`${ids.length} ${ids.length===1?"carta":"cartas"} · toque para cobrar, construir, hipotecar ou trocar`:"Quando você comprar, suas cartas aparecem aqui";
  setHTML($("#myCardsRow"),pay+tiles+none);
}
$("#myCardsRow").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;play("tap");
  if(b.dataset.mycard)openCard(+b.dataset.mycard);else if(b.dataset.mypay)openCards("others");else if(b.dataset.myfree)openCards("free")});
$("#myCardsAll").onclick=()=>{play("tap");openCards("mine")};
/* banqueiro: toque no nome da pessoa para ver (ou esconder) as cartas dela */
function ownChip(c,t){
  const info=!t.dono?(t.oferta?"Esperando confirmar":"Esperando o banqueiro"):t.hipotecada?"Hipotecada":c.acao?`Dados × ${short(c.mult)}`:t.casas>=5?"Condomínio":t.casas?`${t.casas} ${t.casas>1?"casas":"casa"}`:money(c.preco);
  return `<button type="button" class="cdo${t.hipotecada?" hip":""}${t.dono?"":" pend"}" data-ocard="${c.id}" style="--gc:${c.acao?"#3a3a46":c.cor}"><span class="cdob">${esc(c.nome)}</span><span class="cdom">${info}</span></button>`;
}
function drawOwned(D){
  const box=$("#cdOwn"),p=cdOpen&&D.P[cdOpen];
  if(!p){box.hidden=true;box.innerHTML="";box.removeAttribute("data-drop");return}
  box.dataset.drop=p.id;
  const old=box.querySelector(".cdorow"),sl=old?old.scrollLeft:0;
  const order=GRUPOS.flatMap(g=>g.ids);
  const ids=Object.keys(CARDS).map(Number).filter(id=>{const t=D.Tit[id];return t&&(t.dono===p.id||(!t.dono&&(t.oferta===p.id||t.pedido===p.id)))}).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  const own=ids.filter(id=>D.Tit[id].dono===p.id).length,pend=ids.length-own;
  box.style.setProperty("--pc2",colorOf(p.cor).c);
  box.innerHTML=`<div class="cdoh"><b>Cartas de ${esc(shortName(p.nome))}</b><span>${own} ${own===1?"carta":"cartas"}${pend?` · ${pend} esperando`:""}</span></div>`+
    (ids.length?`<div class="cdorow">${ids.map(id=>ownChip(CARDS[id],D.Tit[id])).join("")}</div>`:`<p class="cdoe">Ainda sem cartas. Segure uma carta livre e arraste até ${esc(shortName(p.nome))}.</p>`);
  box.hidden=false;
  const row=box.querySelector(".cdorow");if(row)row.scrollLeft=sl;
}
$("#cdPpl").addEventListener("click",e=>{
  if(cdDrag||cdDragJust)return;
  const b=e.target.closest(".cdp");if(!b)return;
  cdOpen=cdOpen===b.dataset.drop?null:b.dataset.drop;play("tap");drawCards();
});
$("#cdOwn").addEventListener("click",e=>{const b=e.target.closest("[data-ocard]");if(!b)return;play("tap");openCard(+b.dataset.ocard)});
$("#aCards").onclick=()=>{play("tap");openCards()};
$("#cdClose").onclick=closeSheets;
$("#cdFilter").addEventListener("click",e=>{const b=e.target.closest("[data-cf]");if(!b)return;cdFilter=b.dataset.cf;play("tap");drawCards();$("#cdBody").scrollTop=0});
$("#cdGroups").addEventListener("click",e=>{const b=e.target.closest("button[data-cf]");if(!b)return;e.stopPropagation();cdFilter=b.dataset.cf;play("tap");drawCards()});
$("#cdGroups").addEventListener("click",e=>{const b=e.target.closest("[data-card]");if(!b||cdDragJust)return;play("tap");openCard(+b.dataset.card)});

/* banker: hold a free card and drag it onto a player */
var cdHold=null,cdDragJust=false;
function cdEnd(drop){
  clearTimeout(cdHold);cdHold=null;
  if(!cdDrag)return;
  const d=cdDrag;cdDrag=null;
  document.body.classList.remove("cdragging");$("#cardGhost").hidden=true;$("#cardGhost").innerHTML="";
  if(d.el)d.el.classList.remove("lifting");
  document.querySelectorAll("[data-drop].over").forEach(x=>x.classList.remove("over"));
  cdDragJust=true;setTimeout(()=>cdDragJust=false,350);
  if(drop){
    const c=CARDS[d.card],D=derive(),p=D.P[drop],t=D.Tit[d.card]||blankTit(d.card);if(!p){drawCards();return}
    if(t.dono){
      if(drop===t.dono){drawCards();return}
      openCard(d.card);ccSale=drop;ccSalePrice="";drawCard();play("tap");toast(`Combine o preço com ${p.nome} e arraste para oferecer`);
      setTimeout(()=>{const tile=document.querySelector("#ccSalePrice");if(tile)tile.scrollIntoView({block:"center",behavior:"smooth"})},120);
      return;
    }
    if(!iAmBanker()){
      if(drop!==L.me){toast("Arraste a carta até você. Só o banqueiro vende para outras pessoas.");play("err")}
      else if(t.pedido===L.me)toast(`Você já pediu ${c.nome}. Esperando o banqueiro.`);
      else{titOp(d.card,"pedir");play("ask");toast(`Pedido enviado: ${c.nome} por ${money(c.preco)}. Esperando o banqueiro autorizar.`)}
    }else if(t.pedido&&t.pedido===drop){titOp(d.card,"comprar",drop);play("go");toast(`Compra autorizada: ${c.nome} para ${p.nome}`)}
    else{titOp(d.card,"ofertar",drop);play("pay");toast(`${c.nome} oferecida a ${p.nome}. Esperando confirmar.`)}
  }
  drawCards();
}
$("#cdGroups").addEventListener("pointerdown",e=>{
  const el=e.target.closest("[data-card]");if(!el||!L||!L.me)return;
  const id=+el.dataset.card,t=derive().Tit[id];
  if(t&&t.dono&&t.dono!==L.me&&!iAmBanker())return;
  if(!(t&&t.dono)&&!iAmBanker()&&t&&t.pedido&&t.pedido!==L.me)return;
  const x0=e.clientX,y0=e.clientY;
  clearTimeout(cdHold);
  cdHold=setTimeout(()=>{
    const g=$("#cardGhost");g.innerHTML=el.outerHTML;
    cdDrag={card:id,el,x0,y0};el.classList.add("lifting");document.body.classList.add("cdragging");g.style.left=x0+"px";g.style.top=y0+"px";g.hidden=false;
    play("tap");try{navigator.vibrate&&navigator.vibrate(25)}catch(err){}
  },260);
  const mv=ev=>{if(!cdDrag&&Math.hypot(ev.clientX-x0,ev.clientY-y0)>9){clearTimeout(cdHold);cdHold=null}};
  el.addEventListener("pointermove",mv,{passive:true});
  el.addEventListener("pointerup",()=>el.removeEventListener("pointermove",mv),{once:true});
});
document.addEventListener("pointermove",e=>{
  if(!cdDrag)return;
  const g=$("#cardGhost");g.style.left=e.clientX+"px";g.style.top=e.clientY+"px";
  const over=document.elementFromPoint(e.clientX,e.clientY);const tgt=over&&over.closest("[data-drop]");
  document.querySelectorAll("[data-drop].over").forEach(x=>{if(x!==tgt)x.classList.remove("over")});
  if(tgt&&!tgt.classList.contains("over")){tgt.classList.add("over");play("tap")}
});
document.addEventListener("pointerup",e=>{
  if(cdHold&&!cdDrag){clearTimeout(cdHold);cdHold=null;return}
  if(!cdDrag)return;
  const over=document.elementFromPoint(e.clientX,e.clientY);const tgt=over&&over.closest("[data-drop]");
  cdEnd(tgt&&tgt.dataset.drop);
});
document.addEventListener("pointercancel",()=>{if(cdDrag)cdEnd(null);else{clearTimeout(cdHold);cdHold=null}});
document.addEventListener("touchmove",e=>{if(cdDrag)e.preventDefault()},{passive:false});
document.addEventListener("contextmenu",e=>{if(e.target.closest&&e.target.closest(".mcard"))e.preventDefault()});

/* one card in detail */
function openCard(id,tab){
  ccTab=tab||null;cdCard=id;ccDice=0;ccPayer=null;ccArm=null;ccSell=null;ccSale=null;ccSalePrice="";ccBuild=null;ccHipN=null;tp={dir:"nada",val:0};
  $("#cardSheet").hidden=false;$("#scrim").hidden=false;$("#ccBody").scrollTop=0;drawCard();
}
function closeCard(){$("#cardSheet").hidden=true;$("#cardSheet").classList.remove("over3d");if($("#cardsSheet").hidden)$("#scrim").hidden=true}
$("#ccClose").onclick=closeCard;
$("#ccBody").addEventListener("input",e=>{if(e.target.id!=="tpVal")return;const raw=e.target.value.replace(/\D/g,"");tp.val=raw?+raw:0;e.target.value=tp.val?"$ "+tp.val.toLocaleString("pt-BR"):"";const c=CARDS[cdCard],D=derive();const el=$("#tpSum");if(el)el.innerHTML=tpSummary(c,D.Tit[c.id]||blankTit(c.id),D)});
const CCTAB_IC={
  pagar:'<svg viewBox="0 0 24 24"><path d="M3 7h18v11H3z"/><path d="M3 11h18M7 15h4"/></svg>',
  cobrar:'<svg viewBox="0 0 24 24"><path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3"/></svg>',
  construir:'<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/></svg>',
  hipoteca:'<svg viewBox="0 0 24 24"><path d="M5 10h14v10H5zM8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/></svg>',
  vender:'<svg viewBox="0 0 24 24"><path d="M3 12 12 3h8v8l-9 9z"/><circle cx="16" cy="7" r="1.5"/></svg>',
  troca:'<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  banco:'<svg viewBox="0 0 24 24"><path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>'
};
var ccTab=null;
function drawCard(){
  const c=CARDS[cdCard];if(!c)return;
  const D=derive(),t=D.Tit[c.id]||blankTit(c.id),boss=iAmBanker(),me=L.me,owner=t.dono&&D.P[t.dono],mine=t.dono===me;
  $("#cardSheet").style.setProperty("--gc",c.acao?"#2A2A33":c.cor);
  $("#ccName").textContent=c.nome;$("#ccCountry").textContent=c.pais;
  let h="";
  const slide=(act,label,sub,tone,extra)=>`<div class="slide ${tone||""}" data-sl="${act}"${extra||""}><div class="sl-fill"></div><span class="sl-txt">${label}${sub?`<small>${sub}</small>`:""}</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>`;
  const tile=(title,body)=>`<div class="ctile"><h4>${title}</h4>${body}</div>`;
  /* summary: who has it and what the rent is right now */
  const rentNow=owner&&!t.hipotecada?(c.acao?`dados × ${money(c.mult)}`:money(c.al[rentLvl(t)])):null;
  const status=[];
  if(owner){
    if(t.hipotecada)status.push('<span class="cst hip">Hipotecada</span>');
    if(!c.acao&&t.casas>=5)status.push('<span class="cst">Condomínio</span>');else if(!c.acao&&t.casas)status.push(`<span class="cst">${t.casas} ${t.casas>1?"casas":"casa"}</span>`);
    if(t.casas_hip&&!t.hipotecada)status.push(`<span class="cst hip">${t.casas_hip} ${t.casas_hip>1?"construções hipotecadas":"construção hipotecada"}</span>`);
  }
  if(owner)h+=`<div class="ccsum">${avatar(owner)}<div class="who"><b>${mine?"Sua carta":esc(owner.nome)}</b><span>${status.join("")||'<span class="cst">'+(c.acao?"Ação":"Sem casas")+"</span>"}</span></div><div class="rnow"><small>${t.hipotecada?"Aluguel":"Aluguel agora"}</small><b>${rentNow||"não cobra"}</b></div></div>`;
  else if(t.pedido&&!t.oferta){const p=D.P[t.pedido];h+=`<div class="ccown">${p?avatar(p):""}<div>${t.pedido===me?"Você pediu esta carta":"Pedida por "+esc(p?p.nome:"?")}<small>Esperando o banqueiro autorizar a compra de ${money(c.preco)}</small></div></div>`}
  else if(t.oferta){const p=D.P[t.oferta];h+=`<div class="ccown">${p?avatar(p):""}<div>Oferecida a ${esc(p?p.nome:"?")}<small>Esperando confirmar a compra de ${money(c.preco)}</small></div></div>`}
  else h+=`<div class="ccsum free"><div class="who"><b>Livre no banco</b><span><span class="cst">Ninguém tem ainda</span></span></div><div class="rnow"><small>Preço</small><b>${money(c.preco)}</b></div></div>`;
  if(owner&&t.venda_para)h+=`<div class="ccown sale"><div>${mine?"Você":esc(shortName(owner.nome))} ${mine?"está":"está"} vendendo para ${esc(nameOf(t.venda_para,D))}<small>Por ${money(t.venda_preco||0)} · esperando ${t.venda_para===me?"você":"a pessoa"} confirmar</small></div></div>`;
  /* rent table, folded when the card has an owner */
  const lb=["Sem casa","1 casa","2 casas","3 casas","4 casas","Condomínio"];
  const table=c.acao?`<div class="rtable"><div class="sep"><span>Preço</span><span>${money(c.preco)}</span></div><div class="${owner&&!t.hipotecada?"now":""}"><span>Soma dos dados ×</span><span>${money(c.mult)}</span></div><div class="sep"><span>Hipoteca</span><span>${money(c.hip)}</span></div></div>`
    :`<div class="rtable"><div class="sep"><span>Preço</span><span>${money(c.preco)}</span></div>${c.al.map((v,i)=>`<div class="${owner&&!t.hipotecada&&rentLvl(t)===i?"now":""}"><span>${lb[i]}</span><span>${money(v)}</span></div>`).join("")}<div class="sep"><span>Casa / condomínio</span><span>${money(c.casa)}</span></div><div class="sep"><span>Hipoteca</span><span>${money(c.hip)}</span></div></div>`;
  h+=owner?`<details class="rtd"><summary>Tabela de aluguel e valores</summary>${table}</details>`:table;
  let a="";
  /* free card: buy flows, no tabs */
  if(!t.dono){
    if(t.pedido&&boss&&t.pedido!==me)a+=tile(`Pedido de ${esc(shortName(nameOf(t.pedido,D)))}`,slide("autorizar",`Arraste para autorizar`,`${esc(shortName(nameOf(t.pedido,D)))} paga ${money(c.preco)} ao banco`,"buy")+`<button class="btn ghost small" data-cc="recusar" type="button">Recusar o pedido</button>`);
    else if(t.pedido===me&&!boss)a+=tile("Seu pedido",`<p class="ccnote">O banqueiro precisa autorizar. Quando ele autorizar, ${money(c.preco)} sai do seu saldo.</p><button class="btn ghost small" data-cc="recusar" type="button">Cancelar meu pedido</button>`);
    else if(!boss&&!t.pedido&&t.oferta!==me)a+=tile("Quero comprar",slide("pedir","Arraste para pedir a compra",`${money(c.preco)} · o banqueiro autoriza`,"buy"));
    if(t.oferta===me)a+=tile("Comprar esta carta",slide("comprar","Arraste para comprar",money(c.preco),"buy")+`<button class="btn ghost small" data-cc="recusar" type="button">Não quero</button>`);
    if(boss){
      const ppl=playersArr(D);
      if(!ccSell||!D.P[ccSell])ccSell=t.oferta||null;
      a+=tile(t.oferta?"Vender para outra pessoa":"Vender carta",`<div class="fchips">${ppl.map(p=>`<button type="button" data-offer="${esc(p.id)}" aria-pressed="${ccSell===p.id}">${avatar(p,"sm")}${esc(shortName(p.nome))}</button>`).join("")}</div>`+
        (ccSell?slide("ofertar",`Arraste para vender a ${esc(shortName(nameOf(ccSell,D)))}`,money(c.preco)+" · a pessoa confirma no celular","buy",` data-to="${esc(ccSell)}"`):`<p class="ccnote">Escolha quem comprou. Na lista de cartas você também pode segurar a carta e arrastar até a pessoa.</p>`)+
        (t.oferta?`<button class="btn ghost small" data-cc="recusar" type="button">Cancelar a oferta para ${esc(shortName(nameOf(t.oferta,D)))}</button>`:""));
    }
  }
  if(t.dono){
    if(t.venda_para===me)a+=tile(`${esc(shortName(nameOf(t.dono,D)))} quer te vender`,slide("aceitar_venda","Arraste para comprar",`Paga ${money(t.venda_preco||0)} para ${esc(shortName(nameOf(t.dono,D)))}`,"buy")+`<button class="btn ghost small" data-cc="recusar" type="button">Não quero</button>`);
  }
  if(t.dono){
    /* tabs: only what this person can do with this card */
    const tabs=[];
    const canAdmin=mine||boss;
    if(!mine&&!t.hipotecada)tabs.push(["pagar","Pagar aluguel"]);
    if(canAdmin&&!t.hipotecada)tabs.push(["cobrar","Cobrar aluguel"]);
    if(canAdmin&&!c.acao)tabs.push(["construir","Construir"]);
    if(canAdmin)tabs.push(["hipoteca","Hipotecar"]);
    if(canAdmin)tabs.push(["vender","Vender"]);
    if(D.P[me])tabs.push(["troca",mine?"Trocar":"Propor troca"]);
    if(boss)tabs.push(["banco","Banqueiro"]);
    if(!tabs.some(x=>x[0]===ccTab))ccTab=tabs.length?tabs[0][0]:null;
    if(tabs.length>1)a+=`<div class="cctabs n${tabs.length}">${tabs.map(([k,l])=>`<button type="button" data-cct="${k}" aria-pressed="${ccTab===k}">${CCTAB_IC[k]}<span>${l}</span></button>`).join("")}</div>`;
    if(ccTab==="pagar"){
      const val=rentOf(c,t,ccDice);
      a+=tile(`Caí aqui · pagar para ${esc(shortName(owner.nome))}`,(c.acao?`<p class="tlab">Quanto deu nos dados?</p><div class="dicepick">${[2,3,4,5,6,7,8,9,10,11,12].map(n=>`<button type="button" data-dice="${n}" aria-pressed="${ccDice===n}">${n}</button>`).join("")}</div>`:"")+
        (val>0?slide("pagar_aluguel",`Arraste para pagar ${money(val)}`,`para ${esc(owner.nome)} · aluguel de ${esc(c.nome)}`,"rent"):`<p class="ccnote">Escolha a soma dos dados.</p>`));
    }
    if(ccTab==="cobrar"){
      const others=playersArr(D).filter(p=>p.id!==t.dono);
      if(ccPayer&&!D.P[ccPayer])ccPayer=null;
      const val=rentOf(c,t,ccDice),direct=ccPayer&&!needsApproval(ccPayer,t.dono,me);
      a+=tile("Cobrar aluguel · quem caiu aqui?",`<div class="fchips">${others.map(p=>`<button type="button" data-payer="${esc(p.id)}" aria-pressed="${ccPayer===p.id}">${avatar(p,"sm")}${esc(shortName(p.nome))}</button>`).join("")}</div>
        ${c.acao?`<div class="dicepick">${[2,3,4,5,6,7,8,9,10,11,12].map(n=>`<button type="button" data-dice="${n}" aria-pressed="${ccDice===n}">${n}</button>`).join("")}</div>`:""}
        ${ccPayer&&val>0?slide("cobrar",`Arraste para cobrar ${money(val)} de ${esc(shortName(nameOf(ccPayer,D)))}`,direct?`lançado pelo banqueiro para ${esc(shortName(owner.nome))}`:`${esc(shortName(nameOf(ccPayer,D)))} confirma no celular dele`,"rent"):`<p class="ccnote">${c.acao&&!ccDice&&ccPayer?"Escolha a soma dos dados.":"Escolha quem caiu aqui. A pessoa confirma o pagamento no celular dela."}</p>`}`);
    }
    if(ccTab==="construir"){
    if(!c.acao){
      const can=!t.hipotecada&&t.casas<5,tgt=can?Math.max(t.casas+1,Math.min(5,ccBuild||t.casas+1)):t.casas,n=tgt-t.casas;
      const gg=groupGap(D.Tit,c,t.dono),gname=(GRUPOS.find(x=>x.k===c.g)||{}).n||"",pickable=can&&gg.ok;
      const ic=k=>k<5?'<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v9H4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M4 20V8h7v12M11 20V4h9v16M3 20h18M14 8h3M14 11h3M14 14h3M6.5 11h2M6.5 14h2"/></svg>';
      const hs=[1,2,3,4,5].map(k=>`<i class="${k===5?"cond ":""}${t.casas>=k?"on":k<=tgt&&pickable?"pick":""}"${pickable&&k>t.casas?` data-lvl="${k}" role="button" aria-label="${k===5?"Até o condomínio":"Até "+k+" casas"}"`:""}>${ic(k)}</i>`).join("");
      const what=tgt===5&&n===1?"o condomínio":tgt===5?`${n-1} ${n-1===1?"casa":"casas"} + condomínio`:`${n} ${n===1?"casa":"casas"}`;
      a+=tile("Construção",`<div class="chouses">${hs}</div>`+(t.hipotecada?`<p class="ccnote">Pague a hipoteca para voltar a construir.</p>`:!gg.ok&&t.casas<5?`<p class="ccnote grp">${gg.missing.length?`Para construir, junte a cor ${esc(gname.toLowerCase())} inteira. Falta: <b>${gg.missing.map(id=>esc(CARDS[id].nome)+((D.Tit[id]||{}).dono?` (de ${esc(shortName(nameOf(D.Tit[id].dono,D)))})`:" (livre)")).join(", ")}</b>.`:`Pague a hipoteca de <b>${gg.hip.map(id=>esc(CARDS[id].nome)).join(", ")}</b> para construir nesta cor.`}</p>`:t.casas>=5?`<p class="ccnote">Já tem condomínio. Aluguel máximo: ${money(c.al[5])}.</p>`:
        `<p class="ccnote" style="text-align:center">Toque nas casinhas para escolher quantas construir de uma vez.</p>`+slide("construir",`Arraste para construir`,`${what} · paga ${money(c.casa*n)}`,"build",` data-n="${n}"`)+`<p class="ccnote" style="text-align:center">Aluguel vai para <b>${money(c.al[tgt])}</b></p>`));
    }
    }
    if(ccTab==="hipoteca"){
    {
      let hb="";
      if(!c.acao&&t.casas>0){
        const hp=t.casas_hip||0,free=t.casas-hp,u=houseHip(c);
        const unit=k=>k===5?"o condomínio":"a "+k+"ª casa";
        if(free>0){
          const n=Math.max(1,Math.min(free,ccHipN||1));
          const lst=[];for(let k=t.casas-hp-n+1;k<=t.casas-hp;k++)lst.push(k);
          const what=n===1?unit(lst[0]):lst.includes(5)?`${n-1} ${n-1===1?"casa":"casas"} + condomínio`:`${n} casas`;
          hb+=`<p class="tlab">Hipotecar construções · cada uma vale ${money(u)}</p><div class="fchips hipn">${Array.from({length:free},(_,i)=>i+1).map(k=>`<button type="button" data-hipn="${k}" aria-pressed="${k===n}">${k}</button>`).join("")}</div>`+
            slide("hipotecar_casas",`Arraste para hipotecar ${what}`,`Recebe ${money(n*u)} · aluguel cai para ${money(c.al[free-n])}`,"hip",` data-n="${n}"`);
        }
        if(hp>0)hb+=slide("resgatar_casas",`Arraste para pagar a hipoteca ${hp===1?"da casa":`das ${hp} casas`}`,`Paga ${money(hp*u)} · aluguel volta para ${money(c.al[t.casas])}`,"pay",` data-n="${hp}"`);
      }
      a+=tile("Hipoteca · dinheiro do banco agora",(t.hipotecada?slide("resgatar","Arraste para pagar a hipoteca",`Paga ${money(c.hip)} ao banco`,"pay"):slide("hipotecar","Arraste para hipotecar",`Recebe ${money(c.hip)} do banco · para de cobrar aluguel`,"hip"))+hb);
    }
      a+=`<p class="ccnote">Para pagar uma dívida: hipoteque a carta ou só as construções. Para tirar a hipoteca, você paga o mesmo valor de volta.</p>`;
    }
    if(ccTab==="vender"){
    {
      const others=playersArr(D).filter(p=>p.id!==t.dono);
      if(t.venda_para)a+=tile("Venda para outro jogador",`<p class="ccnote">Oferecida a ${esc(nameOf(t.venda_para,D))} por ${money(t.venda_preco||0)}. Quando a pessoa confirmar no celular, o dinheiro cai para ${mine?"você":esc(shortName(nameOf(t.dono,D)))}.</p><button class="btn ghost small" data-cc="recusar" type="button">Cancelar a venda</button>`);
      else if(others.length){
        if(ccSale&&!D.P[ccSale])ccSale=null;
        const pr=ccSalePrice===""?c.preco:parseAmt(ccSalePrice);
        a+=tile("Vender para outro jogador",`<div class="fchips">${others.map(p=>`<button type="button" data-sale="${esc(p.id)}" aria-pressed="${ccSale===p.id}">${avatar(p,"sm")}${esc(shortName(p.nome))}</button>`).join("")}</div>`+
          (ccSale?`<label class="saleprice">Preço combinado<input class="inp num" id="ccSalePrice" inputmode="numeric" autocomplete="off" value="${pr?pr.toLocaleString("pt-BR"):""}"></label>`+slide("vender",`Arraste para oferecer a ${esc(shortName(nameOf(ccSale,D)))}`,`por ${money(pr||0)} · a pessoa confirma no celular`,"buy",` data-to="${esc(ccSale)}"`):`<p class="ccnote">Escolha quem vai comprar e combine o preço. A carta vai com as casas e a hipoteca que tiver.</p>`));
      }
    }
    }
    if(ccTab==="troca")a+=tradeTile(c,t,D);
    if(ccTab==="banco"){
    if(boss)a+=tile("Banqueiro",(t.casas>0?`<button class="btn ghost small" data-cc="tirar_casa" type="button">Tirar 1 ${t.casas>=5?"(condomínio)":"casa"} · sem mexer no dinheiro</button>`:"")+slide("devolver","Arraste para devolver ao banco","A carta fica livre","danger"));
    }
  }
  if(a)h+=a;
  setHTML($("#ccBody"),h);
}
$("#ccBody").addEventListener("input",e=>{
  if(e.target.id!=="ccSalePrice")return;
  fmtInput(e.target);ccSalePrice=e.target.value;
  const sm=document.querySelector('#ccBody [data-sl="vender"] .sl-txt small');if(sm)sm.textContent=`por ${money(parseAmt(ccSalePrice)||0)} · a pessoa confirma no celular`;
});
$("#ccBody").addEventListener("click",e=>{
  const lv=e.target.closest("[data-lvl]");if(lv){ccBuild=+lv.dataset.lvl;play("tap");drawCard();return}
  const ct=e.target.closest("[data-cct]");if(ct){ccTab=ct.dataset.cct;ccDice=0;play("tap");drawCard();return}
  const tb=e.target.closest("[data-tpara],[data-tget],[data-tgive],[data-tdir],[data-tadd],[data-tcancel]");
  if(tb){const d=tb.dataset;
    if(d.tpara!==undefined){tp.para=d.tpara;tp.get=null}
    else if(d.tget!==undefined)tp.get=d.tget?+d.tget:null;
    else if(d.tgive!==undefined)tp.give=d.tgive?+d.tgive:null;
    else if(d.tdir!==undefined){tp.dir=d.tdir;if(tp.dir==="nada")tp.val=0}
    else if(d.tadd!==undefined){const v=+d.tadd;tp.val=v?(tp.val||0)+v:0}
    else if(d.tcancel){trocaOp("cancelar",{id:d.tcancel});play("undo");toast("Proposta cancelada")}
    play("tap");drawCard();return}
  const b=e.target.closest("button");if(!b)return;
  const c=CARDS[cdCard],D=derive(),t=D.Tit[c.id]||blankTit(c.id);
  if(b.dataset.offer){ccSell=b.dataset.offer;play("tap");drawCard();return}
  if(b.dataset.sale){ccSale=ccSale===b.dataset.sale?null:b.dataset.sale;play("tap");drawCard();return}
  if(b.dataset.hipn){ccHipN=+b.dataset.hipn;play("tap");drawCard();return}
  if(b.dataset.payer){ccPayer=b.dataset.payer;play("tap");drawCard();return}
  if(b.dataset.dice){ccDice=+b.dataset.dice;play("tap");drawCard();return}
  const k=b.dataset.cc;if(!k)return;
  ccDo(k);

});

/* ---- trocas entre jogadores ---- */
const cardChip=(id,attr,on)=>{const c=CARDS[id];return `<button type="button" class="tchip" ${attr}="${id}" aria-pressed="${on}"><i style="background:${c.acao?"#3a3a46":c.cor}"></i>${esc(c.nome)}</button>`};
function tpValor(){const v=Math.abs(tp.val||0);return tp.dir==="recebo"?v:tp.dir==="pago"?-v:0}
function tpSummary(c,t,D){
  const mine=t.dono===L.me,other=mine?tp.para:t.dono,give=mine?c.id:tp.give,get=mine?tp.get:c.id,v=tpValor();
  if(!other)return"";
  const g=[give?CARDS[give].nome:null,v<0?money(-v):null].filter(Boolean).join(" + ")||"nada";
  const r=[get?CARDS[get].nome:null,v>0?money(v):null].filter(Boolean).join(" + ")||"nada";
  return `Você entrega: <b>${esc(g)}</b><br>Você recebe: <b>${esc(r)}</b>`;
}
function tradeTile(c,t,D){
  if(!t.dono||!L.me||!D.P[L.me])return"";
  const mine=t.dono===L.me;
  const open=Object.values(D.Tr).find(x=>x.status==="aberta"&&x.de===L.me&&(x.carta_de===c.id||x.carta_para===c.id));
  if(open)return `<div class="ctile"><h4>Proposta de troca enviada</h4><p class="ccnote">Esperando ${esc(nameOf(open.para,D))} responder.</p><button class="btn ghost small" type="button" data-tcancel="${esc(open.id)}">Cancelar proposta</button></div>`;
  const others=playersArr(D).filter(p=>p.id!==L.me);if(!others.length)return"";
  const myCards=Object.values(D.Tit).filter(x=>x.dono===L.me&&x.carta!==c.id).map(x=>x.carta);
  let h=`<div class="ctile"><h4>${mine?"Trocar por carta de outro jogador":"Quero esta carta · propor a "+esc(shortName(owner(D,t).nome))}</h4><p class="ccnote">Carta por carta, com ou sem volta em dinheiro. A outra pessoa aceita no celular dela.</p>`;
  if(mine){
    if(tp.para&&!D.P[tp.para])tp.para=null;
    h+=`<div class="fchips">${others.map(p=>`<button type="button" data-tpara="${esc(p.id)}" aria-pressed="${tp.para===p.id}">${avatar(p,"sm")}${esc(shortName(p.nome))}</button>`).join("")}</div>`;
    if(!tp.para)return h+`<p class="ccnote">Escolha com quem negociar.</p></div>`;
    const theirs=Object.values(D.Tit).filter(x=>x.dono===tp.para).map(x=>x.carta);
    h+=`<p class="tlab">Em troca, ${esc(shortName(nameOf(tp.para,D)))} te dá alguma carta?</p><div class="fchips"><button type="button" class="tchip" data-tget="" aria-pressed="${!tp.get}">Nenhuma</button>${theirs.map(id=>cardChip(id,"data-tget",tp.get===id)).join("")}</div>`;
  }else{
    h+=`<p class="tlab">Você dá alguma carta sua?</p><div class="fchips"><button type="button" class="tchip" data-tgive="" aria-pressed="${!tp.give}">Nenhuma</button>${myCards.map(id=>cardChip(id,"data-tgive",tp.give===id)).join("")}</div>`;
  }
  h+=`<p class="tlab">Tem volta em dinheiro?</p><div class="seg tseg"><button type="button" data-tdir="nada" aria-pressed="${tp.dir==="nada"}">Sem volta</button><button type="button" data-tdir="recebo" aria-pressed="${tp.dir==="recebo"}">Eu recebo</button><button type="button" data-tdir="pago" aria-pressed="${tp.dir==="pago"}">Eu dou</button></div>`;
  if(tp.dir!=="nada")h+=`<input class="amount tval" id="tpVal" inputmode="numeric" autocomplete="off" placeholder="$ 0" value="${tp.val?"$ "+tp.val.toLocaleString("pt-BR"):""}"><div class="fchips">${[50000,100000,200000,500000].map(v=>`<button type="button" data-tadd="${v}">+${short(v)}</button>`).join("")}<button type="button" data-tadd="0">Limpar</button></div>`;
  const other=mine?tp.para:t.dono;
  h+=`<p class="tsum" id="tpSum">${tpSummary(c,t,D)}</p>`;
  h+=`<div class="slide trade" data-sl="propor"><div class="sl-fill"></div><span class="sl-txt">Arraste para propor a ${esc(shortName(nameOf(other,D)))}<small>a pessoa aceita no celular dela</small></span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div></div>`;
  return h;
}
function owner(D,t){return D.P[t.dono]||{nome:"?"}}
function ccDo(k,to){
  const c=CARDS[cdCard],D=derive(),t=D.Tit[c.id]||blankTit(c.id);
  if(k==="propor"){
    const mine=t.dono===L.me,para=mine?tp.para:t.dono;if(!para)return;
    if(tp.dir!=="nada"&&!tp.val){toast("Digite o valor da volta ou escolha Sem volta.");play("err");drawCard();return}
    trocaOp("propor",{para,carta_de:mine?c.id:(tp.give||null),carta_para:mine?(tp.get||null):c.id,valor:tpValor()});
    play("ask");toast(`Proposta enviada a ${nameOf(para,D)}`);tp={dir:"nada",val:0};drawCard();return;
  }
  if(k==="cobrar"){
    const v=rentOf(c,t,ccDice);if(!ccPayer||!v)return;
    const r=lancar(ccPayer,t.dono,v,("Aluguel: "+c.nome).slice(0,40));
    if(r.status==="pendente"){play("ask");toast(`Cobrança enviada: ${nameOf(ccPayer,D)} confirma ${money(v)} no celular`,{label:"Cancelar",run:()=>estornar(r.id)})}
    else{play("pay");toast(`${nameOf(ccPayer,D)} pagou ${money(v)} de aluguel para ${nameOf(t.dono,D)}`,{label:"Desfazer",run:()=>estornar(r.id)})}
    ccPayer=null;ccDice=0;drawCard();return;
  }
  if(k==="pagar_aluguel"){
    const v=rentOf(c,t,ccDice);if(!t.dono||t.dono===L.me||!v)return;
    const before=balances(D)[L.me];
    const r=lancar(L.me,t.dono,v,("Aluguel: "+c.nome).slice(0,40));
    play(before>=v?"pay":"broke");flashCard();
    toast(`Você pagou ${money(v)} de aluguel para ${nameOf(t.dono,D)}`,{label:"Desfazer",run:()=>estornar(r.id)});
    ccDice=0;closeCard();return;
  }
  if(k==="vender"){
    if(!to)return;const pr=ccSalePrice===""?c.preco:parseAmt(ccSalePrice);
    titOp(c.id,"vender",to,pr||0);play("pay");toast(`${c.nome} oferecida a ${nameOf(to,D)} por ${money(pr||0)}. Esperando confirmar.`);ccSale=null;ccSalePrice="";drawCard();return}
  if(k==="aceitar_venda"){if(t.venda_para!==L.me)return;const pr=t.venda_preco||0,from=t.dono;titOp(c.id,"aceitar_venda",null,pr);play("go");flashCard();toast(`Você comprou ${c.nome} de ${nameOf(from,D)}${pr?" por "+money(pr):""}!`);drawCard();return}
  if(k==="pedir"){titOp(c.id,"pedir");play("ask");toast(`Pedido enviado. Esperando o banqueiro autorizar.`);drawCard();return}
  if(k==="autorizar"){if(!t.pedido)return;const who=t.pedido;titOp(c.id,"comprar",who);play("go");toast(`Compra autorizada: ${c.nome} para ${nameOf(who,D)}`);drawCard();return}
  if(k==="ofertar"){if(!to)return;titOp(c.id,"ofertar",to);play("pay");toast(`${c.nome} oferecida a ${nameOf(to,D)}. Esperando confirmar.`);drawCard();return}
  if(k==="construir"){
    const tgt=Math.max(t.casas+1,Math.min(5,ccBuild||t.casas+1)),n=tgt-t.casas;ccBuild=null;
    for(let i=0;i<n;i++)titOp(c.id,"construir");
    play("pay");toast(tgt===5?`Condomínio em ${c.nome}! Pago ${money(c.casa*n)}`:`${n} ${n===1?"casa construída":"casas construídas"} em ${c.nome} · ${money(c.casa*n)}`);
    drawCard();return;
  }
  if(k==="hipotecar_casas"){
    const free=t.casas-(t.casas_hip||0),n=Math.max(1,Math.min(free,ccHipN||1));if(free<1)return;ccHipN=null;
    titOp(c.id,"hipotecar_casas",null,n);play("recv");toast(`${n} ${n===1?"construção hipotecada":"construções hipotecadas"} em ${c.nome}: + ${money(n*houseHip(c))}`);drawCard();return}
  if(k==="resgatar_casas"){
    const n=t.casas_hip||0;if(!n)return;
    titOp(c.id,"resgatar_casas",null,n);play("pay");toast(`Hipoteca das casas de ${c.nome} paga: ${money(n*houseHip(c))}`);drawCard();return}
  titOp(c.id,k);
  if(k==="comprar"){play("go");toast(`Você comprou ${c.nome}!`);flashCard()}
  else if(k==="hipotecar"){play("recv");toast(`${c.nome} hipotecada: + ${money(c.hip)}`)}
  else if(k==="resgatar"){play("pay");toast(`Hipoteca de ${c.nome} paga`)}
  else if(k==="devolver"){play("undo");toast(`${c.nome} voltou para o banco`)}
  else play("tap");
  drawCard();
}
/* slide-to-confirm: drag the knob to the end */
var slState=null;
document.addEventListener("pointerdown",e=>{
  const k=e.target.closest(".sl-knob");if(!k)return;
  const sl=k.closest(".slide");if(!sl||sl.classList.contains("done"))return;
  e.preventDefault();
  const r=sl.getBoundingClientRect(),kw=k.offsetWidth;
  slState={sl,k,x0:e.clientX,max:r.width-kw-8,dx:0};sl.classList.add("drag");
  try{k.setPointerCapture(e.pointerId)}catch(err){}
});
document.addEventListener("pointermove",e=>{
  if(!slState)return;
  const s2=slState;s2.dx=Math.max(0,Math.min(s2.max,e.clientX-s2.x0));
  s2.k.style.transform=`translateX(${s2.dx}px)`;s2.sl.querySelector(".sl-fill").style.width=(s2.dx+s2.k.offsetWidth+4)+"px";
  s2.sl.classList.toggle("near",s2.dx>s2.max*.85);
});
function slEnd(){
  if(!slState)return;const s2=slState;slState=null;s2.sl.classList.remove("drag","near");
  if(s2.dx>=s2.max*.85){
    s2.k.style.transform=`translateX(${s2.max}px)`;s2.sl.querySelector(".sl-fill").style.width="100%";s2.sl.classList.add("done");
    try{navigator.vibrate&&navigator.vibrate(30)}catch(err){}
    const act=s2.sl.dataset.sl,to=s2.sl.dataset.to;
    for(let el=s2.sl;el;el=el.parentElement)if(el._h!==undefined)el._h=null;
    setTimeout(()=>{if(s2.sl.closest("#offerIn"))offerDo(act);else if(s2.sl.closest("#scBody"))scoreDo(act);else if(s2.sl.closest("#b3Land"))landDo(act);else ccDo(act,to)},180);
  }else{
    s2.k.style.transition="transform .25s";s2.sl.querySelector(".sl-fill").style.transition="width .25s";
    s2.k.style.transform="";s2.sl.querySelector(".sl-fill").style.width="";
    setTimeout(()=>{s2.k.style.transition="";s2.sl.querySelector(".sl-fill").style.transition=""},260);
  }
}
document.addEventListener("pointerup",slEnd);document.addEventListener("pointercancel",slEnd);
document.addEventListener("touchmove",e=>{if(slState)e.preventDefault()},{passive:false});

/* someone offered me a card: confirm on my phone */
let offerShown=null,offerKind=null;var offerTrade=null,offerBill=null;const reqSnooze=new Set(),billSnooze=new Set();
function drawOffer(D){
  const box=$("#offerBox");
  const bill=L&&L.me?txArr(D).filter(t=>t.status==="pendente"&&t.de===L.me&&t.lancado_por!==L.me&&!t.pend&&!billSnooze.has(t.id)).sort((a,b)=>tms(a.feito_em)-tms(b.feito_em))[0]:null;
  if(bill){
    const key="b"+bill.id;if(offerShown===key&&!box.hidden)return;
    offerShown=key;offerKind="cobranca";offerBill=bill.id;offerTrade=null;
    const from=D.P[bill.para],bal=balances(D)[L.me]||0;
    $("#offerIn").innerHTML=`<div class="ccband" style="--gc:#C8432B"><div><b>Cobrança</b><small>${esc(bill.motivo||"sem motivo")}</small></div></div>
      <div class="obody"><p class="oreq">${from?avatar(from):""}<span><b>${esc(nameOf(bill.para,D))}</b> está te cobrando${bill.lancado_por!==bill.para?` (lançado por ${esc(shortName(nameOf(bill.lancado_por,D)))})`:""}</span></p><div class="oprice">${money(bill.valor)}</div>
      <p>Seu saldo: ${money(bal)}${bill.valor>bal?" · vai ficar negativo":""}</p>
      <div class="slide pay" data-sl="pagar_cobranca"><div class="sl-fill"></div><span class="sl-txt">Arraste para pagar</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>
      <div class="obtns"><button class="btn ghost small" data-of="recusar_cobranca" type="button">Recusar</button><button class="btn ghost small" data-of="depois_cobranca" type="button">Depois</button></div></div>`;
    box.hidden=false;return;
  }
  offerBill=null;
  const mine=L&&L.me?Object.values(D.Tit).find(t=>t.oferta===L.me&&!t.dono):null;
  const sale=!mine&&L&&L.me?Object.values(D.Tit).find(t=>t.venda_para===L.me&&t.dono&&t.dono!==L.me):null;
  if(sale){
    const c=CARDS[sale.carta],key="v"+c.id+":"+sale.venda_preco;
    if(offerShown===key&&!box.hidden)return;
    offerShown=key;offerKind="venda";offerTrade=null;
    const from=D.P[sale.dono]||{nome:"?"},bal=balances(D)[L.me]||0,pr=sale.venda_preco||0;
    $("#offerIn").innerHTML=`<div class="ccband" style="--gc:${c.acao?"#2A2A33":c.cor}"><div><b>${esc(c.nome)}</b><small>${esc(c.pais)}</small></div></div>
      <div class="obody"><p class="oreq">${avatar(from)}<span><b>${esc(from.nome)}</b> quer te vender esta carta</span></p><div class="oprice">${money(pr)}</div>
      <p>${sale.casas>=5?"Com condomínio · ":sale.casas?`Com ${sale.casas} ${sale.casas>1?"casas":"casa"} · `:""}${sale.hipotecada?"Hipotecada · ":""}${c.acao?`Aluguel: dados × ${money(c.mult)}`:`Aluguel agora: ${money(c.al[sale.casas||0])}`}${pr>bal?"<br>Seu saldo vai ficar negativo":""}</p>
      <div class="slide buy" data-sl="aceitar_venda"><div class="sl-fill"></div><span class="sl-txt">Arraste para comprar</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>
      <button class="btn ghost small" data-of="recusar" type="button">Não quero</button></div>`;
    box.hidden=false;return;
  }
  if(!mine){
    const req=L&&L.me&&iAmBanker()?Object.values(D.Tit).find(t=>t.pedido&&!t.dono&&t.pedido!==L.me&&D.P[t.pedido]&&!reqSnooze.has(t.carta+":"+t.pedido)):null;
    if(!req){
    const tr=L&&L.me?Object.values(D.Tr).filter(x=>x.status==="aberta"&&x.para===L.me&&!x.pend).sort((a,b)=>tms(a.criada_em)-tms(b.criada_em))[0]:null;
      if(tr){
      if(offerTrade===tr.id&&!box.hidden)return;
      offerTrade=tr.id;offerShown=null;offerKind="troca";
      const card=id=>{const c=CARDS[id];return `<span class="tcard" style="--gc:${c.acao?"#3a3a46":c.cor}"><b>${esc(c.nome)}</b><small>${esc(c.pais)}</small></span>`};
      const get=[tr.carta_de?card(tr.carta_de):"",tr.valor<0?`<span class="tmoney">+ ${money(-tr.valor)}</span>`:""].join("")||'<span class="tmoney none">nada</span>';
      const give=[tr.carta_para?card(tr.carta_para):"",tr.valor>0?`<span class="tmoney">${money(tr.valor)}</span>`:""].join("")||'<span class="tmoney none">nada</span>';
      $("#offerIn").innerHTML=`<div class="ccband" style="--gc:#6E3CA8"><div><b>Proposta de troca</b><small>de ${esc(nameOf(tr.de,D))}</small></div></div>
        <div class="obody"><div class="tswap"><div><h5>Você recebe</h5>${get}</div><div><h5>Você entrega</h5>${give}</div></div>
        <div class="slide trade" data-sl="aceitar"><div class="sl-fill"></div><span class="sl-txt">Arraste para aceitar a troca</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>
        <button class="btn ghost small" data-of="recusar_troca">Recusar</button></div>`;
      box.hidden=false;return;}
      box.hidden=true;offerShown=null;offerKind=null;offerTrade=null;return}
    const c=CARDS[req.carta],p=D.P[req.pedido],key="r"+c.id+":"+req.pedido;
    if(offerShown===key&&!box.hidden)return;
    offerShown=key;offerKind="pedido";offerTrade=null;
    const bal=balances(D)[req.pedido];
    $("#offerIn").innerHTML=`<div class="ccband" style="--gc:${c.acao?"#2A2A33":c.cor}"><div><b>${esc(c.nome)}</b><small>${esc(c.pais)}</small></div></div>
      <div class="obody"><p class="oreq">${avatar(p)}<span><b>${esc(p.nome)}</b> quer comprar esta carta</span></p><div class="oprice">${money(c.preco)}</div>
      <p>Saldo de ${esc(shortName(p.nome))}: ${money(bal||0)}${(bal||0)<c.preco?" · vai ficar negativo":""}</p>
      <div class="slide buy" data-sl="autorizar"><div class="sl-fill"></div><span class="sl-txt">Arraste para autorizar</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>
      <div class="obtns"><button class="btn ghost small" data-of="recusar" type="button">Recusar</button><button class="btn ghost small" data-of="depois" type="button">Depois</button></div></div>`;
    box.hidden=false;return;
  }
  offerTrade=null;
  const c=CARDS[mine.carta];
  if(offerShown===c.id&&!box.hidden)return;
  offerShown=c.id;offerKind="oferta";
  $("#offerIn").innerHTML=`<div class="ccband" style="--gc:${c.acao?"#2A2A33":c.cor}"><div><b>${esc(c.nome)}</b><small>${esc(c.pais)}</small></div></div>
    <div class="obody"><p>O banqueiro está te vendendo essa carta.</p><div class="oprice">${money(c.preco)}</div>
    <p>${c.acao?`Aluguel: soma dos dados × ${money(c.mult)}`:`Aluguel sem casa: ${money(c.al[0])}`}</p>
    <div class="slide buy" data-sl="comprar"><div class="sl-fill"></div><span class="sl-txt">Arraste para comprar</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>
    <button class="btn ghost small" data-of="recusar">Não quero</button></div>`;
  box.hidden=false;
}
function offerDo(k){
  if(offerKind==="cobranca"&&offerBill){const id=offerBill;offerBill=null;offerShown=null;offerKind=null;$("#offerBox").hidden=true;
    if(k==="pagar_cobranca")decide(id,true);else if(k==="recusar_cobranca")decide(id,false);else{billSnooze.add(id);play("tap");toast("A cobrança fica no topo da tela inicial.")}
    render();return}
  if(offerKind==="troca"&&offerTrade&&(k==="aceitar"||k==="recusar_troca")){const id=offerTrade;offerTrade=null;$("#offerBox").hidden=true;offerKind=null;
    if(k==="aceitar"){trocaOp("aceitar",{id});play("go");flashCard();toast("Troca feita!")}else{trocaOp("recusar",{id});play("undo");toast("Troca recusada")}return}
  if(offerKind==="venda"){
    const D=derive(),t=Object.values(D.Tit).find(x=>x.venda_para===L.me&&x.dono);$("#offerBox").hidden=true;offerShown=null;
    if(!t){render();return}
    const c=CARDS[t.carta],pr=t.venda_preco||0,from=t.dono;
    if(k==="aceitar_venda"){titOp(t.carta,"aceitar_venda",null,pr);play("go");flashCard();toast(`Você comprou ${c.nome} de ${nameOf(from,D)}${pr?" por "+money(pr):""}!`)}
    else{titOp(t.carta,"recusar");play("undo");toast("Compra recusada")}
    return;
  }
  if(offerKind==="pedido"){
    const D=derive(),t=Object.values(D.Tit).find(x=>x.pedido&&!x.dono&&("r"+x.carta+":"+x.pedido)===offerShown);
    $("#offerBox").hidden=true;offerShown=null;
    if(!t){render();return}
    const c=CARDS[t.carta];
    if(k==="autorizar"){titOp(t.carta,"comprar",t.pedido);play("go");toast(`Compra autorizada: ${c.nome} para ${nameOf(t.pedido,D)}`)}
    else if(k==="recusar"){titOp(t.carta,"recusar");play("undo");toast(`Pedido de ${nameOf(t.pedido,D)} recusado`)}
    else{reqSnooze.add(t.carta+":"+t.pedido);play("tap");toast("O pedido fica na carta. Abra a carta para autorizar depois.");render()}
    return;
  }
  const t=Object.values(derive().Tit).find(x=>x.oferta===L.me&&!x.dono);if(!t)return;
  const c=CARDS[t.carta];
  titOp(t.carta,k);$("#offerBox").hidden=true;
  if(k==="comprar"){play("go");flashCard();toast(`Você comprou ${c.nome}!`)}else{play("undo");toast("Compra recusada")}
}
$("#offerBox").addEventListener("click",e=>{
  const b=e.target.closest("[data-of]");if(!b)return;offerDo(b.dataset.of);
});
/* ================= PLACAR: patrimônio e fim de jogo ================= */
/* patrimônio = saldo + cartas (preço; hipotecada vale preço − hipoteca) + casas (preço de cada casa; condomínio = 5) */
function worth(D,id,bal){
  let cards=0,houses=0,n=0,nh=0;
  for(const t of Object.values(D.Tit)){
    if(t.dono!==id)continue;const c=CARDS[t.carta];if(!c)continue;
    n++;cards+=c.preco-(t.hipotecada?c.hip:0);houses+=(t.casas||0)*(c.casa||0)-(t.casas_hip||0)*houseHip(c);nh+=t.casas||0;
  }
  return{saldo:bal,cards,houses,n,nh,total:bal+cards+houses};
}
function scoreList(D,reveal){
  const bal=balances(D),canHide=!L.mesa||L.mesa.esconder!==false;
  return playersArr(D).map(p=>{const w=worth(D,p.id,bal[p.id]||0);w.p=p;w.hid=!reveal&&canHide&&p.oculto&&p.id!==L.me;return w})
    .sort((a,b)=>(a.hid-b.hid)||(b.total-a.total));
}
function openScore(){closeSheets();$("#scrim").hidden=false;$("#scoreSheet").hidden=false;$("#scBody").scrollTop=0;drawScore();play("tap")}
function drawScore(){
  if($("#scoreSheet").hidden||(slState&&slState.sl&&slState.sl.closest("#scBody")))return;
  const D=derive(),end=isEnded(),list=scoreList(D,end),boss=iAmBanker();
  $("#scSub").textContent=end?"Partida encerrada · resultado final":"Saldo + cartas + casas";
  let h=list.map((w,i)=>`<div class="scrow${i===0&&!w.hid?" p1":""}${!w.hid&&w.total<0?" neg":""}"><span class="pos">${w.hid?"—":i+1}</span>${avatar(w.p)}<span class="nmx"><b>${esc(w.p.nome)}${w.p.id===L.me?" (você)":""}</b><small>${w.hid?"Saldo oculto":"Saldo "+fmt(w.saldo)} · ${w.n} ${w.n===1?"carta":"cartas"} ${money(w.cards)}${w.nh?` · casas ${money(w.houses)}`:""}</small></span><span class="tot">${w.hid?MASK:fmt(w.total)}<small>patrimônio</small></span></div>`).join("");
  h+=`<p class="scnote">Cartas valem o preço de compra (hipotecada vale o preço menos a hipoteca). Cada casa vale o que custou para construir (hipotecada vale metade); o condomínio vale 5 casas.</p>`;
  if(boss)h+=`<div class="ctile"><h4>Banqueiro</h4>${end?`<button class="btn ghost small" data-sc="reabrir" type="button">Reabrir a partida</button>`:`<div class="slide danger" data-sl="encerrar"><div class="sl-fill"></div><span class="sl-txt">Arraste para encerrar a partida<small>Todos veem o resultado final</small></span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>`}</div>`;
  else if(end)h+=`<button class="btn small" data-sc="final" type="button">Ver o pódio</button>`;
  $("#scBody").innerHTML=h;
}
function scoreDo(k){
  if(k==="encerrar"&&iAmBanker()){enqueue({t:"encerrar",encerrada:true,por:L.me,em:nowIso()});play("go");closeSheets();finalAuto=null;render()}
}
$("#scBody").addEventListener("click",e=>{const b=e.target.closest("[data-sc]");if(!b)return;
  if(b.dataset.sc==="reabrir"){enqueue({t:"encerrar",encerrada:false,por:L.me,em:nowIso()});play("undo");toast("Partida reaberta");drawScore()}
  else if(b.dataset.sc==="final"){closeSheets();showFinal()}});
$("#scClose").onclick=closeSheets;
$("#aScore").onclick=openScore;
var finalAuto=null;
function showFinal(){
  const D=derive(),list=scoreList(D,true),top=list.slice(0,3),rest=list.slice(3);
  const pod=(w,k)=>w?`<div class="pod p${k}">${k===1?'<span class="crown">👑</span>':""}${avatar(w.p)}<b>${esc(shortName(w.p.nome))}</b><small>${fmt(w.total)}</small><div class="step">${k}</div></div>`:`<div class="pod p${k}"></div>`;
  $("#finalIn").innerHTML=`<h2 id="fnTitle">${top[0]?esc(top[0].p.nome)+" venceu!":"Fim de jogo"}</h2><p class="fsub">Resultado pelo patrimônio: saldo + cartas + casas</p>
    <div class="podium">${pod(top[1],2)}${pod(top[0],1)}${pod(top[2],3)}</div>
    ${rest.length?`<div class="finalrest">${rest.map((w,i)=>`<div><span>${i+4}º ${esc(w.p.nome)}</span><span>${fmt(w.total)}</span></div>`).join("")}</div>`:""}
    <button class="btn" id="finalClose" type="button">Ver a mesa</button>`;
  $("#final").hidden=false;play("go");
  $("#finalClose").onclick=()=>{$("#final").hidden=true;play("tap")};
}
$("#endShow").onclick=showFinal;
function isEnded(){if(!L||!L.mesa)return false;let e=!!L.mesa.encerrada;for(const op of L.out)if(op.t==="encerrar")e=op.encerrada;return e}
function drawEnd(){
  const end=isEnded();
  $("#endBanner").hidden=!end;
  if(end&&finalAuto!==L.codigo){finalAuto=L.codigo;setTimeout(showFinal,200)}
  if(!end){finalAuto=null;$("#final").hidden=true}
  drawScore();
}

/* ================= TABULEIRO 3D (CSS 3D, sem bibliotecas) ================= */
/* ---------- onde cada um está, dados e onde vai parar ---------- */
const PAWN_SVG='<svg viewBox="0 0 40 62" aria-hidden="true"><path class="pc" d="M6 55c0-3 4-4.5 14-4.5S34 52 34 55v2c0 3-5 4.5-14 4.5S6 60 6 57zM15 25c0 10-5 17-5.5 25.5h21C30 42 25 35 25 25zM10.5 24.5c0-2 4-3 9.5-3s9.5 1 9.5 3-4 3-9.5 3-9.5-1-9.5-3zM20 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z"/><ellipse cx="16" cy="9" rx="3" ry="4" fill="#fff" fill-opacity=".55"/></svg>';
function sqName(i){const q=BOARD[i];if(!q)return"?";if(q.c)return q.c;if(q.id)return CARDS[q.id].nome;return /FMI/.test(q.s)?(/Restitui/.test(q.s)?"Restituição do FMI":"Dívidas FMI"):"Sorte ou Revés"}
function sqColor(i){const q=BOARD[i];if(!q)return"#ddd";if(q.id)return CARDS[q.id].acao?"#3a3a46":CARDS[q.id].cor;if(q.c)return q.k.includes("cadeia")?"#FF8A5B":q.k.includes("ferias")?"#46D3D9":q.k.includes("vai")?"#B48CFF":"#FF9A1F";return /FMI/.test(q.s)?"#1d1c23":"#e9e9ee"}
function posMap(){return(L&&L.pos)||{}}
function myPos(){const p=posMap()[L&&L.me];return typeof p==="number"?p:0}
let posLast=0;
function posSend(reply){if(!bumpCh||!bumpCh.sendPos||!L||!L.me)return;const p=posMap()[L.me];if(typeof p!=="number")return;posLast=Date.now();bumpCh.sendPos({id:L.me,mesa:L.codigo,pos:p,reply:!!reply})}
function posIn(m){
  if(!L||!m||!m.id||m.id===L.me||(m.mesa&&m.mesa!==L.codigo)||typeof m.pos!=="number"||m.pos<0||m.pos>39)return;
  L.pos=L.pos||{};const changed=L.pos[m.id]!==m.pos;L.pos[m.id]=m.pos;save();
  if(!m.reply&&Date.now()-posLast>3000)posSend(true);
  if(changed&&!$("#b3d").hidden&&!b3.ptrs.size)drawBoard3d();
  if(changed&&!$("#cardsSheet").hidden&&!b3.ptrs.size&&!b3full())drawBoard3d();
}
function setMyPos(i,announce){if(!L||!L.me)return;L.pos=L.pos||{};L.pos[L.me]=i;b3.land=null;save();if(announce!==false)posSend(false);if(!$("#b3d").hidden||!$("#cardsSheet").hidden)drawBoard3d();if(!$("#diceSheet").hidden)drawDice()}
function pawnsAt(i,D,w,ht,p){
  const who=Object.entries(posMap()).filter(([id,q])=>q===i&&D.P[id]&&!D.P[id].removido);if(!who.length)return"";
  who.sort((a,b)=>(a[0]===L.me)-(b[0]===L.me));
  const n=who.length,sp=Math.min(16,(Math.min(w,ht)-14)/Math.max(1,n-1));
  return `<div class="b3pawns" style="transform:translateZ(4px)">${who.map(([id],k)=>{const off=(k-(n-1)/2)*sp,ox=p.inx?0:off,oy=p.iny?0:off,ix=-p.inx*Math.max(w,ht)*.12,iy=-p.iny*Math.max(w,ht)*.12;
    return `<div class="b3pw${id===L.me?" me":""}" data-off="translate(${(ox+ix).toFixed(1)}px,${(oy+iy).toFixed(1)}px)" style="--pc:${colorOf(D.P[id].cor).c}">${PAWN_SVG}</div>`}).join("")}</div>`;
}
function b3pickStart(){b3.pick=true;$("#b3PickBar").hidden=false;$("#b3dStage").classList.add("picking");const b=document.querySelector('.b3dtools [data-v="here"]');if(b)b.setAttribute("aria-pressed","true")}
function b3pickEnd(silent){b3.pick=false;const bar=$("#b3PickBar");if(bar)bar.hidden=true;$("#b3dStage").classList.remove("picking");const b=document.querySelector('.b3dtools [data-v="here"]');if(b)b.setAttribute("aria-pressed","false")}
$("#b3PickCancel").onclick=()=>{b3pickEnd();play("tap")};
/* dice */
var DC={d1:0,d2:0,sum:0,rolling:false};
function openDice(){closeSheets();DC={d1:0,d2:0,sum:0,rolling:false};b3.land=null;$("#scrim").hidden=false;$("#diceSheet").hidden=false;$("#b3Land").scrollTop=0;drawDice();play("tap")}
function landInfo(from,n){
  const raw=from+n,passGo=raw>=40,to=raw%40,path=[];for(let k=1;k<n;k++)path.push((from+k)%40);
  return{from,to,n,passGo,path,sq:BOARD[to]};
}
function drawDice(){
  if($("#diceSheet").hidden)return;
  if(slState&&slState.sl&&slState.sl.closest("#b3Land"))return;
  const D=derive(),me=L.me,from=myPos(),pips='<i></i>'.repeat(9);
  let h=`<div class="dhere" style="--tc:${sqColor(from)}"><span class="sw"></span><div><small>Você está em</small><b>${esc(sqName(from))}</b></div><button type="button" data-dc="pick">Mudar</button></div>`;
  h+=`<div class="dicebox"><div class="dicepair${DC.rolling?" rolling":""}"><div class="die v${DC.d1}">${pips}</div><div class="die v${DC.d2}">${pips}</div></div>
    ${DC.sum&&!DC.rolling&&DC.d1?`<div class="dsum">${DC.d1&&DC.d2?`${DC.d1} + ${DC.d2} = `:""}${DC.sum}${DC.d1&&DC.d1===DC.d2?" · dupla!":""}</div>`:""}
    <button class="btn" type="button" data-dc="roll"${DC.rolling?" disabled":""}>${DC.sum?"Rolar de novo":"Rolar os dados"}</button></div>`;
  const row=k=>`<div class="dnrow"><span>${k}º dado</span><div class="dsix">${[1,2,3,4,5,6].map(n=>`<button type="button" data-dk="${k}" data-dv="${n}" aria-pressed="${!DC.rolling&&DC["d"+k]===n}">${n}</button>`).join("")}</div></div>`;
  h+=`<div class="dnums"><h4>Ou marque o que saiu nos dados da mesa</h4>${row(1)}${row(2)}</div>`;
  if(DC.sum&&!DC.rolling){
    const li=landInfo(from,DC.sum),q=li.sq;
    let title=sqName(li.to),sub="",info="",acts="";
    const goNote=li.passGo?`<b>Passou pela partida:</b> + ${money(L.mesa.salario)}. `:"";
    if(q.id){
      const c=CARDS[q.id],t=D.Tit[c.id]||blankTit(c.id),own=t.dono&&D.P[t.dono];
      sub=c.pais;
      if(!t.dono){info=`${goNote}Livre no banco por <b>${money(c.preco)}</b>.`;acts=iAmBanker()?slideHTML("buy_land","Arraste para comprar",`${money(c.preco)} ao banco`,"buy"):(t.pedido&&t.pedido!==me?"":slideHTML("ask_land","Arraste para pedir a compra",`${money(c.preco)} · o banqueiro autoriza`,"buy"))}
      else if(t.dono===me)info=`${goNote}Essa é sua. Não paga nada.`;
      else if(t.hipotecada)info=`${goNote}De ${esc(own.nome)}, mas está hipotecada: não paga aluguel.`;
      else{const v=c.acao?DC.sum*c.mult:c.al[rentLvl(t)];info=`${goNote}De <b>${esc(own.nome)}</b>. Aluguel: <b>${money(v)}</b>${c.acao?` (${DC.sum} × ${money(c.mult)})`:t.casas>=5?" com condomínio":t.casas?` com ${t.casas} ${t.casas>1?"casas":"casa"}`:""}.`;acts=slideHTML("rent_land",`Arraste: pagar ${money(v)} a ${esc(shortName(own.nome))}`,"Aluguel de "+esc(c.nome),"rent")}
    }else if(q.c==="Vá para a cadeia"){info=`Vai para a <b>Cadeia</b>! Não recebe a partida.`}
    else if(q.c==="Cadeia")info=`${goNote}Só visitando a cadeia.`;
    else if(q.c==="Férias")info=`${goNote}Férias! Descanse um pouco.`;
    else if(q.c==="Início")info=`Caiu no Início: + ${money(L.mesa.salario)}.`;
    else if(/FMI/.test(q.s))info=`${goNote}${/Restitui/.test(q.s)?"Restituição do FMI: o banco paga 2000× a soma dos dados.":"Dívidas FMI: paga 2000× a soma dos dados ao banco."}`;
    else info=`${goNote}Pegue uma carta de <b>Sorte ou Revés</b> na mesa.`;
    const salaryAct=(li.passGo||li.to===0)&&q.c!=="Vá para a cadeia"?slideHTML("go_land","Arraste para receber a partida","+ "+money(L.mesa.salario),"pay"):"";
    h+=`<div class="dland"><div class="lt"><span class="sw" style="--tc:${sqColor(li.to)}">${li.n}</span><div><small>Andando ${li.n} ${li.n===1?"casa":"casas"}, você para em</small><b>${esc(title)}</b>${sub?`<em>${esc(sub)}</em>`:""}</div></div>
      <p class="dinfo">${info}</p>
      <div class="dbtns"><button class="btn ghost" type="button" data-dc="see">Ver no tabuleiro</button><button class="btn" type="button" data-dc="move">Andar até lá</button></div>
      ${salaryAct}${acts}</div>`;
  }
  $("#b3Land").innerHTML=h;
}
function slideHTML(act,label,sub,tone){return `<div class="slide ${tone||""}" data-sl="${act}"><div class="sl-fill"></div><span class="sl-txt">${label}${sub?`<small>${sub}</small>`:""}</span><div class="sl-knob"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></div></div>`}
function moveToLanding(){
  if(!DC.sum)return null;const li=landInfo(myPos(),DC.sum);
  const dest=BOARD[li.to]&&BOARD[li.to].c==="Vá para a cadeia"?10:li.to;
  setMyPos(dest);return li;
}
function landDo(k){
  const D=derive(),li=landInfo(myPos(),DC.sum),q=li.sq;
  if(k==="go_land"){doSalary(L.me);drawDice();return}
  if(q.id){
    const c=CARDS[q.id],t=D.Tit[c.id]||blankTit(c.id);
    if(k==="rent_land"&&t.dono&&t.dono!==L.me){const v=c.acao?DC.sum*c.mult:c.al[rentLvl(t)];const r=lancar(L.me,t.dono,v,("Aluguel: "+c.nome).slice(0,40));play("pay");flashCard();toast(`Você pagou ${money(v)} de aluguel a ${nameOf(t.dono,D)}`,{label:"Desfazer",run:()=>estornar(r.id)});moveToLanding();closeSheets();return}
    if(k==="buy_land"&&!t.dono){titOp(c.id,"comprar",L.me);play("go");flashCard();toast(`Você comprou ${c.nome}!`);moveToLanding();closeSheets();return}
    if(k==="ask_land"&&!t.dono){titOp(c.id,"pedir");play("ask");toast(`Pedido enviado: ${c.nome}. Esperando o banqueiro autorizar.`);moveToLanding();closeSheets();return}
  }
}
$("#b3Land").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.dk){if(DC.rolling)return;DC["d"+b.dataset.dk]=+b.dataset.dv;DC.sum=DC.d1&&DC.d2?DC.d1+DC.d2:0;play("tap");drawDice();return}
  const k=b.dataset.dc;if(!k)return;
  if(k==="roll"){
    if(DC.rolling)return;DC.rolling=true;DC.sum=0;play("tap");let n=0;
    const spin=()=>{DC.d1=1+Math.floor(Math.random()*6);DC.d2=1+Math.floor(Math.random()*6);n++;
      if(n<9){drawDice();tone(300+Math.random()*500,0,.04,"square",.05);setTimeout(spin,70)}
      else{DC.rolling=false;DC.sum=DC.d1+DC.d2;play(DC.d1===DC.d2?"go":"recv");try{navigator.vibrate&&navigator.vibrate(30)}catch(e){}drawDice()}};
    spin();return;
  }
  if(k==="pick"){closeSheets();openBoard3d();b3pickStart();return}
  if(k==="see"){const li=landInfo(myPos(),DC.sum);b3.land=li;closeSheets();openBoard3d();return}
  if(k==="move"){const li=moveToLanding();play("tap");if(li){toast(BOARD[li.to].c==="Vá para a cadeia"?"Foi para a cadeia!":"Você está em "+sqName(li.to));}closeSheets();return}
});
$("#dcClose").onclick=closeSheets;
$("#aDice").onclick=openDice;
const BOARD=[{c:"Início",k:"corner"},{id:7},{id:8},{id:27},{id:1},{id:9},{s:"Sorte ou Revés"},{id:10},{id:21},{id:11},
 {c:"Cadeia",k:"corner cadeia"},{s:"Sorte ou Revés"},{id:23},{id:24},{s:"Restituição do FMI · receba 2000×"},{id:17},{id:22},{id:18},{id:19},{id:13},
 {c:"Férias",k:"corner ferias"},{id:20},{id:25},{s:"Dívidas FMI · pague 2000×"},{s:"Sorte ou Revés"},{id:4},{id:3},{s:"Sorte ou Revés"},{id:2},{id:28},
 {c:"Vá para a cadeia",k:"corner vai"},{id:14},{s:"Sorte ou Revés"},{id:15},{id:16},{id:12},{id:26},{id:5},{s:"Sorte ou Revés"},{id:6}];
var b3={land:null,pick:false,yaw:-18,pitch:52,zoom:0,fit:1,hl:null,ptrs:new Map(),last:null,moved:0,t0:0};
const skyCache={};
function skyline(id){
  if(skyCache[id])return skyCache[id];
  let x=0,r=id*9301+49297,rnd=()=>((r=(r*9301+49297)%233280)/233280),h="";
  while(x<100){const w=6+rnd()*12,ht=25+rnd()*70;h+=`<rect x="${x.toFixed(1)}" y="${(100-ht).toFixed(1)}" width="${w.toFixed(1)}" height="${ht.toFixed(1)}"/>`;
    if(rnd()>.7)h+=`<rect x="${(x+w/2-1).toFixed(1)}" y="${(100-ht-12).toFixed(1)}" width="2" height="12"/>`;x+=w+rnd()*2}
  return skyCache[id]=`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><g fill='#000' fill-opacity='.5'>${h}</g></svg>`)}")`;
}
const CORNER_IC={
  "Início":'<svg viewBox="0 0 48 48"><path d="M36 14 14 36M14 18v18h18"/></svg>',
  "Cadeia":'<svg viewBox="0 0 48 48"><rect x="7" y="8" width="34" height="32" rx="4"/><path d="M15.5 8v32M24 8v32M32.5 8v32M7 24h34"/></svg>',
  "Férias":'<img src="status-ferias.svg" alt="">',
  "Vá para a cadeia":'<svg viewBox="0 0 48 48"><path d="M8 24h28M28 14l10 10-10 10"/></svg>'
};
function b3pos(i){
  if(i<=10)return{r:11,c:11-i,rot:0,inx:0,iny:-1};
  if(i<=20)return{r:11-(i-10),c:1,rot:1,inx:1,iny:0};
  if(i<=30)return{r:1,c:1+(i-20),rot:2,inx:0,iny:1};
  return{r:1+(i-30),c:11,rot:3,inx:-1,iny:0};
}
/* prédio 3D: cada casa é um andar a mais, empilhado; o condomínio vira uma torre */
function buildingHTML(x,y,floors,condo){
  const w=condo?22:18,d=condo?22:18,fh=condo?7:8,H=floors*fh;
  const f=(k,st)=>`<i class="${k}" style="${st}"></i>`;
  let s=`<div class="bld${condo?" condo":""}" style="left:${x-w/2}px;top:${y-d/2}px;width:${w}px;height:${d}px;--fh:${fh}px">`+
    `<i class="bsh" style="left:-3px;top:-3px;width:${w+6}px;height:${d+6}px"></i>`+
    f("wv",`left:0;top:0;width:${w}px;height:${H}px;transform-origin:0 0;transform:rotateX(90deg)`)+
    f("wv dk",`left:0;top:${d}px;width:${w}px;height:${H}px;transform-origin:0 0;transform:rotateX(90deg)`)+
    f("wh dk",`left:0;top:0;width:${H}px;height:${d}px;transform-origin:0 0;transform:rotateY(-90deg)`)+
    f("wh",`left:${w}px;top:0;width:${H}px;height:${d}px;transform-origin:0 0;transform:rotateY(-90deg)`);
  if(condo){
    s+=f("rf flat",`left:0;top:0;width:${w}px;height:${d}px;transform:translateZ(${H}px)`)+
      f("ant",`left:${w/2-1}px;top:${d/2}px;width:2px;height:11px;transform-origin:0 0;transform:translateZ(${H}px) rotateX(90deg)`)+
      f("ant",`left:${w/2}px;top:${d/2-1}px;width:11px;height:2px;transform-origin:0 0;transform:translateZ(${H}px) rotateY(-90deg)`)+
      f("lamp",`left:${w/2-2}px;top:${d/2-2}px;width:4px;height:4px;transform:translateZ(${H+11}px)`);
  }else{
    const rh=8,half=d/2,sl=Math.hypot(half,rh),ang=(Math.atan2(rh,half)*180/Math.PI).toFixed(2);
    s+=f("rf",`left:-2px;top:-1px;width:${w+4}px;height:${sl+1}px;transform-origin:50% 0;transform:translateZ(${H}px) rotateX(${ang}deg)`)+
      f("rf dk",`left:-2px;top:${d-sl}px;width:${w+4}px;height:${sl+1}px;transform-origin:50% 100%;transform:translateZ(${H}px) rotateX(${-ang}deg)`)+
      f("gb",`left:0;top:0;width:${rh}px;height:${d}px;transform-origin:0 0;transform:translateZ(${H}px) rotateY(-90deg)`)+
      f("gb",`left:${w}px;top:0;width:${rh}px;height:${d}px;transform-origin:0 0;transform:translateZ(${H}px) rotateY(-90deg)`);
  }
  return s+"</div>";
}
function cubeHTML(x,y,w,d,h,top,side,front){
  const f=(st)=>`<i style="${st}"></i>`;
  return `<div class="cube" style="left:${x-w/2}px;top:${y-d/2}px;width:${w}px;height:${d}px">`+
    f(`left:0;top:0;width:${w}px;height:${d}px;background:${top};transform:translateZ(${h}px)`)+
    f(`left:0;top:0;width:${w}px;height:${h}px;background:${side};transform-origin:0 0;transform:rotateX(90deg)`)+
    f(`left:0;top:${d}px;width:${w}px;height:${h}px;background:${front};transform-origin:0 0;transform:rotateX(90deg)`)+
    f(`left:0;top:0;width:${h}px;height:${d}px;background:${side};transform-origin:0 0;transform:rotateY(-90deg)`)+
    f(`left:${w}px;top:0;width:${h}px;height:${d}px;background:${front};transform-origin:0 0;transform:rotateY(-90deg)`)+`</div>`;
}
function drawBoard3d(){
  const D=derive(),fr=668/12.1,corner=fr*1.55;
  let h="";
  BOARD.forEach((sq,i)=>{
    const p=b3pos(i),w=(p.c===1||p.c===11)?corner:fr,ht=(p.r===1||p.r===11)?corner:fr;
    const style=`grid-row:${p.r};grid-column:${p.c};--w:${w}px;--h:${ht}px`;
    const lp=b3.land&&b3.land.to===i?" land":b3.land&&b3.land.path.includes(i)?" path":"",pw=pawnsAt(i,D,w,ht,p);
    if(sq.c){h+=`<div class="b3t ${sq.k} r${p.rot}${lp}" data-sq="${i}" style="${style}"><div class="b3in">${CORNER_IC[sq.c]||""}<span class="b3nm">${sq.c.toUpperCase()}</span></div>${pw}</div>`;return}
    if(sq.s&&/FMI/.test(sq.s)){const rec=/Restitui/.test(sq.s);h+=`<div class="b3t fmi r${p.rot}${lp}" data-sq="${i}" style="${style}"><div class="b3in"><span class="b3nm">${rec?"RESTITUIÇÃO DO FMI":"DÍVIDAS FMI"}<b>${rec?"RECEBA":"PAGUE"} 2000×</b></span></div>${pw}</div>`;return}
    if(sq.s){h+=`<div class="b3t sp r${p.rot}${lp}" data-sq="${i}" style="${style}"><div class="b3in"><span class="b3nm">SORTE<i>ou</i>REVÉS</span></div>${pw}</div>`;return}
    const c=CARDS[sq.id],t=D.Tit[c.id]||blankTit(c.id),own=t.dono&&D.P[t.dono];
    const oc=own?colorOf(own.cor).c:"";
    const hl=b3hl(),dim=hl&&(hl==="free"?!!t.dono:t.dono!==hl);
    let extra="";
    let floor="";
    if(own){
      const L2=Math.max(w,ht),S2=Math.min(w,ht),bx=-p.inx*L2*.25+p.iny*S2*.2,by=-p.iny*L2*.25-p.inx*S2*.2;
      const bld=t.casas>=5?buildingHTML(bx,by,6,true):t.casas>0?buildingHTML(bx,by,t.casas,false):"";
      const sparks=t.hipotecada?"":`<b style="--d:${-((c.id*37)%28)/10}s"></b><b style="--d:${-((c.id*53)%28)/10}s"></b><b style="--d:${-((c.id*71)%28)/10}s"></b>`;
      floor=`<span class="b3own">${avatar(own)}</span>`;
      extra=`<div class="b3aura"><i class="n"></i><i class="s"></i><i class="w"></i><i class="e"></i>${sparks}</div><div class="b3houses" style="transform:translateZ(1px)">${bld}</div>`;
    }
    h+=`<div class="b3t r${p.rot}${c.acao?" acao":" prop"}${own?" own":""}${t.hipotecada?" hip":""}${dim?" dim":""}${lp}" data-b3="${c.id}" data-sq="${i}" style="${style};--gc:${c.acao?"#3a3a46":c.cor};--oc:${oc}${c.acao?"":`;--sky:${skyline(c.id)}`}"><div class="b3in">${floor}<span class="b3nm">${esc(c.nome)}${c.acao?"":`<small>${esc(c.pais)}</small>`}</span><span class="b3pr">$${c.preco.toLocaleString("pt-BR")}</span></div>${extra}${pw}</div>`;
  });
  h+=`<div class="b3center"><span class="b3sr a">SORTE<i>ou</i>REVÉS</span><span class="b3sr b">SORTE<i>ou</i>REVÉS</span><div class="b3logo"><img src="logo.webp" alt=""><b>MUNDO</b></div></div>`;
  setHTML($("#b3dBoard"),h);
  /* legend */
  const ppl=playersArr(D),cnt=id=>Object.values(D.Tit).filter(t=>t.dono===id).length,free=Object.keys(CARDS).filter(id=>!(D.Tit[id]||{}).dono).length;
  $("#b3dLegend").innerHTML=`<div><button type="button" class="b3lp" data-hl="" aria-pressed="${!b3.hl}" style="--oc:#FFD12B"><span>Todos<small>28 cartas</small></span></button><button type="button" class="b3lp" data-hl="free" aria-pressed="${b3.hl==="free"}" style="--oc:#7ee08a"><span>Livres<small>${free} no banco</small></span></button>${ppl.map(p=>`<button type="button" class="b3lp" data-hl="${esc(p.id)}" aria-pressed="${b3.hl===p.id}" style="--oc:${colorOf(p.cor).c}">${avatar(p)}<span>${esc(shortName(p.nome))}<small>${cnt(p.id)} ${cnt(p.id)===1?"carta":"cartas"}</small></span></button>`).join("")}</div>`;
  b3cam();
}
function b3full(){return !$("#b3d").hidden}
function b3hl(){return b3.hl}
function b3cam(){
  const st=$("#b3dStage");if(!st)return;
  b3.fit=Math.min(st.clientWidth/(b3full()?800:780),st.clientHeight/(b3full()?740+b3.pitch*2:640+b3.pitch*1.6));
  const z=b3.fit*Math.pow(1.25,b3.zoom);
  $("#b3dCam").style.transform=`translateY(${-b3.pitch*0.5}px) scale(${z})`;
  $("#b3dBoard").style.transform=`rotateX(${b3.pitch}deg) rotateZ(${b3.yaw}deg)`;
  const bill=`rotateZ(${-b3.yaw}deg) rotateX(${-b3.pitch}deg)`;
  document.querySelectorAll("#b3dBoard .b3pw").forEach(el=>el.style.transform=el.dataset.off+" "+bill);
}
function openBoard3d(){
  b3.hl=cdFilter==="all"||cdFilter==="others"?null:cdFilter==="mine"?L.me:cdFilter;
  $("#b3d").hidden=false;$("#b3d").insertBefore($("#b3dStage"),document.querySelector(".b3dtools"));drawBoard3d();play("tap");
}
function closeBoard3d(){b3pickEnd(true);$("#b3d").hidden=true;$("#b3dBoard").innerHTML="";$("#b3dBoard")._h=null;play("tap")}
$("#b3Expand").onclick=openBoard3d;
$("#b3dClose").onclick=closeBoard3d;
$("#b3dLegend").addEventListener("click",e=>{const b=e.target.closest("[data-hl]");if(!b)return;b3.hl=b.dataset.hl||null;play("tap");drawBoard3d()});
document.querySelector(".b3dtools").addEventListener("click",e=>{const b=e.target.closest("[data-v]");if(!b)return;const v=b.dataset.v;
  if(v==="here"){if(b3.pick)b3pickEnd();else b3pickStart();play("tap");return}
  if(v==="top"){b3.pitch=1;b3.yaw=0}else if(v==="tilt"){b3.pitch=52;b3.yaw=-18}else if(v==="+")b3.zoom=Math.min(4,b3.zoom+1);else b3.zoom=Math.max(-1,b3.zoom-1);
  $("#b3dBoard").style.transition=$("#b3dCam").style.transition="transform .35s ease";b3cam();setTimeout(()=>{$("#b3dBoard").style.transition=$("#b3dCam").style.transition=""},360);play("tap")});
const b3s=$("#b3dStage");
b3s.addEventListener("pointerdown",e=>{b3s.setPointerCapture(e.pointerId);b3s.classList.add("moving");clearTimeout(b3MoveT);b3.ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});b3.moved=0;b3.t0=Date.now();b3.last=null});
b3s.addEventListener("pointermove",e=>{
  if(!b3.ptrs.has(e.pointerId))return;
  const prev=b3.ptrs.get(e.pointerId);b3.ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(b3.ptrs.size===1){const dx=e.clientX-prev.x,dy=e.clientY-prev.y;b3.moved+=Math.abs(dx)+Math.abs(dy);b3.yaw-=dx*.35;if(b3full()||e.pointerType==="mouse")b3.pitch=Math.max(1,Math.min(72,b3.pitch-dy*.3));b3cam()}
  else if(b3.ptrs.size===2&&b3full()){const[a,b]=[...b3.ptrs.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);if(b3.last){b3.zoom=Math.max(-1,Math.min(4,b3.zoom+Math.log(d/b3.last)/Math.log(1.25)));b3cam()}b3.last=d;b3.moved+=99}
});
let b3MoveT=null;
function b3still(){clearTimeout(b3MoveT);b3MoveT=setTimeout(()=>{if(!b3.ptrs.size)b3s.classList.remove("moving")},250)}
function b3up(e){b3still();
  const tap=b3.ptrs.size===1&&b3.moved<8&&Date.now()-b3.t0<400;
  b3.ptrs.delete(e.pointerId);b3.last=null;
  if(tap&&b3.pick){const el=document.elementFromPoint(e.clientX,e.clientY);const q=el&&el.closest("[data-sq]");if(q){setMyPos(+q.dataset.sq,true);b3pickEnd();toast("Você está em "+sqName(+q.dataset.sq));play("tap")}return}
  if(tap){const el=document.elementFromPoint(e.clientX,e.clientY);const t=el&&el.closest("[data-b3]");if(t){play("tap");openCard(+t.dataset.b3);$("#cardSheet").classList.add("over3d")}}
}
b3s.addEventListener("pointerup",b3up);b3s.addEventListener("pointercancel",e=>{b3.ptrs.delete(e.pointerId);b3.last=null;b3still()});
b3s.addEventListener("wheel",e=>{if(!b3full())return;e.preventDefault();b3s.classList.add("moving");b3still();b3.zoom=Math.max(-1,Math.min(4,b3.zoom-e.deltaY/300));b3cam()},{passive:false});
window.addEventListener("resize",()=>{if(!$("#b3d").hidden)b3cam()});
const fromHash=(location.hash||"").replace("#","").toUpperCase().replace(/[^A-Z0-9]/g,"");
if(fromHash.length===4&&API)openMesa(fromHash);
else{
  const last=ls.get("pb-ultima"),saved=last&&loadMesa(last);
  if(saved&&saved.mesa&&API&&isStandalone())openMesa(last);else render();
}
window.addEventListener("hashchange",()=>{const h=(location.hash||"").replace("#","").toUpperCase();if(h.length===4&&API&&(!L||h!==L.codigo))openMesa(h)});
window.PORTI_DEBUG={render:()=>render(),t:{openCard,closeCard,ccDo,offerDo,scoreDo,showFinal},state:()=>L,sync:syncNow,sound:()=>({on:soundOn,ready:soundReady,state:ac&&ac.state})};
})();

;["status-ferias.svg","status-preso.svg"].forEach(u=>{const im=new Image();im.src=u});
