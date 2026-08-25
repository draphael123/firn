/* FIRN -- stage data.
 *
 * Authoring conventions
 *   +Z is "forward" along the route, +Y is up, +X is right.
 *   Plates are named by their TOP surface height; the helper sinks the centre.
 *   A ramp descending toward +Z takes a POSITIVE rot X. (Rx(a) lifts the +Z
 *   end for negative a, which is the opposite of what you expect -- easy hour
 *   to lose, so it is written down here.)
 *
 * Two props carry the whole design:
 *   GATE  a lintel with an opening 0.80 high. 2r < 0.80 -> shell < 0.545,
 *         so it admits only a ball that has deliberately melted down.
 *   GRATE bars 0.62 apart. 2r < 0.62 -> shell < 0.273 falls THROUGH.
 * Together they bracket the player: melt enough to fit, not so much that the
 * floor stops holding you.
 *
 * Every route here is verified end to end by test/course-check.mjs, which
 * asserts the ball actually reached the gate and the grate rather than merely
 * reaching the goal.
 */

import { quatFromEuler, rotV } from './sim.js';

export const FLOOR = 1.0;          // plate thickness
export const RAIL_H = 1.1;
export const GATE_OPEN = 0.80;     // shell < 0.545 to pass
export const GRATE_GAP = 0.62;     // shell < 0.273 to fall through

/** Shell value at which a ball of diameter `open` just fits. */
export const shellForOpening = (open) => (open / 2 - 0.22) / (0.55 - 0.22);

// ---------------------------------------------------------------- helpers

/** Floor slab spanning x[x0,x1] z[z0,z1] with its top surface at `top`. */
const plate = (x0, x1, z0, z1, top, kind = 'stone') => ({
  p: [(x0 + x1) / 2, top - FLOOR / 2, (z0 + z1) / 2],
  s: [x1 - x0, FLOOR, z1 - z0], kind,
});

/* Low kerb. Keeps you on; never tall enough to hide the drop behind it.
 * SINK is how far the kerb is buried in the deck. A kerb resting exactly on
 * the surface shares a plane with it and z-fights into a crawling moire along
 * every edge. The extra height is added back so the collidable top is
 * unchanged -- this is a rendering fix that must not become a physics change.
 *
 * Kerbs are 0.9 wide rather than 0.7 so they OVERLAP the deck they guard by
 * ~0.1 instead of merely abutting it. Two colliders that touch on exactly one
 * plane leave a hairline seam the ball can catch on at speed. */
const SINK = 0.08;
const railZ = (x, z0, z1, top, h = RAIL_H) => ({
  p: [x, top + h / 2 - SINK, (z0 + z1) / 2], s: [0.9, h + SINK * 2, z1 - z0], kind: 'rail',
});
const railX = (z, x0, x1, top, h = RAIL_H) => ({
  p: [(x0 + x1) / 2, top + h / 2 - SINK, z], s: [x1 - x0, h + SINK * 2, 0.9], kind: 'rail',
});

/**
 * Ramp from `topA` at z0 down to `topB` at z1, with kerbs that follow the
 * slope. Rails on ramps are not decoration -- without them any steering input
 * mid-slope walks the ball straight off the side.
 */
function ramp(x0, x1, z0, z1, topA, topB, opts = {}) {
  const dz = z1 - z0, dy = topA - topB;
  const len = Math.hypot(dz, dy), a = Math.atan2(dy, dz);
  const w = x1 - x0;
  const c = [(x0 + x1) / 2, (topA + topB) / 2 - FLOOR / 2, (z0 + z1) / 2];
  const out = [{ p: c, s: [w, FLOOR, len], kind: opts.kind || 'stone', rot: [a, 0, 0] }];
  if (opts.rails !== false) {
    const q = quatFromEuler(a, 0, 0), o = [0, 0, 0];
    for (const sx of [-1, 1]) {
      rotV(q, sx * (w / 2 + 0.35), FLOOR / 2 + RAIL_H / 2 - SINK, 0, o);
      out.push({ p: [c[0] + o[0], c[1] + o[1], c[2] + o[2]], s: [0.7, RAIL_H + SINK * 2, len], kind: 'rail', rot: [a, 0, 0] });
    }
  }
  return out;
}

