/* Course verification.
 *
 * The point is not "did the sim return won" -- it is "did the thing the stage
 * is about actually happen". A run that wins by never reaching the gate proves
 * nothing, so the checks below assert the ball was where the design puts the
 * decision, carrying the shell the design says it needs.
 *
 * Stages are discovered, not hardcoded: gates and grates are found by scanning
 * each stage's own boxes, so a new stage is checked the moment it is added.
 */
import * as S from '../src/sim.js';
import { STAGES, shellForOpening, GATE_OPEN, GRATE_GAP } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

const GATE_SHELL = shellForOpening(GATE_OPEN);
const GRATE_SHELL = shellForOpening(GRATE_GAP);
const pct = (v) => (v * 100).toFixed(1) + '%';

let fails = 0;
function check(label, ok, detail = '') {
  if (!ok) fails++;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
}

/** Where, along the route, does this stage put its gate and its grate? */
function landmarks(stage) {
  const st = S.prepareStage(stage);
  const gate = st.boxes.find((b) => b.open !== undefined);
  const grate = st.boxes.find((b) => b.kind === 'grate');
  return {
    gateZ: gate ? gate.c[2] : undefined,
    grateZ: grate ? grate.c[2] - grate.e[2] : undefined,
  };
}

/** Runs a pilot and records the evidence the assertions need. */
function fly(stage, waypoints, opts = {}) {
  const sim = S.createSim(stage, { seed: opts.seed ?? 1 });
  const pilot = autopilot(waypoints, opts);
  const ev = { minShell: 1, maxZ: -1e9, gateShell: null, grateShell: null };
  const { gateZ, grateZ } = opts;
  let before = true;

  while (sim.state === 'run' && sim.time < (opts.maxT ?? 150)) {
    sim.step(1 / 120, pilot(sim));
    const b = sim.ball;
    ev.minShell = Math.min(ev.minShell, b.shell);
    ev.maxZ = Math.max(ev.maxZ, b.p.z);
    if (gateZ !== undefined && before && b.p.z > gateZ) { ev.gateShell = b.shell; before = false; }
    if (grateZ !== undefined && ev.grateShell === null && b.p.z > grateZ) ev.grateShell = b.shell;
  }
  return { state: sim.state, reason: sim.reason, time: sim.time, shell: sim.ball.shell, ev };
}

const say = (r) => `${r.state}${r.reason ? '/' + r.reason : ''}  t=${r.time.toFixed(1)}s  shell=${pct(r.shell)}`;

console.log('\nthresholds');
console.log(`  gate opening ${GATE_OPEN}  -> passable below shell ${GATE_SHELL.toFixed(3)}`);
console.log(`  grate gap    ${GRATE_GAP}  -> falls through below shell ${GRATE_SHELL.toFixed(3)}`);

let lastWarmth = -1;
for (const st of STAGES) {
  /* The boss is checked by test/boss-check.mjs, which knows about the bells.
   * A waypoint pilot here has no idea they exist, so it would be measuring a
   * stage nobody would ever play that way. */
  if (st.boss) continue;
  const lm = landmarks(st);
  console.log(`\n${st.numeral}. ${st.name}   [${st.world}]  warmth ${st.warmth}`);

  check('warmth rises as the thaw follows you up', st.warmth > lastWarmth, `${lastWarmth} -> ${st.warmth}`);
  lastWarmth = st.warmth;

  const main = fly(st, st.waypoints, { cruise: 13, meltAt: st.meltAt, ...lm });
  console.log(`   main  -> ${say(main)}`
    + (lm.gateZ !== undefined ? `  at gate=${main.ev.gateShell === null ? 'never reached' : pct(main.ev.gateShell)}` : '')
    + (lm.grateZ !== undefined ? `  at grate=${main.ev.grateShell === null ? 'never reached' : pct(main.ev.grateShell)}` : ''));
  check('main route completable', main.state === 'won');
  check('sensible length (bot pace; a player is faster)', main.time > 8 && main.time < 60, `${main.time.toFixed(1)}s`);

  if (lm.gateZ !== undefined) {
    check('the route actually reached the gate', main.ev.gateShell !== null);
    // sampled past the lintel, so a hair of solver slop is fine
    check('melted enough to fit the gate',
      main.ev.gateShell !== null && main.ev.gateShell < GATE_SHELL + 0.01,
      main.ev.gateShell === null ? '' : `${pct(main.ev.gateShell)} < ${pct(GATE_SHELL)}`);
  }
  if (lm.grateZ !== undefined) {
    check('the route actually reached the grate', main.ev.grateShell !== null);
    check('still thick enough for the grate to hold',
      main.ev.grateShell !== null && main.ev.grateShell > GRATE_SHELL,
      main.ev.grateShell === null ? '' : `${pct(main.ev.grateShell)} > ${pct(GRATE_SHELL)}`);
  }

  if (st.altRoute) {
    const alt = fly(st, st.altRoute, { cruise: 13, ...lm });
    console.log(`   alt   -> ${say(alt)}`
      + (lm.gateZ !== undefined && alt.ev.gateShell !== null ? `  at gate line=${pct(alt.ev.gateShell)}` : ''));
    check('the detour is completable without melting', alt.state === 'won');
    if (lm.gateZ !== undefined) {
      // Measured where the GATE is, not at the finish. On a long hot stage the
      // detour melts below the threshold by the end simply from being out in
      // the air that long -- which says nothing about whether it needed the
      // gate. What matters is that it got PAST the gate line still too thick
      // to have used it, which is what proves the way round is genuine.
      check('the detour got past the gate line without melting down',
        alt.ev.gateShell === null || alt.ev.gateShell > GATE_SHELL,
        alt.ev.gateShell === null ? 'never crossed it' : `${pct(alt.ev.gateShell)} > ${pct(GATE_SHELL)}`);
    }
    /* Does one route beat the other on BOTH axes?
     *
     * The old form of this only compared times within 12 seconds, which passed
     * for anything and so proved nothing. What actually breaks a gate as a
     * DECISION is one line winning on time AND on shell at once -- then there is
     * nothing to weigh and the gate is just a wall you can walk around.
     *
     * The tutorial is exempt and says so: there the gate is the LESSON, taken
     * slowly and deliberately, and the way round is the safety valve for anyone
     * who cannot make it fit yet. Everywhere else the gate has to earn its keep.
     *
     * The true margin still is not measurable here -- the pilot crawls while it
     * melts where a person dives the hot spot and leaves -- so this asserts the
     * SHAPE of the trade, not its size. */
    const fasterMain = main.time < alt.time;
    const thickerMain = main.shell > alt.shell;
    const dominates = fasterMain === thickerMain;   // same line wins both -> no trade
    check(st.tutorial ? 'gate vs detour (tutorial: gate is the lesson, not the line)'
                      : 'neither route wins on BOTH time and shell',
      st.tutorial ? true : !dominates,
      `${main.time.toFixed(1)}s / ${pct(main.shell)} via the gate`
      + `  vs  ${alt.time.toFixed(1)}s / ${pct(alt.shell)} round`);
  }
}

console.log(fails === 0 ? '\nall course checks passed\n' : `\n${fails} course check(s) failed\n`);
process.exit(fails ? 1 : 0);
