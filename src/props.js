/* FIRN -- environment props and weather.
 *
 * Two rules govern everything in here.
 *
 * 1. WHAT TILTS. Anything standing on or hanging from the causeway is built in
 *    STAGE space and tilts with it. Anything belonging to the frozen sea --
 *    wrecks, floes, birds, spindrift over the ice -- is built in WORLD space
 *    and stays level, because the horizon is the reference you read the tilt
 *    against.
 *
 * 2. EVERYTHING REPEATED IS INSTANCED. Cairns, posts, piers, icicles and floes
 *    run to hundreds of objects. As individual meshes that is hundreds of draw
 *    calls; as InstancedMesh it is one apiece.
 *
 * The props are not only decoration. The route is meant to look like a road
 * people have walked and mostly died on, because failure in this game is
 * succession -- each attempt is another named bearer. Cairns and broken ice on
 * the floe are that fiction made visible.
 */

import * as THREE from '../vendor/three.module.js';
import { mulberry32, rotV } from './sim.js';
import { GROUND_Y } from './worlds.js';

// One source of truth for how far below the causeway the ground sits.
const SEA_Y = GROUND_Y;

const lerp = (a, b, t) => a + (b - a) * t;
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _cOut = new THREE.Color();
const mixHex = (a, b, t) => _cOut.copy(_c1.setHex(a)).lerp(_c2.setHex(b), t).getHex();

// ---------------------------------------------------------------- helpers

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** An InstancedMesh you push transforms into, then seal. */
function bank(geo, mat, max) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.count = 0;
  m.frustumCulled = false;
  m.put = (px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    if (m.count >= max) return;
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
    m.setMatrixAt(m.count++, _m);
  };
  m.seal = () => { m.instanceMatrix.needsUpdate = true; return m; };
  return m;
}

/** A box spanning two points, for ropes and braces. */
function span(m, ax, ay, az, bx, by, bz, thick) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.asin(dy / len);
  m.put((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, thick, thick, len, pitch, yaw, 0);
}

/** Soft round sprite. Untextured Points draw as hard squares, which read as
 *  graphical litter rather than steam or snow. */
let _soft = null;
export function softSprite() {
  if (_soft) return _soft;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.45, 'rgba(255,255,255,.5)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
  _soft = new THREE.CanvasTexture(cv);
  _soft.colorSpace = THREE.SRGBColorSpace;
  return _soft;
}

const ROCK = new THREE.IcosahedronGeometry(1, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 6);

/** Plates you can stand on -- the route's actual surfaces. Rotated plates
 *  (ramps and bends) are INCLUDED: placement runs in each box's own frame. */
function decks(stage) {
  return stage.boxes.filter((b) => b.kind === 'stone'
    && b.e[0] > 1.2 && b.e[2] > 1.2 && b.e[1] < 1.2);
}
/** Kerbs mark the route's edges, which is exactly where handline and cairns go. */
function kerbs(stage) {
  return stage.boxes.filter((b) => b.kind === 'rail');
}

// ------------------------------------------------------ props ON the causeway

