// Survey records (photos and sketches) on Building O, shown inside the site context.
// Records use Rhino survey-model coordinates (metres); Building O's glTF sits in the site scene inside
// its own group, so markers are added to that group and line up with the model.
//   three (inside the building group) = (rhinoX, rhinoZ, -rhinoY)
// On the editor page (records.js: live store) markers can be dragged and turned, records placed by
// clicking the model, and photos/sketches uploaded straight into the page.
import * as THREE from 'three';
import { openStore, imageUrl, prepareUpload } from './records.js';

const CENTER = { x: -3.2, y: 11.0 };          // plan centre of the building (Rhino)
const MARKER_EYE = 1.0;                         // marker height above floor level (m)

export const LEVELS = {
  whole: { label: 'Teljes épület', tag: 'Teljes épület', ffl: 0.0, cut: null, focusZ: 3.6, fit: 28 },
  ground: { label: 'Földszint', tag: 'Földszint · metszet +1,50 m-en', ffl: 0.0, cut: 1.5, focusZ: 0.0, fit: 22 },
  first: { label: 'Emelet', tag: 'Emelet · metszet +5,40 m-en', ffl: 3.9, cut: 5.4, focusZ: 3.9, fit: 22 },
  roof: { label: 'Tetőfödém', tag: 'Tetőfödém · +7,22', ffl: 7.22, cut: null, focusZ: 7.22, fit: 22 },
  site: { label: 'Telek, kívül', tag: 'Teljes épület', ffl: 0.0, cut: null, focusZ: 0.0, fit: 30 },
};

// Element codes come from the Rhino block names ("SW - 049" -> SW).
const CODES = {
  SW: { name: 'Fal' }, CSG: { name: 'Pillér' }, BSG: { name: 'Gerenda' }, SLA: { name: 'Födém / alap' },
  WD: { name: 'Ablak' }, DOO: { name: 'Ajtó' },
  'SF RISER': { name: 'Lépcső fellépő' }, 'SF TREAD': { name: 'Lépcsőfok' }, 'SF STRUCTURE': { name: 'Lépcsőszerkezet' },
  'SL RISER': { name: 'Pihenő fellépő' }, 'SL TREAD': { name: 'Lépcsőpihenő' }, 'SL STRUCTURE': { name: 'Pihenő szerkezete' },
  FU: { name: 'Tetőgép' }, RA: { name: 'Rámpa' }, RL: { name: 'Korlát' }, HR: { name: 'Kapaszkodó (rétegelt lemez doboz)' },
  FL: { name: 'Füstcső' }, CD: { name: 'Kábelcsatornák' }, AC: { name: 'Klíma kültéri egység' }, GP: { name: 'Gázcső' },
  GM: { name: 'Gázmérőszekrény' }, CH: { name: 'Kémény' }, PNL: { name: 'Kitöltő panel' },
};
function elementName(ex) {
  if (ex.layer === 'joists') return 'Födémpalló';
  if (ex.layer === 'canopy') return ex.name ? `Előtető · ${ex.name}` : 'Előtető';
  return CODES[ex.code]?.name || ex.code || 'Elem';
}

