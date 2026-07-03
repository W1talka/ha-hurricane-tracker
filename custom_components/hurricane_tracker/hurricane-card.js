/* ============================================================================
 * hurricane-card.js — Atlantic & Pacific hurricane cone card (NHC data)
 * A standalone Home Assistant Lovelace card. Draws a storm-framed SVG cone from
 * the Hurricane Tracker integration: basemap (coast + state lines + land), the
 * cone of uncertainty, past + forecast tracks, Saffir-Simpson forecast dots,
 * watch/warning coastal segments, current-position marker, and a home pin —
 * with a data bar underneath.
 *
 * Data arrives over the integration's websocket command (authenticated, keeps
 * the large geometry out of entity attributes). Storm-identity colors (the
 * Saffir-Simpson dot ramp + NHC watch/warning colors) are fixed hexes on
 * purpose; everything else follows the active HA theme.
 * ========================================================================== */

const WS_TYPE = "hurricane_tracker/data";
const REFRESH_MS = 5 * 60 * 1000;   // re-pull at most every 5 min (coordinator polls every 30)
const VBW = 800, VBH = 600;

/* Saffir-Simpson identity colors (fixed — a Cat-3 dot must read as Cat-3 on any
 * theme). TD/TS are the sub-hurricane intensities. */
const CAT_COLOR = {
  TD: "#5BA8E0", TS: "#3ECC7A",
  "1": "#FFE14D", "2": "#FFB52E", "3": "#FF7A33", "4": "#FF4D6D", "5": "#E05BE0",
};
const catColor = (c) => CAT_COLOR[c] || CAT_COLOR.TS;

/* NHC watch/warning coastal-segment identity colors, keyed by TCWW code. */
const WW_COLOR = { TWA: "#FFE14D", TWR: "#3B7DDB", HWA: "#FF6FB0", HWR: "#E03030" };
const wwColor = (t) => WW_COLOR[(t || "").toUpperCase()] || null;

