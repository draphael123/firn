/* How much imprecision does a stage tolerate?
 *
 * course-check proves a route is flyable. It does NOT prove it is playable,
 * because the pilot it flies with is nothing like a person: it re-decides every
 * frame, it reacts instantly, and above all it steers with CONTINUOUS values --
 * `clamp(err * kp, -1, 1)` -- so it spends most of a stage applying a gentle
 * quarter deflection that no keyboard can produce.
 *
 * A keyboard player has eight directions at FULL deflection, reacts in about a
 * sixth of a second, and cannot re-evaluate at 120 Hz. If a stage only survives
 * delicate analog trimming, it is unplayable however green course-check is.
 *
 * So this runs every stage through several player models and reports what
 * survives. The models are deliberately crude; the point is the GAP between
 * them, not any single number.
 *
 * The models that matter are the NOISY ones. A digital, laggy pilot that still
 * aims perfectly is not a person -- it is the same flawless controller with
 * coarser hands, and it clears everything. What a person actually does is aim
 * at slightly the wrong place and correct late, which is what `aimError` is.
 *
 *   node test/forgiveness.mjs
 */
import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

const DT = 1 / 120;

/**
 * Wraps a pilot in a player model.
 *
 * @param lag     seconds between deciding and the input taking effect
 * @param tick    seconds between decisions -- a person does not re-aim at 120Hz
 * @param digital true = eight directions at full deflection, as on a keyboard
 * @param dead    how far the analog intent must be before a key goes down
 */
function player(pilot, { lag = 0, tick = 0, digital = false, dead = 0.35, aimError = 0, rnd = Math.random } = {}) {
  const queue = [];
  let held = { x: 0, z: 0 };
  let nextDecision = 0;
  let drift = 0;

  return function step(sim) {
    if (sim.time >= nextDecision) {
      nextDecision = sim.time + tick;
      let { x, z } = pilot(sim);
      if (aimError) {
        /* A wandering bias, not white noise: people hold a slightly wrong line
         * for a while and then notice. White noise averages out to nothing and
         * would make the stage look far more forgiving than it is. */
        drift = Math.max(-aimError, Math.min(aimError, drift * 0.92 + (rnd() - 0.5) * aimError));
        const c = Math.cos(drift), sn = Math.sin(drift);
        const nx = x * c - z * sn, nz = x * sn + z * c;
        x = nx; z = nz;
      }
      if (digital) {
        // the key is down or it is not; there is no 30% forward
        x = Math.abs(x) > dead ? Math.sign(x) : 0;
        z = Math.abs(z) > dead ? Math.sign(z) : 0;
        const m = Math.hypot(x, z);
        if (m > 1) { x /= m; z /= m; }        // same normalisation main.js does
      }
      held = { x, z };
    }
    queue.push({ t: sim.time, v: held });
    while (queue.length > 1 && queue[0].t < sim.time - lag) queue.shift();
    return queue[0].v;
  };
}

function fly(stage, waypoints, model, opts = {}) {
  const sim = S.createSim(stage, { seed: opts.seed ?? 1 });
  const drive = player(autopilot(waypoints, opts), model);
  let maxZ = -1e9, fellAt = null;
  while (sim.state === 'run' && sim.time < 150) {
    sim.step(DT, drive(sim));
    if (sim.ball.p.z > maxZ) maxZ = sim.ball.p.z;
  }
  if (sim.state !== 'won') fellAt = { x: sim.ball.p.x, z: sim.ball.p.z, maxZ };
  return { won: sim.state === 'won', reason: sim.reason, t: sim.time, shell: sim.ball.shell, fellAt };
}

const MODELS = [
  ['perfect analog       ', {}],
  ['keyboard + 150ms lag ', { digital: true, lag: 0.15, tick: 0.10 }],
  ['+ slight misaim   9d ', { digital: true, lag: 0.15, tick: 0.10, aimError: 0.16 }],
  ['+ real misaim    17d ', { digital: true, lag: 0.18, tick: 0.12, aimError: 0.30 }],
  ['+ clumsy         29d ', { digital: true, lag: 0.22, tick: 0.14, aimError: 0.50 }],
];

console.log('\nhow much imprecision each stage tolerates');
console.log('(the pilot is the same; only the hands change)\n');

const rows = [];
for (const st of STAGES) {
  const stage = S.prepareStage(st);
  const line = [];
  for (const [name, model] of MODELS) {
    let ok = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7];
    let firstFail = null;
    for (const seed of seeds) {
      let n = seed * 8191 + 17;
      const rnd = () => (n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const r = fly(stage, st.waypoints, { ...model, rnd }, { seed });
      if (r.won) ok++; else if (!firstFail) firstFail = r;
    }
    line.push({ name, ok, of: seeds.length, firstFail });
  }
  rows.push({ st, line });
  const worst = line[line.length - 1];
  console.log(`${st.numeral.padEnd(4)}${st.name}`);
  for (const c of line) {
    const bar = c.ok === c.of ? 'ok  ' : 'FAIL';
    let detail = `${c.ok}/${c.of}`;
    if (c.firstFail) {
      const f = c.firstFail;
      detail += `   ${f.reason || 'timeout'} at z=${f.fellAt.z.toFixed(0)} (best z=${f.fellAt.maxZ.toFixed(0)})`;
    }
    console.log(`      ${bar}  ${c.name} ${detail}`);
  }
  console.log('');
  void worst;
}

const kbd = rows.filter((r) => r.line[3].ok < r.line[3].of);
if (kbd.length) {
  console.log(`${kbd.length} stage(s) a keyboard player cannot finish: `
    + kbd.map((r) => r.st.numeral).join(', '));
  console.log('the analog pilot finishing these proves nothing about playability\n');
  process.exit(1);
}
console.log('every stage survives a keyboard and a human reaction time\n');
