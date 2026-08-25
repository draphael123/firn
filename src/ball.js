/* FIRN -- the ball, and the thing inside it.
 *
 * THE PROBLEM THIS SOLVES. A smooth featureless sphere does not read as
 * rolling. It reads as SLIDING, because nothing on it moves as it turns. That
 * single fact was the largest gap between FIRN and the games it is modelled on,
 * where the ball is transparent, structured, and carries a visible passenger.
 *
 * So the ball is four layers, and three of them exist to make rotation legible:
 *   ice     smooth refractive shell -- the material read
 *   rime    flat-shaded frost patches, opacity driven by shell -- the ROTATION
 *           read, and simultaneously the shell gauge: frost IS the shell
 *   crack   a lattice that flashes on impact and fades
 *   sleeper a body with a pose, not a rock
 *
 * The sleeper leans under load, braces on impact, curls when you are smooth and
 * unfolds as the ice thins. It is one smoothed acceleration vector and one
 * spring, but it converts "a rock in a ball" into "something you are carrying".
 */

import * as THREE from '../vendor/three.module.js';
import { T, radiusFor, mulberry32 } from './sim.js';

const ICE = 0xdbeef5;
const SLEEPER = 0x141009;
const GOLD = 0xc9a961;

/** Blotchy frost, as an alpha map. Patches are what make the spin visible. */
function makeRimeTexture() {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(4211);
  g.fillStyle = '#fff';
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H;
    const r = 6 + rnd() * 34;
    g.beginPath();
    for (let k = 0; k <= 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = r * (0.55 + rnd() * 0.75);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.75;
      k ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.globalAlpha = 0.5 + rnd() * 0.5;
    g.fill();
  }
  // a few clear channels, so the frost never becomes a uniform coat
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  g.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    let x = rnd() * W, y = rnd() * H;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 130; y += (rnd() - 0.5) * 90; g.lineTo(x, y); }
    g.strokeStyle = '#fff'; g.lineWidth = 3 + rnd() * 12;
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;   // unflagged canvas textures render washed
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A radiating fracture lattice, flashed on impact. */
function makeCrackTexture() {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rnd = mulberry32(881);
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  for (let n = 0; n < 14; n++) {
    const cx = rnd() * W, cy = rnd() * H;
    const arms = 3 + Math.floor(rnd() * 4);
    for (let a = 0; a < arms; a++) {
      let ang = rnd() * Math.PI * 2, x = cx, y = cy;
      g.beginPath(); g.moveTo(x, y);
      const segs = 3 + Math.floor(rnd() * 4);
      for (let s = 0; s < segs; s++) {
        ang += (rnd() - 0.5) * 1.1;
        const L = 10 + rnd() * 42;
        x += Math.cos(ang) * L; y += Math.sin(ang) * L;
        g.lineTo(x, y);
      }
      g.lineWidth = 1 + rnd() * 2.2;
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The passenger. A curled animal, readable in silhouette: heavy haunch, tucked
 * limbs, a snout laid along them, ears folded back, tail round the whole thing.
 *
 * The eyes do the real work. They are shut while the ice is thick and open as
 * it goes -- so the moment the shell gets dangerous is the moment something
 * inside your ball starts looking out of it. Nothing else in the game says
 * "you are running out" as fast, and it costs two spheres and a scale.
 */
function makeSleeper(mat, eyeMat) {
  const g = new THREE.Group();
  const ico = (d) => new THREE.IcosahedronGeometry(1, d);

  const body = new THREE.Mesh(ico(2), mat);
  body.scale.set(1.0, 0.82, 1.18);
  g.add(body);

  const haunch = new THREE.Mesh(ico(1), mat);
  haunch.scale.set(0.82, 0.72, 0.72);
  haunch.position.set(0, -0.18, -0.72);
  g.add(haunch);

  const head = new THREE.Group();
  const skull = new THREE.Mesh(ico(2), mat);
  skull.scale.setScalar(0.58);
  head.add(skull);
  const snout = new THREE.Mesh(ico(1), mat);
  snout.scale.set(0.30, 0.26, 0.46);
  snout.position.set(0, -0.16, 0.56);
  head.add(snout);
  for (const sx of [-1, 1]) {                 // ears, folded back along the skull
    const ear = new THREE.Mesh(ico(0), mat);
    ear.scale.set(0.13, 0.34, 0.20);
    ear.position.set(sx * 0.34, 0.40, -0.16);
    ear.rotation.set(-0.55, 0, sx * 0.30);
    head.add(ear);
  }
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), eyeMat);
    eye.position.set(sx * 0.30, 0.10, 0.42);
    eyes.push(eye);
    head.add(eye);
  }
  head.position.set(0, 0.20, 0.74);
  head.rotation.x = 0.30;                     // laid down over the forelimbs
  g.add(head);

  for (const sx of [-1, 1]) {                 // forelimbs tucked under the chin
    const limb = new THREE.Mesh(ico(1), mat);
    limb.scale.set(0.26, 0.24, 0.62);
    limb.position.set(sx * 0.52, -0.42, 0.44);
    limb.rotation.set(0.2, sx * -0.22, sx * 0.34);
    g.add(limb);
  }

  // the tail, curled round the flank -- three segments is enough to read
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const seg = new THREE.Mesh(ico(1), mat);
    const r = 0.30 - t * 0.15;
    seg.scale.set(r, r, r * 1.25);
    const a = 0.6 + t * 2.1;
    seg.position.set(Math.sin(a) * (0.86 + t * 0.16), -0.40 + t * 0.30, -0.60 + Math.cos(a) * 0.62);
    g.add(seg);
  }

  return { group: g, head, eyes, body };
}

