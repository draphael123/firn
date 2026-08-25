/* FIRN -- menus, settings and screens.
 *
 * Keyboard-first. Every list is arrow-keys-and-Enter, with the mouse as a
 * second class citizen, because that is how the game itself is played and
 * moving a hand to the mouse to start a run is a small betrayal.
 */

import { T } from './sim.js';
import { STAGES, shellForOpening, GATE_OPEN, GRATE_GAP } from './stages.js';

const LS = 'firn.v1';

// ---------------------------------------------------------------- settings

/** One schema drives the model, the defaults, the storage and the rendering. */
export const SETTINGS_SCHEMA = [
  { group: 'Control', items: [
    { key: 'tiltMax',   label: 'Tilt limit',     values: [0.36, 0.46, 0.56], names: ['21°', '26°', '32°'], def: 1 },
    { key: 'tiltRate',  label: 'Tilt response',  values: [3.2, 5.0, 7.5], names: ['Measured', 'Normal', 'Quick'], def: 1 },
    // Camera-relative is the default because "away from the camera" has to keep
    // meaning that after the camera swings round a corner. Fixed is kept for
    // anyone who finds a lagging camera swimmy.
    { key: 'camRelative', label: 'Steering', values: [0, 1], names: ['Fixed', 'Camera-relative'], def: 1 },
    { key: 'invertPitch', label: 'Invert pitch', bool: true, def: 0 },
    { key: 'invertRoll',  label: 'Invert roll',  bool: true, def: 0 },
  ] },
  { group: 'Camera', items: [
    { key: 'camFollow', label: 'Follow',   values: [2.0, 3.4, 5.5], names: ['Loose', 'Normal', 'Tight'], def: 1 },
    { key: 'camDist',   label: 'Distance', values: [9.5, 12.5, 15.5], names: ['Close', 'Normal', 'Far'], def: 1 },
    { key: 'camHeight', label: 'Height',   values: [4.3, 5.6, 7.2], names: ['Low', 'Normal', 'High'], def: 1 },
    { key: 'shake',     label: 'Impact shake', bool: true, def: 1 },
  ] },
  { group: 'Picture', items: [
    { key: 'iceQuality', label: 'Ice',        values: ['plain', 'clear'], names: ['Plain', 'Clear'], def: 1 },
    { key: 'snow',       label: 'Snowfall',   values: [0, 1, 2], names: ['Off', 'Light', 'Heavy'], def: 1 },
    { key: 'shadows',    label: 'Shadows',    bool: true, def: 1 },
    { key: 'resScale',   label: 'Resolution', values: [0.7, 0.85, 1.0], names: ['70%', '85%', '100%'], def: 2 },
    // Monitors vary enormously and this is a deliberately dark game; without a
    // brightness control it is unplayable on plenty of perfectly good screens.
    { key: 'exposure',   label: 'Brightness', values: [1.6, 1.85, 2.1, 2.4, 2.7], names: ['Dim', 'Low', 'Normal', 'Bright', 'Brightest'], def: 2 },
    { key: 'showMeter',  label: 'Shell gauge', bool: true, def: 1 },
  ] },
  { group: 'Sound', items: [
    { key: 'volMaster', label: 'Master',  range: 10, def: 7 },
    { key: 'volMusic',  label: 'Ambience', range: 10, def: 6 },
    { key: 'volSfx',    label: 'Effects', range: 10, def: 7 },
  ] },
];

const ALL_ITEMS = SETTINGS_SCHEMA.flatMap((g) => g.items);

function defaultIndices() {
  const o = {};
  for (const it of ALL_ITEMS) o[it.key] = it.def;
  return o;
}

