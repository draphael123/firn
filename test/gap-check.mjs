/* Walk every route's waypoint polyline and report anywhere there is no floor.
 *
 * Chasing holes one autopilot run at a time is slow: each run reports only the
 * FIRST place it left the road, so a stage with four gaps takes four rounds.
 * This samples the intended path directly and lists every unsupported span at
 * once, plus any step too tall for a ball to climb.
 *
 * The surface height of a ROTATED plate varies along its length, so taking the
 * box's centre height plus its half-thickness reports every ramp as a hole
 * followed by an impossible step. The top face is a plane: intersect it.
 *
 *   node test/gap-check.mjs
 */
import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';

const STEP = 0.6;          // sample spacing along the path, metres
const REACH = 5.0;         // how far below a sample we will accept a floor
const MAX_STEP = 0.62;     // a ball of radius 0.55 cannot climb more than this

const _o = [0, 0, 0];

/** World height of a box's top surface at (x,z), or null if (x,z) is off it. */
function topAt(b, x, z, y) {
  if (!b.q) {
    if (Math.abs(x - b.c[0]) > b.e[0] + 0.25) return null;
    if (Math.abs(z - b.c[2]) > b.e[2] + 0.25) return null;
    return b.c[1] + b.e[1];
  }
  // top-face plane: normal n = q*(0,1,0), through p0 = c + e1 * n
  S.rotV(b.q, 0, 1, 0, _o);
  const nx = _o[0], ny = _o[1], nz = _o[2];
  if (Math.abs(ny) < 1e-4) return null;                  // a wall, not a floor
  const p0x = b.c[0] + b.e[1] * nx;
  const p0y = b.c[1] + b.e[1] * ny;
  const p0z = b.c[2] + b.e[1] * nz;
  const ty = p0y - (nx * (x - p0x) + nz * (z - p0z)) / ny;
  // and confirm (x,ty,z) really lies within the plate's own extent
  S.rotV(b.qc, x - b.c[0], ty - b.c[1], z - b.c[2], _o);
  if (Math.abs(_o[0]) > b.e[0] + 0.25) return null;
  if (Math.abs(_o[2]) > b.e[2] + 0.25) return null;
  return ty;
}

/** Highest solid top under (x,z) within reach of y, or null. */
function floorUnder(stage, x, y, z) {
  let best = null;
  for (const b of stage.boxes) {
    if (b.kind === 'rail' || b.kind === 'gate') continue;
    const top = topAt(b, x, z, y);
    if (top === null) continue;
    if (top <= y + 1.4 && top >= y - REACH && (best === null || top > best)) best = top;
  }
  return best;
}

let problems = 0;
for (const st of STAGES) {
  const stage = S.prepareStage(st);
  for (const route of ['waypoints', 'altRoute']) {
    const wps = st[route];
    if (!wps) continue;
    const holes = [];
    const steps = [];
    let prevTop = null;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1];
      const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const n = Math.max(1, Math.ceil(d / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t;
        const z = a[2] + (b[2] - a[2]) * t;
        const top = floorUnder(stage, x, y + 1.0, z);
        if (top === null) { holes.push([x, y, z]); prevTop = null; }
        else {
          if (prevTop !== null && top - prevTop > MAX_STEP) steps.push([x, z, top - prevTop]);
          prevTop = top;
        }
      }
    }
    if (holes.length || steps.length) {
      problems++;
      console.log(`${st.numeral.padEnd(3)} ${st.id.padEnd(10)} ${route}`);
      if (holes.length) {
        let s0 = holes[0], last = holes[0];
        const flush = () => console.log(`      NO FLOOR  (${s0[0].toFixed(0)}, ${s0[2].toFixed(0)}) -> (${last[0].toFixed(0)}, ${last[2].toFixed(0)})`);
        for (const h of holes.slice(1)) {
          if (Math.hypot(h[0] - last[0], h[2] - last[2]) > STEP * 2.5) { flush(); s0 = h; }
          last = h;
        }
        flush();
      }
      for (const [x, z, dy] of steps.slice(0, 5)) {
        console.log(`      STEP UP   ${dy.toFixed(2)}m at (${x.toFixed(0)}, ${z.toFixed(0)})`);
      }
    }
  }
}
console.log(problems ? `\n${problems} route(s) with holes\n` : '\nevery route is fully supported\n');
