/* FIRN -- stage data.
 *
 * THE CLIMB. The route runs UP: you carry the sleeper away from a world that is
 * thawing beneath you, toward cold high enough to lay it down. Every stage
 * begins at the altitude the last one reached, so the set reads as one mountain
 * climbed in pieces rather than seven unrelated tracks.
 *
 * The engine of that is a deliberate contradiction: warmth FALLS with altitude
 * inside a stage (you are always climbing out of the air you are standing in),
 * while each stage's base `warmth` is HIGHER than the last, because the thaw is
 * rising behind you faster than you are climbing. You gain height; the heat
 * follows. See ambientAt() in sim.js.
 *
 * Authoring conventions
 *   +Z is "forward" along the route, +Y is up, +X is right.
 *   Plates are named by their TOP surface height; the helper sinks the centre.
 *   ramp() takes the top height at each end, so topB > topA CLIMBS. Uphill
 *   ramps are the climb's own mechanic: you must carry speed into them or
 *   stall, and their slope eats into the tilt you have available.
 *   arc() lays a curved run of rotated plates. Prop placement runs in each
 *   box's own frame, so bends and ramps carry kerbs, piers and handline.
 *
 * Two props carry the core design, unchanged by the reframe:
 *   GATE  a lintel with an opening 0.80 high. 2r < 0.80 -> shell < 0.545.
 *   GRATE bars 0.62 apart. 2r < 0.62 -> shell < 0.273 falls THROUGH.
 * Melt enough to pass; not so much that the floor forgets you.
 *
 * Every route here is verified end to end by test/course-check.mjs, which
 * discovers the gates and grates itself and asserts the ball reached them
 * carrying the shell the design requires.
 */

import { quatFromEuler, rotV } from './sim.js';

export const FLOOR = 1.0;
export const RAIL_H = 1.1;
export const GATE_OPEN = 0.80;     // shell < 0.545 to pass
export const GRATE_GAP = 0.62;     // shell < 0.273 to fall through

/** Shell value at which a ball of diameter `open` just fits. */
export const shellForOpening = (open) => (open / 2 - 0.22) / (0.55 - 0.22);

// ---------------------------------------------------------------- helpers

const plate = (x0, x1, z0, z1, top, kind = 'stone') => ({
  p: [(x0 + x1) / 2, top - FLOOR / 2, (z0 + z1) / 2],
  s: [x1 - x0, FLOOR, z1 - z0], kind,
});

/* SINK buries the kerb in the deck: a kerb resting exactly on the surface
 * shares a plane with it and z-fights into a crawling moire. The height is
 * added back so the collidable top is unchanged -- a rendering fix that must
 * not become a physics change. Kerbs are 0.9 wide so they OVERLAP the deck
 * rather than merely abutting it; two colliders touching on exactly one plane
 * leave a hairline seam the ball can catch on at speed. */
const SINK = 0.08;
const railZ = (x, z0, z1, top, h = RAIL_H) => ({
  p: [x, top + h / 2 - SINK, (z0 + z1) / 2], s: [0.9, h + SINK * 2, z1 - z0], kind: 'rail',
});
const railX = (z, x0, x1, top, h = RAIL_H) => ({
  p: [(x0 + x1) / 2, top + h / 2 - SINK, z], s: [x1 - x0, h + SINK * 2, 0.9], kind: 'rail',
});

/** Ramp from `topA` at z0 to `topB` at z1, with kerbs that follow the slope. */
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
      out.push({
        p: [c[0] + o[0], c[1] + o[1], c[2] + o[2]],
        s: [0.9, RAIL_H + SINK * 2, len], kind: 'rail', rot: [a, 0, 0],
      });
    }
  }
  return out;
}

/**
 * A curved run, centred on (cx,cz), swept from angle a0 to a1. Straight lines
 * and right angles are most of what makes a route read as a prototype; this is
 * the cure. A box with rot Y = -t has its local +Z along the circle's tangent
 * at t, so each segment simply sits at its own angle.
 */