/** Resolve stored indices into the concrete values the game consumes. */
export function resolveSettings(idx) {
  const s = {};
  for (const it of ALL_ITEMS) {
    const i = idx[it.key];
    if (it.bool) s[it.key] = !!i;
    else if (it.range !== undefined) s[it.key] = i;
    else s[it.key] = it.values[i];
  }
  // tilt settings live on the sim's tuning table
  T.TILT_MAX = s.tiltMax;
  T.TILT_RATE = s.tiltRate;
  return s;
}

export class Store {
  constructor() {
    this.idx = defaultIndices();
    this.best = {};       // stageId -> { time, shell }
    this.bearer = 1;
    this.cleared = {};
    this.load();
  }
  load() {
    try {
      const raw = localStorage.getItem(LS);
      if (!raw) return;
      const d = JSON.parse(raw);
      Object.assign(this.idx, d.idx || {});
      this.best = d.best || {};
      this.bearer = d.bearer || 1;
      this.cleared = d.cleared || {};
      // drop any key that no longer exists in the schema
      for (const k of Object.keys(this.idx)) if (!ALL_ITEMS.some((i) => i.key === k)) delete this.idx[k];
      for (const it of ALL_ITEMS) if (this.idx[it.key] === undefined) this.idx[it.key] = it.def;
    } catch { /* corrupted storage should never block the game */ }
  }
  save() {
    try {
      localStorage.setItem(LS, JSON.stringify({
        idx: this.idx, best: this.best, bearer: this.bearer, cleared: this.cleared,
      }));
    } catch { /* private mode */ }
  }
  resetSettings() { this.idx = defaultIndices(); this.save(); }
  settings() { return resolveSettings(this.idx); }
  record(stageId, time, shell) {
    const b = this.best[stageId];
    this.cleared[stageId] = true;
    const better = !b || time < b.time;
    if (better) this.best[stageId] = { time, shell };
    this.save();
    return better;
  }
  nextBearer() { this.bearer++; this.save(); return this.bearer; }
  unlocked(i) { return i === 0 || !!this.cleared[STAGES[i - 1].id]; }
}

// ---------------------------------------------------------------- bearers

const NAMES = ['HALVARD', 'SIGNY', 'TORVALD', 'ASLAUG', 'EINAR', 'GUDRUN', 'LEIF', 'RAGNHILD',
  'SVERRE', 'THORA', 'ULF', 'YRSA', 'BJORN', 'HELGA', 'KETIL', 'INGRID', 'ODD', 'SOLVEIG',
  'VIGDIS', 'ARNE', 'FRIDA', 'GEIR', 'HILDR', 'JORUNN', 'KNUT', 'MARIT', 'NJAL', 'OSK',
  'RUNE', 'SAGA', 'TOVE', 'VALDIS'];

export const bearerName = (n) => NAMES[(n - 1) % NAMES.length];

export function roman(n) {
  if (n <= 0) return '—';
  const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
}

export const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : s.toFixed(1);
};

// ---------------------------------------------------------------- screens

const $ = (id) => document.getElementById(id);

/** A keyboard-navigable list of elements with a selected index. */
class Nav {
  constructor(el, onPick, onAdjust) {
    this.el = el; this.onPick = onPick; this.onAdjust = onAdjust; this.i = 0;
  }
  items() { return [...this.el.querySelectorAll('[data-nav]')]; }
  paint() {
    const its = this.items();
    if (!its.length) return;
    this.i = Math.max(0, Math.min(this.i, its.length - 1));
    its.forEach((n, k) => n.setAttribute('aria-selected', k === this.i ? 'true' : 'false'));
    its[this.i].scrollIntoView({ block: 'nearest' });
  }
  move(d) {
    const its = this.items();
    if (!its.length) return false;
    let k = this.i;
    for (let n = 0; n < its.length; n++) {
      k = (k + d + its.length) % its.length;
      if (its[k].getAttribute('aria-disabled') !== 'true') break;
    }
    const moved = k !== this.i;
    this.i = k; this.paint();
    return moved;
  }
  pick() {
    const it = this.items()[this.i];
    if (!it || it.getAttribute('aria-disabled') === 'true') return false;
    this.onPick?.(it, this.i);
    return true;
  }
  adjust(d) {
    const it = this.items()[this.i];
    if (!it) return false;
    return !!this.onAdjust?.(it, d);
  }
  bindMouse() {
    this.el.addEventListener('mousemove', (e) => {
      const it = e.target.closest('[data-nav]');
      if (!it) return;
      const k = this.items().indexOf(it);
      if (k >= 0 && k !== this.i) { this.i = k; this.paint(); }
    });
    this.el.addEventListener('click', (e) => {
      const it = e.target.closest('[data-nav]');
      if (!it) return;
      const k = this.items().indexOf(it);
      if (k >= 0) { this.i = k; this.paint(); this.pick(); }
    });
  }
}

