/* FIRN -- simulation invariants.
 *
 * These guard the properties the design cannot survive losing. The melt
 * invariant is the important one: if melt rate ever comes to depend on how
 * thin you already are, every run death-spirals and the whole spend-shell
 * decision collapses into a countdown.
 */
import * as S from '../src/sim.js';
import { STAGES, shellForOpening, GATE_OPEN, GRATE_GAP } from '../src/stages.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} expected ${b}, got ${a}`); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || ''} expected ~${b} (+-${tol}), got ${a}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

/** Rest the ball on the deck and run off the landing startle, so tests measure
 *  the thing they name instead of the transient from a drop. */
function settle(sim, shell) {
  if (shell !== undefined) sim.ball.shell = shell;
  sim.ball.r = S.radiusFor(sim.ball.shell);
  sim.ball.p.y = sim.ball.r;
  sim.ball.v = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 240; i++) { sim.step(1 / 240, { x: 0, z: 0 }); if (shell !== undefined) sim.ball.shell = shell; }
  sim.ball.startle = 0;
  sim.ball.v = { x: 0, y: 0, z: 0 };
  return sim;
}

const flat = (warmth = 0, heat = []) => ({
  id: 'x', name: 'x', warmth, killY: -20, heat,
  spawn: [0, 1.2, 0], goal: [0, 0.6, 9999], goalR: 1,
  boxes: [{ p: [0, -0.5, 0], s: [40, 1, 4000], kind: 'stone' }],
});

console.log('\ngeometry thresholds');
t('gate opening admits only a melted ball', () => {
  const s = shellForOpening(GATE_OPEN);
  near(s, 0.545, 0.002, 'gate shell');
  ok(2 * S.radiusFor(s - 0.02) < GATE_OPEN, 'just-under ball should fit');
  ok(2 * S.radiusFor(s + 0.02) > GATE_OPEN, 'just-over ball should not fit');
});
t('grate gap drops only an over-melted ball', () => {
  const s = shellForOpening(GRATE_GAP);
  near(s, 0.273, 0.002, 'grate shell');
  ok(2 * S.radiusFor(s + 0.02) > GRATE_GAP, 'thicker ball is held');
  ok(2 * S.radiusFor(s - 0.02) < GRATE_GAP, 'thinner ball falls through');
});
t('the two thresholds leave a usable band', () => {
  ok(shellForOpening(GATE_OPEN) - shellForOpening(GRATE_GAP) > 0.2, 'band too narrow to play in');
});

console.log('\nMELT INVARIANT');
t('melt rate does not depend on how thin the shell already is', () => {
  // The sleeper wobbles harder at low shell, which nudges position and so
  // ambient heat. Silence it so this measures the melt formula alone.
  // Uniform warmth, no point heat sources: a thin ball and a fat one rest at
  // different heights, so any radial heat field would sample differently and
  // confound the measurement. With warmth flat, the only thing left that could
  // differ IS a shell term -- which is exactly what must not exist.
  const A = S.T.WOBBLE_A; S.T.WOBBLE_A = 0;
  try {
    const mk = (shell) => {
      const sim = S.createSim(flat(0.01), { seed: 3 });
      settle(sim, shell);
      sim.ball.v = { x: 0, y: 0, z: 9 };
      sim.step(1 / 240, { x: 0, z: 0 });
      return sim.meltLast;
    };
    near(mk(0.95), mk(0.30), 1e-15, 'melt rate at 95% vs 30% shell');
    // and the ambient field itself never sees the ball at all
    const st = S.prepareStage(flat(0.01, [{ p: [0, 0, 0], r: 50, q: 0.05 }]));
    eq(S.ambientAt(st, 1, 2, 3), S.ambientAt(st, 1, 2, 3), 'ambient must be a pure function of position');
  } finally { S.T.WOBBLE_A = A; }
});
t('no death spiral: shell falls linearly, it does not accelerate', () => {
  // The failure mode this guards is melt that grows as you thin, which turns
  // every run into a collapse. Under steady conditions the loss in a late
  // window must match the loss in an early one.
  const sim = S.createSim(flat(0.0018), { seed: 3 });
  const hold = { x: 0.5, z: 0 };
  for (let i = 0; i < 1200; i++) sim.step(1 / 120, hold);   // reach steady speed
  const a0 = sim.ball.shell;
  for (let i = 0; i < 2400; i++) sim.step(1 / 120, hold);   // early 20s window
  const a1 = sim.ball.shell;
  for (let i = 0; i < 2400; i++) sim.step(1 / 120, hold);   // late 20s window
  const a2 = sim.ball.shell;
  const early = a0 - a1, late = a1 - a2;
  ok(late < early * 1.05, `late loss ${late.toFixed(4)} vs early ${early.toFixed(4)} -- melt is accelerating`);
});
t('melt rises with speed and with heat, monotonically', () => {
  const at = (speed, q) => {
    const sim = S.createSim(flat(0.002, [{ p: [0, 0, 0], r: 50, q }]), { seed: 3 });
    settle(sim);                       // friction melt needs actual contact
    sim.ball.v = { x: 0, y: 0, z: speed };
    sim.step(1 / 240, { x: 0, z: 0 });
    return sim.meltLast;
  };
  ok(at(14, 0) > at(4, 0), 'faster should melt more');
  ok(at(4, 0.08) > at(4, 0.01), 'hotter should melt more');
});