/**
 * A gate: two posts and a lintel leaving an opening `open` high, centred on
 * x[ox0,ox1]. Passage is pure geometry -- nothing about it is scripted.
 */
function gate(z, x0, x1, ox0, ox1, top, open = GATE_OPEN) {
  const H = 3.2;
  return [
    { p: [(x0 + ox0) / 2, top + H / 2, z], s: [ox0 - x0, H, 1.0], kind: 'gate' },
    { p: [(ox1 + x1) / 2, top + H / 2, z], s: [x1 - ox1, H, 1.0], kind: 'gate' },
    { // lintel: its bottom edge sits exactly `open` above the floor.
      // `open` is carried through to the sim so a refusal can be EXPLAINED --
      // a hard gate with no feedback is indistinguishable from a stuck ball.
      p: [(ox0 + ox1) / 2, top + open + (H - open) / 2, z],
      s: [ox1 - ox0, H - open, 1.0], kind: 'gate', open,
    },
  ];
}

/** Bars, not a slab. Solid to a fat ball, empty air to a thin one. */
const grate = (x0, x1, z0, z1, top, gap = GRATE_GAP) => ({
  p: [(x0 + x1) / 2, top - FLOOR / 2, (z0 + z1) / 2],
  s: [x1 - x0, FLOOR, z1 - z0], kind: 'grate', gap,
});

const heat = (x, y, z, r, q) => ({ p: [x, y, z], r, q });

// ================================================================ STAGE 1

/* The Cold Stair -- nothing but tilt. One long straight to find the absolute
 * stick mapping, one ramp to find momentum, one right-angle turn whose outside
 * edge has no kerb. Barely melts: the shell should still read ~0.9 at the goal
 * so the player meets the mechanic before it ever threatens them. */
const s1 = {
  id: 'stair',
  name: 'The Cold Stair',
  numeral: 'I',
  world: 'neve',
  epigraph: 'It is colder here than anywhere you are going.',
  warmth: 0.0018,
  killY: -34,
  spawn: [0, 1.0, -16],
  goal: [56, -4.9, 60],
  goalR: 1.8,
  waypoints: [[0, 0, 12], [0, -3, 34], [0, -6, 52], [2, -6, 60], [24, -6, 60], [56, -6, 60]],
  boxes: [
    plate(-4, 4, -20, 22, 0),
    railZ(-4.35, -20, 22, 0), railZ(4.35, -20, 22, 0), railX(-20.35, -4, 4, 0),

    ...ramp(-4, 4, 22, 48, 0, -6),

    plate(-4, 4, 48, 64, -6),
    railZ(-4.35, 48, 64, -6),
    railZ(4.35, 48, 56, -6),              // right kerb stops AT the turn

    plate(4, 64, 56, 64, -6),
    railX(64.35, -4, 64, -6, 2.2),        // back wall you turn against
    // The z = 56 edge is deliberately open for x in [4,44]: carry too much
    // speed through the corner and you leave the stage entirely.
    railX(55.65, 44, 64, -6),             // kerb returns only past the danger
    railZ(64.35, 56, 64, -6),
  ].flat(),
  heat: [],
};

// ================================================================ STAGE 2

/* The Thaw Gate -- the argument for spending shell.
 * A fork. Left is a five-arm switchback, about twice the distance, and asks
 * nothing of you. Right is a basin of warm stone: drive through the hot centre
 * until you are thin enough for the gate, then a straight chute home. Hugging
 * the centre melts fast; skirting the edge does not melt enough to fit. */
