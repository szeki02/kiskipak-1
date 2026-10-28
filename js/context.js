import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadBuildingModel } from './model.js';
import { buildAgents } from './agents.js';
import { initSurvey } from './survey.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// ---------------------------------------------------------------------------
// Site context of Building O.
// context.json uses commuter-model coordinates: x east, y north, z metres
// relative to the ground floor of Building O (built by tools/build_context.ps1).
// three.js is Y-up:  three = (x, z, -y)
// ---------------------------------------------------------------------------
const CONTEXT_URL = 'assets/context/context.json';
const AGENTS_URL = 'data/agents.json';
const YEAR = 2026;

const $ = (s) => document.querySelector(s);
const stageEl = $('#ctx-stage');
const canvas = $('#ctx-scene');
const labelsEl = $('#ctx-labels');
const northEl = $('#ctx-north');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const c2t = (x, y, z) => new THREE.Vector3(x, z, -y);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const INK = 0x22214a;   // indigo ink (mood board)
// Duotone per material family: lighting is reduced to luminance, then mapped from a shadow colour to a paper colour,
// so the model reads as a printed card model: the context on indigo → warm paper, Building O on plum → blush.
const TONES = { site: ['#2b2952', '#fbf1e4'], o: ['#4a1f3a', '#f9c4b2'] };
const glslRGB = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };   // sRGB values: applied after the output colour space conversion

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
const controls = new OrbitControls(camera, canvas);controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 12;
controls.maxDistance = 1800;

