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

const _n = [0, 0, 0];
const _l = [0, 0, 0];
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


/**
 * Snow on the upward faces, baked into vertex colours.
 *
 * A solid-coloured flat-shaded block is the most prototype-looking thing there
 * is: real objects out here are pale where snow settles and dark where it does
 * not. Vertex colours MULTIPLY the material colour, so the material is set to
 * the snow tone and the sides are scaled DOWN toward the rock tone -- lightening
 * is not available, only darkening, which decides the direction of the trick.
 */
export function capTops(geo, rockHex, snowHex) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();
  const nrm = g.attributes.normal, pos = g.attributes.position;
  const rock = new THREE.Color(rockHex), snow = new THREE.Color(snowHex);
  const ratio = new THREE.Color(
    Math.min(1, rock.r / Math.max(1e-3, snow.r)),
    Math.min(1, rock.g / Math.max(1e-3, snow.g)),
    Math.min(1, rock.b / Math.max(1e-3, snow.b)),
  );
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const up = Math.max(0, nrm.getY(i));
    const t = Math.min(1, Math.pow(up, 1.6) * 1.35);   // only near-flat tops hold snow
    c.copy(ratio).lerp(WHITE, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const WHITE = new THREE.Color(1, 1, 1);

/**
 * Contact darkening, faked. Nothing sells "sitting on" like the ground going
 * dark where an object meets it, and the alternative -- real ambient occlusion
 * -- means a depth pre-pass this game has no business paying for. A gradient
 * quad under MultiplyBlending costs one draw call for the whole route.
 */
let _aoTex = null;
function aoTexture() {
  if (_aoTex) return _aoTex;
  const N = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, N);
  grad.addColorStop(0, '#6a6a6a');       // hard against the kerb
  grad.addColorStop(0.45, '#c8c8c8');
  grad.addColorStop(1, '#ffffff');       // and gone a metre away
  g.fillStyle = grad; g.fillRect(0, 0, N, N);
  _aoTex = new THREE.CanvasTexture(cv);
  _aoTex.colorSpace = THREE.SRGBColorSpace;
  return _aoTex;
}
function aoMaterial() {
  return new THREE.MeshBasicMaterial({
    map: aoTexture(), transparent: true, blending: THREE.MultiplyBlending,
    depthWrite: false, fog: true,
    /* A decal a few centimetres above the deck still z-fights with it at
     * grazing angles -- which is most of the time in a game viewed from behind
     * and slightly above. polygonOffset biases it in DEPTH rather than in
     * space, so it wins the test at every angle without floating. */
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ------------------------------------------------------ props ON the causeway

export function buildStageProps(stage, weather) {
  const g = new THREE.Group();
  const rnd = mulberry32(stage.id.length * 2749 + 61);

  // Ironwork and stone are LOCAL: a fixed near-black reads as heavy bars laid
  // over a pale world, and the piers end up dominating the frame.
  const D = (weather && weather.deck) || { stone: 0x7d8892, rail: 0x4a555d };
  const matStone = new THREE.MeshStandardMaterial({ color: D.stone, roughness: 0.92, flatShading: true });
  /* A SEPARATE material for snow-capped geometry. matStone also dresses the kerb
   * capstones, whose plain box geometry carries no colour attribute -- and
   * vertexColors on a geometry without one renders black. */
  const matCapped = new THREE.MeshStandardMaterial({
    color: 0xeff6fa, roughness: 0.9, flatShading: true, vertexColors: true,
  });
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
  /**
   * How much of a box's length a per-box prop may use.
   *
   * arc() sizes its chord segments from the OUTER radius and therefore overlaps
   * its neighbours by about 18% -- deliberately, so the road has no seam to
   * catch on. Anything laid ONE PER BOX inherits that overlap, and two 2cm
   * slabs at the same height fighting for the same pixels is exactly what
   * "clipping in the floor" looks like. Straight plates abut, so they keep the
   * full length.
   */
  const alongFactor = (b) => (Math.abs(rot(b)[1]) > 1e-3 ? 0.82 : 0.98);

  /** Height of the deck surface under (x,z) -- what a prop must stand ON. */
  const deckTopAt = (x, z) => {
    let best = null;
    for (const b of stage.boxes) {
      if (b.kind === 'rail' || b.kind === 'gate' || b.kind === 'block') continue;
      if (b.q) continue;                       // ramps and bends: not a flat stand
      if (Math.abs(x - b.c[0]) > b.e[0] || Math.abs(z - b.c[2]) > b.e[2]) continue;
      const top = b.c[1] + b.e[1];
      if (best === null || top > best) best = top;
    }
    return best;
  };
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
      const seg = (len / cn) * 0.86 * (alongFactor(k) / 0.98);
      caps.put(p[0], p[1], p[2],
        az ? k.e[0] * 2 * 1.12 : seg, 0.2, az ? seg : k.e[2] * 2 * 1.12,
        r[0], r[1], r[2]);
    }
  }
  g.add(posts.seal(), rope.seal(), caps.seal());

  // ---- contact darkening where the deck meets every kerb
  const AOQ = new THREE.PlaneGeometry(1, 1);
  const ao = bank(AOQ, aoMaterial(), 260);
  for (const k of kerbList) {
    const az = alongZ(k);
    const len = (az ? k.e[2] : k.e[0]) * 2;
    if (len < 4) continue;
    const r = rot(k);
    for (const sgn of [-1, 1]) {
      const inb = sgn * ((az ? k.e[0] : k.e[2]) + 0.85);
      const p = pt(k, az ? inb : 0, -k.e[1] + 0.03, az ? 0 : inb);
      // the gradient runs along the quad's local +Y, so face it up and turn it
      ao.put(p[0], p[1], p[2], az ? 1.8 : len, az ? len : 1.8, 1,
        -Math.PI / 2, r[1], az ? (sgn > 0 ? Math.PI : 0) : (sgn > 0 ? -Math.PI / 2 : Math.PI / 2));
    }
  }
  g.add(ao.seal());

  // ---- cairns: a bearer apiece, stacked at the edges where you can see them
  const cairnStones = bank(capTops(ROCK, D.stone, 0xeff6fa), matCapped, 300);
  for (const k of kerbList) {
    const az = alongZ(k);
    const len = (az ? k.e[2] : k.e[0]) * 2;
    if (len < 14) continue;
    for (let d = 10; d < len - 6; d += 22 + rnd() * 26) {
      const t = -0.5 + d / len;
      const p = pt(k, az ? 0 : t * len, k.e[1], az ? t * len : 0);
      const px = p[0], pz = p[2];
      let y = p[1];
      /* Stack by HALF-HEIGHTS. Advancing a fixed fraction of the radius meant
       * each stone rose 0.87r while standing 1.24r tall, so every cairn in the
       * game overlapped itself by about a third and read as clipping rather
       * than as stones resting on stones. */
      const stones = 3 + Math.floor(rnd() * 3);
      let prevH = 0;
      for (let i = 0; i < stones; i++) {
        const rr = (0.55 - i * 0.07) * (0.8 + rnd() * 0.4);
        const h = rr * 0.62;
        y += i === 0 ? h : (prevH + h) * 0.93;      // 0.93 = they settle a little
        cairnStones.put(px + (rnd() - 0.5) * 0.14, y, pz + (rnd() - 0.5) * 0.14,
          rr, h, rr, rnd() * 0.18, rnd() * 3, rnd() * 0.18);
        prevH = h;
      }
    }
  }
  g.add(cairnStones.seal());

  // ---- snow banked against the inside of every kerb. The deck fills most of
  // the frame while you play; a bare one undoes any amount of frozen horizon.
  if (icy) {
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf1f8fb, roughness: 0.93, flatShading: true });
    snowMat.vertexColors = false;
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

  /* ---- the worn track: generations of bearers have scoured the middle of the
   * road bare. A path within the path, and the clearest possible racing line.
   *
   * It follows the ROUTE, not the boxes. Laying one slab per deck box decided
   * the stripe's direction from the box's own proportions -- `e[2] >= e[0]` --
   * which is not the direction anyone travels. An arc segment is 12 wide and 2
   * long and a landing plate is 21 by 16, so both got the stripe laid ACROSS the
   * carriageway, and every bend came out as a scatter of disconnected white
   * slabs lying at angles to the road. That is what read as clipping.
   *
   * Sampling the waypoint polyline instead gives one continuous ribbon that
   * turns with the road and climbs the ramps, and the pieces abut end to end
   * instead of overlapping, so there is nothing for them to fight with.
   */
  const trackMat = new THREE.MeshStandardMaterial({
    color: icy ? 0x8a99a3 : 0x8d9298, roughness: 0.34, metalness: 0.10,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const track = bank(BOX, trackMat, 900);

  /** Top of whatever the ball would stand on at (x,z) -- ramps and bends too. */
  const surfaceTopAt = (x, z) => {
    let best = null;
    for (const b of stage.boxes) {
      if (b.kind === 'rail' || b.kind === 'gate' || b.kind === 'block') continue;
      if (!b.q) {
        if (Math.abs(x - b.c[0]) > b.e[0] || Math.abs(z - b.c[2]) > b.e[2]) continue;
        const top = b.c[1] + b.e[1];
        if (best === null || top > best) best = top;
        continue;
      }
      // rotated: intersect the vertical line with the box's own top plane
      rotV(b.q, 0, 1, 0, _n);
      const ny = _n[1];
      if (Math.abs(ny) < 1e-4) continue;
      const p0x = b.c[0] + b.e[1] * _n[0];
      const p0y = b.c[1] + b.e[1] * ny;
      const p0z = b.c[2] + b.e[1] * _n[2];
      const ty = p0y - (_n[0] * (x - p0x) + _n[2] * (z - p0z)) / ny;
      rotV(b.qc, x - b.c[0], ty - b.c[1], z - b.c[2], _l);
      if (Math.abs(_l[0]) > b.e[0] || Math.abs(_l[2]) > b.e[2]) continue;
      if (best === null || ty > best) best = ty;
    }
    return best;
  };

  const STEP = 2.2;
  for (const route of [stage.waypoints, stage.altRoute]) {
    if (!route) continue;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b2 = route[i + 1];
      const dx = b2[0] - a[0], dz = b2[2] - a[2];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const yaw = Math.atan2(dx, dz);
      const ux = dx / len, uz = dz / len;
      const n = Math.max(1, Math.round(len / STEP));
      const seg = len / n;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = a[0] + dx * t, z = a[2] + dz * t;
        /* Sample the surface at BOTH ends and pitch the piece to match. A flat
         * slab laid on a slope dives under the deck at one end and lifts off it
         * at the other, so only its middle shows -- which is why the stripe came
         * out as a row of dashes up every ramp. */
        const y0 = surfaceTopAt(x - ux * seg / 2, z - uz * seg / 2);
        const y1 = surfaceTopAt(x + ux * seg / 2, z + uz * seg / 2);
        const top = surfaceTopAt(x, z);
        if (top === null) continue;              // over a gap: no stripe
        let pitch = 0, run = seg;
        if (y0 !== null && y1 !== null) {
          pitch = Math.atan2(y0 - y1, seg);      // same sign convention as ramp()
          run = Math.hypot(seg, y1 - y0);
        }
        track.put(x, top + 0.012, z, 2.6, 0.02, run * 1.04, pitch, yaw, 0);
      }
      /* A patch at each interior corner. Two straight runs meeting at an angle
       * leave a wedge open on the outside of the turn however well each one is
       * sized, and a wedge of bare deck inside a continuous stripe reads as the
       * stripe being broken. */
      if (i > 0) {
        const prev = route[i - 1];
        const yaw0 = Math.atan2(a[0] - prev[0], a[2] - prev[2]);
        let d = yaw - yaw0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const top = surfaceTopAt(a[0], a[2]);
        if (top !== null && Math.abs(d) > 0.05) {
          track.put(a[0], top + 0.012, a[2], 2.6, 0.02, 2.6, 0, yaw0 + d / 2, 0);
        }
      }
    }
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
    /* Stand it on the DECK, not on the ball. `pos` is a spawn or a goal, whose
     * y is where the BALL's centre goes -- roughly a radius above the surface,
     * and at the goal not even that. Offsetting from it left both bell frames
     * hanging clear of the road. */
    const fx = pos[0] - 3.6;
    const ground = deckTopAt(fx, pos[2]);
    frame.position.set(fx, ground === null ? pos[1] - 0.9 : ground - 0.04, pos[2]);
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
  /* A vent is BUILT, like everything else on this road.
   *
   * It used to be a ring of scorched red boulders around a glowing disc, which
   * on a grey flagstone causeway read as scenery borrowed from somewhere else.
   * The rest of the world is squared stone, iron and rope, so this is a coped
   * well-head with an iron grille over it: the same three materials, doing an
   * obvious job. The heat then reads as something the road was built AROUND,
   * which is also the fiction -- the bearers stop here to thin the ice.
   */
  const coping = new THREE.MeshStandardMaterial({ color: 0x7c8184, roughness: 0.9, flatShading: true });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.5, metalness: 0.55, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({
    color: 0xc4522c, transparent: true, opacity: 0.30, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const rnd = mulberry32(Math.round(h.p[0] * 13 + h.p[2] * 7) >>> 0);

  // a squared coping course around the mouth, laid like the deck's own trim
  const R = h.r * 0.34;
  const blocks = bank(BOX, coping, 40);
  const per = 5;
  for (const side of [0, 1, 2, 3]) {
    const a = (side * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < per; i++) {
      const t = (i + 0.5) / per - 0.5;
      const len = (R * 2) / per * 0.94;
      const jx = (rnd() - 0.5) * 0.06;
      blocks.put(
        ca * (R + 0.34) - sa * (t * R * 2), 0.22 + jx, sa * (R + 0.34) + ca * (t * R * 2),
        side % 2 ? len : 0.68, 0.44 + jx, side % 2 ? 0.68 : len,
        0, 0, 0,
      );
    }
  }
  g.add(blocks.seal());

  // an iron grille over the mouth -- the same language as the grate colliders
  const bars = bank(BOX, iron, 16);
  const nb = 5;
  for (let i = 0; i < nb; i++) {
    const t = (i + 0.5) / nb - 0.5;
    bars.put(t * R * 1.9, 0.30, 0, 0.13, 0.13, R * 2.0);
  }
  bars.put(0, 0.30, -R * 0.95, R * 2.0, 0.15, 0.15);
  bars.put(0, 0.30, R * 0.95, R * 2.0, 0.15, 0.15);
  g.add(bars.seal());

  const mouth = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 24), glow);
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
