/**
 * Converte SHP/Indicadores_Sidra_BA.shp → js/geo-data.js (+ data/geo-data.json)
 * Normaliza nomes truncados/corrompidos do DBF para chaves estáveis usadas pelo painel.
 */
const fs = require('fs');
const path = require('path');
const shapefile = require('shapefile');

const ROOT = path.join(__dirname, '..');
const SHP = path.join(ROOT, 'SHP', 'Indicadores_Sidra_BA.shp');
const DBF = path.join(ROOT, 'SHP', 'Indicadores_Sidra_BA.dbf');

function fixText(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t) return t;
  // DBF UTF-8 lido como latin1 → mojibake
  if (/[ÃÂ]/.test(t)) {
    try {
      const fixed = Buffer.from(t, 'latin1').toString('utf8');
      if (fixed && !/[ÃÂ]/.test(fixed)) return fixed.trim();
    } catch (_) { /* keep */ }
  }
  return t;
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pick(props, ...keys) {
  for (const k of keys) {
    if (props[k] != null && props[k] !== '') return props[k];
  }
  // fallback: match by prefix (DBF names vary with encoding)
  const entries = Object.entries(props);
  for (const want of keys) {
    const hit = entries.find(([k]) => k === want || k.startsWith(want.slice(0, 8)));
    if (hit && hit[1] != null && hit[1] !== '') return hit[1];
  }
  return null;
}

function normalizeProps(raw) {
  const nome = fixText(pick(raw, 'Municipio', 'Nome_do_Mu') || '');
  const territorio = fixText(pick(raw, 'Territorio') || '');
  const regiaoRaw = fixText(pick(raw, 'RegiÃ£o_do', 'Região_do', 'Regiao_do') || '');
  // Campo truncado "Região do …" → SIM/NÃO (padrão espacial = Semiárido)
  const semiarido = /sim/i.test(String(regiaoRaw)) ? 'SIM' : 'NÃO';

  const cod = String(Math.round(num(pick(raw, 'CodIBGE', 'CodÃ­go_do', 'Código_do'))));

  return {
    cod_mun: cod,
    nm_mun: nome,
    territorio,
    semiarido,
    populacao: num(pick(raw, 'PopulaÃ§Ã£', 'População', 'Populacao')),
    pessoas_indigenas: num(pick(raw, 'Pessoas_In')),
    pessoas_quilombolas: num(pick(raw, 'Pessoas_qu')),
    total_domicilios: num(pick(raw, 'Total_Domi')),
    pop_urbana: num(pick(raw, 'ST_D_URBA_')),
    pop_rural: num(pick(raw, 'ST_D_RURAL')),

    // SIDRA 6805 — esgotamento sanitário (domicílios)
    esg_total: num(pick(raw, 'ESG_TOTAL')),
    esg_rede: num(pick(raw, 'ESG_RRPFLG')),       // rede geral/pluvial ou fossa ligada à rede
    esg_fossa_sep: num(pick(raw, 'ESG_FFFNLG')),  // fossa séptica/filtro não ligada à rede
    esg_fossa_rud: num(pick(raw, 'ESG_FR_B')),    // fossa rudimentar ou buraco
    esg_vala: num(pick(raw, 'ESG_VALA')),
    esg_rio: num(pick(raw, 'ESG_R_L_CM')),        // rio, lago, córrego ou mar
    esg_outra: num(pick(raw, 'ESG_OUTR')),
    esg_sem: num(pick(raw, 'ESG_N_T_BS')),        // não tinham banheiro nem sanitário

    esg_rede_p: num(pick(raw, 'ESGRRPFLGp')),
    esg_fossa_sep_p: num(pick(raw, 'ESGFFFNLGp')),
    esg_fossa_rud_p: num(pick(raw, 'ESG_FR_B_p')),
    esg_vala_p: num(pick(raw, 'ESG_VALA_p')),
    esg_rio_p: num(pick(raw, 'ESG_RLCM_p')),
    esg_outra_p: num(pick(raw, 'ESG_OUTR_p')),
    esg_sem_p: num(pick(raw, 'ESG_NTBS_p')),

    // Abastecimento de água (SIDRA)
    aa_total: num(pick(raw, 'AA_TOTAL')),
    aa_rede: num(pick(raw, 'AA_L_R_G')),
    aa_poco_prof: num(pick(raw, 'AA_PP_A')),
    aa_poco_raso: num(pick(raw, 'AA_PR_F_C')),
    aa_fonte: num(pick(raw, 'AA_F_N_M')),
    aa_pipa: num(pick(raw, 'AA_CP')),
    aa_chuva: num(pick(raw, 'AA_ACA')),
    aa_rio: num(pick(raw, 'AA_RACLI')),
    aa_outra: num(pick(raw, 'AA_OUTRA')),
    aa_sem_rede: num(pick(raw, 'AA_NPL_RG')),
  };
}

