/* FIRN -- boot, input and the frame loop.
 *
 * Timers are all dt-driven and the loop exposes FIRN.step(), so a throttled
 * background tab or a headless harness both behave. Nothing here uses
 * setTimeout to advance game state.
 */

import * as SIM from './sim.js';
import { STAGES, TITLE_SCENE, shellForOpening, GATE_OPEN, GRATE_GAP } from './stages.js';
import { autopilot } from './autopilot.js';
import { View } from './render.js';
import { Audio, Music, TRACK_FOR_WORLD } from './audio.js';
import { Store, UI, fmtTime } from './ui.js';
import { T as SIMT } from './sim.js';

const $ = (id) => document.getElementById(id);
const GATE_SHELL = shellForOpening(GATE_OPEN);
const GRATE_SHELL = shellForOpening(GRATE_GAP);
const T_BARE = SIMT.BARE_IMPACT;

let store, settings, view, audio, music, ui;
let sim = null, stageIndex = 0;
let mode = 'attract';          // attract | ready | play | paused | over
let readyT = 0;
let hitstopT = 0;
let taughtAt = -1;      // index of the tutorial line currently showing
let attractPilot = null;
let last = 0, lastRender = 0, raf = 0;

const keys = new Set();
const input = { x: 0, z: 0 };

/* ------------------------------------------------------------------ touch
 *
 * A FLOATING stick. The pad appears wherever the thumb lands instead of in a
 * fixed corner, because there is no one corner that is comfortable across
 * phone sizes and grips, and a fixed pad means looking away from the road to
 * find it. Only the first touch on the play surface steers -- a second finger
 * is ignored rather than fighting the first.
 *
 * RADIUS is in CSS pixels and is deliberately short: this drives a TILT, and
 * full deflection wants to be reachable with a thumb that is not travelling.
 */
const TOUCH_RADIUS = 62;
const touch = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let touchUsed = false;

function stickEl() { return document.getElementById('stick'); }

function touchStart(e) {
  if (touch.id !== null) return;
  if (e.target.closest('button, .menu, .row, li, .screen')) return;  // UI first
  const t = e.changedTouches ? e.changedTouches[0] : e;
  touch.id = t.identifier ?? 'mouse';
  touch.ox = t.clientX; touch.oy = t.clientY;
  touch.x = touch.y = 0;
  if (!touchUsed) { touchUsed = true; document.body.classList.add('touch'); }
  const el = stickEl();
  el.style.left = t.clientX + 'px';
  el.style.top = t.clientY + 'px';
  el.style.setProperty('--kx', '0px');
  el.style.setProperty('--ky', '0px');
  el.classList.add('on');
}

function touchMove(e) {
  if (touch.id === null) return;
  const list = e.changedTouches || [e];
  for (const t of list) {
    if ((t.identifier ?? 'mouse') !== touch.id) continue;
    let dx = t.clientX - touch.ox, dy = t.clientY - touch.oy;
    const m = Math.hypot(dx, dy);
    if (m > TOUCH_RADIUS) { dx = dx / m * TOUCH_RADIUS; dy = dy / m * TOUCH_RADIUS; }
    touch.x = dx / TOUCH_RADIUS;
    touch.y = dy / TOUCH_RADIUS;
    const el = stickEl();
    el.style.setProperty('--kx', dx.toFixed(1) + 'px');
    el.style.setProperty('--ky', dy.toFixed(1) + 'px');
  }
}

function touchEnd(e) {
  if (touch.id === null) return;
  const list = e.changedTouches || [e];
  for (const t of list) {
    if ((t.identifier ?? 'mouse') !== touch.id) continue;
    touch.id = null; touch.x = touch.y = 0;
    stickEl().classList.remove('on');
  }
}

// ---------------------------------------------------------------- input

