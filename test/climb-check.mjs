/* Can every rise actually be climbed -- at the SETTINGS the player might pick?
 *
 * A tilt game moves the ball by leaning the floor, so an uphill ramp of angle
 * `slope` only rolls you forward while your tilt exceeds it. Tilt is a player
 * setting: someone on the gentlest option has 21 degrees, not 26. A ramp that
 * is fine on the default can be literally impossible on the low one, and no
 * amount of skill recovers it -- the stage is simply not completable.
 *
 * This measures every ramp in the game against the WORST tilt limit offered,
 * and reports the acceleration and steady speed left over at the top.
 *
 *   node test/climb-check.mjs
 */
import * as S from '../src/sim.js';
import { STAGES, TITLE_SCENE } from '../src/stages.js';
import { SETTINGS_SCHEMA } from '../src/ui.js';

const tiltItem = SETTINGS_SCHEMA.flatMap((g) => g.items).find((i) => i.key === 'tiltMax');
const TILTS = tiltItem.values;
const MIN_TILT = Math.min(...TILTS);
const DEG = 180 / Math.PI;

// A rise wants to be climbable at a decent clip, not merely non-negative:
// crawling up at 2 m/s is technically possible and miserable to play.
const WANT_SPEED = 6.0;      // m/s of steady climbing speed at the worst tilt

console.log(`\ntilt options: ${TILTS.map((t) => (t * DEG).toFixed(0) + '°').join('  ')}`);
console.log(`worst case:   ${(MIN_TILT * DEG).toFixed(0)}°  -- every rise is judged against this\n`);

let worst = null;
let fails = 0;

for (const st of [...STAGES, TITLE_SCENE]) {
  const stage = S.prepareStage(st);
  const rises = [];
  for (const b of stage.boxes) {
    if (b.kind !== 'stone' || !b.rot) continue;
    const a = b.rot[0];
    if (!a) continue;
    // rot X negative means the +Z end is lifted: the route climbs
    const slope = -a;
    if (slope <= 0.01) continue;                 // level or descending
    const left = MIN_TILT - slope;
    const accel = S.T.ROLL_INERTIA * S.T.G * Math.sin(Math.max(0, left));
    const speed = left > 0 ? accel / S.T.ROLL_DRAG : 0;
    rises.push({ slope, left, accel, speed, z: b.c[2] });
  }
  if (!rises.length) continue;
  rises.sort((p, q) => q.slope - p.slope);
  const steepest = rises[0];
  const ok = steepest.speed >= WANT_SPEED;
  if (!ok) fails++;
  if (!worst || steepest.slope > worst.slope) worst = { ...steepest, stage: st.name };
  console.log(
    `${ok ? '  ok  ' : '  FAIL'}  ${st.numeral.padEnd(3)} ${st.name.padEnd(18)}` +
    `steepest ${(steepest.slope * DEG).toFixed(1).padStart(5)}°` +
    `   left ${(steepest.left * DEG).toFixed(1).padStart(5)}°` +
    `   climbs at ${steepest.speed.toFixed(1).padStart(5)} m/s` +
    `   (${rises.length} rise${rises.length === 1 ? '' : 's'})`
  );
}

console.log(`\nsteepest rise in the game: ${(worst.slope * DEG).toFixed(1)}° on ${worst.stage}`);
console.log(fails === 0
  ? `every rise climbs at ${WANT_SPEED}+ m/s even on the gentlest tilt setting\n`
  : `\n${fails} stage(s) have a rise that is unclimbable or a crawl at ${(MIN_TILT * DEG).toFixed(0)}°\n`);
process.exit(fails ? 1 : 0);