function catDotLabel(c) {
  const k = String(c || "").toUpperCase();
  if (["1", "2", "3", "4", "5"].includes(k)) return k;
  return k === "TD" ? "TD" : "TS";
}
function catLabel(c) {
  if (c == null || c === "") return "";
  const k = String(c).toUpperCase();
  if (["1", "2", "3", "4", "5"].includes(k)) return "CAT " + k;
  if (k === "TS" || k === "TD") return k;
  if (/HURRICANE/.test(k)) return "HURRICANE";
  if (/TROP.*STORM/.test(k)) return "TS";
  if (/DEPRESS/.test(k)) return "TD";
  return "";
}
const withCommas = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---- projection: lng/lat -> SVG px through the storm bbox ----------------- */
function makeProject(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const cosf = Math.max(0.2, Math.cos(midLat * Math.PI / 180));
  const wLng = (maxLng - minLng) * cosf;
  const hLat = (maxLat - minLat);
  const s = Math.min(VBW / wLng, VBH / hLat);
  const ox = (VBW - wLng * s) / 2;
  const oy = (VBH - hLat * s) / 2;
  return (lng, lat) => [ox + (lng - minLng) * cosf * s, oy + (maxLat - lat) * s];
}
const ptsStr = (proj, coords) =>
  coords.map(([lng, lat]) => { const [x, y] = proj(lng, lat); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");

/* ---- forecast-dot time-label declutter (spoke placement + thinning) ------- */
const CHAR_W = 9.2, LBL_H = 17, R_OUT = 16, MIN_GAP = 34;
function labelBox(cx, cy, w, deg) {
  const r = deg * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
  const leftward = Math.abs(deg) > 90;
  const nx = cx + ux * R_OUT, ny = cy + uy * R_OUT;
  const fx = nx + ux * (leftward ? -w : w), fy = ny + uy * (leftward ? -w : w);
  const pad = LBL_H / 2;
  return { x1: Math.min(nx, fx) - pad, y1: Math.min(ny, fy) - pad,
           x2: Math.max(nx, fx) + pad, y2: Math.max(ny, fy) + pad };
}
const boxHit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
function thinLabels(jobs) {
  if (jobs.length <= 2) return jobs.slice();
  const kept = [jobs[0]]; let lastKept = jobs[0];
  for (let i = 1; i < jobs.length - 1; i++) {
    const j = jobs[i];
    if (Math.hypot(j.cx - lastKept.cx, j.cy - lastKept.cy) >= MIN_GAP) { kept.push(j); lastKept = j; }
  }
  kept.push(jobs[jobs.length - 1]);
  return kept;
}
function placeLabels(jobsIn) {
  const jobs = thinLabels(jobsIn), placed = [];
  for (const j of jobs) {
    const w = (j.text ? j.text.length : 0) * CHAR_W;
    const away = (j.tdy > 0) ? -1 : 1;
    let chosen = 0;
    if (placed.some((pb) => boxHit(labelBox(j.cx, j.cy, w, 0), pb))) {
      let done = false;
      for (const step of [15, 30, 45]) {
        const deg = away * step;
        if (!placed.some((pb) => boxHit(labelBox(j.cx, j.cy, w, deg), pb))) { chosen = deg; done = true; break; }
      }
      if (!done) chosen = away * 45;
    }
    j.deg = chosen;
    j.anchor = Math.abs(chosen) > 90 ? "end" : "start";
    placed.push(labelBox(j.cx, j.cy, w, chosen));
  }
  return jobs;
}

/* mdi-home as an SVG path, scaled + centered. */
const MDI_HOME_PATH = "M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z";
function houseGlyph(cx, cy) {
  const S = 1.5;
  return `<g class="hu-home" transform="translate(${(cx - 12 * S).toFixed(2)},${(cy - 12 * S).toFixed(2)}) scale(${S})"><path d="${MDI_HOME_PATH}"/></g>`;
}

/* Off-screen home: clamp the house near the viewport edge and draw a chevron on
 * the inboard (storm) side, pointing outward through the house center along the
 * true storm->home line. Total home distance labeled further inboard. */
const EDGE_M = 50;
function homeEdgeMarker(hx, hy, m) {
  const cx = Math.max(EDGE_M, Math.min(VBW - EDGE_M, hx));
  const cy = Math.max(EDGE_M, Math.min(VBH - EDGE_M, hy));
  let ux = hx - cx, uy = hy - cy;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len; uy /= len;                 // unit vector, house -> true home (outboard)
  const px = -uy, py = ux;              // perpendicular
  const parts = [];
  // arrow: tail (inboard) -> shaft -> arrowhead pointing outward through the house
  const wing = 11;
  const tipx = cx - ux * 22, tipy = cy - uy * 22;      // arrowhead tip, toward house
  const tailx = cx - ux * 46, taily = cy - uy * 46;    // tail end, inboard
  parts.push(`<line class="hu-edge-chev" x1="${tailx.toFixed(1)}" y1="${taily.toFixed(1)}" x2="${tipx.toFixed(1)}" y2="${tipy.toFixed(1)}"/>`);
  const b1x = tipx - ux * wing + px * wing * 0.7, b1y = tipy - uy * wing + py * wing * 0.7;
  const b2x = tipx - ux * wing - px * wing * 0.7, b2y = tipy - uy * wing - py * wing * 0.7;
  parts.push(`<polyline class="hu-edge-chev" points="${b1x.toFixed(1)},${b1y.toFixed(1)} ${tipx.toFixed(1)},${tipy.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)}"/>`);
  if (m && m.dist != null) {
    const unit = m.distUnit || "mi";
    const lx = cx - ux * 60, ly = cy - uy * 60 + 4;
    const anc = ux > 0.3 ? "end" : ux < -0.3 ? "start" : "middle";
    parts.push(`<text class="hu-edge-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anc}">${esc(withCommas(m.dist) + " " + unit)}</text>`);
  }
  parts.push(houseGlyph(cx, cy));
  return parts.join("");
}

/* point-in-polygon (ray cast); poly is [[x,y],...] in px */
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* Region name labels (country/state). Drawn under the storm data; any that would
 * touch a keep-out box (forecast dots, time labels, home marker) or sit inside
 * the cone are dropped rather than nudged. Tier 1 (states) shows only when
 * zoomed in enough. Region-agnostic: whatever is in `src` gets considered. */
const REGION_CHAR_W = 7.4;
function regionLabels(src, proj, bbox, keepOut, conePx) {
  if (!src || !src.length) return [];
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const maxTier = span > 16 ? 0 : 1;
  const placed = [], out = [];
  for (const r of src) {
    if (r.tier > maxTier) continue;
    const [x, y] = proj(r.lng, r.lat);
    if (x < 24 || x > VBW - 24 || y < 18 || y > VBH - 18) continue;
    const name = String(r.name).toUpperCase();
    const w = name.length * REGION_CHAR_W;
    const box = { x1: x - w / 2 - 4, y1: y - 9, x2: x + w / 2 + 4, y2: y + 9 };
    if (conePx.length >= 3 && [box.x1 + 2, x, box.x2 - 2].some((tx) => pointInPoly(tx, y, conePx))) continue;
    if (keepOut.some((b) => boxHit(box, b))) continue;
    if (placed.some((b) => boxHit(box, b))) continue;
    placed.push(box);
    out.push(`<text class="hu-region" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${esc(name)}</text>`);
  }
  return out;
}

/* nearest "nice" mile interval giving roughly `want` px between ticks */
function niceMiles(pxPerMile) {
  const targets = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000];
  const want = 120;
  let best = targets[0], bd = Infinity;
  for (const m of targets) { const d = Math.abs(m * pxPerMile - want); if (d < bd) { bd = d; best = m; } }
  return best;
}

/* Far-offshore mileage scale: tick marks along the two edges opposite the house,
 * cumulative miles from that corner. Over open water only — any tick that would
 * fall on land, in the cone, or on storm data is dropped. The cos-lat projection
 * makes mi/px ~equal on both axes, so one interval serves both. */
function scaleAxes(bbox, proj, geo, keepOut, conePx, hcx, hcy) {
  const midLng = (bbox[0] + bbox[2]) / 2, midLat = (bbox[1] + bbox[3]) / 2;
  const [, ya] = proj(midLng, midLat);
  const [, yb] = proj(midLng, midLat + 1);
  const pxPerMile = Math.abs(yb - ya) / 69.05;
  if (!isFinite(pxPerMile) || pxPerMile <= 0) return [];
  const step = niceMiles(pxPerMile), stepPx = step * pxPerMile;
  if (stepPx < 44) return [];

  const bottom = hcy < VBH / 2;   // house in top half -> ruler on bottom edge
  const left = hcx > VBW / 2;     // house on right    -> ruler on left edge
  const axisY = bottom ? VBH - 16 : 16;
  const axisX = left ? 16 : VBW - 16;
  const landPx = ((geo && geo.land) || []).map((part) => part.map((c) => proj(c[0], c[1])));
  const blocked = (x, y) => {
    if (conePx.length >= 3 && pointInPoly(x, y, conePx)) return true;
    for (const poly of landPx) if (poly.length >= 3 && pointInPoly(x, y, poly)) return true;
    const box = { x1: x - 18, y1: y - 10, x2: x + 18, y2: y + 10 };
    return keepOut.some((b) => boxHit(box, b));
  };
  const out = [];
  const sx = left ? 1 : -1, sy = bottom ? -1 : 1;
  for (let k = 1; ; k++) {
    const x = axisX + sx * stepPx * k;
    if (x < 34 || x > VBW - 34) break;
    if (blocked(x, axisY)) continue;
    out.push(`<line class="hu-scale-tick" x1="${x.toFixed(1)}" y1="${axisY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(axisY + (bottom ? -7 : 7)).toFixed(1)}"/>`);
    const txt = k === 1 ? withCommas(step) + " mi" : withCommas(step * k);
    out.push(`<text class="hu-scale-label" x="${x.toFixed(1)}" y="${(axisY + (bottom ? -10 : 17)).toFixed(1)}" text-anchor="middle">${esc(txt)}</text>`);
  }
  for (let k = 1; ; k++) {
    const y = axisY + sy * stepPx * k;
    if (y < 34 || y > VBH - 34) break;
    if (blocked(axisX, y)) continue;
    out.push(`<line class="hu-scale-tick" x1="${axisX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(axisX + (left ? 7 : -7)).toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    out.push(`<text class="hu-scale-label" x="${(axisX + (left ? 11 : -11)).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${left ? "start" : "end"}">${esc(withCommas(step * k))}</text>`);
  }
  return out;
}

/* ---- build the SVG from one baked storm payload --------------------------- */
function buildConeSvg(st) {
  const proj = makeProject(st.bbox);
  const base = [];
  for (const part of (st.geo && st.geo.land) || [])
    if (part.length >= 3) base.push(`<polygon class="hu-land" points="${ptsStr(proj, part)}"/>`);
  for (const part of (st.geo && st.geo.states) || [])
    if (part.length >= 2) base.push(`<polyline class="hu-state" points="${ptsStr(proj, part)}"/>`);
  for (const part of (st.geo && st.geo.coast) || [])
    if (part.length >= 2) base.push(`<polyline class="hu-coast" points="${ptsStr(proj, part)}"/>`);

  const storm = [];
  for (const seg of st.ww || []) {
    const col = wwColor(seg.type);
    if (col && seg.coords && seg.coords.length >= 2)
      storm.push(`<polyline class="hu-ww" points="${ptsStr(proj, seg.coords)}" stroke="${col}"/>`);
  }
  if (st.cone && st.cone.length >= 3)
    storm.push(`<polygon class="hu-cone-poly" points="${ptsStr(proj, st.cone)}"/>`);
  if (st.pastTrack && st.pastTrack.length >= 2)
    storm.push(`<polyline class="hu-track-past" points="${ptsStr(proj, st.pastTrack)}"/>`);
  if (st.fcstTrack && st.fcstTrack.length >= 2)
    storm.push(`<polyline class="hu-track-fcst" points="${ptsStr(proj, st.fcstTrack)}"/>`);

  // forecast dots + time labels; collect keep-out boxes for region labels
  const keepOut = [];
  const labelJobs = [];
  const projPts = (st.points || []).map((p) => (p.lng == null || p.lat == null) ? null : proj(p.lng, p.lat));
  (st.points || []).forEach((p, i) => {
    if (p.lng == null || p.lat == null) return;
    const [x, y] = projPts[i];
    const ink = (p.cat === "TD" || p.cat === "TS") ? "#EDE3D2" : "#14110d";
    storm.push(`<circle class="hu-fdot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="${catColor(p.cat)}"/>`);
    storm.push(`<text class="hu-fcat" x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" fill="${ink}">${esc(catDotLabel(p.cat))}</text>`);
    keepOut.push({ x1: x - 15, y1: y - 15, x2: x + 15, y2: y + 15 });
    if (p.label) {
      const a = projPts[i - 1] || [x, y], b = projPts[i + 1] || [x, y];
      labelJobs.push({ cx: x, cy: y, text: p.label, tdx: b[0] - a[0], tdy: b[1] - a[1] });
    }
  });
  placeLabels(labelJobs).forEach((L) => {
    const rot = L.deg ? ` transform="rotate(${L.deg.toFixed(1)},${L.cx.toFixed(1)},${L.cy.toFixed(1)})"` : "";
    storm.push(`<text class="hu-flabel" x="${(L.cx + 16).toFixed(1)}" y="${(L.cy + 5).toFixed(1)}" text-anchor="${L.anchor}"${rot}>${esc(L.text)}</text>`);
    const w = (L.text ? L.text.length : 0) * CHAR_W;
    keepOut.push(labelBox(L.cx, L.cy, w, L.deg));
  });

  // home marker (drawn on top); register a keep-out box so labels avoid it
  const homeParts = [];
  let farCase = false, hcx = 0, hcy = 0;
  if (st.home && st.home[0] != null) {
    const [hx, hy] = proj(st.home[0], st.home[1]);
    if (hx >= 0 && hx <= VBW && hy >= 0 && hy <= VBH) {
      homeParts.push(houseGlyph(hx, hy));
      keepOut.push({ x1: hx - 20, y1: hy - 20, x2: hx + 20, y2: hy + 20 });
    } else {
      homeParts.push(homeEdgeMarker(hx, hy, st.meta || {}));
      hcx = Math.max(EDGE_M, Math.min(VBW - EDGE_M, hx));
      hcy = Math.max(EDGE_M, Math.min(VBH - EDGE_M, hy));
      keepOut.push({ x1: hcx - 74, y1: hcy - 74, x2: hcx + 74, y2: hcy + 74 });
      farCase = true;
    }
  }

  const conePx = (st.cone || []).map((c) => proj(c[0], c[1]));
  const region = regionLabels(st.labels, proj, st.bbox, keepOut, conePx);
  const scale = farCase ? scaleAxes(st.bbox, proj, st.geo, keepOut, conePx, hcx, hcy) : [];

  const layers = [...base, ...region, ...scale, ...storm, ...homeParts];
  return `<svg class="hu-svg" viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${layers.join("")}</svg>`;
}

function dataBar(st) {
  const m = st.meta || {};
  let name = (m.name || "Storm").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const tag = catLabel(m.cat);
  if (tag) name = `${name} (${tag})`;
  const bits = [];
  if (m.type) bits.push(m.type);
  if (m.wind != null) { let s = `${m.wind} ${m.windUnit}`; if (m.gust != null) s += ` (gust ${m.gust})`; bits.push(s); }
  if (m.moveText) bits.push(m.moveText);
  if (m.dist != null) bits.push(`${withCommas(m.dist)} ${m.distUnit} from home`);
  let peak = "";
  if (m.peak && m.peak.word) peak = `<div class="hu-bar-peak">Peak ${esc(m.peak.word)}${m.peak.label ? " by " + esc(m.peak.label) : ""}</div>`;
  return `<div class="hu-bar-name">${esc(name)}</div><div class="hu-bar-data">${esc(bits.join(" \u00b7 "))}</div>${peak}`;
}

const STYLE = `
  ha-card { padding: 0; overflow: hidden; }
  .hu-wrap { display: flex; flex-direction: column; }
  .hu-tag { font: 600 13px/1 var(--ha-card-header-font-family, inherit); letter-spacing: .08em;
            text-transform: uppercase; color: var(--secondary-text-color); padding: 12px 14px 8px; }
  .hu-conewrap { position: relative; width: 100%; background: var(--primary-background-color); }
  .hu-svg { display: block; width: 100%; height: auto; }
  .hu-land { fill: var(--divider-color); opacity: .55; stroke: none; }
  .hu-state { fill: none; stroke: var(--secondary-text-color); stroke-width: .6; opacity: .4; }
  .hu-coast { fill: none; stroke: var(--primary-text-color); stroke-width: 1; opacity: .7; }
  .hu-region { font: 600 12px/1 sans-serif; letter-spacing: .1em; text-transform: uppercase;
               text-anchor: middle; fill: var(--secondary-text-color); opacity: .5;
               paint-order: stroke; stroke: var(--primary-background-color); stroke-width: 3px; }
  .hu-scale-tick { stroke: var(--secondary-text-color); stroke-width: 1.5; opacity: .55; }
  .hu-scale-label { font: 600 11px/1 sans-serif; fill: var(--secondary-text-color); opacity: .7;
                    paint-order: stroke; stroke: var(--primary-background-color); stroke-width: 3px; }
  .hu-ww { fill: none; stroke-width: 4; stroke-linecap: round; }
  .hu-cone-poly { fill: var(--primary-text-color); fill-opacity: .08; stroke: var(--primary-text-color); stroke-opacity: .3; stroke-width: 1; }
  .hu-track-past { fill: none; stroke: var(--secondary-text-color); stroke-width: 2; stroke-dasharray: 4 5; opacity: .6; }
  .hu-track-fcst { fill: none; stroke: var(--primary-text-color); stroke-width: 2.5; opacity: .85; }
  .hu-fdot { stroke: rgba(0,0,0,.35); stroke-width: 1; }
  .hu-fcat { font: 700 13px/1 sans-serif; text-anchor: middle; }
  .hu-flabel { font: 700 17px/1 sans-serif; fill: var(--primary-text-color);
               paint-order: stroke; stroke: var(--primary-background-color); stroke-width: 3px; }
  .hu-home path { fill: #fff; stroke: rgba(0,0,0,.55); stroke-width: 1.5; paint-order: stroke; }
  .hu-edge-chev { fill: none; stroke: var(--primary-text-color); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; opacity: .9; }
  .hu-edge-label { font: 700 17px/1 sans-serif; fill: var(--primary-text-color);
                   paint-order: stroke; stroke: var(--primary-background-color); stroke-width: 3px; }
  .hu-bar { padding: 10px 14px 14px; }
  .hu-bar-name { font-size: 20px; font-weight: 700; color: var(--primary-text-color); }
  .hu-bar-data { font-size: 14px; color: var(--secondary-text-color); margin-top: 2px; }
  .hu-bar-peak { font-size: 13px; color: var(--secondary-text-color); margin-top: 4px; opacity: .9; }
  .hu-msg { padding: 28px 18px; text-align: center; color: var(--secondary-text-color); }
  .hu-msg .hu-msg-icon { --mdc-icon-size: 40px; color: var(--secondary-text-color); opacity: .7; }
  .hu-msg .hu-msg-title { font-size: 18px; font-weight: 700; color: var(--primary-text-color); margin-top: 8px; }
  .hu-msg .hu-msg-sub { font-size: 14px; margin-top: 4px; }
  .hu-stale { font-size: 12px; color: var(--warning-color, #d68b00); padding: 0 14px 10px; }
  .hu-pager { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 0 0 12px; }
  .hu-pager button { border: none; background: var(--secondary-background-color); color: var(--primary-text-color);
                     border-radius: 50%; width: 30px; height: 30px; font-size: 16px; cursor: pointer; }
  .hu-pager .hu-page { font-size: 13px; color: var(--secondary-text-color); min-width: 40px; text-align: center; }
`;

class HurricaneCard extends HTMLElement {
  constructor() { super(); this._data = null; this._ok = false; this._idx = 0; this._timer = null; this._built = false; }

  setConfig(config) { this._config = config || {}; }
  getCardSize() { return 6; }
  static getStubConfig() { return {}; }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) { this._built = true; this._fetch(); }
  }

  connectedCallback() {
    if (this._hass && !this._data) this._fetch();
    if (!this._timer) this._timer = setInterval(() => this._fetch(), REFRESH_MS);
  }
  disconnectedCallback() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  _fetch() {
    if (!this._hass) return;
    this._hass.callWS({ type: WS_TYPE }).then((res) => {
      const d = res && res.data ? res.data : null;
      this._data = d;
      this._lastOk = res ? res.last_success !== false : true;
      this._idx = 0;
      this._render();
    }).catch(() => { /* leave last render up */ });
  }

  _msg(icon, title, sub) {
    return `<div class="hu-msg"><ha-icon class="hu-msg-icon" icon="${icon}"></ha-icon>
      <div class="hu-msg-title">${esc(title)}</div>${sub ? `<div class="hu-msg-sub">${esc(sub)}</div>` : ""}</div>`;
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const d = this._data;
    let body;

    if (!d) {
      body = this._msg("mdi:weather-hurricane", "Loading\u2026", "");
    } else if (d.ok && (d.storms || []).length) {
      const storms = d.storms;
      if (this._idx >= storms.length) this._idx = 0;
      const st = storms[this._idx];
      const stale = this._lastOk === false
        ? `<div class="hu-stale">Data may be out of date \u2014 last update failed.</div>` : "";
      let pager = "";
      if (storms.length > 1) {
        pager = `<div class="hu-pager">
          <button data-nav="-1" aria-label="Previous storm">\u2039</button>
          <span class="hu-page">${this._idx + 1} / ${storms.length}</span>
          <button data-nav="1" aria-label="Next storm">\u203a</button></div>`;
      }
      body = `<div class="hu-tag">Hurricane \u00b7 ${esc((st.meta && st.meta.basinName) || "")}</div>
        <div class="hu-conewrap">${buildConeSvg(st)}</div>
        <div class="hu-bar">${dataBar(st)}</div>${pager}${stale}`;
    } else if (d.reason === "not_covered") {
      body = this._msg("mdi:map-marker-off",
        "Your region isn\u2019t covered",
        "The U.S. National Hurricane Center only forecasts Atlantic and Pacific storms. Your home location is outside that area.");
    } else if (d.off_season === "hide") {
      this.style.display = "none";
      return;
    } else if (d.reason === "no_geometry") {
      body = this._msg("mdi:weather-hurricane", "Storm active", "Cone data isn\u2019t available yet \u2014 checking again shortly.");
    } else {
      body = this._msg("mdi:weather-sunny", "All clear", "No active storms right now.");
    }

    this.style.display = "";
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div class="hu-wrap">${body}</div></ha-card>`;
    this.shadowRoot.querySelectorAll("[data-nav]").forEach((b) =>
      b.addEventListener("click", () => {
        const n = Number(b.getAttribute("data-nav"));
        const len = (this._data.storms || []).length;
        this._idx = (this._idx + n + len) % len;
        this._render();
      }));
  }
}

if (!customElements.get("hurricane-card")) {
  customElements.define("hurricane-card", HurricaneCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "hurricane-card",
    name: "Hurricane Tracker",
    description: "Storm-framed hurricane cone for Atlantic & Pacific storms (NHC).",
    preview: false,
  });
}
