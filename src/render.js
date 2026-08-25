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
import { buildBall, updateBall, ballImpact } from './ball.js';
import { Director } from './camera.js';
import { buildStageProps, buildWorldProps, buildVent, stepSteam,
         buildFlock, stepFlock, softSprite } from './props.js';
import { worldOf, gradeFor, buildGround, buildBackdrop, ridgeRing, deckTexture, GROUND_Y } from './worlds.js';

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
    this.addSun();

    // --- light. A cold key from high behind, a dim warm bounce from below.
    const hemi = new THREE.HemisphereLight(0x5b7f92, 0x1b262c, 1.5);
    this.scene.add(hemi);
    this.hemi = hemi;
    const key = new THREE.DirectionalLight(0xe8f2f7, 2.6);
    key.position.set(-40, 70, -30);
    key.castShadow = !!settings.shadows;
    /* The shadow camera is an orthographic box that has to CONTAIN what it
     * shadows. Parked at the world origin at +-70 it covered the first third of
     * a stage and nothing else: everything past that was lit with no contact
     * shadow at all, which is exactly why props read as pasted onto the deck
     * rather than sitting on it. It follows the ball now, so the box can also
     * be smaller -- and a smaller box over the same 2048 map is sharper. */
    if (key.castShadow) {
      key.shadow.mapSize.set(2048, 2048);
      const d = 46;
      key.shadow.camera.left = -d; key.shadow.camera.right = d;
      key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 220;
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.035;
    }
    this.scene.add(key);
    this.scene.add(key.target);          // a DirectionalLight aims at its target
    this.key = key;
    this.keyOffset = new THREE.Vector3(-34, 62, -26);
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

    /* Kept in step with the director every frame in update(). It used to be
     * assigned here and nowhere else, which silently reduced camera-relative
     * steering to an identity transform. */
    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._ballWorld = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this.director = new Director(this.camera, settings);
    this.vents = [];
    this.burst = 0;
    this.flock = buildFlock();
    this.scene.add(this.flock);
    this.buildSpray();
    this.buildChips();
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
      /* Cloud banding. A pure vertical ramp reads as a painted backdrop rather
       * than as air; a few soft bands, strongest near the horizon where cloud
       * actually stacks up, are enough to put depth in it. */
      if (h > -0.05) {
        const band = Math.sin(h * 24) * 0.5 + Math.sin(h * 57 + 1.7) * 0.3;
        c.offsetHSL(0, 0, band * 0.032 * Math.max(0, 1 - Math.abs(h) * 2.6));
      }
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
    // `far` holds whatever the current world puts on the horizon and rides with
    // the camera; `decor` holds landmarks pinned in place so they pass by.
    this.far = new THREE.Group();
    this.scene.add(this.far);
    this.decor = new THREE.Group();
    this.scene.add(this.decor);
    this.ground = null;
    this.hazeTex = makeHazeTexture();
    this.haze = [];
  }

  /**
   * Swap the level world in. Everything here is world-scale and stays LEVEL --
   * only the causeway tilts, so this is the fixed horizon the tilt reads
   * against.
   */
  applyWorld(stage) {
    const W = gradeFor(stage);
    this.world = W;

    for (let i = this.far.children.length - 1; i >= 0; i--) {
      const c = this.far.children[i];
      c.traverse?.((o) => o.geometry?.dispose());
      this.far.remove(c);
    }
    this.haze.length = 0;

    this.far.add(buildGround(W));
    this.far.add(buildBackdrop(W, this.settings.detail ?? 1));
    if (W.ridges) {
      let k = 0;
      for (const [radius, height, base, peak] of W.ridges) {
        this.far.add(ridgeRing(radius, height, GROUND_Y, 120, mulberry32(11 + k * 29), base, peak));
        k++;
      }
    }
    // haze bands, unless we are underground where there is no distance to fill
    if (!W.ceiling) {
      for (let i = 0; i < 4; i++) {
        const r = 240 + i * 190;
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, 66 + i * 26, 40, 1, true),
          new THREE.MeshBasicMaterial({
            map: this.hazeTex, transparent: true, opacity: 0.20 - i * 0.035,
            depthWrite: false, fog: false, side: THREE.BackSide,
          }),
        );
        m.position.y = GROUND_Y + 26 + i * 20;
        m.frustumCulled = false;
        this.haze.push(m);
        this.far.add(m);
      }
    }

    // ---- air and light
    this.scene.fog.color.setHex(W.fog);
    this.scene.fog.near = W.fogNear;
    this.scene.fog.far = W.fogFar;
    this.renderer.setClearColor(W.fog, 1);
    this.tintSky(W.sky[0], W.sky[1], W.sky[2]);
    this.key.color.setHex(W.key);
    this.key.intensity = W.keyPower;
    this.hemi.color.setHex(W.hemi);
    this.hemi.intensity = W.ambient;
    this.renderer.toneMappingExposure = this.settings.exposure * (W.exposure / 1.8);
    this.sky.visible = !W.ceiling;

    // ---- the causeway is built of local stone, so it changes with the world
    this.deckTex?.dispose();
    this.deckTex = deckTexture(W);
    for (const k of ['stone', 'stone2', 'rail', 'gate']) {
      this.materials[k].map = this.deckTex;
      this.materials[k].needsUpdate = true;
    }
    this.materials.stone.color.setHex(W.deck.stone);
    this.materials.stone2.color.setHex(W.deck.stone2);
    this.materials.rail.color.setHex(W.deck.rail);

    // ---- what falls out of the sky here
    this.snowMat.size = W.fallSize;
    this.snowMat.opacity = W.fallOpacity;
    this.snowMat.color.setHex(W.fall === 'ash' ? 0x6b6058 : W.fall === 'sleet' ? 0xc4d0d4 : 0xcfe3ea);
    this.fallKind = W.fall;
  }

  /** Seracs: angular ice blocks shouldered up out of the sea along the route. */
  placeDecor(stage) {
    const iceWorld = ['sea', 'crevasse', 'snowfield'].includes(this.world.ground);
    for (let i = this.decor.children.length - 1; i >= 0; i--) {
      const c = this.decor.children[i];
      c.geometry?.dispose();
      this.decor.remove(c);
    }
    const rnd = mulberry32(stage.id.length * 7717 + 13);
    const mat = new THREE.MeshStandardMaterial({
      color: iceWorld ? 0xc2dae4 : 0x4a443d, roughness: 0.42, metalness: 0.02, flatShading: true,
    });
    const matDark = new THREE.MeshStandardMaterial({
      color: iceWorld ? 0x86a6b4 : 0x322e29, roughness: 0.55, metalness: 0.02, flatShading: true,
    });

    // span the route so they keep passing the whole way down
    let z0 = 1e9, z1 = -1e9, x0 = 1e9, x1 = -1e9;
    for (const b of stage.boxes) {
      z0 = Math.min(z0, b.c[2]); z1 = Math.max(z1, b.c[2]);
      x0 = Math.min(x0, b.c[0]); x1 = Math.max(x1, b.c[0]);
    }

    for (let i = 0; i < (iceWorld ? 120 : 40); i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      // keep well clear of the causeway itself
      const x = (side < 0 ? x0 - 18 : x1 + 18) + side * rnd() * 260;
      const z = z0 - 120 + rnd() * (z1 - z0 + 300);
      const h = 6 + rnd() * 46;
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 0),
        rnd() < 0.35 ? matDark : mat,
      );
      m.position.set(x, GROUND_Y + h * 0.42, z);
      m.scale.set(4 + rnd() * 14, h, 4 + rnd() * 14);
      m.rotation.set(rnd() * 0.4 - 0.2, rnd() * Math.PI, rnd() * 0.4 - 0.2);
      this.decor.add(m);
    }
  }

  /** A soft additive billboard. Stands in for bloom, which would need a post
   *  chain the vendored three core does not ship. */
  static glowSprite(color, size, opacity) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(255,255,255,.55)');
    rg.addColorStop(0.6, 'rgba(255,255,255,.13)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    spr.scale.setScalar(size);
    return spr;
  }

  /** The sun, and the haze around it. A pure vertical ramp has no light IN it. */
  addSun() {
    this.sun = new THREE.Group();
    const disc = View.glowSprite(0xfff4e0, 44, 0.85);
    const halo = View.glowSprite(0xdfeaf6, 190, 0.28);
    this.sun.add(halo, disc);
    this.sun.frustumCulled = false;
    this.scene.add(this.sun);
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
    this.B = buildBall(this.settings);
    this.ballGroup = this.B.group;
    this.iceMat = this.B.iceMat;          // applySettings still reads this
    this.stageGroup.add(this.ballGroup);
  }

  /** Flash the fracture lattice and jolt the passenger. */
  impact(sim, speed) {
    ballImpact(this.B, speed);
    this.landingPuff(sim, speed);
  }

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

  /** Flakes shed by the ice itself as it melts, and a vapour wake at speed.
   *  Both are tied to values the player is already watching, so they read as
   *  information rather than confetti. */
  buildChips() {
    const mk = (n, mat) => {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos[i * 3 + 1] = -9999;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const p = new THREE.Points(g, mat);
      p.frustumCulled = false;
      this.stageGroup.add(p);
      return p;
    };
    this.chips = mk(140, new THREE.PointsMaterial({
      color: 0xdff2fa, size: 0.11, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.chipV = new Float32Array(140 * 3);
    this.chipN = 140; this.chipAt = 0;

    this.trail = mk(90, new THREE.PointsMaterial({
      color: 0xd8ecf5, size: 0.9, sizeAttenuation: true, map: softSprite(),
      transparent: true, opacity: 0.30, depthWrite: false,
    }));
    this.trailLife = new Float32Array(90);
    this.trailN = 90; this.trailAt = 0;
  }

  updateChips(sim, dt) {
    const b = sim.ball;
    // ---- shed flakes in proportion to how fast the shell is going
    const ca = this.chips.geometry.attributes.position.array, cv = this.chipV;
    if (dt > 0 && sim.meltLast > 0.006 && b.shell > 0) {
      const n = Math.min(3, Math.floor(sim.meltLast * 140 * dt * 60));
      for (let e = 0; e < n; e++) {
        const i = this.chipAt = (this.chipAt + 1) % this.chipN;
        const j = i * 3;
        const a = Math.random() * 6.283, u = Math.random() * 2 - 1, w = Math.sqrt(1 - u * u);
        ca[j] = b.p.x + Math.cos(a) * w * b.r;
        ca[j + 1] = b.p.y + u * b.r;
        ca[j + 2] = b.p.z + Math.sin(a) * w * b.r;
        cv[j] = -b.v.x * 0.1 + (Math.random() - 0.5) * 2;
        cv[j + 1] = 0.6 + Math.random() * 1.8;
        cv[j + 2] = -b.v.z * 0.1 + (Math.random() - 0.5) * 2;
      }
    }
    for (let i = 0; i < this.chipN; i++) {
      const j = i * 3;
      if (ca[j + 1] < -9000) continue;
      cv[j + 1] -= 14 * dt;
      ca[j] += cv[j] * dt; ca[j + 1] += cv[j + 1] * dt; ca[j + 2] += cv[j + 2] * dt;
      if (ca[j + 1] < b.p.y - 4) ca[j + 1] = -9999;
    }
    this.chips.geometry.attributes.position.needsUpdate = true;

    // ---- vapour wake, only fast and only if wanted
    const ta = this.trail.geometry.attributes.position.array;
    const speed = Math.hypot(b.v.x, b.v.z);
    this.trail.visible = !!this.settings.trail;
    if (dt > 0 && this.settings.trail && speed > 9) {
      const i = this.trailAt = (this.trailAt + 1) % this.trailN;
      const j = i * 3;
      ta[j] = b.p.x; ta[j + 1] = b.p.y; ta[j + 2] = b.p.z;
      this.trailLife[i] = 1;
    }
    for (let i = 0; i < this.trailN; i++) {
      if (this.trailLife[i] <= 0) continue;
      this.trailLife[i] -= dt * 1.8;
      if (this.trailLife[i] <= 0) ta[i * 3 + 1] = -9999;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  /** A burst of the surface where the ball landed, plus a kick in the lens. */
  landingPuff(sim, speed) {
    const b = sim.ball;
    const a = this.spray.geometry.attributes.position.array, v = this.sprayV;
    const n = Math.min(22, Math.round(speed * 3));
    for (let e = 0; e < n; e++) {
      const i = this.sprayAt = (this.sprayAt + 1) % this.sprayN;
      const j = i * 3;
      const ang = Math.random() * 6.283, rad = Math.random() * b.r;
      a[j] = b.p.x + Math.cos(ang) * rad;
      a[j + 1] = b.p.y - b.r * 0.85;
      a[j + 2] = b.p.z + Math.sin(ang) * rad;
      v[j] = Math.cos(ang) * (1.5 + speed * 0.35);
      v[j + 1] = 1.5 + Math.random() * speed * 0.35;
      v[j + 2] = Math.sin(ang) * (1.5 + speed * 0.35);
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.director.kick(Math.min(1, speed * 0.09));
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
      c.traverse?.((o) => o.geometry?.dispose());
      this.stageGroup.remove(c);
    }

    this.solids.length = 0;
    this.lintels = [];
    /* One shared unit box would stretch the surface texture differently on
     * every plate. Scale each box's UVs by its own size so a 6m kerb and a 60m
     * plate show the same size of flagstone. Cached by size, so a stage with
     * forty boxes builds a handful of geometries. */
    const TILE = 7;
    const uvCache = new Map();
    const boxFor = (sx, sy, sz) => {
      const key = `${sx.toFixed(1)}_${sy.toFixed(1)}_${sz.toFixed(1)}`;
      let g = uvCache.get(key);
      if (g) return g;
      g = new THREE.BoxGeometry(1, 1, 1);
      const uv = g.attributes.uv;
      const per = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      for (let f = 0; f < 6; f++) {
        const su = per[f][0] / TILE, sv = per[f][1] / TILE;
        for (let i = 0; i < 4; i++) {
          const k = f * 4 + i;
          uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
        }
      }
      uv.needsUpdate = true;
      uvCache.set(key, g);
      return g;
    };
    const pick = mulberry32(stage.id.length * 131 + 7);
    for (const b of stage.boxes) {
      if (b.kind === 'grate') { this.addGrate(b); continue; }
      const mat = this.materials[b.kind] || this.materials.stone;
      const sx = b.e[0] * 2, sy = b.e[1] * 2, sz = b.e[2] * 2;
      const m = new THREE.Mesh(boxFor(sx, sy, sz), b.kind === 'stone' && pick() < 0.35 ? this.materials.stone2 : mat);
      m.position.set(b.c[0], b.c[1], b.c[2]);
      m.scale.set(sx, sy, sz);
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

    this.applyWorld(stage);
    const wx = this.world;

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

    const gl = View.glowSprite(C.ember, h.r * 0.85, 0.32);
    gl.position.set(h.p[0], h.p[1] + 0.6, h.p[2]);
    this.stageGroup.add(gl);

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
    g.add(View.glowSprite(C.gold, 9, 0.5));       // stands in for bloom
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

    updateBall(this.B, sim, dt, this.settings);

    this.director.update(this, sim, dt);
    // The steering transform reads this; it is the camera's heading around the
    // ball, and it has to be refreshed wherever the director moves the camera.
    this.camYaw = this.director.yaw;

    // Carry the shadow box with the ball, or it only shadows the start.
    // the sun sits far off along the key light's own direction
    this.sun.position.copy(this._ballWorld)
      .addScaledVector(this.keyOffset, 7.5);

    this.key.position.copy(this._ballWorld).add(this.keyOffset);
    this.key.target.position.copy(this._ballWorld);
    this.key.target.updateMatrixWorld();

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
    this.updateChips(sim, dt);
    this.updateSnow(dt);
    if (this.goalGroup) {
      this.goalGroup.rotation.y += dt * (0.35 + this.burst * 6);
      // the arrival: the ring opens out and lets go
      if (this.burst > 0.001) {
        this.burst = Math.max(0, this.burst - dt * 1.1);
        const k = 1 + (1 - this.burst) * 2.6 * (this.burst > 0 ? 1 : 0);
        this.goalGroup.scale.setScalar(1 + (1 - this.burst) * 1.8);
        this.goalGroup.children.forEach((c) => {
          if (c.material && c.material.opacity !== undefined) c.material.opacity = this.burst * 0.5;
          if (c.isPointLight) c.intensity = 5 + this.burst * 40;
        });
      } else if (this.goalGroup.scale.x !== 1) {
        this.goalGroup.scale.setScalar(1);
      }
    }

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

  /** The arrival. */
  goalBurst() { this.burst = 1; }

  /** Drop the camera straight onto the ball, for stage start and restarts. */
  /** Drop the camera straight onto the ball, for stage start and restarts. */
  snapCamera(sim) {
    const b = sim.ball;
    this.stageRoot.rotation.set(sim.tilt.x, 0, sim.tilt.z);
    this.stageRoot.position.set(b.p.x, b.p.y, b.p.z);
    this.stageInner.position.set(-b.p.x, -b.p.y, -b.p.z);
    this.ballGroup.position.set(b.p.x, b.p.y, b.p.z);
    this.ballGroup.getWorldPosition(this._ballWorld);
    this.director.snap(this, sim);
    this.camYaw = this.director.yaw;
  }

  /** The camera director: `follow` in play, plus intro / arrival / fall / wake. */
  shot(mode, dur) { this.director.set(mode, dur, this); }

  get shake() { return this.director.shake; }
  set shake(v) { this.director.shake = v; }
  get speedFrac() { return this.director.speedFrac; }

  applySettings(settings) {
    const prevIce = this.settings.iceQuality;
    this.settings = settings;
    this.director.settings = settings;
    this.renderer.toneMappingExposure = settings.exposure;
    if (settings.iceQuality !== prevIce) {
      this.stageGroup.remove(this.ballGroup);
      this.ballGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      this.buildBall();
    }
    this.renderer.shadowMap.enabled = !!settings.shadows;
    this.key.castShadow = !!settings.shadows;
    this.B.ice.castShadow = !!settings.shadows;
    this.snowMat.opacity = settings.snow === 2 ? 0.62 : 0.42;
    this.snowMat.size = settings.snow === 2 ? 0.2 : 0.14;
  }

  resize(w, h, scale) {
    /* Phones report device pixel ratios of 3 and up. Honouring even 2 of that
     * means shading four times as many pixels as the panel can resolve at arm's
     * length, which is where a handset's frame budget actually goes. Cap it by
     * how many pixels we would end up pushing rather than by the ratio alone,
     * so a small dense screen and a large one both land somewhere sane. */
    const dpr = window.devicePixelRatio || 1;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const cap = coarse ? 1.5 : 2;
    const budget = coarse ? 2.6e6 : 6.0e6;            // pixels actually rendered
    let pr = Math.min(dpr, cap) * scale;
    if (w * h * pr * pr > budget) pr = Math.sqrt(budget / (w * h));
    this.renderer.setPixelRatio(Math.max(0.55, pr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