export function buildBall(settings) {
  const group = new THREE.Group();

  const iceMat = settings.iceQuality === 'plain'
    ? new THREE.MeshStandardMaterial({
        color: ICE, roughness: 0.18, transparent: true, opacity: 0.72,
      })
    : new THREE.MeshPhysicalMaterial({
        color: ICE, roughness: 0.12, metalness: 0.0,
        transmission: 1.0, thickness: 1.0, ior: 1.31,
        clearcoat: 0.6, clearcoatRoughness: 0.2,
        attenuationColor: new THREE.Color(0x7fb3c8), attenuationDistance: 1.6,
      });
  const ice = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 26), iceMat);
  ice.castShadow = !!settings.shadows;

  // Flat-shaded so facets catch the light and turn with the ball; the alpha
  // map breaks the coat into patches you can actually track as it rotates.
  const rimeMat = new THREE.MeshStandardMaterial({
    color: 0xf2fafd, roughness: 0.92, metalness: 0,
    alphaMap: makeRimeTexture(), transparent: true, opacity: 1,
    flatShading: true, depthWrite: false,
  });
  const rime = new THREE.Mesh(new THREE.SphereGeometry(1.006, 26, 18), rimeMat);

  const crackMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, alphaMap: makeCrackTexture(), transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const crack = new THREE.Mesh(new THREE.SphereGeometry(1.012, 24, 16), crackMat);

  // The sleeper is a FIXED size -- exactly R_MIN. That is what makes shell 0
  // read as "the ice is gone" rather than "the ball got small".
  const sleeperMat = new THREE.MeshStandardMaterial({
    color: SLEEPER, roughness: 0.5, metalness: 0.08,
    emissive: new THREE.Color(GOLD), emissiveIntensity: 0,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x2a1c08, roughness: 0.25, metalness: 0.1,
    emissive: new THREE.Color(0xffb642), emissiveIntensity: 0,
  });
  const sleeperPivot = new THREE.Group();
  const built = makeSleeper(sleeperMat, eyeMat);
  const sleeper = built.group;
  sleeper.scale.setScalar(T.R_MIN * 0.62);
  sleeperPivot.add(sleeper);

  const glow = new THREE.PointLight(GOLD, 0, 8, 2);

  // `shell` group carries the rolling rotation; the sleeper does NOT roll with
  // it -- a passenger tumbling with the shell reads as cargo, not a creature.
  const shell = new THREE.Group();
  shell.add(ice, rime, crack);
  group.add(shell, sleeperPivot, glow);

  return {
    group, shell, ice, rime, crack, sleeper, sleeperPivot, glow,
    head: built.head, eyes: built.eyes, body: built.body,
    iceMat, rimeMat, crackMat, sleeperMat, eyeMat,
    breath: 0,
    lean: new THREE.Vector3(),
    accel: new THREE.Vector3(),
    vPrev: new THREE.Vector3(),
    brace: 0,
    crackAmt: 0,
  };
}

const _axis = new THREE.Vector3();
const _spin = new THREE.Quaternion();
const _tmp = new THREE.Vector3();

