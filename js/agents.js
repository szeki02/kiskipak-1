// Little people in group conversations around Building O (data/agents.json, laid out from the Rhino twin).
// Each figure is a handful of primitives on pivots (hips, knees, shoulders, elbows, neck), so it can
// stand or sit, turn its head to whoever is talking, nod, shift its weight and gesture while speaking.
import * as THREE from 'three';

const LEG_T = 0.44, LEG_S = 0.46, HIP_H = 0.9;   // thigh, shin, standing hip height (m)

// seeded random, so the scene plays the same way each visit
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const geo = {
  thigh: new THREE.CylinderGeometry(0.075, 0.06, LEG_T, 7).translate(0, -LEG_T / 2, 0),
  shin: new THREE.CylinderGeometry(0.058, 0.045, LEG_S, 7).translate(0, -LEG_S / 2, 0),
  foot: new THREE.BoxGeometry(0.09, 0.06, 0.2).translate(0, -LEG_S - 0.01, 0.05),
  torso: new THREE.CapsuleGeometry(0.15, 0.3, 4, 10).scale(1.18, 1, 0.72).translate(0, 0.3, 0),
  head: new THREE.SphereGeometry(0.105, 12, 9).translate(0, 0.13, 0),
  upper: new THREE.CylinderGeometry(0.045, 0.04, 0.3, 6).translate(0, -0.15, 0),
  fore: new THREE.CylinderGeometry(0.038, 0.032, 0.28, 6).translate(0, -0.14, 0),
};

function limb(g, mat, parent, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  pivot.add(m);
  parent.add(pivot);
  return pivot;
}

function makeFigure(mats, r) {
  const top = mats.tops[Math.floor(r() * mats.tops.length)];
  const legs = mats.legs[Math.floor(r() * mats.legs.length)];
  const root = new THREE.Group();
  const hips = new THREE.Group();
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  const t = new THREE.Mesh(geo.torso, top);
  t.castShadow = true;
  torso.add(t);
  const neck = limb(geo.head, mats.skin, torso, 0, 0.6, 0.01);
  const side = (s) => {
    const thigh = limb(geo.thigh, legs, hips, s * 0.09, 0, 0);
    const shin = limb(geo.shin, legs, thigh, 0, -LEG_T, 0);
    const foot = new THREE.Mesh(geo.foot, mats.shoes);
    foot.castShadow = true;
    shin.add(foot);
    const upper = limb(geo.upper, top, torso, s * 0.21, 0.54, 0);
    const fore = limb(geo.fore, mats.skin, upper, 0, -0.3, 0);
    return { thigh, shin, upper, fore };
  };
  const scale = 0.94 + r() * 0.12;
  root.scale.setScalar(scale);
  return { root, hips, torso, neck, L: side(1), R: side(-1), scale };
}

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param {THREE.Group} group          where the figures go (toggled as one)
 * @param {object} data                data/agents.json
 * @param {(x:number, y:number) => number} groundAt  ground height at site (x, y)
 * @param {(gray:number) => THREE.Material} mat      material in the page's black-and-white style
 */
