// Topic 04: the two multi-use spaces in their layouts, animated.
//  - the multi-use room (#mu): rhino/BuildingO_multiuse.3dm -> data/multiuse.json, Building O's structure (3 x 3 bays of 5.4 m)
//  - the sports field / amphitheatre (#mf): rhino/BuildingO_sportfield.3dm -> data/sportfield.json, the pitch and its
//    surroundings cut from the site twin (ground, pitch, goals, ball-stop net, bench, tree) as light meshes
// (both exported by tools/export_scenes.py). Switching layouts, the people step out, the furniture glides to its new
// places (chairs to chairs, tables to tables; the rest folds away or unfolds), then the next crowd arrives. The people
// are the site tab's figures (js/agents.js) but stand still here (user, 2026-10-07: the moving crowds glitched the
// page): they keep the pose of the first update – turned to their group, to the speaker, or to the screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildAgents } from './agents.js';

const $ = (id) => document.getElementById(id);
const DESC = {
  // room
  default: 'Lazán szétszórt asztalok és székek: tanulás, beszélgetés, kávé a szomszédos kávézóból.',
  workshop: 'Asztalszigetek 160 × 80 cm-es asztalokból, csoportmunka; két oktató jár körbe, egy asztalon az anyagok.',
  exhibition: 'Görgős mobil falak (2,2 m, nem érnek a födémig) és 90 cm-es posztamensek; a látogatók kis csoportokban.',
  conference: 'Székek sorokban a pódium felé, 80 hely; az előadó a pulpitusnál, mögötte vetítővászon.',
  // field
  sport: 'Kispályás foci két hatfős csapattal, cserék a padon, nézők a háló mögött és a padon. Alaphasználat, 20–30 fő.',
  event: 'Koncert: 6 × 4 m-es színpad a nyugati végen (a kapu mögötte marad), hangfalak, keverőpult, állóközönség; a keleti végen sörpadok. 80–100 fő.',
  market: 'Pop-up market: két sor 3 × 3 m-es sátor, köztük sétálóutca, a keleti végen ételpultnál sörpadok. 100–150 fő.',
  seminar: 'Kültéri szeminárium: négy mobil, négysoros lelátóelem ívben az előadó körül – így lesz a pályából amfiteátrum. 120 hely.',
  cinema: 'Kültéri mozi: 8 × 4,5 m-es vászon a pálya keleti felén, előtte nyugágyak, mögöttük két lelátóelem. 30–100 fő.',
};
const COUNTS = [[['chair'], 'szék'], [['table', 'round'], 'asztal'], [['wall'], 'mobil fal'], [['plinth'], 'posztamens'],
  [['stall'], 'sátor'], [['bleacher'], 'lelátóelem'], [['deckchair'], 'nyugágy'], [['beertable'], 'sörasztal']];
const SPACES = [
  { p: 'mu', url: 'data/multiuse.json', fit: { axo: 9.0, top: 9.6 }, shadow: 14, dist: [8, 90] },
  { p: 'mf', url: 'data/sportfield.json', fit: { axo: 19.5, top: 20.5 }, shadow: 30, dist: [12, 170] },
];
const DWELL = 7.5;   // s on each layout when playing

