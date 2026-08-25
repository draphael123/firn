/* A waypoint-following pilot.
 *
 * Two jobs: it verifies in test/course-check.mjs that every route is actually
 * flyable, and it drives the slow drifting demo behind the title screen.
 *
 * It also models the one strategy the player has to discover -- loitering in a
 * warm basin until the shell is thin enough for the gate ahead. Without that,
 * a pilot parks against a gate it cannot fit through and waits for ambient
 * melt, which reads as "the route is broken" when it is only "the pilot is
 * dim". Verification has to play the stage the way it is meant to be played.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * @param waypoints  [[x,y,z], ...] along the route
 * @param opts.cruise    target speed, m/s
 * @param opts.meltAt    { x, z, until } loiter near (x,z) until shell <= until
 */
export function autopilot(waypoints, opts = {}) {
  const cruise = opts.cruise ?? 11;
  const kp = opts.kp ?? 0.30;
  const melt = opts.meltAt || null;
  let i = 0;
  let melting = !!melt;

  return function pilot(sim) {
    const p = sim.ball.p, v = sim.ball.v;

    // Advance the cursor on proximity OR on the next waypoint simply being
    // nearer. Proximity alone is not enough: a detour (the melt loiter, or any
    // corner cut) can skip a waypoint entirely, after which the pilot drives
    // backwards to collect it. That is how the basin route "failed" -- it
    // melted, then returned to the start and crossed the basin a second time.
    while (i < waypoints.length - 1) {
      const a = waypoints[i], b = waypoints[i + 1];
      const da = Math.hypot(p.x - a[0], p.z - a[2]);
      const db = Math.hypot(p.x - b[0], p.z - b[2]);
      if (da < 5.0 || db < da) i++; else break;
    }

    let tx, tz, spdCap = cruise;
    if (melting) {
      if (sim.ball.shell <= melt.until) melting = false;
      else { tx = melt.x; tz = melt.z; spdCap = 4.5; }   // sit on the hot spot
    }
    if (tx === undefined) {
      const w = waypoints[Math.min(i, waypoints.length - 1)];
      tx = w[0]; tz = w[2];
    }

    let dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const spd = Math.min(spdCap, d * 1.6);
    const ex = dx * spd - v.x, ez = dz * spd - v.z;
    // pitch (input.x) drives +Z; roll (input.z) drives -X, hence the sign flip.
    return { x: clamp(ez * kp, -1, 1), z: clamp(-ex * kp, -1, 1) };
  };
}