const s2 = {
  id: 'thaw',
  name: 'The Thaw Gate',
  numeral: 'III',
  world: 'frozensea',
  epigraph: 'The short way is only short if you are small enough to take it.',
  warmth: 0.004,
  killY: -30,
  spawn: [0, 1.0, -12],
  goal: [0, 1.2, 146],
  goalR: 2.2,
  // fast: through the basin and the gate
  waypoints: [[0, 0, 12], [16, 0, 28], [18, 0, 38], [17, 0, 47], [17, 0, 64],
              [17, 0, 100], [17, 0, 132], [8, 0, 146], [0, 0, 146]],
  // Stop a little above the gate threshold: the ball keeps melting on the way
  // out of the basin, so aiming exactly at 0.545 overshoots well past it.
  meltAt: { x: 18, z: 34, until: 0.62 },
  // slow: the switchback, no melting required
  altRoute: [[0, 0, 12], [-30, 0, 22], [-36, 0, 36], [-36, 0, 50], [-36, 0, 56], [-24, 0, 56],
             [-18, 0, 66], [-18, 0, 90], [-18, 0, 106], [-24, 0, 114], [-36, 0, 114],
             [-36, 0, 126], [-36, 0, 140], [-20, 0, 147], [0, 0, 146]],
  boxes: [
    plate(-6, 6, -16, 18, 0),
    railZ(-6.35, -16, 18, 0), railZ(6.35, -16, 18, 0), railX(-16.35, -6, 6, 0),

    // ---- the fork
    plate(-40, 30, 18, 26, 0),
    railX(17.65, -40, -6, 0), railX(17.65, 6, 30, 0),

    // ---- LEFT: five arms, safe and slow.
    // Every arm is walled on BOTH sides. Without the inner kerbs a pilot
    // cutting the corner leaves through the open side of the bend, which is
    // exactly how this route failed the first time it was checked.
    plate(-40, -32, 26, 52, 0),
    railZ(-31.65, 26, 52, 0),                              // arm 1 inner
    plate(-40, -14, 52, 60, 0),
    railX(51.65, -32, -14, 0), railX(60.35, -40, -22, 0),  // arm 2 front / back
    plate(-22, -14, 60, 110, 0),
    railZ(-22.35, 60, 110, 0), railZ(-13.65, 60, 110, 0),  // arm 3 both sides
    plate(-40, -14, 110, 118, 0),
    railX(109.65, -40, -22, 0), railX(118.35, -32, -14, 0), // arm 4 front / back
    plate(-40, -32, 118, 140, 0),
    railZ(-31.65, 118, 140, 0),                            // arm 5 inner
    railZ(-40.35, 26, 140, 0),                             // outer wall, whole run

    // ---- RIGHT: the basin. Warm stone, rails all round bar the two openings.
    plate(6, 30, 26, 50, 0, 'warm'),
    railZ(30.35, 26, 50, 0), railZ(5.65, 30, 50, 0),

    // the gate itself, set in the basin's far wall
    ...gate(50, 6, 30, 12, 22, 0),

    // ---- the chute beyond the gate: long, but dead straight
    plate(12, 22, 50, 140, 0),
    railZ(11.65, 50, 140, 0), railZ(22.35, 50, 140, 0),

    // ---- both routes land here
    plate(-40, 26, 140, 154, 0),
    railX(154.35, -40, 26, 0, 2.2), railZ(-40.35, 140, 154, 0), railZ(26.35, 140, 154, 0),
  ].flat(),
  // A fierce, tight hot spot rather than a broad warm bath: you dive into it
  // and leave, instead of loitering in a bath long enough to lose the race.
  heat: [heat(18, 0.5, 34, 8.5, 0.20)],
};

// ================================================================ STAGE 3

/* The Grate Run -- the punishment for overspending.
 * Hot the whole way, so the shell drains whether you like it or not. A gate
 * two thirds in offers a big shortcut but demands shell < 0.545; the grate
 * span at the end drops anything under 0.273. The stage IS the gap between
 * those two numbers, and the sun shafts are steadily closing it. */
