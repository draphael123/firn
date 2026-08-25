/* FIRN -- boot, input and the frame loop.
 *
 * Timers are all dt-driven and the loop exposes FIRN.step(), so a throttled
 * background tab or a headless harness both behave. Nothing here uses
 * setTimeout to advance game state.
 */

import * as SIM from './sim.js';
import { STAGES, shellForOpening, GATE_OPEN, GRATE_GAP } from './stages.js';
import { autopilot } from './autopilot.js';
import { View } from './render.js';
import { Audio } from './audio.js';
import { Store, UI, fmtTime } from './ui.js';

const $ = (id) => document.getElementById(id);
const GATE_SHELL = shellForOpening(GATE_OPEN);
const GRATE_SHELL = shellForOpening(GRATE_GAP);

let store, settings, view, audio, ui;
let sim = null, stageIndex = 0;
let mode = 'attract';          // attract | play | paused | over
let attractPilot = null;
let last = 0, lastRender = 0, raf = 0;

const keys = new Set();
const input = { x: 0, z: 0 };

// ---------------------------------------------------------------- input

function readInput() {
  let ix = 0, iy = 0;
  if (keys.has('arrowup') || keys.has('w')) iy += 1;
  if (keys.has('arrowdown') || keys.has('s')) iy -= 1;
  if (keys.has('arrowright') || keys.has('d')) ix += 1;
  if (keys.has('arrowleft') || keys.has('a')) ix -= 1;

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
    ix += dz(p.axes[0] || 0);
    iy -= dz(p.axes[1] || 0);
    break;
  }

  const m = Math.hypot(ix, iy);
  if (m > 1) { ix /= m; iy /= m; }
  if (settings.invertPitch) iy = -iy;
  if (settings.invertRoll) ix = -ix;

  // Camera-relative steering: "away from the camera" must keep meaning that
  // after the camera has swung around a corner.
  let dx = ix, dz = iy;
  if (settings.camRelative && view) {
    const cy = Math.cos(view.camYaw), sy = Math.sin(view.camYaw);
    dx = ix * cy + iy * sy;
    dz = -ix * sy + iy * cy;
  }
  // pitch drives +Z, roll drives -X
  input.x = dz;
  input.z = -dx;
  return input;
}

// ---------------------------------------------------------------- flow

function startStage(i) {
  if (i < 0 || i >= STAGES.length) return quitToTitle();
  stageIndex = i;
  const stage = STAGES[i];
  sim = SIM.createSim(stage, { seed: (store.bearer * 7919 + i * 104729) >>> 0 });
  view.loadStage(sim.stage);
  view.snapCamera(sim);
  $('stageName').textContent = `${stage.numeral}. ${stage.name}`;
  ui.show(null, false);
  mode = 'play';
  audio.setBed(true);
  flash();
}

function restart() {
  const stage = STAGES[stageIndex];
  sim = SIM.createSim(stage, { seed: (store.bearer * 7919 + stageIndex * 104729) >>> 0 });
  view.snapCamera(sim);
  ui.show(null, false);
  mode = 'play';
  audio.setBed(true);
  flash();
}

function quitToTitle() {
  mode = 'attract';
  audio.setBed(false);
  startAttract();
  ui.stack.length = 0;
  ui.show('scr-title', false);
  ui.buildRoute();
}

function finish() {
  const won = sim.state === 'won';
  const stage = STAGES[stageIndex];
  let isBest = false;
  if (won) isBest = store.record(stage.id, sim.time, sim.ball.shell);
  mode = 'over';
  audio.setBed(false);
  if (won) audio.win(); else audio.lose(sim.reason);
  ui.buildRoute();
  ui.showResult({
    won, reason: sim.reason, stage, time: sim.time,
    shell: sim.ball.shell, index: stageIndex, isBest,
  });
}

function startAttract() {
  const stage = STAGES[0];
  sim = SIM.createSim(stage, { seed: 4242 });
  attractPilot = autopilot(stage.waypoints, { cruise: 8.5 });
  view.loadStage(sim.stage);
  view.snapCamera(sim);
}

/* Purely cosmetic: snap to black, then transition off over the next frame.
 * The fade used to gate the stage swap behind a deferred callback, which meant
 * one throw anywhere in stage setup left the screen black with the menu still
 * up and nothing in the console. State changes are synchronous now; this only
 * paints. It also makes restart genuinely instant, which the stage needs. */
function flash() {
  const f = $('fade');
  f.style.transition = 'none';
  f.classList.add('on');
  requestAnimationFrame(() => {
    f.style.transition = '';
    f.classList.remove('on');
  });
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

  const w = $('warn');
  let msg = '';
  if (shell <= 0) msg = 'bare · one blow';
  else if (shell < GRATE_SHELL + 0.05) msg = 'the floor will not hold you';
  else if (m > 0.05) msg = 'too hot';
  w.textContent = msg;
  w.classList.toggle('on', !!msg);
  $('edge').classList.toggle('on', shell <= 0 || m > 0.06);

  $('shellBox').classList.toggle('hide', !settings.showMeter);
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
  if (!sim) return;

  if (mode === 'play') {
    sim.step(dt, readInput());
    drainEvents();
    audio.update(sim, dt);
    view.update(sim, dt);
    updateHud();
    if (sim.state !== 'run') finish();
  } else if (mode === 'attract') {
    sim.step(dt, attractPilot(sim));
    sim.events.length = 0;
    view.update(sim, dt);
    if (sim.state !== 'run') startAttract();
  } else {
    // paused / menus: keep the world alive but frozen
    view.update(sim, 0);
  }
}

function drainEvents() {
  for (const e of sim.events) {
    if (e.type === 'impact') {
      audio.impact(e.speed);
      if (e.speed > 3) view.shake = Math.min(0.55, e.speed * 0.045);
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

  ui = new UI(store, {
    onStart: (i) => startStage(i),
    onResume: () => { mode = 'play'; ui.show(null, false); audio.setBed(true); },
    onRestart: () => restart(),
    onQuit: () => quitToTitle(),
    onSettingsChange: () => {
      settings = store.settings();
      view.applySettings(settings);
      audio.applySettings(settings);
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

    if (k === 'escape' && mode === 'play') {
      mode = 'paused'; audio.setBed(false); ui.showPause(STAGES[stageIndex]);
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

  resize();
  startAttract();
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