console.log('\nshell and radius');
t('radius maps the shell endpoints exactly', () => {
  near(S.radiusFor(1), S.T.R_MAX, 1e-12); near(S.radiusFor(0), S.T.R_MIN, 1e-12);
  near(S.radiusFor(1.5), S.T.R_MAX, 1e-12); near(S.radiusFor(-1), S.T.R_MIN, 1e-12);
});
t('the shell only ever shrinks, so the ball can never grow into geometry', () => {
  const sim = S.createSim(flat(0.02, [{ p: [0, 0, 40], r: 30, q: 0.1 }]), { seed: 5 });
  let prev = sim.ball.r;
  for (let i = 0; i < 4000; i++) {
    sim.step(1 / 120, { x: 0.6, z: Math.sin(i / 90) * 0.5 });
    ok(sim.ball.r <= prev + 1e-12, 'radius increased');
    prev = sim.ball.r;
  }
});

console.log('\nsliding, not sticking');
t('a ball pressed into a wall keeps most of its along-wall speed', () => {
  // NOTE: this does NOT reproduce the original "sticks to walls" report -- it
  // passes against the pre-fix solver too, which is how we learned the
  // double-impulse theory was wrong. It is kept because the property is worth
  // locking down regardless: leaning on a wall must cost speed, not all of it.
  const walled = {
    id: 'w', name: 'w', warmth: 0, killY: -20, heat: [],
    spawn: [0, 1.2, 0], goal: [0, 0.6, 9999], goalR: 1,
    boxes: [
      { p: [0, -0.5, 0], s: [20, 1, 600], kind: 'stone' },
      { p: [5.5, 1.0, 0], s: [1, 3, 600], kind: 'stone' },   // wall at x = +5
    ],
  };
  const sim = S.createSim(walled, { seed: 8 });
  sim.ball.p = { x: 4.0, y: S.T.R_MAX, z: 0 };
  sim.ball.v = { x: 0, y: 0, z: 12 };
  // hold a tilt that drives it forward AND hard into the wall
  for (let i = 0; i < 480; i++) sim.step(1 / 240, { x: 0.7, z: -1 });
  ok(sim.ball.p.x > 4.3, `should be pinned against the wall, x=${sim.ball.p.x.toFixed(2)}`);
  ok(sim.ball.v.z > 8, `should still be running along the wall, vz=${sim.ball.v.z.toFixed(2)}`);
  ok(sim.ball.p.z > 20, `should have travelled along it, z=${sim.ball.p.z.toFixed(1)}`);
});
t('a corner does not eat all the speed', () => {
  const boxed = {
    id: 'c', name: 'c', warmth: 0, killY: -20, heat: [],
    spawn: [0, 1.2, 0], goal: [0, 0.6, 9999], goalR: 1,
    boxes: [
      { p: [0, -0.5, 0], s: [20, 1, 600], kind: 'stone' },
      { p: [5.5, 1.0, 0], s: [1, 3, 600], kind: 'stone' },
      { p: [0, 1.0, -5.5], s: [20, 3, 1], kind: 'stone' },   // back wall too
    ],
  };
  const sim = S.createSim(boxed, { seed: 8 });
  sim.ball.p = { x: 4.6, y: S.T.R_MAX, z: -4.6 };            // wedged in the corner
  sim.ball.v = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 480; i++) sim.step(1 / 240, { x: 1, z: 0 });   // tilt out of it
  ok(sim.ball.p.z > 4, `should have driven out of the corner, z=${sim.ball.p.z.toFixed(2)}`);
});

