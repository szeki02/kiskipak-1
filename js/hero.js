// Opening page: the site model (the scene built by js/context.js, shared through its `site` export) seen by a camera
// that slowly orbits Building O, under a day-night cycle: the sun rises in the east, crosses the south and sets in the
// west, the sky darkens, stars come out, a low moon light keeps the card model readable and Building O's windows glow.
// Below it a strip of the team's survey photos and sketches crawls by in black and white (assets/crawl, made by
// tools/make_crawl.ps1). Draws only while the opening page is on screen; reduced motion = a still midday view.
import * as THREE from 'three';
import { site } from './context.js';

const ORBIT_S = 150;      // seconds per orbit
const DAY_S = 96;         // seconds per day-night cycle
const R = 138, H = 88;    // orbit radius and camera height (m), ~32° down onto Building O (target 4 m above its ground floor)
const FPS = 40;

const $ = (s) => document.querySelector(s);
const hero = $('#hero'), canvas = $('#hero-scene'), track = $('#hero-track'), clock = $('#hero-clock');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RAD = Math.PI / 180;
const c2t = (x, y, z) => new THREE.Vector3(x, z, -y);   // site metres -> three
const sunVec = (alt, az) => new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// sky colour by solar altitude (degrees), in the mood board's palette: indigo night, violet and coral twilight,
// an orange low sun, peach paper by day
const SKY = [[-14, '#121129'], [-6, '#1d1b3d'], [-2, '#3e2f6b'], [1, '#a65a72'], [4, '#f09a6a'], [10, '#f4cfb4'], [24, '#f6e3d3']]
  .map(([a, c]) => [a, new THREE.Color(c)]);
function skyAt(alt, out) {
  if (alt <= SKY[0][0]) return out.copy(SKY[0][1]);
  for (let i = 0; i < SKY.length - 1; i++) {
    const [a0, c0] = SKY[i], [a1, c1] = SKY[i + 1];
    if (alt <= a1) return out.copy(c0).lerp(c1, (alt - a0) / (a1 - a0));
  }
  return out.copy(SKY[SKY.length - 1][1]);
}

