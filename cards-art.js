/* PORTI BANK — desenhos das cartas: ponto turístico de cada cidade e bandeira de cada país.
   Tudo em SVG pequeno, sem imagens externas. Ícones em 40×40, bandeiras em 30×20. */
(function(){
const K='stroke="#252329" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"';
const SUN=(x,y,r,c)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${c||"#F7B733"}"/>`;
const GROUND=c=>`<path d="M0 34h40v6H0z" fill="${c||"#BFE3B4"}"/>`;
const PALM=(x,s)=>`<g transform="translate(${x} 0) scale(${s||1})"><path d="M0 34c.4-5 .2-9-.6-12" fill="none" ${K}/><path d="M-.6 22c-3-1.5-5.5-.7-6.6 1.3 2.4-.9 4.4-.6 6.6-1.3zM-.6 22c2.6-2.3 5.4-2.2 6.8-.6-2.3-.2-4.4.1-6.8.6zM-.6 22c-1.6-2.8-1-5.3.9-6.4-.6 2.3-.6 4.2-.9 6.4zM-.6 22c2.8-.4 5 .8 5.6 2.9-1.9-1.2-3.6-2-5.6-2.9z" fill="#3D9A4E" ${K}/></g>`;
const ICON={
 1:/* Cidade do Cabo: Montanha da Mesa e o mar */
  `<path d="M0 26h40v14H0z" fill="#5BB5E8"/><path d="M2 28 8 18l3-2.4h17l3.4 2.6L38 28z" fill="#8494A8" ${K}/><path d="M11 15.6h17" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M4 28c4-3 8-2 12-4 4 2 10 1 14 2 3 .5 5 1 8 2z" fill="#6FA86A" ${K}/><path d="M0 31h40v9H0z" fill="#3E9AD6"/><path d="M4 33.5q2-1 4 0t4 0M20 35.5q2-1 4 0t4 0" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"/>`,
 2:/* Londres: Big Ben */
  `${GROUND("#C9D9E8")}<path d="M15 34V13h10v21z" fill="#E3C27A" ${K}/><path d="M14.5 13h11L20 3.5z" fill="#6E5A3B" ${K}/><circle cx="20" cy="16.5" r="2.7" fill="#fff" ${K}/><path d="M20 15.2v1.4l1 .7" fill="none" stroke="#252329" stroke-width=".9" stroke-linecap="round"/><path d="M17 22h6M17 26h6M17 30h6" fill="none" stroke="#B08E45" stroke-width="1.1"/><path d="M11 34v-8h4v8M25 34v-8h4v8" fill="#D9B86F" ${K}/>`,
 3:/* Berlim: Portão de Brandemburgo */
  `${GROUND("#D8D2C4")}<path d="M5 16h30v4H5z" fill="#E6D3A3" ${K}/><path d="M7 20h3v14H7zM13.5 20h3v14h-3zM23.5 20h3v14h-3zM30 20h3v14h-3z" fill="#F0E2BA" ${K}/><path d="M6 34h28" fill="none" ${K}/><path d="M16 16v-3h8v3" fill="#E6D3A3" ${K}/><path d="M17.5 13c.5-2.5 1.5-3.5 2.5-4.5 1 1 2 2 2.5 4.5z" fill="#4F9C7A" ${K}/>`,
 4:/* Paris: Torre Eiffel */
  `${GROUND("#CFE3C8")}<path d="M19 4h2l1.2 9 2.5 10L29 34h-4.5c-1-4-2.6-6.4-4.5-6.4S16.5 30 15.5 34H11l4.3-11 2.5-10z" fill="#A9744A" ${K}/><path d="M16.5 23h7M18.2 13h3.6" fill="none" ${K}/><path d="M20 1.5V4" fill="none" ${K}/>`,
 5:/* Ottawa: Torre da Paz do Parlamento */
  `${GROUND("#CFE3C8")}<path d="M5 34V24h9v10M26 34V24h9v10" fill="#E3D2A8" ${K}/><path d="M16 34V13h8v21z" fill="#E9DAB2" ${K}/><path d="M15.5 13h9L20 5z" fill="#5BAE8C" ${K}/><path d="M20 5V2" fill="none" ${K}/><circle cx="20" cy="17" r="2" fill="#fff" ${K}/><path d="M18 34v-5a2 2 0 0 1 4 0v5" fill="#8D6B3E" ${K}/><path d="M7 27h2M11 27h1M28 27h2M32 27h1" fill="none" stroke="#8D6B3E" stroke-width="1.2"/>`,
 6:/* Washington: Capitólio */
  `${GROUND("#CFE3C8")}<path d="M4 34v-8h32v8z" fill="#F4F4F2" ${K}/><path d="M13 26v-4h14v4z" fill="#FAFAF8" ${K}/><path d="M14 22c0-6 2.6-9 6-9s6 3 6 9z" fill="#fff" ${K}/><path d="M18 13.2V10h4v3.2" fill="#fff" ${K}/><path d="M20 10V7.5" fill="none" ${K}/><path d="M8 28v6M12 28v6M16 28v6M24 28v6M28 28v6M32 28v6" fill="none" stroke="#9AA3AE" stroke-width="1"/>`,
 7:/* Cairo: pirâmides */
  `${SUN(31,10,3.4,"#F7B733")}<path d="M0 34h40v6H0z" fill="#EBD69A"/><path d="M3 34 14 19l11 15z" fill="#EDB64D" ${K}/><path d="M14 19l4 15h7z" fill="#C98E2E"/><path d="M20 34l9-12 9 12z" fill="#EDB64D" ${K}/><path d="M29 22l3 12h6z" fill="#C98E2E"/><path d="M3 34 14 19l11 15M20 34l9-12 9 12" fill="none" ${K}/>`,
 8:/* Luanda: Fortaleza de São Miguel e palmeira */
  `${GROUND("#E9D6A2")}<path d="M3 34V22h3v-2h2v2h2v-2h2v2h2v-2h2v2h2v12z" fill="#E8C46F" ${K}/><path d="M12 34V14h2v-2h2v2h2v-2h2v2h1v20z" fill="#F0D184" ${K}/><path d="M14.5 34v-4a1.5 1.5 0 0 1 3 0v4" fill="#3D9A4E" ${K}/><path d="M16 18h2M16 22h2" fill="none" stroke="#B9923C" stroke-width="1.2"/>${PALM(30)}`,
 9:/* Doha: museu em pedra, degraus */
  `${GROUND("#EDD9A8")}<path d="M5 34V27h4v-4h5v-5h4v-5h4v5h4v5h5v4h4v7z" fill="#E7C27D" ${K}/><path d="M18 13v-2h4v2" fill="#E7C27D" ${K}/><path d="M18 34v-4a2 2 0 0 1 4 0v4" fill="#7A5A2E" ${K}/><path d="M12 30h2M26 30h2M16 25h2M22 25h2M19 18h2" fill="none" stroke="#9C7A3E" stroke-width="1.3"/>`,
 10:/* Riade: Kingdom Centre */
  `${GROUND("#EDD9A8")}<path d="M14 34V14c0-6 2.6-10 6-10s6 4 6 10v20z" fill="#5FA8D8" ${K}/><path d="M17.2 6.5c.6 4 1.6 6.3 2.8 7.5 1.2-1.2 2.2-3.5 2.8-7.5-.8-1.3-1.8-2-2.8-2s-2 .7-2.8 2z" fill="#FCEAD0" ${K}/><path d="M17 16h6" fill="none" ${K}/><path d="M20 18v14" fill="none" stroke="#A9D4F0" stroke-width="1.2"/><path d="M8 34v-7h4v7M28 34v-9h4v9" fill="#9CC8E6" ${K}/>${PALM(5,.8)}${PALM(36,.8)}`,
 11:/* Abu Dhabi: Grande Mesquita */
  `${GROUND("#EDE3C8")}<path d="M9 34V25h22v9z" fill="#fff" ${K}/><path d="M14 25c0-5 2.7-7.5 6-7.5s6 2.5 6 7.5z" fill="#fff" ${K}/><path d="M20 17.5V15" fill="none" ${K}/><circle cx="20" cy="14.3" r=".8" fill="#E9B23A"/><path d="M5 34V15h2v19M33 34V15h2v19" fill="#fff" ${K}/><path d="M5 15l1-3 1 3M33 15l1-3 1 3" fill="#E9B23A" ${K}/><path d="M18 34v-4a2 2 0 0 1 4 0v4M12 30v-2M28 30v-2" fill="#5FA8D8" ${K}/>${PALM(2,.6)}${PALM(38,.6)}`,
 12:/* Cidade do México: pirâmide do Sol */
  `${SUN(31,9,3,"#F7B733")}${GROUND("#D9C99B")}<path d="M4 34l3-5h26l3 5z" fill="#C9824A" ${K}/><path d="M8 29l3-5h18l3 5z" fill="#D49158" ${K}/><path d="M12 24l3-5h10l3 5z" fill="#DE9F66" ${K}/><path d="M16 19v-3h8v3z" fill="#B86D37" ${K}/><path d="M20 34V16" fill="none" stroke="#8E5326" stroke-width="1.3" stroke-dasharray="1.4 1.2"/>`,
 13:/* Cidade da Guatemala: vulcão */
  `<path d="M24 9c2-3 5-3 6 0 2-1 4 1 3 3h-9c-1-1-1-2 0-3z" fill="#fff" ${K}/><path d="M3 34l11-18h7l11 18z" fill="#7D8A99" ${K}/><path d="M14 16h7l2 4-3-1-2 2-3-2-3 1z" fill="#fff" ${K}/>${GROUND("#8CC97A")}<path d="M0 34c6-3 12-3 18 0s14 3 22 0v6H0z" fill="#6BB560" ${K}/>`,
 14:/* Seul: N Seoul Tower no morro */
  `<path d="M19.2 28V12h1.6v16z" fill="#fff" ${K}/><path d="M16.5 14h7l-1 3h-5z" fill="#E3E8EF" ${K}/><path d="M20 12V5" fill="none" ${K}/><path d="M18 9.5h4" fill="none" stroke="#E5534B" stroke-width="1.4"/><path d="M0 40V31c6-5 12-7 20-7s14 2 20 7v9z" fill="#5BAE6A" ${K}/><path d="M6 31c2-1 3-1 5 0M28 30c2-1 3-1 5 0" fill="none" stroke="#3E8A4E" stroke-width="1.2"/>`,
 15:/* Pequim: Templo do Céu */
  `${GROUND("#E6E0D2")}<path d="M8 34v-3h24v3z" fill="#fff" ${K}/><path d="M12 31v-5h16v5z" fill="#D9473C" ${K}/><path d="M9 26c3-2 7-3 11-3s8 1 11 3z" fill="#3B6FB6" ${K}/><path d="M14 23v-4h12v4z" fill="#D9473C" ${K}/><path d="M11.5 19c2.5-1.8 5.5-2.6 8.5-2.6s6 .8 8.5 2.6z" fill="#3B6FB6" ${K}/><path d="M16.5 16.4v-3h7v3z" fill="#D9473C" ${K}/><path d="M14.5 13.4c1.6-1.6 3.5-2.3 5.5-2.3s3.9.7 5.5 2.3z" fill="#3B6FB6" ${K}/><path d="M20 11V7.5" fill="none" ${K}/><circle cx="20" cy="7" r="1.1" fill="#E9B23A" ${K}/>`,
 16:/* Tóquio: portal torii e monte Fuji */
  `<path d="M14 25l8-12 8 12z" fill="#A9BFD8" ${K}/><path d="M18.5 19.2 22 13l3.5 6.2-2-1-1.5 1.4-1.5-1.4z" fill="#fff" stroke="#252329" stroke-width="1" stroke-linejoin="round"/>${GROUND("#CFE3C8")}<path d="M6 12c5 1.3 9.7 1.6 14 1.6S29 13.3 34 12l-.8 3H6.8z" fill="#D9412E" ${K}/><path d="M9 18h22v2.2H9z" fill="#D9412E" ${K}/><path d="M11.5 15v19h2.6V15M25.9 15v19h2.6V15" fill="#D9412E" ${K}/><path d="M18.7 15h2.6v3h-2.6z" fill="#D9412E" ${K}/>`,
 17:/* Buenos Aires: Obelisco */
  `${GROUND("#CFE3C8")}<path d="M17 34l1.3-25h3.4L23 34z" fill="#F3F1EA" ${K}/><path d="M18.3 9 20 5.5 21.7 9z" fill="#E0DDD3" ${K}/><path d="M20 12v20" fill="none" stroke="#C9C5B8" stroke-width="1"/><path d="M6 34v-5h7v5M27 34v-7h7v7" fill="#F2D07A" ${K}/><path d="M11 34h18" fill="none" ${K}/>`,
 18:/* Camberra: Parlamento e mastro */
  `${GROUND("#BFE3B4")}<path d="M2 34c6-4 12-5 18-5s12 1 18 5z" fill="#7DC27A" ${K}/><path d="M14 29.4 20 8l6 21.4" fill="none" ${K}/><path d="M17 29.2 20 8l3 21.2" fill="none" stroke="#252329" stroke-width="1"/><path d="M20 8V3.5" fill="none" ${K}/><path d="M20 3.5h6v3.4h-6z" fill="#2E4FA3" ${K}/><path d="M8 31h24" fill="none" stroke="#fff" stroke-width="1.2"/>`,
 19:/* Wellington: bondinho vermelho no morro */
  `<path d="M0 40V22c8 0 16 4 24 9s12 6 16 6v3z" fill="#5BAE6A" ${K}/><path d="M2 8l36 22" fill="none" stroke="#252329" stroke-width="1.1"/><path d="M19 19.4v-2.6" fill="none" ${K}/><path d="M13 21.5l2-3.5 10 6-2 3.5z" fill="#D9412E" ${K}/><path d="M15.3 21.6l1-1.8 2.6 1.6-1 1.8zM19.8 24.4l1-1.8 2.4 1.5-1 1.8z" fill="#CFE8F7"/><path d="M0 40V33c10 0 18 2 26 4l14 1v2z" fill="#3E8A4E"/>`,
 20:/* São José: Teatro Nacional */
  `${GROUND("#CFE3C8")}<path d="M6 34V20h28v14z" fill="#F2E3BF" ${K}/><path d="M5 20l15-8 15 8z" fill="#E9D3A0" ${K}/><path d="M10 22v12M15 22v12M25 22v12M30 22v12" fill="none" stroke="#252329" stroke-width="1.6"/><path d="M18 34v-5a2 2 0 0 1 4 0v5" fill="#7A5A2E" ${K}/><circle cx="20" cy="16.6" r="1.6" fill="#E9B23A" ${K}/><path d="M17 10h6" fill="none" stroke="#E9B23A" stroke-width="1.6" stroke-linecap="round"/>`,
 23:/* Santiago: Andes nevados e a torre Costanera */
  `<path d="M0 30l9-14 6 7 7-11 9 11 9 7v10H0z" fill="#8494A8" ${K}/><path d="M9 16l3 3.5-2.3-.6L8 21l-1.6-1zM22 12l4 5-3-.8-2 2-2-2.4z" fill="#fff" stroke="#252329" stroke-width="1" stroke-linejoin="round"/><path d="M27 34V12l4-3v25z" fill="#6FB6E3" ${K}/><path d="M29 12v22" fill="none" stroke="#B8DDF3" stroke-width="1"/>${GROUND("#CFE3C8")}<path d="M27 34V12l4-3v25" fill="none" ${K}/>`,
 24:/* Montevidéu: Palacio Salvo */
  `${GROUND("#CFE3C8")}<path d="M10 34V20h20v14z" fill="#E8D5B0" ${K}/><path d="M15 20v-6h10v6z" fill="#EEDDBA" ${K}/><path d="M17 14v-4h6v4z" fill="#EEDDBA" ${K}/><path d="M18 10l2-4 2 4z" fill="#C79A55" ${K}/><path d="M20 6V2.5" fill="none" ${K}/><path d="M13 23h2M17 23h2M21 23h2M25 23h2M13 27h2M17 27h2M21 27h2M25 27h2M18 16.5h4" fill="none" stroke="#9C7A3E" stroke-width="1.4"/>`,
 21:/* OMC: comércio entre países */
  `<circle cx="20" cy="20" r="11" fill="#7FC4EC" ${K}/><path d="M12 15c3 1 4 4 7 3s2-5 6-4M14 26c2-2 5-1 6 1s4 1 6-1" fill="none" stroke="#3D9A4E" stroke-width="2.4" stroke-linecap="round"/><path d="M5 12c3-5 9-8 15-8M35 28c-3 5-9 8-15 8" fill="none" ${K} stroke-width="1.6"/><path d="M18 1.8 21 4l-2.7 2.5M22 38.2 19 36l2.7-2.5" fill="none" ${K} stroke-width="1.6"/>`,
 22:/* ONU: globo e ramos de oliveira */
  `<circle cx="20" cy="19" r="9.5" fill="#fff" ${K}/><path d="M20 9.5v19M10.5 19h19M13 12.5c4 2 10 2 14 0M13 25.5c4-2 10-2 14 0" fill="none" stroke="#5B92E5" stroke-width="1.1"/><path d="M9 30c-4-4-5-11-2-17M31 30c4-4 5-11 2-17" fill="none" ${K}/><path d="M7.4 16.5l-2.4-1M6.8 21.5l-2.6-.4M7.8 26.2l-2.4.6M32.6 16.5l2.4-1M33.2 21.5l2.6-.4M32.2 26.2l2.4.6" fill="none" stroke="#3D9A4E" stroke-width="2" stroke-linecap="round"/>`,
 25:/* OIT: engrenagem e capacete */
  `<path d="M20 6l2.2 3.2 3.8-.9.6 3.8 3.6 1.4-1.4 3.6 2.6 2.9-2.9 2.6 1.4 3.6-3.6 1.4-.6 3.8-3.8-.9L20 34l-2.2-3.2-3.8.9-.6-3.8-3.6-1.4 1.4-3.6L8.6 20l2.6-2.9-1.4-3.6 3.6-1.4.6-3.8 3.8.9z" fill="#9AA3AE" ${K}/><circle cx="20" cy="20" r="6.4" fill="#fff" ${K}/><path d="M15.6 22.2c0-3 2-5 4.4-5s4.4 2 4.4 5zM14.6 22.2h10.8" fill="#F7B733" ${K}/>`,
 26:/* OTAN: rosa dos ventos */
  `<circle cx="20" cy="20" r="13" fill="#fff" ${K}/><path d="M20 4l3 13 13 3-13 3-3 13-3-13-13-3 13-3z" fill="#2E4FA3" ${K}/><path d="M20 4v32M4 20h32" fill="none" stroke="#fff" stroke-width="1"/><circle cx="20" cy="20" r="2" fill="#fff" ${K}/>`,
 27:/* IPCC: clima — termômetro e folha */
  `<path d="M24 31c-6 0-10-4-9-11 6-1 11 2 12 7 .5-5 3-9 9-11 1 7-3 13-12 15z" fill="#5BAE6A" ${K}/><path d="M16 21c4 2 7 5 8 10M36 16c-4 3-7 7-9 11" fill="none" stroke="#3E8A4E" stroke-width="1.1"/><path d="M8 25V9a3 3 0 0 1 6 0v16a5 5 0 1 1-6 0z" fill="#fff" ${K}/><path d="M11 13v14" fill="none" stroke="#E5534B" stroke-width="2.4" stroke-linecap="round"/><circle cx="11" cy="29" r="3" fill="#E5534B"/>`,
 28:/* OMS: saúde — cruz e bastão */
  `<circle cx="20" cy="20" r="13" fill="#fff" ${K}/><path d="M16.5 9h7v7.5H31v7h-7.5V31h-7v-7.5H9v-7h7.5z" fill="#E5534B" ${K}/><path d="M20 10v20" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M18 14c3 0 3 3 0 3s-3 3 0 3 3 3 0 3" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`
};
/* bandeiras simplificadas (30×20) */
const R=(x,y,w,h,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const STAR=(cx,cy,r,c)=>{let p="";for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.42:r;p+=(i?"L":"M")+(cx+rr*Math.cos(a)).toFixed(2)+" "+(cy+rr*Math.sin(a)).toFixed(2)}return `<path d="${p}Z" fill="${c}"/>`};
const UNION=`<g>${R(0,0,15,10,"#1F3F8F")}<path d="M0 0l15 10M15 0 0 10" stroke="#fff" stroke-width="2.4"/><path d="M0 0l15 10M15 0 0 10" stroke="#C8102E" stroke-width=".9"/><path d="M7.5 0v10M0 5h15" stroke="#fff" stroke-width="3.2"/><path d="M7.5 0v10M0 5h15" stroke="#C8102E" stroke-width="1.8"/></g>`;
const SUNF=(cx,cy,r,c)=>{let p="";for(let i=0;i<16;i++){const a=i*Math.PI/8;p+=`M${(cx+r*.9*Math.cos(a)).toFixed(2)} ${(cy+r*.9*Math.sin(a)).toFixed(2)}L${(cx+r*1.55*Math.cos(a)).toFixed(2)} ${(cy+r*1.55*Math.sin(a)).toFixed(2)}`}return `<path d="${p}" stroke="${c}" stroke-width=".8"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`};
const FLAG={
 "África do Sul":`${R(0,0,30,10,"#E03C31")}${R(0,10,30,10,"#001489")}<path d="M0 0l13 10L0 20z" fill="#fff"/><path d="M0 0h4l13 7.6H30v4.8H17L4 20H0z" fill="#fff"/><path d="M0 1.6 13 10 0 18.4z" fill="#FFB81C"/><path d="M0 2.4h1.8L14.8 8.6H30v2.8H14.8L1.8 17.6H0z" fill="#007749"/><path d="M0 4.2 9 10l-9 5.8z" fill="#000"/>`,
 "Inglaterra":`${R(0,0,30,20,"#fff")}${R(12.5,0,5,20,"#CE1124")}${R(0,7.5,30,5,"#CE1124")}`,
 "Alemanha":`${R(0,0,30,6.67,"#000")}${R(0,6.67,30,6.67,"#DD0000")}${R(0,13.33,30,6.67,"#FFCE00")}`,
 "França":`${R(0,0,10,20,"#0055A4")}${R(10,0,10,20,"#fff")}${R(20,0,10,20,"#EF4135")}`,
 "Canadá":`${R(0,0,30,20,"#fff")}${R(0,0,7.5,20,"#D52B1E")}${R(22.5,0,7.5,20,"#D52B1E")}<path d="M15 4.2l1 2 1.4-.6-.6 3.4 1.8-1.6.5 1.2 1.9-.3-.7 1.9.9.4-3 2.4.4 1.3-2.8-.4v2.7h-.6v-2.7l-2.8.4.4-1.3-3-2.4.9-.4-.7-1.9 1.9.3.5-1.2 1.8 1.6-.6-3.4 1.4.6z" fill="#D52B1E"/>`,
 "EUA":`${R(0,0,30,20,"#fff")}${[0,2,4,6,8,10,12].map(i=>R(0,i*20/13,30,20/13,"#B22234")).join("")}${R(0,0,13,10.8,"#3C3B6E")}${[0,1,2].map(r=>[0,1,2,3].map(c=>`<circle cx="${2+c*3}" cy="${2+r*3.3}" r=".55" fill="#fff"/>`).join("")).join("")}`,
 "Egito":`${R(0,0,30,6.67,"#CE1126")}${R(0,6.67,30,6.67,"#fff")}${R(0,13.33,30,6.67,"#000")}<path d="M13.6 8.2h2.8l-.4 2.6 1.2.5-1.2 1h-2l-1.2-1 1.2-.5z" fill="#C09300"/>`,
 "Angola":`${R(0,0,30,10,"#CC092F")}${R(0,10,30,10,"#000")}<path d="M17.6 6.2a4.6 4.6 0 1 1-6.4 7.4" fill="none" stroke="#FFCB00" stroke-width="1.2"/><path d="M11.2 13.2l6.4-4.4" stroke="#FFCB00" stroke-width="1.2"/>${STAR(12.8,8,1.5,"#FFCB00")}`,
 "Catar":`${R(0,0,30,20,"#8A1538")}<path d="M0 0h9l3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1 3 1.1-3 1.1H0z" fill="#fff"/>`,
 "Arábia Saudita":`${R(0,0,30,20,"#006C35")}<path d="M7 7.5c1-1 2 1 3 0s2 1 3 0 2 1 3 0 2 1 3 0 2 1 3 0" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/><path d="M8 9.5c1-1 2 1 3 0s2 1 3 0 2 1 3 0 2 1 3 0" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/><path d="M8 13.4h14.5M20.5 12.2l2 1.2-2 1.2M9.4 12.4v2" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>`,
 "Emirados Árabes":`${R(0,0,30,6.67,"#00732F")}${R(0,6.67,30,6.67,"#fff")}${R(0,13.33,30,6.67,"#000")}${R(0,0,8,20,"#FF0000")}`,
 "México":`${R(0,0,10,20,"#006847")}${R(10,0,10,20,"#fff")}${R(20,0,10,20,"#CE1126")}<ellipse cx="15" cy="10" rx="2.6" ry="2.4" fill="#8C5A2B"/><path d="M12.4 11.6c1.4 1.4 3.8 1.4 5.2 0" fill="none" stroke="#006847" stroke-width=".8"/>`,
 "Guatemala":`${R(0,0,10,20,"#4997D0")}${R(10,0,10,20,"#fff")}${R(20,0,10,20,"#4997D0")}<circle cx="15" cy="10" r="2.6" fill="none" stroke="#3D9A4E" stroke-width="1"/><circle cx="15" cy="10" r="1" fill="#E9B23A"/>`,
 "Coreia do Sul":`${R(0,0,30,20,"#fff")}<circle cx="15" cy="10" r="4.4" fill="#0047A0"/><path d="M10.6 10a4.4 4.4 0 0 1 8.8 0 2.2 2.2 0 0 1-4.4 0 2.2 2.2 0 0 0-4.4 0z" fill="#CD2E3A"/><path d="M4.6 4.4l3-2.2M5.4 5.4l3-2.2M6.2 6.4l3-2.2M21.6 13.6l3 2.2M22.4 12.6l3 2.2M20.8 14.6l3 2.2M4.6 15.6l3 2.2M5.4 14.6l3 2.2M22.4 7.4l3-2.2M21.6 6.4l3-2.2" stroke="#000" stroke-width=".7"/>`,
 "China":`${R(0,0,30,20,"#EE1C25")}${STAR(5.5,5,3,"#FFFF00")}${STAR(10.5,2,1,"#FFFF00")}${STAR(12.5,4.2,1,"#FFFF00")}${STAR(12.5,7.2,1,"#FFFF00")}${STAR(10.5,9.2,1,"#FFFF00")}`,
 "Japão":`${R(0,0,30,20,"#fff")}<circle cx="15" cy="10" r="5.4" fill="#BC002D"/>`,
 "Argentina":`${R(0,0,30,6.67,"#74ACDF")}${R(0,6.67,30,6.67,"#fff")}${R(0,13.33,30,6.67,"#74ACDF")}${SUNF(15,10,1.6,"#F6B40E")}`,
 "Austrália":`${R(0,0,30,20,"#012169")}${UNION}${STAR(7.5,15,2.2,"#fff")}${STAR(22.5,4,1.1,"#fff")}${STAR(19,9,1.1,"#fff")}${STAR(26,8,1.1,"#fff")}${STAR(22.5,16,1.2,"#fff")}`,
 "Nova Zelândia":`${R(0,0,30,20,"#012169")}${UNION}${STAR(22.5,4.6,1.3,"#fff")}${STAR(22.5,4.6,.8,"#C8102E")}${STAR(19.5,9.4,1.3,"#fff")}${STAR(19.5,9.4,.8,"#C8102E")}${STAR(25.8,8.6,1.3,"#fff")}${STAR(25.8,8.6,.8,"#C8102E")}${STAR(22.5,15.6,1.4,"#fff")}${STAR(22.5,15.6,.9,"#C8102E")}`,
 "Costa Rica":`${R(0,0,30,20,"#002B7F")}${R(0,3.33,30,13.33,"#fff")}${R(0,6.67,30,6.67,"#CE1126")}`,
 "Chile":`${R(0,0,30,10,"#fff")}${R(0,10,30,10,"#D52B1E")}${R(0,0,10,10,"#0039A6")}${STAR(5,5,2.4,"#fff")}`,
 "Uruguai":`${R(0,0,30,20,"#fff")}${[1,3,5,7].map(i=>R(0,i*20/9,30,20/9,"#0038A8")).join("")}${R(0,0,12,11.1,"#fff")}${SUNF(6,5.55,1.9,"#FCD116")}`
};
/* emblemas das organizações (no lugar da bandeira) */
const ORG={
 21:["#1F6FB2",`<circle cx="15" cy="10" r="5.4" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M9.6 10h10.8M15 4.6c-2 3.2-2 7.6 0 10.8M15 4.6c2 3.2 2 7.6 0 10.8" fill="none" stroke="#fff" stroke-width=".9"/>`],
 22:["#5B92E5",`<circle cx="15" cy="10" r="4.6" fill="none" stroke="#fff" stroke-width="1.1"/><path d="M15 5.4v9.2M10.4 10h9.2M12 7c2 1 4 1 6 0M12 13c2-1 4-1 6 0" fill="none" stroke="#fff" stroke-width=".7"/><path d="M8.6 15c-2-2.4-2.4-6-.6-9M21.4 15c2-2.4 2.4-6 .6-9" fill="none" stroke="#fff" stroke-width="1"/>`],
 25:["#1C4E9A",`<circle cx="15" cy="10" r="4.4" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="1.6 1.2"/><circle cx="15" cy="10" r="2" fill="#fff"/>`],
 26:["#18305F",`<path d="M15 3l1.6 5.4L22 10l-5.4 1.6L15 17l-1.6-5.4L8 10l5.4-1.6z" fill="#fff"/><circle cx="15" cy="10" r="5.6" fill="none" stroke="#fff" stroke-width=".7"/>`],
 27:["#2C8A5B",`<path d="M10 14c0-5 4-8 10-8 0 6-3 9-8 9" fill="#fff"/><path d="M10 15.5c2-3 4.5-5 8-7" fill="none" stroke="#2C8A5B" stroke-width=".9"/>`],
 28:["#2F7DC1",`<path d="M13 4.5h4v3.5h3.5v4H17v3.5h-4V12H9.5V8H13z" fill="#fff"/>`]
};
window.PB_ART={
  icon:id=>ICON[id]?`<svg viewBox="0 0 40 40" aria-hidden="true">${ICON[id]}</svg>`:"",
  flag:(c)=>{
    if(c.acao){const o=ORG[c.id]||["#555",""];return `<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="${o[0]}"/>${o[1]}</svg>`}
    const f=FLAG[c.pais];return f?`<svg viewBox="0 0 30 20" aria-hidden="true" preserveAspectRatio="none">${f}</svg>`:"";
  }
};
})();
