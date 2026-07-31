const GEO = window.GEO_DATA;
const PONTOS = window.PTS_DATA;
document.getElementById('genDate').textContent = new Date().toLocaleDateString('pt-BR');

const MUN_LOOKUP = new Map();
GEO.features.forEach(f=> MUN_LOOKUP.set(f.properties.cod_mun, f.properties));
PONTOS.forEach(p=>{
  const mp = MUN_LOOKUP.get(p.m);
  p.nm_polo = mp ? mp.nm_polo : null;
  p.nm_msb = mp ? mp.nm_msb : null;
});

const PR_LEVELS = ['P1','P2','P3','P4','P5','sem'];
const PR_LABELS = {P1:'Prioridade 1 (mais urgente)', P2:'Prioridade 2', P3:'Prioridade 3', P4:'Prioridade 4', P5:'Prioridade 5 (menos urgente)', sem:'Sem informação'};
const PR_COLORS_HEX = {P1:'#B3261E', P2:'#E4572E', P3:'#E2A63C', P4:'#8FB93E', P5:'#2E7D46', sem:'#9AA5B1'};

// ---------------- estado compartilhado entre as 5 abas ----------------
let state = {
  tab: 'agua',                 // 'agua' | 'esgoto' | 'agua_rural' | 'esgoto_rural' | 'aglomerados'
  groupBy: 'polo', regiao: 'todas', selectedMun: null,   // filtros compartilhados
  compIndicadorAgua: 'rural', compIndicadorEsgoto: 'rural',
  mapIndicadorRuralAgua: 'aglom', mapIndicadorRuralEsgoto: 'aglom',
  indicadorAglom: 'agua',
};

function fmt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function fmt1(n){ return (n||0).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}); }