export function buildAgents(group, data, groundAt, mat) {
  const mats = {
    tops: [0.22, 0.34, 0.5, 0.68, 0.82].map(mat),
    legs: [0.16, 0.26, 0.4].map(mat),
    skin: mat(0.86),
    shoes: mat(0.12),
  };
  const convos = [];
  (data.groups || []).forEach((g, gi) => {
    const r = rng(7919 * (gi + 1));
    const people = g.members.map((m) => {
      const f = makeFigure(mats, r);
      const sit = m.pose === 'sit';
      const z = sit ? m.z + 0.05 : (m.floor ?? groundAt(m.x, m.y));   // floor: standing on something (a podium)
      f.root.position.set(m.x, z, -m.y);
      const yaw = Math.atan2(m.face[0], -m.face[1]);
      f.root.rotation.y = yaw;
      group.add(f.root);
      const p = {
        f, sit, x: m.x, y: m.y, baseYaw: yaw, yaw, headYaw: 0, headPitch: 0, lean: 0, sway: r() * 6.28,
        swayRate: 0.6 + r() * 0.5, nodAt: 2 + r() * 5, nodT: -1, gestPhase: r() * 6.28, look: 0, lookAt: 0,
        armL: 0, armR: 0, elbowL: 0, elbowR: 0,
      };
      if (sit) {
        // knee height from the seat: low seats (pallets) lift the knees
        const drop = z - groundAt(m.x, m.y);
        const up = drop < LEG_S ? Math.asin(Math.min(0.9, (LEG_S - drop) / LEG_T)) : 0;
        f.hips.position.y = 0;
        f.L.thigh.rotation.x = f.R.thigh.rotation.x = -(Math.PI / 2 + up);
        f.L.shin.rotation.x = f.R.shin.rotation.x = Math.PI / 2 + up;
        f.L.thigh.rotation.z = -0.08; f.R.thigh.rotation.z = 0.08;
      } else {
        f.hips.position.y = HIP_H;
      }
      return p;
    });
    // a group with a fixed speaker (a lecture) keeps it; someone on their own doesn't talk
    const fixed = Number.isInteger(g.speaker) ? g.speaker : null;
    const first = people.length > 1 ? Math.floor(r() * people.length) : -1;
    convos.push({ people, r, fixed, speaker: fixed ?? first, next: 1 + r() * 3, laughT: -1 });
  });

  let last = null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function update(now) {
    const t = now / 1000;
    const dt = last == null ? 0.016 : Math.min(0.1, t - last);
    last = t;
    for (const c of convos) {
      // turn-taking: a new speaker every few seconds; now and then the group laughs
      if (t > c.next && c.fixed == null && c.people.length > 1) {
        let s = Math.floor(c.r() * c.people.length);
        if (s === c.speaker && c.people.length > 1) s = (s + 1) % c.people.length;
        c.speaker = s;
        c.next = t + 2.5 + c.r() * 4.5;
        if (c.r() < 0.25) c.laughT = t;
        c.people.forEach((p) => { p.lookAt = 0; });
      }
      const laugh = c.laughT > 0 && t - c.laughT < 1.2 ? Math.sin((t - c.laughT) * 18) * Math.exp(-(t - c.laughT) * 2.2) : 0;
      const spk = c.people[c.speaker];
      c.people.forEach((p, i) => {
        const f = p.f, talking = i === c.speaker;
        // who to look at: listeners at the speaker, the speaker round the group
        let target = spk || p;
        if (talking) {
          if (t > p.lookAt) { p.look = (p.look + 1 + Math.floor(c.r() * (c.people.length - 1))) % c.people.length; if (p.look === i) p.look = (i + 1) % c.people.length; p.lookAt = t + 1.2 + c.r() * 1.8; }
          target = c.people[p.look] || spk;
        }
        const want = target === p ? p.baseYaw : Math.atan2(target.x - p.x, -(target.y - p.y));
        const rel = wrap(want - p.baseYaw);
        // standing people half-turn their body, seated ones only their head
        const bodyTurn = p.sit ? 0 : Math.max(-0.5, Math.min(0.5, rel * 0.35));
        p.yaw = damp(p.yaw, p.baseYaw + bodyTurn, 2.2, dt);
        f.root.rotation.y = p.yaw;
        p.headYaw = damp(p.headYaw, Math.max(-1.1, Math.min(1.1, wrap(want - p.yaw))), 5, dt);
        // listeners nod now and then
        if (!talking && t > p.nodAt) { p.nodT = t; p.nodAt = t + 2.5 + c.r() * 5; }
        const nod = p.nodT > 0 && t - p.nodT < 0.9 ? Math.sin((t - p.nodT) * Math.PI * 2 / 0.45) * 0.16 * (1 - (t - p.nodT) / 0.9) : 0;
        const speakBob = talking ? Math.sin(t * 7.3 + p.gestPhase) * 0.05 : 0;
        f.neck.rotation.y = p.headYaw;
        f.neck.rotation.x = 0.06 + nod + speakBob;
        // weight shift and breathing
        const sw = Math.sin(t * p.swayRate + p.sway);
        if (!p.sit) {
          f.hips.position.x = sw * 0.025;
          f.hips.rotation.z = sw * 0.03;
          f.L.thigh.rotation.z = -sw * 0.03; f.R.thigh.rotation.z = -sw * 0.03;
        }
        p.lean = damp(p.lean, (talking ? 0.1 : p.sit ? -0.06 : 0) + laugh * 0.12, 3, dt);
        f.torso.rotation.x = p.lean + Math.sin(t * 1.6 + p.sway) * 0.012;
        f.torso.rotation.z = p.sit ? 0 : -sw * 0.025;
        // arms: the speaker gestures, listeners rest (seated: hands on the knees)
        const g1 = Math.sin(t * 2.4 + p.gestPhase), g2 = Math.sin(t * 1.7 + p.gestPhase * 1.3);
        const rest = p.sit ? -0.55 : 0.02;
        const restE = p.sit ? -0.75 : -0.12;
        const aL = talking ? -0.55 + 0.35 * g1 : rest, aR = talking ? -0.35 + 0.3 * g2 : rest;
        const eL = talking ? -1.1 + 0.35 * g2 : restE, eR = talking ? -0.9 + 0.35 * g1 : restE;
        p.armL = damp(p.armL, aL, 4, dt); p.armR = damp(p.armR, aR, 4, dt);
        p.elbowL = damp(p.elbowL, eL, 4, dt); p.elbowR = damp(p.elbowR, eR, 4, dt);
        f.L.upper.rotation.x = p.armL; f.R.upper.rotation.x = p.armR;
        f.L.upper.rotation.z = 0.1 + (talking ? 0.12 * (1 + g2) : 0); f.R.upper.rotation.z = -0.1 - (talking ? 0.1 * (1 + g1) : 0);
        f.L.fore.rotation.x = p.elbowL; f.R.fore.rotation.x = p.elbowR;
      });
    }
  }
  update(0);
  return {
    count: convos.reduce((n, c) => n + c.people.length, 0),
    centers: convos.map((c) => {
      const v = new THREE.Vector3();
      c.people.forEach((p) => v.add(p.f.root.position));
      return v.divideScalar(c.people.length);
    }),
    update,
    animates: () => !reduce.matches,
  };
}
