var TX_MIN=8,txShow=TX_MIN,sw=null,swiped=false,swDirty=false;
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
    subscribe(code,onRow,onStatus){
      const ch=sb.channel("mesa-"+code)
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_lancamentos",filter:"mesa=eq."+code},p=>p.new&&onRow("lanc",p.new))
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_jogadores",filter:"mesa=eq."+code},p=>p.new&&onRow("jog",p.new))
        .on("postgres_changes",{event:"*",schema:"public",table:"pb_mesas",filter:"codigo=eq."+code},p=>p.new&&onRow("mesa",p.new))
        .subscribe(s=>onStatus(s));
      return()=>{try{sb.removeChannel(ch)}catch(e){}};
    },
    bumps(code,onBump){
      const ch=sb.channel("toque-"+code,{config:{broadcast:{self:false,ack:false}}})
        .on("broadcast",{event:"bump"},m=>m&&m.payload&&onBump(m.payload)).subscribe();
      return{send(p){try{ch.send({type:"broadcast",event:"bump",payload:p})}catch(e){}},close(){try{sb.removeChannel(ch)}catch(e){}}};
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
function wakeSound(){
  const a=actx();if(!a)return;
  if(a.state!=="running"){
    try{const p=a.resume();if(p&&p.then)p.then(()=>{soundReady=a.state==="running";drawSnd()}).catch(()=>{})}catch(e){}
    try{const b=a.createBuffer(1,1,22050),s=a.createBufferSource();s.buffer=b;s.connect(a.destination);s.start(0)}catch(e){}
  }
  soundReady=a.state==="running";
}
["pointerdown","touchend","keydown"].forEach(ev=>document.addEventListener(ev,wakeSound,{passive:true,capture:true}));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){soundReady=false}drawSnd()});
function tone(f,t0,dur,type,vol,f2){
  const a=actx();if(!a||a.state!=="running")return;const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+t0;
  o.type=type||"sine";o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.15,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+.05);
}
function noise(t0,dur,vol,ftype,freq){
  const a=actx();if(!a||a.state!=="running")return;const b=a.createBuffer(1,Math.floor(a.sampleRate*dur),a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);
  const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();f.type=ftype||"highpass";f.frequency.value=freq||3000;g.gain.value=vol;
  s.buffer=b;s.connect(f).connect(g).connect(a.destination);s.start(a.currentTime+t0);
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
  back(){tone(260,0,.8,"sawtooth",.06,110);noise(0,.8,.1,"bandpass",800);tone(440,.95,.14,"square",.06);tone(554,.95,.14,"square",.05);tone(440,1.16,.2,"square",.06);tone(554,1.16,.2,"square",.05)},
  /* key turning and the door opening */
  unlock(){noise(0,.03,.18);tone(2200,0,.05,"square",.06);noise(.12,.03,.18);tone(2600,.12,.05,"square",.06);tone(240,.3,.5,"sawtooth",.04,700);noise(.3,.45,.04);[523,659,784].forEach((f,i)=>tone(f,.85+i*.08,.2,"triangle",.11))}
};
function play(k){
  if(soundOn)try{wakeSound();SFX[k]()}catch(e){}
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
const blank=code=>({v:1,codigo:code,mesa:null,jog:{},lanc:{},out:[],me:null,since:0});
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
/* bank money going to a player needs the banker, unless the banker launched it */
const needsApproval=(de,para,por)=>!de&&!!para&&!!banker()&&por!==banker();

/* merged view: server rows + what is still waiting in the queue */
function derive(){
  const P={},T={};
  for(const[id,p]of Object.entries(L.jog))P[id]={...p};
  for(const[id,t]of Object.entries(L.lanc))T[id]={...t};
  for(const op of L.out){
    if(op.t==="entrar"&&!P[op.id])P[op.id]={id:op.id,nome:op.nome,cor:op.cor,oculto:false,criado_em:op.em,pend:true};
    else if(op.t==="ocultar"&&P[op.id])P[op.id].oculto=op.oculto;
    else if(op.t==="remover"&&P[op.id])P[op.id].removido=true;
    else if(op.t==="foto"&&P[op.id])P[op.id].foto=op.foto;
    else if(op.t==="situacao"&&P[op.id])P[op.id].situacao=op.situacao||null;
    else if(op.t==="lancar"&&!T[op.id])T[op.id]={id:op.id,de:op.de,para:op.para,valor:op.valor,motivo:op.motivo,lancado_por:op.por,feito_em:op.em,estornado_em:null,status:op.status||"aprovado",pend:true};
    else if(op.t==="estornar"&&T[op.id]&&!T[op.id].estornado_em&&T[op.id].status!=="recusado"){
      if(T[op.id].status==="pendente"){T[op.id].status="recusado";T[op.id].aprovado_por=op.por;T[op.id].stPend=true}
      else{T[op.id].estornado_em=op.em;T[op.id].estornado_por=op.por;T[op.id].estPend=true}
    }
    else if((op.t==="aprovar"||op.t==="recusar")&&T[op.id]&&T[op.id].status==="pendente"){T[op.id].status=op.t==="aprovar"?"aprovado":"recusado";T[op.id].aprovado_por=op.por;T[op.id].stPend=true}
  }
  return{P,T};
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

/* ---------- sync engine ---------- */
function enqueue(op){L.out.push(op);save();render();setTimeout(syncNow,0)}
function confirmOp(op){
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
  else if(op.t==="situacao"&&L.jog[op.id]){L.jog[op.id].situacao=op.situacao||null}
  else if(op.t==="esconder"&&L.mesa){L.mesa.esconder=op.permitido}
  else if(op.t==="valores"&&L.mesa){L.mesa.saldo_inicial=op.saldo;L.mesa.salario=op.salario}
}
function sendOp(op){
  if(op.t==="entrar")return API.rpc("pb_entrar",{p_id:op.id,p_mesa:L.codigo,p_nome:op.nome,p_cor:op.cor});
  if(op.t==="lancar")return API.rpc("pb_lancar",{p_id:op.id,p_mesa:L.codigo,p_de:op.de,p_para:op.para,p_valor:op.valor,p_motivo:op.motivo||null,p_por:op.por,p_feito_em:op.em});
  if(op.t==="estornar")return API.rpc("pb_estornar",{p_id:op.id,p_por:op.por});
  if(op.t==="aprovar")return API.rpc("pb_aprovar",{p_id:op.id,p_por:op.por});
  if(op.t==="recusar")return API.rpc("pb_recusar",{p_id:op.id,p_por:op.por});
  if(op.t==="ocultar")return API.rpc("pb_ocultar",{p_id:op.id,p_oculto:op.oculto,p_quando:op.em});
  if(op.t==="banco")return API.rpc("pb_passar_banco",{p_mesa:L.codigo,p_de:op.por,p_para:op.para});
  if(op.t==="situacao")return API.rpc("pb_situacao",{p_id:op.id,p_por:op.por,p_situacao:op.situacao||null});
  if(op.t==="foto")return API.rpc("pb_foto",{p_id:op.id,p_foto:op.foto});
  if(op.t==="remover")return API.rpc("pb_remover_jogador",{p_id:op.id,p_por:op.por});
  if(op.t==="esconder")return API.rpc("pb_mesa_esconder",{p_mesa:L.codigo,p_por:op.por,p_permitido:op.permitido});
  if(op.t==="valores")return API.rpc("pb_mesa_valores",{p_mesa:L.codigo,p_por:op.por,p_saldo_inicial:op.saldo,p_salario:op.salario});
  return Promise.resolve();
}
async function flush(cur){
  let sent=0;
  while(cur.out.length){
    const op=cur.out[0];
    try{await sendOp(op)}
    catch(e){
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
  L.mesa={saldo_inicial:m.saldo_inicial,salario:m.salario,banqueiro:m.banqueiro||null,esconder:m.esconder_permitido!==false};
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
  const asks=news.filter(r=>r._new&&r.status==="pendente"&&boss&&r.lancado_por!==me);
  const mine=news.filter(r=>!asks.includes(r)&&(r.de===me||r.para===me));
  if(asks.length){
    toast(asks.length>1?asks.length+" pedidos esperando você aprovar":nameOf(asks[0].lancado_por,D)+" pediu "+money(asks[0].valor)+(asks[0].motivo?" ("+asks[0].motivo+")":""));
    play("ask");
  }
  if(!mine.length)return;
  if(mine.length>3){toast(mine.length+" lançamentos novos na sua conta");play("recv");flashCard();return}
  for(const r of mine){
    if(r._est){toast(nameOf(r.estornado_por,D)+" estornou "+money(r.valor)+" ("+nameOf(r.de,D)+" → "+nameOf(r.para,D)+")");play("undo")}
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
  L=loadMesa(code)||blank(code);
  firstSync=!!L.since;forceJoin=false;live=false;net="idle";
  ls.set("pb-ultima",code);setHash(code);
  render();
  if(!API)return;
  if(API.subscribe){
    const cur=L;
    unsub=API.subscribe(code,(kind,row)=>{if(L===cur){mergeRows(kind,[row],firstSync);save();render()}},
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
  const boss=iAmBanker(),bk=banker();
  const bal=balances(D),c=colorOf(meP.cor),card=$("#card");
  card.style.backgroundColor=c.c;
  card.style.backgroundImage=`linear-gradient(140deg,${c.c} 0%,color-mix(in oklab,${c.c} 62%,#000) 100%)`;
  card.classList.toggle("darktext",!!c.dark);
  card.innerHTML=`<svg class="gl"><use href="#globe"/></svg>
    <div class="row"><span class="cw">PORTI BANK</span><span class="tier">${boss?"BANQUEIRO":"MUNDO"}</span></div>
    <div class="chiprow"><span class="chip"></span><svg class="nfc"><use href="#i-nfc"/></svg></div>
    <button class="balbtn" id="peekBtn" aria-label="${peek?"Mostrar saldo":"Tapar saldo"}"><div class="lbl">Saldo disponível<svg class="eye"><use href="#${peek?"i-eyeoff":"i-eye"}"/></svg></div><div class="bal">${peek?MASK:fmt(bal[L.me])}</div></button>
    <div class="row"><span class="holder">${esc(meP.nome)}</span><span class="cardnum">•••• ${last4(L.me)}</span></div>`;

  /* requests */
  const txs=txArr(D);
  const pending=txs.filter(t=>t.status==="pendente").reverse();
  const box=$("#reqBox");
  if(boss&&pending.length){
    box.hidden=false;$("#reqTitle").textContent=pending.length>1?pending.length+" pedidos para aprovar":"Pedido para aprovar";
    $("#reqList").innerHTML=pending.map(t=>`<div class="rq"><div class="who">${avatar(D.P[t.para],"sm")}<span class="n">${esc(nameOf(t.para,D))}</span></div><div class="amt">+ ${money(t.valor)}</div>
      <div class="meta" style="grid-column:1/-1">${esc(t.motivo||"Receber do banco")}${t.lancado_por!==t.para?" · pedido por "+esc(nameOf(t.lancado_por,D)):""}</div>
      <div class="btns"><button class="btn ghost small" data-deny="${esc(t.id)}">Recusar</button><button class="btn ok small" data-approve="${esc(t.id)}">Aprovar ${money(t.valor)}</button></div></div>`).join("");
  }else{
    const myWait=pending.filter(t=>t.lancado_por===L.me||t.para===L.me);
    box.hidden=!myWait.length;
    if(myWait.length){$("#reqTitle").textContent="Aguardando o banqueiro";
      $("#reqList").innerHTML=myWait.map(t=>`<div class="rq"><div class="who"><span class="n">${esc(t.motivo||"Receber do banco")}</span></div><div class="amt">+ ${money(t.valor)}</div>
        <div class="meta" style="grid-column:1/-1">${bk?esc(nameOf(bk,D))+" precisa aprovar.":"O banqueiro precisa aprovar."}</div>
        <div class="btns" style="grid-template-columns:1fr"><button class="btn ghost small" data-deny="${esc(t.id)}">Cancelar pedido</button></div></div>`).join("")}
  }

  /* action buttons */
  $("#salaryLbl").textContent=(boss?"+ $ ":"Pedir $ ")+short(L.mesa.salario);
  $("#aSalary").querySelector(".s").textContent=boss?"Passei pela partida":"Passei pela partida · o banqueiro aprova";
  $("#aRecv").querySelector(".s").textContent=boss?"Do banco":"Pedido ao banqueiro";
  $("#rules").textContent="Mesa "+L.codigo+" · Início "+money(L.mesa.saldo_inicial)+" · Partida "+money(L.mesa.salario);
  const sit=boss?null:meP.situacao;
  $("#bars").hidden=!meP.situacao;$("#bars").className="bars"+(meP.situacao==="ferias"?" ferias":"");
  $("#barsLbl").textContent=meP.situacao==="ferias"?"DE FÉRIAS":"NA CADEIA";
  $("#jailBanner").hidden=!sit;
  if(sit)$("#jailBanner").textContent=(sit==="ferias"?"Você está de férias.":"Você está na cadeia.")+" Só o banqueiro pode mexer na sua conta até ele te soltar.";
  ["#aPay","#aSalary","#aRecv","#aBump"].forEach(x=>{$(x).disabled=!!sit});
  $("#privBtn").setAttribute("aria-checked",String(!!meP.oculto));
  $("#privEye").innerHTML=`<use href="#${meP.oculto?"pe-eyeoff":"pe-eye"}"/>`;
  $("#photoPrev").outerHTML=avatar(meP,"big").replace('class="avatar big"','class="avatar big" id="photoPrev"');
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
  if(sw&&sw.on){swDirty=true}else $("#players").innerHTML=[...vis,...hid].map((p,i)=>{
    const cc=colorOf(p.cor).c,h=hiddenFor(p),w=h?0:Math.max(0,bal[p.id])/max*100;
    const tag=(p.id===L.me?(p.oculto?'<span class="you">você · oculto</span>':'<span class="you">você</span>'):h?'<span class="lock">oculto</span>':"")+(p.id===bk?'<span class="banker">banqueiro</span>':"")+(p.situacao==="preso"?'<span class="jailtag"><svg class="sticon" viewBox="0 0 64 72"><use href="#pb-lock"/></svg>preso</span>':p.situacao==="ferias"?'<span class="vactag"><svg class="sticon" viewBox="0 0 72 48"><use href="#pb-car"/></svg>férias</span>':"");
    return `<button class="pl${p.situacao==="preso"?" jailed":p.situacao==="ferias"?" vac":""}" data-actor="${esc(p.id)}" aria-label="Lançar por ${esc(p.nome)}"><span class="pos">${h?"—":String(i+1).padStart(2,"0")}</span>
      <span class="nm">${avatar(p)}<span class="nmtxt">${esc(p.nome)}</span>${tag}</span>
      <span class="v ${!h&&bal[p.id]<0?"neg-t":""}">${h?MASK:fmt(bal[p.id])}</span>
      <span class="bar"><i style="width:${w}%;background:${cc}"></i></span></button>`}).join("");

  /* laps: how many times each player got the GO money */
  {const laps={},lastLap={};
   for(const t of txs){if(t.motivo==="Passou pela partida"&&t.para&&counts(t)){laps[t.para]=(laps[t.para]||0)+1;if(!lastLap[t.para])lastLap[t.para]=t.feito_em}}
   const mx=Math.max(0,...all.map(p=>laps[p.id]||0));
   $("#laps").innerHTML=all.map(p=>{
     const n=laps[p.id]||0,ago=lastLap[p.id]?Math.max(0,Math.round((Date.now()-tms(lastLap[p.id]))/60000)):null;
     const behind=n<mx&&p.situacao!=="preso";
     const sit=p.situacao==="preso"?"na cadeia":p.situacao==="ferias"?"de férias":"";
     return `<div class="lap ${behind?"behind":""}">${avatar(p,"sm")}<div class="lapinfo"><b>${esc(p.nome)}</b><span>${n} ${n===1?"volta":"voltas"}${ago!==null?" · última há "+(ago<1?"menos de 1 min":ago+" min"):""}${sit?" · "+sit:""}${behind?" · está atrás":""}</span></div>${boss?`<button class="btn small lapbtn" data-lap="${esc(p.id)}" ${p.situacao==="preso"?"disabled":""}>+ ${short(L.mesa.salario)}</button>`:`<span class="lapn">${n}</span>`}</div>`}).join("");
   $("#lapsHint").textContent=boss?"Toque em + quando o jogador passar pela partida. Quem está preso não recebe; de férias recebe.":"Quantas vezes cada um recebeu a partida. Quem está atrás pode ter passado sem receber: avise o banqueiro.";}

  /* statement: everything that happened at the table */
  const tl=$("#txList"),more=$("#txMore");
  more.hidden=txs.length<=TX_MIN;
  if(!more.hidden){const rest=txs.length-txShow;more.innerHTML=rest>0?`<button data-txmore="1">Ver mais ${Math.min(rest,20)} lançamentos <span>(${rest} escondidos)</span></button>${rest>20?'<button data-txmore="all">Ver tudo</button>':""}`:`<button data-txmore="less">Mostrar menos</button>`}
  if(!txs.length){tl.innerHTML='<p class="empty">Nenhum lançamento ainda. O primeiro pagamento aparece aqui em todos os celulares.</p>';return}
  tl.innerHTML=txs.slice(0,txShow).map(t=>{
    const st=t.status||"aprovado",est=!!t.estornado_em,wait=st==="pendente",rec=st==="recusado";
    const cls=(t.para===L.me?"in":t.de===L.me?"out":"")+(est?" est":"")+(wait?" wait":"")+(rec?" rec":"");
    const time=new Date(tms(t.feito_em)).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    const canUndo=!est&&st==="aprovado"&&(boss||t.de===L.me||t.para===L.me||t.lancado_por===L.me);
    const via=t.lancado_por&&t.lancado_por!==t.de&&t.lancado_por!==t.para?`<span>lançado por ${esc(nameOf(t.lancado_por,D))}</span>`:"";
    const appr=st==="aprovado"&&!t.de&&t.aprovado_por&&t.aprovado_por!==t.lancado_por?`<span>aprovado por ${esc(nameOf(t.aprovado_por,D))}</span>`:"";
    const pend=t.pend?'<span class="pend">aguardando internet</span>':"";
    const stl=wait?'<span class="waitlbl">aguardando o banqueiro</span>':rec?`<span class="reclbl">${t.aprovado_por&&t.aprovado_por===t.lancado_por&&t.aprovado_por!==bk?"Pedido cancelado":"Recusado"}</span>`:"";
    const estl=est?`<span class="estlbl">${t.estPend?"Estornando…":"Estornado por "+esc(nameOf(t.estornado_por,D))}</span>`:"";
    let btns="";
    if(wait&&boss)btns=`<button class="okbtn" data-approve="${esc(t.id)}">Aprovar</button><button class="undo" data-deny="${esc(t.id)}">Recusar</button>`;
    else if(wait&&(t.lancado_por===L.me||t.para===L.me))btns=`<button class="undo" data-deny="${esc(t.id)}">Cancelar pedido</button>`;
    else if(canUndo)btns=`<button class="undo ${armedUndo===t.id?"arm":""}" data-undo="${esc(t.id)}">${armedUndo===t.id?"Confirmar estorno":"Estornar"}</button>`;
    const off=est||rec||wait;
    const sign=off?"":t.para===L.me?"+ ":t.de===L.me?"− ":"";
    return `<div class="t ${cls}"><span class="ar">${t.para===L.me?"↓":t.de===L.me?"↑":"⇄"}</span>
      <div class="who">${esc(nameOf(t.de,D))} → ${esc(nameOf(t.para,D))}</div>
      <div class="amt">${sign}${money(t.valor)}</div>
      <div class="meta"><span class="num">${time}</span>${t.motivo?`<span>${esc(t.motivo)}</span>`:""}${via}${appr}${pend}${stl}${estl}${btns}</div></div>`}).join("");
}
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
  el.className="trip "+(leaving?"leaving":"back");
  el.hidden=true;void el.offsetWidth;el.hidden=false;
  el.querySelectorAll("*").forEach(n=>{n.style.animation="none";void n.offsetWidth;n.style.animation=""});
  play(leaving?"vacay":"back");
  clearTimeout(tripT);tripT=setTimeout(()=>el.hidden=true,leaving?3100:2600);
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
$("#trip").addEventListener("click",()=>{$("#trip").hidden=true;clearTimeout(tripT)});
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
    if(!iAmBanker()){toast("Só o banqueiro pode aprovar.");play("err");return}
    enqueue({t:"aprovar",id,por:L.me,em:nowIso()});play(t.motivo==="Passou pela partida"?"go":"recv");
    toast("Aprovado: + "+money(t.valor)+" para "+nameOf(t.para,D));
  }else{
    enqueue({t:"recusar",id,por:L.me,em:nowIso()});play("undo");
    toast(iAmBanker()&&t.lancado_por!==L.me?"Pedido de "+nameOf(t.para,D)+" recusado":"Pedido cancelado");
  }
}
let armedUndo=null,armT;
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.claim){L.me=b.dataset.claim;forceJoin=false;save();play("tap");render()}
  else if(b.dataset.color){joinColor=b.dataset.color;play("tap");renderJoin(derive())}
  else if(b.dataset.approve){decide(b.dataset.approve,true)}
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
  else if(b.dataset.actor){play("tap");openSheet("pay",b.dataset.actor)}
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
  if(!b.dataset.arm){b.dataset.arm="1";b.textContent="Toque de novo para remover "+nameOf(a);clearTimeout(rmT);rmT=setTimeout(()=>{delete b.dataset.arm;drawSheet()},4000);play("tap");return}
  delete b.dataset.arm;clearTimeout(rmT);
  const nm=nameOf(a);closeSheets();
  enqueue({t:"remover",id:a,por:L.me,em:nowIso()});play("undo");toast(nm+" saiu da mesa.");
};
$("#valBtn").onclick=()=>{
  $("#vStart").value=L.mesa.saldo_inicial.toLocaleString("pt-BR");$("#vSalary").value=L.mesa.salario.toLocaleString("pt-BR");
  $("#scrim").hidden=false;$("#valSheet").hidden=false;play("tap");
};
["#vStart","#vSalary"].forEach(x=>$(x).addEventListener("input",e=>fmtInput(e.target)));
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
  sw.bg.innerHTML="<b>"+(kind==="ferias"?ic("pb-car","0 0 72 48")+(undo?"Tirar das férias":"Férias"):ic(undo?"pb-unlock":"pb-lock","0 0 64 72")+(undo?"Soltar":"Prender"))+"</b>";
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
const REASONS={pay:["Aluguel","Compra","Imposto","Construção","Sorte/Revés"],recv:["Sorte/Revés","Venda ao banco","Hipoteca","Prêmio"],salary:[],set:[]};
function quickValues(){
  const s=L.mesa.saldo_inicial,p=L.mesa.salario;
  if(s>=1e6||p>=1e5)return[1000,10000,45000,100000,250000,300000];
  if(s>=10000)return[100,500,1000,5000];
  return[10,50,100,500];
}
function chipsHTML(){
  const v=quickValues(),minus=v.slice(0,4);
  return v.map(x=>`<button data-add="${x}">+${short(x)}</button>`).join("")+minus.map(x=>`<button data-add="-${x}" class="minus">−${short(x)}</button>`).join("")+`<button data-add="0">Limpar</button>`;
}
function setAmount(n){$("#shAmount").value=n?"$ "+n.toLocaleString("pt-BR"):""}
function openSheet(kind,actor){
  if(L.me&&!iAmBanker()){const me=derive().P[L.me];if(me&&me.situacao){toast(me.situacao==="ferias"?"Você está de férias: só o banqueiro mexe na sua conta.":"Você está na cadeia: só o banqueiro mexe na sua conta.");play("err");return}}
  if(kind==="set"&&!iAmBanker())kind="pay";
  SH={kind,actor:actor||L.me,to:kind==="pay"?"bank":null,note:""};
  setAmount(0);closeCalc();
  $("#shQuick").innerHTML=chipsHTML();
  $("#scrim").hidden=false;$("#sheet").hidden=false;
  drawSheet();
}
function closeSheets(){$("#scrim").hidden=true;["#sheet","#invSheet","#bankSheet","#valSheet"].forEach(s=>$(s).hidden=true)}
function drawSheet(){
  const D=derive(),a=SH.actor,proxy=a!==L.me,p=D.P[a]||{},bal=balances(D)[a]||0,boss=iAmBanker();
  const hiddenBal=p.oculto&&proxy&&L.mesa.esconder!==false;
  const rm=$("#shRemove");rm.hidden=!(boss&&proxy);
  $("#shJail").hidden=!boss;
  $("#shJail").querySelectorAll("button").forEach(b=>{const v=b.dataset.sit||null;b.hidden=(v===(p.situacao||null))});
  if(!rm.dataset.arm)rm.textContent="Remover "+(p.nome||"")+" da mesa";
  $("#shDot").style.background=colorOf(p.cor).c;
  $("#shName").textContent=proxy?"Lançando por "+p.nome:"Seu cartão";
  $("#shBal").textContent="Saldo "+(hiddenBal?MASK:fmt(bal));
  document.querySelectorAll("#shTabs button").forEach(b=>{b.setAttribute("aria-pressed",String(b.dataset.kind===SH.kind));if(b.dataset.kind==="set")b.hidden=!boss});
  $("#shTabs").style.gridTemplateColumns=boss?"repeat(4,1fr)":"repeat(3,1fr)";
  $("#shToWrap").hidden=SH.kind!=="pay";
  $("#shAmtWrap").hidden=SH.kind==="salary";
  $("#calcToggle").hidden=SH.kind==="set";
  $("#shAmtLbl").textContent=SH.kind==="set"?"Saldo correto agora":"Valor";
  $("#shReasonWrap").hidden=!REASONS[SH.kind].length;
  $("#shHint").hidden=SH.kind!=="set"&&!((SH.kind==="recv"||SH.kind==="salary")&&!boss);
  if(SH.kind==="set"){
    const avg=tableAverage(D,a);
    $("#shHint").innerHTML=`Para corrigir o saldo, ou equilibrar quem entrou no meio do jogo. O banco lança a diferença no extrato.`;
    $("#shQuick").innerHTML=[[L.mesa.saldo_inicial,"Início "+short(L.mesa.saldo_inicial)],[avg,"Média da mesa "+short(avg)]].map(([v,l])=>`<button data-setval="${v}">${l}</button>`).join("")+chipsHTML();
    if($("#shAmount").value==="")setAmount(bal);
  }else{
    $("#shHint").textContent="Dinheiro do banco só cai depois que o banqueiro aprovar.";
    if($("#shQuick").querySelector("[data-setval]"))$("#shQuick").innerHTML=chipsHTML();
  }
  const others=playersArr(D).filter(x=>x.id!==a);
  $("#shTo").innerHTML=[{id:"bank",nome:"Banco"},...others].map(x=>`<button data-to="${esc(x.id)}" aria-pressed="${SH.to===x.id}">${x.cor?avatar(x,"sm"):""}${esc(x.id===L.me?x.nome+" (você)":x.nome)}</button>`).join("");
  $("#shReason").innerHTML=REASONS[SH.kind].map(r=>`<button data-note="${esc(r)}" aria-pressed="${SH.note===r}">${esc(r)}</button>`).join("");
  const amt=parseAmt($("#shAmount").value),has=$("#shAmount").value!=="";
  const go=$("#shGo"),an=p.nome||"?",warn=$("#shWarn");
  go.className="btn";warn.textContent="";
  if(SH.kind==="pay"){
    const toName=SH.to==="bank"?"o Banco":nameOf(SH.to,D);
    go.textContent=amt&&SH.to?(proxy?`${an} paga ${money(amt)} para ${toName}`:`Pagar ${money(amt)} para ${toName}`):SH.to?"Digite o valor":"Escolha para quem";
    go.disabled=!(amt>0&&SH.to);
    if(amt>bal&&!hiddenBal&&!(a===L.me&&peek))warn.textContent=(proxy?"O saldo de "+an+" fica negativo: ":"Seu saldo fica negativo: ")+fmt(bal-amt);
  }else if(SH.kind==="recv"){
    go.textContent=!amt?"Digite o valor":boss?(proxy?`${an} recebe ${money(amt)} do banco`:`Receber ${money(amt)} do banco`):`Pedir ${money(amt)} ao banqueiro`;go.disabled=!(amt>0);
  }else if(SH.kind==="salary"){
    go.textContent=boss?(proxy?an+" recebe ":"Receber ")+money(L.mesa.salario)+" da partida":"Pedir "+money(L.mesa.salario)+" da partida";go.disabled=false;go.className="btn gold";
  }else{
    const d=amt-bal;
    go.textContent=has?`Deixar o saldo em ${money(amt)}`:"Digite o saldo correto";go.disabled=!has||d===0;
    if(has&&d!==0)warn.textContent=(d>0?"O banco paga ":"O banco recebe ")+money(Math.abs(d));
  }
}
$("#shTabs").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;SH.kind=b.dataset.kind;SH.to=SH.kind==="pay"?"bank":null;SH.note="";setAmount(0);closeCalc();play("tap");drawSheet()});
$("#shClose").onclick=closeSheets;$("#scrim").onclick=closeSheets;
$("#shAmount").addEventListener("input",e=>{const raw=e.target.value;setAmount(raw.replace(/\D/g,"")===""?0:parseAmt(raw));if(raw.replace(/\D/g,"")==="")e.target.value="";drawSheet()});
$("#sheet").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||b.closest("#shTabs")||b.closest("#calc"))return;
  if(b.dataset.to){SH.to=b.dataset.to;play("tap");drawSheet()}
  else if(b.dataset.note){SH.note=SH.note===b.dataset.note?"":b.dataset.note;play("tap");drawSheet()}
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
  $("#calcUse").disabled=!ok;
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
  else if(b.id==="calcUse"){const v=parseAmt($("#calcVal").value);setAmount(calcDice*v);closeCalc();play("recv");drawSheet()}
});
$("#calcVal").addEventListener("input",e=>{fmtInput(e.target);drawCalc()});

