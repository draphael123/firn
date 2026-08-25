/* Is there floor under the whole ROAD -- not just under the middle of it?
 *
 * The first version of this walked the route's centreline and nothing else,
 * which made it structurally incapable of finding the bug that mattered most:
 * arc() sized its chord segments from the centreline radius, so every bend had
 * a hole at its OUTER edge and none at all in the middle. The checker was clean
 * while the tutorial was unplayable.
 *
 * So it samples lanes across the road now. The lateral direction comes from the
 * local direction of travel, and how far a lane may stray is bounded by
 * projecting the plate underneath onto that direction -- so a lane never wanders
 * off the surface it is measuring and reports the verge as a hole.
 *
 * The tempting shortcut, "the shorter horizontal extent is the one across the
 * road", is wrong exactly where it matters: an arc chord is 12 wide and 2 long,
 * so it picks the along-road axis and measures a road one metre across. That
 * version of this file found nothing at all.
 *
 * A lane point with no floor is only reported when the points before and after
 * it in the same lane DO have floor: a hole in the road, rather than its edge.
 *
 * WHAT IT STILL GETS WRONG, and why that is left alone. Where the route runs
 * diagonally across a plate, an offset perpendicular to travel reaches toward
 * the plate's CORNER, so the outer lane can step over the lip and rejoin the
 * road further on. That overshoot is not a defect to remove -- it is the same
 * mechanism that finds the arc bug, where the hole sits in the wedge between two
 * chords. What separates the two is LENGTH: a hole the ball can fall into is
 * under a metre, a lane that left the road at a narrowing is missing floor for
 * far longer. Hence MAX_GAP.
 *
 * Four reports survive all of that, all diagonal overshoot, all confirmed by
 * hand against the geometry. This is a HINT TOOL, not a gate -- course-check
 * drives the stages and is the thing that says whether they are playable. Two of
 * its reports were real (kerbs left at the wrong height when the ramps were
 * flattened) and a third was not: a kerb drawn to a plate's edge where a bend
 * overlapped it stood in the middle of the road and made the stage unfinishable.
 * Check anything this file says against course-check before believing it.
 *
 *   node test/gap-check.mjs           check every stage
 *   node test/gap-check.mjs --selftest  prove it catches a known-bad arc
 */
import * as S from '../src/sim.js';
import { STAGES, TITLE_SCENE } from '../src/stages.js';

const STEP = 0.5;                              // along the route, metres
const LANES = [-0.92, -0.66, -0.34, 0, 0.34, 0.66, 0.92];  // fraction of half-width
const REACH = 5.0;
const MAX_STEP = 0.62;
const MAX_GAP = 1.5;                           // longer than this and the lane left the road                         // a ball cannot climb more than this

const _o = [0, 0, 0];

/** World height of a box's top surface at (x,z), or null if (x,z) is off it. */
function topAt(b, x, z) {
  if (!b.q) {
    if (Math.abs(x - b.c[0]) > b.e[0] + 0.05) return null;
    if (Math.abs(z - b.c[2]) > b.e[2] + 0.05) return null;
    return b.c[1] + b.e[1];
  }
  S.rotV(b.q, 0, 1, 0, _o);
  const nx = _o[0], ny = _o[1], nz = _o[2];
  if (Math.abs(ny) < 1e-4) return null;                    // a wall, not a floor
  const p0x = b.c[0] + b.e[1] * nx;
  const p0y = b.c[1] + b.e[1] * ny;
  const p0z = b.c[2] + b.e[1] * nz;
  const ty = p0y - (nx * (x - p0x) + nz * (z - p0z)) / ny;
  S.rotV(b.qc, x - b.c[0], ty - b.c[1], z - b.c[2], _o);
  if (Math.abs(_o[0]) > b.e[0] + 0.05) return null;
  if (Math.abs(_o[2]) > b.e[2] + 0.05) return null;
  return ty;
}