const s3 = {
  id: 'grate',
  name: 'The Grate Run',
  numeral: 'V',
  world: 'geothermal',
  epigraph: 'Thin enough to pass. Not so thin that the floor forgets you.',
  warmth: 0.009,
  killY: -36,
  spawn: [0, 1.0, -12],
  goal: [0, -3.8, 124],
  goalR: 2.0,
  // fast: straight through the low gate
  waypoints: [[0, 0, 12], [0, -3, 32], [0, -5, 52], [0, -5, 62], [0, -5, 84], [0, -5, 96], [0, -5, 110], [0, -5, 124]],
  // slow: around the outside, no toll
  altRoute: [[0, 0, 12], [0, -3, 32], [0, -5, 50], [-20, -5, 54], [-30, -5, 66], [-30, -5, 82], [-14, -5, 90], [0, -5, 96], [0, -5, 110], [0, -5, 124]],
  boxes: [
    plate(-6, 6, -16, 16, 0),
    railZ(-6.35, -16, 16, 0), railZ(6.35, -16, 16, 0), railX(-16.35, -6, 6, 0),

    ...ramp(-6, 6, 16, 44, 0, -5),

    plate(-6, 6, 44, 58, -5),
    railZ(6.35, 44, 58, -5),
    railZ(-6.35, 44, 50, -5),        // the left arm opens only from z = 50 on

    // ---- LEFT: the long way. No gate, no toll, no hurry.
    plate(-34, -6, 50, 58, -5),
    railX(49.65, -34, -6, -5), railX(58.35, -26, -6, -5),
    plate(-34, -26, 58, 86, -5),
    railZ(-25.65, 58, 86, -5),
    plate(-34, 6, 86, 94, -5),
    // gap at x[-3,3]: that is where the gate chute lets out
    railX(85.65, -26, -3, -5), railX(85.65, 3, 6, -5),
    railX(94.35, -34, -8, -5),
    railZ(-34.35, 50, 94, -5),       // outer wall, whole run

    // ---- RIGHT: the gate. Demands shell < 0.545 and saves ~20 seconds.
    ...gate(58, -6, 6, -3, 3, -5),
    plate(-3, 3, 58, 86, -5),
    railZ(-3.35, 58, 86, -5), railZ(3.35, 58, 86, -5),

    // ---- both routes meet, then narrow onto the span
    plate(-8, 8, 94, 102, -5),
    railZ(-8.35, 94, 120, -5), railZ(8.35, 86, 120, -5),

    // ---- the grate span. Solid underfoot, until you are not.
    grate(-8, 8, 102, 118, -5),

    plate(-8, 8, 118, 130, -5),
    railX(130.35, -8, 8, -5, 2.2),
  ].flat(),
  heat: [
    heat(0, 0, 34, 11, 0.030),
    heat(0, 0, 54, 10, 0.044),   // the toll booth: what pays for the gate
    heat(-28, 0, 72, 14, 0.028),
    heat(0, 0, 98, 12, 0.034),
  ],
};


// ================================================================ STAGE II

/* The Icefall -- momentum on a descent, and the first time you leave the
 * ground. Two ramps and a gap you must carry speed into. No gate and no grate:
 * this stage is only about learning that speed is now something you keep. */
