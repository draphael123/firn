/* FIRN -- presentation.
 *
 * The sim runs in stage-local space, so rendering is almost free: put every
 * box in one group and rotate the group by the tilt. The ball is a child of
 * that group, which means its stage-local position is already correct.
 *
 * The camera is NOT in the group. It stays in world space with world up, and
 * it never rolls with the stage -- a camera that rolls with the floor is the
 * single fastest way to make a tilt game unplayable.
 *
 * The ball is the meter. Ice is a transmission material whose thickness is
 * driven by `shell`, so as you melt the ice clarifies and the sleeper inside
 * becomes visible. R_MIN is not an arbitrary floor: it is the sleeper's own
 * radius, so shell 0 is literally "the ice is gone".
 */

import * as THREE from '../vendor/three.module.js';
import { T, radiusFor, mulberry32 } from './sim.js';
import { weatherFor, buildStageProps, buildWorldProps, buildVent, stepSteam,
         buildFlock, stepFlock, SEA_Y } from './props.js';

const C = {
  fog:    0x0d151a,
  stone:  0x69777f,
  stone2: 0x58656d,
  rail:   0x414d55,
  warm:   0xa86b52,
  gate:   0x63787f,
  grate:  0x4f6068,
  ice:    0xdbeef5,
  sleeper:0x120f0c,
  ember:  0xd4603a,
  gold:   0xc9a961,
  sky:    0x1b2b35,
  ground: 0x080d11,
};

/** Equirect gradient -> PMREM. Metals and transmission render near-black with
 *  no environment, so this is not optional decoration. */
function makeEnvironment(renderer) {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.00, '#9fc4d6');
  grad.addColorStop(0.42, '#4e6b7c');
  grad.addColorStop(0.52, '#25333d');
  grad.addColorStop(1.00, '#080d11');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;      // unflagged canvas textures render washed
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}


/** How much of the stage tilt the camera offset inherits. See update(). */
const CAM_TILT_FOLLOW = 0.62;

/**
 * A ring of mountain silhouette. Heights come from layered sines with
 * seed-derived phases, so each ring is a different range rather than three
 * copies of one profile at different scales.
 */
function ridgeRing(radius, baseY, height, segs, rnd, baseHex, peakHex) {
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const hAt = (a) => Math.max(0.10, Math.min(1,
      0.46
    + 0.30 * Math.sin(a * 2 + ph[0])
    + 0.18 * Math.sin(a * 5 + ph[1])
    + 0.11 * Math.sin(a * 11 + ph[2])
    + 0.06 * Math.sin(a * 23 + ph[3])));

  const pos = [], col = [];
  const cb = new THREE.Color(baseHex), cp = new THREE.Color(peakHex), c = new THREE.Color();
  const push = (x, y, z, t) => {
    pos.push(x, y, z);
    c.copy(cb).lerp(cp, t);
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const h0 = hAt(a0) * height, h1 = hAt(a1) * height;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    // two triangles, wound so the INSIDE of the ring faces the camera
    push(x0, baseY, z0, 0); push(x1, baseY, z1, 0); push(x1, baseY + h1, z1, 1);
    push(x0, baseY, z0, 0); push(x1, baseY + h1, z1, 1); push(x0, baseY + h0, z0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, depthWrite: true, fog: true,
  }));
  m.frustumCulled = false;
  return m;
}

/** Pale sheet ice, scored with leads and refrozen cracks. */
function makeSeaTexture() {
  const N = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#dbe9ef'; g.fillRect(0, 0, N, N);

  const rnd = mulberry32(5150);
  // broad floes
  for (let i = 0; i < 150; i++) {
    g.beginPath();
    const x = rnd() * N, y = rnd() * N, r = 24 + rnd() * 130;
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const rr = r * (0.7 + rnd() * 0.5);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    const v = 224 + Math.floor(rnd() * 26);
    g.fillStyle = `rgb(${v},${v + 4},${v + 8})`;
    g.fill();
  }
  // dark open leads
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    g.beginPath();
    let x = rnd() * N, y = rnd() * N;
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) {
      x += (rnd() - 0.5) * 190; y += (rnd() - 0.5) * 190;
      g.lineTo(x, y);
    }
    g.strokeStyle = `rgba(96,132,150,${0.18 + rnd() * 0.35})`;
    g.lineWidth = 0.7 + rnd() * 3.4;
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;   // unflagged canvas textures render washed
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.anisotropy = 4;
  return t;
}