export function buildStageProps(stage, weather) {
  const g = new THREE.Group();
  const rnd = mulberry32(stage.id.length * 2749 + 61);

  // Ironwork and stone are LOCAL: a fixed near-black reads as heavy bars laid
  // over a pale world, and the piers end up dominating the frame.
  const D = (weather && weather.deck) || { stone: 0x7d8892, rail: 0x4a555d };
  const matStone = new THREE.MeshStandardMaterial({ color: D.stone, roughness: 0.92, flatShading: true });
  const matDark  = new THREE.MeshStandardMaterial({ color: D.rail, roughness: 0.8, metalness: 0.15 });
  const matRope  = new THREE.MeshStandardMaterial({ color: D.stone, roughness: 0.98 });
  const matIce   = new THREE.MeshStandardMaterial({ color: 0xc8e2ec, roughness: 0.3, flatShading: true });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xc9a961, roughness: 0.42, metalness: 0.75 });
  const matTrim  = new THREE.MeshStandardMaterial({ color: D.rail, roughness: 0.85 });

  const deckList = decks(stage);
  const kerbList = kerbs(stage);
  const icy = !weather || weather.band < 0.75;

  /* Every prop is placed in its box's OWN frame and then mapped out to world.
   * Doing the arithmetic in world space only works while the route is axis
   * aligned; the moment a plate is rotated -- a ramp, a bend -- piers march off
   * through the deck and rope gets strung between points that were never
   * adjacent. This is what lets the road climb and curve at all. */
  const _w = [0, 0, 0];
  const pt = (b, lx, ly, lz) => {
    if (b.q) {
      rotV(b.q, lx, ly, lz, _w);
      _w[0] += b.c[0]; _w[1] += b.c[1]; _w[2] += b.c[2];
    } else {
      _w[0] = b.c[0] + lx; _w[1] = b.c[1] + ly; _w[2] = b.c[2] + lz;
    }
    return _w;
  };
  const rot = (b) => (b.rot || [0, 0, 0]);
  /** Long axis of a box, in its own frame: true when it runs along local Z. */
  const alongZ = (b) => b.e[2] >= b.e[0];

  // ---- piers down to the ground. They hang WORLD-vertical whatever the deck
  // above them is doing, so the attach point is transformed but the pier is not.
  const piers = bank(BOX, matDark, 340);
  const braces = bank(BOX, matDark, 340);
  for (const b of deckList) {
    const az = alongZ(b);
    const L = (az ? b.e[2] : b.e[0]) * 2;
    const n = Math.max(2, Math.floor(L / 16));
    for (let i = 0; i < n; i++) {
      const t = -0.5 + (i + 0.5) / n;
      const p = pt(b, az ? 0 : t * L, -b.e[1], az ? t * L : 0);
      const top = p[1], px = p[0], pz = p[2];
      const h = top - GROUND_Y;
      if (h < 4) continue;
      const wdt = 1.5 + rnd() * 0.7;
      piers.put(px, top - h / 2, pz, wdt, h, wdt);
      const sp = Math.min(b.e[0], b.e[2]) * 0.8 + 1.5;
      for (const sgn of [-1, 1]) {
        const ox = az ? sgn * sp : 0, oz = az ? 0 : sgn * sp;
        span(braces, px, top - 1.5, pz, px + ox, top - h * 0.55, pz + oz, 0.55);
      }
    }
  }
  g.add(piers.seal(), braces.seal());

  // ---- a trim course along the deck edges. A slab with square corners reads
  // as an extruded rectangle; a second band just under the lip reads as
  // masonry, and it costs two instanced boxes per plate.
  const trim = bank(BOX, matTrim, 300);
  for (const b of deckList) {
    const az = alongZ(b);
    const L = (az ? b.e[2] : b.e[0]) * 2;
    const r = rot(b);
    for (const sgn of [-1, 1]) {
      const off = (az ? b.e[0] : b.e[2]) + 0.16;
      const p = pt(b, az ? sgn * off : 0, b.e[1] - 0.34, az ? 0 : sgn * off);
      trim.put(p[0], p[1], p[2], az ? 0.5 : L, 0.5, az ? L : 0.5, r[0], r[1], r[2]);
    }
  }
  g.add(trim.seal());

  // ---- icicles under every deck edge, where it is cold enough for them
  const icicles = bank(CONE, matIce, 900);
  for (const b of (icy ? deckList : [])) {
    const n = Math.floor((b.e[0] + b.e[2]) * 1.6);
    for (let i = 0; i < n; i++) {
      const onX = rnd() < 0.5;
      const lx = onX ? (rnd() - 0.5) * b.e[0] * 2 : (rnd() < 0.5 ? -1 : 1) * b.e[0];
      const lz = onX ? (rnd() < 0.5 ? -1 : 1) * b.e[2] : (rnd() - 0.5) * b.e[2] * 2;
      const p = pt(b, lx, -b.e[1], lz);
      const h = 0.5 + rnd() * 2.2;
      icicles.put(p[0], p[1] - h / 2, p[2], 0.09 + rnd() * 0.12, h, 0.09 + rnd() * 0.12, Math.PI, 0, 0);
    }
  }
  g.add(icicles.seal());

  // ---- the handline: posts along the kerbs with rope strung between, stiff
  // with ice. Infrastructure of a rite performed many times.
  const posts = bank(BOX, matDark, 560);
  const rope = bank(BOX, matRope, 560);
  const caps = bank(BOX, matStone, 620);
  for (const k of kerbList) {
    const az = alongZ(k);
    const len = (az ? k.e[2] : k.e[0]) * 2;
    if (len < 8) continue;
    const r = rot(k);
    const n = Math.floor(len / 7);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = -0.5 + i / n;
      const p = pt(k, az ? 0 : t * len, k.e[1], az ? t * len : 0);
      const px = p[0], base = p[1], pz = p[2];
      const h = 1.5 + rnd() * 0.25;
      posts.put(px, base + h / 2, pz, 0.22, h, 0.22);
      const ty = base + h - 0.2;
      if (prev) span(rope, prev[0], prev[1] - 0.35, prev[2], px, ty - 0.35, pz, 0.07);
      prev = [px, ty, pz];
    }
    // capstones with gaps, rather than one unbroken kerb running to infinity
    const cn = Math.max(2, Math.floor(len / 3.2));
    for (let i = 0; i < cn; i++) {
      const t = -0.5 + (i + 0.5) / cn;
      const p = pt(k, az ? 0 : t * len, k.e[1] - 0.05, az ? t * len : 0);
      const seg = (len / cn) * 0.86;
      caps.put(p[0], p[1], p[2],
        az ? k.e[0] * 2 * 1.12 : seg, 0.2, az ? seg : k.e[2] * 2 * 1.12,
        r[0], r[1], r[2]);
    }
  }
  g.add(posts.seal(), rope.seal(), caps.seal());

  // ---- cairns: a bearer apiece, stacked at the edges where you can see them
  const cairnStones = bank(ROCK, matStone, 300);
  for (const k of kerbList) {
    const az = alongZ(k);
    const len = (az ? k.e[2] : k.e[0]) * 2;
    if (len < 14) continue;
    for (let d = 10; d < len - 6; d += 22 + rnd() * 26) {
      const t = -0.5 + d / len;
      const p = pt(k, az ? 0 : t * len, k.e[1], az ? t * len : 0);
      const px = p[0], pz = p[2];
      let y = p[1];
      const stones = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < stones; i++) {
        const rr = (0.55 - i * 0.07) * (0.8 + rnd() * 0.4);
        y += rr * 0.55;
        cairnStones.put(px + (rnd() - 0.5) * 0.18, y, pz + (rnd() - 0.5) * 0.18,
          rr, rr * 0.62, rr, rnd() * 0.3, rnd() * 3, rnd() * 0.3);
        y += rr * 0.32;
      }
    }
  }
  g.add(cairnStones.seal());

  // ---- snow banked against the inside of every kerb. The deck fills most of
  // the frame while you play; a bare one undoes any amount of frozen horizon.
  if (icy) {
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf1f8fb, roughness: 0.93, flatShading: true });
    const drift = bank(ROCK, snowMat, 1200);
    for (const k of kerbList) {
      const az = alongZ(k);
      const len = (az ? k.e[2] : k.e[0]) * 2;
      const n = Math.floor(len / 1.6);
      for (let i = 0; i < n; i++) {
        const t = -0.5 + (i + rnd() * 0.7) / n;
        const inb = (rnd() * 0.5 + 0.45) * (rnd() < 0.5 ? -1 : 1);
        const p = pt(k, az ? inb : t * len, -k.e[1] + 0.12, az ? t * len : inb);
        const w = 0.5 + rnd() * 1.1;
        drift.put(p[0], p[1], p[2],
          az ? w * 0.8 : w * 1.7, 0.16 + rnd() * 0.30, az ? w * 1.7 : w * 0.8,
          0, rnd() * 3, 0);
      }
    }
    g.add(drift.seal());
  }

  // ---- the worn track: generations of bearers have scoured the middle of the
  // road bare. A path within the path, and the clearest possible racing line.
  const trackMat = new THREE.MeshStandardMaterial({
    color: icy ? 0x76858f : 0x413c37, roughness: 0.72, metalness: 0.05,
  });
  const track = bank(BOX, trackMat, 140);
  for (const b of deckList) {
    const az = alongZ(b);
    const w = Math.min(2.6, (az ? b.e[0] : b.e[2]) * 0.9);
    const p = pt(b, 0, b.e[1] + 0.012, 0);
    const r = rot(b);
    track.put(p[0], p[1], p[2],
      az ? w : b.e[0] * 2 * 0.98, 0.02, az ? b.e[2] * 2 * 0.98 : w,
      r[0], r[1], r[2]);
  }
  g.add(track.seal());

  // ---- a bell at the start and at the goal: the rite has a beginning and an end
  for (const [pos, scale] of [[stage.spawn, 1.0], [stage.goal, 1.35]]) {
    const frame = new THREE.Group();
    const postG = new THREE.BoxGeometry(0.22, 3.4, 0.22);
    for (const sx of [-1.1, 1.1]) {
      const m = new THREE.Mesh(postG, matDark);
      m.position.set(sx, 1.7, 0);
      frame.add(m);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.22, 0.22), matDark);
    beam.position.y = 3.4; frame.add(beam);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.62, 0.95, 12, 1, true), matBrass);
    bell.position.y = 2.75; frame.add(bell);
    frame.position.set(pos[0] - 3.6, pos[1] - 0.9, pos[2]);
    frame.scale.setScalar(scale);
    g.add(frame);
  }

  return g;
}