const hemi = new THREE.HemisphereLight(0xffffff, 0x8c8c8c, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SH = 345;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 2000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.25;
scene.add(sun, sun.target);

// Duotone shader: standard lighting and shadows, then the output is reduced to luminance with a gentle contrast
// curve and mapped onto the material family's two colours (TONES), regardless of light colour.
function monoMat(gray, extra = {}, { poche = false, tone = 'site' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(gray, gray, gray, THREE.SRGBColorSpace), roughness: 0.95, metalness: 0, ...extra });
  const [dark, light] = TONES[tone].map(glslRGB);
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  lum = smoothstep(0.015, 0.985, lum);
  gl_FragColor.rgb = mix(${dark}, ${light}, lum);${poche ? `\n  if (!gl_FrontFacing) gl_FragColor.rgb = mix(${dark}, ${light}, 0.05);` : ''}`
    );
  };
  m.customProgramCacheKey = () => `mono-${tone}${poche ? '-poche' : ''}`;
  return m;
}
// Building O is cut at the survey level (Ground / First); its back faces show as solid poché in the cut.
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
renderer.localClippingEnabled = true;
const cut = { clippingPlanes: [cutPlane], side: THREE.DoubleSide };
const MAT = {
  building: monoMat(0.95),
  // Building O (cut by the survey level)
  oBody: monoMat(0.95, cut, { poche: true, tone: 'o' }),
  oFrame: monoMat(0.14, cut, { poche: true, tone: 'o' }),   // window and door frames
  oCanopy: monoMat(0.38, cut, { poche: true, tone: 'o' }),
  pane: monoMat(0.75, { transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1, clippingPlanes: [cutPlane] }, { tone: 'o' }),
  context: monoMat(0.9),
  terrain: monoMat(0.82),
  skirt: monoMat(0.3, { side: THREE.DoubleSide }),
  road: monoMat(0.6, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  tree: monoMat(0.74, { flatShading: true }),
  trunk: monoMat(0.3),
};
const edgeMat = new THREE.LineBasicMaterial({ color: INK });
const contourMinor = new THREE.LineBasicMaterial({ color: 0x8a83b3, transparent: true, opacity: 0.5 });
const contourMajor = new THREE.LineBasicMaterial({ color: 0x3c3770, transparent: true, opacity: 0.75 });

const groups = {
  terrain: new THREE.Group(), contours: new THREE.Group(), roads: new THREE.Group(),
  buildings: new THREE.Group(), trees: new THREE.Group(), pitches: new THREE.Group(), fence: new THREE.Group(), furniture: new THREE.Group(), agents: new THREE.Group(), transit: new THREE.Group(), stops: new THREE.Group(),
  sunpath: new THREE.Group(), building: new THREE.Group(),
};
Object.values(groups).forEach((g) => scene.add(g));
let data = null;
let needsRender = true;
const lineMats = [];
const transitLines = [];   // { id, objects: [Line2] }
const stopLabels = [];     // { el, pos }

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------
function buildTerrain(t) {
  const { dr, rings, segments: NS, z } = t;
  const pos = new Float32Array(rings * NS * 3);
  for (let i = 0; i < rings; i++) for (let j = 0; j < NS; j++) {
    const r = i * dr, a = (2 * Math.PI * j) / NS, k = (i * NS + j) * 3;
    pos[k] = r * Math.cos(a); pos[k + 1] = z[i * NS + j] / 100; pos[k + 2] = -r * Math.sin(a);
  }
  const idx = [];
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < NS; j++) {
    const j1 = (j + 1) % NS;
    const a = i * NS + j, b = i * NS + j1, c = (i + 1) * NS + j1, d = (i + 1) * NS + j;
    idx.push(a, d, c, a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, MAT.terrain);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  groups.terrain.add(mesh);

  // skirt: the cut edge of the site model, down to a flat base
  const base = t.zmin - 6;
  const sp = [], si = [];
  const o = (rings - 1) * NS;
  for (let j = 0; j < NS; j++) {
    const k = (o + j) * 3;
    sp.push(pos[k], pos[k + 1], pos[k + 2], pos[k], base, pos[k + 2]);
  }
  for (let j = 0; j < NS; j++) {
    const j1 = (j + 1) % NS;
    si.push(2 * j, 2 * j + 1, 2 * j1 + 1, 2 * j, 2 * j1 + 1, 2 * j1);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setIndex(si);
  sg.computeVertexNormals();
  groups.terrain.add(new THREE.Mesh(sg, MAT.skirt));
  const rim = [];
  for (let j = 0; j <= NS; j++) { const k = (o + (j % NS)) * 3; rim.push(pos[k], pos[k + 1] + 0.05, pos[k + 2]); }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
  groups.terrain.add(new THREE.Line(rg, edgeMat));
}

function buildContours(levels) {
  for (const major of [false, true]) {
    const pos = [];
    for (const L of levels) {
      if (L.major !== major) continue;
      const y = L.z + 0.08;
      for (let k = 0; k < L.seg.length; k += 4) pos.push(L.seg[k], y, -L.seg[k + 1], L.seg[k + 2], y, -L.seg[k + 3]);
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    groups.contours.add(new THREE.LineSegments(g, major ? contourMajor : contourMinor));
  }
}

function ribbon(p, width, lift) {
  const n = p.length / 3;
  if (n < 2) return null;
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = p[b * 3] - p[a * 3], ty = p[b * 3 + 1] - p[a * 3 + 1];
    const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    const nx = -ty * width / 2, ny = tx * width / 2;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2] + lift;
    pos.push(x + nx, z, -(y + ny), x - nx, z, -(y - ny));
    if (i < n - 1) { const k = 2 * i; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Roads as 6 m ribbons; walkways (marked in the Rhino file) at their own, narrower width.
function buildRoads(roads, walkways = []) {
  const add = (geos, mat) => {
    if (!geos.length) return;
    const g = mergeGeometries(geos);
    g.computeVertexNormals();
    // ribbons are built in either direction; make every normal point up
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    groups.roads.add(m);
  };
  MAT.road.side = THREE.DoubleSide;
  add(roads.map((p) => ribbon(p, 6, 0.0)).filter(Boolean), MAT.road);
  // footways sit a kerb above the road (Street View: +0.14 m), with their edges as vertical faces
  const walkMat = monoMat(0.74, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  add(walkways.map((w) => raisedRibbon(w.p, w.width, 0.14, 0.35)).filter(Boolean), walkMat);
}

// ribbon lifted by `lift` with its two long edges dropped `drop` below the centre line
function raisedRibbon(p, width, lift, drop) {
  const top = ribbon(p, width, lift);
  if (!top) return null;
  const t = top.attributes.position.array, n = t.length / 6, pos = Array.from(t), idx = Array.from(top.index.array);
  for (let i = 0; i < n; i++) for (let e = 0; e < 2; e++) pos.push(t[i * 6 + e * 3], t[i * 6 + e * 3 + 1] - lift - drop, t[i * 6 + e * 3 + 2]);
  const b = 2 * n;   // bottom copy of vertex k is b + k
  for (let i = 0; i < n - 1; i++) for (let e = 0; e < 2; e++) {
    const a0 = 2 * i + e, a1 = 2 * (i + 1) + e;
    idx.push(a0, b + a0, b + a1, a0, b + a1, a1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Street cross-sections measured on Street View (tools/street_model.py): kerbs, raised grass verges and sidewalks,
// the garden walls of the houses opposite. Meshes come in site coordinates with absolute heights.
function buildStreet(street) {
  if (!street?.meshes?.length) return;
  const off = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  const mats = {
    // lawn verges close to the ground tone, block paving light, asphalt walks like the shared path
    kerb: monoMat(0.96, off), verge: monoMat(0.79, off), paving: monoMat(0.88, off), 'asphalt-walk': monoMat(0.7, off),
    wall: monoMat(0.66, { side: THREE.DoubleSide }), 'mesh-fence': monoMat(0.25, { side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false }),
    // drainage trench by building N: concrete channel, stone-lined slope, shrubs on the bank
    concrete: monoMat(0.86, { side: THREE.DoubleSide }), stone: monoMat(0.5, { side: THREE.DoubleSide }), hedge: monoMat(0.5, { flatShading: true }),
  };
  const by = {}, sunk = [];
  for (const m of street.meshes) {
    const g = meshGeometry(m.mesh).toNonIndexed();
    (by[m.kind] ||= []).push(g);
    if (m.group === 'trench') sunk.push(g);
  }
  for (const [kind, geos] of Object.entries(by)) {
    const g = mergeGeometries(geos);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mats[kind] || mats.paving);
    mesh.receiveShadow = true; mesh.castShadow = kind === 'wall' || kind === 'kerb' || kind === 'hedge';
    if (kind === 'mesh-fence') mesh.renderOrder = 2;
    groups.roads.add(mesh);
  }
  // the trench lies below the (coarse) terrain: drawn first into the stencil buffer, it cuts the ground away where it shows
  if (sunk.length) {
    const mask = new THREE.Mesh(mergeGeometries(sunk), new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }));
    mask.renderOrder = -10;
    groups.roads.add(mask);
    for (const mat of [MAT.terrain, MAT.skirt]) Object.assign(mat, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilWriteMask: 0 });
  }
}

// Trees: crown as a low-poly ellipsoid, trunk as a thin prism. Tree height and
// crown radius come from the canopy height map (see build_context.ps1).
function treeShape(h, r, cb) {
  // broadleaf habit: crown starts at ~18% of the height (1.8-5 m) and fills the rest;
  // trees reshaped in the Rhino file give their own crown base (cb, metres above ground)
  const base = cb >= 0 ? cb : Math.min(5, Math.max(1.8, 0.18 * h));
  const rv = (h - base) / 2;                         // vertical crown radius
  return { rv, crownY: base + rv, trunkH: base + rv * 0.6 };
}
// t: canopy-map trees [x, y, z, h, r, ...]; edited: trees reshaped in Rhino or surveyed on Street View
// [x, y, z, h, r, crownBase, ...]; kinds: shape per edited tree (0 broadleaf, 1 columnar poplar, 2 conifer)
function buildTrees(t, edited = [], kinds = []) {
  const list = [];
  for (let i = 0; i < t.length; i += 5) list.push([...t.slice(i, i + 5), -1, 0]);
  for (let i = 0; i < edited.length; i += 6) list.push([...edited.slice(i, i + 6), kinds[i / 6] || 0]);
  if (!list.length) return;
  // crown shapes, unit size: broadleaf ellipsoid (centred), columnar spindle and conifer cone (base at 0, top at 1)
  const spindle = new THREE.LatheGeometry([[0, 0], [0.55, 0.06], [0.9, 0.22], [1, 0.42], [0.8, 0.7], [0.42, 0.9], [0, 1]].map(([a, b]) => new THREE.Vector2(a, b)), 8);
  const cone = new THREE.ConeGeometry(1, 1, 8); cone.translate(0, 0.5, 0);
  const shapes = [new THREE.IcosahedronGeometry(1, 1), spindle, cone];
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, list.length);
  shapes.forEach((geo, kind) => {
    const mine = list.map((v, i) => [v, i]).filter(([v]) => v[6] === kind);
    if (!mine.length) return;
    const crowns = new THREE.InstancedMesh(geo, MAT.tree, mine.length);
    mine.forEach(([[x, y, z, h, r, cb], i], k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.399) % (2 * Math.PI));
      if (kind === 0) {
        const { rv, crownY, trunkH } = treeShape(h, r, cb);
        crowns.setMatrixAt(k, m.compose(p.set(x, z + crownY, -y), q, s.set(r, rv, r)));
        trunks.setMatrixAt(i, m.compose(p.set(x, z, -y), q, s.set(1, trunkH, 1)));
      } else {
        const base = cb >= 0 ? cb : kind === 1 ? 1.2 : 0.3;
        crowns.setMatrixAt(k, m.compose(p.set(x, z + base, -y), q, s.set(r, h - base, r)));
        trunks.setMatrixAt(i, m.compose(p.set(x, z, -y), q, s.set(kind === 2 ? 0.6 : 1, base + (h - base) * 0.3, kind === 2 ? 0.6 : 1)));
      }
    });
    crowns.castShadow = true; crowns.receiveShadow = true; groups.trees.add(crowns);
  });
  trunks.castShadow = true; trunks.receiveShadow = true; groups.trees.add(trunks);
}

// Pitches drawn in the Rhino file (tools/site_additions.json). Markings and goals
// follow the same rules as tools/rhino_site_lib.py (pitch_lines, pitch_spots, add_pitches).
const PITCH_MARGIN = 1.5;
function pitchLines(L, W) {
  const HL = L / 2, HW = W / 2, pr = Math.min(6, HW - 1), cr = Math.min(3, HW * 0.4);
  const lines = [[[-HL, -HW], [HL, -HW], [HL, HW], [-HL, HW], [-HL, -HW]], [[0, -HW], [0, HW]]];
  lines.push(Array.from({ length: 49 }, (_, k) => [cr * Math.cos((2 * Math.PI * k) / 48), cr * Math.sin((2 * Math.PI * k) / 48)]));
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) { const t = (Math.PI / 2) * k / 12; pts.push([s * (HL - pr * Math.sin(t)), -1.5 - pr * Math.cos(t)]); }
    for (let k = 0; k <= 12; k++) { const t = (Math.PI / 2) * k / 12; pts.push([s * (HL - pr * Math.cos(t)), 1.5 + pr * Math.sin(t)]); }
    lines.push(pts);
  }
  return lines;
}
const pitchSpots = (L) => [[0, 0], [-(L / 2 - 6), 0], [L / 2 - 6, 0], [-(L / 2 - 10), 0], [L / 2 - 10, 0]];

function buildPitches(list) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const surfMat = monoMat(0.5, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const p of list) {
    const g = new THREE.Group();
    g.position.set(p.cx, p.z, -p.cy);
    g.rotation.y = THREE.MathUtils.degToRad(p.angleDeg);
    const L = p.length, W = p.width;
    // local point (u along length, v across, h up) -> three
    const P = (u, v, h = 0) => new THREE.Vector3(u, h, -v);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(L + 2 * PITCH_MARGIN, W + 2 * PITCH_MARGIN).rotateX(-Math.PI / 2), surfMat);
    surf.position.y = 0.02;
    surf.receiveShadow = true;
    g.add(surf);
    const pos = [], w = 0.04;
    const quad = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * w, ny = (dx / l) * w;
      const q = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]].map(([u, v]) => P(u, v, 0.04));
      pos.push(...q[0].toArray(), ...q[2].toArray(), ...q[1].toArray(), ...q[0].toArray(), ...q[3].toArray(), ...q[2].toArray());
    };
    for (const ln of pitchLines(L, W)) for (let k = 0; k < ln.length - 1; k++) quad(ln[k], ln[k + 1]);
    for (const [u, v] of pitchSpots(L)) for (let k = 0; k < 12; k++) {
      const a0 = (2 * Math.PI * k) / 12, a1 = (2 * Math.PI * (k + 1)) / 12;
      pos.push(...P(u, v, 0.04).toArray(), ...P(u + 0.1 * Math.cos(a0), v + 0.1 * Math.sin(a0), 0.04).toArray(), ...P(u + 0.1 * Math.cos(a1), v + 0.1 * Math.sin(a1), 0.04).toArray());
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const marks = new THREE.Mesh(lg, white);
    marks.material.side = THREE.DoubleSide;
    g.add(marks);
    // goals: posts, crossbar and a back frame 0.8 m deep
    const gw = p.goalWidth, gh = p.goalHeight, depth = 0.8;
    const bar = (a, b) => {
      const d = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, d.length(), 8), MAT.building);
      m.position.copy(a).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      m.castShadow = true;
      g.add(m);
    };
    for (const s of [-1, 1]) {
      const u0 = (s * L) / 2, u1 = s * (L / 2 + depth);
      for (const v of [-gw / 2, gw / 2]) {
        bar(P(u0, v, 0), P(u0, v, gh));
        bar(P(u1, v, 0), P(u1, v, gh * 0.75));
        bar(P(u0, v, gh), P(u1, v, gh * 0.75));
      }
      bar(P(u0, -gw / 2, gh), P(u0, gw / 2, gh));
      bar(P(u1, -gw / 2, gh * 0.75), P(u1, gw / 2, gh * 0.75));
    }
    groups.pitches.add(g);
    if (p.net) buildNet(p);
    const el = document.createElement('div');
    el.className = 'stop-label';
    el.textContent = `${({ 'Football pitch': 'Focipálya' })[p.name] || p.name} · ${dec(L)} × ${dec(W)} m`;
    labelsEl.appendChild(el);
    stopLabels.push({ el, pos: c2t(p.cx, p.cy, p.z + 3.5), group: groups.pitches });
  }
}

// Ball-stop net on the poles drawn in the Rhino file (rhino_site_lib.add_pitch_net):
// netting from the ground to the pole tops between consecutive poles, plus a top cable.
let netTexture = null;
function buildNet(p) {
  const n = p.net, z0 = p.z, H = n.height, poles = n.poles, cell = n.mesh || 0.1;
  if (!netTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 32, 2);
    ctx.fillRect(0, 0, 2, 32);
    netTexture = new THREE.CanvasTexture(c);
    netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  const netMat = new THREE.MeshBasicMaterial({ color: 0x2b2952, map: netTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const poleMat = monoMat(0.3);
  const bays = n.closed === false ? poles.length - 1 : poles.length;
  const top = [];
  for (let k = 0; k < poles.length; k++) {
    const [x, y] = poles[k];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(n.poleDiameter / 2, n.poleDiameter / 2, H, 8), poleMat);
    pole.position.set(x, z0 + H / 2, -y);
    pole.castShadow = true;
    groups.pitches.add(pole);
    top.push(new THREE.Vector3(x, z0 + H, -y));
    if (k >= bays) continue;
    const [bx, by] = poles[(k + 1) % poles.length];
    const L = Math.hypot(bx - x, by - y);
    const tex = netTexture.clone();
    tex.repeat.set(L / cell, H / cell);
    tex.needsUpdate = true;
    const mat = netMat.clone();
    mat.map = tex;
    const bay = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat);
    bay.position.set((x + bx) / 2, z0 + H / 2, -(y + by) / 2);
    bay.rotation.y = Math.atan2(by - y, bx - x);
    bay.renderOrder = 2;
    groups.pitches.add(bay);
  }
  if (n.closed !== false) top.push(top[0].clone());
  groups.pitches.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(top), new THREE.LineBasicMaterial({ color: INK })));
}

// Urban furniture modelled in the Rhino file (rhino_site_lib.export_site_furniture): one group per
// sublayer of 05_LANDSCAPE::Urban furniture; loose objects come as one mesh, blocks as part + 4x4 matrix.
const SITE_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
function buildFurniture(f) {
  if (!f?.groups?.length) return;
  // grey values per sublayer of 05_LANDSCAPE: timber light, black planters and bins dark; parked cars light / dark
  const tone = [[/cars \(dark\)/i, 0.24], [/cars \(light\)/i, 0.86], [/pallet/i, 0.8],[/bench/i, 0.62], [/raised bed/i, 0.66], [/planter/i, 0.22], [/sapling/i, 0.74], [/slab|paving/i, 0.85], [/marking|crossing/i, 0.96]];
  const mat = (name) => monoMat((tone.find(([re]) => re.test(name)) || [null, 0.45])[1]);
  const siteGeo = (m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.v, 3));
    g.setIndex(m.f);
    return g;
  };
  for (const grp of f.groups) {
    const geos = [];
    if (grp.mesh) geos.push(siteGeo(grp.mesh));
    for (const it of grp.instances || []) {
      const part = f.parts?.[it.part];
      if (!part) continue;
      geos.push(siteGeo(part).applyMatrix4(new THREE.Matrix4().set(...it.m)));
    }
    if (!geos.length) continue;
    const g = mergeGeometries(geos.map((x) => x.toNonIndexed()));
    g.applyMatrix4(SITE_TO_THREE);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat(grp.name));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.name = grp.name;
    groups.furniture.add(mesh);
  }
}

// {v: [x, y, z, ...] site coordinates, f: [i, j, k, ...]} -> indexed three geometry
function meshGeometry(m) {
  const pos = new Float32Array(m.v.length);
  for (let i = 0; i < m.v.length; i += 3) { pos[i] = m.v[i]; pos[i + 1] = m.v[i + 2]; pos[i + 2] = -m.v[i + 1]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(m.f);
  return g;
}

// Car parks seen in the site photos (site_refinements.json), draped on the terrain.
function buildSurfaces(list) {
  const mats = {
    asphalt: monoMat(0.42, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    pavers: monoMat(0.68, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    concrete: monoMat(0.88, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  for (const s of list) {
    const g = meshGeometry(s.mesh);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats[s.kind] || mats.asphalt);
    m.receiveShadow = true;
    groups.roads.add(m);
  }
}

// Concrete panel fence along the campus border, laid out in the Rhino file (site_additions.json).
// Each module: post at its start + stacked panels, scaled along x to the chord; some have 4 panels.
// Stretches listed in f.styles (Street View) are a stone plinth with stone pillars and iron railings instead.
function buildFence(f) {
  if (!f || !f.modules?.length) return;
  const concrete = monoMat(0.8);
  const postGeo = meshGeometry(f.parts.post); postGeo.computeVertexNormals();
  const panelGeos = f.parts.panels.map((p) => { const g = meshGeometry(p); g.computeVertexNormals(); return g; });
  const ranges = (f.styles?.ranges || []).filter((r) => r.kind === 'railing');
  const isRail = (i) => ranges.some((r) => i >= r.from && i <= r.to);
  const all0 = f.modules.map(([i, x, y, z, ang, sx, panels, sp, ep]) => ({ i, x, y, z, a: THREE.MathUtils.degToRad(ang), sx, panels, sp, ep }));
  const mods = all0.filter((m) => !isRail(m.i));
  const rails = all0.filter((m) => isRail(m.i));
  const posts = [];
  for (const m of mods) {
    if (m.sp) posts.push([m.x, m.y, m.z, m.a]);
    if (m.ep) { const L = m.sx * f.pitch; posts.push([m.x + L * Math.cos(m.a), m.y + L * Math.sin(m.a), m.z, m.a]); }
  }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (x, y, z, a, sx) => M.compose(p.set(x, z, -y), q.setFromAxisAngle(up, a), s.set(sx, 1, 1));
  const pm = new THREE.InstancedMesh(postGeo, concrete, posts.length);
  posts.forEach(([x, y, z, a], k) => pm.setMatrixAt(k, place(x, y, z, a, 1)));
  const all = [pm];
  panelGeos.forEach((g, level) => {
    const list = mods.filter((m) => m.panels > level);
    const im = new THREE.InstancedMesh(g, concrete, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, place(m.x, m.y, m.z, m.a, m.sx)));
    all.push(im);
  });
  if (rails.length) {
    // one railing module in its local frame (x along the chord, three y up): plinth, pillar at the start,
    // top and bottom rails, vertical bars; scaled along x like the panels
    const R = f.styles.railing || {}, [ph, pw] = R.plinth || [0.4, 0.38], [qw, qh] = R.pillar || [0.46, 1.9];
    const [r0, r1] = R.rails || [0.55, 1.6], gap = R.bar || 0.13, P = f.pitch;
    const box = (w, h, d, x, y) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0);
    const bars = [box(P, 0.04, 0.04, P / 2, r0), box(P, 0.05, 0.05, P / 2, r1)];
    for (let x = qw / 2 + gap; x < P - qw / 2; x += gap) bars.push(box(0.022, r1 - r0, 0.022, x, (r0 + r1) / 2));
    const stoneGeo = mergeGeometries([box(P, ph, pw, P / 2, ph / 2), box(qw, qh, qw, 0, qh / 2)]);
    const ironGeo = mergeGeometries(bars);
    for (const [g, mat] of [[stoneGeo, monoMat(0.66)], [ironGeo, monoMat(0.18)]]) {
      const im = new THREE.InstancedMesh(g, mat, rails.length);
      rails.forEach((m, k) => im.setMatrixAt(k, place(m.x, m.y, m.z, m.a, m.sx)));
      im.castShadow = true; im.receiveShadow = true; groups.fence.add(im);
    }
    const ends = rails.filter((m) => m.ep || !isRail(m.i + 1));   // closing pillar where a railing stretch ends
    const pe = new THREE.InstancedMesh(box(qw, qh, qw, 0, qh / 2), monoMat(0.66), ends.length);
    ends.forEach((m, k) => { const L = m.sx * f.pitch; pe.setMatrixAt(k, place(m.x + L * Math.cos(m.a), m.y + L * Math.sin(m.a), m.z, m.a, 1)); });
    pe.castShadow = true; groups.fence.add(pe);
  }
  for (const im of all) { im.castShadow = true; im.receiveShadow = true; groups.fence.add(im); }
}

let buildingRanges = [];   // [firstVertex, building] for hover lookup in the merged mesh
let buildingMesh = null;
function buildContextBuildings(list) {
  const geos = [];
  let v = 0;
  for (const b of list) {
    let g;
    if (b.mesh) {
      // refined from site photos (split masses, gabled roofs): explicit mesh from build_context.ps1
      g = meshGeometry(b.mesh).toNonIndexed();
      g.computeVertexNormals();
    } else {
      const pts = [];
      for (let k = 0; k < b.p.length; k += 2) pts.push(new THREE.Vector2(b.p[k], b.p[k + 1]));
      g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: b.t - b.b, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, b.b, 0);
      g.deleteAttribute('uv');
      g.clearGroups();
    }
    buildingRanges.push([v, b]);
    v += g.attributes.position.count;
    geos.push(g);
  }
  const g = mergeGeometries(geos);
  const m = new THREE.Mesh(g, MAT.context);
  buildingMesh = m;
  m.castShadow = true; m.receiveShadow = true;
  groups.buildings.add(m);
  groups.buildings.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat));
  // landmark labels (site_refinements.json "label"), styled like Building O's
  for (const b of list.filter((x) => x.label)) {
    let sx = 0, sy = 0; const n = b.p.length / 2;
    for (let i = 0; i < b.p.length; i += 2) { sx += b.p[i]; sy += b.p[i + 1]; }
    const el = document.createElement('div');
    el.className = 'stop-label stop-label--site';
    el.textContent = b.label;
    labelsEl.appendChild(el);
    stopLabels.push({ el, pos: c2t(sx / n, sy / n, b.t + 3), group: groups.buildings });
  }
}

function buildTransit(lines) {
  for (const ln of lines) {
    let color = ln.color || '#888888';
    const unnamed = /^#?0{6}$/.test(color.replace('#', '').padStart(6, '0'));
    if (unnamed) color = '#555555';
    const mat = new LineMaterial({ color: new THREE.Color(color), linewidth: 3.5, transparent: true, dashed: unnamed, dashSize: 6, gapSize: 4 });
    lineMats.push(mat);
    const objects = [];
    for (const p of ln.paths) {
      const arr = [];
      for (let k = 0; k < p.length; k += 3) arr.push(p[k], p[k + 2], -p[k + 1]);
      if (arr.length < 6) continue;
      const g = new LineGeometry();
      g.setPositions(arr);
      const line = new Line2(g, mat);
      if (unnamed) line.computeLineDistances();
      groups.transit.add(line);
      objects.push(line);
    }
    transitLines.push({ id: ln.id, mat, objects });
  }
}

function buildStops(stops) {
  const outer = new THREE.CylinderGeometry(3.2, 3.2, 0.6, 28);
  const inner = new THREE.CylinderGeometry(2.0, 2.0, 0.7, 28);
  const black = new THREE.MeshBasicMaterial({ color: INK });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of stops) {
    const p = c2t(s.x, s.y, s.z + 0.8);
    const a = new THREE.Mesh(outer, black); a.position.copy(p);
    const b = new THREE.Mesh(inner, white); b.position.copy(p);
    groups.stops.add(a, b);
    const el = document.createElement('div');
    el.className = 'stop-label';
    el.innerHTML = `<b>${esc(s.lines.join(' · '))}</b> ${esc(s.name)}`;
    labelsEl.appendChild(el);
    stopLabels.push({ el, pos: c2t(s.x, s.y, s.z + 3), group: groups.stops });
  }
  const el = document.createElement('div');
  el.className = 'stop-label stop-label--site';
  el.textContent = 'O épület';
  labelsEl.appendChild(el);
  stopLabels.push({ el, pos: c2t(0, 0, 10.5), group: groups.building });
}

async function buildBuildingO(meta) {
  const gltf = await loadBuildingModel();
  const inner = gltf.scene;
  const [cx, cy] = meta.modelCenter;
  inner.position.set(-cx, 0, cy);           // model centre to the origin
  const outer = new THREE.Group();
  outer.rotation.y = THREE.MathUtils.degToRad(meta.rotationDeg);
  outer.add(inner);
  groups.building.add(outer);
  outer.updateMatrixWorld(true);

  const edgePos = [];
  const v = new THREE.Vector3();
  inner.traverse((o) => {
    if (!o.isMesh) return;
    const ex = o.userData || {};
    if (ex.code === 'TR') { o.visible = false; return; }
    if (ex.glass) {
      // window and door panes: see-through, so the interior reads behind the facade
      o.material = MAT.pane;
      o.renderOrder = 2;
      return;
    }
    const frame = ex.code === 'WD' || ex.code === 'DOO';
    o.material = frame ? MAT.oFrame : ex.layer === 'canopy' ? MAT.oCanopy : MAT.oBody;
    o.castShadow = true;
    o.receiveShadow = true;
    if (ex.layer === 'joists') return;
    const eg = new THREE.EdgesGeometry(o.geometry, 25);
    const a = eg.attributes.position;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      edgePos.push(v.x, v.y, v.z);
    }
    eg.dispose();
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
  groups.building.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: INK, clippingPlanes: [cutPlane] })));
  return inner;
}

// ---------------------------------------------------------------------------
// Sun position (NOAA low-precision algorithm, accurate to ~0.5°)
// ---------------------------------------------------------------------------
const RAD = Math.PI / 180;
function sunPosition(date, lat, lon) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  if (az < 0) az += 2 * Math.PI;
  return { alt, az };          // az: from north, clockwise
}
// Hungary: CET (UTC+1), CEST (UTC+2) from the last Sunday of March to the last Sunday of October
function lastSunday(y, m) { const d = new Date(Date.UTC(y, m + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); }
function localToUTC(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes) - 3600000;
  const dst = guess >= lastSunday(y, 2) + 3600000 && guess < lastSunday(y, 9) + 3600000;
  return { date: new Date(Date.UTC(y, m - 1, d, 0, minutes) - (dst ? 2 : 1) * 3600000), zone: dst ? 'CEST' : 'CET' };
}
const sunVec = (alt, az) => new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const COMPASS = ['É', 'ÉÉK', 'ÉK', 'KÉK', 'K', 'KDK', 'DK', 'DDK', 'D', 'DDNy', 'DNy', 'NyDNy', 'Ny', 'NyÉNy', 'ÉNy', 'ÉÉNy'];
const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');   // Hungarian decimal comma

const sunState = { date: `${YEAR}-06-21`, minutes: 900, playing: false };
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf2b33d }));
groups.sunpath.add(sunBall);
let pathObjects = [];
const SUN_R = 300;

function rebuildSunPath() {
  pathObjects.forEach((o) => { groups.sunpath.remove(o); o.geometry.dispose(); });
  pathObjects = [];
  const pts = [], dots = [];
  for (let m = 0; m <= 1440; m += 5) {
    const { date } = localToUTC(sunState.date, m);
    const s = sunPosition(date, data.meta.lat, data.meta.lon);
    if (s.alt > -0.01) {
      const p = sunVec(Math.max(s.alt, 0), s.az).multiplyScalar(SUN_R);
      pts.push(p);
      if (m % 60 === 0) dots.push(p);
    }
  }
  if (pts.length > 1) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x6c6480, dashSize: 6, gapSize: 5 }));
    line.computeLineDistances();
    groups.sunpath.add(line);
    pathObjects.push(line);
  }
  if (dots.length) {
    const g = new THREE.BufferGeometry().setFromPoints(dots);
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: INK, size: 6, sizeAttenuation: false }));
    groups.sunpath.add(p);
    pathObjects.push(p);
  }
  // sunrise / sunset
  let rise = null, set = null, prev = null;
  for (let m = 0; m <= 1440; m += 2) {
    const a = sunPosition(localToUTC(sunState.date, m).date, data.meta.lat, data.meta.lon).alt / RAD;
    if (prev !== null) {
      if (prev < -0.833 && a >= -0.833) rise = m;
      if (prev >= -0.833 && a < -0.833) set = m;
    }
    prev = a;
  }
  sunState.rise = rise; sunState.set = set;
}

function updateSun() {
  const { date, zone } = localToUTC(sunState.date, sunState.minutes);
  const s = sunPosition(date, data.meta.lat, data.meta.lon);
  const dir = sunVec(s.alt, s.az);
  const up = s.alt > 0;
  sun.position.copy(dir).multiplyScalar(900);
  sun.target.position.set(0, 0, 0);
  // fade in over the first few degrees so dawn and dusk do not flicker
  const k = THREE.MathUtils.clamp(s.alt / (6 * RAD), 0, 1);
  sun.intensity = 2.4 * k;
  sun.visible = up;
  hemi.intensity = 0.55 + 0.45 * k;
  sunBall.position.copy(sunVec(Math.max(s.alt, 0), s.az).multiplyScalar(SUN_R));
  sunBall.visible = up;

  $('#ctx-time-out').value = hhmm(sunState.minutes);
  $('#ctx-time').value = String(sunState.minutes);
  const azDeg = s.az / RAD;
  $('#ctx-sun-tag').textContent = up
    ? `${fmtDate(sunState.date)} · ${hhmm(sunState.minutes)} ${zone} · nap ${Math.round(s.alt / RAD)}° magasan, ${COMPASS[Math.round(azDeg / 22.5) % 16]}`
    : `${fmtDate(sunState.date)} · ${hhmm(sunState.minutes)} ${zone} · a nap a horizont alatt`;
  $('#ctx-sun-data').innerHTML = `
    <dt>Magasság</dt><dd>${dec(s.alt / RAD)}°</dd>
    <dt>Azimut</dt><dd>${azDeg.toFixed(0)}° ${COMPASS[Math.round(azDeg / 22.5) % 16]}</dd>
    <dt>Napkelte</dt><dd>${sunState.rise != null ? hhmm(sunState.rise) : '–'}</dd>
    <dt>Napnyugta</dt><dd>${sunState.set != null ? hhmm(sunState.set) : '–'}</dd>`;
  needsRender = true;
}
function fmtDate(d) {
  const [, m, day] = d.split('-').map(Number);
  return `${['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'][m - 1]} ${day}.`;
}

// ---------------------------------------------------------------------------
// Camera presets
// ---------------------------------------------------------------------------
let tween = null;
const PRESETS = {
  aerial: { target: [0, 0, 0], dir: [-0.5, 0.62, 0.6], fit: 300 },
  plan: { target: [0, 0, 0], dir: [0, 1, 0.002], fit: 335 },
  close: { target: [0, 4, 0], dir: [-0.62, 0.42, 0.66], fit: 34 },
};
function goal(name) {
  const p = PRESETS[name];
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = p.fit / Math.sin(Math.min(vfov, hfov) / 2);
  const target = new THREE.Vector3(...p.target);
  return { target, position: target.clone().add(new THREE.Vector3(...p.dir).normalize().multiplyScalar(d)) };
}
function flyTo(name, instant = false) {
  const g = typeof name === 'string' ? goal(name) : name;   // a preset, or a {target, position} goal (survey levels)
  document.querySelectorAll('#ctx-cam-aerial, #ctx-cam-plan, #ctx-cam-close').forEach((b) => b.classList.toggle('is-on', b.id === `ctx-cam-${name}`));
  if (instant || reduceMotion) {
    camera.position.copy(g.position); controls.target.copy(g.target); controls.update(); needsRender = true; return;
  }
  tween = { t0: performance.now(), dur: 900, p0: camera.position.clone(), q0: controls.target.clone(), p1: g.position, q1: g.target };
}
function stepTween(now) {
  if (!tween) return false;
  const t = Math.min(1, (now - tween.t0) / tween.dur);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  camera.position.lerpVectors(tween.p0, tween.p1, e);
  controls.target.lerpVectors(tween.q0, tween.q1, e);
  if (t >= 1) tween = null;
  return true;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function renderPanel() {
  const ul = $('#ctx-lines');
  ul.innerHTML = data.transit.map((ln) => {
    let ends;
    if (ln.mode === 'coach') ends = 'Helyközi buszok (Volánbusz)';
    else {
      const set = new Set();
      for (const n of ln.names) {
        const [a, b] = n.split(/\s*[⇒=]>?\s*/);
        if (a && b) set.add([a, b].sort().join(' – '));
      }
      ends = [...set].join(' / ');
    }
    const black = /^#?0{6}$/.test(ln.color.replace('#', ''));
    const bg = black ? '#555555' : ln.color;
    return `<li data-line="${esc(ln.id)}"><span class="line-badge" style="background:${esc(bg)}">${esc(ln.ref)}</span><span class="line-ends" title="${esc(ends)}">${esc(ends)}</span></li>`;
  }).join('');
  ul.querySelectorAll('li').forEach((li) => {
    li.addEventListener('mouseenter', () => highlightLine(li.dataset.line));
    li.addEventListener('mouseleave', () => highlightLine(null));
  });

  const stops = data.stops
    .map((s) => ({ ...s, d: Math.hypot(s.x, s.y) }))
    .sort((a, b) => a.d - b.d);
  $('#ctx-stops').innerHTML = stops.map((s) => `
    <li><span>${esc(s.name)}</span><span class="dist">${Math.round(s.d / 5) * 5} m</span>
    <span class="on">Járatok: ${esc(s.lines.join(', '))} · légvonalban</span></li>`).join('');
  $('#ctx-ffl').textContent = dec(data.meta.fflAsl);
}
function highlightLine(id) {
  for (const t of transitLines) t.mat.opacity = !id || t.id === id ? 1 : 0.12;
  document.querySelectorAll('#ctx-lines li').forEach((li) => li.classList.toggle('is-hot', li.dataset.line === id));
  needsRender = true;
}

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------
$('#ctx-date').value = sunState.date;
document.querySelectorAll('#ctx-dates [data-date]').forEach((b) => b.addEventListener('click', () => setDate(`${YEAR}-${b.dataset.date}`)));
$('#ctx-date').addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });
function setDate(d) {
  sunState.date = d;
  $('#ctx-date').value = d;
  document.querySelectorAll('#ctx-dates [data-date]').forEach((b) => b.classList.toggle('is-on', d.endsWith(b.dataset.date)));
  rebuildSunPath();
  updateSun();
}
$('#ctx-time').addEventListener('input', (e) => { setPlaying(false); sunState.minutes = Number(e.target.value); updateSun(); });
$('#ctx-play').addEventListener('click', () => setPlaying(!sunState.playing));
function setPlaying(on) {
  sunState.playing = on;
  $('#ctx-play').setAttribute('aria-pressed', String(on));
  $('#ctx-play').textContent = on ? '❚❚' : '▶';
  $('#ctx-play').setAttribute('aria-label', on ? 'Szünet' : 'A nap lejátszása');
  if (on && (sunState.minutes < (sunState.rise ?? 0) || sunState.minutes >= (sunState.set ?? 1440) - 5)) sunState.minutes = sunState.rise ?? 0;
}
const toggles = { 'ctx-show-transit': ['transit', 'stops'], 'ctx-show-buildings': ['buildings'], 'ctx-show-trees': ['trees'], 'ctx-show-fence': ['fence'], 'ctx-show-furniture': ['furniture'], 'ctx-show-people': ['agents'], 'ctx-show-contours': ['contours'], 'ctx-show-sunpath': ['sunpath'] };
for (const [id, keys] of Object.entries(toggles)) {
  $(`#${id}`).addEventListener('change', (e) => { keys.forEach((k) => { groups[k].visible = e.target.checked; }); needsRender = true; });
}
$('#ctx-cam-aerial').addEventListener('click', () => flyTo('aerial'));
$('#ctx-cam-plan').addEventListener('click', () => flyTo('plan'));
$('#ctx-cam-close').addEventListener('click', () => flyTo('close'));
controls.addEventListener('change', () => { needsRender = true; });

