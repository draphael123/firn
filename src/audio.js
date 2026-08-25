/* FIRN -- sound, synthesised in WebAudio.
 *
 * No asset pipeline: everything here is oscillators and filtered noise, so the
 * whole game stays a static folder with no binaries to ship or cache-bust.
 *
 * The mix has one job beyond atmosphere. The sleeper has no dialogue and the
 * stages are short, so its stirring has to be audible -- a slow pulse that
 * quickens and sharpens as the shell thins is the only voice it gets.
 */

export class Audio {
  constructor(settings) {
    this.s = settings;
    this.ctx = null;
    this.started = false;
    this.pulseAt = 0;
  }

  /** Browsers require a gesture; call this from the first click or keypress. */
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.s.volMaster / 10;
    this.master.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.s.volSfx / 10;
    this.sfx.connect(this.master);

    this.bed = ctx.createGain();
    this.bed.gain.value = this.s.volMusic / 10;
    this.bed.connect(this.master);

    this.noise = this.makeNoise();

    // --- cold bed: two detuned low sines and a breath of filtered noise
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneGain.connect(this.bed);
    for (const f of [55, 82.5, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = f === 55 ? 0.16 : 0.055;
      o.connect(g); g.connect(this.droneGain); o.start();
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise; wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.05;
    wind.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.bed);
    wind.start();

    // --- melt hiss, driven each frame by the current melt rate
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise; hiss.loop = true;
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass'; hf.frequency.value = 2600;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    hiss.connect(hf); hf.connect(this.hissGain); this.hissGain.connect(this.sfx);
    hiss.start();

    // --- rolling rumble, driven by speed
    const roll = ctx.createBufferSource();
    roll.buffer = this.noise; roll.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 260;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    roll.connect(this.rollFilter); this.rollFilter.connect(this.rollGain);
    this.rollGain.connect(this.sfx);
    roll.start();
  }

  makeNoise() {
    const n = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  applySettings(s) {
    this.s = s;
    if (!this.started) return;
    this.master.gain.value = s.volMaster / 10;
    this.sfx.gain.value = s.volSfx / 10;
    this.bed.gain.value = s.volMusic / 10;
  }

  /** Fade the bed in for play, out for menus. */
  setBed(on) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.cancelScheduledValues(t);
    this.droneGain.gain.linearRampToValueAtTime(on ? 0.5 : 0.16, t + 1.4);
  }

  /** Per frame: rolling, melting, and the sleeper's pulse. */
  update(sim, dt) {
    if (!this.started) return;
    const b = sim.ball;
    const t = this.ctx.currentTime;
    const speed = Math.hypot(b.v.x, b.v.y, b.v.z);

    const rg = b.grounded ? Math.min(0.28, speed * 0.016) : 0;
    this.rollGain.gain.setTargetAtTime(rg, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(180 + speed * 26, t, 0.1);

    this.hissGain.gain.setTargetAtTime(Math.min(0.13, sim.meltLast * 1.1), t, 0.2);

    // The sleeper's pulse: slow and soft at full shell, fast and hard at zero.
    const agit = Math.pow(1 - Math.max(0, b.shell), 1.7);
    if (agit > 0.04) {
      const period = 1.5 - agit * 0.95;
      if (sim.time - this.pulseAt > period) {
        this.pulseAt = sim.time;
        this.thump(48 + agit * 26, 0.05 + agit * 0.16, 0.34);
      }
    }
  }

  thump(freq, gain, dur) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  impact(speed) {
    if (!this.started || speed < 1.2) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const amp = Math.min(0.3, speed * 0.035);
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + speed * 90; f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t); src.stop(t + 0.2);
    this.thump(70, amp * 0.5, 0.16);
  }

  /** Short bright tone. Used for menu movement and confirmation. */
  blip(freq = 780, gain = 0.05, dur = 0.07, type = 'triangle') {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  bare() {   // the moment the shell is gone
    this.blip(190, 0.10, 1.1, 'sawtooth');
    this.thump(38, 0.22, 0.9);
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.07, 0.85, 'sine'), i * 130));
  }

  lose(reason) {
    if (reason === 'woke') { this.thump(30, 0.3, 1.6); this.blip(120, 0.12, 1.4, 'sawtooth'); }
    else { this.blip(220, 0.07, 0.7, 'sine'); this.thump(44, 0.16, 0.8); }
  }
}
