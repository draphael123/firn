/* Does each key move the ball the way it looks on screen?
 *
 * This is the check that was missing, and its absence cost a playtest. Every
 * other harness drives the sim with WORLD-space intent, where the mapping was
 * always self-consistent -- so course-check, climb-check and forgiveness all
 * passed while D steered left and A steered right. Only a person looking at the
 * screen could tell, because the inversion lives in the transform BETWEEN the
 * keyboard and the sim, and nothing was testing that transform.
 *
 * The geometry, stated once so the assertions have something to be right about:
 * the camera sits at ball + (-sin y, ., -cos y) * dist and looks back at the
 * ball, so
 *     forward on screen  f = ( sin y,  cos y)
 *     right on screen    r = (-cos y,  sin y)      (= f x up)
 * `r` is the surprising one and it is the one that was wrong: at y = 0 the
 * camera is behind the ball looking up +Z, and world +X projects to the LEFT.
 *
 *   node test/controls.mjs
 */
import * as S from '../src/sim.js';
import { STAGES } from '../src/stages.js';

/** main.js readInput(), reproduced. Keep in step with it. */
function mapKey(key, camYaw, settings = {}) {
  let ix = 0, iy = 0;
  if (key === 'w') iy += 1;
  if (key === 's') iy -= 1;
  if (key === 'd') ix += 1;
  if (key === 'a') ix -= 1;
  if (settings.invertPitch) iy = -iy;
  if (settings.invertRoll) ix = -ix;
  const yaw = settings.camRelative === false ? 0 : camYaw;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return { x: iy * cy + ix * sy, z: ix * cy - iy * sy };
}

/** Where the player expects to go, on screen, for each key. */
const WANT = {
  w: (y) => [Math.sin(y), Math.cos(y)],          // forward
  s: (y) => [-Math.sin(y), -Math.cos(y)],
  d: (y) => [-Math.cos(y), Math.sin(y)],         // screen right
  a: (y) => [Math.cos(y), -Math.sin(y)],
};

/** Drive one key from rest on a flat plate and report where the ball went. */
function drive(key, camYaw, settings) {
  const stage = S.prepareStage({
    id: 'flat', name: 'flat', numeral: '-', world: 'neve',
    warmth: 0, killY: -40, heat: [], spawn: [0, 1.2, 0],
    goal: [0, 1.2, 400], goalR: 3, waypoints: [[0, 0, 0]],
    boxes: [{ p: [0, -1, 0], s: [400, 2, 400], kind: 'stone' }],
  });
  const sim = S.createSim(stage, { seed: 1 });
  const inp = mapKey(key, camYaw, settings);
  for (let i = 0; i < 240; i++) sim.step(1 / 120, inp);
  const d = [sim.ball.p.x, sim.ball.p.z];
  const m = Math.hypot(d[0], d[1]) || 1;
  return [d[0] / m, d[1] / m];
}

let fails = 0;
const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.1];

console.log('\ndoes each key move the ball the way it looks on screen?\n');
for (const yaw of YAWS) {
  const deg = ((yaw * 180) / Math.PI).toFixed(0).padStart(4);
  const bad = [];
  for (const key of ['w', 's', 'd', 'a']) {
    const got = drive(key, yaw, {});
    const want = WANT[key](yaw);
    // cosine between where it went and where the player was looking
    const dot = got[0] * want[0] + got[1] * want[1];
    if (dot < 0.94) { bad.push(`${key} off by ${((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI).toFixed(0)}deg`); fails++; }
  }
  console.log(`  ${bad.length ? 'FAIL' : 'ok  '}  camera yaw ${deg}deg   ${bad.length ? bad.join(', ') : 'all four keys agree with the screen'}`);
}

// and the inversion settings must actually invert
console.log('');
for (const [label, st, key, opposite] of [
  ['invert roll ', { invertRoll: true }, 'd', 'a'],
  ['invert pitch', { invertPitch: true }, 'w', 's'],
]) {
  const got = drive(key, 0.9, st);
  const want = WANT[opposite](0.9);
  const ok = got[0] * want[0] + got[1] * want[1] > 0.94;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label} sends ${key} where ${opposite} would go`);
}

// camera-relative off must pin the mapping to world axes whatever the camera does
const fixed = drive('w', 1.9, { camRelative: false });
const okFixed = fixed[1] > 0.94;
if (!okFixed) fails++;
console.log(`  ${okFixed ? 'ok  ' : 'FAIL'}  fixed steering ignores the camera and holds world +Z`);

// a real stage, not just the flat plate: the first thing a player touches
const stage0 = S.prepareStage(STAGES[0]);
const sim = S.createSim(stage0, { seed: 1 });
const z0 = sim.ball.p.z;                     // stages do not spawn at the origin
for (let i = 0; i < 240; i++) sim.step(1 / 120, mapKey('w', 0, {}));
const gained = sim.ball.p.z - z0;
const okStage = gained > 6;
if (!okStage) fails++;
console.log(`  ${okStage ? 'ok  ' : 'FAIL'}  forward on The Threshold actually goes down the road   +${gained.toFixed(1)}m in 2s`);

console.log(fails ? `\n${fails} control check(s) failed\n` : '\nthe controls point where the camera does\n');
process.exit(fails ? 1 : 0);