function colorForPct(p){
  const stops = [ {v:0,c:[46,125,70]}, {v:25,c:[143,185,62]}, {v:50,c:[226,166,60]}, {v:75,c:[228,87,46]}, {v:100,c:[179,38,30]} ];
  let lo=stops[0], hi=stops[stops.length-1];
  for(let i=0;i<stops.length-1;i++){ if(p>=stops[i].v && p<=stops[i+1].v){ lo=stops[i]; hi=stops[i+1]; break; } }
  const t = (hi.v===lo.v) ? 0 : (p-lo.v)/(hi.v-lo.v);
  const c = lo.c.map((x,i)=>Math.round(x + (hi.c[i]-x)*t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function categoryColors(cats){
  const goodIdx=[], badIdx=[];
  cats.forEach((c,i)=> (c.good?goodIdx:badIdx).push(i));
  const colors = new Array(cats.length);
  goodIdx.forEach((idx,k)=>{ const t = goodIdx.length>1? k/(goodIdx.length-1):0; colors[idx]=colorForPct(t*15); });
  badIdx.forEach((idx,k)=>{ const t = badIdx.length>1? k/(badIdx.length-1):0; colors[idx]=colorForPct(55+t*45); });
  return colors;
}

// ---------------- agregação de campos por situação ----------------
const AGUA_FIELDS = ['v00111','v00112','v00113','v00114','v00115','v00116','v00117','v00118','v00463','v00464'];
const ESG_FIELDS  = ['v00494','v00495','v00580','v00581','v00582','v00583','v00584','v00585','v00586','v00587'];

function sumSit(feats, prefix, fields, sit){
  const parts = sit==='rural' ? ['aglom','disperso'] : [sit];
  const out = {};
  fields.forEach(v=>{ out[v] = feats.reduce((s,f)=> s + parts.reduce((ss,p)=> ss+(f.properties[prefix+'_'+p+'_'+v]||0), 0), 0); });
  return out;
}
const sumAgua = (feats, sit) => sumSit(feats, 'agua', AGUA_FIELDS, sit);
const sumEsg  = (feats, sit) => sumSit(feats, 'esg', ESG_FIELDS, sit);

// total real de domicílios (V00001) — fonte de verdade para os denominadores de percentual
function domTotalSingle(p, sit){
  const parts = sit==='rural' ? ['aglom','disperso'] : [sit];
  return parts.reduce((s,part)=> s + (p['dom_'+part+'_v00001']||0), 0);
}
function sumDomTotal(feats, sit){
  return feats.reduce((s,f)=> s + domTotalSingle(f.properties, sit), 0);
}

function classifyAgua(v, domTotal){
  const adequado = v.v00111+v.v00112+v.v00113;
  const inadequado = v.v00114+v.v00115+v.v00116+v.v00117+v.v00118;
  const total = domTotal||0;
  const categorizado = adequado+inadequado;
  // protecao: se a soma das categorias (fonte primaria) for maior que o total oficial de domicilios (V00001),
  // ha inconsistencia na base de origem para este recorte — sinalizamos e limitamos a exibicao a 100%
  const inconsistente = total>0 && categorizado>total*1.005;
  return {adequado, inadequado, total, inconsistente,
    pctAdeq: total? Math.min(100, adequado/total*100):0,
    pctInadeq: total? Math.min(100, inadequado/total*100):0};
}
function classifyEsg(v, domTotal){
  const adequado = v.v00580+v.v00581+v.v00582;
  const inadequado = v.v00583+v.v00584+v.v00585+v.v00586;
  const sem = v.v00587;
  const total = domTotal||0;
  const categorizado = adequado+inadequado+sem;
  const inconsistente = total>0 && categorizado>total*1.005;
  return {adequado, inadequado, sem, total, inconsistente,
    pctAdeq: total? Math.min(100, adequado/total*100):0,
    pctInadeq: total? Math.min(100, inadequado/total*100):0,
    pctSem: total? Math.min(100, sem/total*100):0};
}

// métrica de cor do mapa conforme a aba ativa
function mapMetricPct(p){
  const feats = [{properties:p}];
  if(state.tab==='agua')   return classifyAgua(sumAgua(feats,'rural'), domTotalSingle(p,'rural'));
  if(state.tab==='esgoto') return classifyEsg(sumEsg(feats,'rural'), domTotalSingle(p,'rural'));
  if(state.tab==='agua_rural')   return classifyAgua(sumAgua(feats, state.mapIndicadorRuralAgua), domTotalSingle(p, state.mapIndicadorRuralAgua));
  if(state.tab==='esgoto_rural') return classifyEsg(sumEsg(feats, state.mapIndicadorRuralEsgoto), domTotalSingle(p, state.mapIndicadorRuralEsgoto));
}

const POLOS = [...new Set(GEO.features.map(f=>f.properties.nm_polo))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
const MICROS = [...new Set(GEO.features.map(f=>f.properties.nm_msb))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
const CENTRAIS_ORDEM = ["Caetité","Feira de Santana","Jacobina","Ribeira do Pombal","Seabra","Vitória da Conquista","Sem Central definida"];
function regiaoKey(){ return state.groupBy==='polo' ? 'nm_polo' : state.groupBy==='central' ? 'central' : 'nm_msb'; }

function currentSelectionFeatures(){
  if(state.selectedMun) return GEO.features.filter(f=>f.properties.cod_mun===state.selectedMun);
  if(state.regiao!=='todas') return GEO.features.filter(f=>f.properties[regiaoKey()]===state.regiao);
  return GEO.features;
}
function currentSelectionPoints(){
  if(state.selectedMun) return PONTOS.filter(p=>p.m===state.selectedMun);
  if(state.regiao!=='todas') return PONTOS.filter(p=>p[regiaoKey()]===state.regiao);
  return PONTOS;
}
function currentSelectionLabel(){
  if(state.selectedMun){
    const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
    return 'Município — ' + (f?f.properties.nm_mun:state.selectedMun);
  }
  if(state.regiao!=='todas'){
    const lbl = state.groupBy==='polo'?'Polo Regional — ':state.groupBy==='central'?'Central — ':'Microrregião — ';
    return lbl + state.regiao;
  }
  return 'Estado da Bahia — 417 municípios';
}

// ---------------- controles compartilhados ----------------
function renderControls(){
  document.querySelectorAll('#segGroupBy button').forEach(b=>b.classList.toggle('active', b.dataset.g===state.groupBy));
  const usaChips = (state.groupBy==='polo' || state.groupBy==='central');
  document.getElementById('chipsPolo').style.display = usaChips ? 'flex' : 'none';
  document.getElementById('selectMicro').style.display = state.groupBy==='microrregiao' ? '' : 'none';
  const chipsWrap = document.getElementById('chipsPolo');
  chipsWrap.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'chip' + (state.regiao==='todas' ? ' active':'');
  allBtn.textContent = 'Todo o Estado';
  allBtn.onclick = ()=> applyRegiaoFilter('todas');
  chipsWrap.appendChild(allBtn);
  const lista = state.groupBy==='central' ? CENTRAIS_ORDEM : POLOS;
  lista.forEach(nome=>{
    const b = document.createElement('button');
    b.className = 'chip' + (state.regiao===nome ? ' active':'');
    b.textContent = nome;
    b.onclick = ()=> applyRegiaoFilter(nome);
    chipsWrap.appendChild(b);
  });
  const sel = document.getElementById('selectMicro');
  sel.innerHTML = '<option value="todas">Todo o Estado</option>' + MICROS.map(m=>`<option value="${m}">${m}</option>`).join('');
  sel.value = state.groupBy==='microrregiao' ? state.regiao : 'todas';
}
document.getElementById('segGroupBy').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  state.groupBy = btn.dataset.g;
  applyRegiaoFilter('todas');
});
document.getElementById('selectMicro').addEventListener('change', e=> applyRegiaoFilter(e.target.value));
document.getElementById('muniClear').addEventListener('click', clearMunicipio);
document.getElementById('muniDetailClose').addEventListener('click', clearMunicipio);
document.getElementById('muniSearch').addEventListener('change', e=>{
  const n = e.target.value.trim().toLowerCase();
  const f = GEO.features.find(f=>f.properties.nm_mun.toLowerCase()===n);
  if(f) selectMunicipio(f.properties.cod_mun);
});
function populateMuniList(){
  const list = document.getElementById('muniList');
  const names = GEO.features.map(f=>f.properties.nm_mun).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  list.innerHTML = names.map(n=>`<option value="${n}"></option>`).join('');
}

// ---------------- projeção geográfica -> pixels ----------------
let W=640, H=780, lonMin,lonMax,latMin,latMax;
function computeBounds(){
  lonMin=Infinity; lonMax=-Infinity; latMin=Infinity; latMax=-Infinity;
  GEO.features.forEach(f=>{
    const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach(poly=>{ poly.forEach(ring=>{ ring.forEach(([lon,lat])=>{
      if(lon<lonMin)lonMin=lon; if(lon>lonMax)lonMax=lon;
      if(lat<latMin)latMin=lat; if(lat>latMax)latMax=lat;
    }); }); });
  });
  const padX=(lonMax-lonMin)*0.02, padY=(latMax-latMin)*0.02;
  lonMin-=padX; lonMax+=padX; latMin-=padY; latMax+=padY;
}
function proj(lon,lat){
  const x=(lon-lonMin)/(lonMax-lonMin)*W, y=(latMax-lat)/(latMax-latMin)*H;
  return [x.toFixed(1), y.toFixed(1)];
}
function ringToPath(ring){ return ring.map((pt,i)=>(i===0?'M':'L')+proj(pt[0],pt[1]).join(',')).join(' ')+' Z'; }
function geomToPath(geom){
  const polys = geom.type==='Polygon' ? [geom.coordinates] : geom.coordinates;
  let d=''; polys.forEach(poly=>{ poly.forEach(ring=>{ d+=ringToPath(ring)+' '; }); }); return d.trim();
}

// ---------------- mapa único, reaproveitado entre as abas ----------------
let mapSvgEl = null;
let currentZoomScale = 1;
let touchHintTimer = null;
const MUN_FILL_NEUTRAL = '#EFEFEF';
const MUN_FILL_GRAYOUT = '#C7CDD3';
const PT_R_DEFAULT = 2.0;
const PT_R_HIGHLIGHT = 4.2;
const PT_R_DIM = 1.4;

function hintTextFromTarget(el){
  const pt = el?.closest?.('.pt-circle');
  if(pt) return PONTOS[+pt.dataset.idx].mn;
  const mun = el?.closest?.('.mun-path');
  if(mun) return GEO.features[+mun.dataset.idx].properties.nm_mun;
  return null;
}

function hideAllMapHints(){
  document.querySelectorAll('.map-hint').forEach(h=>{
    h.classList.remove('visible');
    h.setAttribute('aria-hidden', 'true');
  });
}

function hideMapHint(){
  const wrap = document.getElementById('mapWrap-'+state.tab);
  const hint = wrap?.querySelector('.map-hint');
  if(hint){
    hint.classList.remove('visible');
    hint.setAttribute('aria-hidden', 'true');
  }
}

function showMapHint(clientX, clientY, text){
  const wrap = document.getElementById('mapWrap-'+state.tab);
  if(!wrap || !text) return;
  const hint = wrap.querySelector('.map-hint');
  if(!hint) return;
  hint.textContent = text;
  hint.classList.add('visible');
  hint.setAttribute('aria-hidden', 'false');
  const rect = wrap.getBoundingClientRect();
  let left = clientX - rect.left + 10;
  let top = clientY - rect.top + 8;
  hint.style.left = left + 'px';
  hint.style.top = top + 'px';
  requestAnimationFrame(()=>{
    const hw = hint.offsetWidth, hh = hint.offsetHeight;
    left = Math.max(6, Math.min(left, rect.width - hw - 6));
    top = Math.max(6, Math.min(top, rect.height - hh - 6));
    hint.style.left = left + 'px';
    hint.style.top = top + 'px';
  });
}

function handleMapPointerHint(e){
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const text = hintTextFromTarget(hit);
  if(!text){ hideMapHint(); return; }
  showMapHint(e.clientX, e.clientY, text);
}

function bindMapInteractions(){
  if(!mapSvgEl || mapSvgEl.dataset.bound === '1') return;
  mapSvgEl.dataset.bound = '1';

  mapSvgEl.addEventListener('pointermove', e=>{
    if(e.pointerType === 'touch') return;
    handleMapPointerHint(e);
  });
  mapSvgEl.addEventListener('mousemove', e=> handleMapPointerHint(e));
  mapSvgEl.addEventListener('pointerdown', e=>{
    if(e.pointerType !== 'touch') return;
    handleMapPointerHint(e);
    clearTimeout(touchHintTimer);
    touchHintTimer = setTimeout(hideMapHint, 2500);
  });
  mapSvgEl.addEventListener('pointerleave', ()=>{
    clearTimeout(touchHintTimer);
    hideMapHint();
  });
  mapSvgEl.addEventListener('mouseleave', hideMapHint);
  mapSvgEl.addEventListener('click', e=>{
    const ptTarget = e.target.closest('.pt-circle');
    if(ptTarget && state.tab==='aglomerados'){
      toggleMunicipio(PONTOS[+ptTarget.dataset.idx].m);
      return;
    }
    const target = e.target.closest('.mun-path');
    if(!target) return;
    toggleMunicipio(GEO.features[+target.dataset.idx].properties.cod_mun);
  });
}

function buildMapSkeleton(){
  computeBounds();
  let paths = '';
  GEO.features.forEach((f,idx)=>{ paths += `<path class="mun-path" data-idx="${idx}" d="${geomToPath(f.geometry)}" fill-rule="evenodd"></path>`; });
  let pts = '';
  PONTOS.forEach((p,idx)=>{
    const [x,y] = proj(p.x,p.y);
    pts += `<circle class="pt-circle" data-idx="${idx}" cx="${x}" cy="${y}" r="${PT_R_DEFAULT}"></circle>`;
  });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<svg id="mapSvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><g id="zoomGroup"><g id="munLayer">${paths}</g><g id="ptsLayer">${pts}</g></g></svg>`;
  mapSvgEl = wrapper.firstElementChild;
  bindMapInteractions();
}

function mountMapInActiveTab(){
  const slot = document.getElementById('mapWrap-'+state.tab);
  if(!slot) return;
  hideAllMapHints();
  clearTimeout(touchHintTimer);
  if(!mapSvgEl) buildMapSkeleton();
  if(mapSvgEl.parentElement !== slot) slot.appendChild(mapSvgEl);
  const hint = slot.querySelector('.map-hint');
  if(hint) slot.appendChild(hint);
}

function bboxPxOfFeatures(feats){
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  feats.forEach(f=>{
    const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach(poly=>{ poly.forEach(ring=>{ ring.forEach(([lon,lat])=>{
      const [x,y] = proj(lon,lat).map(Number);
      if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
    }); }); });
  });
  return {minX,maxX,minY,maxY};
}
function applyZoomToBBox(bbox, pad, maxScale){
  const zg = document.getElementById('zoomGroup'); if(!zg||!bbox) return;
  const bw = Math.max(bbox.maxX-bbox.minX,6), bh = Math.max(bbox.maxY-bbox.minY,6);
  const cx=(bbox.minX+bbox.maxX)/2, cy=(bbox.minY+bbox.maxY)/2;
  let scale = Math.min(W/(bw*pad), H/(bh*pad));
  scale = Math.max(1, Math.min(scale, maxScale));
  currentZoomScale = scale;
  const tx=W/2-cx*scale, ty=H/2-cy*scale;
  zg.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(3)})`);
}
function zoomToMunicipio(codMun){
  const f = GEO.features.find(f=>f.properties.cod_mun===codMun);
  if(f) applyZoomToBBox(bboxPxOfFeatures([f]), 1.7, 16);
}
function zoomToRegiao(){
  if(state.regiao==='todas'){ zoomReset(); return; }
  applyZoomToBBox(bboxPxOfFeatures(GEO.features.filter(f=>f.properties[regiaoKey()]===state.regiao)), 1.15, 8);
}
function zoomReset(){
  const zg = document.getElementById('zoomGroup'); currentZoomScale=1;
  if(zg) zg.setAttribute('transform','translate(0,0) scale(1)');
}

const MUN_FILL_COM_AGL = '#E4EAF0';
const MUN_FILL_SEM_AGL = '#EFEFEF';

function renderMap(){
  mountMapInActiveTab();
  const ptsLayer = document.getElementById('ptsLayer');
  const isAglom = state.tab==='aglomerados';
  ptsLayer.style.display = isAglom ? '' : 'none';

  document.querySelectorAll('#munLayer .mun-path').forEach(pathEl=>{
    const p = GEO.features[+pathEl.dataset.idx].properties;
    const isSelected = state.selectedMun===p.cod_mun;
    if(isAglom){
      // aba de aglomerados: municipio so de referencia (com/sem aglomerado na base), info fica nos pontos
      pathEl.setAttribute('fill', (p.aglomerados_planilha>0) ? MUN_FILL_COM_AGL : MUN_FILL_SEM_AGL);
      pathEl.classList.toggle('selected', isSelected);
      if(state.selectedMun){
        pathEl.classList.toggle('muted', !isSelected);
        pathEl.classList.remove('dim');
      } else {
        const inFilter = (state.regiao==='todas' || p[regiaoKey()]===state.regiao);
        pathEl.classList.toggle('dim', !inFilter);
        pathEl.classList.remove('muted');
      }
      return;
    }
    const r = mapMetricPct(p);
    const refColor = r.total ? colorForPct(100-r.pctAdeq) : MUN_FILL_NEUTRAL;
    if(state.selectedMun){
      pathEl.setAttribute('fill', isSelected ? refColor : MUN_FILL_GRAYOUT);
      pathEl.classList.toggle('selected', isSelected);
      pathEl.classList.remove('dim');
    } else {
      pathEl.setAttribute('fill', refColor);
      pathEl.classList.remove('selected');
      const inFilter = (state.regiao==='todas' || p[regiaoKey()]===state.regiao);
      pathEl.classList.toggle('dim', !inFilter);
    }
  });

  if(isAglom){
    const prKey = state.indicadorAglom==='agua' ? 'wp' : 'sp';
    document.querySelectorAll('#ptsLayer .pt-circle').forEach(circleEl=>{
      const p = PONTOS[+circleEl.dataset.idx];
      circleEl.setAttribute('fill', PR_COLORS_HEX[p[prKey]]);
      if(state.selectedMun){
        const inMun = p.m===state.selectedMun;
        circleEl.setAttribute('r', (inMun?PT_R_HIGHLIGHT:PT_R_DIM)/currentZoomScale);
        circleEl.classList.toggle('dim', !inMun);
        circleEl.classList.toggle('highlight', inMun);
      } else {
        const inFilter = (state.regiao==='todas' || p[regiaoKey()]===state.regiao);
        circleEl.setAttribute('r', PT_R_DEFAULT/currentZoomScale);
        circleEl.classList.toggle('dim', !inFilter);
        circleEl.classList.remove('highlight');
      }
    });
    document.getElementById('mapIndTitle-aglomerados').textContent = state.indicadorAglom==='agua' ? 'Água' : 'Esgoto';
    document.getElementById('legendRow-aglomerados').innerHTML = PR_LEVELS.map(lvl=>
      `<span><span class="sw" style="background:${PR_COLORS_HEX[lvl]}"></span>${PR_LABELS[lvl]}</span>`).join('') +
      `<span style="margin-left:6px;"><span class="sw" style="background:${MUN_FILL_COM_AGL}"></span>Município com aglomerado</span>` +
      `<span><span class="sw" style="background:${MUN_FILL_SEM_AGL}"></span>Sem aglomerado na base</span>`;
    return;
  }

  const legendHtml = [['100% adequado',0],['75%',25],['50%',50],['25%',75],['0% adequado',100]].map(([lbl,v])=>
    `<span><span class="sw" style="background:${colorForPct(v)}"></span>${lbl}</span>`).join('') +
    `<span><span class="sw" style="background:${MUN_FILL_NEUTRAL}"></span>Sem dado</span>`;
  const legendSlot = document.querySelector('#view-'+state.tab+' .legend-slot');
  if(legendSlot) legendSlot.innerHTML = legendHtml;

  if(state.tab==='agua_rural' || state.tab==='esgoto_rural'){
    const ind = state.tab==='agua_rural' ? state.mapIndicadorRuralAgua : state.mapIndicadorRuralEsgoto;
    document.getElementById('mapIndTitle-'+state.tab).textContent = ind==='aglom' ? 'Aglomerados' : 'Rural Disperso';
    document.getElementById('legendNote-'+state.tab).textContent = ind==='aglom'
      ? 'Verde = 100% dos domicílios em Aglomerados (Setores 5,6,7) com atendimento adequado. Vermelho = 100% inadequado.'
      : 'Verde = 100% dos domicílios em Rural Disperso (Setor 8) com atendimento adequado. Vermelho = 100% inadequado.';
  }
}

// ---------------- donut genérico ----------------
function renderDonut(svgId, legendId, parts){
  const svg = document.getElementById(svgId);
  if(!svg) return;
  const cx=90, cy=90, r=68, sw=28;
  const total = parts.reduce((s,p)=>s+p[1],0);
  const circumference = 2*Math.PI*r;
  let offsetAcc = 0, svgParts = '';
  parts.forEach(([label,val,color])=>{
    const frac = total? val/total : 0;
    const len = frac*circumference;
    svgParts += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-dasharray="${len} ${circumference-len}" stroke-dashoffset="${-offsetAcc}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    offsetAcc += len;
  });
  const pctFirst = total? parts[0][1]/total*100 : 0;
  svg.innerHTML = svgParts + `<circle cx="${cx}" cy="${cy}" r="${r-sw/2-3}" fill="#fff"></circle>
    <text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--azul-escuro)" font-family="Arial Narrow, Arial, sans-serif">${fmt1(pctFirst)}%</text>
    <text x="${cx}" y="${cy+13}" text-anchor="middle" font-size="9" fill="#5A6673" font-family="Arial Narrow, Arial, sans-serif">${parts[0][0].toLowerCase()}</text>`;
  document.getElementById(legendId).innerHTML = parts.map(([label,val,color])=>{
    const pct = total? (val/total*100).toFixed(1) : '0.0';
    return `<div class="donut-legend-row"><span><span class="sw" style="background:${color}"></span>${label}</span><span>${fmt(val)} (${pct}%)</span></div>`;
  }).join('');
}

// ================= ABA AGUA =================
const AGUA_COMP_CATS = [
  {key:'v00111', label:'Rede geral de distribuição', good:true},
  {key:'v00112', label:'Poço profundo ou artesiano', good:true},
  {key:'v00113', label:'Poço raso, freático ou cacimba', good:true},
  {key:'v00114', label:'Fonte, nascente ou mina', good:false},
  {key:'v00115', label:'Carro-pipa', good:false},
  {key:'v00116', label:'Água de chuva armazenada', good:false},
  {key:'v00117', label:'Rios, açudes, córregos e lagos', good:false},
  {key:'v00118', label:'Outra forma', good:false},
];
function renderTabAgua(){
  const feats = currentSelectionFeatures();
  const domRural = sumDomTotal(feats,'rural'), domUrb = sumDomTotal(feats,'urbana');
  const rural = classifyAgua(sumAgua(feats,'rural'), domRural);
  const urbana = classifyAgua(sumAgua(feats,'urbana'), domUrb);
  const rede = sumAgua(feats,'rural');
  const pctV464 = domRural? rede.v00464/domRural*100:0;
  document.getElementById('kpiRow-agua').innerHTML = `
    <div class="kpi"><div class="val">${fmt(feats.length)}</div><div class="lbl">Municípios na seleção</div></div>
    <div class="kpi ${urbana.pctAdeq>=70?'bom':''}"><div class="val">${fmt1(urbana.pctAdeq)}%</div><div class="lbl">Adequado — Urbano</div></div>
    <div class="kpi ${rural.pctAdeq<40?'alerta':'bom'}"><div class="val">${fmt1(rural.pctAdeq)}%</div><div class="lbl">Adequado — Rural</div></div>
    <div class="kpi bom"><div class="val">${fmt(rural.adequado)}</div><div class="lbl">Domicílios adequados — Rural</div></div>
    <div class="kpi alerta"><div class="val">${fmt(rede.v00464)}</div><div class="sub">${fmt1(pctV464)}%</div><div class="lbl">Sem ligação de rede — Rural</div></div>
  `;
  renderDonut('donutUrbano-agua','legendUrbano-agua', [['Adequado',urbana.adequado,'var(--adeq)'],['Inadequado',urbana.inadequado,'var(--inadeq)']]);
  renderDonut('donutRural-agua','legendRural-agua', [['Adequado',rural.adequado,'var(--adeq)'],['Inadequado',rural.inadequado,'var(--inadeq)']]);
  renderDonut('donutRede-agua','legendRede-agua', [['V00463 — Tem ligação, usa outra forma',rede.v00463,'var(--inadeq)'],['V00464 — Não possui ligação',rede.v00464,'var(--sem)']]);

  document.getElementById('compTitle-agua').textContent = state.compIndicadorAgua==='urbana' ? 'Urbano' : 'Rural (Aglomerados + Disperso)';
  const v = sumAgua(feats, state.compIndicadorAgua);
  const domTot = sumDomTotal(feats, state.compIndicadorAgua);
  const values = AGUA_COMP_CATS.map(c=>v[c.key]);
  const colors = categoryColors(AGUA_COMP_CATS);
  document.getElementById('compChart-agua').innerHTML = domTot>0 ? AGUA_COMP_CATS.map((c,i)=>{
    const val = values[i], pct = domTot? val/domTot*100:0;
    return `<div class="chart-row"><div class="name" title="${c.label}">${c.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
      <div class="pct">${fmt(val)} (${fmt1(pct)}%)</div></div>`;
  }).join('') : '<div class="empty-msg">Sem dado para esta seleção.</div>';

  document.getElementById('scopeInfo-agua').innerHTML = `<p><b>${currentSelectionLabel()}</b><br><br>"Rural" combina Aglomerados (Setores 5,6,7) e Rural Disperso (Setor 8). Para o detalhamento separado, use a aba "Consulta Rural".</p>`;
}
document.getElementById('segCompIndicador-agua').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  document.querySelectorAll('#segCompIndicador-agua button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.compIndicadorAgua = btn.dataset.ind;
  renderTabAgua();
});

// ================= ABA ESGOTO =================
const ESG_COMP_CATS = [
  {key:'v00580', label:'SC — Solução Coletiva', good:true},
  {key:'v00581', label:'SCA — Coletiva Adequada', good:true},
  {key:'v00582', label:'SIA — Individual Adequada', good:true},
  {key:'v00583_586', label:'SII — Individual Inadequada', good:false},
  {key:'v00587', label:'SA — Sem Atendimento', good:false},
];
function renderTabEsgoto(){
  const feats = currentSelectionFeatures();
  const domRural = sumDomTotal(feats,'rural'), domUrb = sumDomTotal(feats,'urbana');
  const rural = classifyEsg(sumEsg(feats,'rural'), domRural);
  const urbana = classifyEsg(sumEsg(feats,'urbana'), domUrb);
  const banh = sumEsg(feats,'rural');
  const pctBanhCom = domRural? banh.v00494/domRural*100:0;
  const pctBanhSem = domRural? banh.v00495/domRural*100:0;
  document.getElementById('kpiRow-esgoto').innerHTML = `
    <div class="kpi"><div class="val">${fmt(feats.length)}</div><div class="lbl">Municípios na seleção</div></div>
    <div class="kpi bom"><div class="val">${fmt(banh.v00494)}</div><div class="sub">${fmt1(pctBanhCom)}%</div><div class="lbl">Domicílios c/ banheiro — Rural</div></div>
    <div class="kpi alerta"><div class="val">${fmt(banh.v00495)}</div><div class="sub">${fmt1(pctBanhSem)}%</div><div class="lbl">Domicílios s/ banheiro — Rural</div></div>
    <div class="kpi ${urbana.pctAdeq>=70?'bom':''}"><div class="val">${fmt1(urbana.pctAdeq)}%${urbana.inconsistente?' ⚠️':''}</div><div class="lbl">Adequado — Urbano</div></div>
    <div class="kpi ${rural.pctAdeq<40?'alerta':'bom'}"><div class="val">${fmt1(rural.pctAdeq)}%</div><div class="lbl">Adequado — Rural</div></div>
  `;
  const existingAviso = document.getElementById('avisoUrbanoEsgoto');
  if(existingAviso) existingAviso.remove();
  if(urbana.inconsistente){
    document.getElementById('kpiRow-esgoto').insertAdjacentHTML('afterend',
      `<div id="avisoUrbanoEsgoto" class="alert-banner">
        ⚠️ <b>Inconsistência nos dados de origem (Esgoto — Urbano):</b> a soma das categorias de atendimento (V00580 a V00587) ultrapassa o total de domicílios (V00001) para a seleção atual — ex.: setor 290010805000001 (Abaíra) tem V00580 = 418 para apenas 295 domicílios. O percentual acima foi limitado a 100% para não exibir valor incorreto, mas o número real não pôde ser calculado com confiança. Isso não afeta os dados de Rural/Aglomerados/Rural Disperso, que estão consistentes.
      </div>`);
  }
  renderDonut('donutUrbano-esgoto','legendUrbano-esgoto', [['Adequado',urbana.adequado,'var(--adeq)'],['Inadequado',urbana.inadequado,'var(--inadeq)'],['Sem atend.',urbana.sem,'var(--sem)']]);
  renderDonut('donutRural-esgoto','legendRural-esgoto', [['Adequado',rural.adequado,'var(--adeq)'],['Inadequado',rural.inadequado,'var(--inadeq)'],['Sem atend.',rural.sem,'var(--sem)']]);

  document.getElementById('compTitle-esgoto').textContent = state.compIndicadorEsgoto==='urbana' ? 'Urbano' : 'Rural (Aglomerados + Disperso)';
  const v = sumEsg(feats, state.compIndicadorEsgoto);
  const domTot = sumDomTotal(feats, state.compIndicadorEsgoto);
  const values = [v.v00580, v.v00581, v.v00582, v.v00583+v.v00584+v.v00585+v.v00586, v.v00587];
  const colors = categoryColors(ESG_COMP_CATS);
  document.getElementById('compChart-esgoto').innerHTML = domTot>0 ? ESG_COMP_CATS.map((c,i)=>{
    const val = values[i], pct = domTot? val/domTot*100:0;
    return `<div class="chart-row"><div class="name" title="${c.label}">${c.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
      <div class="pct">${fmt(val)} (${fmt1(pct)}%)</div></div>`;
  }).join('') : '<div class="empty-msg">Sem dado para esta seleção.</div>';

  const rows = [['Rural', sumEsg(feats,'rural'), domRural], ['Urbano', sumEsg(feats,'urbana'), domUrb]];
  document.getElementById('banheiroChart-esgoto').innerHTML = rows.map(([label,vv,domT])=>{
    const pctCom = domT? vv.v00494/domT*100:0, pctSem = domT? vv.v00495/domT*100:0;
    return `<div class="banheiro-row">
      <div class="banheiro-label">${label}</div>
      <div class="bar2"><div class="seg-com lab" style="width:${pctCom}%">${pctCom>12?fmt1(pctCom)+'%':''}</div><div class="seg-sem lab" style="width:${pctSem}%">${pctSem>8?fmt1(pctSem)+'%':''}</div></div>
    </div>
    <div class="banheiro-stats">
      <span><span style="color:var(--adeq);font-weight:700;">●</span> ${fmt(vv.v00494)} com banheiro (${fmt1(pctCom)}%)</span>
      <span><span style="color:var(--sem);font-weight:700;">●</span> ${fmt(vv.v00495)} sem banheiro (${fmt1(pctSem)}%)</span>
    </div>`;
  }).join('');
}
document.getElementById('segCompIndicador-esgoto').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  document.querySelectorAll('#segCompIndicador-esgoto button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.compIndicadorEsgoto = btn.dataset.ind;
  renderTabEsgoto();
});

// ================= ABAS CONSULTA RURAL (agua / esgoto) =================
function renderSidePanelAgua(containerId, sit, label){
  const feats = currentSelectionFeatures();
  const v = sumAgua(feats, sit);
  const domTot = sumDomTotal(feats, sit);
  const c = classifyAgua(v, domTot);
  const donutId = 'donut-'+containerId, legendIdD = 'legend-'+containerId;
  const values = AGUA_COMP_CATS.map(cat=>v[cat.key]);
  const colors = categoryColors(AGUA_COMP_CATS);
  const compRows = domTot>0 ? AGUA_COMP_CATS.map((cat,i)=>{
    const val = values[i], pct = domTot? val/domTot*100:0;
    return `<div class="chart-row small"><div class="name" title="${cat.label}">${cat.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
      <div class="pct">${fmt(val)} (${fmt1(pct)}%)</div></div>`;
  }).join('') : '<div style="color:#7A8794;font-size:11.5px;font-style:italic;">Sem dado.</div>';
  const pct463 = domTot? v.v00463/domTot*100:0, pct464 = domTot? v.v00464/domTot*100:0;
  const totalRede = v.v00463+v.v00464;
  const pctComBar = totalRede? v.v00463/totalRede*100:0, pctSemBar = totalRede? v.v00464/totalRede*100:0;

  document.getElementById(containerId).innerHTML = `
    <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
      <div class="donut-box"><svg id="${donutId}" viewBox="0 0 160 160" width="150" height="150"></svg><div class="donut-legend" id="${legendIdD}"></div></div>
      <div style="flex:1; min-width:220px;">
        <div class="detail-grid" style="grid-template-columns:repeat(2,1fr);">
          <div class="detail-item"><div class="v">${fmt(v.v00463)} <span style="font-size:12px;color:#5A6673;">(${fmt1(pct463)}%)</span></div><div class="l">Tem ligação, usa outra forma</div></div>
          <div class="detail-item"><div class="v">${fmt(v.v00464)} <span style="font-size:12px;color:#5A6673;">(${fmt1(pct464)}%)</span></div><div class="l">Sem ligação de rede</div></div>
        </div>
        <div class="banheiro-row"><div class="bar2">
          <div class="seg-com lab" style="width:${pctComBar}%; background:var(--inadeq);">${pctComBar>15?fmt1(pctComBar)+'%':''}</div>
          <div class="seg-sem lab" style="width:${pctSemBar}%">${pctSemBar>10?fmt1(pctSemBar)+'%':''}</div>
        </div></div>
        <div class="banheiro-note">${fmt(totalRede)} domicílios sem uso pleno da rede (${label}) — percentuais acima sobre o total real de domicílios (V00001: ${fmt(domTot)})</div>
      </div>
    </div>
    <p class="subsection-title">Composição do acesso</p>
    ${compRows}
  `;
  renderDonut(donutId, legendIdD, [['Adequado',c.adequado,'var(--adeq)'],['Inadequado',c.inadequado,'var(--inadeq)']]);
}

function renderSidePanelEsgoto(containerId, sit, label){
  const feats = currentSelectionFeatures();
  const v = sumEsg(feats, sit);
  const domTot = sumDomTotal(feats, sit);
  const c = classifyEsg(v, domTot);
  const donutId = 'donut-'+containerId, legendIdD = 'legend-'+containerId;
  const values = [v.v00580, v.v00581, v.v00582, v.v00583+v.v00584+v.v00585+v.v00586, v.v00587];
  const colors = categoryColors(ESG_COMP_CATS);
  const compRows = domTot>0 ? ESG_COMP_CATS.map((cat,i)=>{
    const val = values[i], pct = domTot? val/domTot*100:0;
    return `<div class="chart-row small"><div class="name" title="${cat.label}">${cat.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
      <div class="pct">${fmt(val)} (${fmt1(pct)}%)</div></div>`;
  }).join('') : '<div style="color:#7A8794;font-size:11.5px;font-style:italic;">Sem dado.</div>';
  const pctComTot = domTot? v.v00494/domTot*100:0, pctSemTot = domTot? v.v00495/domTot*100:0;
  const totalBanh = v.v00494+v.v00495;
  const pctComBar = totalBanh? v.v00494/totalBanh*100:0, pctSemBar = totalBanh? v.v00495/totalBanh*100:0;

  document.getElementById(containerId).innerHTML = `
    <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
      <div class="donut-box"><svg id="${donutId}" viewBox="0 0 160 160" width="150" height="150"></svg><div class="donut-legend" id="${legendIdD}"></div></div>
      <div style="flex:1; min-width:220px;">
        <div class="detail-grid" style="grid-template-columns:repeat(2,1fr);">
          <div class="detail-item"><div class="v">${fmt(v.v00494)} <span style="font-size:12px;color:#5A6673;">(${fmt1(pctComTot)}%)</span></div><div class="l">Com banheiro</div></div>
          <div class="detail-item"><div class="v">${fmt(v.v00495)} <span style="font-size:12px;color:#5A6673;">(${fmt1(pctSemTot)}%)</span></div><div class="l">Sem banheiro</div></div>
        </div>
        <div class="banheiro-row"><div class="bar2">
          <div class="seg-com lab" style="width:${pctComBar}%">${pctComBar>15?fmt1(pctComBar)+'%':''}</div>
          <div class="seg-sem lab" style="width:${pctSemBar}%">${pctSemBar>10?fmt1(pctSemBar)+'%':''}</div>
        </div></div>
        <div class="banheiro-note">${fmt(totalBanh)} domicílios no total (${label}) — percentuais acima sobre o total real de domicílios (V00001: ${fmt(domTot)})</div>
      </div>
    </div>
    <p class="subsection-title">Composição do acesso</p>
    ${compRows}
  `;
  renderDonut(donutId, legendIdD, [['Adequado',c.adequado,'var(--adeq)'],['Inadequado',c.inadequado,'var(--inadeq)'],['Sem atend.',c.sem,'var(--sem)']]);
}

function renderKpiCompare(rowId, classifyFn, sumFn, extraRows){
  const feats = currentSelectionFeatures();
  const domA = sumDomTotal(feats,'aglom'), domD = sumDomTotal(feats,'disperso');
  const a = classifyFn(sumFn(feats,'aglom'), domA);
  const d = classifyFn(sumFn(feats,'disperso'), domD);
  const cards = [
    {lbl:'% Atendimento adequado', va:fmt1(a.pctAdeq)+'%', vd:fmt1(d.pctAdeq)+'%', delta:(a.pctAdeq-d.pctAdeq)},
    {lbl:'Domicílios totais (V00001)', va:fmt(a.total), vd:fmt(d.total), delta:null},
    ...extraRows(sumFn(feats,'aglom'), sumFn(feats,'disperso'), domA, domD),
  ];
  document.getElementById(rowId).innerHTML = cards.map(c=>`
    <div class="kpi-compare">
      <div class="lbl">${c.lbl}</div>
      <div class="row a"><span class="tag">Aglomerados</span><span class="val">${c.va}</span></div>
      <div class="row d"><span class="tag">Rural Disperso</span><span class="val">${c.vd}</span></div>
      ${c.delta!==null?`<div class="delta">Diferença: ${c.delta>=0?'+':''}${fmt1(c.delta)} p.p. (Aglom. ${c.delta>=0?'melhor':'pior'})</div>`:''}
    </div>`).join('');
}

function renderScopeInfoRural(elId, tipo){
  const txt = tipo==='agua' ? 'abastecimento de água' : 'esgotamento sanitário';
  document.getElementById(elId).innerHTML = `<p>
    <b>${currentSelectionLabel()}</b><br><br>
    Este painel compara, lado a lado, o ${txt} em duas populações rurais distintas:<br><br>
    <b style="color:var(--aglom);">● Aglomerados</b> — setores censitários tipo 5, 6 e 7.<br>
    <b style="color:var(--disperso);">● Rural Disperso</b> — setor censitário tipo 8.<br><br>
    Use o toggle no mapa para ver a distribuição geográfica de cada um.<br><br>
    <span class="text-note">Percentuais calculados sobre o total real de domicílios (V00001), não sobre a soma das categorias.</span></p>`;
}

function renderTabAguaRural(){
  renderKpiCompare('kpiCompare-agua_rural', classifyAgua, sumAgua, (a,d,domA,domD)=>[
    {lbl:'Sem ligação de rede (V464)', va:`${fmt(a.v00464)} (${fmt1(domA?a.v00464/domA*100:0)}%)`, vd:`${fmt(d.v00464)} (${fmt1(domD?d.v00464/domD*100:0)}%)`, delta:null},
    {lbl:'Tem ligação, usa outra forma (V463)', va:`${fmt(a.v00463)} (${fmt1(domA?a.v00463/domA*100:0)}%)`, vd:`${fmt(d.v00463)} (${fmt1(domD?d.v00463/domD*100:0)}%)`, delta:null},
  ]);
  renderScopeInfoRural('scopeInfo-agua_rural','agua');
  renderSidePanelAgua('painelAglom-agua','aglom','Aglomerados');
  renderSidePanelAgua('painelDisperso-agua','disperso','Rural Disperso');
}
function renderTabEsgotoRural(){
  renderKpiCompare('kpiCompare-esgoto_rural', classifyEsg, sumEsg, (a,d,domA,domD)=>[
    {lbl:'Domicílios com banheiro', va:`${fmt(a.v00494)} (${fmt1(domA?a.v00494/domA*100:0)}%)`, vd:`${fmt(d.v00494)} (${fmt1(domD?d.v00494/domD*100:0)}%)`, delta:null},
    {lbl:'Domicílios sem banheiro', va:`${fmt(a.v00495)} (${fmt1(domA?a.v00495/domA*100:0)}%)`, vd:`${fmt(d.v00495)} (${fmt1(domD?d.v00495/domD*100:0)}%)`, delta:null},
  ]);
  renderScopeInfoRural('scopeInfo-esgoto_rural','esgoto');
  renderSidePanelEsgoto('painelAglom-esgoto','aglom','Aglomerados');
  renderSidePanelEsgoto('painelDisperso-esgoto','disperso','Rural Disperso');
}
document.getElementById('segMapIndicador-agua_rural').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  document.querySelectorAll('#segMapIndicador-agua_rural button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.mapIndicadorRuralAgua = btn.dataset.k;
  renderMap();
});
document.getElementById('segMapIndicador-esgoto_rural').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  document.querySelectorAll('#segMapIndicador-esgoto_rural button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.mapIndicadorRuralEsgoto = btn.dataset.k;
  renderMap();
});

// ================= ABA AGLOMERADOS (pontos, prioridade) =================
function renderTabAglomerados(){
  const feats = currentSelectionFeatures();
  let hab=0, dom=0, agl=0, munTotal=0;
  let aguaCounts = {P1:0,P2:0,P3:0,P4:0,P5:0,sem:0};
  let esgCounts = {P1:0,P2:0,P3:0,P4:0,P5:0,sem:0};
  feats.forEach(f=>{
    const p = f.properties;
    hab += p.habitantes_aglomerados||0;
    dom += p.domicilios||0;
    agl += p.aglomerados_planilha||0;
    munTotal++;
    PR_LEVELS.forEach(lvl=>{
      aguaCounts[lvl] += p['agua_'+lvl]||0;
      esgCounts[lvl] += p['esg_'+lvl]||0;
    });
  });
  const aguaP1Pct = agl ? (aguaCounts.P1/agl*100) : 0;
  const esgP1Pct = agl ? (esgCounts.P1/agl*100) : 0;

  document.getElementById('kpiRow-aglomerados').innerHTML = `
    <div class="kpi"><div class="val">${fmt(hab)}</div><div class="lbl">População (habitantes)</div></div>
    <div class="kpi"><div class="val">${fmt(dom)}</div><div class="lbl">Nº de domicílios</div></div>
    <div class="kpi"><div class="val">${fmt(munTotal)}</div><div class="lbl">Nº de municípios${munTotal<417?' (na seleção)':''}</div></div>
    <div class="kpi alerta"><div class="val">${fmt(aguaCounts.P1)}</div><div class="sub">${fmt1(aguaP1Pct)}%</div><div class="lbl">Prioridade 1 — Água</div></div>
    <div class="kpi alerta"><div class="val">${fmt(esgCounts.P1)}</div><div class="sub">${fmt1(esgP1Pct)}%</div><div class="lbl">Prioridade 1 — Esgoto</div></div>
  `;

  const pts = currentSelectionPoints();
  const prKey = state.indicadorAglom==='agua' ? 'wp' : 'sp';
  const counts = {P1:0,P2:0,P3:0,P4:0,P5:0,sem:0};
  pts.forEach(p=>{ counts[p[prKey]]++; });
  const total = pts.length;

  document.getElementById('pieIndTitle-aglomerados').textContent = state.indicadorAglom==='agua' ? 'Abastecimento de Água' : 'Esgotamento Sanitário';
  document.getElementById('priorityScope-aglomerados').textContent = 'Nível selecionado: ' + currentSelectionLabel();
  const svg = document.getElementById('donutPrioridade-aglomerados');
  const cx=110, cy=110, r=80, sw=34;
  const circumference = 2*Math.PI*r;
  let offsetAcc = 0, parts = '';
  PR_LEVELS.forEach(lvl=>{
    const val = counts[lvl]||0;
    const frac = total? val/total:0;
    const len = frac*circumference;
    parts += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PR_COLORS_HEX[lvl]}" stroke-width="${sw}"
      stroke-dasharray="${len} ${circumference-len}" stroke-dashoffset="${-offsetAcc}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    offsetAcc += len;
  });
  svg.innerHTML = parts + `<circle cx="${cx}" cy="${cy}" r="${r-sw/2-4}" fill="#fff"></circle>
    <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="20" font-weight="700" fill="var(--azul-escuro)" font-family="Arial Narrow, Arial, sans-serif">${fmt(total)}</text>
    <text x="${cx}" y="${cy+14}" text-anchor="middle" font-size="10.5" fill="#5A6673" font-family="Arial Narrow, Arial, sans-serif">aglomerados</text>`;

  document.getElementById('legendPrioridade-aglomerados').innerHTML = PR_LEVELS.map(lvl=>{
    const val = counts[lvl]||0, pct = total? (val/total*100).toFixed(1):'0.0';
    return `<div class="donut-legend-row"><span class="lbl"><span class="sw" style="background:${PR_COLORS_HEX[lvl]}"></span>${PR_LABELS[lvl]}</span><span class="val">${fmt(val)} <span style="color:#5A6673;font-weight:400;">(${pct}%)</span></span></div>`;
  }).join('');

  const totalDom = pts.reduce((s,p)=>s+p.d,0), totalHab = pts.reduce((s,p)=>s+p.h,0);
  const rows = PR_LEVELS.map(lvl=>{
    const subset = pts.filter(p=>p[prKey]===lvl);
    return {lvl, agl:subset.length, dom:subset.reduce((s,p)=>s+p.d,0), hab:subset.reduce((s,p)=>s+p.h,0)};
  });
  document.getElementById('priorityTableBody-aglomerados').innerHTML = rows.map(r=>`
    <tr>
      <td><span class="pr-swatch" style="background:${PR_COLORS_HEX[r.lvl]}"></span>${PR_LABELS[r.lvl]}</td>
      <td>${fmt(r.agl)}</td>
      <td>${fmt(r.dom)}</td>
      <td>${fmt(r.hab)}</td>
    </tr>`).join('') + `
    <tr class="total-row">
      <td>TOTAL</td>
      <td>${fmt(total)}</td>
      <td>${fmt(totalDom)}</td>
      <td>${fmt(totalHab)}</td>
    </tr>`;
}
document.getElementById('segIndicador-aglomerados').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  document.querySelectorAll('#segIndicador-aglomerados button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.indicadorAglom = btn.dataset.ind;
  renderMap();
  renderTabAglomerados();
});

// ================= município: detalhe compartilhado =================
function renderMuniDetail(){
  const panel = document.getElementById('muniDetailPanel');
  if(!state.selectedMun){ panel.style.display='none'; return; }
  const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
  if(!f){ panel.style.display='none'; return; }
  const p = f.properties;
  panel.style.display='';

  if(state.tab==='aglomerados'){
    document.getElementById('muniDetailName').textContent = `${p.nm_mun} — Central: ${p.central} · Polo: ${p.nm_polo}`;
    const totalAgl = p.aglomerados_planilha||0;
    const detailGrid = `
      <div class="detail-grid">
        <div class="detail-item"><div class="v">${fmt(p.habitantes_aglomerados||0)}</div><div class="l">Habitantes (aglomerados)</div></div>
        <div class="detail-item"><div class="v">${fmt(p.domicilios||0)}</div><div class="l">Domicílios</div></div>
        <div class="detail-item"><div class="v">${fmt(totalAgl)}</div><div class="l">Aglomerados rurais</div></div>
        <div class="detail-item"><div class="v">${p.area_km2?fmt(p.area_km2)+' km²':'—'}</div><div class="l">Área do município</div></div>
      </div>`;
    function breakdownRows(prefix){
      return PR_LEVELS.map(lvl=>{
        const val = p[prefix+'_'+lvl]||0;
        const pct = totalAgl ? (val/totalAgl*100).toFixed(1) : '0.0';
        return `<div class="donut-legend-row">
          <span><span class="sw" style="background:${PR_COLORS_HEX[lvl]}"></span>${PR_LABELS[lvl]}</span>
          <span>${fmt(val)} <span style="color:#5A6673;font-weight:400;">(${pct}%)</span></span>
        </div>`;
      }).join('');
    }
    const breakdown = totalAgl > 0 ? `
      <div class="detail-breakdown">
        <div><h4>Água — por prioridade</h4>${breakdownRows('agua')}</div>
        <div><h4>Esgoto — por prioridade</h4>${breakdownRows('esg')}</div>
      </div>` : `<p style="color:#7A8794;font-size:12.5px;">Este município não possui aglomerado rural isolado classificado na base (setores censitários 5, 6 e 7 do IBGE 2022).</p>`;
    document.getElementById('muniDetailBody').innerHTML = detailGrid + breakdown +
      `<p style="font-size:11px;color:#5A6673;margin:10px 0 0;border-top:1px dashed #E3E7EB;padding-top:8px;">Esta é a consulta detalhada de aglomerados. Trocar de aba mostra outros indicadores para o mesmo município.</p>`;
    return;
  }

  document.getElementById('muniDetailName').textContent = `${p.nm_mun} — Polo: ${p.nm_polo} · ${p.nm_msb}`;
  const aguaRural = classifyAgua(sumAgua([f],'rural'), domTotalSingle(p,'rural'));
  const esgRural = classifyEsg(sumEsg([f],'rural'), domTotalSingle(p,'rural'));
  const aglCount = PONTOS.filter(p=>p.m===state.selectedMun).length;
  document.getElementById('muniDetailBody').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><div class="v">${fmt1(aguaRural.pctAdeq)}%</div><div class="l">Água adequada — Rural</div></div>
      <div class="detail-item"><div class="v">${fmt1(esgRural.pctAdeq)}%</div><div class="l">Esgoto adequado — Rural</div></div>
      <div class="detail-item"><div class="v">${fmt(aglCount)}</div><div class="l">Aglomerados rurais</div></div>
      <div class="detail-item"><div class="v">${p.nm_polo}</div><div class="l">Polo Regional</div></div>
    </div>
    <p style="font-size:11.5px;color:#5A6673;margin:4px 0 0;">Os gráficos da aba ativa já refletem apenas este município. A seleção vale para todas as 5 abas.</p>
  `;
}

// ================= navegação entre abas =================
function switchTab(tab){
  state.tab = tab;
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+tab));
  renderCurrentTab();
}
document.getElementById('tabbar').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  switchTab(btn.dataset.tab);
});

