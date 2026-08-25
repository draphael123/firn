/* Hunt for places the ball can stall against real stage geometry.
 *
 * Drives each stage with the autopilot plus a constant lateral bias, so the
 * ball is pressed into whatever wall is nearest for the whole run, then flags
 * any moment where it is grounded and being asked to move but has effectively
 * stopped. This is looking for the "gets stuck on walls" report on the actual
 * geometry rather than on a synthetic test box.
 */
import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

const STALL_SPEED = 1.5;     // m/s
const STALL_TIME  = 0.8;     // seconds held below it while trying to move

let found = 0;
for (const st of STAGES) {
  // Bias is capped well below 1 so the pilot KEEPS steering authority. At
  // +/-1 the lateral input saturates, the pilot can never turn away, and every
  // wall looks like a stall -- an artefact of the probe, not a bug in the game.
  for (const bias of [-0.55, -0.3, 0.3, 0.55]) {
    const sim = S.createSim(st, { seed: 3 });
    const pilot = autopilot(st.waypoints, { cruise: 16, meltAt: st.meltAt });
    let stallFor = 0, worst = null;
    while (sim.state === 'run' && sim.time < 120) {
      const inp = pilot(sim);
      inp.z = Math.max(-1, Math.min(1, inp.z + bias));   // lean into the wall
      sim.step(1 / 120, inp);
      const b = sim.ball;
      const sp = Math.hypot(b.v.x, b.v.z);
      if (b.grounded && sp < STALL_SPEED) {
        stallFor += 1 / 120;
        if (stallFor > STALL_TIME && (!worst || stallFor > worst.dur)) {
          worst = { dur: stallFor, x: b.p.x, y: b.p.y, z: b.p.z, shell: b.shell };
        }
      } else stallFor = 0;
    }
    if (worst) {
      found++;
      console.log(`  STALL  ${st.id.padEnd(6)} bias ${String(bias).padStart(4)}  ` +
        `held ${worst.dur.toFixed(1)}s at (${worst.x.toFixed(1)}, ${worst.y.toFixed(1)}, ${worst.z.toFixed(1)})  shell ${(worst.shell*100).toFixed(0)}%`);
    } else {
      console.log(`  ok     ${st.id.padEnd(6)} bias ${String(bias).padStart(4)}  ` +
        `-> ${sim.state}${sim.reason ? '/' + sim.reason : ''} at z=${sim.ball.p.z.toFixed(0)} t=${sim.time.toFixed(0)}s`);
    }
  }
}
console.log(found ? `\n${found} stall site(s) found` : '\nno stalls found on any stage');
