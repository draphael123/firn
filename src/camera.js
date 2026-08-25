/* FIRN -- the camera director.
 *
 * One object owns the camera and swaps between shots. Gameplay is `follow`;
 * the others exist because a run has beats -- being shown the road before you
 * are released, arriving, and losing -- and a camera that never changes its
 * mind flattens all three into the same picture.
 *
 * Two rules hold across every mode:
 *   - camera.up stays world-up. It never rolls with the stage. A camera that
 *     rolls with the floor is the fastest way to make a tilt game unplayable.
 *   - the follow offset inherits only PART of the stage tilt. Anchored in world
 *     space the deck behind you swings up into the lens at full lean; anchored
 *     fully in the stage frame the camera turns with the floor and the tilt
 *     becomes invisible.
 */

import * as THREE from '../vendor/three.module.js';

export const CAM_TILT_FOLLOW = 0.62;
const BASE_FOV = 52;

const _off = new THREE.Vector3();
const _frame = new THREE.Euler();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _tmp = new THREE.Vector3();

const ease = (t) => t * t * (3 - 2 * t);          // smoothstep
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

export class Director {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;
    this.mode = 'follow';
    this.t = 0;              // seconds inside the current shot
    this.dur = 0;
    this.yaw = 0;
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.punch = 0;          // vertical kick, from landings
    this.speedFrac = 0;
    this.anchor = new THREE.Vector3();
    this.introFrom = new THREE.Vector3();
  }

  /** @param mode follow | intro | arrival | fall | wake */
  set(mode, dur = 0, view = null) {
    if (!this.settings.cinematic && mode !== 'follow') return;
    this.mode = mode;
    this.t = 0;
    this.dur = dur;
    if (view) {
      view.ballGroup.getWorldPosition(this.anchor);
      // an establishing position: high, wide, off to one side
      const a = this.yaw + 2.5;
      this.introFrom.set(
        this.anchor.x + Math.sin(a) * 34,
        this.anchor.y + 27,
        this.anchor.z + Math.cos(a) * 34,
      );
    }
  }

  kick(amount) { this.punch = Math.min(1.2, this.punch + amount); }

  /** Where the follow camera wants to be, given the stage's current tilt. */
  followPose(view, sim, out, outLook) {
    const s = this.settings;
    const b = sim.ball;
    const speed = Math.hypot(b.v.x, b.v.z);
    const dist = s.camDist + Math.min(6, speed * 0.32);
    const hgt = s.camHeight + Math.min(2.6, speed * 0.1);

    _frame.set(sim.tilt.x * CAM_TILT_FOLLOW, 0, sim.tilt.z * CAM_TILT_FOLLOW);
    _off.set(-Math.sin(this.yaw) * dist, hgt, -Math.cos(this.yaw) * dist);
    _off.applyEuler(_frame);
    out.copy(view._ballWorld).add(_off);

    _tmp.set(b.v.x, 0, b.v.z).applyEuler(view.stageRoot.rotation);
    outLook.set(
      view._ballWorld.x + _tmp.x * 0.16,
      view._ballWorld.y + 1.2,
      view._ballWorld.z + _tmp.z * 0.16,
    );
    return speed;
  }

  update(view, sim, dt) {
    const s = this.settings;
    const cam = this.camera;
    const b = sim.ball;

    // yaw trails the direction of travel, heavily lagged
    _tmp.set(b.v.x, 0, b.v.z).applyEuler(view.stageRoot.rotation);
    const speed = Math.hypot(_tmp.x, _tmp.z);
    if (speed > 1.4 && this.mode === 'follow') {
      const target = Math.atan2(_tmp.x, _tmp.z);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, s.camFollow * dt * Math.min(1, speed / 7));
    }
    this.speedFrac = Math.min(1, speed / 24);
    this.t += dt;

    const followSpeed = this.followPose(view, sim, _want, _look);

    if (this.mode === 'intro') {
      // Establishing shot easing into the pose you will actually play from.
      const k = ease(clamp01(this.t / Math.max(0.01, this.dur)));
      _want.lerpVectors(this.introFrom, _want, k);
      _look.lerp(view._ballWorld, 0.35 + k * 0.65);
      cam.position.copy(_want);

    } else if (this.mode === 'arrival') {
      // A slow orbit of the goal, rising. The ice is set down; look at it.
      const g = view.goalGroup ? view.goalGroup.getWorldPosition(_from) : view._ballWorld;
      const a = this.yaw + this.t * 0.42;
      const r = 13 - Math.min(5, this.t * 1.1);
      cam.position.set(g.x + Math.sin(a) * r, g.y + 4 + this.t * 1.4, g.z + Math.cos(a) * r);
      _look.copy(g);

    } else if (this.mode === 'fall') {
      // Stay where the road ended and watch it go.
      cam.position.lerp(_want, Math.min(1, 0.9 * dt));
      _look.copy(view._ballWorld);

    } else if (this.mode === 'wake') {
      // Push in close and low. Whatever is in there is not asleep any more.
      const a = this.yaw + this.t * 0.7;
      const r = Math.max(2.4, 8 - this.t * 3.2);
      cam.position.lerp(
        _tmp.set(view._ballWorld.x + Math.sin(a) * r, view._ballWorld.y + 1.4, view._ballWorld.z + Math.cos(a) * r),
        Math.min(1, 5 * dt),
      );
      _look.copy(view._ballWorld);

    } else {
      cam.position.lerp(_want, Math.min(1, 6.0 * dt));
      this.occlude(view);
    }

    // FOV widening is the cheapest strong speed cue there is: the world
    // stretches past the edges of the frame as you gather pace.
    const wide = this.mode === 'fall' ? 8 : this.mode === 'follow' ? Math.min(12, followSpeed * 0.62) : 0;
    const fovWant = (s.fov || BASE_FOV) + (s.reduceMotion ? 0 : wide);
    if (Math.abs(cam.fov - fovWant) > 0.01) {
      cam.fov += (fovWant - cam.fov) * Math.min(1, 2.6 * dt);
      cam.updateProjectionMatrix();
    }

    this.look.lerp(_look, Math.min(1, 8 * dt));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);

    // landing punch, then shake
    if (this.punch > 0.001) {
      cam.position.y -= this.punch * 0.55;
      this.punch = Math.max(0, this.punch - dt * 3.4);
    }
    if (dt > 0 && this.shake > 0.001 && s.shakeAmount > 0 && !s.reduceMotion) {
      const a = this.shake * s.shakeAmount;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      this.shake *= Math.pow(0.02, dt);
    } else if (dt > 0) this.shake = 0;
  }

  /** Do not let the stage get between the camera and the ball. */
  occlude(view) {
    if (!view.solids.length) return;
    _from.copy(view._ballWorld); _from.y += 0.6;
    _dir.copy(this.camera.position).sub(_from);
    const d = _dir.length();
    if (d < 0.01) return;
    _dir.divideScalar(d);
    view._ray.set(_from, _dir);
    view._ray.far = d;
    const hits = view._ray.intersectObjects(view.solids, false);
    if (hits.length) {
      this.camera.position.copy(_from).addScaledVector(_dir, Math.max(1.6, hits[0].distance - 0.55));
    }
  }

  /** Drop straight onto the ball, for stage start and restarts. */
  snap(view, sim) {
    this.yaw = 0;
    this.punch = 0;
    this.shake = 0;
    this.mode = 'follow';
    this.followPose(view, sim, _want, _look);
    this.camera.position.copy(_want);
    this.look.copy(_look);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
  }
}