/** Arredonda coordenadas (graus) para reduzir o JS sem perder desenho em mapa SVG. */
function roundCoord(n, decimals = 5) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Douglas–Peucker — reduz vértices mantendo a silhueta no mapa estadual. */
function simplifyRing(ring, tolerance) {
  if (!ring || ring.length <= 3) return ring;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  function distSq(p, a, b) {
    let x = a[0], y = a[1];
    let dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  }

  function rec(first, last) {
    let maxD = 0, idx = -1;
    const a = ring[first], b = ring[last];
    for (let i = first + 1; i < last; i++) {
      const d = distSq(ring[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sqTol && idx >= 0) {
      keep[idx] = 1;
      rec(first, idx);
      rec(idx, last);
    }
  }
  rec(0, ring.length - 1);

  const out = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  // fecha o anel
  if (out.length >= 2) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  }
  return out.length >= 4 ? out : ring;
}

function simplifyGeometry(geom, tolerance) {
  const simpPoly = (poly) => poly.map((ring) => simplifyRing(ring, tolerance));
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: simpPoly(geom.coordinates) };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map(simpPoly),
    };
  }
  return geom;
}

function roundGeometry(geom, decimals = 5) {
  const roundPos = (pos) => {
    if (!Array.isArray(pos)) return pos;
    if (typeof pos[0] === 'number') {
      return [roundCoord(pos[0], decimals), roundCoord(pos[1], decimals)];
    }
    return pos.map(roundPos);
  };
  return { type: geom.type, coordinates: roundPos(geom.coordinates) };
}

async function main() {
  const source = await shapefile.open(SHP, DBF, { encoding: 'utf-8' });
  // ~110 m em graus — suficiente para SVG estadual, alinhado ao tamanho do geo antigo
  const TOLERANCE = 0.001;
  const features = [];
  while (true) {
    const r = await source.read();
    if (r.done) break;
    const f = r.value;
    if (!f || !f.geometry) continue;
    const geom = roundGeometry(simplifyGeometry(f.geometry, TOLERANCE), 5);
    features.push({
      type: 'Feature',
      geometry: geom,
      properties: normalizeProps(f.properties || {}),
    });
  }

  features.sort((a, b) => a.properties.nm_mun.localeCompare(b.properties.nm_mun, 'pt-BR'));

  const geo = { type: 'FeatureCollection', features };
  const jsonPath = path.join(ROOT, 'data', 'geo-data.json');
  const jsPath = path.join(ROOT, 'js', 'geo-data.js');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  const json = JSON.stringify(geo);
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(jsPath, 'window.GEO_DATA = ' + json + ';\n');

  let nCoords = 0;
  const walk = (pos) => {
    if (!Array.isArray(pos)) return;
    if (typeof pos[0] === 'number') { nCoords++; return; }
    pos.forEach(walk);
  };
  features.forEach((f) => walk(f.geometry.coordinates));

  const terr = [...new Set(features.map((f) => f.properties.territorio))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  );
  console.log(`OK: ${features.length} municípios → ${jsPath}`);
  console.log(`Vértices: ${nCoords} | Tamanho: ${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB`);
  console.log(`Territórios (${terr.length}): ${terr.join(', ')}`);
  console.log('Exemplo:', features[0].properties);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