function readInput() {
  let ix = 0, iy = 0;
  if (keys.has('arrowup') || keys.has('w')) iy += 1;
  if (keys.has('arrowdown') || keys.has('s')) iy -= 1;
  if (keys.has('arrowright') || keys.has('d')) ix += 1;
  if (keys.has('arrowleft') || keys.has('a')) ix -= 1;

  if (touch.id !== null) { ix += touch.x; iy -= touch.y; }

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const dz = (v) => (Math.abs(v) < settings.deadzone ? 0 : v);
    ix += dz(p.axes[0] || 0);
    iy -= dz(p.axes[1] || 0);
    break;
  }

  const m = Math.hypot(ix, iy);
  if (m > 1) { ix /= m; iy /= m; }
  if (settings.invertPitch) iy = -iy;
  if (settings.invertRoll) ix = -ix;

  /* Steering, derived rather than guessed -- the old version was wrong in two
   * ways at once and they hid each other.
   *
   * The camera sits at ball + (-sin y, ., -cos y) * dist, so it looks along
   * f = (sin y, cos y) and its right hand is r = f x up = (-cos y, sin y).
   * The world direction the player is asking for is therefore
   *     W = iy * f + ix * r
   * and the sim takes accel_z = +input.x, accel_x = -input.z.
   *
   * The bug this replaces had `input.z = -dx`, which pointed ROLL the wrong way:
   * world +X projects to screen LEFT from behind the ball, so D drove left and
   * A drove right. No headless test could see it -- the pilot steers in world
   * space, where the sim was always self-consistent. Only a person looking at
   * the screen experiences the inversion.
   *
   * The second fault was that view.camYaw was assigned 0 at construction and
   * never again, so this whole block was an identity transform and
   * "Camera-relative" steering had never once been applied. */
  const yaw = (settings.camRelative && view) ? view.camYaw : 0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  input.x = iy * cy + ix * sy;          // +Z component of the asked-for heading
  input.z = ix * cy - iy * sy;          // and the roll that produces its -X part
  return input;
}

// ---------------------------------------------------------------- flow

function startStage(i) {
  if (i < 0 || i >= STAGES.length) return quitToTitle();
  hitstopT = 0;
  stageIndex = i;
  const stage = STAGES[i];
  sim = SIM.createSim(stage, { seed: (store.bearer * 7919 + i * 104729) >>> 0 });
  view.loadStage(sim.stage);
  view.snapCamera(sim);
  $('stageName').textContent = `${stage.numeral}. ${stage.name}`;
  ui.show(null, false);
  arm(stage, 1.05);
  flash();
}

function restart() {
  hitstopT = 0;
  taughtAt = -1;
  $('teach').classList.remove('on');
  const stage = STAGES[stageIndex];
  sim = SIM.createSim(stage, { seed: (store.bearer * 7919 + stageIndex * 104729) >>> 0 });
  view.snapCamera(sim);
  ui.show(null, false);
  arm(STAGES[stageIndex], 0.62);   // shorter on a retry: never cost a second unasked
  flash();
}

function quitToTitle() {
  mode = 'attract';
  $('reelTag').classList.remove('on');
  audio.setBed(false);
  audio.hush();
  ui.stack.length = 0;
  startAttract(0);
  ui.show('scr-title', false);
  ui.buildRoute();
}

/**
 * Say what actually went wrong, in the mechanic's own terms.
 *
 * "It fell" is true and teaches nothing. The player is never more willing to
 * learn the system than in the second after it beat them, so name the number
 * they missed and by how much.
 */
function diagnose(sim, reason) {
  const b = sim.ball;
  const pct = (v) => Math.round(v * 100) + '%';
  if (reason === 'woke') {
    return `The shell was gone, and the landing was too hard. `
         + `Bare ice will not take a blow over ${T_BARE.toFixed(1)} m/s — that one was `
         + `${b.lastImpact.toFixed(1)}.`;
  }
  // did it drop THROUGH a grate rather than off an edge?
  const grate = sim.stage.boxes.find((x) => x.kind === 'grate'
    && Math.abs(b.p.x - x.c[0]) < x.e[0] + 1.5
    && Math.abs(b.p.z - x.c[2]) < x.e[2] + 6);
  if (grate) {
    return `You went through the bars at ${pct(b.shell)}. `
         + `They hold anything above ${pct(GRATE_SHELL)} — you were `
         + `${Math.round((GRATE_SHELL - b.shell) * 100)} short.`;
  }
  const speed = Math.hypot(b.v.x, b.v.z);
  return speed > 14
    ? `Off the edge at ${speed.toFixed(0)} m/s. The ice keeps whatever speed you give it — set the corner up earlier.`
    : `Off the edge. Tilt back against the way you are going to shed speed before a turn.`;
}