/** A soft horizontal band, for haze lying on the ice. */
function makeHazeTexture() {
  const W = 256, H = 64;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(214,232,240,0)');
  grad.addColorStop(0.5, 'rgba(214,232,240,1)');
  grad.addColorStop(1, 'rgba(214,232,240,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // break the band up so it does not read as a printed stripe
  g.globalCompositeOperation = 'destination-out';
  const rnd = mulberry32(77);
  for (let i = 0; i < 70; i++) {
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, 4 + rnd() * 22, 0, Math.PI * 2);
    g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.3})`;
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

export function createRenderer(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x5d8095, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure || 1.75;
  renderer.shadowMap.enabled = !!settings.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export class View {
  constructor(canvas, settings) {
    this.settings = settings;
    this.renderer = createRenderer(canvas, settings);
    this.env = makeEnvironment(this.renderer);

    this.scene = new THREE.Scene();
    /* Fog must reach PAST the furthest ridge ring (820) or aerial perspective
     * turns into a wall and the mountains vanish. Near is set beyond the whole
     * playfield so the causeway itself stays crisp -- fog over the surface you
     * are steering on costs readability and buys nothing. Colour matches the
     * sky's horizon band so distant ridges dissolve into it rather than into a
     * differently-tinted grey. */
    this.scene.fog = new THREE.Fog(0x5d8095, 110, 880);
    this.scene.environment = this.env;

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1400);
    this.camera.position.set(0, 12, -18);
    this.addSky();

    // --- light. A cold key from high behind, a dim warm bounce from below.
    const hemi = new THREE.HemisphereLight(0x5b7f92, 0x1b262c, 1.5);
    this.scene.add(hemi);
    this.hemi = hemi;
    const key = new THREE.DirectionalLight(0xe8f2f7, 2.6);
    key.position.set(-40, 70, -30);
    key.castShadow = !!settings.shadows;
    if (key.castShadow) {
      key.shadow.mapSize.set(1024, 1024);
      const d = 70;
      key.shadow.camera.left = -d; key.shadow.camera.right = d;
      key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
      key.shadow.camera.far = 260; key.shadow.bias = -0.0012;
    }
    this.scene.add(key);
    this.key = key;
    const rim = new THREE.DirectionalLight(0x6d8894, 0.55);
    rim.position.set(30, 18, 60);
    this.scene.add(rim);

    /* The stage tilts about the BALL, not about the world origin.
     *
     * Rotating the whole stage about its origin means a ball 120 units down
     * the course swings ~50 units vertically for 26 degrees of tilt: the
     * geometry sweeps through the camera and the horizon lurches. Pivoting at
     * the ball also happens to be the Monkey Ball read -- the world tilts
     * around you, and you stay put.
     *
     *   world = R * (local - pivot) + pivot
     *
     * stageRoot carries R and +pivot, stageInner carries -pivot. With pivot
     * set to the ball's own stage-local position, the ball's world position is
     * exactly its local position and never moves from tilt at all. */
    this.stageRoot = new THREE.Group();
    this.stageInner = new THREE.Group();
    this.stageRoot.add(this.stageInner);
    this.scene.add(this.stageRoot);
    this.stageGroup = this.stageInner;   // everything else builds into here
    this.solids = [];                    // occlusion targets, set by loadStage
    this.lintels = [];                   // gate crossbars, lit when they refuse you

    this.materials = this.buildMaterials();
    this.buildWorld();
    this.buildBall();
    this.buildSnow();

    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.shake = 0;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._ballWorld = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this.vents = [];
    this.flock = buildFlock();
    this.scene.add(this.flock);
    this.buildSpray();
  }

  /** A gradient dome instead of a flat clear colour. A stage floating in a
   *  single flat grey is the fastest way to look like a tech demo.
   *
   *  Baked into vertex colours on a MeshBasicMaterial rather than written by a
   *  raw ShaderMaterial: a hand-rolled fragment shader skips three's tone
   *  mapping and colour-space chunks, so its output lands several stops dark
   *  and off-hue against everything else in the frame. */
  addSky() {
    const geo = new THREE.SphereGeometry(700, 32, 24);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x123045);
    const mid = new THREE.Color(0x86a8bb);
    const bot = new THREE.Color(0x0d151a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 700;
      if (h > 0) c.copy(mid).lerp(top, Math.pow(h, 0.55));
      else c.copy(mid).lerp(bot, Math.pow(-h, 0.35));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  /** Re-grade the dome. The air changes as the route descends into warmth. */
  tintSky(topHex, midHex, botHex) {
    const geo = this.sky.geometry;
    const pos = geo.attributes.position, col = geo.attributes.color;
    const top = new THREE.Color(topHex), mid = new THREE.Color(midHex), bot = new THREE.Color(botHex);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 700;
      if (h > 0) c.copy(mid).lerp(top, Math.pow(h, 0.55));
      else c.copy(mid).lerp(bot, Math.pow(-h, 0.35));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  /* ------------------------------------------------------------- the world
   *
   * The stage is a causeway over a frozen sea, and ONLY the causeway tilts.
   * Everything built here lives in world space and stays level, so the horizon
   * is a fixed reference you read the tilt against -- which is most of why
   * Monkey Ball's tilt is legible at all. Tilting the background too would just
   * read as the camera rolling.
   *
   * `far` (sea, ridges, haze) rides with the camera so it never runs out.
   * `decor` (seracs) is pinned in place so it passes by and gives speed a scale.
   */
  buildWorld() {
    this.far = new THREE.Group();
    this.scene.add(this.far);
    this.decor = new THREE.Group();
    this.scene.add(this.decor);

    const rnd = mulberry32(9161);

    // --- the frozen sea, far below
    const seaTex = makeSeaTexture();
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(2200, 2200),
      new THREE.MeshStandardMaterial({
        map: seaTex, color: 0xb9d2dd, roughness: 0.62, metalness: 0.05,
      }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_Y;
    this.far.add(sea);

    // pressure ridges cracking the sheet: long low pale wedges
    const crackGeo = new THREE.BoxGeometry(1, 1, 1);
    const crackMat = new THREE.MeshStandardMaterial({ color: 0xdcecf2, roughness: 0.5 });
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(crackGeo, crackMat);
      const a = rnd() * Math.PI * 2, r = 40 + rnd() * 900;
      m.position.set(Math.cos(a) * r, SEA_Y + 0.6, Math.sin(a) * r);
      m.rotation.y = rnd() * Math.PI;
      m.scale.set(6 + rnd() * 90, 1.2 + rnd() * 2.6, 1.4 + rnd() * 3);
      this.far.add(m);
    }

    // --- three rings of ridgeline, palest and haziest furthest out
    this.far.add(ridgeRing(300, SEA_Y, 120, 128, mulberry32(11), 0x2c4150, 0x9fbecd));
    this.far.add(ridgeRing(520, SEA_Y, 210, 128, mulberry32(23), 0x3d5567, 0xbcd4e0));
    this.far.add(ridgeRing(820, SEA_Y, 330, 96, mulberry32(37), 0x54707f, 0xd2e4ec));

    // --- banded haze lying on the ice, so the ridges have air in front of them.
    // Open cylinders centred on the camera: a flat plane goes edge-on as soon
    // as you look along it, which reads as a card popping out of existence.
    const hazeTex = makeHazeTexture();
    this.haze = [];
    for (let i = 0; i < 4; i++) {
      const r = 240 + i * 190;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 66 + i * 26, 40, 1, true),
        new THREE.MeshBasicMaterial({
          map: hazeTex.clone(), transparent: true, opacity: 0.20 - i * 0.035,
          depthWrite: false, fog: false, side: THREE.BackSide,
        }),
      );
      m.material.map.needsUpdate = true;
      m.position.y = SEA_Y + 26 + i * 20;
      m.frustumCulled = false;
      this.haze.push(m);
      this.far.add(m);
    }
  }

  /** Seracs: angular ice blocks shouldered up out of the sea along the route. */
  placeDecor(stage) {
    for (let i = this.decor.children.length - 1; i >= 0; i--) {
      const c = this.decor.children[i];
      c.geometry?.dispose();
      this.decor.remove(c);
    }
    const rnd = mulberry32(stage.id.length * 7717 + 13);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc2dae4, roughness: 0.42, metalness: 0.02, flatShading: true,
    });
    const matDark = new THREE.MeshStandardMaterial({
      color: 0x86a6b4, roughness: 0.55, metalness: 0.02, flatShading: true,
    });

    // span the route so they keep passing the whole way down
    let z0 = 1e9, z1 = -1e9, x0 = 1e9, x1 = -1e9;
    for (const b of stage.boxes) {
      z0 = Math.min(z0, b.c[2]); z1 = Math.max(z1, b.c[2]);
      x0 = Math.min(x0, b.c[0]); x1 = Math.max(x1, b.c[0]);
    }

    for (let i = 0; i < 120; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      // keep well clear of the causeway itself
      const x = (side < 0 ? x0 - 18 : x1 + 18) + side * rnd() * 260;
      const z = z0 - 120 + rnd() * (z1 - z0 + 300);
      const h = 6 + rnd() * 46;
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 0),
        rnd() < 0.35 ? matDark : mat,
      );
      m.position.set(x, SEA_Y + h * 0.42, z);
      m.scale.set(4 + rnd() * 14, h, 4 + rnd() * 14);
      m.rotation.set(rnd() * 0.4 - 0.2, rnd() * Math.PI, rnd() * 0.4 - 0.2);
      this.decor.add(m);
    }
  }

  buildMaterials() {
    const std = (color, roughness, metalness = 0, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    return {
      stone:  std(C.stone, 0.86),
      stone2: std(C.stone2, 0.93),
      rail:   std(C.rail, 0.62, 0.25),
      warm:   std(C.warm, 0.78, 0.02, { emissive: C.ember, emissiveIntensity: 0.18 }),
      gate:   std(C.gate, 0.7, 0.2),
      grate:  std(C.grate, 0.55, 0.45),
    };
  }

  buildBall() {
    const g = new THREE.SphereGeometry(1, 48, 32);
    this.iceMat = this.settings.iceQuality === 'plain'
      ? new THREE.MeshStandardMaterial({
          color: C.ice, roughness: 0.18, metalness: 0.0,
          transparent: true, opacity: 0.72,
        })
      : new THREE.MeshPhysicalMaterial({
          color: C.ice, roughness: 0.12, metalness: 0.0,
          transmission: 1.0, thickness: 1.0, ior: 1.31,
          clearcoat: 0.6, clearcoatRoughness: 0.2,
          attenuationColor: new THREE.Color(0x7fb3c8), attenuationDistance: 1.6,
        });
    this.ice = new THREE.Mesh(g, this.iceMat);
    this.ice.castShadow = !!this.settings.shadows;

    // The sleeper is a FIXED size -- exactly R_MIN. That is what makes shell 0
    // read as "the ice is gone" rather than "the ball got small".
    const sg = new THREE.IcosahedronGeometry(T.R_MIN * 0.9, 0);
    this.sleeperMat = new THREE.MeshStandardMaterial({
      color: C.sleeper, roughness: 0.55, metalness: 0.1,
      emissive: new THREE.Color(C.gold), emissiveIntensity: 0.0,
    });
    this.sleeper = new THREE.Mesh(sg, this.sleeperMat);

    this.ballGroup = new THREE.Group();
    this.ballGroup.add(this.ice);
    this.ballGroup.add(this.sleeper);
    this.stageGroup.add(this.ballGroup);

    // A faint pool of light under the ball so it never detaches from the floor.
    this.glow = new THREE.PointLight(C.gold, 0.0, 8, 2);
    this.ballGroup.add(this.glow);
  }

  /** Snow thrown off the ball. The only near-field motion tied to your speed. */
  buildSpray() {
    const N = 160;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.spray = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xecf6fa, size: 0.16, sizeAttenuation: true,
      transparent: true, opacity: 0.7, depthWrite: false,
    }));
    this.spray.frustumCulled = false;
    this.sprayV = new Float32Array(N * 3);
    this.sprayN = N;
    this.sprayAt = 0;
    this.stageGroup.add(this.spray);
  }

  updateSpray(sim, dt) {
    const a = this.spray.geometry.attributes.position.array;
    const v = this.sprayV;
    const b = sim.ball;
    const speed = Math.hypot(b.v.x, b.v.z);
    // emit from the contact point, backwards, when moving fast on the ground
    if (dt > 0 && b.grounded && speed > 7) {
      const emit = Math.min(5, Math.floor(speed * dt * 14));
      for (let e = 0; e < emit; e++) {
        const i = this.sprayAt = (this.sprayAt + 1) % this.sprayN;
        const j = i * 3;
        a[j] = b.p.x + (Math.random() - 0.5) * b.r;
        a[j + 1] = b.p.y - b.r * 0.8;
        a[j + 2] = b.p.z + (Math.random() - 0.5) * b.r;
        v[j] = -b.v.x * 0.18 + (Math.random() - 0.5) * 2.4;
        v[j + 1] = 1.4 + Math.random() * 2.6;
        v[j + 2] = -b.v.z * 0.18 + (Math.random() - 0.5) * 2.4;
      }
    }
    for (let i = 0; i < this.sprayN; i++) {
      const j = i * 3;
      if (a[j + 1] < -900) continue;
      v[j + 1] -= 16 * dt;
      a[j] += v[j] * dt; a[j + 1] += v[j + 1] * dt; a[j + 2] += v[j + 2] * dt;
      if (a[j + 1] < b.p.y - 3) a[j + 1] = -999;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
  }

  buildSnow() {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 150;
      pos[i * 3 + 1] = Math.random() * 70;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 150;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Untextured points render as hard squares, which up close look like bugs
    // rather than snow. A soft radial sprite costs one 32px canvas.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const cg = cv.getContext('2d');
    const rg = cg.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.4, 'rgba(255,255,255,.55)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = rg; cg.fillRect(0, 0, 32, 32);
    const sprite = new THREE.CanvasTexture(cv);
    sprite.colorSpace = THREE.SRGBColorSpace;
    this.snowMat = new THREE.PointsMaterial({
      color: 0xcfe3ea, size: 0.15, sizeAttenuation: true, map: sprite,
      transparent: true, opacity: 0.45, depthWrite: false,
    });
    this.snow = new THREE.Points(g, this.snowMat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this.snowN = n;
  }

  // ------------------------------------------------------------- stage build

  loadStage(stage) {
    // clear previous geometry but keep the ball
    for (let i = this.stageGroup.children.length - 1; i >= 0; i--) {
      const c = this.stageGroup.children[i];
      if (c === this.ballGroup) continue;
      c.traverse?.((o) => { if (o.geometry && o.geometry !== this.ice.geometry) o.geometry.dispose(); });
      this.stageGroup.remove(c);
    }

    this.solids.length = 0;
    this.lintels = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const b of stage.boxes) {
      if (b.kind === 'grate') { this.addGrate(b); continue; }
      const mat = this.materials[b.kind] || this.materials.stone;
      const m = new THREE.Mesh(box, b.kind === 'stone' && Math.random() < 0.35 ? this.materials.stone2 : mat);
      m.position.set(b.c[0], b.c[1], b.c[2]);
      m.scale.set(b.e[0] * 2, b.e[1] * 2, b.e[2] * 2);
      if (b.rot) m.rotation.set(b.rot[0], b.rot[1], b.rot[2]);
      m.receiveShadow = !!this.settings.shadows;
      m.castShadow = !!this.settings.shadows && b.kind !== 'stone';
      if (b.open !== undefined) { 
        m.material = this.materials.gate.clone();
        this.lintels.push(m);
      }
      this.stageGroup.add(m);
      this.solids.push(m);   // only real geometry occludes; decor must not
    }

    // Weather is derived from the stage's own warmth, so the three stages read
    // as one descent rather than three test tracks.
    const wx = weatherFor(stage);
    this.weather = wx;
    this.scene.fog.color.setHex(wx.fog);
    this.scene.fog.near = wx.fogNear;
    this.scene.fog.far = wx.fogFar;
    this.renderer.setClearColor(wx.fog, 1);
    this.tintSky(wx.skyTop, wx.skyMid, wx.skyBot);
    this.key.color.setHex(wx.keyColor);
    this.key.intensity = wx.keyPower;
    this.hemi.color.setHex(wx.hemiSky);
    this.hemi.intensity = wx.ambient;
    this.snowMat.size = wx.snowSize;
    this.snowMat.opacity = wx.snowOpacity;

    this.vents.length = 0;
    for (const h of stage.heat) this.addHeat(h, wx);
    this.addGoal(stage);
    this.placeDecor(stage);
    this.stageGroup.add(buildStageProps(stage, wx));
    this.decor.add(buildWorldProps(stage, wx));

    // A cold sun for the hot stages, so warmth has a visible source.
    this.key.intensity = 2.1 + Math.min(1.4, stage.warmth * 90);
  }

  /** Grates are drawn as real bars so the gap you fall through is legible. */
  addGrate(b) {
    const g = new THREE.Group();
    const w = b.e[0] * 2, d = b.e[2] * 2;
    const bar = new THREE.BoxGeometry(w, b.e[1] * 2 * 0.7, 0.16);
    const step = b.gap + 0.16;
    for (let z = -d / 2 + step / 2; z < d / 2; z += step) {
      const m = new THREE.Mesh(bar, this.materials.grate);
      m.position.set(0, 0, z);
      m.castShadow = !!this.settings.shadows;
      g.add(m);
    }
    const rail = new THREE.BoxGeometry(0.3, b.e[1] * 2, d);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(rail, this.materials.grate);
      m.position.set(sx * (w / 2 - 0.15), 0, 0);
      g.add(m);
    }
    g.position.set(b.c[0], b.c[1], b.c[2]);
    this.stageGroup.add(g);
  }

  /** Heat is an OBJECT, not a coloured sphere: a scorched vent you can read at
   *  distance, so the spend-shell decision can be planned rather than found. */
  addHeat(h, wx) {
    const vent = buildVent(h, wx);
    this.stageGroup.add(vent);
    this.vents.push(vent);

    const l = new THREE.PointLight(C.ember, Math.min(9, h.q * 70), h.r * 2.2, 2);
    l.position.set(h.p[0], h.p[1] + 1.5, h.p[2]);
    this.stageGroup.add(l);

    // a scorched halo on the deck, so the reach of the heat is legible
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(h.r * 0.3, h.r * 0.98, 40),
      new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(h.p[0], h.p[1] + 0.02, h.p[2]);
    this.stageGroup.add(ring);
  }

  addGoal(stage) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(stage.goalR, 0.09, 10, 48),
      new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0.6 }),
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(stage.goalR * 0.9, stage.goalR * 0.9, 26, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    shaft.position.y = 13;
    g.add(shaft);
    g.add(new THREE.PointLight(C.gold, 5, 22, 2));
    g.position.set(stage.goal[0], stage.goal[1], stage.goal[2]);
    this.stageGroup.add(g);
    this.goalGroup = g;
  }

  // ------------------------------------------------------------- per frame

  update(sim, dt, opts = {}) {
    const s = this.settings;
    const b = sim.ball;

    // --- the stage tilts about the ball; the camera never tilts at all
    this.stageRoot.rotation.set(sim.tilt.x, 0, sim.tilt.z);
    this.stageRoot.position.set(b.p.x, b.p.y, b.p.z);
    this.stageInner.position.set(-b.p.x, -b.p.y, -b.p.z);

    // --- ball
    this.ballGroup.position.set(b.p.x, b.p.y, b.p.z);
    const r = b.r;
    this.ice.scale.setScalar(r);
    const shell = Math.max(0, b.shell);
    // Thick ice is FROSTED and hides what it holds; thin ice is clear and shows
    // it. Getting this the wrong way round -- clearing as it thickens -- throws
    // away the one piece of telemetry the ball is supposed to carry.
    if (this.iceMat.thickness !== undefined) {
      // Transmission is what carries this: near-opaque frosted white at full
      // shell, fully refractive at zero. Driving it with absorption instead
      // made a thick ball DARK, which reads as a bowling ball, not ice.
      this.iceMat.transmission = 1 - shell * 0.74;
      this.iceMat.roughness = 0.05 + shell * 0.44;
      this.iceMat.thickness = 0.15 + shell * 0.9;
      this.iceMat.attenuationDistance = 1.4 + (1 - shell) * 6;
    } else {
      this.iceMat.roughness = 0.05 + shell * 0.44;
      this.iceMat.opacity = 0.44 + shell * 0.56;
    }

    // the sleeper stirs: it glows as the ice thins, and jitters with agitation
    const agit = Math.pow(1 - shell, T.WOBBLE_P);
    this.sleeperMat.emissiveIntensity = agit * 1.5 + b.startle * 0.35;
    this.glow.intensity = agit * 2.2 + b.startle * 0.8;
    const jit = agit * 0.05 * r;
    this.sleeper.position.set(
      Math.sin(sim.time * 5.1) * jit,
      Math.sin(sim.time * 4.3) * jit,
      Math.cos(sim.time * 6.2) * jit,
    );
    this.sleeper.rotation.x += (0.4 + agit * 2.2) * dt;
    this.sleeper.rotation.z += (0.3 + agit * 1.7) * dt;

    // visual roll -- integrate the sim's angular velocity onto the ice
    const w = b.spin;
    const wl = Math.hypot(w.x, w.y, w.z);
    if (wl > 1e-5) {
      this._q.setFromAxisAngle(this._v.set(w.x / wl, w.y / wl, w.z / wl), wl * dt);
      this.ice.quaternion.premultiply(this._q);
    }

    // --- camera. World up, always. Yaw follows travel, heavily lagged.
    this.ballGroup.getWorldPosition(this._ballWorld);
    const vw = this._v.set(b.v.x, 0, b.v.z).applyEuler(this.stageGroup.rotation);
    const speed = Math.hypot(vw.x, vw.z);
    if (speed > 1.4) {
      const want = Math.atan2(vw.x, vw.z);
      let d = want - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * Math.min(1, s.camFollow * dt * Math.min(1, speed / 7));
    }

    const dist = s.camDist + Math.min(6, speed * 0.32);
    const hgt = s.camHeight + Math.min(2.6, speed * 0.1);
    /* The camera offset rides a FRACTION of the stage's tilt.
     *
     * Anchored in world space (factor 0) the deck behind the ball swings up
     * into the camera the moment you pitch forward -- dist * sin(tilt) is over
     * 5 units at full lean, which is more than the camera's height above the
     * floor. That is the "camera gets stuck behind the stage" report.
     *
     * Anchored fully in the stage frame (factor 1) the camera rotates exactly
     * with the floor, so the tilt becomes invisible and the whole read is lost.
     *
     * Partway keeps the floor clear while leaving plenty of visible tilt. The
     * camera's UP stays world-up regardless, so the horizon never rolls. */
    const want = this._camWant || (this._camWant = new THREE.Vector3());
    const off = this._camOff || (this._camOff = new THREE.Vector3());
    const fr = this._camFrame || (this._camFrame = new THREE.Euler());
    fr.set(sim.tilt.x * CAM_TILT_FOLLOW, 0, sim.tilt.z * CAM_TILT_FOLLOW);
    off.set(-Math.sin(this.camYaw) * dist, hgt, -Math.cos(this.camYaw) * dist);
    off.applyEuler(fr);
    want.copy(this._ballWorld).add(off);
    const k = Math.min(1, 6.0 * dt);
    this.camera.position.lerp(want, k);

    // --- do not let the stage get between the camera and the ball.
    // Cast from just above the ball out to where the camera wants to sit; if
    // anything solid is in the way, ride in front of it.
    if (this.solids.length) {
      const from = this._rayFrom || (this._rayFrom = new THREE.Vector3());
      const dir = this._rayDir || (this._rayDir = new THREE.Vector3());
      from.copy(this._ballWorld); from.y += 0.6;
      dir.copy(this.camera.position).sub(from);
      const want2 = dir.length();
      if (want2 > 0.01) {
        dir.divideScalar(want2);
        this._ray.set(from, dir);
        this._ray.far = want2;
        const hits = this._ray.intersectObjects(this.solids, false);
        if (hits.length) {
          const d = Math.max(1.6, hits[0].distance - 0.55);
          this.camera.position.copy(from).addScaledVector(dir, d);
        }
      }
    }

    this.camLook.lerp(
      (this._lookWant || (this._lookWant = new THREE.Vector3())).set(
        this._ballWorld.x + vw.x * 0.16,
        this._ballWorld.y + 1.2,
        this._ballWorld.z + vw.z * 0.16,
      ),
      Math.min(1, 8 * dt),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);

    // dt is 0 on paused and result screens. Without this guard the decay term
    // pow(0.02, 0) is 1, so the shake never dies and the camera jitters behind
    // every menu for as long as it is open.
    if (dt > 0 && this.shake > 0.001 && s.shake) {
      const a = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.shake *= Math.pow(0.02, dt);
    } else this.shake = 0;

    // The sea, ridges and haze ride with the camera horizontally so they never
    // run out; their height is fixed, so they still read as far below.
    this.far.position.x = this.camera.position.x;
    this.far.position.z = this.camera.position.z;
    if (this.haze) {
      for (let i = 0; i < this.haze.length; i++) {
        this.haze[i].rotation.y += dt * (0.004 + i * 0.0022);
      }
    }

    for (const v of this.vents) stepSteam(v, dt);
    stepFlock(this.flock, sim.time, this.camera.position.x, this.camera.position.z);
    this.updateSpray(sim, dt);
    this.updateSnow(dt);
    if (this.goalGroup) this.goalGroup.rotation.y += dt * 0.35;

    // A gate that refuses you should say so in the world, not only the HUD.
    if (this.lintels.length) {
      const lit = sim.gateBlock ? 0.55 + 0.35 * Math.sin(sim.time * 9) : 0;
      for (const l of this.lintels) {
        l.material.emissive.setHex(0xd4603a);
        l.material.emissiveIntensity += (lit - l.material.emissiveIntensity) * Math.min(1, 12 * dt);
      }
    }
  }

  updateSnow(dt) {
    if (!this.settings.snow) { this.snow.visible = false; return; }
    this.snow.visible = true;
    const p = this.snow.geometry.attributes.position;
    const a = p.array;
    const c = this.camera.position;
    // Polar wind: snow is driven sideways far more than it falls, and gusts
    // rather than streaming evenly. Straight-down snow reads as a screensaver.
    this._gust = (this._gust || 0) + dt;
    const gust = 1 + 0.55 * Math.sin(this._gust * 0.37) + 0.25 * Math.sin(this._gust * 1.13);
    const fall = 3.0 * dt, drift = 7.5 * gust * dt, sway = 1.6 * gust * dt;
    for (let i = 0; i < this.snowN; i++) {
      const j = i * 3;
      a[j + 1] -= fall;
      a[j] += drift;
      a[j + 2] += sway * Math.sin(a[j + 1] * 0.35 + i);
      if (a[j + 1] < c.y - 30) a[j + 1] = c.y + 40;
      if (a[j] - c.x > 75) a[j] -= 150; else if (a[j] - c.x < -75) a[j] += 150;
      if (a[j + 2] - c.z > 75) a[j + 2] -= 150; else if (a[j + 2] - c.z < -75) a[j + 2] += 150;
    }
    p.needsUpdate = true;
  }

  /** Drop the camera straight onto the ball, for stage start and restarts. */
  snapCamera(sim) {
    const b = sim.ball;
    this.stageRoot.rotation.set(sim.tilt.x, 0, sim.tilt.z);
    this.stageRoot.position.set(b.p.x, b.p.y, b.p.z);
    this.stageInner.position.set(-b.p.x, -b.p.y, -b.p.z);
    this.ballGroup.position.set(b.p.x, b.p.y, b.p.z);
    this.ballGroup.getWorldPosition(this._ballWorld);
    this.camYaw = 0;
    this.camera.position.set(
      this._ballWorld.x, this._ballWorld.y + this.settings.camHeight, this._ballWorld.z - this.settings.camDist,
    );
    this.camLook.copy(this._ballWorld);
    this.camera.lookAt(this.camLook);
  }

  applySettings(settings) {
    const prevIce = this.settings.iceQuality;
    this.settings = settings;
    this.renderer.toneMappingExposure = settings.exposure;
    if (settings.iceQuality !== prevIce) {
      this.iceMat.dispose();
      const keep = this.ice.geometry;
      this.stageGroup.remove(this.ballGroup);
      this.buildBall();
      keep.dispose?.();
    }
    this.renderer.shadowMap.enabled = !!settings.shadows;
    this.key.castShadow = !!settings.shadows;
    this.ice.castShadow = !!settings.shadows;
    this.snowMat.opacity = settings.snow === 2 ? 0.62 : 0.42;
    this.snowMat.size = settings.snow === 2 ? 0.2 : 0.14;
  }

  resize(w, h, scale) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