function renderCurrentTab(){
  renderMap();
  if(state.tab==='agua') renderTabAgua();
  else if(state.tab==='esgoto') renderTabEsgoto();
  else if(state.tab==='agua_rural') renderTabAguaRural();
  else if(state.tab==='esgoto_rural') renderTabEsgotoRural();
  else if(state.tab==='aglomerados') renderTabAglomerados();
  renderMuniDetail();
}

// ================= ações de filtro / seleção (compartilhadas) =================
function updateMuniSelectionUI(){
  const btn = document.getElementById('muniClear');
  const hasSelection = !!state.selectedMun;
  btn.classList.toggle('visible', hasSelection);
  btn.disabled = !hasSelection;
  btn.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
}

function toggleMunicipio(codMun){
  if(state.selectedMun === codMun) clearMunicipio();
  else selectMunicipio(codMun);
}

function selectMunicipio(codMun){
  state.selectedMun = codMun;
  const f = GEO.features.find(f=>f.properties.cod_mun===codMun);
  document.getElementById('muniSearch').value = f?f.properties.nm_mun:'';
  updateMuniSelectionUI();
  zoomToMunicipio(codMun);
  renderCurrentTab();
}
function clearMunicipio(){
  state.selectedMun = null;
  document.getElementById('muniSearch').value = '';
  updateMuniSelectionUI();
  zoomToRegiao();
  renderCurrentTab();
}
function applyRegiaoFilter(nome){
  state.regiao = nome;
  state.selectedMun = null;
  document.getElementById('muniSearch').value = '';
  updateMuniSelectionUI();
  renderControls();
  zoomToRegiao();
  renderCurrentTab();
}

// ================= inicialização =================
renderControls();
updateMuniSelectionUI();
populateMuniList();
buildMapSkeleton();
switchTab('agua');
