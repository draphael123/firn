import * as S from '../src/sim.js';

const flat = {
  id: 'flat', name: 'flat', warmth: 0, killY: -20,
  spawn: [0, 1.2, -20], goal: [0, 0.6, 40], goalR: 1.5,
  boxes: [{ p: [0, -0.5, 0], s: [12, 1, 120], kind: 'stone' }],
};

// Acceleration from rest, measured over a short window before drag matters.
const sim = S.createSim(flat, { seed: 1 });
for (let i = 0; i < 200; i++) sim.step(1 / 240, { x: 1, z: 0 });  // reach full tilt, still slow
const v0 = sim.ball.v.z, t0 = sim.time;
for (let i = 0; i < 40; i++) sim.step(1 / 240, { x: 1, z: 0 });
const a = (sim.ball.v.z - v0) / (sim.time - t0);
const ideal = S.T.ROLL_INERTIA * S.T.G * Math.sin(S.T.TILT_MAX);
console.log('accel  measured', a.toFixed(3), ' ideal', ideal.toFixed(3), ' (drag pulls it under)');

const r = S.run(flat, () => ({ x: 1, z: 0 }), { maxT: 20 });
console.log('flat   ->', r.state, 't=' + r.time.toFixed(2), 'topZ=' + r.p.z.toFixed(1), 'shell=' + r.shell.toFixed(3));

// A 12-degree ramp: the ball must accelerate down it and stay on the surface.
const RAMP = 12 * Math.PI / 180;
const ramp = {
  id: 'ramp', name: 'ramp', warmth: 0, killY: -40,
  spawn: [0, 6.0, -18], goal: [0, -6, 30], goalR: 2,
  boxes: [
    { p: [0, 4.5, -18], s: [10, 1, 12], kind: 'stone' },
    { p: [0, 0.0, 0], s: [10, 1, 44], kind: 'stone', rot: [RAMP, 0, 0] },
    { p: [0, -5.0, 26], s: [10, 1, 16], kind: 'stone' },
  ],
};
const rr = S.run(ramp, (s) => ({ x: s.ball.p.z < -13 ? 0.35 : 0, z: 0 }), { maxT: 25, trace: true });
console.log('ramp   ->', rr.state, 't=' + rr.time.toFixed(2), 'y=' + rr.p.y.toFixed(2), 'z=' + rr.p.z.toFixed(1));
console.log('  trace y:', rr.trace.filter((_, i) => i % 8 === 0).map((s) => s.y.toFixed(1)).join(' '));

// Same seed twice must match; a different seed must not.
const pilot = (s) => ({ x: Math.sin(s.time * 1.3) * 0.7, z: 0.3 });
const a1 = S.run(flat, pilot, { seed: 7, maxT: 6 });
const a2 = S.run(flat, pilot, { seed: 7, maxT: 6 });
const b1 = S.run(flat, pilot, { seed: 99, maxT: 6 });
console.log('seed   same:', a1.p.x === a2.p.x && a1.p.z === a2.p.z,
            ' differs:', Math.abs(a1.p.x - b1.p.x) > 1e-9 || Math.abs(a1.p.z - b1.p.z) > 1e-9);
