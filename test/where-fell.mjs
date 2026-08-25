import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

const which = process.argv[2] || 'thaw';
const route = process.argv[3] || 'altRoute';
const st = STAGES.find((s) => s.id === which);
const sim = S.createSim(st, { seed: 1 });
const pilot = autopilot(st[route], { cruise: 11 });

let last = [];
while (sim.state === 'run' && sim.time < 150) {
  sim.step(1 / 120, pilot(sim));
  const b = sim.ball;
  last.push([sim.time, b.p.x, b.p.y, b.p.z, b.grounded]);
  if (last.length > 260) last.shift();
}
console.log(`${st.name} / ${route} -> ${sim.state}${sim.reason ? '/' + sim.reason : ''} at t=${sim.time.toFixed(2)}`);
console.log('last airborne-onward samples (t, x, y, z, grounded):');
// find where it last touched anything
let i = last.length - 1;
while (i > 0 && !last[i][4]) i--;
for (let k = Math.max(0, i - 4); k < last.length; k += 12) {
  const [t, x, y, z, g] = last[k];
  console.log(`  t=${t.toFixed(2)}  x=${x.toFixed(1).padStart(7)}  y=${y.toFixed(1).padStart(7)}  z=${z.toFixed(1).padStart(7)}  ${g ? 'ground' : 'air'}`);
}
