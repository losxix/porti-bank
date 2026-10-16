/* PORTI BANK — app da mesa.
   A partida fica no Supabase. Cada celular guarda uma cópia e uma fila de
   lançamentos ainda não enviados: sem internet, o jogo continua e a fila sobe
   sozinha quando o sinal volta. Todo lançamento tem um id criado no celular,
   então reenviar nunca duplica. */
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
const parseAmt=s=>{const n=parseInt(String(s).replace(/\D/g,""),10);return isNaN(n)?0:n};
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
        .subscribe(s=>onStatus(s));
      return()=>{try{sb.removeChannel(ch)}catch(e){}};
    }
  };
}
const API=window.PORTI_TEST_API||makeApi();

/* ---------- sound ---------- */
let soundOn=ls.get("pb-sound")!=="0",ac=null;
function actx(){if(!ac){try{ac=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(ac&&ac.state==="suspended")ac.resume();return ac}
function tone(f,t0,dur,type,vol,f2){
  const a=actx();if(!a)return;const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+t0;
  o.type=type||"sine";o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.15,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+.05);
}
function noise(t0,dur,vol){
  const a=actx();if(!a)return;const b=a.createBuffer(1,Math.floor(a.sampleRate*dur),a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);
  const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();f.type="highpass";f.frequency.value=3000;g.gain.value=vol;
  s.buffer=b;s.connect(f).connect(g).connect(a.destination);s.start(a.currentTime+t0);
}
const SFX={
  tap(){tone(880,0,.05,"triangle",.07)},
  pay(){noise(0,.08,.1);tone(1320,.02,.12,"triangle",.14);tone(1760,.1,.35,"sine",.16);tone(2637,.1,.3,"sine",.05)},
  recv(){tone(988,0,.08,"square",.07);tone(1319,.07,.35,"square",.07)},
  go(){[523,659,784,1047].forEach((f,i)=>tone(f,i*.08,.22,"triangle",.14));tone(1568,.34,.4,"sine",.08)},
  undo(){tone(660,0,.14,"sine",.13,330)},
  broke(){[392,370,349,262].forEach((f,i)=>tone(f,i*.18,.24,"sawtooth",.06))},
  sync(){tone(784,0,.12,"sine",.1);tone(1175,.1,.25,"sine",.1)},
  err(){tone(180,0,.18,"square",.07)}
};
function play(k){
  if(soundOn)try{SFX[k]()}catch(e){}
  try{if(navigator.vibrate)navigator.vibrate(k==="err"?[40,40,40]:k==="pay"?25:12)}catch(e){}
}
function drawSnd(){$("#sndBtn").innerHTML=`<svg><use href="#${soundOn?"snd-on":"snd-off"}"/></svg>`;$("#sndBtn").setAttribute("aria-label",soundOn?"Desligar som":"Ligar som")}
$("#sndBtn").onclick=()=>{soundOn=!soundOn;ls.set("pb-sound",soundOn?"1":"0");drawSnd();if(soundOn)play("recv")};

/* ---------- local copy of a table ----------
   L = {v, codigo, mesa:{saldo_inicial,salario}, jog:{id:row}, lanc:{id:row}, out:[op], me, since}
   jog/lanc hold rows confirmed by the server; out holds what this phone still has to send. */
let L=null,net="idle",live=false,unsub=null,timer=null,firstSync=false,forceJoin=false;
let peek=ls.get("pb-mask")==="1";
const blank=code=>({v:1,codigo:code,mesa:null,jog:{},lanc:{},out:[],me:null,since:0});
function loadMesa(code){try{const d=JSON.parse(ls.get("pb-mesa-"+code)||"null");if(d&&d.v===1)return d}catch(e){}return null}
function save(){if(L)ls.set("pb-mesa-"+L.codigo,JSON.stringify(L))}

/* merged view: server rows + what is still waiting in the queue */
function derive(){
  const P={},T={};
  for(const[id,p]of Object.entries(L.jog))P[id]={...p};
  for(const[id,t]of Object.entries(L.lanc))T[id]={...t};
  for(const op of L.out){
    if(op.t==="entrar"&&!P[op.id])P[op.id]={id:op.id,nome:op.nome,cor:op.cor,oculto:false,criado_em:op.em,pend:true};
    else if(op.t==="ocultar"&&P[op.id])P[op.id].oculto=op.oculto;
    else if(op.t==="lancar"&&!T[op.id])T[op.id]={id:op.id,de:op.de,para:op.para,valor:op.valor,motivo:op.motivo,lancado_por:op.por,feito_em:op.em,estornado_em:null,pend:true};
    else if(op.t==="estornar"&&T[op.id]&&!T[op.id].estornado_em){T[op.id].estornado_em=op.em;T[op.id].estornado_por=op.por;T[op.id].estPend=true}
  }
  return{P,T};
}
function balances(D){
  const b={},s=(L.mesa&&L.mesa.saldo_inicial)||0;
  for(const id in D.P)b[id]=s;
  for(const t of Object.values(D.T)){if(t.estornado_em)continue;if(t.de&&t.de in b)b[t.de]-=t.valor;if(t.para&&t.para in b)b[t.para]+=t.valor}
  return b;
}
const playersArr=D=>Object.values(D.P).sort((a,b)=>tms(a.criado_em)-tms(b.criado_em));
const txArr=D=>Object.values(D.T).sort((a,b)=>tms(b.feito_em)-tms(a.feito_em));
function nameOf(id,D){if(!id)return"Banco";const p=(D||derive()).P[id];return p?p.nome:"?"}

/* ---------- sync engine ---------- */
function enqueue(op){L.out.push(op);save();render();setTimeout(syncNow,0)}
function confirmOp(op){
  if(op.t==="entrar"&&!L.jog[op.id])L.jog[op.id]={id:op.id,mesa:L.codigo,nome:op.nome,cor:op.cor,oculto:false,oculto_em:EPOCH,criado_em:op.em};
  else if(op.t==="lancar"&&!L.lanc[op.id])L.lanc[op.id]={id:op.id,mesa:L.codigo,de:op.de,para:op.para,valor:op.valor,motivo:op.motivo||null,lancado_por:op.por,feito_em:op.em,estornado_em:null,estornado_por:null};
  else if(op.t==="estornar"&&L.lanc[op.id]&&!L.lanc[op.id].estornado_em){L.lanc[op.id].estornado_em=op.em;L.lanc[op.id].estornado_por=op.por}
  else if(op.t==="ocultar"&&L.jog[op.id]){L.jog[op.id].oculto=op.oculto;L.jog[op.id].oculto_em=op.em}
}
function sendOp(op){
  if(op.t==="entrar")return API.rpc("pb_entrar",{p_id:op.id,p_mesa:L.codigo,p_nome:op.nome,p_cor:op.cor});
  if(op.t==="lancar")return API.rpc("pb_lancar",{p_id:op.id,p_mesa:L.codigo,p_de:op.de,p_para:op.para,p_valor:op.valor,p_motivo:op.motivo||null,p_por:op.por,p_feito_em:op.em});
  if(op.t==="estornar")return API.rpc("pb_estornar",{p_id:op.id,p_por:op.por});
  if(op.t==="ocultar")return API.rpc("pb_ocultar",{p_id:op.id,p_oculto:op.oculto,p_quando:op.em});
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
function mergeRows(kind,rows,notify){
  if(!L)return;
  const news=[];
  for(const r of rows||[]){
    if(!r||!r.id||(r.mesa&&r.mesa!==L.codigo))continue;
    if(kind==="jog"){L.jog[r.id]={...L.jog[r.id],...r}}
    else{
      const old=L.lanc[r.id];
      const mine=L.out.some(o=>o.t==="lancar"&&o.id===r.id);
      if(notify&&!old&&!mine&&!r.estornado_em)news.push(r);
      else if(notify&&old&&!old.estornado_em&&r.estornado_em&&r.estornado_por!==L.me)news.push({...r,_est:true});
      L.lanc[r.id]=r;
    }
    const t=tms(r.atualizado_em);if(t>L.since)L.since=t;
  }
  if(news.length)announce(news);
}
function announce(news){
  const me=L.me;if(!me)return;
  const D=derive();
  const mineNews=news.filter(r=>r.de===me||r.para===me);
  if(!mineNews.length)return;
  if(mineNews.length>3){toast(mineNews.length+" lançamentos novos na sua conta");play("recv");flashCard();return}
  for(const r of mineNews){
    if(r._est){toast(nameOf(r.estornado_por,D)+" estornou "+money(r.valor)+" ("+nameOf(r.de,D)+" → "+nameOf(r.para,D)+")");play("undo")}
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
    if(!cur.mesa){const m=await API.mesa(cur.codigo);if(L!==cur)return;if(!m){mesaMissing();return}cur.mesa={saldo_inicial:m.saldo_inicial,salario:m.salario}}
    const js=await API.jogadores(cur.codigo);if(L!==cur)return;mergeRows("jog",js,false);
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
  const ms=net==="online"&&!L.out.length?(live?25000:5000):4000;
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
  if(!L.mesa){
    const cur=L;
    try{
      const m=await API.mesa(code);if(L!==cur)return;
      if(!m){toast("Mesa "+code+" não encontrada. Confira o código.");play("err");leave(true);return}
      cur.mesa={saldo_inicial:m.saldo_inicial,salario:m.salario};save();
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
  if(!meP||forceJoin){renderJoin(D);show("vJoin");return}
  show("vMain");keepAwake();
  if(!$("#sheet").hidden&&D.P[SH.actor])drawSheet();
  const bal=balances(D),c=colorOf(meP.cor),card=$("#card");
  card.style.backgroundColor=c.c;
  card.style.backgroundImage=`linear-gradient(140deg,${c.c} 0%,color-mix(in oklab,${c.c} 62%,#000) 100%)`;
  card.classList.toggle("darktext",!!c.dark);
  card.innerHTML=`<svg class="gl"><use href="#globe"/></svg>
    <div class="row"><span class="cw">PORTI BANK</span><span class="tier">MUNDO</span></div>
    <div class="chiprow"><span class="chip"></span><svg class="nfc"><use href="#i-nfc"/></svg></div>
    <button class="balbtn" id="peekBtn" aria-label="${peek?"Mostrar saldo":"Tapar saldo"}"><div class="lbl">Saldo disponível<svg class="eye"><use href="#${peek?"i-eyeoff":"i-eye"}"/></svg></div><div class="bal">${peek?MASK:fmt(bal[L.me])}</div></button>
    <div class="row"><span class="holder">${esc(meP.nome)}</span><span class="cardnum">•••• ${last4(L.me)}</span></div>`;
  $("#salaryLbl").textContent="+ "+money(L.mesa.salario);
  $("#rules").textContent="Mesa "+L.codigo+" · Início "+money(L.mesa.saldo_inicial)+" · Partida "+money(L.mesa.salario);
  $("#privBtn").setAttribute("aria-checked",String(!!meP.oculto));
  $("#privSub").textContent=meP.oculto?"Os outros veem $ ••••• no lugar do seu saldo":"Os outros jogadores veem seu saldo no ranking";
  const hiddenFor=p=>p.oculto&&p.id!==L.me;
  const all=playersArr(D);
  const vis=all.filter(p=>!hiddenFor(p)).sort((a,b)=>bal[b.id]-bal[a.id]);
  const hid=all.filter(hiddenFor);
  const max=Math.max(1,...vis.map(p=>bal[p.id]));
  $("#players").innerHTML=[...vis,...hid].map((p,i)=>{
    const cc=colorOf(p.cor).c,h=hiddenFor(p),w=h?0:Math.max(0,bal[p.id])/max*100;
    const tag=p.id===L.me?(p.oculto?'<span class="you">você · oculto</span>':'<span class="you">você</span>'):h?'<span class="lock">oculto</span>':"";
    return `<button class="pl" data-actor="${esc(p.id)}" aria-label="Lançar por ${esc(p.nome)}"><span class="pos">${h?"—":String(i+1).padStart(2,"0")}</span>
      <span class="nm"><span class="pawn" style="background:${cc}"></span>${esc(p.nome)}${tag}</span>
      <span class="v ${!h&&bal[p.id]<0?"neg-t":""}">${h?MASK:fmt(bal[p.id])}</span>
      <span class="bar"><i style="width:${w}%;background:${cc}"></i></span></button>`}).join("");
  const txs=txArr(D),tl=$("#txList");
  if(!txs.length){tl.innerHTML='<p class="empty">Nenhum lançamento ainda. O primeiro pagamento aparece aqui em todos os celulares.</p>';return}
  tl.innerHTML=txs.slice(0,120).map(t=>{
    const est=!!t.estornado_em;
    const cls=(t.para===L.me?"in":t.de===L.me?"out":"")+(est?" est":"");
    const time=new Date(tms(t.feito_em)).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    const canUndo=!est&&(t.de===L.me||t.para===L.me||t.lancado_por===L.me);
    const via=t.lancado_por&&t.lancado_por!==t.de&&t.lancado_por!==t.para?`<span>lançado por ${esc(nameOf(t.lancado_por,D))}</span>`:"";
    const pend=t.pend?'<span class="pend">aguardando internet</span>':"";
    const estl=est?`<span class="estlbl">${t.estPend?"Estornando…":"Estornado por "+esc(nameOf(t.estornado_por,D))}</span>`:"";
    const undo=canUndo?`<button class="undo ${armedUndo===t.id?"arm":""}" data-undo="${esc(t.id)}">${armedUndo===t.id?"Confirmar estorno":"Estornar"}</button>`:"";
    const sign=est?"":t.para===L.me?"+ ":t.de===L.me?"− ":"";
    return `<div class="t ${cls}"><span class="ar">${t.para===L.me?"↓":t.de===L.me?"↑":"⇄"}</span>
      <div class="who">${esc(nameOf(t.de,D))} → ${esc(nameOf(t.para,D))}</div>
      <div class="amt">${sign}${money(t.valor)}</div>
      <div class="meta"><span class="num">${time}</span>${t.motivo?`<span>${esc(t.motivo)}</span>`:""}${via}${pend}${estl}${undo}</div></div>`}).join("");
}
let joinColor=null;
function renderJoin(D){
  const bal=balances(D),all=playersArr(D);
  $("#claimWrap").hidden=!all.length;
  $("#claimList").innerHTML=all.map(p=>`<button data-claim="${esc(p.id)}"><span class="pawn" style="background:${colorOf(p.cor).c}"></span>${esc(p.nome)}<span class="v">${p.oculto?MASK:fmt(bal[p.id])}</span></button>`).join("");
  const used=new Set(all.map(p=>p.cor));
  if(!joinColor||used.has(joinColor))joinColor=(COLORS.find(c=>!used.has(c.k))||COLORS[0]).k;
  $("#jColors").innerHTML=COLORS.map(c=>`<button type="button" class="sw" style="background:${c.c}" aria-label="${c.k}" aria-pressed="${c.k===joinColor}" data-color="${c.k}" ${used.has(c.k)?"disabled":""}></button>`).join("");
}
function last4(id){let h=7;for(const c of String(id))h=(h*31+c.charCodeAt(0))>>>0;return String(h%10000).padStart(4,"0")}

/* ---------- toast ---------- */
let toastT;
function toast(text,action){
  const el=$("#toast");$("#toastText").textContent=text;
  const b=$("#toastBtn");b.hidden=!action;
  if(action){b.textContent=action.label;b.onclick=()=>{el.hidden=true;action.run()}}
  el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,action?6000:3000);
}
function flashCard(){const c=$("#card");if(!c)return;c.classList.remove("flash");void c.offsetWidth;c.classList.add("flash")}

/* ---------- actions ---------- */
function lancar(de,para,valor,motivo){
  const id=uuid();
  enqueue({t:"lancar",id,de:de||null,para:para||null,valor,motivo:motivo||null,por:L.me,em:nowIso()});
  return id;
}
function estornar(id){
  const D=derive(),t=D.T[id];if(!t||t.estornado_em)return;
  enqueue({t:"estornar",id,por:L.me,em:nowIso()});
  play("undo");toast("Estornado: "+nameOf(t.de,D)+" → "+nameOf(t.para,D)+" "+money(t.valor));
}
let armedUndo=null,armT;
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.claim){L.me=b.dataset.claim;forceJoin=false;save();play("tap");render()}
  else if(b.dataset.color){joinColor=b.dataset.color;play("tap");renderJoin(derive())}
  else if(b.dataset.undo){
    const id=b.dataset.undo;
    if(armedUndo!==id){armedUndo=id;clearTimeout(armT);armT=setTimeout(()=>{armedUndo=null;render()},4000);play("tap");render();return}
    armedUndo=null;estornar(id);
  }
  else if(b.dataset.actor){play("tap");openSheet("pay",b.dataset.actor)}
  else if(b.id==="peekBtn"){peek=!peek;ls.set("pb-mask",peek?"1":"0");play("tap");render()}
});
$("#codeIn").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"")});
$("#joinCodeForm").onsubmit=e=>{
  e.preventDefault();actx();
  const c=$("#codeIn").value.trim().toUpperCase();
  if(c.length!==4){play("err");toast("O código tem 4 letras ou números.");return}
  if(!API){toast("O banco online não está configurado.");return}
  play("tap");$("#codeIn").value="";openMesa(c);
};
$("#setupForm").onsubmit=async e=>{
  e.preventDefault();actx();
  if(!API){toast("O banco online não está configurado.");return}
  const start=parseAmt($("#sStart").value),salary=parseAmt($("#sSalary").value);
  if(!start){play("err");toast("Coloque um saldo inicial.");return}
  const b=$("#createBtn");b.disabled=true;b.textContent="Abrindo…";
  try{const code=await API.rpc("pb_criar_mesa",{p_saldo_inicial:start,p_salario:salary});play("go");await openMesa(code)}
  catch(err){play("err");toast(err.network?"Sem internet. Para criar a mesa precisa de sinal.":err.config?"O banco online não está configurado.":err.message)}
  finally{b.disabled=false;b.textContent="Abrir o banco"}
};
$("#resumeBtn").onclick=()=>{actx();const last=ls.get("pb-ultima");if(last)openMesa(last)};
$("#waitBack").onclick=()=>leave(true);
$("#joinBack").onclick=()=>leave(false);
$("#joinForm").onsubmit=e=>{
  e.preventDefault();actx();
  const name=$("#jName").value.trim();
  if(!name){play("err");toast("Escreva seu nome.");$("#jName").focus();return}
  const id=uuid();
  L.me=id;forceJoin=false;
  enqueue({t:"entrar",id,nome:name,cor:joinColor,em:nowIso()});
  $("#jName").value="";play("go");toast("Cartão emitido: "+money(L.mesa.saldo_inicial));
};
$("#switchBtn").onclick=()=>{forceJoin=true;play("tap");render()};
let leaveT;$("#leaveBtn").onclick=e=>{
  const b=e.currentTarget;
  if(b.dataset.arm){clearTimeout(leaveT);delete b.dataset.arm;b.textContent="Sair da mesa";leave(false);return}
  b.dataset.arm="1";
  b.textContent=L&&L.out.length?`${L.out.length} lançamento(s) ainda não enviado(s). Toque de novo para sair`:"Toque de novo para sair";
  leaveT=setTimeout(()=>{delete b.dataset.arm;b.textContent="Sair da mesa"},4000);
};
$("#privBtn").onclick=()=>{
  const D=derive(),meP=D.P[L.me];if(!meP)return;const v=!meP.oculto;
  enqueue({t:"ocultar",id:L.me,oculto:v,em:nowIso()});play("tap");
  toast(v?"Seu saldo está oculto para a mesa":"Seu saldo voltou a aparecer");
};
$("#aPay").onclick=()=>{play("tap");openSheet("pay")};
$("#aRecv").onclick=()=>{play("tap");openSheet("recv")};
$("#aSalary").onclick=e=>{
  const b=e.currentTarget;b.disabled=true;setTimeout(()=>b.disabled=false,1200);
  const id=lancar(null,L.me,L.mesa.salario,"Passou pela partida");
  play("go");flashCard();
  toast("+ "+money(L.mesa.salario)+" na conta",{label:"Desfazer",run:()=>estornar(id)});
};

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
function openSheet(kind,actor){
  SH={kind,actor:actor||L.me,to:null,note:""};
  $("#shAmount").value="";
  const big=L.mesa.saldo_inicial>=10000;
  $("#shQuick").innerHTML=(big?[100,500,1000,5000]:[10,50,100,500]).map(v=>`<button data-add="${v}">+${v.toLocaleString("pt-BR")}</button>`).join("")+`<button data-add="0">Limpar</button>`;
  $("#scrim").hidden=false;$("#sheet").hidden=false;
  drawSheet();
  if(kind!=="salary"&&SH.actor===L.me)setTimeout(()=>$("#shAmount").focus(),60);
}
function closeSheets(){$("#scrim").hidden=true;$("#sheet").hidden=true;$("#invSheet").hidden=true}
function drawSheet(){
  const D=derive(),a=SH.actor,proxy=a!==L.me,p=D.P[a]||{},bal=balances(D)[a]||0;
  const hiddenBal=p.oculto&&proxy;
  $("#shDot").style.background=colorOf(p.cor).c;
  $("#shName").textContent=proxy?"Lançando por "+p.nome:"Seu cartão";
  $("#shBal").textContent="Saldo "+(hiddenBal?MASK:fmt(bal));
  document.querySelectorAll("#shTabs button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.kind===SH.kind)));
  $("#shToWrap").hidden=SH.kind!=="pay";
  $("#shAmtWrap").hidden=SH.kind==="salary";
  $("#shAmtLbl").textContent=SH.kind==="set"?"Saldo correto agora":"Valor";
  $("#shReasonWrap").hidden=!REASONS[SH.kind].length;
  $("#shHint").hidden=SH.kind!=="set";
  $("#shHint").textContent="Use para corrigir o saldo de alguém. O banco lança a diferença no extrato.";
  const others=playersArr(D).filter(x=>x.id!==a);
  $("#shTo").innerHTML=[{id:"bank",nome:"Banco"},...others].map(x=>`<button data-to="${esc(x.id)}" aria-pressed="${SH.to===x.id}">${x.cor?`<span class="pawn" style="background:${colorOf(x.cor).c}"></span>`:""}${esc(x.id===L.me?x.nome+" (você)":x.nome)}</button>`).join("");
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
    go.textContent=amt?(proxy?`${an} recebe ${money(amt)} do banco`:`Receber ${money(amt)} do banco`):"Digite o valor";go.disabled=!(amt>0);
  }else if(SH.kind==="salary"){
    go.textContent=(proxy?an+" recebe ":"Receber ")+money(L.mesa.salario)+" da partida";go.disabled=false;go.className="btn gold";
  }else{
    const d=amt-bal;
    go.textContent=has?`Deixar o saldo em ${money(amt)}`:"Digite o saldo correto";go.disabled=!has||d===0;
    if(has&&d!==0)warn.textContent=(d>0?"O banco paga ":"O banco recebe ")+money(d);
  }
}
$("#shTabs").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;SH.kind=b.dataset.kind;SH.to=null;SH.note="";$("#shAmount").value="";play("tap");drawSheet()});
$("#shClose").onclick=closeSheets;$("#scrim").onclick=closeSheets;
$("#shAmount").addEventListener("input",e=>{const raw=e.target.value;const n=parseAmt(raw);e.target.value=raw.replace(/\D/g,"")===""?"":"$ "+n.toLocaleString("pt-BR");drawSheet()});
$("#sheet").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||b.closest("#shTabs"))return;
  if(b.dataset.to){SH.to=b.dataset.to;play("tap");drawSheet()}
  else if(b.dataset.note){SH.note=SH.note===b.dataset.note?"":b.dataset.note;play("tap");drawSheet()}
  else if(b.dataset.add!==undefined){const v=+b.dataset.add;const n=v?parseAmt($("#shAmount").value)+v:0;$("#shAmount").value=n?"$ "+n.toLocaleString("pt-BR"):"";play("tap");drawSheet()}
});
$("#shGo").onclick=()=>{
  const D=derive(),a=SH.actor,an=nameOf(a,D),proxy=a!==L.me,amt=parseAmt($("#shAmount").value);
  const before=balances(D)[a];
  let id,msg,snd;
  if(SH.kind==="pay"){
    if(!(amt>0&&SH.to))return;
    const to=SH.to==="bank"?null:SH.to;
    id=lancar(a,to,amt,SH.note);msg=(proxy?an+" pagou ":"Pago: ")+money(amt)+" para "+nameOf(to,D);snd="pay";
  }else if(SH.kind==="recv"){
    if(!(amt>0))return;
    id=lancar(null,a,amt,SH.note);msg=(proxy?an+" recebeu ":"Recebido: ")+money(amt);snd="recv";
  }else if(SH.kind==="salary"){
    id=lancar(null,a,L.mesa.salario,"Passou pela partida");msg=an+" passou pela partida: + "+money(L.mesa.salario);snd="go";
  }else{
    const d=amt-before;if(!d)return;
    id=d>0?lancar(null,a,d,"Ajuste de saldo"):lancar(a,null,-d,"Ajuste de saldo");
    msg="Saldo de "+an+" ajustado para "+money(amt);snd="recv";
  }
  closeSheets();
  const after=balances(derive())[a];
  if(before>=0&&after<0){play("broke");toast(an+" ficou no vermelho!",{label:"Desfazer",run:()=>estornar(id)})}
  else{play(snd);toast(msg,{label:"Desfazer",run:()=>estornar(id)})}
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
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  box.hidden=false;
  $("#installBtn").hidden=!installEvt;
  $("#installText").textContent=ios
    ?"No Safari, toque em Compartilhar (o quadrado com a seta) e depois em \"Adicionar à Tela de Início\"."
    :installEvt?"Toque no botão abaixo para colocar o ícone na tela inicial.":"No Chrome, abra o menu ⋮ e toque em \"Instalar app\" ou \"Adicionar à tela inicial\".";
}
$("#installBtn").onclick=async()=>{if(!installEvt)return;installEvt.prompt();try{await installEvt.userChoice}catch(e){}installEvt=null;drawInstall()};

/* ---------- keep the screen on during the game ---------- */
let wake=null;
async function keepAwake(){try{if(!wake&&"wakeLock" in navigator&&document.visibilityState==="visible"){wake=await navigator.wakeLock.request("screen");wake.addEventListener("release",()=>{wake=null})}}catch(e){}}

/* ---------- start ---------- */
if("serviceWorker" in navigator&&location.protocol!=="file:"){navigator.serviceWorker.register("sw.js").catch(()=>{})}
const fromHash=(location.hash||"").replace("#","").toUpperCase().replace(/[^A-Z0-9]/g,"");
if(fromHash.length===4&&API)openMesa(fromHash);
else{
  const last=ls.get("pb-ultima"),saved=last&&loadMesa(last);
  if(saved&&saved.mesa&&API&&isStandalone())openMesa(last);else render();
}
window.addEventListener("hashchange",()=>{const h=(location.hash||"").replace("#","").toUpperCase();if(h.length===4&&API&&(!L||h!==L.codigo))openMesa(h)});
window.PORTI_DEBUG={state:()=>L,sync:syncNow};
})();
