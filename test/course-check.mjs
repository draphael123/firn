/* Course verification.
 *
 * The point is not "did the sim return won" -- it is "did the thing the stage
 * is about actually happen". A run that wins by never reaching the gate proves
 * nothing, so every check below asserts the ball was where the design says the
 * decision is, carrying the shell the design says it needs.
 */
import * as S from '../src/sim.js';
import { STAGES, shellForOpening, GATE_OPEN, GRATE_GAP } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

/** Runs a pilot and records the evidence the assertions need. */
function fly(stage, waypoints, opts = {}) {
  const sim = S.createSim(stage, { seed: opts.seed ?? 1 });
  const pilot = autopilot(waypoints, opts);
  const dt = 1 / 120;
  const ev = { minShell: 1, maxZ: -1e9, gateShell: null, grateShell: null, shellAtZ: {} };
  const gateZ = opts.gateZ, grateZ = opts.grateZ;
  let wasBefore = true;

  while (sim.state === 'run' && sim.time < (opts.maxT ?? 150)) {
    sim.step(dt, pilot(sim));
    const b = sim.ball;
    ev.minShell = Math.min(ev.minShell, b.shell);
    ev.maxZ = Math.max(ev.maxZ, b.p.z);
    if (gateZ !== undefined && wasBefore && b.p.z > gateZ) { ev.gateShell = b.shell; wasBefore = false; }
    if (grateZ !== undefined && ev.grateShell === null && b.p.z > grateZ) ev.grateShell = b.shell;
  }
  return { state: sim.state, reason: sim.reason, time: sim.time, shell: sim.ball.shell, p: { ...sim.ball.p }, ev };
}

// ---------------------------------------------------------------- report

const pct = (v) => (v * 100).toFixed(1) + '%';
let fails = 0;
function check(label, ok, detail = '') {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
}

console.log('\nthresholds');
console.log(`  gate opening ${GATE_OPEN}  -> passable below shell ${shellForOpening(GATE_OPEN).toFixed(3)}`);
console.log(`  grate gap    ${GRATE_GAP}  -> falls through below shell ${shellForOpening(GRATE_GAP).toFixed(3)}`);

const GATE_SHELL = shellForOpening(GATE_OPEN);
const GRATE_SHELL = shellForOpening(GRATE_GAP);

// ---- Stage 1: completable, and barely melts.
{
  const st = STAGES[0];
  console.log(`\n${st.numeral}. ${st.name}`);
  const r = fly(st, st.waypoints, { cruise: 10 });
  console.log(`  -> ${r.state}${r.reason ? '/' + r.reason : ''}  t=${r.time.toFixed(1)}s  shell=${pct(r.shell)}  maxZ=${r.ev.maxZ.toFixed(0)}`);
  check('completable', r.state === 'won');
  check('meets the mechanic without being threatened by it', r.shell > 0.85, `shell ${pct(r.shell)}`);
  check('sensible stage length (bot pace; a player is faster)', r.time > 9 && r.time < 45, `${r.time.toFixed(1)}s`);
}

// ---- Stage 2: the long way works untouched; the gate way needs melting.
{
  const st = STAGES[1];
  console.log(`\n${st.numeral}. ${st.name}`);

  const long = fly(st, st.altRoute, { cruise: 11 });
  console.log(`  long route -> ${long.state}${long.reason ? '/' + long.reason : ''}  t=${long.time.toFixed(1)}s  shell=${pct(long.shell)}`);
  check('long route completable with no melting required', long.state === 'won');
  check('long route never needed the gate', long.shell > GATE_SHELL, `shell ${pct(long.shell)} > ${pct(GATE_SHELL)}`);

  const fast = fly(st, st.waypoints, { cruise: 11, gateZ: 50, meltAt: st.meltAt });
  console.log(`  gate route -> ${fast.state}${fast.reason ? '/' + fast.reason : ''}  t=${fast.time.toFixed(1)}s  shell=${pct(fast.shell)}  at gate=${fast.ev.gateShell === null ? 'never reached' : pct(fast.ev.gateShell)}`);
  check('gate route actually reached the gate', fast.ev.gateShell !== null);
  check('gate route completable', fast.state === 'won');
  // Sampled on the far side of the lintel, so a hair of solver slop is fine.
  check('the basin melted it enough to fit', fast.ev.gateShell !== null && fast.ev.gateShell < GATE_SHELL + 0.01,
        fast.ev.gateShell === null ? '' : `${pct(fast.ev.gateShell)} < ${pct(GATE_SHELL)}`);
  // Both routes viable and neither strictly dominant. The real margin is NOT
  // measurable here: the pilot crawls at 4.5 m/s while it melts, where a human
  // dives the hot spot and leaves. Treat this as "no route is a trap" only --
  // the actual gate-vs-detour payoff is a playtest question.
  check('neither route strictly dominates', Math.abs(fast.time - long.time) < 8,
        `gate ${fast.time.toFixed(1)}s vs detour ${long.time.toFixed(1)}s -- true margin needs playtest`);
}

// ---- Stage 3: the squeeze between the two thresholds.
{
  const st = STAGES[2];
  console.log(`\n${st.numeral}. ${st.name}`);

  const long = fly(st, st.altRoute, { cruise: 11, grateZ: 90 });
  console.log(`  long route -> ${long.state}${long.reason ? '/' + long.reason : ''}  t=${long.time.toFixed(1)}s  shell=${pct(long.shell)}  at grate=${long.ev.grateShell === null ? 'never reached' : pct(long.ev.grateShell)}`);
  check('long route reached the grate', long.ev.grateShell !== null);
  check('long route survives the grate', long.state === 'won');
  check('long route is above the grate threshold', long.ev.grateShell !== null && long.ev.grateShell > GRATE_SHELL,
        long.ev.grateShell === null ? '' : `${pct(long.ev.grateShell)} > ${pct(GRATE_SHELL)}`);

  const fast = fly(st, st.waypoints, { cruise: 11, gateZ: 58, grateZ: 90 });
  console.log(`  gate route -> ${fast.state}${fast.reason ? '/' + fast.reason : ''}  t=${fast.time.toFixed(1)}s  shell=${pct(fast.shell)}  at gate=${fast.ev.gateShell === null ? 'never reached' : pct(fast.ev.gateShell)}  at grate=${fast.ev.grateShell === null ? 'never reached' : pct(fast.ev.grateShell)}`);
  check('gate route reached the gate', fast.ev.gateShell !== null);
}

console.log(fails === 0 ? '\nall course checks passed\n' : `\n${fails} course check(s) failed\n`);
process.exit(fails ? 1 : 0);