// -------------------------------------------------- props on the frozen sea

export function buildWorldProps(stage, weather) {
  const g = new THREE.Group();
  const rnd = mulberry32(stage.id.length * 5501 + 7);

  const matIce = new THREE.MeshStandardMaterial({ color: 0xc9e0ea, roughness: 0.35, flatShading: true });
  const matFloe = new THREE.MeshStandardMaterial({ color: 0xd6e8ef, roughness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 0.75 });

  let z0 = 1e9, z1 = -1e9;
  for (const b of stage.boxes) { z0 = Math.min(z0, b.c[2]); z1 = Math.max(z1, b.c[2]); }

  // ---- the wrecks. Broken spheres on the floe beneath the route, and a dark
  // shape beside each one. Every bearer before you who did not make it.
  const shards = bank(ROCK, matIce, 260);
  const cores = bank(ROCK, matDark, 40);
  const nWrecks = 9;
  for (let i = 0; i < nWrecks; i++) {
    const wz = z0 + 30 + rnd() * Math.max(40, z1 - z0 - 40);
    const wx = (rnd() - 0.5) * 44;
    const n = 5 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, r = 0.8 + rnd() * 3.4;
      shards.put(wx + Math.cos(a) * r, SEA_Y + 0.5 + rnd() * 0.7, wz + Math.sin(a) * r,
        0.5 + rnd() * 1.1, 0.28 + rnd() * 0.5, 0.5 + rnd() * 1.1,
        rnd() * 3, rnd() * 3, rnd() * 3);
    }
    cores.put(wx + (rnd() - 0.5) * 1.6, SEA_Y + 0.55, wz + (rnd() - 0.5) * 1.6,
      0.5, 0.32, 0.7, rnd() * 0.5, rnd() * 3, rnd() * 0.5);
  }
  g.add(shards.seal(), cores.seal());

  // ---- floes: sheet-ice furniture, so only where there IS a sheet
  if (weather && weather.ground !== 'sea') return g;
  const floes = bank(new THREE.CylinderGeometry(1, 1, 1, 7), matFloe, 240);
  for (let i = 0; i < 240; i++) {
    const a = rnd() * Math.PI * 2, r = 60 + rnd() * 620;
    const s = 4 + rnd() * 26;
    floes.put(Math.cos(a) * r, SEA_Y + 0.35, z0 + (z1 - z0) * 0.5 + Math.sin(a) * r,
      s, 0.7 + rnd() * 1.4, s * (0.6 + rnd() * 0.6), 0, rnd() * 3, 0);
  }
  g.add(floes.seal());

  return g;
}

