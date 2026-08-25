/* FIRN -- simulation core.
 *
 * No three.js in here. Everything runs headless so test/sim-test.mjs can drive
 * it, and so balance sweeps never depend on a browser or wall-clock time.
 *
 * The one structural idea: the stage is a rigid body that tilts, so we simulate
 * entirely in STAGE-LOCAL space where every box stays axis-aligned. Tilting
 * rotates the gravity vector instead of the geometry. Sphere-vs-AABB is then
 * exact and cheap, and rendering just rotates the whole stage group to match.
 */

// ---------------------------------------------------------------- tuning

export const T = {
  G: 26,                // gravity, m/s^2 (exaggerated; Monkey Ball is snappy)
  TILT_MAX: 0.46,       // ~26 deg. Absolute stick->angle mapping, never a rate.
  TILT_RATE: 5.0,       // rad/s the stage can swing toward the target angle.
                        // Fast enough that the stage arrives at the angle you
                        // asked for in ~90ms; slower reads as input lag.

  R_MAX: 0.55,          // radius at shell 1.0
  R_MIN: 0.22,          // radius at shell 0.0

  ROLL_INERTIA: 5 / 7,  // solid sphere rolling without slipping: a = 5/7 g sin
  RESTITUTION: 0.16,    // floors
  WALL_RESTITUTION: 0.0,// walls: stop, do not spring back at the player

  /* Rolling resistance, 1/s, grounded only. This number decides whether the
   * game is piloted or merely watched. At 0.34 the decay constant is ~3s, so
   * the ball coasts to a halt on its own and braking is never a decision. At
   * 0.10 it is ~10s: momentum persists, you have to tilt AGAINST travel to
   * shed speed, and every corner has to be set up in advance. Speed is then
   * bounded by V_MAX rather than by drag. */
  ROLL_DRAG: 0.10,
  AIR_DRAG: 0.02,
  V_MAX: 24,

  // Melt. Deliberately independent of shell -- see MELT INVARIANT below.
  FRICTION_MELT: 0.00042,   // shell/s per m/s of contact speed
  HEAT_FALLOFF: 1.6,        // exponent on heat-source radial falloff

  // The sleeper. Offset centre of mass, worsening as the shell thins.
  WOBBLE_A: 5.4,        // peak lateral accel, m/s^2, at shell 0
  WOBBLE_P: 1.7,        // exponent -- late and sudden, not linear
  STARTLE: 2.2,         // extra wobble injected per hard impact, decays

  BARE_IMPACT: 4.2,     // normal speed that ends a run once the shell is gone
  SUBSTEP: 1 / 240,     // fixed; a small fast sphere tunnels at variable dt
};

/* MELT INVARIANT ---------------------------------------------------------
 * melt = ambient(p) + FRICTION_MELT * contactSpeed
 * shell must NEVER appear on the right-hand side. If thinner melted faster,
 * every run would death-spiral and the spend-shell-for-a-shortcut decision
 * would evaporate. test/sim-test.mjs asserts this directly.
 * ---------------------------------------------------------------------- */

export const radiusFor = (shell) => T.R_MIN + (T.R_MAX - T.R_MIN) * clamp01(shell);

// ---------------------------------------------------------------- helpers

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function approach(cur, target, maxStep) {
  const d = target - cur;
  if (d > maxStep) return cur + maxStep;
  if (d < -maxStep) return cur - maxStep;
  return target;
}

/** Deterministic PRNG so a seed genuinely changes a run (and tests can prove it). */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gravity expressed in stage-local space.
 * Stage visual rotation R = Rx(pitch) * Rz(roll); local gravity is R^T * (0,-g,0).
 */
export function localGravity(pitch, roll, g = T.G) {
  const ca = Math.cos(pitch), sa = Math.sin(pitch);
  const cb = Math.cos(roll), sb = Math.sin(roll);
  return { x: -g * ca * sb, y: -g * ca * cb, z: g * sa };
}

// ------------------------------------------------------- quaternions (OBB)

/* Ramps and banked turns need oriented boxes. A sphere-vs-OBB test is just the
 * AABB test done in the box's local frame, so this stays exact and cheap.
 * Euler order is XYZ to match three.js, so the collider and the mesh that
 * draws it can share one rotation triple. */

