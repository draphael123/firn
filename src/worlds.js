/* FIRN -- worlds.
 *
 * Worlds are not skins. They are BANDS OF THE DESCENT: the route runs down out
 * of the cold into warmth, so each world sits lower and hotter than the last,
 * and `band` (0 = highest and coldest, 1 = lowest and warmest) drives the air,
 * the light and the ground together. Stage difficulty, the melt economy and the
 * look therefore all move in the same direction by construction rather than by
 * being tuned into agreement.
 *
 * A world owns everything level and distant -- ground, ridgelines, ceiling,
 * haze. The causeway is the only thing that tilts, so the horizon a world
 * provides is the fixed reference the tilt is read against.
 *
 * Adding a world is data plus, at most, one ground builder.
 */

import * as THREE from '../vendor/three.module.js';
import { mulberry32 } from './sim.js';

export const GROUND_Y = -74;

const _a = new THREE.Color(), _b = new THREE.Color(), _o = new THREE.Color();
const mix = (x, y, t) => _o.copy(_a.setHex(x)).lerp(_b.setHex(y), t).getHex();

// ---------------------------------------------------------------- descriptors

/**
 * @property band       0 highest/coldest .. 1 lowest/warmest
 * @property ground     which ground builder to run
 * @property ridges     ring specs, or null where the horizon is closed off
 * @property ceiling    { y, colour } for enclosed worlds, else null
 * @property fall       ambient particles: 'snow' | 'spindrift' | 'sleet' | 'drip' | 'ash'
 */
export const WORLDS = {
  neve: {
    id: 'neve', name: 'The Névé', band: 0.0,
    sky: [0x08213c, 0x9dc2d8, 0x123044],
    fog: 0x9dc2d8, fogNear: 40, fogFar: 420,          // whiteout: the horizon is close
    key: 0xf2f8ff, keyPower: 3.4, hemi: 0x8fb2c8, ambient: 2.1,
    deck: { stone: 0x8e9aa2, stone2: 0x7f8b94, rail: 0x5b6771 },
    ground: 'snowfield', groundColor: 0xe9f2f6,
    ridges: [[340, 90, 0x6f8ba0, 0xd8e8f0], [640, 150, 0x88a3b6, 0xe6f1f6]],
    ceiling: null,
    fall: 'spindrift', fallCount: 3200, fallSize: 0.11, fallOpacity: 0.5,
    exposure: 1.72,
  },
  icefall: {
    id: 'icefall', name: 'The Icefall', band: 0.22,
    sky: [0x07253f, 0x7fa8c4, 0x0b1c2a],
    fog: 0x7fa8c4, fogNear: 90, fogFar: 700,
    key: 0xe4f0fb, keyPower: 3.0, hemi: 0x5f8bab, ambient: 1.6,
    deck: { stone: 0x6d7c86, stone2: 0x5c6a74, rail: 0x3f4a53 },
    ground: 'crevasse', groundColor: 0x9ec6d8,
    ridges: [[380, 170, 0x2f4657, 0xa8c8d8], [700, 300, 0x4a6577, 0xc6dce6]],
    ceiling: null,
    fall: 'snow', fallCount: 2400, fallSize: 0.15, fallOpacity: 0.45,
    exposure: 1.75,
  },
  frozensea: {
    id: 'frozensea', name: 'The Frozen Sea', band: 0.45,
    sky: [0x123045, 0x86a8bb, 0x0d151a],
    fog: 0x7ba4bd, fogNear: 130, fogFar: 900,
    key: 0xdcecfa, keyPower: 2.8, hemi: 0x5f88a2, ambient: 1.45,
    deck: { stone: 0x69777f, stone2: 0x58656d, rail: 0x414d55 },
    ground: 'sea', groundColor: 0xb9d2dd,
    ridges: [[300, 120, 0x2c4150, 0x9fbecd], [520, 210, 0x3d5567, 0xbcd4e0], [820, 330, 0x54707f, 0xd2e4ec]],
    ceiling: null,
    fall: 'snow', fallCount: 2200, fallSize: 0.15, fallOpacity: 0.44,
    exposure: 1.8,
  },
  cathedral: {
    id: 'cathedral', name: 'The Cathedral', band: 0.68,
    sky: [0x04121e, 0x14384e, 0x030d15],
    fog: 0x0f2c3e, fogNear: 26, fogFar: 260,          // enclosed: sight is short
    key: 0xbfe2f5, keyPower: 2.2, hemi: 0x2c5c76, ambient: 1.3,
    deck: { stone: 0x5b6a74, stone2: 0x4c5a63, rail: 0x36424b },
    ground: 'cavern', groundColor: 0x7fb6cf,
    ridges: null,                                      // no horizon underground
    ceiling: { y: 46, color: 0x4f8aa6 },
    fall: 'drip', fallCount: 900, fallSize: 0.10, fallOpacity: 0.55,
    exposure: 2.0,
  },
  geothermal: {
    id: 'geothermal', name: 'The Geothermal Field', band: 0.88,
    sky: [0x241f22, 0xa79a8c, 0x140f0c],
    fog: 0xa2968a, fogNear: 46, fogFar: 430,
    key: 0xffe2bc, keyPower: 2.1, hemi: 0x8e8378, ambient: 1.9,
    deck: { stone: 0x6a6459, rail: 0x403b33, stone2: 0x5b5649 },
    ground: 'rock', groundColor: 0x2a2521,
    ridges: [[360, 130, 0x1d1a18, 0x8e857a], [680, 240, 0x2f2a26, 0xa89c8e]],
    ceiling: null,
    fall: 'ash', fallCount: 1100, fallSize: 0.2, fallOpacity: 0.34,
    exposure: 1.9,
  },
  thaw: {
    id: 'thaw', name: 'The Thaw', band: 1.0,
    sky: [0x2b3238, 0x8f9a9c, 0x1a1e20],
    fog: 0x8f9a9c, fogNear: 34, fogFar: 340,
    key: 0xe8e4da, keyPower: 1.8, hemi: 0x7d8688, ambient: 2.0,
    deck: { stone: 0x71787a, stone2: 0x616869, rail: 0x434849 },
    ground: 'rock', groundColor: 0x74786f,
    ridges: [[330, 90, 0x3a3f40, 0x8d9698]],
    ceiling: null,
    fall: 'sleet', fallCount: 1400, fallSize: 0.24, fallOpacity: 0.3,
    exposure: 1.85,
  },
};

