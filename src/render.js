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
import { T, radiusFor } from './sim.js';

const C = {
  fog:    0x0d151a,
  stone:  0x8c9aa2,
  stone2: 0x76858e,
  rail:   0x5d6d77,
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

export function createRenderer(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x3c5666, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure || 2.1;
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
    // Fog has to sit ON the horizon colour or the stage dissolves into a
    // different grey than the sky behind it and everything reads flat.
    this.scene.fog = new THREE.Fog(0x3c5666, 90, 340);
    this.scene.environment = this.env;

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1400);
    this.camera.position.set(0, 12, -18);
    this.addSky();

    // --- light. A cold key from high behind, a dim warm bounce from below.
    const hemi = new THREE.HemisphereLight(0x5b7f92, 0x1b262c, 1.5);
    this.scene.add(hemi);
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

    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);

    this.materials = this.buildMaterials();
    this.buildBall();
    this.buildSnow();

    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.shake = 0;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._ballWorld = new THREE.Vector3();
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
    const top = new THREE.Color(0x1a3446);
    const mid = new THREE.Color(0x5d8095);
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
      this.stageGroup.add(m);
    }

    for (const h of stage.heat) this.addHeat(h);
    this.addGoal(stage);

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

  addHeat(h) {
    const geo = new THREE.SphereGeometry(h.r, 20, 14);
    const mat = new THREE.MeshBasicMaterial({
      color: C.ember, transparent: true, opacity: 0.055,
      depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(h.p[0], h.p[1], h.p[2]);
    m.userData.heat = true;
    this.stageGroup.add(m);

    const l = new THREE.PointLight(C.ember, Math.min(9, h.q * 70), h.r * 2.2, 2);
    l.position.set(h.p[0], h.p[1] + 1.5, h.p[2]);
    this.stageGroup.add(l);

    // a scorched ring on the deck, so the danger reads from a distance
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(h.r * 0.25, h.r * 0.98, 40),
      new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
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

    // --- the stage tilts; the camera never does
    this.stageGroup.rotation.set(sim.tilt.x, 0, sim.tilt.z);

    // --- ball
    this.ballGroup.position.set(b.p.x, b.p.y, b.p.z);
    const r = b.r;
    this.ice.scale.setScalar(r);
    const shell = Math.max(0, b.shell);
    // Thick ice is FROSTED and hides what it holds; thin ice is clear and shows
    // it. Getting this the wrong way round -- clearing as it thickens -- throws
    // away the one piece of telemetry the ball is supposed to carry.
    if (this.iceMat.thickness !== undefined) {
      this.iceMat.roughness = 0.05 + shell * 0.40;
      this.iceMat.thickness = 0.10 + shell * 2.2;
      this.iceMat.attenuationDistance = 0.30 + (1 - shell) * 4.0;
    } else {
      this.iceMat.roughness = 0.05 + shell * 0.40;
      this.iceMat.opacity = 0.30 + shell * 0.62;
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
    const want = this._camWant || (this._camWant = new THREE.Vector3());
    want.set(
      this._ballWorld.x - Math.sin(this.camYaw) * dist,
      this._ballWorld.y + hgt,
      this._ballWorld.z - Math.cos(this.camYaw) * dist,
    );
    const k = Math.min(1, 6.0 * dt);
    this.camera.position.lerp(want, k);

    this.camLook.lerp(
      (this._lookWant || (this._lookWant = new THREE.Vector3())).set(
        this._ballWorld.x + vw.x * 0.16,
        this._ballWorld.y + 1.1,
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

    this.updateSnow(dt);
    if (this.goalGroup) this.goalGroup.rotation.y += dt * 0.35;
  }

  updateSnow(dt) {
    if (!this.settings.snow) { this.snow.visible = false; return; }
    this.snow.visible = true;
    const p = this.snow.geometry.attributes.position;
    const a = p.array;
    const c = this.camera.position;
    const fall = 3.2 * dt, drift = 0.9 * dt;
    for (let i = 0; i < this.snowN; i++) {
      const j = i * 3;
      a[j + 1] -= fall;
      a[j] += drift;
      if (a[j + 1] < c.y - 30) a[j + 1] = c.y + 40;
      if (a[j] - c.x > 75) a[j] -= 150; else if (a[j] - c.x < -75) a[j] += 150;
      if (a[j + 2] - c.z > 75) a[j + 2] -= 150; else if (a[j + 2] - c.z < -75) a[j + 2] += 150;
    }
    p.needsUpdate = true;
  }

  /** Drop the camera straight onto the ball, for stage start and restarts. */
  snapCamera(sim) {
    this.stageGroup.rotation.set(sim.tilt.x, 0, sim.tilt.z);
    this.ballGroup.position.set(sim.ball.p.x, sim.ball.p.y, sim.ball.p.z);
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