/** The highest surface under (x,z) near y, and the box it belongs to. */
function support(stage, x, y, z) {
  let best = null, bestBox = null;
  for (const b of stage.boxes) {
    // 'block' is deliberate obstacle geometry -- fallen masonry, kickers,
    // standing stone. It is meant to be a step in the road, so reporting it as
    // one is noise; what matters is the deck underneath it.
    if (b.kind === 'rail' || b.kind === 'gate' || b.kind === 'block') continue;
    const top = topAt(b, x, z);
    if (top === null) continue;
    if (top <= y + 1.4 && top >= y - REACH && (best === null || top > best)) {
      best = top; bestBox = b;
    }
  }
  return bestBox ? { top: best, box: bestBox } : null;
}

/**
 * How far a plate reaches from its centre along a world direction (dx,dz).
 *
 * "The shorter horizontal extent is the one across the road" is a tempting
 * shortcut and it is wrong exactly where it matters: an arc chord is 12 wide
 * and 2 long, so that rule picks the ALONG-road axis and measures a road one
 * metre across. The lateral direction comes from the direction of travel
 * instead, and this projects the box onto it -- correct for any orientation.
 */
function reachAlong(b, dx, dz) {
  let axx = 1, axz = 0, azx = 0, azz = 1;
  if (b.q) {
    S.rotV(b.q, 1, 0, 0, _o); axx = _o[0]; axz = _o[2];
    S.rotV(b.q, 0, 0, 1, _o); azx = _o[0]; azz = _o[2];
  }
  return Math.abs(b.e[0] * (axx * dx + axz * dz))
       + Math.abs(b.e[2] * (azx * dx + azz * dz));
}

/**
 * Is there a kerb between the centreline and a lane sample?
 *
 * Waypoints are sparse at bends, so the polyline cuts the corner and a lane
 * offset perpendicular to it can point off the real road. Those samples find no
 * floor and look exactly like holes. But a place the ball cannot reach -- because
 * a kerb stands between it and the road -- is not a hazard whatever is under it,
 * and that is a filter with a reason rather than a fudge factor.
 */
function kerbBetween(stage, x0, z0, x1, z1, y) {
  const dx = x1 - x0, dz = z1 - z0;
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dz) / 0.25));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const x = x0 + dx * t, z = z0 + dz * t;
    for (const b of stage.boxes) {
      if (b.kind !== 'rail') continue;
      if (Math.abs(b.c[1] - y) > 2.5) continue;            // a kerb on another deck
      if (topAt(b, x, z) !== null) return true;
    }
  }
  return false;
}

/** Dense samples along a route's polyline. */
function walk(wps) {
  const out = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i], b = wps[i + 1];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  out.push(wps[wps.length - 1]);
  return out;
}

/** @returns { holes, steps } for one route across every lane. */
export function checkRoute(stage, wps) {
  const path = walk(wps);
  const holes = [], steps = [];

  // resolve the centreline first: it decides where each lane is measured from,
  // and the local direction of travel gives the axis to measure across
  const spine = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    return {
      p,
      s: support(stage, p[0], p[1] + 1.0, p[2]),
      lx: -dz / len, lz: dx / len,          // perpendicular to travel
    };
  });

  for (const frac of LANES) {
    let prevTop = null, prevMissing = null;
    for (let i = 0; i < spine.length; i++) {
      const { p, s, lx, lz } = spine[i];
      if (!s) { prevTop = null; prevMissing = null; continue; }
      const half = reachAlong(s.box, lx, lz);
      const off = frac * half * 0.96;                      // stay just inside the lip
      const x = p[0] + lx * off, z = p[2] + lz * off;
      const here = support(stage, x, s.top + 1.0, z);

      if (!here) {
        // only a hole if the lane HAD floor before it -- otherwise it is the verge
        if (prevTop !== null && !kerbBetween(stage, p[0], p[2], x, z, s.top)) {
          prevMissing = { x, z, frac, from: s.box, at: p, i };
        }
        // and forget the height: a rise measured ACROSS a gap is not a step the
        // ball could ever have tried to climb, it is the gap counted twice
        prevTop = null;
      } else {
        /* Only a SHORT gap is a hole. A lane that leaves the road at a
         * narrowing and rejoins it further on is missing floor for many samples
         * in a row and is not something the ball can fall into -- it was never
         * over the road. The bug this file exists to catch, arc segments sized
         * from the centreline, leaves a gap under a metre at every junction. */
        if (prevMissing) {
          const gapLen = (i - prevMissing.i) * STEP;
          if (gapLen <= MAX_GAP) holes.push({ ...prevMissing, len: gapLen });
          prevMissing = null;
        }
        else if (prevTop !== null && here.top - prevTop > MAX_STEP) {
          steps.push({ x, z, dy: here.top - prevTop });
        }
        prevTop = here.top;
      }
    }
    // a lane that runs out at the very end is the finish, not a hole
  }
  return { holes, steps };
}