export function updateBall(B, sim, dt, settings) {
  const b = sim.ball;
  const shell = Math.max(0, b.shell);
  const r = b.r;

  B.group.position.set(b.p.x, b.p.y, b.p.z);
  B.shell.scale.setScalar(r);

  // ---- material response to shell
  if (B.iceMat.thickness !== undefined) {
    B.iceMat.transmission = 1 - shell * 0.55;
    B.iceMat.roughness = 0.05 + shell * 0.30;
    B.iceMat.thickness = 0.15 + shell * 0.9;
    B.iceMat.attenuationDistance = 1.4 + (1 - shell) * 6;
  } else {
    B.iceMat.opacity = 0.40 + shell * 0.55;
  }
  // Frost IS the shell: it thins off the ball as you melt.
  B.rimeMat.opacity = Math.pow(shell, 0.75) * 0.97;
  B.rime.visible = shell > 0.02;

  // ---- rolling. This is the whole point of the rime layer.
  const w = b.spin;
  const wl = Math.hypot(w.x, w.y, w.z);
  if (dt > 0 && wl > 1e-5) {
    _axis.set(w.x / wl, w.y / wl, w.z / wl);
    _spin.setFromAxisAngle(_axis, wl * dt);
    B.shell.quaternion.premultiply(_spin);
  }

  // ---- smoothed acceleration, for the passenger's lean
  if (dt > 0) {
    _tmp.set((b.v.x - B.vPrev.x) / dt, 0, (b.v.z - B.vPrev.z) / dt);
    if (_tmp.lengthSq() > 40000) _tmp.setLength(200);      // ignore collision spikes
    B.accel.lerp(_tmp, Math.min(1, 6 * dt));
    B.vPrev.set(b.v.x, b.v.y, b.v.z);
  }

  const agit = Math.pow(1 - shell, T.WOBBLE_P);
  B.brace = Math.max(0, B.brace - dt * 4.5);
  B.crackAmt = Math.max(0, B.crackAmt - dt * 3.2);
  B.crackMat.opacity = B.crackAmt * 0.85;
  B.crack.visible = B.crackAmt > 0.01;

  // Pressed OUTWARD by whatever the ball is doing: the passenger lags the
  // acceleration, exactly as you would in a vehicle.
  const push = 0.030 * r;
  B.lean.lerp(
    _tmp.set(-B.accel.x * push, 0, -B.accel.z * push),
    Math.min(1, 9 * dt),
  );
  const braceDrop = B.brace * r * 0.28;
  B.sleeperPivot.position.set(
    B.lean.x,
    -braceDrop + Math.sin(sim.time * 5.2) * agit * 0.05 * r,
    B.lean.z,
  );
  // keep it inside the ice however hard it is thrown about
  const lim = Math.max(0, r - T.R_MIN * 0.95);
  if (B.sleeperPivot.position.length() > lim) B.sleeperPivot.position.setLength(lim);

  // Curled and still when calm; unfolding and turning as the ice goes.
  const unfurl = agit + B.brace * 0.5;
  B.sleeper.scale.setScalar(T.R_MIN * (0.62 + unfurl * 0.10));
  B.sleeper.rotation.x = -0.5 + unfurl * 0.55 + B.brace * 0.4;
  B.sleeper.rotation.y += dt * (0.25 + agit * 2.4);
  B.sleeper.rotation.z = Math.sin(sim.time * 3.1) * agit * 0.5;

  // It breathes. Slow and deep while it sleeps, shallow and quick once it does
  // not -- the flank moving at all is what separates a passenger from a rock.
  B.breath += dt * (0.85 + agit * 3.2);
  const swell = Math.sin(B.breath) * (0.045 - agit * 0.026);
  B.body.scale.set(1.0 + swell, 0.82 + swell * 0.7, 1.18 + swell * 0.5);

  // The head lifts and casts about as it comes round.
  B.head.rotation.x = 0.30 - agit * 0.62 - B.brace * 0.25;
  B.head.rotation.y = Math.sin(sim.time * 1.5 + 0.7) * agit * 0.75;

  // And the eyes open. Shut under thick ice; wide, and lit, once it is going.
  const open = Math.min(1, Math.max(0, (agit - 0.10) / 0.55) + B.brace * 0.5);
  for (const e of B.eyes) e.scale.set(0.115, 0.115 * (0.06 + open * 0.94), 0.075);
  B.eyeMat.emissiveIntensity = open * 2.6;

  B.sleeperMat.emissiveIntensity = agit * 1.5 + b.startle * 0.35;
  B.glow.intensity = agit * 2.2 + b.startle * 0.8 + B.crackAmt * 1.5;
}

/** Called on a real impact: flash the fracture lattice and jolt the passenger. */
export function ballImpact(B, speed) {
  B.crackAmt = Math.min(1, B.crackAmt + speed * 0.13);
  B.brace = Math.min(1, B.brace + speed * 0.16);
}