// ------------------------------------------------------------- heat as objects

/**
 * Vents, not glowing spheres. The thing eating your shell should be readable
 * at distance so the spend-shell decision can be PLANNED, not discovered.
 */
export function buildVent(h, weather) {
  const g = new THREE.Group();
  const rim = new THREE.MeshStandardMaterial({ color: 0x6b4034, roughness: 0.85, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: 0xd4603a, transparent: true, opacity: 0.5, depthWrite: false });
  const rnd = mulberry32(Math.round(h.p[0] * 13 + h.p[2] * 7) >>> 0);

  // a broken rim of scorched rock around the mouth
  const ring = bank(ROCK, rim, 40);
  const n = 16 + Math.floor(rnd() * 10);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
    const r = h.r * (0.26 + rnd() * 0.09);
    const s = h.r * (0.07 + rnd() * 0.07);
    ring.put(Math.cos(a) * r, s * 0.3, Math.sin(a) * r, s, s * (0.7 + rnd()), s, rnd(), rnd() * 3, rnd());
  }
  g.add(ring.seal());

  const mouth = new THREE.Mesh(new THREE.CircleGeometry(h.r * 0.26, 24), glow);
  mouth.rotation.x = -Math.PI / 2;
  mouth.position.y = 0.06;
  g.add(mouth);

  // steam, rising and recycled
  const N = 150;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * h.r * 0.3;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = rnd() * 16;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const steam = new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xe8d8cc, size: 2.6, sizeAttenuation: true, map: softSprite(),
    transparent: true, opacity: 0.16, depthWrite: false,
  }));
  steam.frustumCulled = false;
  steam.userData.spread = h.r * 0.3;
  g.add(steam);
  g.userData.steam = steam;

  g.position.set(h.p[0], h.p[1], h.p[2]);
  return g;
}