export class UI {
  /** @param hooks { onStart, onResume, onRestart, onQuit, onSettingsChange, onNav } */
  constructor(store, hooks) {
    this.store = store;
    this.hooks = hooks;
    this.screen = null;
    this.stack = [];
    this.buildRoute();
    this.buildSettings();
    this.buildNavs();
    this.paintFoot();
    this.paintThresholds();
  }

  // -------------------------------------------------------------- building

  buildRoute() {
    const ul = $('routeMenu');
    ul.innerHTML = '';
    STAGES.forEach((st, i) => {
      const li = document.createElement('li');
      li.className = 'stagerow';
      li.dataset.nav = ''; li.dataset.stage = String(i);
      const open = this.store.unlocked(i);
      if (!open) li.setAttribute('aria-disabled', 'true');
      const b = this.store.best[st.id];
      li.innerHTML = `
        <span class="idx">${st.numeral}</span>
        <span class="meta">
          <span class="nm">${open ? st.name : 'Sealed'}</span>
          <span class="best">${open
            ? (b ? `Best <span class="v">${fmtTime(b.time)}s</span> &nbsp;·&nbsp; shell <span class="v">${Math.round(b.shell * 100)}%</span>`
                 : 'Not yet carried')
            : `Clear ${STAGES[i - 1].name} first`}</span>
        </span>`;
      ul.appendChild(li);
    });
    const back = document.createElement('li');
    back.dataset.nav = ''; back.dataset.act = 'back';
    back.innerHTML = '<span class="idx">&larr;</span><span>Back</span>';
    ul.appendChild(back);
    $('routeTail').textContent = `${Object.keys(this.store.cleared).length}/${STAGES.length} carried`;
  }

  buildSettings() {
    const body = $('settingsBody');
    body.innerHTML = '';
    for (const g of SETTINGS_SCHEMA) {
      const wrap = document.createElement('div');
      wrap.className = 'group';
      wrap.innerHTML = `<span class="eyebrow">${g.group}</span>`;
      for (const it of g.items) {
        const row = document.createElement('div');
        row.className = 'row'; row.dataset.nav = ''; row.dataset.key = it.key;
        row.innerHTML = `<span class="lbl">${it.label}</span><span class="dots"></span><span class="val"></span>`;
        wrap.appendChild(row);
      }
      body.appendChild(wrap);
    }
    const extra = document.createElement('div');
    extra.className = 'group';
    extra.innerHTML = '<span class="eyebrow">&nbsp;</span>';
    for (const [act, label] of [['reset', 'Restore defaults'], ['back', 'Back']]) {
      const row = document.createElement('div');
      row.className = 'row'; row.dataset.nav = ''; row.dataset.act = act;
      row.innerHTML = `<span class="lbl">${label}</span><span class="dots"></span><span class="val"></span>`;
      extra.appendChild(row);
    }
    body.appendChild(extra);
    this.paintSettings();
  }

  paintSettings() {
    for (const it of ALL_ITEMS) {
      const row = document.querySelector(`.row[data-key="${it.key}"] .val`);
      if (!row) continue;
      const i = this.store.idx[it.key];
      row.textContent = it.bool ? (i ? 'On' : 'Off')
        : it.range !== undefined ? String(i).padStart(2, '0')
        : it.names[i];
    }
  }

