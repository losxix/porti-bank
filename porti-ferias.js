/* PORTI BANK · Férias 2.0 · arte 3D original e animação em camadas.
   Carregue porti-ferias.css e este arquivo; preserve a pasta assets ao lado.
   PortiFerias.sair({nome:'Bia',foto:'https://...',cor:'#2453c4'});
   PortiFerias.voltar({nome:'Bia',foto:'https://...',cor:'#2453c4'});
   Somente apresentação. Não altera regras, saldos ou sincronização. */
(function(global){'use strict';
 const script=document.currentScript;
 let base;try{base=script&&script.src?new URL('.',script.src).href:new URL('.',document.baseURI||location.href).href}catch(e){base='https://porti.invalid/'}
 const ASSETS=global.PORTI_FERIAS_ASSETS||{carro:new URL('assets/carro-ferias.png',base).href,cenario:new URL('assets/barreirinhas.png',base).href,logo:new URL('assets/logo.webp',base).href};
 const cached={};let active=null,seq=0;
 function preload(src){if(cached[src])return cached[src];cached[src]=new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(true);im.onerror=()=>resolve(false);im.src=src;if(im.complete)resolve(im.naturalWidth>0)});return cached[src]}
 const prepared=Promise.all([ASSETS.carro,ASSETS.cenario,ASSETS.logo].map(preload));
 const cleanName=value=>String(value||'Jogador').trim().slice(0,50)||'Jogador';
 function cleanPhoto(value){if(typeof value!=='string')return '';if(/^(https?:\/\/|blob:|data:image\/(?:png|jpeg|webp|gif|avif);base64,)/i.test(value)||/^(\.\.?\/|\/)[^\s<>]+$/.test(value)||/^[a-z0-9_.%/-]+\.(?:png|jpe?g|webp|gif|avif)(?:[?#][^\s<>]*)?$/i.test(value))return value;return ''}
 function finish(reason='fechada'){if(!active)return;const a=active;active=null;clearTimeout(a.timer);if(a.root)a.root.remove();document.removeEventListener('keydown',a.key);a.resolve({reason});if(a.focus&&a.focus.isConnected)a.focus.focus({preventScroll:true})}
 function travel(options={},back=false){finish('substituida');if(typeof options==='string')options={nome:options};if(!options||typeof options!=='object')options={};
  const name=cleanName(options.nome),photo=cleanPhoto(options.foto||options.avatar),color=/^#[a-f\d]{3,8}$/i.test(options.cor||'')?options.cor:'#ffd12b';
  const id='pfv2-'+(++seq),reduce=!!(global.matchMedia&&global.matchMedia('(prefers-reduced-motion: reduce)').matches),duration=reduce?3000:6000;
  let token;const promise=new Promise(resolve=>{token={resolve,root:null,timer:null,key:()=>{},focus:document.activeElement};active=token});
  prepared.then(()=>{if(active!==token)return;const root=document.createElement('div');token.root=root;root.className='pf2-overlay '+(back?'pf2-back':'pf2-out')+(reduce?' pf2-reduced':'');root.style.setProperty('--pf2-duration',duration+'ms');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby',id+'-title');
   root.innerHTML=`<section class="pf2-card"><div class="pf2-stage"><div class="pf2-world"><img class="pf2-background" alt="Dunas e lagoas de Barreirinhas ao pôr do sol"><div class="pf2-sign"><span></span><strong>BARREIRINHAS</strong><b aria-hidden="true">→</b></div></div><img class="pf2-logo" alt="Porti Bank"><button class="pf2-close" aria-label="Fechar animação" type="button"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button><div class="pf2-car"><img alt="Carro amarelo de viagem com malas no teto e motorista"></div><div class="pf2-stage-vignette"></div></div><div class="pf2-caption"><div class="pf2-heading-label"></div><h2 class="pf2-title" id="${id}-title"><span></span><strong></strong></h2><div class="pf2-player"><span class="pf2-avatar"><span></span><img alt="Foto do jogador" hidden></span><div><b class="pf2-name"></b><span class="pf2-status"></span></div><span class="pf2-player-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 11 18-7-7 18-3-8-8-3Zm8 3 5-5"/></svg></span></div><div class="pf2-route"><span></span><i></i><b></b></div></div><div class="pf2-progress" aria-hidden="true"><span></span></div></section>`;
   root.querySelector('.pf2-background').src=ASSETS.cenario;root.querySelector('.pf2-car img').src=ASSETS.carro;root.querySelector('.pf2-logo').src=ASSETS.logo;
   root.querySelector('.pf2-sign span').textContent=back?'ATÉ A PRÓXIMA':'DESTINO';
   root.querySelector('.pf2-heading-label').textContent=back?'DESCANSO CONCLUÍDO':'O DESCANSO TÁ ON';
   root.querySelector('.pf2-title span').textContent=back?'DE VOLTA':'PARTIU';root.querySelector('.pf2-title strong').textContent=back?'AO JOGO!':'FÉRIAS!';
   root.querySelector('.pf2-name').textContent=name;root.querySelector('.pf2-status').textContent=back?'voltou das férias.':'saiu de férias. A resenha espera.';
   root.querySelector('.pf2-route span').textContent=back?'BARREIRINHAS':'PORTINARI';root.querySelector('.pf2-route b').textContent=back?'PORTINARI':'BARREIRINHAS';
   const av=root.querySelector('.pf2-avatar'),initial=root.querySelector('.pf2-avatar span');initial.textContent=Array.from(name)[0].toLocaleUpperCase('pt-BR');av.style.background=color;let hc=color.slice(1);if(hc.length===3)hc=hc.split('').map(x=>x+x).join('');const rgb=parseInt(hc.slice(0,6),16);av.style.color=((rgb>>16&255)*.299+(rgb>>8&255)*.587+(rgb&255)*.114)>155?'#211f29':'#fff9e8';
   if(photo){const im=root.querySelector('.pf2-avatar img');im.onload=()=>{im.hidden=false;initial.hidden=true};im.src=photo}
   root.querySelector('.pf2-close').onclick=()=>finish();root.onclick=e=>{if(e.target===root)finish()};token.key=e=>{if(e.key==='Escape'){e.preventDefault();finish()}if(e.key==='Tab'){e.preventDefault();root.querySelector('.pf2-close').focus()}};document.addEventListener('keydown',token.key);document.body.appendChild(root);root.querySelector('.pf2-close').focus({preventScroll:true});token.timer=setTimeout(()=>finish('concluida'),duration);
  });return promise;
 }
 global.PortiFerias={sair:options=>travel(options,false),voltar:options=>travel(options,true),fechar:()=>finish(),preparar:()=>prepared,versao:'2.0.0'};
})(window);