// ---- crawling strip (doubled for a seamless loop)
async function buildCrawl() {
  const list = await fetch('assets/crawl/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if (!list.length) { $('#hero-crawl').hidden = true; return; }
  const clean = (s) => String(s || '').replace(/[&<>"]/g, '');
  const item = (it, i) => `<figure class="hero__shot hero__shot--${it.type === 'sketch' ? 'sketch' : 'photo'}"><img src="${it.src}" width="${it.w}" height="${it.h}" alt="" loading="eager" decoding="async"><figcaption><b>nr.${String(i + 1).padStart(3, '0')}</b><span>${clean(it.title)}</span></figcaption></figure>`;
  track.innerHTML = list.map(item).join('') + list.map(item).join('');
  for (const [i, f] of [...track.children].entries()) if (i >= list.length) f.setAttribute('aria-hidden', 'true');
  const setSpeed = () => { const w = track.scrollWidth / 2; track.style.setProperty('--crawl-w', `${w}px`); track.style.setProperty('--crawl-s', `${Math.round(w / 38)}s`); };
  setSpeed();
  new ResizeObserver(setSpeed).observe(track);
}

// ---- 3D
async function start() {
  const meta = await site.ready;
  const { scene, sun, hemi, MAT, groups, cutPlane } = site;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
  const target = c2t(0, 0, 4);
  // survey markers and the coverage heat map (userData.siteOnly, js/survey.js) belong to the site viewer only
  let siteOnly = [], scanned = -1e9;
  const scan = (now) => {
    if (now - scanned < 2000) return;
    scanned = now; siteOnly = [];
    groups.building.traverse((o) => { if (o.userData.siteOnly) siteOnly.push(o); });
  };

  // stars: only drawn by this renderer (hidden in the site viewer)
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random(), v = 0.06 + Math.random() * 0.94, a = u * Math.PI * 2, el = Math.asin(v);
    pos.set([Math.cos(a) * Math.cos(el) * 1400, Math.sin(el) * 1400, Math.sin(a) * Math.cos(el) * 1400], i * 3);
  }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat); stars.visible = false; stars.frustumCulled = false;
  scene.add(stars);

  const sky = new THREE.Color(), fog = new THREE.Fog(0xffffff, 210, 600);
  const hide = ['transit', 'stops', 'sunpath', 'contours'];
  let W = 0, Hh = 0, lift = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; Hh = r.height;
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh;
    lift = Math.round(($('#hero-crawl').getBoundingClientRect().height || 0) * 0.55);   // keep the building clear of the strip
    camera.setViewOffset(W, Hh + 2 * lift, 0, 2 * lift, W, Hh);
    camera.updateProjectionMatrix();
  }

  function frame(t) {
    // time of day: phase 0 = sunrise in the east, 0.25 = noon in the south, ~0.5 = sunset in the west
    const p = hero.dataset.phase ? Number(hero.dataset.phase) : reduce ? 0.2 : (t / DAY_S + 0.08) % 1;   // data-phase: pin a time (checks)
    const altDeg = 52 * Math.sin(2 * Math.PI * p) + 5, az = (90 + p * 360) * RAD;
    const day = smooth(-4, 6, altDeg), night = 1 - day;
    // camera
    const th = reduce ? 0.9 : (t / ORBIT_S) * Math.PI * 2 + 0.9;
    const k = Math.pow(Math.max(1, 1.3 / camera.aspect), 0.6);   // portrait screens: step back so the building fits the width
    camera.position.set(target.x + R * k * Math.cos(th), H * k, target.z + R * k * Math.sin(th));
    camera.lookAt(target);

    // ---- set the hero's lighting on the shared scene, render, put everything back
    scan(performance.now());
    const ownVis = siteOnly.map((o) => o.visible);
    siteOnly.forEach((o) => { o.visible = false; });
    const saved = {
      bg: scene.background, fog: scene.fog, sunPos: sun.position.clone(), sunI: sun.intensity, sunVis: sun.visible,
      hemiI: hemi.intensity, cut: cutPlane.constant, vis: hide.map((k) => groups[k].visible),
      paneE: MAT.pane.emissive.clone(), paneEI: MAT.pane.emissiveIntensity, paneO: MAT.pane.opacity,
    };
    scene.background = skyAt(altDeg, sky);
    fog.color.copy(sky); fog.near = 210 * k; fog.far = 600 * k; scene.fog = fog;
    if (altDeg > 0) {                                 // sun
      sun.position.copy(sunVec(altDeg * RAD, az)).multiplyScalar(900);
      sun.intensity = 2.5 * smooth(0, 8, altDeg);
    } else {                                          // moon: low, opposite the sun, faint
      sun.position.copy(sunVec(32 * RAD, az + Math.PI)).multiplyScalar(900);
      sun.intensity = 0.45 * smooth(-1, -8, altDeg);
    }
    sun.visible = true;
    hemi.intensity = 0.1 + 0.85 * day;
    cutPlane.constant = 1e6;
    hide.forEach((k) => { groups[k].visible = false; });
    MAT.pane.emissive.setRGB(1, 0.92, 0.75); MAT.pane.emissiveIntensity = 1.6 * smooth(0.25, 0.85, night); MAT.pane.opacity = 0.22 + 0.68 * smooth(0.2, 0.8, night);
    starMat.opacity = smooth(0.55, 1, night); stars.visible = starMat.opacity > 0.01;

    renderer.render(scene, camera);

    scene.background = saved.bg; scene.fog = saved.fog;
    sun.position.copy(saved.sunPos); sun.intensity = saved.sunI; sun.visible = saved.sunVis;
    hemi.intensity = saved.hemiI; cutPlane.constant = saved.cut;
    hide.forEach((k, i) => { groups[k].visible = saved.vis[i]; });
    MAT.pane.emissive.copy(saved.paneE); MAT.pane.emissiveIntensity = saved.paneEI; MAT.pane.opacity = saved.paneO;
    stars.visible = false;
    siteOnly.forEach((o, i) => { o.visible = ownVis[i]; });

    // page chrome follows the sky: light text at night, a clock of the shown time of day
    hero.dataset.night = String(night > 0.5);
    hero.style.setProperty('--hero-sky', `#${sky.getHexString()}`);
    if (clock) {
      const min = Math.round((((p - 0.25) * 24 + 12 + 24) % 24) * 60) % 1440;   // noon at phase 0.25
      clock.textContent = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    }
  }

  // ---- loop: only while the opening page is visible
  let onScreen = true, last = 0, t0 = performance.now(), paused = 0, stopAt = 0;
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (!onScreen) stopAt = performance.now(); else if (stopAt) { paused += performance.now() - stopAt; stopAt = 0; }
  }, { threshold: 0.02 }).observe(hero);
  new ResizeObserver(() => { resize(); if (reduce) frame(0); }).observe(canvas);
  resize();
  frame(0);
  hero.classList.add('is-ready');
  if (reduce) return;
  renderer.setAnimationLoop((now) => {
    if (!onScreen || document.hidden || now - last < 1000 / FPS) return;
    last = now;
    frame((now - t0 - paused) / 1000);
  });
}

buildCrawl();
start().catch((err) => console.error('hero', err));