  paintFoot() {
    $('foot').innerHTML = `Bearer ${roman(this.store.bearer)} &nbsp;·&nbsp; ${bearerName(this.store.bearer)}`;
  }

  /** Etch the gate and grate thresholds onto the shell gauge. */
  paintThresholds() {
    const g = shellForOpening(GATE_OPEN), r = shellForOpening(GRATE_GAP);
    const gt = document.querySelector('#shellWrap .tick.gate');
    const rt = document.querySelector('#shellWrap .tick.grate');
    if (gt) { gt.style.left = `${g * 100}%`; gt.title = 'gates open below here'; }
    if (rt) { rt.style.left = `${r * 100}%`; rt.title = 'grates drop you below here'; }
  }

  buildNavs() {
    this.navs = {
      'scr-title': new Nav($('titleMenu'), (it) => this.act(it.dataset.act)),
      'scr-route': new Nav($('routeMenu'), (it) => {
        if (it.dataset.act === 'back') return this.back();
        this.hooks.onStart(Number(it.dataset.stage));
      }),
      'scr-settings': new Nav($('settingsBody'),
        (it) => {
          if (it.dataset.act === 'back') return this.back();
          if (it.dataset.act === 'reset') {
            this.store.resetSettings(); this.paintSettings(); this.hooks.onSettingsChange();
          } else this.adjustRow(it, 1);
        },
        (it, d) => this.adjustRow(it, d)),
      'scr-pause': new Nav($('pauseMenu'), (it) => this.act(it.dataset.act)),
      'scr-result': new Nav($('resultMenu'), (it) => this.act(it.dataset.act)),
    };
    // mark the static menus as navigable
    for (const id of ['titleMenu', 'pauseMenu']) {
      $(id).querySelectorAll('li').forEach((li) => { li.dataset.nav = ''; });
    }
    for (const n of Object.values(this.navs)) n.bindMouse();
  }

  adjustRow(row, d) {
    const key = row.dataset.key;
    if (!key) return false;
    const it = ALL_ITEMS.find((x) => x.key === key);
    const max = it.bool ? 1 : it.range !== undefined ? it.range : it.values.length - 1;
    let v = this.store.idx[key] + d;
    v = it.bool ? (v + 2) % 2 : Math.max(0, Math.min(max, v));
    if (v === this.store.idx[key]) return false;
    this.store.idx[key] = v;
    this.store.save();
    this.paintSettings();
    this.hooks.onSettingsChange();
    return true;
  }

  // --------------------------------------------------------------- screens

  show(id, push = true) {
    if (this.screen && push) this.stack.push(this.screen);
    for (const el of document.querySelectorAll('.screen')) el.classList.add('hide');
    if (id) {
      $(id).classList.remove('hide');
      // retrigger the entrance animation
      $(id).style.animation = 'none'; void $(id).offsetHeight; $(id).style.animation = '';
      this.navs[id]?.paint();
    }
    this.screen = id;
    $('foot').classList.toggle('hide', id !== 'scr-title');
    $('hud').classList.toggle('hide', !!id);
    document.body.dataset.screen = id || 'play';
  }

  back() {
    const prev = this.stack.pop() || 'scr-title';
    this.show(prev, false);
  }

  act(a) {
    if (a === 'begin') { this.hooks.onStart(this.firstUnplayed()); return; }
    if (a === 'route') { this.buildRoute(); this.show('scr-route'); return; }
    if (a === 'settings') { this.show('scr-settings'); return; }
    if (a === 'rite') { this.show('scr-rite'); return; }
    if (a === 'resume') { this.hooks.onResume(); return; }
    if (a === 'restart') { this.hooks.onRestart(); return; }
    if (a === 'quit') { this.hooks.onQuit(); return; }
    if (a === 'back') { this.back(); return; }
    if (a === 'next') { this.hooks.onStart(this.nextIndex); return; }
    if (a === 'retry') { this.hooks.onRestart(); return; }
  }

