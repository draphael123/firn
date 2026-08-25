/* Where does a route leave the road?
 *
 * Reports the last grounded point and the first airborne point for every route
 * that fails, which is almost always enough to name the hole -- a plate that
 * stops short, a kerb with a gap, or waypoints that cut a corner through one.
 *
 *   node test/where-fell.mjs            all failing routes
 *   node test/where-fell.mjs icefall    just that stage
 */
import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';
import { autopilot } from '../src/autopilot.js';

const only = process.argv[2];

function probe(stage, routeName) {
  const wps = stage[routeName];
  if (!wps) return null;
  const sim = S.createSim(stage, { seed: 1 });
  const pilot = autopilot(wps, { cruise: 13, meltAt: routeName === 'waypoints' ? stage.meltAt : undefined });
  let lastGround = null, firstAir = null;
  while (sim.state === 'run' && sim.time < 150) {
    sim.step(1 / 120, pilot(sim));
    const b = sim.ball;
    if (b.grounded) { lastGround = { t: sim.time, x: b.p.x, y: b.p.y, z: b.p.z }; firstAir = null; }
    else if (!firstAir) firstAir = { t: sim.time, x: b.p.x, y: b.p.y, z: b.p.z };
  }
  return { state: sim.state, reason: sim.reason, t: sim.time, lastGround, firstAir };
}

const f = (p) => (p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : 'n/a');

for (const st of STAGES) {
  if (only && st.id !== only) continue;
  for (const route of ['waypoints', 'altRoute']) {
    const r = probe(st, route);
    if (!r) continue;
    const bad = r.state !== 'won';
    if (only || bad) {
      console.log(`${st.numeral.padEnd(3)} ${st.id.padEnd(10)} ${route.padEnd(10)} ` +
        `-> ${(r.state + (r.reason ? '/' + r.reason : '')).padEnd(11)} t=${r.t.toFixed(1)}s`);
      if (bad) {
        console.log(`      left the road at ${f(r.lastGround)}  ->  airborne from ${f(r.firstAir)}`);
      }
    }
  }
}