function finish() {
  const won = sim.state === 'won';
  const stage = STAGES[stageIndex];
  let isBest = { betterTime: false, betterShell: false };
  if (won) isBest = store.record(stage.id, sim.time, sim.ball.shell);
  mode = 'over';
  audio.setBed(false);
  audio.hush();
  if (won) {
    audio.win(); view.goalBurst(); burstFlash(); view.shot('arrival');
  } else {
    audio.lose(sim.reason);
    view.shot(sim.reason === 'woke' ? 'wake' : 'fall');
  }
  ui.buildRoute();
  if (!won && settings.autoRetry) { restart(); return; }
  ui.showResult({
    won, reason: sim.reason, stage, time: sim.time,
    shell: sim.ball.shell, index: stageIndex, isBest,
    why: won ? null : diagnose(sim, sim.reason),
  });
}

/* THE ATTRACT REEL.
 *
 * The title does not sit on one picture. It cycles: the shrine you are climbing
 * toward, then the road itself being run, then back -- so the menu is laid over
 * a demonstration of the game rather than a still life, and the worlds get to
 * introduce themselves before anyone has pressed anything.
 *
 * Segments are chosen for CONTRAST rather than order: open ice, then the
 * enclosed vault, then the warm low country. Any key drops out of it.
 */
const REEL = [
  { kind: 'shrine', dur: 11 },
  { kind: 'run', stage: 5, dur: 13 },   // Icefall -- open, blue, the big curve
  { kind: 'shrine', dur: 8 },
  { kind: 'run', stage: 2, dur: 13 },   // Cathedral -- enclosed, the hard cut
  { kind: 'run', stage: 1, dur: 12 },   // Kiln Road -- warm, low, steaming
];

let reelIx = 0, reelT = 0;

function startAttract(index = 0) {
  reelIx = ((index % REEL.length) + REEL.length) % REEL.length;
  const seg = REEL[reelIx];
  reelT = seg.dur;
  const tag = $('reelTag');

  if (seg.kind === 'shrine') {
    sim = SIM.createSim(TITLE_SCENE, { seed: 4242 });
    attractPilot = null;
    view.loadStage(sim.stage);
    view.snapCamera(sim);
    view.shot('title');
    tag.classList.remove('on');
  } else {
    const st = STAGES[seg.stage];
    sim = SIM.createSim(st, { seed: 909 + seg.stage });
    attractPilot = autopilot(st.waypoints, { cruise: 13, meltAt: st.meltAt });
    view.loadStage(sim.stage);
    view.snapCamera(sim);
    view.shot('follow');
    tag.innerHTML = `<b>${st.numeral}</b> ${st.name}<i>${st.altitude.toLocaleString()} m</i>`;
    tag.classList.add('on');
  }
  music.play('title');
  flash();
}

/**
 * Hold the ice on a slow circle around the ring.
 *
 * A gentle circling LEAN does not work: rolling resistance is deliberately tiny,
 * so any steady tilt just spirals the ball outward until it parks against the
 * kerb -- behind the menu column, where the only moving thing on the screen
 * cannot be seen. So steer it properly: a target creeping round a small circle,
 * and the same proportional chase the autopilot uses.
 */
function attractInput(sim) {
  const a = sim.time * 0.40;
  const tx = Math.cos(a) * 6.5, tz = Math.sin(a) * 6.5;
  const p = sim.ball.p, v = sim.ball.v;
  const ex = (tx - p.x) * 1.1 - v.x;
  const ez = (tz - p.z) * 1.1 - v.z;
  const k = 0.20, c = (n) => (n < -1 ? -1 : n > 1 ? 1 : n);
  // pitch drives +Z, roll drives -X
  return { x: c(ez * k), z: c(-ex * k) };
}

/** The held beat: name the stage, then let go. Any key skips it. */
function arm(stage, hold) {
  mode = 'ready';
  // the establishing shot needs room to breathe; without it, don't linger
  readyT = settings.cinematic ? hold : Math.min(hold, 0.5);
  $('rdNum').textContent = stage.numeral;
  $('rdName').textContent = stage.name;
  $('rdEpi').textContent = stage.epigraph || '';
  const r = $('ready');
  r.classList.remove('hide');
  r.style.animation = 'none'; void r.offsetWidth; r.style.animation = '';
  audio.setBed(true);
  music.play(TRACK_FOR_WORLD[stage.world] || 'cold');
  view.shot('intro', readyT);
}

function release() {
  if (mode !== 'ready') return;
  mode = 'play';
  view.shot('follow');
  $('ready').classList.add('hide');
  audio.blip(660, 0.06, 0.14);
}