export const worldOf = (stage) => WORLDS[stage.world] || WORLDS.frozensea;

/** Fine grading within a world, from the stage's own warmth. */
export function gradeFor(stage) {
  const w = worldOf(stage);
  const heat = Math.max(0, Math.min(1, (stage.warmth || 0) / 0.012));
  return {
    ...w,
    fog: mix(w.fog, 0xb0a496, heat * 0.35),     // hotter stages haze warmer
    fogFar: w.fogFar * (1 - heat * 0.18),
    keyPower: w.keyPower * (1 - heat * 0.12),
    heat,
  };
}

// ------------------------------------------------------------- ridgelines

/** A ring of mountain silhouette, profile from seed-phased layered sines. */
export function ridgeRing(radius, height, baseY, segs, rnd, baseHex, peakHex) {
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const hAt = (a) => Math.max(0.10, Math.min(1,
    0.46 + 0.30 * Math.sin(a * 2 + ph[0]) + 0.18 * Math.sin(a * 5 + ph[1])
         + 0.11 * Math.sin(a * 11 + ph[2]) + 0.06 * Math.sin(a * 23 + ph[3])));
  const pos = [], col = [];
  const cb = new THREE.Color(baseHex), cp = new THREE.Color(peakHex), c = new THREE.Color();
  const push = (x, y, z, t) => { pos.push(x, y, z); c.copy(cb).lerp(cp, t); col.push(c.r, c.g, c.b); };
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const h0 = hAt(a0) * height, h1 = hAt(a1) * height;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    push(x0, baseY, z0, 0); push(x1, baseY, z1, 0); push(x1, baseY + h1, z1, 1);
    push(x0, baseY, z0, 0); push(x1, baseY + h1, z1, 1); push(x0, baseY + h0, z0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, fog: true,
  }));
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------- textures