  firstUnplayed() {
    for (let i = 0; i < STAGES.length; i++) if (!this.store.cleared[STAGES[i].id]) return i;
    return 0;
  }

  showPause(stage) {
    $('pauseStage').textContent = stage.name;
    this.navs['scr-pause'].i = 0;
    this.show('scr-pause');
  }

  showResult(res) {
    const { won, reason, stage, time, shell, index, isBest } = res;
    $('resEyebrow').textContent = won ? `Stage ${stage.numeral} · carried` : `Stage ${stage.numeral} · lost`;
    $('resHead').textContent = won ? 'Set down safely'
      : reason === 'woke' ? 'It woke' : 'It fell';

    const stats = $('resStats');
    if (won) {
      stats.innerHTML = `
        <div class="stat"><span class="k">Time</span><span class="v num">${fmtTime(time)}</span>${isBest ? '<span class="n">best</span>' : ''}</div>
        <div class="stat"><span class="k">Shell remaining</span><span class="v num">${Math.round(shell * 100)}%</span></div>`;
    } else {
      stats.innerHTML = `<p class="body">${reason === 'woke'
        ? 'The last of the ice gave way, and what it held did not stay asleep.'
        : 'The ice went over the edge, and down, and did not stop.'}</p>`;
    }

    const line = $('bearerLine');
    if (won) {
      line.innerHTML = `Carried by <b>${bearerName(this.store.bearer)}</b>, bearer ${roman(this.store.bearer)}.`;
    } else {
      const n = this.store.nextBearer();
      this.paintFoot();
      line.innerHTML = `The ice is cut again. <b>${bearerName(n)}</b> takes it up, bearer ${roman(n)}.`;
    }

    const ul = $('resultMenu');
    ul.innerHTML = '';
    const add = (act, idx, label) => {
      const li = document.createElement('li');
      li.dataset.nav = ''; li.dataset.act = act;
      li.innerHTML = `<span class="idx">${idx}</span><span>${label}</span>`;
      ul.appendChild(li);
    };
    this.nextIndex = index + 1;
    let k = 1;
    if (won && this.nextIndex < STAGES.length) add('next', roman(k++).toLowerCase(), `Descend to ${STAGES[this.nextIndex].name}`);
    add('retry', roman(k++).toLowerCase(), won ? 'Carry it again' : 'Take up the ice');
    add('route', roman(k++).toLowerCase(), 'The route');
    add('quit', roman(k++).toLowerCase(), 'Set it down');
    this.navs['scr-result'].i = 0;
    this.stack.length = 0;
    this.show('scr-result', false);
  }

  // ----------------------------------------------------------------- input

  /** @returns true when the key was consumed by a menu. */
  key(e) {
    if (!this.screen) return false;
    const nav = this.navs[this.screen];
    const k = e.key;
    if (k === 'Escape') {
      if (this.screen === 'scr-title') return true;
      if (this.screen === 'scr-pause') { this.hooks.onResume(); return true; }
      this.back(); this.hooks.onNav?.('back'); return true;
    }
    if (!nav) return false;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { if (nav.move(-1)) this.hooks.onNav?.('move'); return true; }
    if (k === 'ArrowDown' || k === 's' || k === 'S') { if (nav.move(1)) this.hooks.onNav?.('move'); return true; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { if (nav.adjust(-1)) this.hooks.onNav?.('move'); return true; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { if (nav.adjust(1)) this.hooks.onNav?.('move'); return true; }
    if (k === 'Enter' || k === ' ') { if (nav.pick()) this.hooks.onNav?.('pick'); return true; }
    return true;   // swallow everything else while a menu is up
  }
}