// Hover a neighbouring building to see its ID, height and where the height comes from.
const tip = $('#ctx-tooltip');
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const SRC_LABEL = { 'osm levels': 'OSM szintszám', 'osm height': 'OSM magasság', estimated: 'becsült', survey: 'felmért', photo: 'helyszíni fotók alapján', satellite: 'tető műholdkép alapján' };
// Click: survey markers and Building O elements (a short click, not the end of a drag).
let survey = null;
let downAt = null;
canvas.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener('pointerup', (ev) => {
  if (!survey || !downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
  downAt = null;
  survey.click(ev);
});
canvas.addEventListener('pointermove', (ev) => {
  if (ev.buttons) { tip.hidden = true; return; }
  if (survey && survey.hover(ev)) return;
  if (!buildingMesh || !groups.buildings.visible) { tip.hidden = true; return; }
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(buildingMesh, false)[0];
  if (!hit) { tip.hidden = true; return; }
  const vi = hit.face.a;
  let lo = 0, hi = buildingRanges.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (buildingRanges[mid][0] <= vi) lo = mid; else hi = mid - 1; }
  const b = buildingRanges[lo][1];
  tip.textContent = `${b.name ? b.name + ' · ' : ''}${b.id} · ${dec(b.h)} m · ${SRC_LABEL[b.src] || b.src}`;
  tip.style.left = `${ev.clientX - r.left}px`;
  tip.style.top = `${ev.clientY - r.top}px`;
  tip.hidden = false;
});
canvas.addEventListener('pointerleave', () => { tip.hidden = true; });