function sheetIceTexture() {
  const N = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#dbe9ef'; g.fillRect(0, 0, N, N);
  const rnd = mulberry32(5150);
  for (let i = 0; i < 150; i++) {
    g.beginPath();
    const x = rnd() * N, y = rnd() * N, r = 24 + rnd() * 130;
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    const v = 224 + Math.floor(rnd() * 26);
    g.fillStyle = `rgb(${v},${v + 4},${v + 8})`;
    g.fill();
  }
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    g.beginPath();
    let x = rnd() * N, y = rnd() * N;
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (rnd() - 0.5) * 190; y += (rnd() - 0.5) * 190; g.lineTo(x, y); }
    g.strokeStyle = `rgba(96,132,150,${0.18 + rnd() * 0.35})`;
    g.lineWidth = 0.7 + rnd() * 3.4;
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  return t;
}

function rockTexture(hot) {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = hot ? '#241f1b' : '#6f7369'; g.fillRect(0, 0, N, N);
  const rnd = mulberry32(7717);
  for (let i = 0; i < 900; i++) {
    const v = Math.floor(rnd() * 40);
    g.fillStyle = `rgba(${v + 30},${v + 26},${v + 22},.5)`;
    g.fillRect(rnd() * N, rnd() * N, 2 + rnd() * 26, 2 + rnd() * 26);
  }
  if (hot) {                       // glowing fissures
    g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      let x = rnd() * N, y = rnd() * N;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 110; y += (rnd() - 0.5) * 110; g.lineTo(x, y); }
      g.strokeStyle = `rgba(226,110,60,${0.25 + rnd() * 0.5})`;
      g.lineWidth = 0.6 + rnd() * 2.4;
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  return t;
}

/**
 * The causeway surface. Untextured plates read as grey geometry, not as a
 * frozen road, and no amount of background does that job for you -- the deck
 * is what fills most of the frame while you are playing.
 *
 * Snow packed over flagstones, scuffed and cracked, with frost bloom. Warm
 * worlds get wet stone and meltwater instead of snow.
 */
