// Topic 02 "Kulturális élet": 3D map of Veszprém (terrain, roads, buildings from the commuter project's
// js/commuter-topo.js and js/commuter-basemap.js, loaded by js/topics.js as window.TOPO / window.BASEMAP) with places:
// pins that carry a title, category, description, link and photos (records.js openPlaces: live on the home server,
// editable with the editor key; data/places.json on the public page).
// Coordinates: site metres, x east, y north, Building O at 0,0; heights relative to its ground floor (280.59 m a.s.l.).
// three = (x, (z - FFL) * exaggeration, -y).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { openPlaces, imageUrl, prepareUpload } from './records.js';
import { SCALES, view as venueView, bus as venueBus, venueById, inScale, km, selectVenue, clearVenue, photoUrl, openVenuePhotos } from './culture-venues.js';

const FFL = 280.59;
const VIEWS = { campus: [-650, -420, 1150, 880], city: [-3300, -2700, 4700, 4700] };
const RAMP_L = [[100, [226, 228, 212]], [200, [240, 231, 214]], [280, [247, 231, 214]], [360, [241, 214, 190]], [460, [228, 193, 162]], [640, [206, 170, 140]]];   // paper → sand (mood board)
const RAMP_D = [[100, [30, 29, 58]], [200, [36, 34, 66]], [280, [42, 40, 74]], [360, [50, 46, 82]], [460, [58, 52, 90]], [640, [68, 60, 98]]];   // indigo night

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };

export async function initCulture() {
  const TP = window.TOPO, BM = window.BASEMAP;
  const stage = $('#cul-stage'), canvas = $('#cul-scene'), pinsBox = $('#cul-pins'), osmBox = $('#cul-osm'), vpinsBox = $('#cul-vpins');
  const state = { places: [], selId: null, mode: null, ex: 1.5, showBld: true, showRoads: true, lb: { id: null, view: 0 },
    osm: [], osmId: null, osmKind: '', showOsm: true, showVenues: true };
  let byId = new Map(), osmById = new Map();   // declared early: render() can run before the data arrives
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
  const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  // ---- terrain height (m a.s.l., bilinear on the 45 m grid, clamped at the edge)
  const inTerrain = (x, y) => x >= TP.x0 && y >= TP.y0 && x <= TP.x0 + (TP.nx - 1) * TP.dx && y <= TP.y0 + (TP.ny - 1) * TP.dx;
  function tz(x, y) {
    let fx = (x - TP.x0) / TP.dx, fy = (y - TP.y0) / TP.dx;
    fx = Math.min(Math.max(fx, 0), TP.nx - 1.001); fy = Math.min(Math.max(fy, 0), TP.ny - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, z = TP.z, n = TP.nx;
    return ((z[j * n + i] * (1 - u) + z[j * n + i + 1] * u) * (1 - v) + (z[(j + 1) * n + i] * (1 - u) + z[(j + 1) * n + i + 1] * u) * v) / 10;
  }
  const sy = (asl) => (asl - FFL) * state.ex;            // scene height of an elevation
  const P3 = (x, y, asl) => new THREE.Vector3(x, sy(asl), -y);

  // ---- three.js
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 5, 120000);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.47; controls.screenSpacePanning = false; controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6250, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-3000, 4000, 2500); scene.add(sun);
  const groups = {};
  function dispose(name) {
    const g = groups[name]; if (!g) return;
    scene.remove(g); g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); delete groups[name];
  }
  function tint(z, out, k) {
    const R = isDark() ? RAMP_D : RAMP_L;
    for (let i = 0; i < R.length - 1; i++) if (z <= R[i + 1][0] || i === R.length - 2) {
      const t = Math.max(0, Math.min(1, (z - R[i][0]) / (R[i + 1][0] - R[i][0])));
      for (let c = 0; c < 3; c++) out[k + c] = (R[i][1][c] + (R[i + 1][1][c] - R[i][1][c]) * t) / 255;
      return;
    }
  }
  function buildTerrain() {
    dispose('terrain');
    const n = TP.nx * TP.ny, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = [];
    for (let j = 0; j < TP.ny; j++) for (let i = 0; i < TP.nx; i++) {
      const k = j * TP.nx + i, z = TP.z[k] / 10;
      pos[k * 3] = TP.x0 + i * TP.dx; pos[k * 3 + 1] = sy(z); pos[k * 3 + 2] = -(TP.y0 + j * TP.dx);
      tint(z, col, k * 3);
      if (i < TP.nx - 1 && j < TP.ny - 1) idx.push(k, k + TP.nx, k + 1, k + 1, k + TP.nx, k + TP.nx + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    const grp = new THREE.Group(); grp.add(m); scene.add(grp); groups.terrain = grp; groups.terrainMesh = m;
  }
  function buildRoads() {
    dispose('roads');
    const rp = [];
    for (const rd of BM.roads) {
      let x = 0, y = 0, px = null, py = null;
      for (let i = 0; i < rd.length; i += 2) {
        x += rd[i]; y += rd[i + 1];
        if (px !== null && inTerrain(x, y) && inTerrain(px, py)) {
          const s = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 40));
          for (let q = 0; q < s; q++) {
            const a = q / s, b = (q + 1) / s, xa = px + (x - px) * a, ya = py + (y - py) * a, xb = px + (x - px) * b, yb = py + (y - py) * b;
            rp.push(xa, sy(tz(xa, ya) + 2), -ya, xb, sy(tz(xb, yb) + 2), -yb);
          }
        }
        px = x; py = y;
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    const grp = new THREE.Group();
    grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(isDark() ? '#4a4878' : '#a99bb8') })));
    grp.visible = state.showRoads; scene.add(grp); groups.roads = grp;
  }
  // buildings: one merged mesh of closed prisms from just below the lowest ground corner to mean ground + height
  function ring(src) {
    const out = [];
    for (const p of src) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) out.push(p); }
    while (out.length > 2 && Math.abs(out[0][0] - out[out.length - 1][0]) < 0.01 && Math.abs(out[0][1] - out[out.length - 1][1]) < 0.01) out.pop();
    let a2 = 0; for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
    if (a2 < 0) out.reverse();
    return out.length >= 3 && Math.abs(a2) > 2 ? out : null;
  }
  // Per building k: its footprint (site metres, for matching venues), roof height (scene units), its run of vertices
  // in the merged mesh with the shade of each vertex (wall / roof / floor) and its base colour, so venue colours can be
  // painted into the colour buffer without rebuilding; triBld maps a triangle back to its building for picking.
  const foot = [], roof = [], vRange = [];
  let shade = null, baseCol = [], triBld = null;
  function buildBuildings() {
    dispose('bld');
    const P = [], C = [], S = [], T = [];
    const cE = new THREE.Color(isDark() ? '#3a3866' : '#f5e9da'), cO = new THREE.Color(isDark() ? '#4d4a80' : '#dcc4ad');
    baseCol = [];
    BM.buildings.forEach((b, k) => {
      const raw = []; let x = 0, y = 0;
      for (let i = 0; i < b.length; i += 2) { x += b[i]; y += b[i + 1]; raw.push([x, y]); }
      const pts = ring(raw); if (!pts) return;
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      if (!inTerrain(cx, cy)) return;
      let gmin = 1e9, gs = 0;
      for (const p of pts) { const g = tz(p[0], p[1]); gmin = Math.min(gmin, g); gs += g; }
      const z0 = sy(gmin) - 1.5, z1 = sy(gs / pts.length) + BM.h[k] / 10;
      const c = BM.hs[k] ? cO : cE, w = 0.86, f = 0.6, v0 = P.length / 3;
      foot[k] = pts; roof[k] = z1; baseCol[k] = c;
      const push = (s, ...xyz) => { P.push(...xyz); C.push(c.r * s, c.g * s, c.b * s); S.push(s); };
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        push(w, ax, z0, -ay); push(w, bx, z0, -by); push(w, bx, z1, -by); push(w, ax, z0, -ay); push(w, bx, z1, -by); push(w, ax, z1, -ay);
        T.push(k, k);
      }
      for (const [i, j0, k0] of THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), [])) {
        let j = j0, kk = k0;
        if ((pts[j][0] - pts[i][0]) * (pts[kk][1] - pts[i][1]) - (pts[j][1] - pts[i][1]) * (pts[kk][0] - pts[i][0]) < 0) [j, kk] = [kk, j];
        for (const ii of [i, j, kk]) push(1, pts[ii][0], z1, -pts[ii][1]);
        for (const ii of [i, kk, j]) push(f, pts[ii][0], z0, -pts[ii][1]);
        T.push(k, k);
      }
      vRange[k] = [v0, P.length / 3];
    });
    shade = Float32Array.from(S); triBld = Int32Array.from(T);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    const grp = new THREE.Group(); grp.add(m); grp.visible = state.showBld; scene.add(grp); groups.bld = grp; groups.bldMesh = m;
    painted = new Map();
    paintVenues?.();
  }
  let painted = new Map(), paintVenues = null;   // building k -> colour currently painted over its base
  function buildAll() {
    scene.background = new THREE.Color(cssVar('--stage') || (isDark() ? '#101416' : '#e4e7e3'));
    buildTerrain(); buildRoads(); buildBuildings();
  }

  // ---- camera
  function frame(bb) {
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, span = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
    const t = P3(cx, cy, tz(cx, cy));
    controls.target.copy(t);
    camera.position.set(t.x - span * 0.35, t.y + span * 0.75, t.z + span * 0.85);
    controls.update(); redraw();
  }
  let tween = 0;
  function flyTo(target, dist = 650) {
    const off = camera.position.clone().sub(controls.target);
    off.setLength(Math.max(150, Math.min(dist, off.length())));
    const t0 = controls.target.clone(), p0 = camera.position.clone(), p1 = target.clone().add(off), start = performance.now();
    cancelAnimationFrame(tween);
    const step = (now) => {
      const k = Math.min(1, (now - start) / 600), e = k * k * (3 - 2 * k);
      controls.target.lerpVectors(t0, target, e); camera.position.lerpVectors(p0, p1, e);
      controls.update(); render();
      if (k < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  // ---- render on demand
  let W = 0, H = 0, pending = false;
  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    render();
  }
  function redraw() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }
  const v = new THREE.Vector3();
  function render() {
    if (!W) return;
    renderer.render(scene, camera);
    // pins follow their anchors
    for (const el of pinsBox.children) {
      const p = byId.get(el.dataset.place);
      if (!p || !p.position) { el.hidden = true; continue; }
      v.copy(anchor(p)).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.hidden = !vis; if (!vis) continue;
      el.style.left = `${((v.x + 1) / 2) * W}px`; el.style.top = `${((1 - v.y) / 2) * H}px`;
      el.style.zIndex = String(1000 - Math.round(v.z * 500));
    }
    // event venues of the open scale tab (js/culture-venues.js): numbers, names when the camera is close
    if (!vpinsBox.hidden) {
      vpinsBox.classList.toggle('is-near', camera.position.distanceTo(controls.target) < 2500);
      for (const el of vpinsBox.children) {
        const ve = venueById.get(el.dataset.vpin), st = ve?.sites[Number(el.dataset.site)];
        if (!st) { el.hidden = true; continue; }
        v.copy(vAnchor(ve, st)).project(camera);
        const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        el.hidden = !vis; if (!vis) continue;
        el.style.left = `${((v.x + 1) / 2) * W}px`; el.style.top = `${((1 - v.y) / 2) * H}px`;
        el.style.zIndex = String(800 - Math.round(v.z * 300));
      }
    }
    // OSM venue dots: named when the camera is close (or the dot is selected)
    if (osmBox.hidden) return;
    osmBox.classList.toggle('is-near', camera.position.distanceTo(controls.target) < 1500);   // the campus view (~2.1 km) shows colours only
    for (const el of osmBox.children) {
      const o = osmById.get(el.dataset.osm);
      if (!o) { el.hidden = true; continue; }
      v.copy(osmAnchor(o)).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.hidden = !vis; if (!vis) continue;
      el.style.left = `${((v.x + 1) / 2) * W}px`; el.style.top = `${((1 - v.y) / 2) * H}px`;
      el.style.zIndex = String(500 - Math.round(v.z * 250));
    }
  }
  controls.addEventListener('change', redraw);
  new ResizeObserver(resize).observe(stage);

  // ---- cultural venues from OpenStreetMap (data/osm-culture.json, built by tools/osm_culture.ps1; read-only)
  const osmData = await fetch('data/osm-culture.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  state.osm = osmData?.venues || [];
  osmById = new Map(state.osm.map((o) => [o.id, o]));
  // each venue's building: the footprint that contains it, else the nearest one within 12 m (a point at the entrance)
  const inside = (pts, x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const segDist = (x, y, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const bldOf = new Map(), venueOfBld = new Map();
  const matchVenues = () => { for (const o of state.osm) {   // after the first buildBuildings(), which fills foot[]
    let best = -1, bd = 12;
    foot.forEach((pts, k) => {
      if (best >= 0 && bd === 0) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
      if (o.x < x0 - 12 || o.x > x1 + 12 || o.y < y0 - 12 || o.y > y1 + 12) return;
      if (inside(pts, o.x, o.y)) { best = k; bd = 0; return; }
      for (let i = 0; i < pts.length; i++) { const d = segDist(o.x, o.y, pts[i], pts[(i + 1) % pts.length]); if (d < bd) { bd = d; best = k; } }
    });
    if (best >= 0) { bldOf.set(o.id, best); if (!venueOfBld.has(best)) venueOfBld.set(best, o.id); }
  } };
  // venue buildings in the venue colour (selected one brighter); everything else back to its base colour
  paintVenues = () => {
    const mesh = groups.bldMesh; if (!mesh) return;
    const col = mesh.geometry.getAttribute('color'), a = col.array;
    const vc = new THREE.Color(cssVar('--venue') || '#9b2f8e'), sc = vc.clone().lerp(new THREE.Color('#ffffff'), isDark() ? 0.45 : 0.4);   // selected: a lighter purple
    const want = new Map();
    if (state.showOsm) for (const o of osmShown()) { const k = bldOf.get(o.id); if (k !== undefined) want.set(k, o.id === state.osmId ? sc : vc); }
    const paint = (k, c) => { const [v0, v1] = vRange[k]; for (let v = v0; v < v1; v++) { const s = shade[v]; a[v * 3] = c.r * s; a[v * 3 + 1] = c.g * s; a[v * 3 + 2] = c.b * s; } };
    for (const k of painted.keys()) if (!want.has(k)) paint(k, baseCol[k]);
    for (const [k, c] of want) paint(k, c);
    painted = want; col.needsUpdate = true; redraw();
  };
  const osmAnchor = (o) => (bldOf.has(o.id) ? new THREE.Vector3(o.x, roof[bldOf.get(o.id)] + 3, -o.y) : P3(o.x, o.y, tz(o.x, o.y) + 4));
  const osmLabel = (o) => o.name || o.kind;
  const osmShown = () => state.osm.filter((o) => !state.osmKind || o.kind === state.osmKind);
  const osmUrl = (o) => `https://www.openstreetmap.org/${o.id}`;
  function renderOsm() {
    const list = osmShown();
    osmBox.innerHTML = list.map((o) => `
      <button type="button" class="opin${bldOf.has(o.id) ? ' opin--bld' : ''}${o.id === state.osmId ? ' is-on' : ''}" data-osm="${esc(o.id)}" title="${esc(osmLabel(o))} · ${esc(o.kind)}">
        <span class="opin__label">${esc(osmLabel(o))}</span></button>`).join('');
    $('#cul-osm-count').textContent = String(state.osm.length);
    const kinds = [...new Set(state.osm.map((o) => o.kind))].sort((a, b) => a.localeCompare(b, 'hu'));
    $('#cul-osm-kinds').innerHTML = [['', 'Mind', state.osm.length], ...kinds.map((k) => [k, k, state.osm.filter((o) => o.kind === k).length])]
      .map(([k, l, n]) => `<button type="button" class="chip${state.osmKind === k ? ' is-on' : ''}" data-osm-kind="${esc(k)}" aria-pressed="${state.osmKind === k}">${esc(l)} <span class="chip__n">${n}</span></button>`).join('');
    $('#cul-osm-list').innerHTML = list.length ? list.map((o) => `
      <li><button type="button" data-osm="${esc(o.id)}" aria-current="${o.id === state.osmId}">
        <span class="glyph glyph--venue" aria-hidden="true"></span>
        <span class="rtitle">${esc(osmLabel(o))}</span>
        <span class="rcount">${esc(o.kind)}</span>
      </button></li>`).join('') : `<li class="empty">${osmData ? 'Nincs ilyen típusú intézmény.' : 'Az OpenStreetMap-réteget nem sikerült betölteni.'}</li>`;
    if (osmData) $('#cul-osm-src').textContent = `OpenStreetMap közreműködők (ODbL), az adatok állapota: ${String(osmData.meta?.osmBase || '').slice(0, 10)}. ${state.osm.length} intézményből ${bldOf.size} színezett épület, a többi pont. Az O épülettől mért távolság szerint rendezve.`;
    markDup(); paintVenues(); render();
  }
  // an OSM venue that is also on the open scale tab keeps its colour but drops its tag (the numbered pin names it)
  function markDup() {
    const dup = new Set(state.showVenues ? inScale(venueView.scale).map((ve) => ve.osm).filter(Boolean) : []);
    for (const el of osmBox.children) el.classList.toggle('is-dup', dup.has(el.dataset.osm));
  }
  function selectOsm(o, fly = false) {
    state.selId = null; state.mode = null; state.osmId = o ? o.id : null;
    if (o) clearVenue();
    refresh({ form: true }); renderOsm(); renderVPins();
    if (o && fly) flyTo(osmAnchor(o));
  }

  // ---- event venues by scale (js/culture-venues.js: tabs + list under the map; here the pins and the panel)
  // anchor: the OSM building's roof when the venue is one (first site), else 10 m above the terrain
  function vAnchor(ve, st) {
    const o = ve.osm && st === ve.sites[0] && osmById.get(ve.osm);
    return o && bldOf.has(o.id) ? osmAnchor(o) : P3(st.x, st.y, tz(st.x, st.y) + 10);
  }
  function renderVPins() {
    vpinsBox.className = `pins pins--venues scale--${venueView.scale}`;
    vpinsBox.hidden = !state.showVenues;
    vpinsBox.innerHTML = inScale(venueView.scale).flatMap((ve, i) => ve.sites.map((st, k) => `
      <button type="button" class="vpin${ve.id === venueView.id ? ' is-on' : ''}" data-vpin="${esc(ve.id)}" data-site="${k}" title="${esc(ve.name)}${st.name ? ' · ' + esc(st.name) : ''}">
        <span class="vpin__label"><span class="vpin__n">${i + 1}</span><span class="vpin__text">${esc(ve.name)}${st.name && ve.sites.length > 1 ? ' – ' + esc(st.name) : ''}</span></span></button>`)).join('');
    markDup(); render();
  }
  // frame a set of sites: one = fly to it, several = fit them all (with a margin)
  function frameSites(sites) {
    if (sites.length === 1) { const ve = [...venueById.values()].find((x) => x.sites.includes(sites[0])); flyTo(vAnchor(ve, sites[0]), 700); return; }
    const xs = sites.map((s) => s.x), ys = sites.map((s) => s.y);
    const m = 250 + 0.3 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    frame([Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m]);
  }

  // ---- places
  const store = await openPlaces();
  let editable = !!store.editable;
  const sel = () => byId.get(state.selId) || null;
  const anchor = (p) => P3(p.position[0], p.position[1], (p.z ?? tz(p.position[0], p.position[1]) - FFL) + FFL);
  const placed = (p) => !!p.position;
  function renderPins() {
    pinsBox.innerHTML = state.places.filter(placed).map((p) => `
      <button type="button" class="pin${p.id === state.selId ? ' is-on' : ''}" data-place="${esc(p.id)}" title="${esc(p.title || p.id)}">
        <span class="pin__label">${esc(p.title || p.id)}</span></button>`).join('');
    render();
  }
  const mediaTag = (im, cls = '') => {
    const url = imageUrl(im);
    if (/\.pdf($|\?)/i.test(im.name || url) || im.pdf) return `<a class="pdf ${cls}" href="${esc(url)}" target="_blank" rel="noopener">PDF · ${esc(im.name || 'dokumentum')}</a>`;
    return `<img class="${cls}" src="${esc(url)}" alt="${esc(im.caption || im.name || '')}" loading="lazy" decoding="async">`;
  };
  const thumbs = (p) => (p.images.length > 1
    ? `<div class="thumbs">${p.images.map((im, i) => `<button type="button" data-cul-view="${i}" aria-label="${i + 1}. fotó">${mediaTag(im, 'thumb')}</button>`).join('')}</div>` : '');
  function renderList() {   // the panel's "Helyek" list was removed (user, 2026-10-08); kept for an editor page that has it
    if (!$('#cul-list')) return;
    const list = state.places.slice().sort((a, b) => a.id.localeCompare(b.id));
    $('#cul-count').textContent = String(list.length);
    $('#cul-list').innerHTML = list.length ? list.map((p) => `
      <li><button type="button" data-place="${esc(p.id)}" aria-current="${p.id === state.selId}">
        <span class="glyph glyph--place" aria-hidden="true"></span>
        <span class="rid">${esc(p.id)}</span>
        <span class="rtitle">${esc(p.title || 'Cím nélkül')}${placed(p) ? '' : ' · nincs elhelyezve'}</span>
        <span class="rcount" title="Fotók">${p.images.length || ''}</span>
      </button></li>`).join('')
      : `<li class="empty">${editable ? 'Még nincs hely. Adj hozzá egyet fent, majd kattints a térképen oda, ahol van.' : 'Még nincs hely.'}</li>`;
  }
  function renderCards() {
    const list = state.places.slice().sort((a, b) => a.id.localeCompare(b.id));
    $('#cul-gallery').innerHTML = list.length ? list.map((p) => {
      const first = p.images[0];
      return `
      <li><button type="button" class="card" data-place-card="${esc(p.id)}" aria-current="${p.id === state.selId}">
        <span class="card__img${first ? '' : ' placeholder'}">${first ? mediaTag(first) : `<span class="gallery__wait">${esc(p.id)} · a fotó később jön</span>`}
          ${p.images.length > 1 ? `<span class="card__tags"><span>${p.images.length} fotó</span></span>` : ''}</span>
        <span class="card__meta"><span class="glyph glyph--place" aria-hidden="true"></span><span class="rid">${esc(p.id)}</span><span>${esc(p.category)}</span></span>
        <span class="card__title">${esc(p.title || 'Cím nélkül')}</span>
        ${p.note ? `<span class="card__sub">${esc(p.note.length > 140 ? p.note.slice(0, 137) + '…' : p.note)}</span>` : ''}
      </button></li>`;
    }).join('') : '<li class="gallery__empty">Még nincs hely.</li>';
  }
  function renderDetail(force = false) {
    const box = $('#cul-detail');
    const showing = state.selId || (state.osmId ? 'osm:' + state.osmId : '') || (venueView.id ? 'ev:' + venueView.id : '');
    if (!force && box.contains(document.activeElement) && box.dataset.showing === showing) return;
    box.dataset.showing = showing;
    const p = sel(), o = !p && osmById.get(state.osmId), ve = !p && !o && venueById.get(venueView.id);
    if (ve) {   // an event venue from the team's list (js/culture-venues.js)
      const scales = ve.scales.map((s) => SCALES.find((x) => x.id === s));
      const rows = [['Típus', ve.kind], ['Kinek', ve.who], ['Mikor', [...new Set(scales.map((x) => x.when.toLowerCase()))].join(', ')], ['Cím', ve.addr]].filter((r) => r[1]);
      box.innerHTML = `
        <p class="label">${esc(scales.map((x) => x.tab).join(' és ').toLowerCase().replace(/^./, (c) => c.toUpperCase()))} esemény-helyszín</p>
        ${ve.images?.length ? `<figure><button type="button" class="figbtn" data-vphoto="0"><img src="${esc(photoUrl(ve.images[0]))}" alt="${esc(ve.name)}" loading="lazy" decoding="async"></button></figure>
        ${ve.images.length > 1 ? `<div class="thumbs">${ve.images.map((f, i) => `<button type="button" data-vphoto="${i}" aria-label="${i + 1}. fotó"><img class="thumb" src="${esc(photoUrl(f))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''}` : ''}
        <h3>${esc(ve.name)}</h3>
        ${ve.parts ? `<p class="meta"><span>${esc(ve.parts)}</span></p>` : ''}
        <p class="note">${esc(ve.desc)}</p>
        <dl class="osm-kv">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('')}</dl>
        <ul class="vsites">${ve.sites.map((st) => `<li>${st.name ? `${esc(st.name)} · ` : ''}az O épülettől ${km(st.x, st.y)} · <a href="${esc(st.maps)}" target="_blank" rel="noopener">Google Térkép ↗</a></li>`).join('')}</ul>
        <div class="row"><button type="button" class="btn btn--quiet" data-vfly>Mutasd a térképen</button></div>
        <p class="hint">A csapat listájából (események és helyszínek léptékek szerint, a térkép alatt).</p>`;
      return;
    }
    if (o) {
      const rows = [['Cím', o.addr], ['Nyitvatartás', o.hours], ['Üzemeltető', o.operator], ['Akadálymentes', o.wheelchair === 'yes' ? 'igen' : o.wheelchair === 'no' ? 'nem' : o.wheelchair === 'limited' ? 'részben' : o.wheelchair]].filter((r) => r[1]);
      box.innerHTML = `
        <p class="label">${esc(o.kind)} · OpenStreetMap</p>
        <h3>${esc(osmLabel(o))}</h3>
        ${rows.length ? `<dl class="osm-kv">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('')}</dl>` : ''}
        <p class="meta"><span>az O épülettől ${Math.round(Math.hypot(o.x, o.y)).toLocaleString('hu-HU')} m-re</span></p>
        ${/^https?:\/\//.test(o.website || '') ? `<p><a href="${esc(o.website)}" target="_blank" rel="noopener">${esc(o.website.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 60))} ↗</a></p>` : ''}
        <p><a href="${esc(osmUrl(o))}" target="_blank" rel="noopener">Megnyitás az openstreetmap.org-on ↗</a></p>
        <div class="row">
          <button type="button" class="btn btn--quiet" data-osm-fly>Mutasd a térképen</button>
          ${editable ? '<button type="button" class="btn" data-osm-adopt>Felvétel helyként</button>' : ''}
        </div>
        <p class="hint">Térképadat, nem a csapat bejegyzése.${editable ? ' A „Felvétel helyként” a nevét, típusát, linkjét és helyét egy új helybe másolja, amelyhez fotót és leírást adhatsz.' : ''}</p>`;
      return;
    }
    if (!p) {
      box.innerHTML = `<p class="label">Kijelölés</p><p class="hint">${editable
        ? 'Kattints egy jelölőre a hely megtekintéséhez vagy szerkesztéséhez, vagy adj hozzá új helyet fent, és kattints a térképen oda, ahol van.'
        : 'Kattints egy jelölőre a térképen vagy egy kártyára lent: megjelenik a hely, a fotói és a leírása.'}</p>`;
      return;
    }
    if (editable) { box.innerHTML = editForm(p); return; }
    const first = p.images[0];
    box.innerHTML = `
      <p class="label">${esc(p.category || 'Hely')} · ${esc(p.id)}</p>
      ${first ? `<figure><button type="button" class="figbtn" data-cul-view="0">${mediaTag(first)}</button>${first.caption ? `<figcaption>${esc(first.caption)}</figcaption>` : ''}</figure>` : ''}
      ${thumbs(p)}
      <h3>${esc(p.title || 'Cím nélkül')}</h3>
      <p class="meta">${[p.author, p.date].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('')}</p>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
      ${p.link ? `<p><a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.link.replace(/^https?:\/\//, '').slice(0, 60))} ↗</a></p>` : ''}
      ${placed(p) ? '<button type="button" class="btn btn--quiet" data-cul-fly>Mutasd a térképen</button>' : ''}`;
  }
  const cats = () => [...new Set(state.places.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hu'));
  function editForm(p) {
    return `
      <p class="label">${esc(p.id)} · szerkesztés</p>
      <div class="docs">
        ${p.images.map((im, i) => `
          <div class="doc">
            <div class="doc__img">${mediaTag(im)}</div>
            <label>Képaláírás<input type="text" data-img="${i}" value="${esc(im.caption || '')}" placeholder="${esc(im.name || '')}"></label>
            <button type="button" class="linkbtn danger" data-img-remove="${i}">Eltávolítás</button>
          </div>`).join('')}
        <label class="btn btn--quiet upload">Fotók hozzáadása<input type="file" accept="image/*,.heic,.heif,application/pdf" multiple data-add-images hidden></label>
      </div>
      <div class="form">
        <label class="wide">Cím<input type="text" data-field="title" value="${esc(p.title)}"></label>
        <label>Kategória<input type="text" data-field="category" value="${esc(p.category)}" list="cul-cats" placeholder="pl. színház, múzeum"></label>
        <label>Dátum<input type="date" data-field="date" value="${esc(p.date)}"></label>
        <label class="wide">Leírás<textarea data-field="note" rows="4">${esc(p.note)}</textarea></label>
        <label class="wide">Link<input type="url" data-field="link" value="${esc(p.link)}" placeholder="https://"></label>
        <label class="wide">Szerző<input type="text" data-field="author" value="${esc(p.author)}"></label>
      </div>
      <datalist id="cul-cats">${cats().map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="row">
        <button type="button" class="btn${state.mode === 'place' ? ' is-on' : ''}" data-cul-mode="place">${state.mode === 'place' ? 'Kattints a térképre…' : placed(p) ? 'Jelölő áthelyezése' : 'Elhelyezés a térképen'}</button>
        ${placed(p) ? '<button type="button" class="btn btn--quiet" data-cul-fly>Mutasd</button>' : ''}
        <button type="button" class="linkbtn danger" data-cul-delete>Hely törlése</button>
      </div>`;
  }
  function refresh({ form = false } = {}) {
    renderPins(); renderList(); renderCards(); renderDetail(form);
    if ($('#cul-lightbox').open) renderLightbox();
    stage.classList.toggle('is-placing', state.mode === 'place');
    $('#cul-tag').hidden = state.mode !== 'place';
  }
  function select(p, fly = false) {
    if (state.selId !== p?.id) state.mode = null;
    state.selId = p ? p.id : null;
    if (state.osmId) { state.osmId = null; renderOsm(); }
    if (p && venueView.id) { clearVenue(); renderVPins(); }
    refresh({ form: true });
    if (p && fly && placed(p)) flyTo(anchor(p));
  }

  // lightbox
  const lb = $('#cul-lightbox');
  function renderLightbox() {
    const p = byId.get(state.lb.id); if (!p || !p.images.length) { if (lb.open) lb.close(); return; }
    const im = p.images[state.lb.view] || p.images[0];
    $('#cul-lb-media').innerHTML = mediaTag(im);
    $('#cul-lb-kind').textContent = `${p.category || 'Hely'} ${p.id}${p.images.length > 1 ? ` · ${state.lb.view + 1}. fotó / ${p.images.length}` : ''}`;
    $('#cul-lb-title').textContent = p.title || 'Cím nélkül';
    $('#cul-lb-note').textContent = [im.caption, p.note].filter(Boolean).join(' — ');
  }
  function openLightbox(p, view = 0) { state.lb = { id: p.id, view }; renderLightbox(); if (!lb.open) lb.showModal(); }
  const stepView = (d) => { const p = byId.get(state.lb.id); if (!p) return; state.lb.view = (state.lb.view + d + p.images.length) % p.images.length; renderLightbox(); };
  $('#cul-lb-close').addEventListener('click', () => lb.close());
  $('#cul-lb-prev').addEventListener('click', () => stepView(-1));
  $('#cul-lb-next').addEventListener('click', () => stepView(1));
  lb.addEventListener('click', (ev) => { if (ev.target === lb) lb.close(); });
  lb.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowLeft') stepView(-1); if (ev.key === 'ArrowRight') stepView(1); });

  // ---- clicks: pins, list, cards, detail
  const root = $('#culture');
  root.addEventListener('click', (ev) => {
    const vp = ev.target.closest('[data-vpin]');
    if (vp) { selectVenue(vp.dataset.vpin === venueView.id ? null : vp.dataset.vpin); return; }
    if (ev.target.closest('[data-vfly]')) { const ve = venueById.get(venueView.id); if (ve) frameSites(ve.sites); return; }
    const vph = ev.target.closest('[data-vphoto]');
    if (vph && venueView.id) { openVenuePhotos(venueView.id, Number(vph.dataset.vphoto)); return; }
    const pin = ev.target.closest('[data-place]');
    if (pin) { select(byId.get(pin.dataset.place), !pin.classList.contains('pin')); return; }
    const card = ev.target.closest('[data-place-card]');
    if (card) { select(byId.get(card.dataset.placeCard), true); stage.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const view = ev.target.closest('[data-cul-view]');
    if (view && sel()) { openLightbox(sel(), Number(view.dataset.culView)); return; }
    if (ev.target.closest('[data-cul-fly]') && sel()) { flyTo(anchor(sel())); return; }
    const osmEl = ev.target.closest('[data-osm]');
    if (osmEl) { selectOsm(osmById.get(osmEl.dataset.osm), !osmEl.classList.contains('opin')); return; }
    const kind = ev.target.closest('[data-osm-kind]');
    if (kind) { state.osmKind = kind.dataset.osmKind; renderOsm(); return; }
    const o = osmById.get(state.osmId);
    if (ev.target.closest('[data-osm-fly]') && o) { flyTo(osmAnchor(o)); return; }
    if (ev.target.closest('[data-osm-adopt]') && o && editable) {
      const p = { id: nextId(), position: [o.x, o.y], title: o.name || o.kind, category: o.kind.toLowerCase(), note: '',
        link: /^https?:\/\//.test(o.website || '') ? o.website : osmUrl(o), author: '', date: new Date().toISOString().slice(0, 10), images: [], _new: true };
      state.places.push(p); byId = new Map(state.places.map((x) => [x.id, x]));
      save(p); select(p);
    }
  });
  // picking on the map: a click (not a drag) places the pin in place mode, otherwise clears the selection
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; }
    down = null;
    const p = sel();
    if (editable && p && state.mode === 'place') {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects([groups.bldMesh, groups.terrainMesh].filter((m) => m && m.parent?.visible), false)[0];
      if (!hit) return;
      p.position = [+hit.point.x.toFixed(1), +(-hit.point.z).toFixed(1)];
      p.z = +(hit.point.y / state.ex).toFixed(2);
      state.mode = null;
      save(p); refresh({ form: true });
      return;
    }
    // a click on a venue-coloured building selects that venue
    if (!state.showOsm || !state.showBld || !groups.bldMesh || !painted.size) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(groups.bldMesh, false)[0];
    const k = hit ? triBld[hit.faceIndex] : -1;
    if (painted.has(k)) {
      const o = state.osm.find((v) => bldOf.get(v.id) === k && (!state.osmKind || v.kind === state.osmKind));
      if (o) selectOsm(o);
    }
  });

  // ---- editing (home server with the editor key)
  const status = (msg, err = false) => { const el = $('#cul-status'); el.textContent = msg; el.classList.toggle('is-error', err); };
  function save(p) {
    status('Mentés…');
    const before = p.id;
    return store.save(p).then(() => {
      if (p.id !== before && state.selId === before) state.selId = p.id;
      status('Mentve'); return true;
    }).catch((e) => {
      if (e?.code === 'forbidden') { editable = false; $('#cul-editor').hidden = true; status(store.readOnlyMessage, true); refresh({ form: true }); }
      else status(`Nem sikerült menteni (${e?.code || 'hiba'}).`, true);
      return false;
    });
  }
  function nextId() {
    const n = Math.max(0, ...state.places.map((p) => parseInt(String(p.id).replace(/^\D+/, ''), 10) || 0)) + 1;
    return `C-${String(n).padStart(3, '0')}`;
  }
  if (editable) {
    $('#cul-editor').hidden = false;
    $('#cul-new').addEventListener('click', () => {
      const p = { id: nextId(), position: null, title: '', category: '', note: '', link: '', author: '', date: new Date().toISOString().slice(0, 10), images: [], _new: true };
      state.places.push(p); byId = new Map(state.places.map((x) => [x.id, x]));
      save(p);
      state.selId = p.id; state.mode = 'place';
      refresh({ form: true });
    });
    const box = $('#cul-detail');
    box.addEventListener('change', async (ev) => {
      const p = sel(); if (!p) return;
      const t = ev.target;
      if (t.dataset.addImages !== undefined) {
        const files = [...t.files]; t.value = '';
        const added = [], failed = [];
        for (const [i, f] of files.entries()) {
          status(`Feltöltés: ${i + 1} / ${files.length}…`);
          try {
            const res = await store.upload(await prepareUpload(f));
            const im = { asset: res.id, name: f.name }; if (f.type === 'application/pdf') im.pdf = true;
            added.push(im); p.images.push(im);
          } catch (e) { failed.push(e?.message && !e.code ? e.message : `${f.name}: ${e?.code || 'a feltöltés nem sikerült'}`); }
        }
        if (added.length && !(await save(p))) { p.images = p.images.filter((x) => !added.includes(x)); for (const im of added) store.deleteImage(im); }
        if (failed.length) status(failed.join(' '), true);
        refresh({ form: true });
        return;
      }
      if (t.dataset.img !== undefined) { const im = p.images[Number(t.dataset.img)]; if (im) im.caption = t.value; }
      else if (t.dataset.field) p[t.dataset.field] = t.value;
      else return;
      save(p); refresh();
    });
    box.addEventListener('click', async (ev) => {
      const p = sel(); if (!p) return;
      const m = ev.target.closest('[data-cul-mode]');
      if (m) { state.mode = state.mode === 'place' ? null : 'place'; refresh({ form: true }); return; }
      const ir = ev.target.closest('[data-img-remove]');
      if (ir) {
        if (ir.dataset.armed !== '1') { ir.dataset.armed = '1'; ir.textContent = 'Kattints újra: fotó eltávolítása'; return; }
        const [im] = p.images.splice(Number(ir.dataset.imgRemove), 1);
        save(p); store.deleteImage(im); refresh({ form: true });
        return;
      }
      const del = ev.target.closest('[data-cul-delete]');
      if (del) {
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = `Kattints újra: ${p.id} és a fotói törlése`; return; }
        await store.remove(p).catch(() => status('Nem sikerült törölni.', true));
        state.places = state.places.filter((x) => x !== p); byId = new Map(state.places.map((x) => [x.id, x]));
        state.selId = null; state.mode = null; refresh({ form: true });
      }
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.mode) { state.mode = null; refresh({ form: true }); } });
  }

  // ---- map controls
  for (const [id, view] of [['#cul-cam-campus', 'campus'], ['#cul-cam-city', 'city']]) $(id).addEventListener('click', () => frame(VIEWS[view]));
  $('#cul-cam-region').addEventListener('click', () => frame([TP.x0, TP.y0, TP.x0 + (TP.nx - 1) * TP.dx, TP.y0 + (TP.ny - 1) * TP.dx]));
  $('#cul-show-bld').addEventListener('change', (e) => { state.showBld = e.target.checked; groups.bld.visible = state.showBld; osmBox.classList.toggle('no-bld', !state.showBld); redraw(); });
  $('#cul-show-roads').addEventListener('change', (e) => { state.showRoads = e.target.checked; groups.roads.visible = state.showRoads; redraw(); });
  const osmToggle = $('#cul-show-osm');
  state.showOsm = recall('bo-cul-osm') !== '0'; osmToggle.checked = state.showOsm; osmBox.hidden = !state.showOsm;
  osmToggle.addEventListener('change', () => { state.showOsm = osmToggle.checked; osmBox.hidden = !state.showOsm; remember('bo-cul-osm', state.showOsm ? '1' : '0'); paintVenues(); });
  const evToggle = $('#cul-show-venues');
  state.showVenues = recall('bo-cul-venues') !== '0'; evToggle.checked = state.showVenues;
  evToggle.addEventListener('change', () => { state.showVenues = evToggle.checked; remember('bo-cul-venues', state.showVenues ? '1' : '0'); renderVPins(); });
  const exSel = $('#cul-exag');
  state.ex = Number(recall('bo-cul-exag')) || state.ex; exSel.value = String(state.ex);
  exSel.addEventListener('change', () => {
    const t = controls.target.clone(), ground = t.y / state.ex;
    state.ex = Number(exSel.value); remember('bo-cul-exag', String(state.ex));
    buildAll();
    const dy = ground * state.ex - t.y; controls.target.y += dy; camera.position.y += dy;
    controls.update(); redraw();
  });
  const reTheme = () => { buildAll(); redraw(); };
  new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme);

  // ---- start
  buildAll();
  resize();
  frame(VIEWS.campus);
  matchVenues();
  renderOsm();
  renderVPins();
  venueBus.addEventListener('select', (e) => {   // from the list or a pin
    if (e.detail.id) { state.selId = null; state.mode = null; if (state.osmId) { state.osmId = null; renderOsm(); } }
    refresh({ form: true }); renderVPins();
    const ve = venueById.get(e.detail.id);
    if (ve && e.detail.fly) frameSites(ve.sites);
  });
  venueBus.addEventListener('scale', (e) => {
    renderVPins();
    if (e.detail.user && state.showVenues) frameSites(inScale(venueView.scale).flatMap((ve) => ve.sites));
  });
  if (venueView.id) refresh({ form: true });   // selected in the list while the map was loading
  $('#cul-loading').hidden = true;
  store.subscribe((list) => {
    // keep local edits that the server hasn't confirmed yet (a new place before its first save returns)
    const pendingNew = state.places.filter((p) => p._new && !list.some((x) => x.id === p.id));
    state.places = list.concat(pendingNew);
    byId = new Map(state.places.map((p) => [p.id, p]));
    if (state.selId && !byId.has(state.selId)) state.selId = null;
    refresh();
  });
}