let flashTimer = 0;
function burstFlash() {
  const b = $('burst');
  b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  setTimeout(() => b.classList.remove('on'), 1000);
}

function flash() {
  const f = $('fade');
  f.classList.remove('on');
  void f.offsetWidth;          // restart the keyframe animation
  f.classList.add('on');
  // Belt and braces: the classless state is opacity 0, so stripping the class
  // guarantees a clear even if the animation itself was throttled part-way.
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => f.classList.remove('on'), 600);
}

// ---------------------------------------------------------------- HUD

function updateHud() {
  if (!sim) return;
  $('timeVal').textContent = fmtTime(sim.time);
  const shell = Math.max(0, sim.ball.shell);
  $('shellPct').textContent = `${Math.round(shell * 100)}%`;
  $('shellFill').style.width = `${shell * 100}%`;

  const wrap = $('shellWrap');
  wrap.classList.toggle('thin', shell <= GATE_SHELL && shell > GRATE_SHELL);
  wrap.classList.toggle('bare', shell <= GRATE_SHELL);

  const m = sim.meltLast;
  $('meltRate').textContent = m < 0.004 ? 'holding' : m < 0.02 ? 'melting' : m < 0.06 ? 'melting fast' : 'thawing';

  /* How much shell is left answers the wrong question. What you actually need
   * to decide -- take the gate, take the long way, get off this hot ground --
   * is HOW LONG you have at the rate you are melting right now. */
  const eta = $('meltEta');
  if (m > 0.005 && shell > 0) {
    const toBare = shell / m;
    const toGrate = (shell - GRATE_SHELL) / m;
    eta.textContent = shell > GRATE_SHELL && toGrate < 30
      ? `${toGrate.toFixed(0)}s to the bars`
      : `${toBare.toFixed(0)}s left`;
  } else eta.textContent = '';

  const w = $('warn');
  let msg = '';
  if (sim.gateBlock) {
    // The single most confusing moment in the game: you are stopped by a gate
    // and nothing says why. Name the rule and the number.
    const need = Math.round(shellForOpening(sim.gateBlock) * 100);
    msg = `too thick for this gate · melt below ${need}%`;
  } else if (shell <= 0) msg = 'bare · one blow';
  else if (shell < GRATE_SHELL + 0.05) msg = 'the floor will not hold you';
  else if (m > 0.05) msg = 'too hot';
  w.textContent = msg;
  w.classList.toggle('on', !!msg);
  $('edge').classList.toggle('on', shell <= 0 || m > 0.06);

  $('shellBox').classList.toggle('hide', !settings.showMeter);

  // Guided prompts fire on PROGRESS, not on a timer, so a line arrives when the
  // thing it describes is in front of you however long you took to get there.
  const teach = sim.stage.teach;
  const el = $('teach');
  if (teach) {
    let i = -1;
    for (let k = 0; k < teach.length; k++) if (sim.ball.p.z >= teach[k].z) i = k;
    if (i !== taughtAt) {
      taughtAt = i;
      if (i >= 0) { el.textContent = teach[i].text; el.classList.add('on'); }
      else el.classList.remove('on');
    }
  } else if (el.classList.contains('on')) {
    el.classList.remove('on');
  }
  $('speed').style.opacity = settings.speedRush ? Math.max(0, (view.speedFrac || 0) - 0.45) * 1.1 : 0;
  $('timeVal').parentElement.style.visibility = settings.showTimer ? '' : 'hidden';
}

// ---------------------------------------------------------------- loop

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000) || 0;
  last = now;
  step(dt);
  view.render();
  lastRender = now;
}

/** Exposed so a harness (or a throttled tab) can advance without rAF. */
export function step(dt) {
  music.update(dt);
  if (!sim) return;

  if (mode === 'ready') {
    readyT -= dt;
    view.update(sim, dt * 0.2);      // a slow drift, so the world is not frozen
    updateHud();
    if (readyT <= 0) release();
    return;
  }

  if (mode === 'play') {
    if (hitstopT > 0) {
      // the world keeps breathing; only the simulation is held
      hitstopT -= dt;
      view.update(sim, dt);
      updateHud();
      return;
    }
    sim.step(dt, readInput());
    drainEvents();
    audio.update(sim, dt);
    view.update(sim, dt);
    updateHud();
    if (sim.state !== 'run') finish();
  } else if (mode === 'attract') {
    reelT -= dt;
    sim.step(dt, attractPilot ? attractPilot(sim) : attractInput(sim));
    sim.events.length = 0;
    view.update(sim, dt);
    // a segment that ends early -- a demo run reaching its goal -- just cuts on
    if (reelT <= 0 || sim.state !== 'run') startAttract(reelIx + 1);
  } else {
    // paused / menus: keep the world alive but frozen
    view.update(sim, 0);
  }
}