console.log('\nthe sleeper');
t('agitation grows as the shell thins', () => {
  const wob = (shell) => {
    const sim = S.createSim(flat(0), { seed: 11 });
    settle(sim, shell);
    let peak = 0;
    for (let i = 0; i < 1400; i++) {
      sim.step(1 / 240, { x: 0, z: 0 });
      sim.ball.shell = shell;          // hold it there; we are probing wobble, not melt
      peak = Math.max(peak, Math.abs(sim.ball.v.x));
    }
    return peak;
  };
  const full = wob(1.0), thin = wob(0.25), bare = wob(0.0);
  ok(thin > full * 2, `thin ${thin.toFixed(3)} should far exceed full ${full.toFixed(3)}`);
  ok(bare > thin, `bare ${bare.toFixed(3)} should exceed thin ${thin.toFixed(3)}`);
});
t('a full shell is essentially steady', () => {
  const sim = settle(S.createSim(flat(0), { seed: 11 }), 1.0);
  for (let i = 0; i < 600; i++) { sim.step(1 / 240, { x: 0, z: 0 }); sim.ball.shell = 1; }
  ok(Math.abs(sim.ball.v.x) < 0.05, `drifted at ${sim.ball.v.x.toFixed(4)} m/s with a full shell`);
});

console.log('\nzero shell is a state, not a death');
t('bare survives a soft landing', () => {
  const sim = S.createSim(flat(0), { seed: 2 });
  sim.ball.shell = 0; sim.ball.r = S.T.R_MIN;
  sim.ball.p.y = S.T.R_MIN + 0.05; sim.ball.v = { x: 0, y: -1.5, z: 0 };
  for (let i = 0; i < 240; i++) sim.step(1 / 240, { x: 0, z: 0 });
  eq(sim.state, 'run', 'a gentle touch should not end it:');
});
t('bare does not survive a hard impact', () => {
  const sim = S.createSim(flat(0), { seed: 2 });
  sim.ball.shell = 0; sim.ball.r = S.T.R_MIN;
  sim.ball.p.y = 14; sim.ball.v.y = -8;
  for (let i = 0; i < 480; i++) sim.step(1 / 240, { x: 0, z: 0 });
  eq(sim.state, 'lost'); eq(sim.reason, 'woke');
});
t('the same hard impact is survivable with shell intact', () => {
  const sim = S.createSim(flat(0), { seed: 2 });
  sim.ball.p.y = 14; sim.ball.v.y = -8;
  for (let i = 0; i < 480; i++) sim.step(1 / 240, { x: 0, z: 0 });
  eq(sim.state, 'run', 'shell should have absorbed it:');
});

