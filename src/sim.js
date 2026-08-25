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

  /* Scaled up 1.6x from 0.55/0.22 so the passenger inside the shell is big
   * enough to actually look at. Everything that has to agree with it derives
   * from these two numbers -- see shellForOpening() in stages.js, and GATE_OPEN
   * and GRATE_GAP, which are scaled by the same factor so the shell thresholds
   * the whole design rests on (0.545 and 0.273) come out unchanged. */
  R_MAX: 0.88,          // radius at shell 1.0
  R_MIN: 0.352,         // radius at shell 0.0

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
  /* Raised from 0.00042 (+31%). The premise is that every second of SPEED costs
   * you the thing keeping it asleep, and at the old value the ambient of the
   * ground you stood on dominated so completely that going fast was nearly
   * free -- the melt clock ran on WHERE you were, not on HOW you drove.
   *
   * The ceiling is not comfort, it is the wobble: a thinner shell is a less
   * stable one, so melting faster also means arriving at the summit less able
   * to hold a line. At 0.00072 and 0.00060 The Cold Stair threw the pilot off
   * the road entirely. 0.00055 is the most this route survives, which makes it
   * the real budget rather than a number picked for feel. */
  FRICTION_MELT: 0.00055,   // shell/s per m/s of contact speed
  HEAT_FALLOFF: 1.6,        // exponent on heat-source radial falloff

  // The sleeper. Offset centre of mass, worsening as the shell thins.
  // The hunt. Only the boss stage sets stage.hunt, so these are inert elsewhere.
  HUNT_BODY: 2.5,       // its physical radius -- it is a SOLID thing, not a trigger
  HUNT_CHEST: 1.7,      // how far up its body the ball actually meets it
  HUNT_SHOVE: 1.35,     // how much of its own speed it puts through you
  HUNT_REACH: 3.4,      // how close before it lands a blow, metres along the route
  HUNT_KNOCK: 15.0,     // impulse it puts through you
  HUNT_BITE: 0.06,      // shell lost per blow
  HUNT_HEAT: 0.055,     // extra melt per second when it is right behind you
  HUNT_RANGE: 26,       // over what gap that heat falls to nothing
  HUNT_STAGGER: 3.6,    // seconds a bell buys you
  HUNT_KNOCKBACK: 38,   // metres a bell drives it back down the road

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

/**
 * Ambient melt rate at a point: stage base warmth plus every heat source.
 *
 * THE CLIMB. Warm air sits low, so warmth falls with altitude: every stage is
 * partly a matter of climbing out of the heat you are standing in. Meanwhile
 * each stage's BASE warmth is higher than the last, because the thaw is rising
 * behind you faster than you are climbing. You gain height and the heat follows.
 *
 * `warmFall` is the height, in metres, over which warmth decays by 1/e, measured
 * from `warmY` (default: the spawn height). Omit it and there is no altitude
 * term at all -- test stages rely on that, so a thin ball and a fat ball resting
 * at different heights cannot skew a measurement.
 */
export function ambientAt(stage, x, y, z) {
  let q = stage.warmth;
  if (stage.warmFall) {
    const base = stage.warmY === undefined ? stage.spawn[1] : stage.warmY;
    q *= Math.exp(-(y - base) / stage.warmFall);
  }
  for (const h of stage.heat) {
    const dx = x - h.p[0], dy = y - h.p[1], dz = z - h.p[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < h.r) q += h.q * Math.pow(1 - d / h.r, T.HEAT_FALLOFF);
  }
  return q;
}

// ---------------------------------------------------------------- sim

/**
 * The route as a measured line, so "how far behind me is it" is a real number.
 *
 * A chase needs one shared coordinate for both the hunted and the hunter, and
 * straight-line distance is the wrong one: on a switchback the beast would be
 * ten metres away through solid rock while a hundred metres of road separated
 * you. Everything about the hunt -- its heat, its reach, where it is drawn --
 * runs off arc length ALONG the road instead.
 */