export function deckTexture(world) {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const rnd = mulberry32(world.id.length * 313 + 5);
  const icy = world.band < 0.75;

  /* The base fill MULTIPLIES the material colour, so it must stay near white
   * and let world.deck.stone decide how dark the road is. It used to be
   * #6d6862 for warm worlds, which rendered them at 40% of the authored value:
   * the deck measured L=37 against a 203 sky -- the darkest surface in the
   * game, four times darker than the terrain it crosses, and dark enough that
   * the shadows, the contact darkening and the frost all landed on it
   * invisibly. The wet-stone look belongs in deck.stone, not in here. */
  g.fillStyle = icy ? '#e4eef2' : '#d6d2cb';
  g.fillRect(0, 0, N, N);

  // flagstone joins: the road under the snow
  g.strokeStyle = icy ? 'rgba(120,146,160,.30)' : 'rgba(84,78,70,.34)';
  g.lineWidth = 2;
  const cell = N / 4;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, N); g.stroke();
    const off = (i % 2) * cell * 0.5;
    g.beginPath(); g.moveTo(0, i * cell + off * 0); g.lineTo(N, i * cell); g.stroke();
  }

  // packed snow / wet patches, blotchy so the surface is never uniform
  for (let i = 0; i < 240; i++) {
    const x = rnd() * N, y = rnd() * N, r = 8 + rnd() * 52;
    g.beginPath();
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.7);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.fillStyle = icy
      ? `rgba(255,255,255,${0.12 + rnd() * 0.4})`
      : `rgba(${104 + rnd() * 34 | 0},${104 + rnd() * 32 | 0},${102 + rnd() * 30 | 0},${0.07 + rnd() * 0.13})`;
    g.fill();
  }

  // hairline cracks in the ice glaze
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    g.beginPath();
    let x = rnd() * N, y = rnd() * N;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; g.lineTo(x, y); }
    g.strokeStyle = icy ? `rgba(150,178,192,${0.2 + rnd() * 0.35})` : `rgba(200,120,70,${0.06 + rnd() * 0.14})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.stroke();
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;   // unflagged canvas textures render washed
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ grounds

const ROCKG = new THREE.IcosahedronGeometry(1, 0);
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion();
const _e4 = new THREE.Euler(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3();

function bank(geo, mat, max) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.count = 0; m.frustumCulled = false;
  m.put = (px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    if (m.count >= max) return;
    _q4.setFromEuler(_e4.set(rx, ry, rz));
    _m4.compose(_p4.set(px, py, pz), _q4, _s4.set(sx, sy, sz));
    m.setMatrixAt(m.count++, _m4);
  };
  m.seal = () => { m.instanceMatrix.needsUpdate = true; return m; };
  return m;
}

/** Builds the level, distant ground for a world. Returns a Group. */
export function buildGround(world) {
  const g = new THREE.Group();
  const rnd = mulberry32(world.id.length * 991 + 17);

  const plate = (mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = GROUND_Y;
    return m;
  };

  /* Roughness carries altitude: low ground is wet and reflective because it is
   * melting, high ground is dry and matte. A world where every surface answers
   * light identically looks like one material tinted six ways. */
  const wet = world.band;
  if (world.ground === 'sea') {
    g.add(plate(new THREE.MeshStandardMaterial({
      map: sheetIceTexture(), color: world.groundColor,
      roughness: 0.62 - wet * 0.28, metalness: 0.05 + wet * 0.15,
    })));
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xdcecf2, roughness: 0.5 });
    const b = bank(new THREE.BoxGeometry(1, 1, 1), ridgeMat, 120);
    for (let i = 0; i < 120; i++) {
      const a = rnd() * Math.PI * 2, r = 40 + rnd() * 900;
      b.put(Math.cos(a) * r, GROUND_Y + 0.6, Math.sin(a) * r,
        6 + rnd() * 90, 1.2 + rnd() * 2.6, 1.4 + rnd() * 3, 0, rnd() * Math.PI, 0);
    }
    g.add(b.seal());

  } else if (world.ground === 'snowfield') {
    g.add(plate(new THREE.MeshStandardMaterial({ color: world.groundColor, roughness: 0.9 })));
    // sastrugi: long wind-carved ridges, all combed the same way
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4fafd, roughness: 0.85, flatShading: true });
    const b = bank(ROCKG, mat, 420);
    for (let i = 0; i < 420; i++) {
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 820;
      b.put(Math.cos(a) * r, GROUND_Y + 0.8, Math.sin(a) * r,
        3 + rnd() * 7, 0.7 + rnd() * 2.2, 14 + rnd() * 50, 0, 0.28 + rnd() * 0.14, 0);
    }
    g.add(b.seal());

  } else if (world.ground === 'crevasse') {
    // A broken field: blocks shouldered up out of shadow, gaps between them.
    g.add(plate(new THREE.MeshStandardMaterial({ color: 0x0a1a24, roughness: 0.95 })));
    const pale = new THREE.MeshStandardMaterial({ color: world.groundColor, roughness: 0.35, flatShading: true });
    const deep = new THREE.MeshStandardMaterial({ color: 0x4d8ba8, roughness: 0.3, flatShading: true });
    const b = bank(new THREE.BoxGeometry(1, 1, 1), pale, 520);
    const d = bank(new THREE.BoxGeometry(1, 1, 1), deep, 300);
    for (let i = 0; i < 520; i++) {
      const a = rnd() * Math.PI * 2, r = 34 + rnd() * 780;
      const h = 8 + rnd() * 60;
      const tgt = rnd() < 0.4 ? d : b;
      tgt.put(Math.cos(a) * r, GROUND_Y + h * 0.5, Math.sin(a) * r,
        10 + rnd() * 34, h, 10 + rnd() * 34,
        (rnd() - 0.5) * 0.3, rnd() * Math.PI, (rnd() - 0.5) * 0.3);
    }
    g.add(b.seal(), d.seal());

  } else if (world.ground === 'cavern') {
    g.add(plate(new THREE.MeshStandardMaterial({ color: 0x16394c, roughness: 0.55 })));
    const ice = new THREE.MeshStandardMaterial({ color: world.groundColor, roughness: 0.28, flatShading: true });
    // stalagmites rising, stalactites hanging from the vault
    const up = bank(new THREE.ConeGeometry(1, 1, 6), ice, 400);
    const dn = bank(new THREE.ConeGeometry(1, 1, 6), ice, 500);
    for (let i = 0; i < 400; i++) {
      const a = rnd() * Math.PI * 2, r = 26 + rnd() * 300;
      const h = 6 + rnd() * 40;
      up.put(Math.cos(a) * r, GROUND_Y + h / 2, Math.sin(a) * r, 2 + rnd() * 7, h, 2 + rnd() * 7);
    }
    const cy = world.ceiling.y;
    for (let i = 0; i < 500; i++) {
      const a = rnd() * Math.PI * 2, r = 20 + rnd() * 320;
      const h = 5 + rnd() * 34;
      dn.put(Math.cos(a) * r, cy - h / 2, Math.sin(a) * r, 1.6 + rnd() * 6, h, 1.6 + rnd() * 6, Math.PI, 0, 0);
    }
    g.add(up.seal(), dn.seal());

  } else {  // 'rock'
    // Volcanic, not merely low. The Thaw sits at band 1.0 but is wet grey
    // rock and meltwater -- keying this on band gave it glowing fissures.
    const hot = world.id === 'geothermal';
    g.add(plate(new THREE.MeshStandardMaterial({
      map: rockTexture(hot), color: world.groundColor,
      roughness: hot ? 0.95 : 0.55,          // the thaw is wet rock, and shines
      metalness: hot ? 0.0 : 0.12,
    })));
    const mat = new THREE.MeshStandardMaterial({ color: hot ? 0x1c1815 : 0x63665e, roughness: 0.95, flatShading: true });
    const b = bank(ROCKG, mat, 460);
    for (let i = 0; i < 460; i++) {
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 760;
      const h = 3 + rnd() * 34;
      b.put(Math.cos(a) * r, GROUND_Y + h * 0.4, Math.sin(a) * r,
        5 + rnd() * 20, h, 5 + rnd() * 20, rnd() * 0.4, rnd() * 3, rnd() * 0.4);
    }
    g.add(b.seal());
  }

  // ---- the vault, for enclosed worlds
  if (world.ceiling) {
    const roof = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ color: world.ceiling.color, roughness: 0.4, side: THREE.DoubleSide }),
    );
    roof.rotation.x = Math.PI / 2;
    roof.position.y = world.ceiling.y;
    g.add(roof);
    // shafts of daylight through holes in the roof: the only way out is up
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, r = 40 + rnd() * 220;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(2 + rnd() * 5, 9 + rnd() * 12, world.ceiling.y - GROUND_Y, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xdff2ff, transparent: true, opacity: 0.09,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        }),
      );
      shaft.position.set(Math.cos(a) * r, (world.ceiling.y + GROUND_Y) / 2, Math.sin(a) * r);
      g.add(shaft);
    }
  }

  return g;
}

// -------------------------------------------------------------- the backdrop

/**
 * Everything in the distance that is not ground.
 *
 * The rock field alone reads as scatter: same silhouette, same size, same
 * height, so distance is carried by fog and nothing else. Two things fix that,
 * and only one of them is scenery.
 *
 * SISTER CAUSEWAYS are the important one. This world has a premise -- bearers
 * carrying ice up a built road -- and the player only ever sees the one span
 * under their own ball, so the rite reads as a single corridor rather than
 * something old and enormous. Other roads crossing the fog at other heights,
 * going somewhere you are not, say more about the setting than any amount of
 * terrain. They also give real parallax: verticals at known heights are what
 * let the eye judge distance.
 *
 * The rest is height variance -- spires and monoliths -- because a field whose
 * pieces are all one size has no scale in it.
 *
 * Everything here is instanced and never collides: it is strictly backdrop.
 */
export function buildBackdrop(world, detail = 1) {
  const g = new THREE.Group();
  if (world.ground === 'cavern') return g;      // enclosed: there is no distance
  const rnd = mulberry32(world.id.length * 7717 + 43);
  const q = [0.45, 1.0, 1.6][detail] ?? 1.0;
  /* Nothing may stand inside this. A stage runs to roughly 270 long and the
   * camera sits behind and above the ball, so anything nearer than this is not
   * backdrop -- it is a dark column swiping through the middle of play. */
  const KEEP_OUT = 300;
  const icy = world.band < 0.75;

  const deckMat = new THREE.MeshStandardMaterial({
    color: world.deck.stone, roughness: 0.92, flatShading: true,
  });
  const pierMat = new THREE.MeshStandardMaterial({
    color: world.deck.rail, roughness: 0.95, flatShading: true,
  });
  const stoneMat = new THREE.MeshStandardMaterial({
    color: icy ? world.groundColor : 0x5b5e57, roughness: 0.9, flatShading: true,
  });

  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const SPIRE = new THREE.ConeGeometry(1, 1, 5);

  const spans = Math.round(5 * q);
  const decks = bank(BOX, deckMat, spans * 26 + 8);
  const piers = bank(BOX, pierMat, spans * 26 + 8);

  for (let s = 0; s < spans; s++) {
    // far enough out to be scenery, spread so they never line up
    const bear = rnd() * Math.PI * 2;
    const dist = KEEP_OUT + 40 + rnd() * 340;
    const cx = Math.cos(bear) * dist, cz = Math.sin(bear) * dist;
    const run = rnd() * Math.PI * 2;                  // the way the road heads
    const dx = Math.cos(run), dz = Math.sin(run);
    const y = GROUND_Y + 30 + rnd() * 120;
    const w = 7 + rnd() * 9;
    const segs = 12 + Math.floor(rnd() * 12);
    const segLen = 16 + rnd() * 14;
    // a slack curve, so it is a road and not a ruler
    const bend = (rnd() - 0.5) * 0.02;
    let a = 0;
    for (let i = 0; i < segs; i++) {
      const t = i - segs / 2;
      a += bend;
      const px = cx + dx * t * segLen - dz * a * segLen * t * 0.5;
      const pz = cz + dz * t * segLen + dx * a * segLen * t * 0.5;
      const sag = Math.cos((i / segs - 0.5) * 3.1) * 6;      // it dips in the middle
      decks.put(px, y - sag, pz, w, 2.4, segLen * 1.04, 0, run + a * t, 0);
      if (i % 3 === 0) {
        const h = (y - sag) - GROUND_Y;
        piers.put(px, GROUND_Y + h / 2, pz, w * 0.30, h, w * 0.30);
      }
    }
  }
  g.add(decks.seal(), piers.seal());

  /* Verticals. Strongly varied heights on purpose -- one tall thing next to a
   * short one is what gives a field any sense of scale at all. */
  const nSpire = Math.round(150 * q);
  const spires = bank(SPIRE, stoneMat, nSpire + 4);
  for (let i = 0; i < nSpire; i++) {
    const a = rnd() * Math.PI * 2, r = KEEP_OUT + rnd() * 640;
    const tall = rnd() < 0.22;
    const h = tall ? 60 + rnd() * 130 : 12 + rnd() * 40;
    const w = h * (tall ? 0.10 + rnd() * 0.10 : 0.28 + rnd() * 0.4);
    spires.put(Math.cos(a) * r, GROUND_Y + h / 2, Math.sin(a) * r, w, h, w,
      (rnd() - 0.5) * 0.16, rnd() * 3, (rnd() - 0.5) * 0.16);
  }
  g.add(spires.seal());

  // Monoliths: squared, clustered, obviously RAISED rather than grown. They
  // are the other half of the same argument as the causeways.
  const nMono = Math.round(34 * q);
  const monos = bank(BOX, pierMat, nMono * 4 + 4);
  for (let i = 0; i < nMono; i++) {
    const a = rnd() * Math.PI * 2, r = KEEP_OUT + 60 + rnd() * 420;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const h = 16 + rnd() * 46;
      monos.put(cx + (rnd() - 0.5) * 26, GROUND_Y + h / 2, cz + (rnd() - 0.5) * 26,
        2.5 + rnd() * 4, h, 2.5 + rnd() * 4, (rnd() - 0.5) * 0.10, rnd() * 3, (rnd() - 0.5) * 0.10);
    }
  }
  g.add(monos.seal());

  return g;
}