function arc(cx, cz, radius, a0, a1, width, top, opts = {}) {
  const sweep = a1 - a0;
  const n = Math.max(3, Math.round(Math.abs(sweep) / 0.18));
  const out = [];
  const segLen = Math.abs(sweep) / n * radius * 1.10;   // overlap, so no seams
  const sides = opts.rails === 'outer' ? [1] : opts.rails === 'inner' ? [-1] : [-1, 1];
  for (let i = 0; i < n; i++) {
    const tm = a0 + sweep * (i + 0.5) / n;
    const px = cx + Math.cos(tm) * radius, pz = cz + Math.sin(tm) * radius;
    out.push({ p: [px, top - FLOOR / 2, pz], s: [width, FLOOR, segLen], kind: 'stone', rot: [0, -tm, 0] });
    if (opts.rails !== false) {
      for (const sgn of sides) {
        const rr = radius + sgn * (width / 2 + 0.35);
        out.push({
          p: [cx + Math.cos(tm) * rr, top + RAIL_H / 2 - SINK, cz + Math.sin(tm) * rr],
          s: [0.9, RAIL_H + SINK * 2, segLen], kind: 'rail', rot: [0, -tm, 0],
        });
      }
    }
  }
  return out;
}

/**
 * A chicane: enters heading +Z at (x0,z0) and leaves heading +Z at
 * (x0 + dir*2R, z0 + 2R). `dir` is +1 to shift right, -1 to shift left.
 *
 * Hand-placing arcs against straights is where routes break: an arc's entry and
 * exit are trigonometry, and getting either wrong leaves a hole the width of a
 * ball. Composing bends out of ONE primitive whose endpoints are stated in its
 * signature means the straights either side can be written by arithmetic, and
 * test/where-fell.mjs has nothing left to find.
 *
 * Derivation, for the +1 case. Entering at (x0,z0) heading +Z, the centre of a
 * right-hand turn lies R to the right, at (x0+R, z0); the entry sits at angle PI
 * and sweeping to PI/2 exits at (x0+R, z0+R) heading +X. The second bend turns
 * back: its centre is R further along +Z, entry at -PI/2, sweeping to 0 to exit
 * at (x0+2R, z0+2R) heading +Z again.
 */
function chicane(x0, z0, R, width, top, dir = 1, opts = {}) {
  if (dir > 0) {
    return [
      ...arc(x0 + R, z0, R, Math.PI, Math.PI / 2, width, top, opts),
      ...arc(x0 + R, z0 + 2 * R, R, -Math.PI / 2, 0, width, top, opts),
    ];
  }
  return [
    ...arc(x0 - R, z0, R, 0, Math.PI / 2, width, top, opts),
    ...arc(x0 - R, z0 + 2 * R, R, -Math.PI / 2, -Math.PI, width, top, opts),
  ];
}