function measureRoute(wps) {
  const cum = [0];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = cum[cum.length - 1];

  /** Arc length of the closest point on the line to (x,y,z). */
  const project = (x, y, z) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const L2 = dx * dx + dy * dy + dz * dz;
      if (L2 < 1e-9) continue;
      let t = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t, py = a[1] + dy * t, pz = a[2] + dz * t;
      const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
      if (d < bestD) { bestD = d; best = cum[i] + Math.sqrt(L2) * t; }
    }
    return best;
  };

  /**
   * The point at arc length s -- EXTRAPOLATED past either end, not clamped.
   *
   * Clamping looks harmless and is not: the hunter starts at a negative arc
   * length, behind the start line, so a clamp put it exactly ON the start line
   * -- which is where the ball is standing. Once the hunter became a solid
   * body that meant it was inside the player at spawn, landing blows while the
   * gap readout still said forty metres.
   */
  const at = (s, out) => {
    let i, t;
    if (s < 0) {
      i = 0; t = s / (cum[1] || 1);                    // back down the first leg
    } else if (s > total) {
      i = wps.length - 2;
      const seg = cum[i + 1] - cum[i] || 1;
      t = 1 + (s - total) / seg;                       // on past the last
    } else {
      i = 0;
      while (i < cum.length - 2 && cum[i + 1] < s) i++;
      const seg = cum[i + 1] - cum[i] || 1;
      t = (s - cum[i]) / seg;
    }
    const a = wps[i], b = wps[i + 1];
    out.x = a[0] + (b[0] - a[0]) * t;
    out.y = a[1] + (b[1] - a[1]) * t;
    out.z = a[2] + (b[2] - a[2]) * t;
    return out;
  };
  return { total, project, at };
}