const r2t = (x, y, z) => new THREE.Vector3(x, z, -y);
const fmt = (n) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2).replace('.', ',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = (s) => document.querySelector(s);
const deg = (r) => ((r * 180) / Math.PI + 360) % 360;
const kind = (o) => (o.type === 'sketch' ? 'Vázlat' : 'Fotó');

/**
 * @param {object} o
 * @param {THREE.Object3D} o.building     Building O's glTF scene (survey-model frame)
 * @param {THREE.Object3D[]} o.siteTargets terrain, paving, pitch, furniture: where records can be placed outside
 * @param {THREE.Plane} o.cutPlane        clipping plane shared by Building O's materials
 * @param {THREE.Camera} o.camera
 * @param {object} o.controls             OrbitControls (paused while a marker is dragged)
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.stage
 * @param {HTMLElement} o.tooltip
 * @param {(goal: {target: THREE.Vector3, position: THREE.Vector3}) => void} o.flyTo
 * @param {() => void} o.redraw
 */
export async function initSurvey({ building, siteTargets, cutPlane, camera, controls, canvas, stage, tooltip, flyTo, redraw }) {
  const state = {
    level: 'whole', showPhotos: true, showSketches: true,
    selId: null, selEl: null, clickPoint: null, mode: null,   // mode: 'place' | 'elements' (editor)
    gal: { type: 'all', level: 'all', author: 'all' },
    heat: false,
  };
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
  const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  // ---- elements of Building O
  const elements = new Map();   // id -> { meshes: [{ mesh, base }], info }
  const pickables = [];
  building.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const ex = o.userData || {};
    if (!ex.id || ex.code === 'TR') return;
    const el = elements.get(ex.id) || { meshes: [], info: { name: elementName(ex), blockName: ex.name || '', zmin: ex.zmin ?? 0, zmax: ex.zmax ?? 0 } };
    el.meshes.push({ mesh: o, base: o.material });
    elements.set(ex.id, el);
    pickables.push(o);
  });
  const selectMat = new THREE.MeshStandardMaterial({ color: 0xc7372d, roughness: 0.8, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });
  const recordMat = new THREE.MeshStandardMaterial({ color: 0x2a56c6, roughness: 0.8, side: THREE.DoubleSide, clippingPlanes: [cutPlane] });

  // ---- records (static file on the public page, live database on the editor page)
  const store = await openStore();
  let editable = !!store.save && store.editable;   // false for the rest of the visit once the database refuses a write
  let records = [], lastSnapshot = [];
  const byId = () => new Map(records.map((r) => [r.id, r]));
  let index = new Map();
  const sel = () => (state.selId ? index.get(state.selId) || null : null);
  $('#sample-note').hidden = !store.sample;

  // ---- markers: head at eye height, a view cone per photo/sketch direction, stem to the floor
  const markerGroup = new THREE.Group();
  markerGroup.userData.siteOnly = true;   // not drawn on the opening page (js/hero.js)
  building.add(markerGroup);
  let markerHits = [];
  const mats = {};
  function markerMats() {
    const p = new THREE.Color(cssVar('--photo') || '#2a56c6');
    const s = new THREE.Color(cssVar('--sketch') || '#0e7c64');
    if (!mats.photo) {
      mats.photo = new THREE.MeshBasicMaterial({ color: p });
      mats.sketch = new THREE.MeshBasicMaterial({ color: s });
      mats.photoCone = new THREE.MeshBasicMaterial({ color: p, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      mats.sketchCone = new THREE.MeshBasicMaterial({ color: s, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      mats.ring = new THREE.MeshBasicMaterial({ color: 0xc7372d, transparent: true, opacity: 0.85, depthTest: false });
    } else {
      mats.photo.color.copy(p); mats.photoCone.color.copy(p);
      mats.sketch.color.copy(s); mats.sketchCone.color.copy(s);
    }
  }
  markerMats();
  const headPhoto = new THREE.SphereGeometry(0.34, 20, 14);
  const headSketch = new THREE.OctahedronGeometry(0.46);
  const coneGeo = new THREE.ConeGeometry(0.55, 1.6, 24, 1, true);
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, MARKER_EYE, 6);
  const ringGeo = new THREE.RingGeometry(0.62, 0.74, 40).rotateX(-Math.PI / 2);
  const markerZ = (r) => (r.z ?? LEVELS[r.level]?.ffl ?? 0) + MARKER_EYE;
  const views = (r) => (r.images.length ? r.images.map((im, i) => ({ dir: im.direction ?? r.direction, i })) : [{ dir: r.direction, i: -1 }]);
  function placeCone(cone, dirDeg) {
    const a = THREE.MathUtils.degToRad(dirDeg);
    const d = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    cone.position.copy(d.multiplyScalar(1.05));
  }
  function rebuildMarkers() {
    markerGroup.clear();
    markerHits = [];
    for (const r of records) {
      if (!r.position) continue;
      const g = new THREE.Group();
      g.position.copy(r2t(r.position[0], r.position[1], markerZ(r)));
      const isPhoto = r.type !== 'sketch';
      const head = new THREE.Mesh(isPhoto ? headPhoto : headSketch, isPhoto ? mats.photo : mats.sketch);
      head.userData = { rec: r.id, part: 'head' };
      const stem = new THREE.Mesh(stemGeo, isPhoto ? mats.photo : mats.sketch);
      stem.position.y = -MARKER_EYE / 2;
      g.add(head, stem);
      markerHits.push(head);
      for (const v of views(r)) {
        const cone = new THREE.Mesh(coneGeo, isPhoto ? mats.photoCone : mats.sketchCone);
        placeCone(cone, v.dir);
        cone.userData = { rec: r.id, part: 'cone', view: v.i };
        g.add(cone);
        markerHits.push(cone);
      }
      if (editable && r.id === state.selId) {
        const ring = new THREE.Mesh(ringGeo, mats.ring);
        ring.position.y = -MARKER_EYE + 0.03;
        ring.renderOrder = 3;
        g.add(ring);
      }
      g.userData.rec = r.id;
      markerGroup.add(g);
    }
    updateMarkers();
  }
  const placed = (o) => !!o.position;
  const obsOnLevel = (o) => placed(o) && (state.level === 'whole' || o.level === state.level);
  const typeShown = (o) => (o.type === 'sketch' ? state.showSketches : state.showPhotos);
  function updateMarkers() {
    for (const g of markerGroup.children) {
      const o = index.get(g.userData.rec);
      g.visible = !!o && obsOnLevel(o) && typeShown(o);
      g.scale.setScalar(o && o.id === state.selId ? 1.35 : 1);
    }
  }

  // ---- coverage heat map: where the shown records look. Each view covers a wedge (HEAT.fov wide, up to HEAT.reach)
  // in its direction, cut short where a ray at eye height hits an element of Building O (glass lets the view through),
  // plus a spot where the record was taken, cut by the same walls; overlaps add up. Each floor that has records gets
  // its own translucent sheet at its own height, depth-tested so walls and slabs hide it like any other surface; what an
  // upper floor sees out of a window lands on the ground sheet. Between two rays a cell is lit only if both reach it.
  const HEAT = { fov: 60, reach: 15, rays: 121, cell: 0.25, eye: 1.3, spot: 1.2, spotRays: 72 };
  const heat = { meshes: [], key: '', timer: 0 };
  function heatOccluders(z, glass) {   // glass: include window panes (only for the envelope outline, not for the rays)
    return pickables.filter((m) => (glass || !m.userData.glass) && (m.userData.zmin ?? -1e9) <= z && (m.userData.zmax ?? 1e9) >= z);
  }
  // A horizontal section of Building O at eye height, rasterised once per height into a 5 cm grid (cells crossed by
  // any element's outline, thickened by a cell so no ray slips between diagonal neighbours). Rays then march the grid.
  const SEC = 0.05;
  const secCache = new Map();
  function sectionGrid(z, glass = false) {
    const key = z.toFixed(2) + (glass ? 'g' : '');
    if (secCache.has(key)) return secCache.get(key);
    const inv = building.matrixWorld.clone().invert(), M = new THREE.Matrix4(), v = new THREE.Vector3();
    const segs = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const m of heatOccluders(z, glass)) {
      M.multiplyMatrices(inv, m.matrixWorld);
      const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < n; t += 3) {
        for (let q = 0; q < 3; q++) { v.fromBufferAttribute(pos, idx ? idx.getX(t + q) : t + q).applyMatrix4(M); P[q][0] = v.x; P[q][1] = -v.z; P[q][2] = v.y; }   // building local -> model
        let ax = 0, ay = 0, have = 0;
        for (let e = 0; e < 3; e++) {
          const a = P[e], b = P[(e + 1) % 3], da = a[2] - z, db = b[2] - z;
          if ((da <= 0) === (db <= 0)) continue;
          const s = da / (da - db), px = a[0] + (b[0] - a[0]) * s, py = a[1] + (b[1] - a[1]) * s;
          if (!have) { ax = px; ay = py; have = 1; continue; }
          segs.push(ax, ay, px, py);
          x0 = Math.min(x0, ax, px); x1 = Math.max(x1, ax, px); y0 = Math.min(y0, ay, py); y1 = Math.max(y1, ay, py);
        }
      }
    }
    if (!segs.length) { const g = null; secCache.set(key, g); return g; }
    const outline = [x0, y0, x1, y1];   // the envelope's extent at this height (model metres)
    x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
    const W = Math.ceil((x1 - x0) / SEC), H = Math.ceil((y1 - y0) / SEC), cells = new Uint8Array(W * H);
    const mark = (i, j) => { if (i >= 0 && j >= 0 && i < W && j < H) cells[j * W + i] = 1; };
    for (let s = 0; s < segs.length; s += 4) {
      const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (SEC / 2)));
      for (let k = 0; k <= steps; k++) {
        const i = Math.floor((ax + ((bx - ax) * k) / steps - x0) / SEC), j = Math.floor((ay + ((by - ay) * k) / steps - y0) / SEC);
        mark(i, j); mark(i + 1, j); mark(i, j + 1);
      }
    }
    const g = { x0, y0, W, H, cells, outline };
    secCache.set(key, g);
    return g;
  }
  function reachFan(x, y, z, from, span, n, far, grid) {
    // distance to the first element of Building O for n rays from `from` over `span` degrees (model metres)
    const out = new Float32Array(n).fill(far);
    if (!grid) return out;
    const { x0, y0, W, H, cells } = grid, step = SEC / 2;
    for (let r = 0; r < n; r++) {
      const a = THREE.MathUtils.degToRad(from + (span * r) / (span >= 360 ? n : n - 1)), cx = Math.cos(a), cy = Math.sin(a);
      for (let d = step; d <= far; d += step) {
        const i = Math.floor((x + cx * d - x0) / SEC), j = Math.floor((y + cy * d - y0) / SEC);
        if (i < 0 || j < 0 || i >= W || j >= H) continue;   // outside the building's section: free (records outside walk in)
        if (cells[j * W + i]) { out[r] = Math.max(0.05, d - SEC); break; }
      }
    }
    return out;
  }
  const viewReach = (x, y, z, dirDeg, occ) => reachFan(x, y, z, dirDeg - HEAT.fov / 2, HEAT.fov, HEAT.rays, HEAT.reach, occ);
  function heatColors() {
    return [0, 1, 2, 3, 4].map((i) => new THREE.Color(cssVar(`--heat-${i}`) || '#e07033'));
  }
  function clearHeat() {
    for (const m of heat.meshes) { building.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }
    heat.meshes = [];
  }
  // reach limit at angle `rel` (deg from the fan start) for a fan of n rays over `span` deg: the shorter of the two
  // neighbouring rays, so a cell is lit only where both rays get past every wall
  function fanLimit(reach, rel, span, n) {
    const f = span >= 360 ? (((rel % 360) + 360) % 360) / (360 / n) : (rel / span) * (n - 1);
    const k = Math.floor(f), k1 = span >= 360 ? (k + 1) % n : Math.min(n - 1, k + 1);
    return Math.min(reach[Math.min(n - 1, Math.max(0, k))], reach[Math.max(0, k1)]);
  }
  function buildHeat() {
    heat.timer = 0;
    const list = records.filter((o) => obsOnLevel(o) && typeShown(o));
    const key = [state.heat, state.level, state.showPhotos, state.showSketches,
      ...list.map((o) => [o.id, o.position, o.z, o.level, views(o).map((v) => v.dir)].join(':'))].join('|');
    if (key === heat.key) return;
    heat.key = key;
    clearHeat();
    $('#heat-legend').hidden = !state.heat;
    if (!state.heat || !list.length) { $('#heat-max').textContent = ''; redraw(); return; }
    building.updateMatrixWorld(true);
    const R = HEAT.reach, half = HEAT.fov / 2, pad = 3 * HEAT.spot, c = HEAT.cell, s2 = 2 * HEAT.spot * HEAT.spot;
    // one sheet per floor height (site records sit with the ground floor); windows let views out, and the part of an
    // upper-floor view beyond the envelope lands on the ground sheet (what you see out of the window is the ground)
    const floors = new Map();
    const occCache = new Map();
    for (const o of list) {
      const floor = o.z ?? LEVELS[o.level]?.ffl ?? 0, fk = floor.toFixed(1), eye = floor + HEAT.eye, ek = eye.toFixed(1);
      if (!occCache.has(ek)) occCache.set(ek, sectionGrid(eye));
      const [x, y] = o.position, occ = occCache.get(ek);
      if (!floors.has(fk)) floors.set(fk, { floor, eye, vs: [], spots: [] });
      const F = floors.get(fk);
      for (const v of views(o)) F.vs.push({ x, y, dir: v.dir, reach: viewReach(x, y, eye, v.dir, occ) });
      F.spots.push({ x, y, reach: reachFan(x, y, eye, 0, 360, HEAT.spotRays, pad, occ) });
    }
    // one lattice for all floors, so cells can move between sheets
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const F of floors.values()) for (const v of F.vs) {
      for (let i = 0; i < HEAT.rays; i++) {
        const a = THREE.MathUtils.degToRad(v.dir - half + (HEAT.fov * i) / (HEAT.rays - 1));
        const px = v.x + Math.cos(a) * v.reach[i], py = v.y + Math.sin(a) * v.reach[i];
        x0 = Math.min(x0, px, v.x); x1 = Math.max(x1, px, v.x); y0 = Math.min(y0, py, v.y); y1 = Math.max(y1, py, v.y);
      }
    }
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const W = Math.ceil((x1 - x0) / c), H = Math.ceil((y1 - y0) / c);
    const cellRange = (lo, hi, o0, n) => [Math.max(0, Math.floor((lo - o0) / c)), Math.min(n - 1, Math.ceil((hi - o0) / c))];
    const sheets = new Map();   // floor key -> { floor, val, cnt }
    const sheetOf = (fk, floor) => { if (!sheets.has(fk)) sheets.set(fk, { floor, val: new Float32Array(W * H), cnt: new Uint16Array(W * H) }); return sheets.get(fk); };
    for (const [fk, F] of floors) {
      const { val, cnt } = sheetOf(fk, F.floor);
      for (const v of F.vs) {
        const [i0, i1] = cellRange(v.x - R, v.x + R, x0, W), [j0, j1] = cellRange(v.y - R, v.y + R, y0, H);
        for (let j = j0; j <= j1; j++) {
          const py = y0 + (j + 0.5) * c - v.y;
          for (let i = i0; i <= i1; i++) {
            const px = x0 + (i + 0.5) * c - v.x, d = Math.hypot(px, py);
            if (d > R) continue;
            const rel = ((Math.atan2(py, px) * 180) / Math.PI - v.dir + 540) % 360 - 180;
            if (Math.abs(rel) > half) continue;
            if (d > fanLimit(v.reach, rel + half, HEAT.fov, HEAT.rays)) continue;
            const edge = Math.min(1, (half - Math.abs(rel)) / 8);   // soft sides
            val[j * W + i] += (1 - 0.5 * (d / R)) * (0.4 + 0.6 * edge);
            cnt[j * W + i]++;
          }
        }
      }
      // the spots where records were taken (records close together build up), cut by the walls around them
      for (const sp of F.spots) {
        const [i0, i1] = cellRange(sp.x - pad, sp.x + pad, x0, W), [j0, j1] = cellRange(sp.y - pad, sp.y + pad, y0, H);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const dx = x0 + (i + 0.5) * c - sp.x, dy = y0 + (j + 0.5) * c - sp.y, d = Math.hypot(dx, dy);
          if (d > pad || d > fanLimit(sp.reach, (Math.atan2(dy, dx) * 180) / Math.PI, 360, HEAT.spotRays)) continue;
          val[j * W + i] += 1.2 * Math.exp(-(d * d) / s2);
        }
      }
      // upper floors: cells beyond the footprint go to the ground sheet. The footprint is the outline of walls and
      // glass at ground-floor eye height – not at this floor's eye height: on the roof (+8,52 m) that section only cuts
      // the skylights and plant, which would send most of the roof's heat to the ground
      const env = F.floor > 0.5 ? sectionGrid(HEAT.eye, true)?.outline : null;
      if (env) {
        const G = sheetOf('0.0', 0);
        for (let j = 0; j < H; j++) {
          const py = y0 + (j + 0.5) * c, outY = py < env[1] || py > env[3];
          for (let i = 0; i < W; i++) {
            const k = j * W + i; if (!val[k]) continue;
            const px = x0 + (i + 0.5) * c;
            if (!outY && px >= env[0] && px <= env[2]) continue;
            G.val[k] += val[k]; G.cnt[k] += cnt[k]; val[k] = 0; cnt[k] = 0;
          }
        }
      }
    }
    let vmax = 0, cmax = 0;
    for (const S of sheets.values()) for (let k = 0; k < S.val.length; k++) { vmax = Math.max(vmax, S.val[k]); cmax = Math.max(cmax, S.cnt[k]); }
    $('#heat-max').textContent = `${cmax} átfedő nézet`;
    // colour: heat ramp (one scale for all floors), more opaque where it's hotter; canvas row 0 = north edge
    const ramp = heatColors(), col = new THREE.Color();
    for (const S of sheets.values()) {
      const { val } = S;
      if (!val.some((x) => x > 0)) continue;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'), img = g.createImageData(W, H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const t = vmax ? val[j * W + i] / vmax : 0;
        if (t < 0.02) continue;
        const u = Math.min(0.999, Math.sqrt(t)) * 4, k = Math.floor(u);
        col.copy(ramp[k]).lerp(ramp[Math.min(4, k + 1)], u - k);
        const p = ((H - 1 - j) * W + i) * 4;
        img.data[p] = col.r * 255; img.data[p + 1] = col.g * 255; img.data[p + 2] = col.b * 255;
        img.data[p + 3] = Math.round(255 * Math.min(0.85, 0.22 + 0.7 * Math.sqrt(t)));
      }
      g.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;   // blends half a cell (12 cm), less than a wall
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: [cutPlane] });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * c, H * c).rotateX(-Math.PI / 2), mat);
      mesh.position.copy(r2t(x0 + (W * c) / 2, y0 + (H * c) / 2, S.floor + 0.08));
      mesh.renderOrder = 2;
      mesh.raycast = () => {};   // never picked
      mesh.userData.siteOnly = true;
      building.add(mesh);
      heat.meshes.push(mesh);
    }
    redraw();
  }
  function scheduleHeat() {
    if (!state.heat && !heat.meshes.length) return;
    if (!heat.timer) heat.timer = setTimeout(buildHeat, 60);
  }

  // ---- highlight: the selected element red, the elements of a selected record in its colour
  function applyMaterials() {
    const r = sel();
    const recIds = new Set(r?.elements || []);
    recordMat.color.set(cssVar(r?.type === 'sketch' ? '--sketch' : '--photo') || '#2a56c6');
    for (const [id, el] of elements) {
      const m = id === state.selEl ? selectMat : recIds.has(id) ? recordMat : null;
      for (const { mesh, base } of el.meshes) mesh.material = m || base;
    }
  }

  // ---- panel
  const levelObs = () => records.filter(obsOnLevel);
  function renderStats() {
    const list = levelObs();
    const photos = list.filter((o) => o.type !== 'sketch').length;
    const ids = new Set(list.flatMap((o) => o.elements));
    $('#stats').innerHTML = `
      <div class="stat"><b>${photos}</b><span>fotó</span></div>
      <div class="stat"><b>${list.length - photos}</b><span>vázlat</span></div>
      <div class="stat"><b>${ids.size}</b><span>rögzített elem</span></div>`;
  }
  const recButton = (o) => `
      <li><button type="button" data-obs="${esc(o.id)}" aria-current="${o.id === state.selId}">
        <span class="glyph glyph--${o.type === 'sketch' ? 'sketch' : 'photo'}" aria-hidden="true"></span>
        <span class="rid">${esc(o.id)}</span>
        <span class="rtitle">${esc(o.title || 'Cím nélkül')}</span>
        <span class="rcount" title="Képek">${o.images.length || ''}</span>
      </button></li>`;
  function renderRecords() {
    const list = levelObs().sort((a, b) => a.id.localeCompare(b.id));
    const waiting = records.filter((o) => !placed(o)).sort((a, b) => a.id.localeCompare(b.id));
    $('#records').innerHTML = (list.length ? list.map(recButton).join('') : '<li class="empty">Ezen a szinten még nincs felvétel.</li>')
      + (waiting.length ? `<li class="records__head">Még nincs elhelyezve · ${waiting.length}</li>${waiting.map(recButton).join('')}` : '');
    $('#records-count').textContent = String(list.length);
  }
  // the list folds away; the choice is kept in this browser
  const fold = $('#records-fold');
  if (recall('bo-records-open') === '0') fold.open = false;
  fold.addEventListener('toggle', () => remember('bo-records-open', fold.open ? '1' : '0'));
  const elementLabel = (id) => { const e = elements.get(id); return e ? e.info.blockName || e.info.name : id.slice(0, 8); };
  const thumbs = (r, attr) => (r.images.length > 1
    ? `<div class="thumbs">${r.images.map((im, i) => `<button type="button" ${attr}="${i}" aria-label="${i + 1}. nézet">${mediaTag(im, 'thumb')}</button>`).join('')}</div>` : '');
  function mediaTag(im, cls = '') {
    const url = imageUrl(im);
    if (/\.pdf($|\?)/i.test(im.name || url) || im.pdf) return `<a class="pdf ${cls}" href="${esc(url)}" target="_blank" rel="noopener">PDF · ${esc(im.name || 'vázlat')}</a>`;
    return `<img class="${cls}" src="${esc(url)}" alt="${esc(im.caption || im.name || '')}" loading="lazy" decoding="async">`;
  }
  function renderDetail(force = false) {
    const box = $('#detail');
    // don't rebuild a form while someone is typing in it (live updates arrive while editing)
    if (!force && box.contains(document.activeElement) && box.dataset.rec === (state.selId || '')) return;
    box.dataset.rec = state.selId || '';
    const o = sel();
    if (o && editable) { box.innerHTML = editForm(o); return; }
    if (o) {
      const first = o.images[0];
      const img = first ? `<figure>${mediaTag(first)}</figure>`
        : `<figure class="placeholder"><span>${kind(o)} ${esc(o.id)} · még nincs kép</span></figure>`;
      const meta = [kind(o), o.id, LEVELS[o.level]?.label, o.author, o.date].filter(Boolean);
      box.innerHTML = `
        <p class="label">Kijelölt ${kind(o).toLowerCase()}</p>
        ${img}${thumbs(o, 'data-detail-view')}
        <h3>${esc(o.title || 'Cím nélkül')}</h3>
        <p class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
        ${o.note ? `<p>${esc(o.note)}</p>` : ''}
        <p class="label">Látható elemek · ${o.elements.length}</p>
        <ul class="chips">${o.elements.map((id) => `<li><button type="button" data-el="${esc(id)}">${esc(elementLabel(id))}</button></li>`).join('')}</ul>`;
      return;
    }
    const id = state.selEl;
    if (id || state.clickPoint) {
      const e = id ? elements.get(id) : null;
      const related = id ? records.filter((ob) => ob.elements.includes(id)) : [];
      const p = state.clickPoint;
      box.innerHTML = `
        <p class="label">Kijelölt elem</p>
        ${e ? `<h3>${esc(e.info.name)} <span class="rid">${esc(e.info.blockName)}</span></h3>` : '<h3>Pont a modellen</h3>'}
        <dl class="kv">
          ${e ? `<dt>Elemazonosító</dt><dd>${esc(id)}</dd>
          <dt>Magasság</dt><dd>${fmt(e.info.zmin)} → ${fmt(e.info.zmax)} m</dd>
          <dt>Rögzítve</dt><dd>${related.length ? related.length + ' alkalommal' : 'még nem'}</dd>` : ''}
          ${p ? `<dt>Kattintott pont</dt><dd>x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} · z ${p.z.toFixed(2)}</dd>` : ''}
        </dl>
        ${related.length ? `<ul class="chips">${related.map((ob) => `<li><button type="button" data-obs="${esc(ob.id)}">${esc(ob.id)}</button></li>`).join('')}</ul>` : ''}
        ${editable ? '' : `<button type="button" class="btn" id="copy-snippet">Másolás új felvételként</button>
        <textarea class="snippet" id="snippet" readonly hidden>${esc(snippet(p, id))}</textarea>`}`;
      return;
    }
    box.innerHTML = `
      <p class="label">Kijelölés</p>
      <p class="hint">${editable
        ? 'Kattints egy jelölőre a szerkesztéséhez: a gömböt húzva áthelyezed, egy kúpot húzva elforgatod azt a nézetet. Vagy adj hozzá fent fotó- vagy vázlatpontot, illetve tölts fel képeket lent a galériában.'
        : 'Kattints egy jelölőre a fotó vagy vázlat megtekintéséhez. Kattints az O épület bármely részére az azonosítójáért és az azt mutató felvételekért.'}</p>`;
  }
  function snippet(p, id) {
    const z = p ? p.z : 0;
    const level = state.level === 'whole' ? (z > 7 ? 'roof' : z > 3.7 ? 'first' : 'ground') : state.level;
    return JSON.stringify({
      id: 'P-000', type: 'photo', level,
      position: p ? [+p.x.toFixed(2), +p.y.toFixed(2)] : [0, 0],
      direction: 0, elements: id ? [id] : [],
      title: '', note: '', images: [], author: '', date: new Date().toISOString().slice(0, 10),
    }, null, 2);
  }

  // ---- editor form (editor page only)
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  function editForm(o) {
    const pos = o.position;
    return `
      <p class="label">${kind(o)} ${esc(o.id)} · szerkesztés</p>
      <div class="docs">
        ${o.images.map((im, i) => `
          <div class="doc">
            <div class="doc__img">${mediaTag(im)}</div>
            <label>Képaláírás<input type="text" data-img="${i}" data-imgfield="caption" value="${esc(im.caption || '')}" placeholder="${esc(im.name || '')}"></label>
            <label>Nézet °<input type="number" step="1" data-img="${i}" data-imgfield="direction" value="${Math.round(im.direction ?? o.direction)}"></label>
            <button type="button" class="linkbtn danger" data-img-remove="${i}">Eltávolítás</button>
          </div>`).join('')}
        <label class="btn btn--quiet upload">Fotók vagy vázlatok hozzáadása<input type="file" accept="image/*,.heic,.heif,application/pdf" multiple data-add-images hidden></label>
      </div>
      <div class="form">
        <label class="wide">Cím<input type="text" data-field="title" value="${esc(o.title)}"></label>
        <label>Típus<select data-field="type">${opt('photo', o.type, 'Fotó')}${opt('sketch', o.type, 'Vázlat')}</select></label>
        <label>Szint<select data-field="level">${['ground', 'first', 'roof', 'site'].map((l) => opt(l, o.level, LEVELS[l].label)).join('')}</select></label>
        <label>Szerző<input type="text" data-field="author" value="${esc(o.author)}"></label>
        <label>Dátum<input type="date" data-field="date" value="${esc(o.date)}"></label>
        <label class="wide">Megjegyzés<textarea data-field="note" rows="2">${esc(o.note)}</textarea></label>
      </div>
      <p class="label">Ahol álltál</p>
      <div class="form form--pos">
        <label>x<input type="number" step="0.05" data-field="x" value="${pos ? pos[0].toFixed(2) : ''}"></label>
        <label>y<input type="number" step="0.05" data-field="y" value="${pos ? pos[1].toFixed(2) : ''}"></label>
        <label>Padló z<input type="number" step="0.05" data-field="z" value="${(o.z ?? LEVELS[o.level]?.ffl ?? 0).toFixed(2)}"></label>
        <label>Nézet °<input type="number" step="1" data-field="direction" value="${Math.round(o.direction)}"></label>
      </div>
      <div class="row">
        <button type="button" class="btn${state.mode === 'place' ? ' is-on' : ''}" data-mode="place">${state.mode === 'place' ? 'Kattints a modellre…' : pos ? 'Áthelyezés a modellre kattintva' : 'Elhelyezés a modellen'}</button>
      </div>
      <p class="label">Látható elemek · ${o.elements.length}</p>
      <ul class="chips">${o.elements.map((id) => `<li><button type="button" data-el-remove="${esc(id)}" title="Eltávolítás">${esc(elementLabel(id))} ×</button></li>`).join('')}</ul>
      <div class="row">
        <button type="button" class="btn btn--quiet${state.mode === 'elements' ? ' is-on' : ''}" data-mode="elements">${state.mode === 'elements' ? 'Kiválasztás kész' : 'Elemek kiválasztása a modellen'}</button>
        <button type="button" class="linkbtn danger" data-delete-rec>Felvétel törlése</button>
      </div>
      <p class="hint" id="ed-confirm" hidden></p>`;
  }

  // ---- gallery: every record as a card under the viewer; hatched until its image is uploaded
  const authorOf = (o) => (o.author || '').trim() || '__none';
  const galList = () => records
    .filter((o) => (state.gal.type === 'all' || o.type === state.gal.type)
      && (state.gal.level === 'all' || (state.gal.level === 'unplaced' ? !placed(o) : placed(o) && o.level === state.gal.level))
      && (state.gal.author === 'all' || authorOf(o) === state.gal.author))
    .sort((a, b) => a.id.localeCompare(b.id));
  // author chips, from the authors in the records (most records first; "No author" last)
  let authorSig = '';
  function renderAuthors() {
    const counts = new Map();
    for (const o of records) counts.set(authorOf(o), (counts.get(authorOf(o)) || 0) + 1);
    if (state.gal.author !== 'all' && !counts.has(state.gal.author)) state.gal.author = 'all';
    const list = [...counts].sort((a, b) => (a[0] === '__none') - (b[0] === '__none') || b[1] - a[1] || a[0].localeCompare(b[0], 'hu'));
    const sig = JSON.stringify([state.gal.author, list]);
    if (sig === authorSig) return;
    authorSig = sig;
    const chip = (key, label, n) => `<button type="button" class="chip${state.gal.author === key ? ' is-on' : ''}" data-author="${esc(key)}" aria-pressed="${state.gal.author === key}">${esc(label)}${n != null ? ` <span class="chip__n">${n}</span>` : ''}</button>`;
    $('#gal-author').innerHTML = list.length > 1 || (list.length === 1 && list[0][0] !== '__none')
      ? chip('all', 'Minden szerző') + list.map(([k, n]) => chip(k, k === '__none' ? 'Szerző nélkül' : k, n)).join('') : '';
  }
  $('#gal-author').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-author]');
    if (!b) return;
    state.gal.author = b.dataset.author;
    renderAuthors();
    renderGallery();
  });
  function renderGallery() {
    const list = galList();
    const withImg = list.filter((o) => o.images.length).length;
    $('#gal-count').textContent = `${list.length} felvétel · ${withImg} képpel`;
    $('#gallery').innerHTML = list.length ? list.map((o) => {
      const first = o.images[0];
      const tags = [o.images.length > 1 ? `${o.images.length} nézet` : '', placed(o) ? '' : 'nincs elhelyezve'].filter(Boolean);
      return `
      <li><button type="button" class="card" data-gal="${esc(o.id)}" aria-current="${o.id === state.selId}">
        <span class="card__img${first ? '' : ' placeholder'}">${first ? mediaTag(first) : `<span class="gallery__wait">${kind(o)} ${esc(o.id)} · a kép később érkezik</span>`}
          ${tags.length ? `<span class="card__tags">${tags.map((t) => `<span>${t}</span>`).join('')}</span>` : ''}</span>
        <span class="card__meta"><span class="glyph glyph--${o.type === 'sketch' ? 'sketch' : 'photo'}" aria-hidden="true"></span><span class="rid">${esc(o.id)}</span><span>${esc(placed(o) ? LEVELS[o.level]?.label || '' : 'Nincs elhelyezve')}</span></span>
        <span class="card__title">${esc(o.title || 'Cím nélkül')}</span>
        ${o.date || o.author ? `<span class="card__sub">${esc([o.date, o.author].filter(Boolean).join(' · '))}</span>` : ''}
      </button></li>`;
    }).join('')
      : `<li class="gallery__empty">Nincs a szűrésnek megfelelő ${{ all: 'felvétel', photo: 'fotó', sketch: 'vázlat' }[state.gal.type]}.${editable ? ' Húzz ide képeket, vagy használd a feltöltés gombokat.' : ''}</li>`;
  }
  $('#gallery').addEventListener('error', (ev) => {
    const img = ev.target;
    if (img.tagName !== 'IMG' || !img.closest('.card__img')) return;
    const box = img.closest('.card__img');
    box.classList.add('placeholder');
    img.replaceWith(Object.assign(document.createElement('span'), { className: 'gallery__wait', textContent: 'a kép nem található' }));
  }, true);
  function setFilter(group, key, value) {
    state.gal[key] = value;
    document.querySelectorAll(`#${group} .chip`).forEach((b) => {
      const on = b.dataset[key] === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderGallery();
  }
  document.querySelectorAll('#gal-type .chip').forEach((b) => b.addEventListener('click', () => setFilter('gal-type', 'type', b.dataset.type)));
  document.querySelectorAll('#gal-level .chip').forEach((b) => b.addEventListener('click', () => setFilter('gal-level', 'level', b.dataset.level)));

  // lightbox
  const lb = $('#lightbox');
  const lbState = { id: null, view: 0 };
  function renderLightbox() {
    const o = index.get(lbState.id);
    if (!o) { if (lb.open) lb.close(); return; }
    const im = o.images[lbState.view] || o.images[0];
    $('#lb-media').innerHTML = im ? mediaTag(im)
      : `<div class="placeholder"><span>${kind(o)} ${esc(o.id)} · a kép később érkezik</span></div>`;
    $('#lb-kind').textContent = `${kind(o)} ${o.id}${o.images.length > 1 ? ` · ${lbState.view + 1}. nézet / ${o.images.length}` : ''}`;
    $('#lb-title').textContent = o.title || 'Cím nélkül';
    $('#lb-meta').innerHTML = [placed(o) ? LEVELS[o.level]?.label : 'Még nincs elhelyezve', o.author, o.date, `${o.elements.length} látható elem`]
      .filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
    $('#lb-note').textContent = [im?.caption, o.note].filter(Boolean).join(' — ');
    $('#lb-note').hidden = !$('#lb-note').textContent;
    $('#lb-thumbs').innerHTML = thumbs(o, 'data-lb-view');
    $('#lb-show').textContent = placed(o) ? 'Megmutatás a modellen' : editable ? 'Elhelyezés a modellen' : 'Még nincs a modellen';
    $('#lb-show').disabled = !placed(o) && !editable;
  }
  function openLightbox(o, view = 0) {
    lbState.id = o.id; lbState.view = view;
    renderLightbox();
    if (!lb.open) lb.showModal();
  }
  function stepLightbox(d) {
    const list = galList();
    const i = list.findIndex((x) => x.id === lbState.id);
    if (list.length) openLightbox(list[(i + d + list.length) % list.length]);
  }
  $('#lb-close').addEventListener('click', () => lb.close());
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  lb.addEventListener('click', (ev) => {
    if (ev.target === lb) { lb.close(); return; }
    const t = ev.target.closest('[data-lb-view]');
    if (t) { lbState.view = Number(t.dataset.lbView); renderLightbox(); }
  });
  lb.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, textarea')) return;
    if (ev.key === 'ArrowLeft') stepLightbox(-1);
    if (ev.key === 'ArrowRight') stepLightbox(1);
  });
  $('#lb-show').addEventListener('click', () => {
    const o = index.get(lbState.id);
    lb.close();
    if (!o) return;
    selectObs(o);
    if (placed(o)) flyTo(levelGoal(o.level));
    else if (editable) { state.mode = 'place'; renderDetail(true); }
    canvas.closest('section').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#gallery').addEventListener('click', (ev) => {
    const card = ev.target.closest('[data-gal]');
    const o = card && index.get(card.dataset.gal);
    if (o) openLightbox(o);
  });

  function refresh({ markers = false, form = false } = {}) {
    if (markers) rebuildMarkers(); else updateMarkers();
    applyMaterials();
    renderStats();
    renderDetail(form);
    renderRecords();
    renderAuthors();
    renderGallery();
    scheduleHeat();
    if (lb.open) renderLightbox();
    stage.classList.toggle('is-placing', state.mode === 'place' || state.mode === 'elements');
    redraw();
  }

  // ---- level: cut Building O and fly to the floor
  function levelGoal(level) {
    const lvl = LEVELS[level] || LEVELS.whole;
    building.updateMatrixWorld(true);
    const target = building.localToWorld(r2t(CENTER.x, CENTER.y, lvl.focusZ));
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const d = lvl.fit / Math.sin(Math.min(vfov, hfov) / 2);
    // the user's chosen view (2026-10-07): from the west, onto the corner where the canopy facade (model +x) meets
    // the facade with the flues (model +y), 37° above the horizon – taken from the building's own axes
    const diag = r2t(1, 1, 0).transformDirection(building.matrixWorld).setY(0).normalize();
    const elev = THREE.MathUtils.degToRad(37);
    const dir = diag.multiplyScalar(Math.cos(elev)).setY(Math.sin(elev));
    return { target, position: target.clone().add(dir.multiplyScalar(d)) };
  }
  function setLevel(level, { fly = true } = {}) {
    if (level === 'site') level = 'whole';
    state.level = level;
    const lvl = LEVELS[level];
    cutPlane.constant = lvl.cut == null ? 1e6 : lvl.cut;
    document.querySelectorAll('#level-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === level)));
    $('#ctx-level-tag').textContent = lvl.tag;
    $('#ctx-level-tag').hidden = level === 'whole';
    const s = sel();
    if (s && placed(s) && !obsOnLevel(s) && !editable) state.selId = null;
    refresh();
    if (fly) flyTo(levelGoal(level));
  }

  // ---- picking (markers before Building O; nothing above the cut)
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function aim(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return r;
  }
  const markerAt = () => ray.intersectObjects(markerHits.filter((m) => m.parent.visible && markerGroup.visible), false)[0];
  const cutY = () => LEVELS[state.level].cut;
  const buildingHit = () => (building.visible ? ray.intersectObjects(pickables, false).find((h) => cutY() == null || h.point.y <= cutY() + 1e-3) : null);
  function pick(ev) {
    aim(ev);
    const mh = markerAt();
    const eh = buildingHit();
    if (mh && (!eh || mh.distance <= eh.distance + 0.5)) return { obs: index.get(mh.object.userData.rec) };
    if (eh) return { el: eh.object.userData.id, point: eh.point };
    return null;
  }
  function selectObs(o) {
    if (state.selId !== o.id) state.mode = null;
    state.selId = o.id; state.selEl = null; state.clickPoint = null;
    if (placed(o) && !obsOnLevel(o) && o.level !== 'site') setLevel(o.level, { fly: true });
    refresh({ markers: editable, form: true });
  }
  function clearSelection() {
    if (!state.selId && !state.selEl && !state.clickPoint) return;
    state.selId = null; state.selEl = null; state.clickPoint = null; state.mode = null;
    refresh({ markers: editable, form: true });
  }
  /** click on the canvas */
  function click(ev) {
    const r = sel();
    if (editable && r && state.mode === 'place') { placeAt(ev, r); return; }
    if (editable && r && state.mode === 'elements') {
      aim(ev);
      const eh = buildingHit();
      if (eh) {
        const id = eh.object.userData.id;
        r.elements = r.elements.includes(id) ? r.elements.filter((x) => x !== id) : [...r.elements, id];
        save(r);
        refresh({ form: true });
      }
      return;
    }
    const hit = pick(ev);
    if (!hit) { clearSelection(); return; }
    if (hit.obs) { selectObs(hit.obs); return; }
    const local = building.worldToLocal(hit.point.clone());
    state.selId = null; state.mode = null;
    state.selEl = hit.el;
    state.clickPoint = { x: local.x, y: -local.z, z: local.y };
    refresh({ markers: editable, form: true });
  }
  function placeAt(ev, r) {
    aim(ev);
    const eh = buildingHit();
    const sh = ray.intersectObjects(siteTargets, true).find((h) => h.object.isMesh);
    const h = eh && (!sh || eh.distance <= sh.distance) ? eh : sh;
    if (!h) return;
    const local = building.worldToLocal(h.point.clone());
    r.position = [+local.x.toFixed(2), +(-local.z).toFixed(2)];
    r.z = +local.y.toFixed(2);
    r.level = h === eh ? (r.z > 7 ? 'roof' : r.z > 3.0 ? 'first' : 'ground') : 'site';
    state.mode = null;
    save(r);
    // switch to a view that shows the record where it now stands
    if (r.level === 'site' && state.level !== 'whole') setLevel('whole', { fly: false });
    else if (r.level !== 'site' && state.level !== 'whole' && state.level !== r.level) setLevel(r.level, { fly: false });
    refresh({ markers: true, form: true });
  }
  /** hover: returns true when a marker is under the pointer (and shows its tooltip) */
  function hover(ev) {
    if (drag) return true;
    const r = aim(ev);
    const h = markerAt();
    if (!h) { canvas.style.cursor = state.mode ? 'crosshair' : ''; return false; }
    const o = index.get(h.object.userData.rec);
    const editingThis = editable && o && o.id === state.selId;
    tooltip.textContent = editingThis ? (h.object.userData.part === 'head' ? 'Húzd az áthelyezéshez' : 'Húzd a nézet elforgatásához') : `${o.id} · ${o.title || ''}`;
    tooltip.style.left = `${ev.clientX - r.left}px`;
    tooltip.style.top = `${ev.clientY - r.top}px`;
    tooltip.hidden = false;
    canvas.style.cursor = editingThis ? (h.object.userData.part === 'head' ? 'move' : 'grab') : 'pointer';
    return true;
  }

  // ---- dragging the selected marker (editor): ball moves it, a cone turns that view
  let drag = null;
  const plane = new THREE.Plane();
  const tmp = new THREE.Vector3();
  if (editable) {
    stage.addEventListener('pointerdown', (ev) => {
      const r = sel();
      if (!r || !placed(r) || state.mode || ev.button !== 0) return;
      aim(ev);
      const h = markerAt();
      if (!h || h.object.userData.rec !== r.id) return;
      const g = markerGroup.children.find((x) => x.userData.rec === r.id);
      g.getWorldPosition(tmp);
      plane.set(new THREE.Vector3(0, 1, 0), -tmp.y);
      drag = { r, g, part: h.object.userData.part, view: h.object.userData.view, cone: h.object };
      controls.enabled = false;
      canvas.setPointerCapture?.(ev.pointerId);
      ev.stopPropagation();
    }, { capture: true });
    canvas.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      aim(ev);
      if (!ray.ray.intersectPlane(plane, tmp)) return;
      const local = building.worldToLocal(tmp.clone());
      if (drag.part === 'head') {
        drag.r.position = [+local.x.toFixed(2), +(-local.z).toFixed(2)];
        drag.g.position.x = local.x; drag.g.position.z = local.z;
      } else {
        const a = Math.round(deg(Math.atan2(-(local.z - drag.g.position.z), local.x - drag.g.position.x)));
        if (drag.view >= 0) drag.r.images[drag.view].direction = a;
        else drag.r.direction = a;
        placeCone(drag.cone, a);
      }
      redraw();
    });
    const end = () => {
      if (!drag) return;
      const r = drag.r;
      drag = null;
      controls.enabled = true;
      save(r);
      refresh({ form: true });
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ---- saving (editor)
  const status = (msg, err = false) => {
    const el = $('#ed-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('is-error', err);
  };
  // Resolves true once saved. A refused write (invalid_argument: this person's access only lets them view the
  // records) turns the page read-only for the rest of the visit and drops the change that wasn't saved.
  function save(r) {
    status('Mentés…');
    const before = r.id;
    return store.save(r).then(() => {
      if (r.id !== before) { if (state.selId === before) state.selId = r.id; index = byId(); refresh({ markers: true, form: true }); }   // renumbered by the server
      status('Mentve'); return true;
    }).catch((e) => {
      if (e?.code === 'invalid_argument' || e?.code === 'forbidden') lockReadOnly();
      else status(`Nem sikerült menteni (${e?.code || 'hiba'}).`, true);
      return false;
    });
  }
  function lockReadOnly() {
    if (!editable) return;
    editable = false;
    state.mode = null;
    for (const id of ['ed-new-photo', 'ed-new-sketch', 'ed-clear-samples', 'gal-upload']) { const el = $('#' + id); if (el) el.hidden = true; }
    records = lastSnapshot.slice(); index = byId();
    refresh({ markers: true, form: true });
    status(store.readOnlyMessage || 'Ehhez a szerkesztőhöz csak megtekintési jogod van, ezért semmi sem mentődött.', true);
  }
  function nextId(type) {
    const n = Math.max(0, ...records.map((r) => parseInt(String(r.id).replace(/^\D+/, ''), 10) || 0)) + 1;
    return `${type === 'sketch' ? 'S' : 'P'}-${String(n).padStart(3, '0')}`;
  }
  function newRecord(type, extra = {}) {
    const r = {
      id: nextId(type), type, level: state.level === 'whole' ? 'ground' : state.level, position: null, z: undefined,
      direction: 0, elements: [], title: '', note: '', author: '', date: new Date().toISOString().slice(0, 10), images: [], ...extra,
      _new: true,   // the first save creates it (the home server renumbers it if someone else took the id meanwhile)
    };
    records.push(r);
    index = byId();
    return r;
  }
  async function uploadFiles(files, onEach) {
    const list = [...files];
    let done = 0, failed = [];
    for (const f of list) {
      if (!editable) return;
      status(`Feltöltés: ${done + 1} / ${list.length}…`);
      try {
        const blob = await prepareUpload(f);
        const res = await store.upload(blob);
        await onEach({ asset: res.id, name: f.name, pdf: blob.type === 'application/pdf' || undefined }, f);
      } catch (e) {
        failed.push(e?.message && !e.code ? e.message : `${f.name}: ${e?.code === 'too_large' ? 'nagyobb 20 MB-nál' : e?.code === 'unsupported_type' ? 'nem támogatott fájltípus' : e?.code || 'sikertelen feltöltés'}`);
      }
      done++;
    }
    if (!editable) return;   // the read-only notice stays
    status(failed.length ? `${done - failed.length} feltöltve. ${failed.join(' ')}` : `${done} feltöltve.`, failed.length > 0);
  }

  // ---- editor controls
  if (editable) {
    $('#editor-bar').hidden = false;
    $('#gal-upload').hidden = !store.canUpload;
    const fileDate = (f) => new Date(f.lastModified || Date.now()).toISOString().slice(0, 10);
    async function bulk(files, type) {
      await uploadFiles(files, (img, f) => {
        const r = newRecord(type, { title: f.name.replace(/\.[^.]+$/, ''), date: fileDate(f), images: [{ ...img, direction: 0 }] });
        return save(r).then((ok) => { if (!ok) return store.deleteImage(img); });   // no record to hold it: don't leave the file behind
      });
      if (editable) setFilter('gal-level', 'level', 'unplaced');
      refresh({ markers: true });
    }
    $('#ed-new-photo').addEventListener('click', () => { const r = newRecord('photo'); save(r); selectObs(r); state.mode = 'place'; refresh({ form: true }); });
    $('#ed-new-sketch').addEventListener('click', () => { const r = newRecord('sketch'); save(r); selectObs(r); state.mode = 'place'; refresh({ form: true }); });
    $('#gal-up-photos').addEventListener('change', (e) => { bulk([...e.target.files], 'photo'); e.target.value = ''; });
    $('#gal-up-sketches').addEventListener('change', (e) => { bulk([...e.target.files], 'sketch'); e.target.value = ''; });
    const zone = $('#gallery');
    zone.addEventListener('dragover', (e) => { if (store.canUpload && editable && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); zone.classList.add('is-drop'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drop'));
    zone.addEventListener('drop', (e) => {
      if (!store.canUpload || !editable) return;
      e.preventDefault();
      zone.classList.remove('is-drop');
      bulk([...e.dataTransfer.files], state.gal.type === 'sketch' ? 'sketch' : 'photo');
    });
    const sampleBtn = $('#ed-clear-samples');
    sampleBtn.addEventListener('click', async () => {
      if (sampleBtn.dataset.armed !== '1') { sampleBtn.dataset.armed = '1'; sampleBtn.textContent = 'Kattints újra a mintafelvételek törléséhez'; return; }
      sampleBtn.dataset.armed = ''; sampleBtn.textContent = 'Mintafelvételek eltávolítása';
      for (const r of records.filter((x) => x.sample)) await store.remove(r).catch(() => {});
      status('Mintafelvételek eltávolítva.');
    });

    // the edit form
    const box = $('#detail');
    box.addEventListener('change', async (ev) => {
      const r = sel();
      if (!r) return;
      const t = ev.target;
      if (t.dataset.addImages !== undefined) {
        const files = [...t.files];   // copy before clearing the input (that empties its live FileList)
        t.value = '';
        const added = [];
        await uploadFiles(files, (img) => { const v = { ...img, direction: r.direction }; added.push(v); r.images.push(v); });
        if (added.length && !(await save(r))) {   // not saved: take the views back off and delete their files
          r.images = r.images.filter((v) => !added.includes(v));
          for (const v of added) await store.deleteImage(v);
        }
        refresh({ markers: true, form: true });
        return;
      }
      if (t.dataset.imgfield) {
        const im = r.images[Number(t.dataset.img)];
        if (!im) return;
        im[t.dataset.imgfield] = t.dataset.imgfield === 'direction' ? Number(t.value) || 0 : t.value;
      } else if (t.dataset.field) {
        const f = t.dataset.field, v = t.value;
        if (f === 'x' || f === 'y') {
          const n = parseFloat(v);
          if (!Number.isFinite(n)) return;
          r.position = r.position || [CENTER.x, CENTER.y];
          r.position[f === 'x' ? 0 : 1] = n;
        } else if (f === 'z') r.z = parseFloat(v) || 0;
        else if (f === 'direction') {
          const old = r.direction, n = Number(v) || 0;
          r.images.forEach((im) => { if ((im.direction ?? old) === old) im.direction = n; });   // views that followed the record turn with it
          r.direction = n;
        } else r[f] = v;
        if (f === 'level') r.z = LEVELS[v]?.ffl;
      } else return;
      save(r);
      refresh({ markers: true, form: t.tagName === 'SELECT' });
    });
    box.addEventListener('click', async (ev) => {
      const r = sel();
      if (!r) return;
      const m = ev.target.closest('[data-mode]');
      if (m) { state.mode = state.mode === m.dataset.mode ? null : m.dataset.mode; refresh({ form: true }); return; }
      const er = ev.target.closest('[data-el-remove]');
      if (er) { r.elements = r.elements.filter((x) => x !== er.dataset.elRemove); save(r); refresh({ form: true }); return; }
      const ir = ev.target.closest('[data-img-remove]');
      if (ir) {
        if (ir.dataset.armed !== '1') { ir.dataset.armed = '1'; ir.textContent = 'Kattints újra: kép törlése'; return; }
        const [im] = r.images.splice(Number(ir.dataset.imgRemove), 1);
        save(r);
        store.deleteImage(im);
        refresh({ markers: true, form: true });
        return;
      }
      if (ev.target.closest('[data-delete-rec]')) {
        const b = ev.target.closest('[data-delete-rec]');
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = `Kattints újra: ${r.id} és képei törlése`; return; }
        await store.remove(r).catch(() => status('Nem sikerült törölni.', true));
        state.selId = null; state.mode = null;
        refresh({ markers: true, form: true });
      }
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.mode) { state.mode = null; refresh({ form: true }); } });
  }

  // ---- shared controls
  document.querySelectorAll('#level-switch button').forEach((b) => b.addEventListener('click', () => setLevel(b.dataset.level)));
  $('#show-photos').addEventListener('change', (e) => { state.showPhotos = e.target.checked; updateMarkers(); scheduleHeat(); redraw(); });
  $('#show-sketches').addEventListener('change', (e) => { state.showSketches = e.target.checked; updateMarkers(); scheduleHeat(); redraw(); });
  const heatBox = $('#show-heat');
  state.heat = heatBox.checked = recall('bo-heat') === '1';
  heatBox.addEventListener('change', () => { state.heat = heatBox.checked; remember('bo-heat', state.heat ? '1' : '0'); scheduleHeat(); });
  document.addEventListener('click', (ev) => {
    const ob = ev.target.closest('[data-obs]');
    if (ob) { const o = index.get(ob.dataset.obs); if (o) selectObs(o); return; }
    const dv = ev.target.closest('[data-detail-view]');
    if (dv) { const o = sel(); if (o) openLightbox(o, Number(dv.dataset.detailView)); return; }
    const el = ev.target.closest('[data-el]');
    if (el && elements.has(el.dataset.el)) {
      state.selId = null; state.selEl = el.dataset.el; state.clickPoint = null; state.mode = null;
      refresh({ markers: editable, form: true });
      return;
    }
    if (ev.target.id === 'copy-snippet') {
      const ta = $('#snippet');
      const done = () => { ev.target.textContent = 'Másolva'; setTimeout(() => { ev.target.textContent = 'Másolás új felvételként'; }, 1600); };
      const fallback = () => { ta.hidden = false; ta.focus(); ta.select(); ev.target.textContent = 'Jelöld ki és másold lent'; };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
      else fallback();
    }
  });

  // ---- live data
  setLevel('whole', { fly: false });
  store.subscribe((list) => {
    // keep a marker being dragged where the pointer put it
    lastSnapshot = list;
    records = list.map((r) => (drag && drag.r.id === r.id ? drag.r : r));
    index = byId();
    $('#ed-clear-samples') && ($('#ed-clear-samples').hidden = !records.some((r) => r.sample));
    refresh({ markers: true });
  }, () => status('Megszakadt a kapcsolat a közös felvételekkel; töltsd újra az oldalt.', true));

  return {
    click, hover, setLevel, levelGoal,
    onTheme() { markerMats(); applyMaterials(); heat.key = ''; scheduleHeat(); },
  };
}
