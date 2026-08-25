/* The Warden.
 *
 * A chase is easy to build and easy to get wrong in a way that looks fine: if
 * the beast is too slow it is scenery, if it is too fast the stage is a coin
 * flip, and if the bells do not actually change the outcome then the one verb
 * the boss adds is decoration. So this asserts the SHAPE of the encounter, not
 * just that a pilot can finish it:
 *
 *   1. ringing the bells gets you to the cradle
 *   2. the bells buy real DISTANCE over ignoring them
 *   3. ignoring them lets it get genuinely close
 *   4. the last stretch has no bells left, so the finish is a real sprint
 *
 * Point 2 is the one that matters -- it is the difference between a mechanic
 * and an ornament, and it fails first if the tuning drifts. It is measured as
 * distance rather than as blows landed because a pilot that drives well is
 * necessarily FASTER than the beast (otherwise the stage is unwinnable) and so
 * never takes a hit either way. Counting blows here measures nothing at all.
 *
 *   node test/boss-check.mjs
 */
import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

const boss = STAGES.find((s) => s.boss);
if (!boss) { console.log('no boss stage'); process.exit(1); }

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
};

/** The line that visits every bell-pull, in order, on the way up. */
function bellRoute() {
  const wps = boss.waypoints.map((w) => w.slice());
  for (const b of boss.hunt.bells) {
    let at = wps.length - 1;
    for (let i = 0; i < wps.length; i++) if (wps[i][2] > b[2]) { at = i; break; }
    wps.splice(at, 0, [b[0], b[1], b[2]]);
  }
  return wps;
}

function run(route, opts = {}) {
  const stage = S.prepareStage(boss);
  const sim = S.createSim(stage, { seed: opts.seed ?? 1 });
  const pilot = autopilot(route, { cruise: opts.cruise ?? 15 });
  let minGap = Infinity, rung = 0, struck = 0;
  while (sim.state === 'run' && sim.time < 200) {
    sim.step(1 / 120, pilot(sim));
    for (const e of sim.events) {
      if (e.type === 'bell') rung++;
      if (e.type === 'struck') struck++;
    }
    sim.events.length = 0;
    if (sim.hunt && sim.hunt.gap < minGap) minGap = sim.hunt.gap;
  }
  return { state: sim.state, reason: sim.reason, t: sim.time, shell: sim.ball.shell, minGap, rung, struck };
}

console.log(`\n${boss.numeral}. ${boss.name}\n`);
console.log(`   speed ${boss.hunt.speed} m/s, escalating to `
  + boss.hunt.escalate.map((e) => e.speed).join(' then ') + ` m/s`);
console.log(`   ${boss.hunt.bells.length} bells\n`);

const withBells = run(bellRoute());
console.log(`   ringing the bells   -> ${withBells.state}${withBells.reason ? '/' + withBells.reason : ''}`
  + `  t=${withBells.t.toFixed(1)}s  shell=${(withBells.shell * 100).toFixed(0)}%`
  + `  rang=${withBells.rung}  blows=${withBells.struck}  closest=${withBells.minGap.toFixed(1)}m`);

const ignoring = run(boss.waypoints);
console.log(`   ignoring them       -> ${ignoring.state}${ignoring.reason ? '/' + ignoring.reason : ''}`
  + `  t=${ignoring.t.toFixed(1)}s  shell=${(ignoring.shell * 100).toFixed(0)}%`
  + `  rang=${ignoring.rung}  blows=${ignoring.struck}  closest=${ignoring.minGap.toFixed(1)}m\n`);

check('the bell line reaches the cradle', withBells.state === 'won');
check('every bell is actually reachable', withBells.rung === boss.hunt.bells.length,
  `${withBells.rung}/${boss.hunt.bells.length}`);

/* The margin, not the blows.
 *
 * A pilot that drives the road well is FASTER than the beast -- it has to be,
 * or the stage would be unwinnable -- so it never takes a hit either way, and
 * counting blows measures nothing. What the bells actually buy is DISTANCE, so
 * that is what gets asserted: ring them and you finish comfortably clear;
 * ignore them and the same clean run finishes with it breathing on you. */
check('it is a real threat when you ignore the bells', ignoring.minGap < 16,
  `closest ${ignoring.minGap.toFixed(1)}m without them`);
check('the bells buy real distance', withBells.minGap - ignoring.minGap > 14,
  `${withBells.minGap.toFixed(0)}m clear with, ${ignoring.minGap.toFixed(0)}m without`);
check('a clean run is never simply killed', withBells.struck === 0,
  `${withBells.struck} blows`);
/* The strongest statement this file makes. A boss whose mechanic is optional is
 * a boss with no mechanic -- if the same line wins whether or not you ever touch
 * a bell, the bells are scenery and the stage is just a long road. */
check('the bells are NOT optional', ignoring.state !== 'won',
  `ignoring them: ${ignoring.state}${ignoring.reason ? '/' + ignoring.reason : ''} at ${ignoring.t.toFixed(0)}s`);
check('sensible length (bot pace)', withBells.t > 25 && withBells.t < 110, `${withBells.t.toFixed(1)}s`);

// the finish must be a sprint: nothing left to ring over the last stretch
const lastBell = Math.max(...boss.hunt.bells.map((b) => b[2]));
const goalZ = boss.goal[2];
check('the last stretch has no bell to lean on', goalZ - lastBell > 80,
  `${(goalZ - lastBell).toFixed(0)}m of open road after the last bell`);

console.log(fails ? `\n${fails} boss check(s) failed\n` : '\nthe Warden works as an encounter\n');
process.exit(fails ? 1 : 0);