function drainEvents() {
  for (const e of sim.events) {
    if (e.type === 'impact') {
      audio.impact(e.speed);
      view.impact(sim, e.speed);
      if (e.speed > 3) view.shake = Math.min(0.55, e.speed * 0.045);
      // Hitstop: a couple of frames of held time on a real slam. Cheap, and it
      // is most of why an impact reads as WEIGHT rather than as a colour change.
      if (e.speed > 5 && !settings.reduceMotion) hitstopT = Math.min(0.085, e.speed * 0.008);
    } else if (e.type === 'bare') {
      audio.bare();
      view.shake = 0.5;
    }
  }
  sim.events.length = 0;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  view.resize(w, h, settings.resScale);
}

// ---------------------------------------------------------------- boot

export function boot() {
  store = new Store();
  settings = store.settings();

  view = new View($('c'), settings);
  audio = new Audio(settings);
  music = new Music(settings);

  ui = new UI(store, {
    onStart: (i) => startStage(i),
    onResume: () => { mode = 'play'; ui.show(null, false); audio.setBed(true); },
    onRestart: () => restart(),
    onQuit: () => quitToTitle(),
    onSettingsChange: () => {
      settings = store.settings();
      view.applySettings(settings);
      audio.applySettings(settings);
      music.applySettings(settings);
      resize();
    },
    onNav: (k) => {
      audio.start(); audio.resume();
      if (k === 'move') audio.blip(620, 0.035, 0.05);
      else if (k === 'pick') audio.blip(880, 0.055, 0.11);
      else audio.blip(420, 0.035, 0.08);
    },
  });

  window.addEventListener('keydown', (e) => {
    audio.start(); audio.resume();
    const k = e.key.toLowerCase();

    if (mode === 'ready') { release(); e.preventDefault(); return; }

    if (k === 'escape' && mode === 'play') {
      mode = 'paused'; audio.setBed(false); audio.hush(); ui.showPause(STAGES[stageIndex]);
      e.preventDefault(); return;
    }
    if (k === 'r' && mode === 'play') { restart(); e.preventDefault(); return; }

    if (ui.screen) {
      if (ui.key(e)) { e.preventDefault(); return; }
    }
    keys.add(k);
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('pointerdown', () => { audio.start(); audio.resume(); });
  window.addEventListener('resize', resize);
  // iOS reports the OLD size inside the resize event during an orientation
  // change; the visual viewport settles a frame or two later.
  window.addEventListener('orientationchange', () => setTimeout(resize, 260));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  const canvas = $('c');
  canvas.addEventListener('touchstart', (e) => { touchStart(e); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { touchMove(e); e.preventDefault(); }, { passive: false });
  for (const ev of ['touchend', 'touchcancel']) canvas.addEventListener(ev, touchEnd);

  const pauseBtn = $('touchPause');
  /* Dispatch the real key rather than reaching into the pause code: pausing
   * also stops the bed, hushes the synth and hands the stage to the UI, and a
   * second copy of that list is a second thing to forget to update. */
  pauseBtn.addEventListener('click', () => {
    keys.clear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  // The on-screen pause only exists once a touch has happened, and only while
  // a stage is actually running -- it has nothing to do on a menu.
  setInterval(() => {
    pauseBtn.classList.toggle('on', touchUsed && mode === 'play');
  }, 300);

  resize();
  startAttract(0);
  ui.show('scr-title', false);

  last = performance.now();
  raf = requestAnimationFrame(frame);

  // Render watchdog. Some embedded panels never fire rAF; without this the
  // canvas is simply black and there is nothing to debug from.
  setInterval(() => {
    if (performance.now() - lastRender > 900) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000) || 0;
      last = now;
      step(dt); view.render(); lastRender = now;
    }
  }, 500);

  window.FIRN = {
    SIM, STAGES, view, store, ui,
    get sim() { return sim; },
    step,
    run: SIM.run,
    autopilot,
    thresholds: { gate: GATE_SHELL, grate: GRATE_SHELL },
  };
}
