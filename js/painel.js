const GEO = window.GEO_DATA;
document.getElementById('genDate').textContent = new Date().toLocaleDateString('pt-BR');

// ---------------- estado ----------------
let state = {
  tab: 'esgoto',
  groupBy: 'territorio',
  regiao: 'todas',
  selectedMun: null,
};

function fmt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function fmt1(n){ return (n||0).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}); }

/* Escala do mapa: déficit de adequação (0% = tudo adequado → 100% = nada adequado).
   Paleta marrom do esgotamento (escuro = adequado → claro = sem banheiro). */
function colorForPct(p){
  const stops = [
    {v:0,  c:[26,15,8]},      // #1A0F08 — 100% adequado
    {v:25, c:[92,58,30]},     // #5C3A1E
    {v:50, c:[139,90,43]},    // #8B5A2B
    {v:75, c:[201,154,74]},   // #C99A4A
    {v:100,c:[245,235,221]},  // #F5EBDD — 0% adequado
  ];
  let lo=stops[0], hi=stops[stops.length-1];
  for(let i=0;i<stops.length-1;i++){ if(p>=stops[i].v && p<=stops[i+1].v){ lo=stops[i]; hi=stops[i+1]; break; } }
  const t = (hi.v===lo.v) ? 0 : (p-lo.v)/(hi.v-lo.v);
  const c = lo.c.map((x,i)=>Math.round(x + (hi.c[i]-x)*t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* Cores fixas por categoria SIDRA — paleta marrom do esgotamento */
const ESG_CAT_COLORS = {
  esg_rede:      '#1A0F08', // Rede geral / pluvial ou fossa ligada
  esg_fossa_sep: '#5C3A1E', // Fossa séptica / filtro não ligada à rede
  esg_fossa_rud: '#8B5A2B', // Fossa rudimentar ou buraco
  esg_vala:      '#B8752F', // Vala
  esg_rio:       '#C99A4A', // Rio, lago, córrego ou mar
  esg_outra:     '#D9BC8C', // Outra forma
  esg_sem:       '#F5EBDD', // Sem banheiro
};
function categoryColors(cats){
  return cats.map(c => ESG_CAT_COLORS[c.key] || '#6b7c8a');
}

// ---------------- agregação SIDRA 6805 ----------------
const ESG_KEYS = ['esg_rede','esg_fossa_sep','esg_fossa_rud','esg_vala','esg_rio','esg_outra','esg_sem'];

function sumEsg(feats){
  const out = { esg_total:0 };
  ESG_KEYS.forEach(k=> out[k]=0);
  feats.forEach(f=>{
    const p = f.properties;
    out.esg_total += p.esg_total||0;
    ESG_KEYS.forEach(k=> out[k] += p[k]||0);
  });
  return out;
}

function classifyEsg(v){
  const adequado = (v.esg_rede||0) + (v.esg_fossa_sep||0);
  const inadequado = (v.esg_fossa_rud||0) + (v.esg_vala||0) + (v.esg_rio||0) + (v.esg_outra||0);
  const sem = v.esg_sem||0;
  const total = v.esg_total||0;
  return {
    adequado, inadequado, sem, total,
    pctAdeq: total? adequado/total*100:0,
    pctInadeq: total? inadequado/total*100:0,
    pctSem: total? sem/total*100:0,
  };
}

function mapMetricPct(p){
  return classifyEsg({
    esg_total: p.esg_total,
    esg_rede: p.esg_rede,
    esg_fossa_sep: p.esg_fossa_sep,
    esg_fossa_rud: p.esg_fossa_rud,
    esg_vala: p.esg_vala,
    esg_rio: p.esg_rio,
    esg_outra: p.esg_outra,
    esg_sem: p.esg_sem,
  });
}

const TERRITORIOS = [...new Set(GEO.features.map(f=>f.properties.territorio).filter(Boolean))]
  .sort((a,b)=>a.localeCompare(b,'pt-BR'));

function regiaoKey(){
  return state.groupBy === 'semiarido' ? 'semiarido' : 'territorio';
}

function currentSelectionFeatures(){
  if(state.selectedMun) return GEO.features.filter(f=>f.properties.cod_mun===state.selectedMun);
  if(state.regiao!=='todas') return GEO.features.filter(f=>f.properties[regiaoKey()]===state.regiao);
  return GEO.features;
}
function currentSelectionLabel(){
  if(state.selectedMun){
    const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
    return 'Município — ' + (f?f.properties.nm_mun:state.selectedMun);
  }
  if(state.regiao!=='todas'){
    if(state.groupBy==='semiarido'){
      return (state.regiao==='SIM' ? 'Semiárido — SIM' : 'Semiárido — NÃO');
    }
    return 'Território de Identidade — ' + state.regiao;
  }
  return 'Estado da Bahia — 417 municípios';
}

function isFullState(){
  return !state.selectedMun && state.regiao === 'todas';
}

function fmtDeltaPp(pp){
  const sign = pp > 0 ? '+' : '';
  return sign + fmt1(pp) + ' p.p.';
}

function deltaClass(pp, higherIsBetter){
  if(Math.abs(pp) < 0.05) return 'neu';
  const better = higherIsBetter ? pp > 0 : pp < 0;
  return better ? 'up' : 'down';
}

/** Painel de contexto: metodologia (Bahia) ou comparação compacta com o Estado. */
function renderVsBahiaHtml({ label, feats, v, cl, pop, bahiaV, bahiaCl, bahiaPop, semLabel }){
  if(isFullState()){
    return `<p><b>${label}</b><br><br>
      Dados SIDRA/IBGE (Censo 2022) — domicílios particulares permanentes ocupados por tipo de esgotamento sanitário.
      <br><br>
      <b>Adequado</b> = rede geral/pluvial ou fossa ligada à rede + fossa séptica/filtro não ligada à rede.
      <br><b>Inadequado</b> = fossa rudimentar, vala, rio/lago/mar ou outra forma.
    </p>`;
  }

  const shareDom = bahiaV.esg_total ? (v.esg_total||0)/bahiaV.esg_total*100 : 0;
  const sharePop = bahiaPop ? pop/bahiaPop*100 : 0;
  const shareMun = GEO.features.length ? feats.length/GEO.features.length*100 : 0;
  const dAdeq = cl.pctAdeq - bahiaCl.pctAdeq;
  const dInadeq = cl.pctInadeq - bahiaCl.pctInadeq;
  const dSem = cl.pctSem - bahiaCl.pctSem;

  const cell = (titulo, sel, ba, delta, betterHigher) => `
    <div class="cmp-cell">
      <div class="cmp-cell-lbl">${titulo}</div>
      <div class="cmp-cell-vals">
        <div><span class="cmp-k">Seleção</span><span class="cmp-n">${fmt1(sel)}%</span></div>
        <div><span class="cmp-k">Bahia</span><span class="cmp-n muted">${fmt1(ba)}%</span></div>
      </div>
      <div class="cmp-delta ${deltaClass(delta, betterHigher)}">${fmtDeltaPp(delta)}</div>
    </div>`;

  return `
    <div class="cmp-wrap">
      <div class="cmp-label">${label}</div>
      <div class="cmp-shares">
        <div class="cmp-share"><strong>${fmt1(shareDom)}%</strong><span>dos domicílios da BA</span></div>
        <div class="cmp-share"><strong>${fmt1(sharePop)}%</strong><span>da população da BA</span></div>
        <div class="cmp-share"><strong>${fmt(feats.length)}</strong><span>de ${fmt(GEO.features.length)} municípios (${fmt1(shareMun)}%)</span></div>
      </div>
      <div class="cmp-grid">
        ${cell('Atendimento adequado', cl.pctAdeq, bahiaCl.pctAdeq, dAdeq, true)}
        ${cell('Inadequado', cl.pctInadeq, bahiaCl.pctInadeq, dInadeq, false)}
        ${cell(semLabel, cl.pctSem, bahiaCl.pctSem, dSem, false)}
      </div>
    </div>`;
}

// ---------------- controles ----------------
function renderControls(){
  document.querySelectorAll('#segGroupBy button').forEach(b=>b.classList.toggle('active', b.dataset.g===state.groupBy));
  const usaSelect = state.groupBy==='territorio';
  const usaChips = state.groupBy==='semiarido';
  document.getElementById('chipsPolo').style.display = usaChips ? 'flex' : 'none';
  document.getElementById('selectMicro').style.display = usaSelect ? '' : 'none';

  const chipsWrap = document.getElementById('chipsPolo');
  chipsWrap.innerHTML = '';
  if(usaChips){
    [['todas','Todo o Estado'],['SIM','Semiárido (SIM)'],['NÃO','Fora do Semiárido (NÃO)']].forEach(([val,lbl])=>{
      const b = document.createElement('button');
      b.className = 'chip' + (state.regiao===val ? ' active':'');
      b.textContent = lbl;
      b.onclick = ()=> applyRegiaoFilter(val);
      chipsWrap.appendChild(b);
    });
  }

  const sel = document.getElementById('selectMicro');
  sel.innerHTML = '<option value="todas">Todo o Estado</option>' +
    TERRITORIOS.map(m=>`<option value="${m}">${m}</option>`).join('');
  sel.value = usaSelect ? state.regiao : 'todas';
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

// ---------------- mapa ----------------
let mapSvgEl = null;
let currentZoomScale = 1;
let touchHintTimer = null;
const MUN_FILL_NEUTRAL = '#EFEFEF';
const MUN_FILL_GRAYOUT = '#C7CDD3';

function hintTextFromTarget(el){
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
    const target = e.target.closest('.mun-path');
    if(!target) return;
    toggleMunicipio(GEO.features[+target.dataset.idx].properties.cod_mun);
  });
}

function buildMapSkeleton(){
  computeBounds();
  let paths = '';
  GEO.features.forEach((f,idx)=>{ paths += `<path class="mun-path" data-idx="${idx}" d="${geomToPath(f.geometry)}" fill-rule="evenodd"></path>`; });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<svg id="mapSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g id="zoomGroup"><g id="munLayer">${paths}</g></g></svg>`;
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

function renderMap(){
  mountMapInActiveTab();

  document.querySelectorAll('#munLayer .mun-path').forEach(pathEl=>{
    const p = GEO.features[+pathEl.dataset.idx].properties;
    const isSelected = state.selectedMun===p.cod_mun;
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

  const legendHtml = [['100% adequado',0],['75%',25],['50%',50],['25%',75],['0% adequado',100]].map(([lbl,v])=>
    `<span><span class="sw" style="background:${colorForPct(v)}"></span>${lbl}</span>`).join('') +
    `<span><span class="sw" style="background:${MUN_FILL_NEUTRAL}"></span>Sem dado</span>`;
  const legendSlot = document.querySelector('#view-'+state.tab+' .legend-slot');
  if(legendSlot) legendSlot.innerHTML = legendHtml;
}

// ================= VIEW ESGOTO =================
const ESG_COMP_CATS = [
  {key:'esg_rede', label:'Rede geral / pluvial ou fossa ligada à rede', good:true},
  {key:'esg_fossa_sep', label:'Fossa séptica/filtro não ligada à rede', good:true},
  {key:'esg_fossa_rud', label:'Fossa rudimentar ou buraco', good:false},
  {key:'esg_vala', label:'Vala', good:false},
  {key:'esg_rio', label:'Rio, lago, córrego ou mar', good:false},
  {key:'esg_outra', label:'Outra forma', good:false},
  {key:'esg_sem', label:'Sem banheiro nem sanitário', good:false},
];

function renderTabEsgoto(){
  const feats = currentSelectionFeatures();
  const v = sumEsg(feats);
  const cl = classifyEsg(v);
  const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
  const popUrb = feats.reduce((s,f)=>s+(f.properties.pop_urbana||0),0);
  const popRur = feats.reduce((s,f)=>s+(f.properties.pop_rural||0),0);
  const comBanh = Math.max(0, (v.esg_total||0) - (v.esg_sem||0));
  const pctCom = v.esg_total ? comBanh/v.esg_total*100 : 0;
  const pctSem = v.esg_total ? (v.esg_sem||0)/v.esg_total*100 : 0;

  const bahiaV = sumEsg(GEO.features);
  const bahiaCl = classifyEsg(bahiaV);
  const bahiaPop = GEO.features.reduce((s,f)=>s+(f.properties.populacao||0),0);
  const vsBa = !isFullState();
  const dAdeq = cl.pctAdeq - bahiaCl.pctAdeq;

  document.getElementById('kpiRow-esgoto').innerHTML = `
    <div class="kpi"><div class="val">${fmt(feats.length)}</div><div class="lbl">Municípios na seleção</div></div>
    <div class="kpi"><div class="val">${fmt(pop)}</div><div class="lbl">População (Censo 2022)</div></div>
    <div class="kpi bom"><div class="val">${fmt(comBanh)}</div><div class="sub">${fmt1(pctCom)}%</div><div class="lbl">Domicílios c/ banheiro ou sanitário</div></div>
    <div class="kpi alerta"><div class="val">${fmt(v.esg_sem)}</div><div class="sub">${fmt1(pctSem)}%</div><div class="lbl">Sem banheiro nem sanitário</div></div>
    <div class="kpi ${cl.pctAdeq>=70?'bom':cl.pctAdeq<40?'alerta':''}"><div class="val">${fmt1(cl.pctAdeq)}%</div>${vsBa?`<div class="sub vs-ba-kpi ${deltaClass(dAdeq,true)}">${fmtDeltaPp(dAdeq)} vs Bahia (${fmt1(bahiaCl.pctAdeq)}%)</div>`:''}<div class="lbl">Atendimento adequado</div></div>
  `;

  const colors = categoryColors(ESG_COMP_CATS);
  const compHeader = document.querySelector('#view-esgoto .area-comp .panel-header span');
  if(compHeader){
    compHeader.textContent = vsBa
      ? 'Composição — seleção × Bahia'
      : 'Composição do esgotamento sanitário';
  }
  document.getElementById('compChart-esgoto').innerHTML = cl.total>0 ? (
    (vsBa ? `<div class="comp-legend"><span class="lg sel"></span> Seleção<span class="lg ba"></span> Bahia</div>` : '') +
    ESG_COMP_CATS.map((c,i)=>{
      const val = v[c.key]||0, pct = cl.total? val/cl.total*100:0;
      const baPct = bahiaCl.total ? (bahiaV[c.key]||0)/bahiaCl.total*100 : 0;
      const light = colors[i].toUpperCase() === '#F5EBDD';
      const fillExtra = light ? ';box-shadow:inset 0 0 0 1px #D9BC8C' : '';
      if(!vsBa){
        return `<div class="chart-row"><div class="name" title="${c.label}">${c.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}${fillExtra}"></div></div>
          <div class="pct">${fmt(val)} (${fmt1(pct)}%)</div></div>`;
      }
      return `<div class="chart-row dual">
        <div class="name" title="${c.label}">${c.label}</div>
        <div class="dual-bars">
          <div class="dual-line">
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}${fillExtra}"></div></div>
            <div class="pct">${fmt1(pct)}%</div>
          </div>
          <div class="dual-line ba">
            <div class="bar-track"><div class="bar-fill ba" style="width:${baPct}%"></div></div>
            <div class="pct">${fmt1(baPct)}%</div>
          </div>
        </div>
        <div class="pct abs">${fmt(val)}</div>
      </div>`;
    }).join('')
  ) : '<div class="empty-msg">Sem dado para esta seleção.</div>';

  document.getElementById('banheiroChart-esgoto').innerHTML = `
    <div class="banheiro-row">
      <div class="banheiro-label">Domicílios</div>
      <div class="bar2"><div class="seg-com lab" style="width:${pctCom}%">${pctCom>12?fmt1(pctCom)+'%':''}</div><div class="seg-sem lab" style="width:${pctSem}%">${pctSem>8?fmt1(pctSem)+'%':''}</div></div>
    </div>
    <div class="banheiro-stats">
      <span><span style="color:#1A0F08;font-weight:700;">●</span> ${fmt(comBanh)} com banheiro/sanitário (${fmt1(pctCom)}%)</span>
      <span><span style="color:#8B5A2B;font-weight:700;">●</span> ${fmt(v.esg_sem)} sem banheiro/sanitário (${fmt1(pctSem)}%)</span>
    </div>
    <div class="banheiro-stats" style="margin-top:10px;">
      <span>Pop. urbana: <b>${fmt(popUrb)}</b></span>
      <span>Pop. rural: <b>${fmt(popRur)}</b></span>
    </div>`;

  const scopeHeader = document.querySelector('#view-esgoto .area-scope .panel-header');
  if(scopeHeader) scopeHeader.textContent = vsBa ? 'Comparação com a Bahia' : 'Nível selecionado';

  document.getElementById('scopeInfo-esgoto').innerHTML = renderVsBahiaHtml({
    label: currentSelectionLabel(),
    feats, v, cl, pop, bahiaV, bahiaCl, bahiaPop,
    semLabel: 'Sem banheiro/sanitário',
  });
}

// ================= município: detalhe =================
function renderMuniDetail(){
  const panel = document.getElementById('muniDetailPanel');
  if(!state.selectedMun){ panel.style.display='none'; return; }
  const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
  if(!f){ panel.style.display='none'; return; }
  const p = f.properties;
  panel.style.display='';

  document.getElementById('muniDetailName').textContent = p.nm_mun;

  const esg = classifyEsg(p);
  const meta = [p.territorio, p.semiarido==='SIM' ? 'Semiárido' : null].filter(Boolean).join(' · ');
  document.getElementById('muniDetailBody').innerHTML = `
    <p class="muni-detail-meta" title="${meta}">${meta}</p>
    <div class="detail-grid">
      <div class="detail-item"><div class="v">${fmt1(esg.pctAdeq)}%</div><div class="l">Esgoto adequado</div></div>
      <div class="detail-item"><div class="v">${fmt(p.populacao)}</div><div class="l">População</div></div>
      <div class="detail-item"><div class="v">${fmt(p.esg_total)}</div><div class="l">Domicílios</div></div>
      <div class="detail-item wide"><div class="v text">${p.territorio}</div><div class="l">Território de Identidade</div></div>
    </div>
  `;
}

function renderCurrentTab(){
  renderMap();
  renderTabEsgoto();
  renderMuniDetail();
}

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

renderControls();
updateMuniSelectionUI();
populateMuniList();
buildMapSkeleton();
renderCurrentTab();
