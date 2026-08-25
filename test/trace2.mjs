import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';
const st = STAGES[1];
const sim = S.createSim(st, { seed: 1 });
const pilot = autopilot(st.waypoints, { cruise: 11, meltAt: st.meltAt });
let n = 0;
while (sim.state === 'run' && sim.time < 60) {
  sim.step(1/120, pilot(sim));
  if (++n % 120 === 0) {
    const b = sim.ball;
    console.log(`t=${sim.time.toFixed(0).padStart(3)}  x=${b.p.x.toFixed(1).padStart(6)} z=${b.p.z.toFixed(1).padStart(6)}  shell=${(b.shell*100).toFixed(1).padStart(5)}%  amb=${sim.ambientLast.toFixed(4)}`);
  }
}
console.log(sim.state, sim.time.toFixed(1));