console.log('\ncontrol and integration');
t('tilt is capped however hard the stick is pushed', () => {
  const sim = S.createSim(flat(0), { seed: 1 });
  for (let i = 0; i < 600; i++) sim.step(1 / 240, { x: 99, z: -99 });
  near(sim.tilt.x, S.T.TILT_MAX, 1e-9); near(sim.tilt.z, -S.T.TILT_MAX, 1e-9);
});
t('tilt is an absolute mapping, not a rate', () => {
  const sim = S.createSim(flat(0), { seed: 1 });
  for (let i = 0; i < 600; i++) sim.step(1 / 240, { x: 0.5, z: 0 });
  const a = sim.tilt.x;
  for (let i = 0; i < 600; i++) sim.step(1 / 240, { x: 0.5, z: 0 });
  near(sim.tilt.x, a, 1e-9, 'holding the stick should hold an angle, not keep turning');
});
t('rolling acceleration matches 5/7 g sin(theta)', () => {
  const sim = S.createSim(flat(0), { seed: 1 });
  for (let i = 0; i < 200; i++) sim.step(1 / 240, { x: 1, z: 0 });
  const v0 = sim.ball.v.z, t0 = sim.time;
  for (let i = 0; i < 40; i++) sim.step(1 / 240, { x: 1, z: 0 });
  const a = (sim.ball.v.z - v0) / (sim.time - t0);
  const ideal = S.T.ROLL_INERTIA * S.T.G * Math.sin(S.T.TILT_MAX);
  near(a, ideal - S.T.ROLL_DRAG * v0, 0.35, 'measured vs analytic (with drag):');
});
t('falling below the kill plane ends the run', () => {
  const sim = S.createSim({ ...flat(0), boxes: [] }, { seed: 1 });
  for (let i = 0; i < 2000; i++) sim.step(1 / 240, { x: 0, z: 0 });
  eq(sim.state, 'lost'); eq(sim.reason, 'fell');
});
t('a long run never produces NaN', () => {
  const sim = S.createSim(flat(0.004, [{ p: [0, 0, 200], r: 60, q: 0.06 }]), { seed: 4 });
  for (let i = 0; i < 12000; i++) {
    sim.step(1 / 120, { x: Math.sin(i / 70), z: Math.cos(i / 53) });
    if (sim.state !== 'run') break;
  }
  const b = sim.ball;
  ok(Number.isFinite(b.p.x + b.p.y + b.p.z + b.v.x + b.v.y + b.v.z + b.shell), 'non-finite state');
});

console.log('\ndeterminism');
t('same seed reproduces a run exactly', () => {
  const pilot = (s) => ({ x: Math.sin(s.time * 1.7) * 0.8, z: Math.cos(s.time * 1.1) * 0.6 });
  const a = S.run(flat(0.004), pilot, { seed: 21, maxT: 12 });
  const b = S.run(flat(0.004), pilot, { seed: 21, maxT: 12 });
  eq(a.p.x, b.p.x); eq(a.p.z, b.p.z); eq(a.shell, b.shell);
});
t('a different seed really does change the run', () => {
  // Guards the classic bug where a "seeded" sweep is one run reported N times.
  const pilot = (s) => ({ x: Math.sin(s.time * 1.7) * 0.8, z: Math.cos(s.time * 1.1) * 0.6 });
  const a = S.run(flat(0.004), pilot, { seed: 21, maxT: 12 });
  const b = S.run(flat(0.004), pilot, { seed: 22, maxT: 12 });
  ok(Math.abs(a.p.x - b.p.x) > 1e-6 || Math.abs(a.p.z - b.p.z) > 1e-6, 'seeds produced identical runs');
});

console.log('\nstage data');
t('every stage has spawn support, a goal and waypoints', () => {
  for (const st of STAGES) {
    ok(st.waypoints && st.waypoints.length > 1, `${st.id} waypoints`);
    ok(st.boxes.length > 3, `${st.id} boxes`);
    ok(st.goal && st.goalR > 0, `${st.id} goal`);
    // the ball must land on something rather than spawn over a hole
    const s = S.prepareStage(st);
    const under = s.boxes.some((b) => Math.abs(st.spawn[0] - b.c[0]) < b.e[0] + 0.6
      && Math.abs(st.spawn[2] - b.c[2]) < b.e[2] + 0.6 && b.c[1] < st.spawn[1]);
    ok(under, `${st.id} spawns over empty space`);
  }
});
t('stage warmth rises along the descent', () => {
  ok(STAGES[0].warmth < STAGES[1].warmth && STAGES[1].warmth < STAGES[2].warmth,
     'the route descends into warmth, so ambient melt must climb stage to stage');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