export function stepSteam(vent, dt) {
  const s = vent.userData.steam;
  if (!s) return;
  const a = s.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i += 3) {
    a[i + 1] += (2.6 + (i % 7) * 0.25) * dt;
    a[i] += dt * 0.9;
    if (a[i + 1] > 17) {
      a[i + 1] = 0;
      a[i] = (Math.random() - 0.5) * vent.userData.steam.userData.spread * 2;
    }
  }
  s.geometry.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ the flock

/** A dozen dark specks wheeling, far off. Cheapest possible sign of life. */
export function buildFlock() {
  const N = 22;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x1c242a, size: 1.5, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false,
  }));
  pts.frustumCulled = false;
  pts.userData.N = N;
  return pts;
}

export function stepFlock(flock, t, cx, cz) {
  const a = flock.geometry.attributes.position.array;
  const N = flock.userData.N;
  for (let i = 0; i < N; i++) {
    const ph = i * 0.61;
    const rad = 46 + (i % 5) * 9;
    const ang = t * 0.16 + ph;
    a[i * 3] = cx - 120 + Math.cos(ang) * rad;
    a[i * 3 + 1] = 26 + Math.sin(t * 0.5 + ph) * 7 + (i % 4) * 2.5;
    a[i * 3 + 2] = cz + 150 + Math.sin(ang) * rad;
  }
  flock.geometry.attributes.position.needsUpdate = true;
}