export function quatFromEuler(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Rotate (x,y,z) by quaternion q. Writes into `out`. */
export function rotV(q, x, y, z, out) {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}

// ---------------------------------------------------------------- stage

/**
 * Authoring helper. `p` centre, `s` full size, optional `extra.rot` = [x,y,z]
 * Euler radians. Unrotated boxes keep the fast axis-aligned path.
 */
export function box(p, s, kind = 'stone', extra = {}) {
  const b = {
    kind,
    c: [p[0], p[1], p[2]],
    e: [s[0] / 2, s[1] / 2, s[2] / 2],
    min: [p[0] - s[0] / 2, p[1] - s[1] / 2, p[2] - s[2] / 2],
    max: [p[0] + s[0] / 2, p[1] + s[1] / 2, p[2] + s[2] / 2],
    p, s, ...extra,
  };
  const r = b.rot;
  if (r && (r[0] || r[1] || r[2])) {
    b.q = quatFromEuler(r[0], r[1], r[2]);
    b.qc = [-b.q[0], -b.q[1], -b.q[2], b.q[3]];   // conjugate == inverse
  }
  return b;
}

export function prepareStage(def) {
  return {
    killY: -30,
    warmth: 0,
    goalR: 1.5,
    ...def,
    boxes: def.boxes.map((b) => (b.e ? b : box(b.p, b.s, b.kind, b))),
    heat: def.heat || [],
  };
}

/** Ambient melt rate at a point: stage base warmth plus every heat source. */
export function ambientAt(stage, x, y, z) {
  let q = stage.warmth;
  for (const h of stage.heat) {
    const dx = x - h.p[0], dy = y - h.p[1], dz = z - h.p[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < h.r) q += h.q * Math.pow(1 - d / h.r, T.HEAT_FALLOFF);
  }
  return q;
}

// ---------------------------------------------------------------- sim

export function createSim(stageDef, opts = {}) {
  const stage = prepareStage(stageDef);
  const seed = opts.seed === undefined ? 1 : opts.seed;
  const rnd = mulberry32(seed);

  // Wobble phases come from the seed, so two seeds really do diverge.
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];

  const sim = {
    stage,
    seed,
    time: 0,
    state: 'run',            // run | won | lost
    reason: null,            // fell | woke
    tilt: { x: 0, z: 0 },    // pitch (about X), roll (about Z)
    ball: {
      p: { x: stage.spawn[0], y: stage.spawn[1], z: stage.spawn[2] },
      v: { x: 0, y: 0, z: 0 },
      shell: 1,
      r: T.R_MAX,
      grounded: false,
      n: { x: 0, y: 1, z: 0 },    // last contact normal
      spin: { x: 0, y: 0, z: 0 }, // angular velocity, visual only
      startle: 0,
      lastImpact: 0,
    },
    meltLast: 0,
    ambientLast: 0,
    gateBlock: 0,   // opening height of a gate refusing us this frame, else 0
    events: [],
    step,
    reset,
  };

  function reset() {
    sim.time = 0; sim.state = 'run'; sim.reason = null;
    sim.tilt.x = 0; sim.tilt.z = 0;
    const b = sim.ball;
    b.p = { x: stage.spawn[0], y: stage.spawn[1], z: stage.spawn[2] };
    b.v = { x: 0, y: 0, z: 0 };
    b.shell = 1; b.r = T.R_MAX; b.grounded = false;
    b.n = { x: 0, y: 1, z: 0 }; b.spin = { x: 0, y: 0, z: 0 };
    b.startle = 0; b.lastImpact = 0;
    sim.events.length = 0;
    return sim;
  }

  /**
   * @param dt     seconds of wall time to advance (internally fixed-substepped)
   * @param input  { x, z } each in [-1,1]; absolute stick -> tilt angle
   */
  function step(dt, input) {
    if (sim.state !== 'run') return sim;
    let left = Math.min(dt, 0.1);   // never simulate a huge hitch in one go
    while (left > 1e-6 && sim.state === 'run') {
      const h = Math.min(T.SUBSTEP, left);
      sub(h, input || { x: 0, z: 0 });
      left -= h;
    }
    return sim;
  }

  function sub(dt, input) {
    const b = sim.ball;
    sim.time += dt;

    // --- tilt: absolute mapping, rate-limited swing, hard cap
    const tx = clamp(input.x, -1, 1) * T.TILT_MAX;
    const tz = clamp(input.z, -1, 1) * T.TILT_MAX;
    sim.tilt.x = approach(sim.tilt.x, tx, T.TILT_RATE * dt);
    sim.tilt.z = approach(sim.tilt.z, tz, T.TILT_RATE * dt);

    const g = localGravity(sim.tilt.x, sim.tilt.z);

    // --- the sleeper stirs: offset centre of mass, worsening as shell thins
    const agit = Math.pow(1 - clamp01(b.shell), T.WOBBLE_P);
    const t = sim.time;
    const wob = T.WOBBLE_A * agit + b.startle;
    let ax = g.x + wob * Math.sin(t * 1.7 + ph[0]) * Math.cos(t * 0.63 + ph[1]);
    let ay = g.y;
    let az = g.z + wob * Math.sin(t * 1.31 + ph[2]) * Math.cos(t * 0.81 + ph[3]);
    b.startle = Math.max(0, b.startle - 2.4 * dt);

    // --- rolling inertia: a solid sphere rolling without slipping only gets
    //     5/7 of the slope acceleration. Tangential component only.
    if (b.grounded) {
      const n = b.n;
      const dot = ax * n.x + ay * n.y + az * n.z;
      const tanx = ax - dot * n.x, tany = ay - dot * n.y, tanz = az - dot * n.z;
      ax = dot * n.x + tanx * T.ROLL_INERTIA;
      ay = dot * n.y + tany * T.ROLL_INERTIA;
      az = dot * n.z + tanz * T.ROLL_INERTIA;
    }

    b.v.x += ax * dt; b.v.y += ay * dt; b.v.z += az * dt;
    b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;

    resolve();

    // --- drag
    const d = (b.grounded ? T.ROLL_DRAG : T.AIR_DRAG) * dt;
    const k = Math.max(0, 1 - d);
    b.v.x *= k; b.v.z *= k;
    if (!b.grounded) b.v.y *= Math.max(0, 1 - T.AIR_DRAG * dt);

    const sp = Math.hypot(b.v.x, b.v.y, b.v.z);
    if (sp > T.V_MAX) { const s = T.V_MAX / sp; b.v.x *= s; b.v.y *= s; b.v.z *= s; }

    // --- melt.  MELT INVARIANT: no shell term on the right-hand side.
    const amb = ambientAt(stage, b.p.x, b.p.y, b.p.z);
    const nrm = b.n;
    const vn = b.v.x * nrm.x + b.v.y * nrm.y + b.v.z * nrm.z;
    const contact = b.grounded
      ? Math.hypot(b.v.x - vn * nrm.x, b.v.y - vn * nrm.y, b.v.z - vn * nrm.z)
      : 0;
    const melt = amb + T.FRICTION_MELT * contact;
    sim.meltLast = melt; sim.ambientLast = amb;
    if (b.shell > 0) {
      const before = b.shell;
      b.shell = clamp01(b.shell - melt * dt);
      if (before > 0 && b.shell <= 0) sim.events.push({ type: 'bare' });
    }
    b.r = radiusFor(b.shell);

    // --- visual spin: omega = (n x v) / r
    if (b.grounded && b.r > 1e-4) {
      b.spin.x = (nrm.y * b.v.z - nrm.z * b.v.y) / b.r;
      b.spin.y = (nrm.z * b.v.x - nrm.x * b.v.z) / b.r;
      b.spin.z = (nrm.x * b.v.y - nrm.y * b.v.x) / b.r;
    }

    // --- terminal checks
    if (b.p.y < stage.killY) { sim.state = 'lost'; sim.reason = 'fell'; return; }

    const gx = b.p.x - stage.goal[0], gy = b.p.y - stage.goal[1], gz = b.p.z - stage.goal[2];
    if (Math.hypot(gx, gy, gz) < stage.goalR + b.r) sim.state = 'won';
  }

  // Scratch vectors -- resolve() runs 240x/s, so it allocates nothing.
  const _l = [0, 0, 0], _n = [0, 0, 0];

  /**
   * Sphere vs one box, in the box's own frame. Returns penetration depth and
   * writes the world-space contact normal into `_n`, or -1 for no contact.
   */
  function collideOne(b, bx) {
    let px, py, pz;
    if (bx.q) {
      rotV(bx.qc, b.p.x - bx.c[0], b.p.y - bx.c[1], b.p.z - bx.c[2], _l);
      px = _l[0]; py = _l[1]; pz = _l[2];
    } else {
      px = b.p.x - bx.c[0]; py = b.p.y - bx.c[1]; pz = b.p.z - bx.c[2];
    }

    const ex = bx.e[0], ey = bx.e[1], ez = bx.e[2];
    const qx = clamp(px, -ex, ex), qy = clamp(py, -ey, ey), qz = clamp(pz, -ez, ez);
    let dx = px - qx, dy = py - qy, dz = pz - qz;
    let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > b.r) return -1;

    let pen;
    if (dist < 1e-6) {
      // Centre is inside -- eject along the shallowest face.
      const cands = [
        [ex - px, 1, 0, 0], [ex + px, -1, 0, 0],
        [ey - py, 0, 1, 0], [ey + py, 0, -1, 0],
        [ez - pz, 0, 0, 1], [ez + pz, 0, 0, -1],
      ];
      let pick = cands[0];
      for (const c of cands) if (c[0] < pick[0]) pick = c;
      dx = pick[1]; dy = pick[2]; dz = pick[3];
      pen = pick[0] + b.r;
    } else {
      const inv = 1 / dist;
      dx *= inv; dy *= inv; dz *= inv;
      pen = b.r - dist;
    }

    if (bx.q) rotV(bx.q, dx, dy, dz, _n);
    else { _n[0] = dx; _n[1] = dy; _n[2] = dz; }
    return pen;
  }

  // Deduped contact normals for this frame. Flat array, never reallocated.
  const _cn = new Float64Array(3 * 8);
  let _cnCount = 0;

  /** Record a normal unless one pointing essentially the same way is present. */
  function addContact(nx, ny, nz) {
    for (let i = 0; i < _cnCount; i++) {
      const j = i * 3;
      if (_cn[j] * nx + _cn[j + 1] * ny + _cn[j + 2] * nz > 0.97) return;
    }
    if (_cnCount >= 8) return;
    const j = _cnCount * 3;
    _cn[j] = nx; _cn[j + 1] = ny; _cn[j + 2] = nz;
    _cnCount++;
  }

  /**
   * Sphere vs every box.
   *
   * Position and velocity are resolved SEPARATELY, and this matters. Applying
   * the velocity impulse inside the relaxation loop means a ball touching two
   * surfaces -- or one surface it gets pushed back into by another -- has its
   * normal velocity cancelled two or three times per frame. Against a wall that
   * bleeds away the tangential speed as well, and the ball sticks instead of
   * sliding along. So: iterate position to separate, collect the distinct
   * normals, then apply exactly one impulse per normal.
   */
  function resolve() {
    const b = sim.ball;
    b.grounded = false;
    _cnCount = 0;
    sim.gateBlock = 0;

    // --- position only
    for (let pass = 0; pass < 4; pass++) {
      let hit = false;
      for (const bx of stage.boxes) {
        // A grate is bars, not a slab: it only exists for a ball too fat to
        // drop between them. The inverse hazard to the low gates.
        if (bx.kind === 'grate' && 2 * b.r < bx.gap) continue;

        const pen = collideOne(b, bx);
        if (pen < 0) continue;

        const nx = _n[0], ny = _n[1], nz = _n[2];
        // Touching a lintel means only one thing: too thick to pass.
        if (bx.open !== undefined) sim.gateBlock = bx.open;
        b.p.x += nx * pen; b.p.y += ny * pen; b.p.z += nz * pen;
        addContact(nx, ny, nz);
        if (ny > 0.5) { b.grounded = true; b.n = { x: nx, y: ny, z: nz }; }
        hit = true;
      }
      if (!hit) break;
    }

    // --- velocity, once per distinct normal
    let best = 0;
    for (let i = 0; i < _cnCount; i++) {
      const j = i * 3;
      const nx = _cn[j], ny = _cn[j + 1], nz = _cn[j + 2];
      const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
      if (vn >= 0) continue;
      const imp = -vn;
      if (imp > best) {
        best = imp;
        b.lastImpact = imp;
        if (imp > 1.6) b.startle = Math.min(T.STARTLE, b.startle + imp * 0.25);
      }
      // Bounce off a floor, but merely stop against a wall -- a springy wall in
      // a tilt game reads as the stage spitting you back at yourself.
      const e = ny > 0.5 ? T.RESTITUTION : T.WALL_RESTITUTION;
      b.v.x -= (1 + e) * vn * nx;
      b.v.y -= (1 + e) * vn * ny;
      b.v.z -= (1 + e) * vn * nz;
    }

    if (best > 0) {
      sim.events.push({ type: 'impact', speed: best });
      // Bare ice has nothing left to absorb a blow.
      if (b.shell <= 0 && best > T.BARE_IMPACT) { sim.state = 'lost'; sim.reason = 'woke'; }
    }
  }

  return sim;
}

// ---------------------------------------------------------------- harness

/**
 * Headless run. pilot(sim) -> {x,z} supplies input each frame, so balance
 * sweeps never depend on wall-clock time or a render loop.
 */
export function run(stageDef, pilot, opts = {}) {
  const sim = createSim(stageDef, opts);
  const dt = opts.dt || 1 / 120;
  const maxT = opts.maxT || 180;
  const trace = opts.trace ? [] : null;
  let steps = 0;
  while (sim.state === 'run' && sim.time < maxT) {
    sim.step(dt, pilot(sim) || { x: 0, z: 0 });
    steps++;
    if (trace && steps % 12 === 0) {
      trace.push({ t: sim.time, x: sim.ball.p.x, y: sim.ball.p.y, z: sim.ball.p.z, shell: sim.ball.shell });
    }
  }
  return {
    state: sim.state, reason: sim.reason, time: sim.time,
    shell: sim.ball.shell, p: { ...sim.ball.p }, steps, trace, sim,
  };
}