export function createSim(stageDef, opts = {}) {
  const stage = prepareStage(stageDef);
  const route = stage.hunt ? measureRoute(stage.waypoints) : null;
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
    /* The hunt. Null on every stage but the boss, and every line that touches
     * it is guarded, so the other seven stages simulate exactly as before. */
    hunt: stage.hunt ? {
      s: stage.hunt.head ?? -30,   // where it is, along the road
      speed: stage.hunt.speed,
      stagger: 0,
      rung: [],                    // which bells have been pulled
      gap: 999,                    // metres of road between it and you
      heat: 0,
      p: { x: 0, y: 0, z: 0 },
      caught: 0,                   // blows landed
    } : null,
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
    if (sim.hunt) {
      sim.hunt.s = stage.hunt.head ?? -30;
      sim.hunt.speed = stage.hunt.speed;
      sim.hunt.stagger = 0; sim.hunt.rung = []; sim.hunt.gap = 999;
      sim.hunt.heat = 0; sim.hunt.caught = 0;
    }
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

    stepHunt(dt);

    // --- melt.  MELT INVARIANT: no shell term on the right-hand side.
    //     The hunt's heat is an AMBIENT term -- it depends on where you are
    //     relative to the beast, never on how thick your shell is.
    const amb = ambientAt(stage, b.p.x, b.p.y, b.p.z)
      + (sim.hunt ? sim.hunt.heat : 0);
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

  /**
   * The beast on the road behind you.
   *
   * It has one job: make standing still cost something. Everything else in this
   * game punishes speed -- friction melts the shell -- so a stage that also
   * punishes slowness is the only place where the two pressures meet and pace
   * becomes a real decision rather than "go as slow as you can bear".
   *
   * It does NOT chase in a straight line. It walks the road, measured in arc
   * length, so a switchback keeps it honestly behind you instead of letting it
   * cut the corner through the mountain.
   */
  function stepHunt(dt) {
    const H = sim.hunt;
    if (!H) return;
    const b = sim.ball;
    const h = stage.hunt;

    const you = route.project(b.p.x, b.p.y, b.p.z);

    // it only wakes once you are properly on the road
    if (!h.wakeAt || you >= h.wakeAt) {
      if (H.stagger > 0) H.stagger = Math.max(0, H.stagger - dt);
      else H.s += H.speed * dt;
    }

    // three escalations, keyed to how far YOU have come rather than to a clock,
    // so being slow does not also make the stage longer
    if (h.escalate) {
      for (const e of h.escalate) if (you >= e.at) H.speed = Math.max(H.speed, e.speed);
    }

    /* It hunts you; it does not race you to the top. Without this it simply
     * overtakes when it is faster and carries on up the mountain alone, which
     * is both absurd to watch and removes the pressure entirely. It closes to
     * your shoulder and stays there. */
    if (H.s > you + 1.5) H.s = you + 1.5;

    H.gap = you - H.s;
    route.at(H.s, H.p);

    // its heat is felt down the road, and only from behind
    H.heat = H.gap > 0 && H.gap < T.HUNT_RANGE
      ? T.HUNT_HEAT * (1 - H.gap / T.HUNT_RANGE)
      : (H.gap <= 0 ? T.HUNT_HEAT : 0);

    // ---- bells. Rolling into a pull rings it, and the sound puts it down the
    // road: this is the only way you have of pushing back, and it costs you the
    // line you were on.
    if (h.bells) {
      for (let i = 0; i < h.bells.length; i++) {
        if (H.rung[i]) continue;
        const bell = h.bells[i];
        const dx = b.p.x - bell[0], dy = b.p.y - bell[1], dz = b.p.z - bell[2];
        if (dx * dx + dy * dy + dz * dz > (bell[3] + b.r) ** 2) continue;
        H.rung[i] = true;
        H.stagger = T.HUNT_STAGGER;
        H.s -= T.HUNT_KNOCKBACK;
        sim.events.push({ type: 'bell', index: i, p: [bell[0], bell[1], bell[2]] });
      }
    }

    /* ---- IT IS SOLID.
     *
     * This used to be a trigger: a distance test along the road that applied a
     * scripted shove. That reads as being teleported sideways by nothing, and
     * worse, you could drive straight through the thing chasing you. It is a
     * moving sphere now -- the ball is pushed out of it, takes its momentum,
     * and cannot pass it. Everything the chase threatens you with comes from
     * that one fact: it is a wall that is catching up.
     */
    const cx = H.p.x, cy = H.p.y + T.HUNT_CHEST, cz = H.p.z;
    let dx = b.p.x - cx, dy = b.p.y - cy, dz = b.p.z - cz;
    let d = Math.hypot(dx, dy, dz);
    const R = T.HUNT_BODY + b.r;
    if (d < R) {
      if (d < 1e-4) { dx = 0; dy = 1; dz = 0; d = 1; }      // dead centre: pick a way out
      const nx = dx / d, ny = dy / d, nz = dz / d;

      // push clear
      const pen = R - d;
      b.p.x += nx * pen; b.p.y += ny * pen; b.p.z += nz * pen;

      // its own heading, so a hit from behind throws you FORWARD and off line
      route.at(H.s + 1, _hv);
      const hx = _hv.x - H.p.x, hz = _hv.z - H.p.z;
      const hl = Math.hypot(hx, hz) || 1;

      const vn = b.v.x * nx + b.v.y * ny + b.v.z * nz;
      if (vn < 0) {                                        // moving into it
        b.v.x -= vn * nx * 1.5; b.v.y -= vn * ny * 1.5; b.v.z -= vn * nz * 1.5;
      }
      const push = (H.stagger > 0 ? 0.25 : 1) * H.speed * T.HUNT_SHOVE;
      b.v.x += (hx / hl) * push * 0.55 + nx * push * 0.75;
      b.v.z += (hz / hl) * push * 0.55 + nz * push * 0.75;
      b.v.y += 3.0;

      // and it costs you shell, but only once per contact
      if (H.stagger <= 0 && sim.time - (H.lastHit || -9) > 0.6) {
        H.lastHit = sim.time;
        b.shell = clamp01(b.shell - T.HUNT_BITE);
        b.startle = 5.5;
        H.caught++;
        H.s -= 5;                    // it checks its stride, so it is not a lock
        sim.events.push({ type: 'struck', speed: T.HUNT_KNOCK });
      }
    }
  }

  // Scratch vectors -- resolve() runs 240x/s, so it allocates nothing.
  const _l = [0, 0, 0], _n = [0, 0, 0];
  const _hv = { x: 0, y: 0, z: 0 };

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