const s2b = {
  id: 'icefall',
  name: 'The Icefall',
  numeral: 'II',
  world: 'icefall',
  epigraph: 'Nothing here has settled. Neither should you.',
  warmth: 0.003,
  killY: -54,
  spawn: [0, 1.0, -12],
  goal: [0, -17.8, 118],
  goalR: 2.0,
  waypoints: [[0, 0, 10], [0, -4, 30], [0, -7, 50], [0, -11, 72], [0, -15, 96], [0, -19, 118]],
  boxes: [
    plate(-5, 5, -16, 14, 0),
    railZ(-5.35, -16, 14, 0), railZ(5.35, -16, 14, 0), railX(-16.35, -5, 5, 0),

    ...ramp(-5, 5, 14, 40, 0, -7),

    plate(-5, 5, 40, 56, -7),
    railZ(-5.35, 40, 56, -7), railZ(5.35, 40, 56, -7),

    // the gap: leave at speed or do not leave at all
    plate(-6, 6, 62, 84, -11),
    railZ(-6.35, 62, 84, -11), railZ(6.35, 62, 84, -11),

    ...ramp(-6, 6, 84, 108, -11, -19),

    plate(-6, 6, 108, 124, -19),
    railZ(-6.35, 108, 124, -19), railZ(6.35, 108, 124, -19),
    railX(124.35, -6, 6, -19, 2.2),
  ].flat(),
  heat: [],
};

// ================================================================ STAGE IV

/* The Cathedral -- the gate again, under a roof.
 * Enclosed, so the horizon gives you nothing and the route must be read close
 * up. Meltwater drips from the vault and pools warm on the road, which is what
 * pays for the gate. Gentler than the Grate Run: there is no floor here that
 * stops holding you, so overspending costs time rather than everything. */
const s4 = {
  id: 'cathedral',
  name: 'The Cathedral',
  numeral: 'IV',
  world: 'cathedral',
  epigraph: 'The roof weeps, and the road drinks it.',
  warmth: 0.0065,
  killY: -40,
  spawn: [0, 1.0, -10],
  goal: [0, 1.2, 106],
  goalR: 2.2,
  // fast: melt under the drip, then the low gate
  waypoints: [[0, 0, 12], [0, 0, 34], [0, 0, 41], [0, 0, 60], [0, 0, 84], [0, 0, 106]],
  meltAt: { x: 0, z: 37, until: 0.60 },
  // slow: the ambulatory, around the outside
  altRoute: [[0, 0, 12], [0, 0, 30], [-12, 0, 40], [-24, 0, 52], [-24, 0, 74],
             [-14, 0, 84], [-6, 0, 90], [0, 0, 98], [0, 0, 106]],
  boxes: [
    plate(-5, 5, -14, 16, 0),
    railZ(-5.35, -14, 16, 0), railZ(5.35, -14, 16, 0), railX(-14.35, -5, 5, 0),

    // the nave: narrow, and the drip falls in the middle of it
    plate(-4, 4, 16, 44, 0),
    railZ(4.35, 16, 44, 0),
    railZ(-4.35, 16, 36, 0),          // opens to the ambulatory at z = 36

    // ---- the gate, straight ahead. The chute runs all the way to the
    // crossing: stopping it short and letting the ambulatory's return plate
    // overlap it put a kerb across its own exit.
    ...gate(44, -4, 4, -3, 3, 0),
    plate(-3, 3, 44, 88, 0),
    railZ(-3.35, 44, 88, 0), railZ(3.35, 44, 88, 0),

    // ---- the ambulatory: longer, no toll
    plate(-28, -4, 36, 44, 0),
    railX(35.65, -28, -4, 0), railX(44.35, -20, -4, 0),
    plate(-28, -20, 44, 80, 0),
    railZ(-28.35, 36, 88, 0), railZ(-19.65, 44, 80, 0),
    plate(-28, -3, 80, 88, 0),
    railX(79.65, -20, -3, 0), railX(88.35, -28, -8, 0),

    // ---- both meet under the crossing
    plate(-8, 8, 88, 96, 0),
    railZ(-8.35, 88, 114, 0), railZ(8.35, 84, 114, 0),
    plate(-8, 8, 96, 114, 0),
    railX(114.35, -8, 8, 0, 2.2),
  ].flat(),
  // meltwater off the vault, pooling warm on the road before the gate
  heat: [heat(0, 0.5, 37, 8.5, 0.155), heat(-24, 0.5, 62, 7, 0.02)],
};

export const STAGES = [s1, s2b, s2, s4, s3];
export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