/** Two posts and a lintel leaving an opening `open` high. Passage is geometry. */
function gate(z, x0, x1, ox0, ox1, top, open = GATE_OPEN) {
  const H = 3.2;
  return [
    { p: [(x0 + ox0) / 2, top + H / 2, z], s: [ox0 - x0, H, 1.0], kind: 'gate' },
    { p: [(ox1 + x1) / 2, top + H / 2, z], s: [x1 - ox1, H, 1.0], kind: 'gate' },
    { // `open` travels with the lintel so a refusal can be EXPLAINED -- a hard
      // gate with no feedback is indistinguishable from a stuck ball.
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

// ============================================================ 0. TUTORIAL

/* The Threshold -- a walled yard at the foot of the climb, laid out as rooms,
 * one lesson each. Nothing here can kill you: the kerbs are high and unbroken
 * all the way round, because a tutorial that drops you off the edge teaches
 * only that the game is unfair. Prompts live in `teach` and fire on progress
 * along the route, so they arrive when the thing they describe is in front of
 * you rather than on a timer. */
const s0 = {
  id: 'threshold',
  name: 'The Threshold',
  numeral: '0',
  world: 'thaw',
  altitude: 0,
  tutorial: true,
  epigraph: 'Before the road, the yard. Learn the weight of it here.',
  warmth: 0.004, warmFall: 40,
  killY: -24,
  spawn: [0, 1.0, -14],
  goal: [10, 9.2, 154],
  goalR: 2.6,
  waypoints: [[0, 0, 8], [0, 0, 26], [10, 0, 40], [20, 0, 52], [20, 0, 70],
              [20, 4, 88], [20, 6, 108], [20, 6, 118], [20, 6, 128], [6, 8, 142], [10, 8, 154]],
  teach: [
    { z: -8,  text: 'Hold a direction. You do not steer the ice — you tilt the world under it.' },
    { z: 18,  text: 'Let go and the ground levels. To slow down, tilt back against the way you are going.' },
    { z: 34,  text: 'A bend. Set it up early: the ice keeps whatever speed you give it.' },
    { z: 76,  text: 'A rise. Carry speed into it, or you will stall halfway up.' },
    { z: 104, text: 'Warm ground. Watch the gauge — that shell is the only thing keeping it asleep.' },
    { z: 120, text: 'The gate is too low for a full shell. Melt on the warm stone until you fit through.' },
    { z: 146, text: 'Set it down on the ring. Then we start climbing.' },
  ],
  boxes: [
    // room 1: a straight, to find the tilt
    plate(-6, 6, -18, 30, 0),
    railZ(-6.35, -18, 30, 0, 2.0), railZ(6.35, -18, 30, 0, 2.0), railX(-18.35, -6, 6, 0, 2.0),

    // room 2: a chicane -- enters and leaves heading +Z, shifted 20 to the right
    ...chicane(0, 30, 10, 12, 0, 1),
    plate(14, 26, 50, 74, 0),
    railZ(26.35, 50, 132, 0, 2.0),

    // room 3: a rise
    ...ramp(14, 26, 74, 96, 0, 6),
    plate(14, 26, 96, 106, 6),
    railZ(13.65, 74, 106, 6, 2.0),

    // room 4: warm ground, where the gauge first moves
    plate(14, 26, 106, 122, 6, 'warm'),

    // room 5: the gate, with a way around it for anyone who wants one
    ...gate(122, 14, 26, 17, 23, 6),
    plate(17, 23, 122, 132, 6),
    plate(-4, 17, 106, 122, 6),
    plate(-4, 17, 122, 132, 6),
    railZ(-4.35, 106, 146, 6, 2.0), railX(105.65, -4, 14, 6, 2.0),

    ...ramp(-4, 23, 132, 146, 6, 8),
    plate(-4, 23, 146, 162, 8),
    railX(162.35, -4, 23, 8, 2.4), railZ(23.35, 132, 162, 8, 2.0),
  ].flat(),
  heat: [heat(20, 6, 114, 9, 0.17)],
};

// ============================================================ I. KILN ROAD

/* The Kiln Road -- the low country, and the first real climbing. Fumaroles vent
 * through the road itself; the shell drains simply for being here, and the only
 * answer is to keep moving and steer wide of the vents. No gate, no grate: this
 * stage is the rise and the heat, nothing else. */
const s1 = {
  id: 'kiln',
  name: 'The Kiln Road',
  numeral: 'I',
  world: 'geothermal',
  altitude: 340,
  epigraph: 'The lowest air is the worst of it. Climb.',
  warmth: 0.006, warmFall: 42,
  killY: -34,
  spawn: [0, 1.0, -14],
  goal: [0, 25.2, 208],
  goalR: 2.2,
  waypoints: [[0, 0, 8], [0, 4, 34], [0, 8, 58], [-9, 8, 71], [-18, 8, 90],
              [-18, 12, 114], [-18, 16, 142], [-9, 16, 155], [0, 16, 170],
              [0, 20, 192], [0, 25, 208]],
  boxes: [
    plate(-6, 6, -18, 14, 0),
    railZ(-6.35, -18, 14, 0), railZ(6.35, -18, 14, 0), railX(-18.35, -6, 6, 0),

    ...ramp(-6, 6, 14, 44, 0, 8),          // needs commitment
    plate(-6, 6, 44, 62, 8),
    railZ(6.35, 44, 62, 8),

    // a chicane to the left, around the biggest vent
    ...chicane(0, 62, 9, 12, 8, -1),
    plate(-24, -12, 80, 100, 8),

    ...ramp(-24, -12, 100, 128, 8, 16),
    plate(-24, -12, 128, 142, 16),

    // and back to the right for the final rise
    ...chicane(-18, 142, 9, 12, 16, 1),
    plate(-6, 6, 160, 176, 16),

    ...ramp(-6, 6, 176, 200, 16, 24),
    plate(-6, 6, 200, 218, 24),
    railZ(-6.35, 176, 218, 24), railZ(6.35, 176, 218, 24), railX(218.35, -6, 6, 24, 2.2),
  ].flat(),
  heat: [
    heat(0, 0, 30, 10, 0.055),
    heat(-9, 8, 66, 11, 0.06),
    heat(-18, 12, 114, 10, 0.05),
    heat(0, 20, 188, 9, 0.045),
  ],
};

// ============================================================ II. CATHEDRAL

/* The Cathedral -- the gate, under a roof. Enclosed, so the horizon gives you
 * nothing and the route has to be read close up. Meltwater off the vault pools
 * warm on the road, and that pool is what pays for the gate. Gentler than the
 * later gates: there is no floor here that stops holding you. */
const s2 = {
  id: 'cathedral',
  name: 'The Cathedral',
  numeral: 'II',
  world: 'cathedral',
  altitude: 720,
  epigraph: 'The roof weeps, and the road drinks it.',
  warmth: 0.0075, warmFall: 46,
  killY: -34,
  spawn: [0, 1.0, -10],
  goal: [0, 13.2, 130],
  goalR: 2.2,
  waypoints: [[0, 0, 12], [0, 0, 34], [0, 0, 41], [0, 2, 62], [0, 8, 96], [0, 12, 118], [0, 13, 130]],
  meltAt: { x: 0, z: 37, until: 0.60 },
  altRoute: [[0, 0, 12], [0, 0, 30], [-12, 0, 40], [-24, 0, 52], [-24, 2, 74],
             [-14, 8, 88], [-6, 10, 98], [0, 12, 118], [0, 13, 130]],
  boxes: [
    plate(-5, 5, -14, 16, 0),
    railZ(-5.35, -14, 16, 0), railZ(5.35, -14, 16, 0), railX(-14.35, -5, 5, 0),

    // the nave. The drip falls in the middle of it.
    plate(-4, 4, 16, 44, 0),
    railZ(4.35, 16, 44, 0), railZ(-4.35, 16, 36, 0),

    // ---- straight on, through the gate
    ...gate(44, -4, 4, -3, 3, 0),
    plate(-3, 3, 44, 56, 0),
    railZ(-3.35, 44, 56, 0), railZ(3.35, 44, 56, 0),
    ...ramp(-3, 3, 56, 88, 0, 8),

    // ---- the ambulatory: longer, no toll
    plate(-28, -4, 36, 44, 0),
    railX(35.65, -28, -4, 0), railX(44.35, -20, -4, 0),
    plate(-28, -20, 44, 60, 0),
    ...ramp(-28, -20, 60, 84, 0, 8),
    railZ(-28.35, 36, 60, 0), railZ(-19.65, 44, 60, 0),
    plate(-28, -3, 84, 92, 8),
    railX(83.65, -20, -3, 8), railX(92.35, -28, -8, 8),

    // ---- both meet, then the last rise to the crossing
    plate(-8, 8, 88, 104, 8),
    ...ramp(-8, 8, 104, 126, 8, 13),
    plate(-8, 8, 126, 140, 13),
    railZ(-8.35, 88, 140, 13), railZ(8.35, 88, 140, 13),
    railX(140.35, -8, 8, 13, 2.2),
  ].flat(),
  heat: [heat(0, 0.5, 37, 8.5, 0.155), heat(-24, 0.5, 62, 7, 0.02)],
};

// ============================================================ III. THAW GATE

/* The Thaw Gate -- the argument for spending shell, in the open.
 * A fork. Left is a switchback that costs about twenty seconds and asks
 * nothing. Right is a basin of warm stone: drive through the hot centre until
 * you are thin enough for the gate, then a long straight climb home. */
const s3 = {
  id: 'thaw',
  name: 'The Thaw Gate',
  numeral: 'III',
  world: 'frozensea',
  altitude: 1150,
  epigraph: 'The short way is only short if you are small enough to take it.',
  warmth: 0.009, warmFall: 44,
  killY: -30,
  spawn: [0, 1.0, -12],
  goal: [0, 15.2, 154],
  goalR: 2.2,
  waypoints: [[0, 0, 12], [16, 0, 28], [18, 0, 38], [17, 0, 47], [17, 2, 68],
              [17, 8, 106], [17, 14, 134], [8, 14, 152], [0, 15, 154]],
  meltAt: { x: 18, z: 34, until: 0.62 },
  altRoute: [[0, 0, 12], [-30, 0, 22], [-36, 0, 36], [-36, 0, 50], [-36, 0, 56], [-24, 0, 56],
             [-18, 2, 68], [-18, 8, 100], [-18, 8, 114], [-30, 8, 122], [-36, 10, 130],
             [-36, 14, 146], [-20, 15, 155], [0, 15, 154]],
  boxes: [
    plate(-6, 6, -16, 18, 0),
    railZ(-6.35, -16, 18, 0), railZ(6.35, -16, 18, 0), railX(-16.35, -6, 6, 0),

    plate(-40, 30, 18, 26, 0),
    railX(17.65, -40, -6, 0), railX(17.65, 6, 30, 0),

    // ---- LEFT: arms, safe and slow, climbing as they go
    plate(-40, -32, 26, 52, 0),
    railZ(-31.65, 26, 52, 0),
    plate(-40, -14, 52, 60, 0),
    railX(51.65, -32, -14, 0), railX(60.35, -40, -22, 0),
    ...ramp(-22, -14, 60, 104, 0, 8),
    plate(-22, -14, 104, 118, 8),
    railZ(-22.35, 104, 118, 8), railZ(-13.65, 104, 118, 8),
    plate(-40, -14, 118, 126, 8),
    railX(117.65, -40, -22, 8), railX(126.35, -32, -14, 8),
    ...ramp(-40, -32, 126, 148, 8, 14),
    railZ(-40.35, 26, 148, 14),

    // ---- RIGHT: the basin. Warm stone, rails all round bar the two openings.
    plate(6, 30, 26, 50, 0, 'warm'),
    railZ(30.35, 26, 50, 0), railZ(5.65, 30, 50, 0),
    ...gate(50, 6, 30, 12, 22, 0),

    // ---- the chute beyond the gate: long, straight, and uphill
    plate(12, 22, 50, 64, 0),
    railZ(11.65, 50, 64, 0), railZ(22.35, 50, 64, 0),
    ...ramp(12, 22, 64, 130, 0, 14),
    plate(12, 22, 130, 148, 14),
    railZ(11.65, 130, 148, 14), railZ(22.35, 130, 148, 14),

    // ---- both routes land here
    plate(-40, 26, 148, 164, 14),
    railX(164.35, -40, 26, 14, 2.2), railZ(-40.35, 148, 164, 14), railZ(26.35, 148, 164, 14),
  ].flat(),
  heat: [heat(18, 0.5, 34, 8.5, 0.20)],
};

// ============================================================ IV. THE WEIGHING

/* The Weighing -- the grate, on its own.
 * The first stage where being TOO THIN is what kills you. A hot narrows drains
 * shell whether you like it or not, and then the road becomes bars for forty
 * metres: arrive above 27% or the floor forgets you. A cold side channel costs
 * time and saves shell, so the decision is real rather than a reflex test. */
const s4 = {
  id: 'weighing',
  name: 'The Weighing',
  numeral: 'IV',
  world: 'frozensea',
  altitude: 1560,
  epigraph: 'Thin enough to pass. Not so thin that the floor forgets you.',
  warmth: 0.0098, warmFall: 34,
  killY: -32,
  spawn: [0, 1.0, -14],
  goal: [0, 19.2, 190],
  goalR: 2.2,
  // straight through the narrows: fast, and it costs shell
  waypoints: [[0, 0, 10], [0, 4, 36], [0, 8, 58], [0, 8, 78], [0, 8, 102],
              [0, 8, 130], [0, 12, 166], [0, 19, 190]],
  // the cold channel: longer, keeps the shell
  altRoute: [[0, 0, 10], [0, 4, 36], [0, 8, 52], [-14, 8, 54], [-24, 8, 56], [-24, 8, 74], [-24, 8, 94],
             [-10, 8, 101], [-2, 8, 106], [0, 8, 130], [0, 12, 166], [0, 19, 190]],
  boxes: [
    plate(-6, 6, -18, 14, 0),
    railZ(-6.35, -18, 14, 0), railZ(6.35, -18, 14, 0), railX(-18.35, -6, 6, 0),

    ...ramp(-6, 6, 14, 44, 0, 8),
    plate(-6, 6, 44, 58, 8),
    railZ(-6.35, 44, 50, 8),          // the channel opens only from z = 50 on

    // ---- the narrows: hot, tight, and the fast way
    plate(-4, 4, 58, 96, 8, 'warm'),
    railZ(4.35, 58, 96, 8),

    // ---- the cold channel: out and around, no heat
    plate(-28, -4, 50, 58, 8),
    railX(49.65, -28, -4, 8), railX(58.35, -20, -4, 8),
    plate(-28, -20, 58, 96, 8),
    railZ(-28.35, 50, 104, 8), railZ(-19.65, 58, 96, 8),
    plate(-28, -4, 96, 104, 8),
    railX(104.35, -28, -12, 8),

    // ---- both meet, and then the road becomes bars
    plate(-12, 8, 96, 110, 8),
    railX(110.35, -12, -8, 8),
    railZ(-8.35, 110, 156, 8), railZ(8.35, 96, 156, 8),
    grate(-8, 8, 110, 150, 8),
    plate(-8, 8, 150, 160, 8),

    ...ramp(-8, 8, 160, 188, 8, 18),
    plate(-8, 8, 188, 202, 18),
    railZ(-8.35, 188, 202, 18), railZ(8.35, 188, 202, 18),
    railX(202.35, -8, 8, 18, 2.2),
  ].flat(),
  heat: [heat(0, 8, 76, 13, 0.085)],
};

// ============================================================ V. THE ICEFALL

/* The Icefall -- momentum, and the first time you leave the ground.
 * A long climbing curve, then a gap that only opens if you come into it fast,
 * then a steeper rise to finish. No gate and no grate: this stage is about
 * keeping what you have got. */
const s5 = {
  id: 'icefall',
  name: 'The Icefall',
  numeral: 'V',
  world: 'icefall',
  altitude: 2080,
  epigraph: 'Nothing here has settled. Neither should you.',
  warmth: 0.0106, warmFall: 30,
  killY: -44,
  spawn: [0, 1.0, -12],
  goal: [4, 21.2, 262],
  goalR: 2.2,
  waypoints: [[0, 0, 10], [0, 4, 34], [0, 5, 47], [11, 5, 59], [22, 5, 82], [22, 5, 102],
              [22, 2, 126], [22, 8, 164], [22, 16, 190], [13, 16, 205],
              [4, 16, 224], [4, 19, 248], [4, 21, 262]],
  boxes: [
    plate(-5, 5, -16, 14, 0),
    railZ(-5.35, -16, 14, 0), railZ(5.35, -16, 14, 0), railX(-16.35, -5, 5, 0),

    ...ramp(-5, 5, 14, 40, 0, 5),
    plate(-5, 5, 40, 48, 5),
    railZ(5.35, 40, 48, 5), railZ(-5.35, 40, 48, 5),

    // a long right-hand chicane, climbing out of the start
    ...chicane(0, 48, 11, 11, 5, 1),
    plate(16, 28, 70, 92, 5),
    railZ(15.65, 70, 92, 5), railZ(28.35, 70, 128, 5),

    // the gap: leave at speed or do not leave at all. The far side sits three
    // metres LOWER -- the drop is what buys the distance, and a crevasse you
    // land above is a wall, not a jump.
    plate(16, 28, 92, 106, 5),
    railZ(15.65, 92, 106, 5),
    plate(16, 28, 111, 148, 2),
    railZ(15.65, 111, 148, 2), railZ(28.35, 111, 148, 2),

    ...ramp(16, 28, 148, 180, 2, 16),
    plate(16, 28, 180, 196, 16),
    railZ(15.65, 180, 196, 16), railZ(28.35, 180, 196, 16),

    // a last chicane back to the left, then the summit ramp
    ...chicane(22, 196, 9, 12, 16, -1),
    plate(-2, 10, 214, 234, 16),
    ...ramp(-2, 10, 234, 254, 16, 21),
    plate(-2, 10, 254, 268, 21),
    railZ(-2.35, 214, 268, 21), railZ(10.35, 214, 268, 21),
    railX(268.35, -2, 10, 21, 2.2),
  ].flat(),
  heat: [heat(20, 5, 60, 9, 0.03)],
};

// ============================================================ VI. COLD STAIR

/* The Cold Stair -- the summit, and everything at once.
 * The thaw has followed you all the way up: the warmest base air in the game,
 * standing on the coldest ground, with meltwater on the névé that has no
 * business being there. A gate AND a grate, in that order, with barely enough
 * road between them to recover. */
const s6 = {
  id: 'stair',
  name: 'The Cold Stair',
  numeral: 'VI',
  world: 'neve',
  altitude: 2610,
  epigraph: 'It has followed you even here. Set it down, and be done.',
  warmth: 0.0115, warmFall: 26,
  killY: -40,
  spawn: [0, 1.0, -14],
  goal: [-14, 26.2, 262],
  goalR: 2.4,
  waypoints: [[0, 0, 10], [0, 5, 40], [0, 8, 56], [0, 8, 68], [0, 8, 100],
              [0, 12, 132], [0, 13, 158], [0, 13, 190], [-8, 16, 208],
              [-20, 20, 232], [-20, 24, 252], [-14, 26, 262]],
  meltAt: { x: 0, z: 52, until: 0.62 },
  altRoute: [[0, 0, 10], [0, 5, 40], [0, 8, 52], [-20, 8, 55], [-30, 8, 74], [-30, 8, 98],
             [-16, 8, 104], [-2, 8, 106], [0, 8, 116], [0, 12, 132], [0, 13, 158], [0, 13, 190],
             [-8, 16, 208], [-20, 20, 232], [-20, 24, 252], [-14, 26, 262]],
  boxes: [
    plate(-6, 6, -18, 14, 0),
    railZ(-6.35, -18, 14, 0), railZ(6.35, -18, 14, 0), railX(-18.35, -6, 6, 0),

    ...ramp(-6, 6, 14, 44, 0, 8),
    plate(-6, 6, 44, 58, 8, 'warm'),      // the last warm ground on the mountain
    railZ(6.35, 44, 58, 8),
    railZ(-6.35, 44, 50, 8),          // the outer way opens only from z = 50 on

    // ---- the gate, dead ahead
    ...gate(58, -6, 6, -3, 3, 8),
    plate(-3, 3, 58, 108, 8),
    railZ(-3.35, 58, 100, 8), railZ(3.35, 58, 100, 8),

    // ---- around the outside, no toll
    plate(-34, -6, 50, 58, 8),
    railX(49.65, -34, -6, 8), railX(58.35, -26, -6, 8),
    plate(-34, -26, 58, 100, 8),
    railZ(-34.35, 50, 116, 8), railZ(-25.65, 58, 100, 8),
    plate(-34, 6, 100, 108, 8),
    railX(99.65, -26, -6, 8), railX(108.35, -34, -8, 8),

    // ---- both meet, climb, and then the bars
    plate(-8, 8, 108, 122, 8),
    ...ramp(-8, 8, 122, 144, 8, 13),
    plate(-8, 8, 144, 154, 13),
    railZ(-8.35, 108, 122, 8), railZ(8.35, 78, 122, 8),
    railZ(-8.35, 144, 196, 13), railZ(8.35, 144, 196, 13),
    grate(-8, 8, 154, 192, 13),
    plate(-14, 8, 192, 202, 13),
    railZ(-14.35, 192, 202, 13),

    // ---- the last stair to the summit
    ...arc(-20, 202, 14, 0, Math.PI / 2, 12, 13),
    plate(-26, -14, 202, 224, 13),
    ...ramp(-26, -14, 224, 250, 13, 24),
    plate(-26, -14, 250, 272, 24),
    railZ(-26.35, 202, 272, 24), railZ(-13.65, 216, 272, 24),
    railX(272.35, -26, -14, 24, 2.6),
  ].flat(),
  heat: [heat(0, 8, 52, 9, 0.19), heat(-30, 8, 88, 10, 0.03), heat(0, 13, 172, 11, 0.05)],
};

export const STAGES = [s0, s1, s2, s3, s4, s5, s6];
export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