// ---------------------------------------------------------------- self test

if (process.argv.includes('--selftest')) {
  /* Rebuild an arc the OLD way -- chord length taken from the centreline radius
   * -- and confirm the checker sees through it. A checker that cannot fail on
   * known-bad input is not evidence of anything. */
  const R = 10, W = 12, sweep = Math.PI / 2;
  const mk = (fromOuter) => {
    const n = fromOuter ? Math.max(4, Math.round(sweep / 0.11)) : Math.max(3, Math.round(sweep / 0.18));
    const segLen = fromOuter ? (sweep / n) * (R + W / 2) * 1.18 : (sweep / n) * R * 1.10;
    const boxes = [];
    for (let i = 0; i < n; i++) {
      const tm = sweep * (i + 0.5) / n;
      boxes.push({
        p: [Math.cos(tm) * R, -0.5, Math.sin(tm) * R],
        s: [W, 1, segLen], kind: 'stone', rot: [0, -tm, 0],
      });
    }
    return S.prepareStage({
      id: 'arc', name: 'arc', warmth: 0, killY: -20, heat: [],
      spawn: [R, 1, 0], goal: [0, 1, R], goalR: 2, boxes,
    });
  };
  const wps = [];
  for (let k = 0; k <= 20; k++) {
    const t = sweep * k / 20;
    wps.push([Math.cos(t) * R, 0, Math.sin(t) * R]);
  }
  const bad = checkRoute(mk(false), wps);
  const good = checkRoute(mk(true), wps);
  console.log(`\nself test -- a 90 deg bend, radius ${R}, road ${W} wide`);
  console.log(`  centreline-sized segments (the old bug): ${bad.holes.length} hole(s) found`);
  console.log(`  outer-radius-sized segments (the fix)  : ${good.holes.length} hole(s) found`);
  const ok = bad.holes.length > 0 && good.holes.length === 0;
  console.log(ok
    ? '  the checker fails on known-bad input and passes on the fix -- it works\n'
    : '  THE CHECKER IS NOT MEASURING WHAT IT CLAIMS TO\n');
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------- report

let problems = 0;
for (const st of [...STAGES, TITLE_SCENE]) {
  const stage = S.prepareStage(st);
  for (const route of ['waypoints', 'altRoute']) {
    const wps = st[route];
    if (!wps) continue;
    const { holes, steps } = checkRoute(stage, wps);
    if (!holes.length && !steps.length) continue;
    problems++;
    console.log(`${st.numeral.padEnd(3)} ${st.id.padEnd(10)} ${route}`);
    const shown = new Set();
    for (const h of holes) {
      const key = `${Math.round(h.x / 4)},${Math.round(h.z / 4)}`;
      if (shown.has(key)) continue;
      shown.add(key);
      console.log(`      HOLE      (${h.x.toFixed(1)}, ${h.z.toFixed(1)})  at ${(h.frac * 100).toFixed(0)}% across the road, ${h.len.toFixed(1)}m wide`);
      if (process.argv.includes('--why')) {
        const b = h.from;
        console.log(`                from ${b.kind} centre (${b.c[0].toFixed(1)}, ${b.c[1].toFixed(1)}, ${b.c[2].toFixed(1)})`
          + ` half (${b.e[0].toFixed(1)}, ${b.e[2].toFixed(1)})${b.q ? ' rotated' : ''}`
          + `  route point (${h.at[0].toFixed(1)}, ${h.at[2].toFixed(1)})`);
      }
    }
    for (const s2 of steps.slice(0, 4)) {
      console.log(`      STEP UP   ${s2.dy.toFixed(2)}m at (${s2.x.toFixed(0)}, ${s2.z.toFixed(0)})`);
    }
  }
}
console.log(problems ? `\n${problems} route(s) with holes across the road\n`
                     : '\nevery lane of every route is supported\n');
process.exit(problems ? 1 : 0);