$("#shGo").onclick=()=>{
  const D=derive(),a=SH.actor,an=nameOf(a,D),proxy=a!==L.me,amt=parseAmt($("#shAmount").value);
  if((SH.kind==="recv"||SH.kind==="salary")&&(D.P[a]||{}).situacao==="preso"){toast(an+" está preso e não recebe do banco.");play("err");return}
  const before=balances(D)[a];
  let r,msg,snd;
  if(SH.kind==="pay"){
    if(!(amt>0&&SH.to))return;
    const to=SH.to==="bank"?null:SH.to;
    r=lancar(a,to,amt,SH.note);msg=(proxy?an+" pagou ":"Pago: ")+money(amt)+" para "+nameOf(to,D);snd="pay";
  }else if(SH.kind==="recv"){
    if(!(amt>0))return;
    r=lancar(null,a,amt,SH.note);msg=(proxy?an+" recebeu ":"Recebido: ")+money(amt);snd="recv";
  }else if(SH.kind==="salary"){
    r=lancar(null,a,L.mesa.salario,"Passou pela partida");msg=an+" passou pela partida: + "+money(L.mesa.salario);snd="go";
  }else{
    const d=amt-before;if(!d)return;
    r=d>0?lancar(null,a,d,"Ajuste de saldo"):lancar(a,null,-d,"Ajuste de saldo");
    msg="Saldo de "+an+" ajustado para "+money(amt);snd="recv";
  }
  closeSheets();
  if(r.status==="pendente"){play("ask");toast("Pedido enviado ao banqueiro: + "+money(SH.kind==="salary"?L.mesa.salario:amt),{label:"Cancelar",run:()=>estornar(r.id)});return}
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
  if(API&&API.bumps)bumpCh=API.bumps(code,bumpIn);
}
function bumpSend(role){if(bumpCh&&L&&L.me)bumpCh.send({id:L.me,role,mesa:L.codigo,t:lastKnock})}
function askMotion(){
  if(motionAsked)return;motionAsked=true;
  const DM=window.DeviceMotionEvent;
  if(DM&&typeof DM.requestPermission==="function"){
    try{DM.requestPermission().then(r=>{motionOK=r==="granted";if(motionOK)listenMotion();else if(bumpMode)bumpFail("O celular não deixou usar o sensor de movimento. Feche e abra o app e toque em Permitir.")}).catch(()=>{motionAsked=false})}catch(e){motionAsked=false}
  }else if(DM){motionOK=true;listenMotion()}
}
let motionOn=false,lastMag=0;
function listenMotion(){
  if(motionOn)return;motionOn=true;
  window.addEventListener("devicemotion",e=>{
    const a=e.acceleration&&e.acceleration.x!=null?e.acceleration:null;let mag;
    if(a)mag=Math.hypot(a.x||0,a.y||0,a.z||0);
    else{const g=e.accelerationIncludingGravity;if(!g)return;mag=Math.abs(Math.hypot(g.x||0,g.y||0,g.z||0)-9.81)}
    const jerk=Math.abs(mag-lastMag);lastMag=mag;
    if(mag>7&&jerk>5)knock();
  });
}
function knock(byTap){
  const now=Date.now();if(now-lastKnock<(byTap?400:1200))return;lastKnock=now;
  if(!L||!L.me||document.visibilityState!=="visible")return;
  bumpSend(bumpMode?"pay":"any");
  if(bumpMode){$("#bumpTitle").textContent="Procurando o outro celular…";bumpTry();
    const k=lastKnock;setTimeout(()=>{if(bumpMode&&lastKnock===k)$("#bumpTitle").textContent="A internet de alguém está lenta… espere um pouco ou encoste de novo"},4000)}
}
function bumpIn(p){
  if(!L||!p||!p.id||p.id===L.me||(p.mesa&&p.mesa!==L.codigo))return;
  const now=Date.now();
  recentPeers=recentPeers.filter(x=>now-x.got<BUMP_LATE);recentPeers.push({id:p.id,role:p.role,got:now,t:+p.t||0});
  if(p.role==="pay"&&sameKnock(recentPeers[recentPeers.length-1])&&!bumpMode){play("ask");toast(nameOf(p.id)+" encostou para te pagar")}
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
  if(ids.length!==1){if(ids.length>1)$("#bumpTitle").textContent="Mais de um celular encostou. Tente de novo.";return}
  const to=ids[0];bumpClose();play("recv");
  openSheet("pay");if($("#sheet").hidden)return;SH.to=to;drawSheet();toast("Pagar para "+nameOf(to));
  setTimeout(()=>{try{$("#shAmount").focus()}catch(e){}},250);
}
function bumpStart(){
  if(!L||!L.me)return;
  if(!bumpCh){toast("Encostar precisa de internet. Use Pagar normalmente.");play("err");return}
  askMotion();
  bumpMode="pay";$("#bumpTitle").textContent="Encoste no celular de quem vai receber";
  $("#bump").hidden=false;play("tap");
  clearTimeout(bumpT);bumpT=setTimeout(()=>{if(bumpMode)bumpFail("Não encontrei o outro celular. O app dele precisa estar aberto.")},25000);
}
function bumpFail(msg){bumpClose();toast(msg);play("err")}
function bumpClose(){bumpMode=null;clearTimeout(bumpT);$("#bump").hidden=true}
$("#aBump").onclick=bumpStart;
$("#bumpTap").onclick=()=>{knock(true);play("tap");const b=$("#bumpTap");b.classList.remove("hit");void b.offsetWidth;b.classList.add("hit")};
/* the receiver taps their own card at the same moment: no need to touch the phones */
$("#card").addEventListener("click",e=>{if(e.target.closest("button,input,label,a"))return;if(!L||!L.me||bumpMode)return;knock(true);flashCard()});
$("#bumpCancel").onclick=()=>{bumpClose();play("tap")};
$("#bumpList").onclick=()=>{bumpClose();openSheet("pay")};
/* the receiver's phone must feel the knock too: ask for the motion sensor on the first tap inside a table */
document.addEventListener("pointerup",()=>{if(L&&L.me&&!motionAsked)askMotion()},{passive:true});
if(window.DeviceMotionEvent&&typeof DeviceMotionEvent.requestPermission!=="function")askMotion();
window.__pbBump={knock,bumpIn,setCh:c=>{bumpCh=c},state:()=>({bumpMode,motionOK,lastKnock,recentPeers})};
const fromHash=(location.hash||"").replace("#","").toUpperCase().replace(/[^A-Z0-9]/g,"");
if(fromHash.length===4&&API)openMesa(fromHash);
else{
  const last=ls.get("pb-ultima"),saved=last&&loadMesa(last);
  if(saved&&saved.mesa&&API&&isStandalone())openMesa(last);else render();
}
window.addEventListener("hashchange",()=>{const h=(location.hash||"").replace("#","").toUpperCase();if(h.length===4&&API&&(!L||h!==L.codigo))openMesa(h)});
window.PORTI_DEBUG={state:()=>L,sync:syncNow,sound:()=>({on:soundOn,ready:soundReady,state:ac&&ac.state})};
})();