// ---------------------------------------------------------------------------
// Theme, resize, loop
// ---------------------------------------------------------------------------
function applyTheme() {
  scene.background = new THREE.Color(cssVar('--stage') || '#dfe3e1');
  survey?.onTheme();
  needsRender = true;
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  lineMats.forEach((m) => m.resolution.set(w, h));
  needsRender = true;
}
new ResizeObserver(resize).observe(stageEl);

const tmp = new THREE.Vector3();
function placeLabels() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  for (const l of stopLabels) {
    tmp.copy(l.pos).project(camera);
    const show = l.group.visible && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    l.el.hidden = !show;
    if (show) { l.el.style.left = `${((tmp.x + 1) / 2) * w}px`; l.el.style.top = `${((1 - tmp.y) / 2) * h}px`; }
  }
  northEl.style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`;
}

// People: animated only while they are shown, the viewer is on screen and the camera is close enough to see them.
let agents = null;
let stageOnScreen = true;
new IntersectionObserver(([e]) => { stageOnScreen = e.isIntersecting; }).observe(stageEl);
function agentsLive() {
  if (!agents || !groups.agents.visible || !stageOnScreen || document.hidden || !agents.animates()) return false;
  return agents.centers.some((c) => c.distanceTo(camera.position) < 160);
}
const groundRay = new THREE.Raycaster();
function groundAt(x, y) {
  // highest ground below 2.6 m: terrain, paving, or Building O's entrance landing (under the canopy)
  groundRay.set(new THREE.Vector3(x, 2.6, -y), new THREE.Vector3(0, -1, 0));
  const hit = groundRay.intersectObjects([groups.terrain, groups.roads, groups.building], true).find((h) => h.object.isMesh);
  return hit ? hit.point.y : 0;
}

let lastPlay = 0;
renderer.setAnimationLoop((now) => {
  if (!data) return;
  if (agentsLive()) { agents.update(now); needsRender = true; }
  if (sunState.playing && now - lastPlay > 40) {
    lastPlay = now;
    sunState.minutes += 4;
    if (sunState.minutes > (sunState.set ?? 1440)) sunState.minutes = sunState.rise ?? 0;
    updateSun();
  }
  const moved = stepTween(now);
  const changed = controls.update();
  if (moved || changed || needsRender) {
    renderer.render(scene, camera);
    placeLabels();
    needsRender = false;
  }
});

// ---------------------------------------------------------------------------
// Shared with the opening page (js/hero.js): the same scene, drawn by its own renderer and camera. hero.js changes the
// lights, background, cut and group visibility only for the length of its own render call and puts them back.
// ---------------------------------------------------------------------------
let siteReady;
export const site = { scene, sun, hemi, MAT, groups, cutPlane, ready: new Promise((resolve) => { siteReady = resolve; }) };

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  resize();
  applyTheme();
  data = await fetch(CONTEXT_URL).then((r) => { if (!r.ok) throw new Error(`context.json ${r.status}`); return r.json(); });
  buildTerrain(data.terrain);
  buildContours(data.contours);
  buildRoads(data.roads, data.walkways || []);
  buildSurfaces(data.surfaces || []);
  buildStreet(data.street);
  buildContextBuildings(data.buildings);
  buildTrees(data.trees || [], data.treesEdited || [], data.treesEditedKind || []);
  buildPitches(data.pitches || []);
  buildFence(data.fence);
  buildFurniture(data.furniture);
  buildTransit(data.transit);
  buildStops(data.stops);
  const buildingO = await buildBuildingO(data.meta);
  siteReady(data.meta);
  survey = await initSurvey({
    building: buildingO, cutPlane, camera, controls, canvas, stage: stageEl, tooltip: tip,
    siteTargets: [groups.terrain, groups.roads, groups.pitches, groups.furniture],
    flyTo: (g) => flyTo(g), redraw: () => { needsRender = true; },
  });
  try {
    const people = await fetch(AGENTS_URL).then((r) => (r.ok ? r.json() : null));
    if (people) {
      groups.building.updateMatrixWorld(true);
      const mats = new Map();
      agents = buildAgents(groups.agents, people, groundAt, (g) => mats.get(g) || mats.set(g, monoMat(g)).get(g));
    }
  } catch (e) { console.warn('people not loaded', e); }
  renderPanel();
  rebuildSunPath();
  updateSun();
  flyTo('aerial', true);
  resize();
  $('#ctx-loading').hidden = true;
}
boot().catch((err) => {
  console.error(err);
  $('#ctx-loading-text').textContent = 'A telekmodellt nem sikerült betölteni. Nyisd meg az oldalt helyi webszerveren keresztül (lásd serve.ps1).';
  $('#ctx-loading .spinner')?.remove();
});