// Duotone material, as in the site viewer (js/context.js monoMat): luminance mapped from indigo shadow to warm paper
function monoMat(gray, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(gray, gray, gray, THREE.SRGBColorSpace), roughness: 0.95, metalness: 0, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb = mix(vec3(0.1686, 0.1608, 0.3216), vec3(0.9843, 0.9451, 0.8941), smoothstep(0.015, 0.985, lum));`);
  };
  m.customProgramCacheKey = () => 'duotone';
  return m;
}
const mats = new Map();
const mat = (g) => mats.get(g) || mats.set(g, monoMat(g)).get(g);

// Geometry in the Rhino blocks' frame (x right, y = the item's front, z up) -> three (x, z, -y)
const box = (x0, y0, z0, x1, y1, z1) => new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0).translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
const post = (x, y, z0, z1, r, seg = 8) => new THREE.CylinderGeometry(r, r, z1 - z0, seg).translate(x, (z0 + z1) / 2, -y);
const ball = (x, y, z, r) => new THREE.SphereGeometry(r, 8, 6).translate(x, z, -y);
const legs4 = (dx, dy, h, r) => [-dx, dx].flatMap((x) => [-dy, dy].map((y) => post(x, y, 0, h, r, 6)));

// same pieces as the scene blocks in Rhino (tools/scene_blocks.py, multiuse_scenes.py): [[geometries], grey]
const KINDS = {
  chair: [[[box(-0.225, -0.225, 0.42, 0.225, 0.225, 0.45), box(-0.21, -0.235, 0.62, 0.21, -0.215, 0.86),
    post(-0.2, 0.2, 0, 0.42, 0.012, 6), post(0.2, 0.2, 0, 0.42, 0.012, 6), post(-0.2, -0.2, 0, 0.86, 0.012, 6), post(0.2, -0.2, 0, 0.86, 0.012, 6)], 0.55]],
  table: [[[box(-0.8, -0.4, 0.72, 0.8, 0.4, 0.75)], 0.9], [legs4(0.74, 0.34, 0.72, 0.02), 0.4]],
  round: [[[post(0, 0, 0.72, 0.75, 0.4, 28)], 0.9], [[post(0, 0, 0.02, 0.72, 0.03), post(0, 0, 0, 0.02, 0.25, 20)], 0.4]],
  wall: [[[box(-0.6, -0.03, 0.12, 0.6, 0.03, 2.2)], 0.96], [[box(-0.55, -0.12, 0.08, 0.55, 0.12, 0.12)], 0.4],
    [[-0.5, 0.5].flatMap((x) => [-0.08, 0.08].map((y) => ball(x, y, 0.04, 0.04))), 0.2]],
  plinth: [[[box(-0.2, -0.2, 0, 0.2, 0.2, 0.9)], 0.98], [[box(-0.07, -0.07, 0.9, 0.07, 0.07, 1.12)], 0.3]],
  podium: [[[box(-2.4, -1.2, 0, 2.4, 1.2, 0.4), box(2.4, -1.2, 0, 2.8, -0.5, 0.2)], 0.7]],
  lectern: [[[box(-0.3, -0.2, 0, 0.3, 0.2, 1.05), box(-0.33, -0.26, 1.05, 0.33, 0.22, 1.1)], 0.35]],
  screen: [[[box(-1.6, -0.02, 0.95, 1.6, 0.02, 2.75)], 0.99]],
  stage: [[[box(-3, -2, 0, 3, 2, 0.8), box(3, -2, 0, 3.6, -1.0, 0.4)], 0.3],
    [[box(-3.1, -2.1, 0.8, -2.8, -1.8, 5.0), box(2.8, -2.1, 0.8, 3.1, -1.8, 5.0), box(-3.1, -2.1, 4.7, 3.1, -1.8, 5.0)], 0.6]],
  speaker: [[[box(-0.3, -0.25, 0, 0.3, 0.25, 0.5), box(-0.35, -0.3, 0.5, 0.35, 0.3, 2.2)], 0.17]],
  stall: [[[box(-1.55, -1.55, 2.3, 1.55, 1.55, 2.38), new THREE.ConeGeometry(1.55 * Math.SQRT2, 0.62, 4, 1).rotateY(Math.PI / 4).translate(0, 2.69, 0)], 0.93],
    [[box(-1.2, 0.8, 0, 1.2, 1.35, 0.9)], 0.75], [[-1.45, 1.45].flatMap((x) => [-1.45, 1.45].map((y) => post(x, y, 0, 2.3, 0.03, 6))), 0.4]],
  bleacher: [[[0, 2].map((i) => box(-2, -0.8 * i - 0.4, 0, 2, -0.8 * i + 0.4, 0.45 + 0.4 * i)), 0.62], [[1, 3].map((i) => box(-2, -0.8 * i - 0.4, 0, 2, -0.8 * i + 0.4, 0.45 + 0.4 * i)), 0.68]],
  bigscreen: [[[box(-4, -0.05, 1.0, 4, 0.05, 5.5)], 0.99],
    [[-4.15, 4.15].flatMap((x) => [box(x - 0.1, -0.1, 0, x + 0.1, 0.1, 5.7), box(x - 0.1, -1.5, 0, x + 0.1, 0, 0.15)]), 0.3]],
  beertable: [[[box(-1.1, -0.25, 0.73, 1.1, 0.25, 0.76)], 0.8], [[box(-0.95, -0.2, 0, -0.85, 0.2, 0.73), box(0.85, -0.2, 0, 0.95, 0.2, 0.73)], 0.4]],
  beerbench: [[[box(-1.1, -0.125, 0.44, 1.1, 0.125, 0.47)], 0.8], [[box(-0.95, -0.1, 0, -0.85, 0.1, 0.44), box(0.85, -0.1, 0, 0.95, 0.1, 0.44)], 0.4]],
  deckchair: [[[box(-0.27, -0.2, 0.3, 0.27, 0.3, 0.35), box(-0.27, -0.05, 0, 0.27, 0, 0.75).rotateX(-0.5).translate(0, 0.33, 0.2)], 0.45],
    [[-0.25, 0.25].flatMap((x) => [post(x, 0.25, 0, 0.3, 0.012, 5), post(x, -0.27, 0, 0.32, 0.012, 5)]), 0.3]],
  ball: [[[ball(0, 0, 0.11, 0.11)], 0.95]],
};
const PARTS = Object.fromEntries(Object.entries(KINDS).map(([k, parts]) => [k, parts.map(([gs, g]) => [mergeGeometries(gs), mat(g)])]));

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const started = {};
export async function initMultiuse() {
  await Promise.all(SPACES.map(async (cfg) => {
    if (started[cfg.p] || !$(`${cfg.p}-stage`)) return;
    started[cfg.p] = true;
    const loading = $(`${cfg.p}-loading`);
    try {
      const data = await fetch(cfg.url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      start(cfg, data);
      loading.hidden = true;
    } catch (err) {
      started[cfg.p] = false;
      loading.textContent = `A jelenetek nem töltődtek be (${err.message}). Nyisd meg újra a fület.`;
      console.error(cfg.url, err);
    }
  }));
}

// the room: Building O's columns, beams (see-through) and floor, grid lines
function roomBase(S) {
  const half = (S.bay * S.n) / 2, grid = Array.from({ length: S.n + 1 }, (_, i) => -half + i * S.bay);
  const g = new THREE.Group();
  const floor = new THREE.Mesh(box(-half - 0.15, -half - 0.15, -0.15, half + 0.15, half + 0.15, 0), mat(0.9));
  floor.receiveShadow = true;
  const cols = new THREE.Mesh(mergeGeometries(grid.flatMap((x) => grid.map((y) => box(x - S.column / 2, y - S.column / 2, 0, x + S.column / 2, y + S.column / 2, S.zBeam)))), mat(0.72));
  cols.castShadow = cols.receiveShadow = true;
  const beams = new THREE.Mesh(mergeGeometries([...grid.map((x) => box(x - S.beam[0] / 2, -half - 0.15, S.zBeam, x + S.beam[0] / 2, half + 0.15, S.zCeiling)),
    ...grid.map((y) => box(-half - 0.15, y - S.beam[0] / 2, S.zBeam, half + 0.15, y + S.beam[0] / 2, S.zCeiling))]), monoMat(0.78, { transparent: true, opacity: 0.55, depthWrite: false }));
  const gl = [];
  grid.forEach((v) => gl.push(-half - 1, 0.005, -v, half + 1, 0.005, -v, v, 0.005, half + 1, v, 0.005, -half - 1));
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gl, 3)),
    new THREE.LineBasicMaterial({ color: 0x8a83b3, transparent: true, opacity: 0.6 }));
  g.add(floor, cols, beams, lines);
  return { group: g, labels: [] };
}

// the field: the site meshes from the twin; the net is a veil, the pitch markings white lines
function siteBase(site) {
  const g = new THREE.Group();
  for (const m of site.meshes) {
    const geo = new THREE.BufferGeometry();
    const v = new Float32Array(m.v.length);
    for (let i = 0; i < m.v.length; i += 3) { v[i] = m.v[i]; v[i + 1] = m.v[i + 2]; v[i + 2] = -m.v[i + 1]; }
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.setIndex(m.f);
    geo.computeVertexNormals();
    const net = m.layer === 'Ball-stop net';
    const mesh = new THREE.Mesh(geo, net ? monoMat(m.tone, { transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
      : monoMat(m.tone, { side: THREE.DoubleSide }));
    mesh.castShadow = !net && m.layer !== 'Ground' && m.layer !== 'Pitch';
    mesh.receiveShadow = !net;
    if (m.layer === 'Pitch') mesh.position.y = 0.002;
    g.add(mesh);
  }
  const segs = { white: [], dark: [] };
  for (const l of site.lines) {
    const k = l.layer === 'Pitch' ? 'white' : l.layer === 'Ball-stop net' ? 'dark' : null;
    if (!k) continue;
    const p = l.p;
    for (let i = 0; i + 5 < p.length; i += 3) segs[k].push(p[i], p[i + 2] + 0.01, -p[i + 1], p[i + 3], p[i + 5] + 0.01, -p[i + 4]);
  }
  const lineMat = { white: new THREE.LineBasicMaterial({ color: 0xffffff }), dark: new THREE.LineBasicMaterial({ color: 0x3c3770, transparent: true, opacity: 0.16 }) };
  for (const k of Object.keys(segs)) {
    if (segs[k].length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(segs[k], 3)), lineMat[k]));
  }
  return { group: g, labels: site.labels.filter((l) => /épület/.test(l.text)) };
}

function start(cfg, data) {
  const stage = $(`${cfg.p}-stage`), canvas = $(`${cfg.p}-canvas`), section = stage.closest('section');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let onScreen = false, raf = 0, sized = false, timer = 0;   // render loop state (see the end)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.1, maxPolarAngle: Math.PI * 0.47, minDistance: cfg.dist[0], maxDistance: cfg.dist[1] });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8c8c, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  const R = cfg.shadow;
  sun.position.set(-R, R * 1.9, R * 0.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 6 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const base = data.structure ? roomBase(data.structure) : siteBase(data.site);
  scene.add(base.group);
  // labels on the ground (where Building O is), projected each frame
  const pins = base.labels.map((l) => {
    const el = document.createElement('div');
    el.className = 'stage__pin';
    el.textContent = `${l.text} felé`;
    stage.append(el);
    return { el, p: new THREE.Vector3(l.x, 0.3, -l.y) };
  });

  // ---- furniture items (pooled per kind) and their tweens
  const furn = new THREE.Group();
  scene.add(furn);
  const pool = {};
  const live = [];   // {kind, obj, x, y, z, a, tw}
  function makeItem(kind) {
    const g = new THREE.Group();
    for (const [geo, m] of PARTS[kind] || []) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    }
    furn.add(g);
    return g;
  }
  const place = (it) => { it.obj.position.set(it.x, it.z, -it.y); it.obj.rotation.y = it.a; };

  // ---- people: one agents set per layout, built on first use
  const people = {};
  function crowd(L) {
    if (!people[L.id]) {
      const g = new THREE.Group();
      scene.add(g);
      const a = buildAgents(g, { groups: L.groups }, () => 0, mat);
      g.children.forEach((c) => { c.userData.base = c.scale.x; });
      people[L.id] = { g, a, tw: [] };
    }
    return people[L.id];
  }
  const setScale = (o, k) => { const s = Math.max(1e-3, k); o.scale.setScalar((o.userData.base || 1) * s); o.visible = k > 1e-3; };

  // ---- switching layouts
  let cur = -1, busyUntil = 0, arrivedAt = 0, playing = !reduce.matches;
  const now = () => performance.now() / 1000;
  function show(i, instant = false) {
    const L = data.layouts[i], t0 = now(), fast = instant || reduce.matches;
    const prev = cur >= 0 ? data.layouts[cur] : null;
    cur = i;
    if (prev && prev.id !== L.id) {   // people of the previous layout leave
      const P = crowd(prev);
      P.tw = P.g.children.map((c) => ({ c, from: 1, to: 0, t: t0 + (fast ? 0 : Math.random() * 0.35), d: fast ? 0 : 0.35 }));
    }
    // furniture: match what is there to what is needed, kind by kind (nearest first)
    const want = {}, have = {}, keep = [];
    L.furniture.forEach((f) => (want[f.k] ||= []).push(f));
    live.forEach((it) => (have[it.kind] ||= []).push(it));
    for (const kind of new Set([...Object.keys(want), ...Object.keys(have)])) {
      const W = want[kind] || [], H = have[kind] || [];
      const pairs = [];
      H.forEach((h, hi) => W.forEach((w, wi) => pairs.push([Math.hypot(h.x - w.x, h.y - w.y), hi, wi])));
      pairs.sort((p, q) => p[0] - q[0]);
      const usedH = new Set(), usedW = new Set();
      for (const [, hi, wi] of pairs) {
        if (usedH.has(hi) || usedW.has(wi)) continue;
        usedH.add(hi); usedW.add(wi);
        const h = H[hi], w = W[wi];
        h.tw = { kind: 'move', x0: h.x, y0: h.y, z0: h.z, a0: h.a, x1: w.x, y1: w.y, z1: w.z, a1: h.a + wrap(w.a - h.a), s0: h.obj.scale.x,
          t: t0 + (fast ? 0 : 0.35 + Math.random() * 0.55), d: fast ? 0 : 1.3 };
        h.obj.visible = true;
        keep.push(h);
      }
      H.forEach((h, hi) => { if (!usedH.has(hi)) { h.tw = { kind: 'out', t: t0 + (fast ? 0 : 0.15 + Math.random() * 0.45), d: fast ? 0 : 0.4 }; keep.push(h); } });
      W.forEach((w, wi) => {
        if (usedW.has(wi)) return;
        const obj = (pool[kind] || []).pop() || makeItem(kind);
        const it = { kind, obj, x: w.x, y: w.y, z: w.z, a: w.a, tw: { kind: 'in', t: t0 + (fast ? 0 : 1.0 + Math.random() * 0.6), d: fast ? 0 : 0.5 } };
        place(it);
        obj.scale.setScalar(1e-3);
        obj.visible = false;
        keep.push(it);
      });
    }
    live.length = 0;
    live.push(...keep);
    const P = crowd(L);   // the new crowd arrives once the furniture is in place
    P.g.visible = true;
    P.tw = P.g.children.map((c) => { if (!fast) setScale(c, 0); return { c, from: 0, to: 1, t: t0 + (fast ? 0 : 1.9 + Math.random() * 0.7), d: fast ? 0 : 0.45 }; });
    busyUntil = t0 + (fast ? 0 : 3.1);
    arrivedAt = busyUntil;
    ui(i);
    wake();
  }
  function stepTweens(t) {
    let active = false;
    for (let i = live.length - 1; i >= 0; i--) {
      const it = live[i], w = it.tw;
      if (!w) continue;
      const u = w.d ? clamp01((t - w.t) / w.d) : t >= w.t ? 1 : 0;
      if (w.kind === 'move') {
        const e = ease(u);
        it.x = w.x0 + (w.x1 - w.x0) * e; it.y = w.y0 + (w.y1 - w.y0) * e; it.z = w.z0 + (w.z1 - w.z0) * e; it.a = w.a0 + (w.a1 - w.a0) * e;
        place(it);
        if (w.s0 < 1) it.obj.scale.setScalar(Math.max(1e-3, w.s0 + (1 - w.s0) * e));   // was still folding in or out
      } else if (w.kind === 'in') {
        it.obj.visible = u > 0;
        it.obj.scale.setScalar(Math.max(1e-3, easeOutBack(u)));
      } else {
        it.obj.scale.setScalar(Math.max(1e-3, 1 - ease(u)));
        if (u >= 1) { it.obj.visible = false; (pool[it.kind] ||= []).push(it.obj); live.splice(i, 1); continue; }
      }
      if (u >= 1) it.tw = null; else active = true;
    }
    for (const P of Object.values(people)) {
      if (!P.tw.length) continue;
      P.tw = P.tw.filter((w) => {
        const u = w.d ? clamp01((t - w.t) / w.d) : t >= w.t ? 1 : 0;
        setScale(w.c, w.from + (w.to - w.from) * ease(u));
        return u < 1;
      });
      if (P.tw.length) active = true;
      else if (P !== people[data.layouts[cur].id]) P.g.visible = false;
    }
    return active;
  }

  // ---- UI: one button per layout, play / pause, camera
  const modes = $(`${cfg.p}-modes`), tag = $(`${cfg.p}-tag`), desc = $(`${cfg.p}-desc`), playBtn = $(`${cfg.p}-play`);
  data.layouts.forEach((L, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = L.title;   // no people counts (user, 2026-10-08)
    b.addEventListener('click', () => { setPlaying(false); if (i !== cur) show(i); });
    modes.append(b);
  });
  function ui(i) {
    const L = data.layouts[i];
    [...modes.children].forEach((b, k) => b.setAttribute('aria-checked', String(k === i)));
    const n = (ks) => L.furniture.filter((f) => ks.includes(f.k)).length;
    tag.textContent = [L.title, ...COUNTS.map(([ks, w]) => [n(ks), w]).filter(([c]) => c).map(([c, w]) => `${c} ${w}`)].join(' · ');
    desc.textContent = DESC[L.id] || '';
  }
  function setPlaying(on) {
    playing = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.textContent = on ? 'Szünet' : 'Lejátszás';
    arrivedAt = Math.max(arrivedAt, now());
    wake();
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));
  const CAMS = { axo: [-0.62, 0.8, 0.85], top: [0, 1, 0.001] };
  const camBtns = [...section.querySelectorAll('[data-cam]')];
  let camTween = null;
  function cam(name, instant = false) {
    const dir = new THREE.Vector3(...CAMS[name]).normalize();
    const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const d = cfg.fit[name] / Math.sin(Math.min(vfov, hfov) / 2);
    const target = new THREE.Vector3(0, name === 'top' ? 0 : 0.8, 0), pos = target.clone().add(dir.multiplyScalar(d));
    camBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.cam === name));
    if (instant || reduce.matches) { camera.position.copy(pos); controls.target.copy(target); controls.update(); camTween = null; wake(); return; }
    camTween = { t0: now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: pos, q1: target };
    wake();
  }
  camBtns.forEach((b) => b.addEventListener('click', () => cam(b.dataset.cam)));

  // ---- theme, size, loop (only while the stage is on screen)
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const applyTheme = () => { scene.background = new THREE.Color(cssVar('--stage') || '#dfe3e1'); wake(); };
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!sized) { sized = true; cam('axo', true); }
    wake();
  }
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; wake(); }).observe(stage);
  document.addEventListener('visibilitychange', wake);
  controls.addEventListener('change', wake);
  // drawn on demand: while a layout switch, a camera move or the orbit damping runs; the next autoplay step is a timer.
  // The people stand still (their poses from buildAgents' first update: seated, standing, turned to their group).
  function wake() {
    clearTimeout(timer);
    if (!raf && onScreen && !document.hidden && sized) raf = requestAnimationFrame(frame);
  }
  const v = new THREE.Vector3();
  function frame() {
    raf = 0;
    if (!onScreen || document.hidden) return;
    if (playing && now() > busyUntil && now() - arrivedAt > DWELL) show((cur + 1) % data.layouts.length);
    if (camTween) {
      const u = clamp01((now() - camTween.t0) / 0.9), e = ease(u);
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.q0, camTween.q1, e);
      if (u >= 1) camTween = null;
    }
    const tweening = stepTweens(now());
    const moving = controls.update();
    renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const pin of pins) {
      v.copy(pin.p).project(camera);
      const off = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      pin.el.hidden = off;
      if (!off) pin.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    if (raf) return;   // already requested (the controls' change event wakes us from inside the frame)
    if (tweening || moving || camTween || now() < busyUntil) raf = requestAnimationFrame(frame);
    else if (playing) timer = setTimeout(wake, Math.max(0, arrivedAt + DWELL - now()) * 1000 + 50);
  }
  setPlaying(playing);
  show(0, true);
  resize();
}
