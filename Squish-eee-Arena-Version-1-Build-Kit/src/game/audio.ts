/**
 * SQUISH-EEE ARENA — procedural silly-sound engine.
 * Everything is synthesized with WebAudio; no asset files needed.
 */

export class SFX {
  ctx: AudioContext;
  master: GainNode;
  noiseBuf: AudioBuffer;
  enabled = true;

  constructor() {
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() {
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  get t() {
    return this.ctx.currentTime;
  }

  setVolume(v: number) {
    this.master.gain.value = v;
  }

  /** gain node with a distance-based attenuation applied once (cheap 3d) */
  private out(vol = 1, dist = 0) {
    const g = this.ctx.createGain();
    const att = dist <= 0 ? 1 : Math.max(0, 1 - dist / 70) ** 1.6;
    g.gain.value = vol * att;
    g.connect(this.master);
    return { node: g, audible: att > 0.02 };
  }

  private noise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  }

  // ---------------------------------------------------------------- FART
  fart(dur = 0.45, pitch = 1, vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol * 0.9, dist);
    if (!audible) return;
    const t = this.t;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const base = 80 * pitch;
    osc.frequency.setValueAtTime(base * 1.5, t);
    // wobbly random blurbles
    const steps = Math.max(4, Math.floor(dur * 26));
    for (let i = 1; i <= steps; i++) {
      const f = base * (0.55 + Math.random() * 1.1) * (1 - (i / steps) * 0.35);
      osc.frequency.exponentialRampToValueAtTime(Math.max(28, f), t + (dur * i) / steps);
    }
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900 * pitch, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    lp.Q.value = 6;

    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.02);
    env.gain.setValueAtTime(0.8, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // a little airy hiss
    const n = this.noise();
    const nf = this.ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 450 * pitch;
    nf.Q.value = 1.2;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(shaper).connect(lp).connect(env).connect(node);
    n.connect(nf).connect(ng).connect(node);
    osc.start(t);
    n.start(t);
    osc.stop(t + dur + 0.05);
    n.stop(t + dur + 0.05);
  }

  /** A sustained fart loop used by the chaingun while held down. */
  fartLoop() {
    const t = this.t;
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 95;
    const lfo = this.ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 17;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 42;
    lfo.connect(lfoGain).connect(osc.frequency);
    const lfo2 = this.ctx.createOscillator();
    lfo2.type = "sine";
    lfo2.frequency.value = 3.3;
    const lfo2g = this.ctx.createGain();
    lfo2g.gain.value = 28;
    lfo2.connect(lfo2g).connect(osc.frequency);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 780;
    lp.Q.value = 7;
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 4);
    shaper.curve = curve;
    osc.connect(shaper).connect(lp).connect(g);
    osc.start(t);
    lfo.start(t);
    lfo2.start(t);
    let rampedOn = false;
    return {
      on: () => {
        if (rampedOn) return;
        rampedOn = true;
        g.gain.cancelScheduledValues(this.t);
        g.gain.setTargetAtTime(0.5, this.t, 0.02);
      },
      off: () => {
        if (!rampedOn) return;
        rampedOn = false;
        g.gain.cancelScheduledValues(this.t);
        g.gain.setTargetAtTime(0.0001, this.t, 0.05);
      },
      pitch: (p: number) => {
        osc.frequency.setTargetAtTime(95 * p, this.t, 0.05);
      },
      dispose: () => {
        try {
          osc.stop();
          lfo.stop();
          lfo2.stop();
        } catch {
          /* noop */
        }
      },
    };
  }

  // -------------------------------------------------------------- SQUEAK
  squeak(pitch = 1, vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol * 0.5, dist);
    if (!audible) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    const f0 = (700 + Math.random() * 500) * pitch;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 0.055);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + 0.16);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1600;
    bp.Q.value = 2.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.85, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(bp).connect(g).connect(node);
    o.start(t);
    o.stop(t + 0.2);
  }

  // ---------------------------------------------------------- BABY "PEEW"
  babyPew(vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol, dist);
    if (!audible) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.42);
    // vowel formants: ee -> oo
    const f1 = this.ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.Q.value = 7;
    f1.frequency.setValueAtTime(420, t);
    f1.frequency.exponentialRampToValueAtTime(320, t + 0.4);
    const f2 = this.ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.Q.value = 9;
    f2.frequency.setValueAtTime(2600, t);
    f2.frequency.exponentialRampToValueAtTime(820, t + 0.4);
    const mix = this.ctx.createGain();
    mix.gain.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.95, t + 0.03);
    g.gain.setValueAtTime(0.8, t + 0.26);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    o.connect(f1).connect(mix);
    o.connect(f2).connect(mix);
    mix.connect(g).connect(node);
    o.start(t);
    o.stop(t + 0.5);
  }

  // ------------------------------------------------------------- WHISTLE
  /** Looping whistle used for foam rockets in flight. */
  whistle(dist = 0) {
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 1500;
    const vib = this.ctx.createOscillator();
    vib.type = "sine";
    vib.frequency.value = 6;
    const vg = this.ctx.createGain();
    vg.gain.value = 70;
    vib.connect(vg).connect(o.frequency);
    const air = this.noise();
    const af = this.ctx.createBiquadFilter();
    af.type = "bandpass";
    af.frequency.value = 2400;
    af.Q.value = 8;
    const ag = this.ctx.createGain();
    ag.gain.value = 0.12;
    o.connect(g);
    air.connect(af).connect(ag).connect(g);
    o.start(t);
    vib.start(t);
    air.start(t);
    g.gain.setTargetAtTime(0.16 * Math.max(0, 1 - dist / 60), t, 0.03);
    return {
      update: (d: number, speedPitch: number) => {
        g.gain.setTargetAtTime(0.16 * Math.max(0, 1 - d / 60) ** 1.5, this.t, 0.08);
        o.frequency.setTargetAtTime(1500 * speedPitch, this.t, 0.1);
      },
      stop: () => {
        const tt = this.t;
        g.gain.setTargetAtTime(0.0001, tt, 0.04);
        try {
          o.stop(tt + 0.3);
          vib.stop(tt + 0.3);
          air.stop(tt + 0.3);
        } catch {
          /* noop */
        }
      },
    };
  }

  // --------------------------------------------------------- WATER STREAM
  waterStream() {
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);
    const n = this.noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 1.1;
    const lfo = this.ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 9;
    const lg = this.ctx.createGain();
    lg.gain.value = 700;
    lfo.connect(lg).connect(bp.frequency);
    n.connect(bp).connect(g);
    n.start();
    lfo.start();
    let on = false;
    return {
      on: () => {
        if (on) return;
        on = true;
        g.gain.setTargetAtTime(0.3, this.t, 0.02);
      },
      off: () => {
        if (!on) return;
        on = false;
        g.gain.setTargetAtTime(0.0001, this.t, 0.06);
      },
    };
  }

  // ------------------------------------------------------------- GIGGLE!
  giggle(pitch = 1, vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol, dist);
    if (!audible) return;
    const t0 = this.t;
    const n = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.105 + Math.random() * 0.03);
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      const base = (430 + Math.random() * 190) * pitch * (1 - i * 0.025);
      o.frequency.setValueAtTime(base * 0.8, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.035);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.09);
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1100 + Math.random() * 500;
      f.Q.value = 4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(f).connect(g).connect(node);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  // ---------------------------------------------------------- SILLY BLIPS
  blip(pitch = 1, vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol * 0.5, dist);
    if (!audible) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = Math.random() < 0.5 ? "square" : "triangle";
    const f = (500 + Math.random() * 700) * pitch;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 2 : 0.55), t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(node);
    o.start(t);
    o.stop(t + 0.17);
  }

  boing(pitch = 1, vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol * 0.7, dist);
    if (!audible) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(700 * pitch, t);
    for (let i = 0; i < 7; i++) {
      o.frequency.exponentialRampToValueAtTime(
        (240 + 220 * Math.exp(-i * 0.5) * (i % 2 ? -0.4 : 1)) * pitch + 60,
        t + 0.05 + i * 0.045,
      );
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(node);
    o.start(t);
    o.stop(t + 0.5);
  }

  splash(vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol, dist);
    if (!audible) return;
    const t = this.t;
    const n = this.noise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + 0.25);
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(bp).connect(g).connect(node);
    n.start(t);
    n.stop(t + 0.45);
    this.blip(0.6, 0.4, dist);
  }

  pop(pitch = 1, vol = 1, dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(vol, dist);
    if (!audible) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(900 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(90 * pitch, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(node);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Cutesified quad-damage firing sound: a baby "boo-WEE" layered over the shot. */
  quadFire(dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(0.55, dist);
    if (!audible) return;
    const t = this.t;
    [1, 1.5].forEach((m, idx) => {
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(260 * m, t);
      o.frequency.exponentialRampToValueAtTime(620 * m, t + 0.14);
      o.frequency.exponentialRampToValueAtTime(420 * m, t + 0.3);
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2200;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.35 / (idx + 1), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(f).connect(g).connect(node);
      o.start(t);
      o.stop(t + 0.36);
    });
  }

  /** little ascending jingle */
  jingle(up = true, vol = 0.8) {
    if (!this.enabled) return;
    const { node } = this.out(vol, 0);
    const notes = up ? [523, 659, 784, 1047] : [784, 659, 523, 392];
    notes.forEach((f, i) => {
      const t = this.t + i * 0.09;
      const o = this.ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(node);
      o.start(t);
      o.stop(t + 0.25);
    });
  }

  /** deep-ish silly voice announcement substitute */
  announce(kind: "capture" | "taken" | "returned" | "quad" | "win" | "lose") {
    if (!this.enabled) return;
    switch (kind) {
      case "capture":
        this.jingle(true, 1);
        setTimeout(() => this.giggle(1.2, 0.9), 200);
        break;
      case "taken":
        this.blip(1.6, 0.9);
        setTimeout(() => this.blip(2.0, 0.9), 110);
        break;
      case "returned":
        this.boing(1.3, 0.8);
        break;
      case "quad":
        this.quadFire(0);
        setTimeout(() => this.giggle(1.5, 0.6), 120);
        break;
      case "win":
        this.jingle(true, 1);
        setTimeout(() => this.jingle(true, 1), 380);
        setTimeout(() => this.giggle(1.1, 1), 700);
        break;
      case "lose":
        this.jingle(false, 0.9);
        setTimeout(() => this.fart(0.8, 0.7, 0.9), 350);
        break;
    }
  }

  // -------------------------------------------------------- WARM MILK SOUND
  milkGlug() {
    if (!this.enabled) return;
    const { node } = this.out(0.85, 0);
    const t0 = this.t;
    // glug-glug-glug bottle bubbles
    for (let i = 0; i < 4; i++) {
      const t = t0 + i * 0.12;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      const base = 320 + i * 45;
      o.frequency.setValueAtTime(base * 0.7, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.08);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.7, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(node);
      o.start(t);
      o.stop(t + 0.12);
    }
    // soothing healing sparkle chords
    const chords = [523, 659, 784, 1046, 1318];
    chords.forEach((freq, idx) => {
      const t = t0 + 0.28 + idx * 0.08;
      const o = this.ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(freq, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(node);
      o.start(t);
      o.stop(t + 0.5);
    });
  }

  // ---------------------------------------------------- PUNCH SPRING THWACK
  punchWham(dist = 0) {
    if (!this.enabled) return;
    const { node, audible } = this.out(0.9, dist);
    if (!audible) return;
    const t = this.t;
    // spring boing
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(450, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.35);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(800, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(f).connect(g).connect(node);
    o.start(t);
    o.stop(t + 0.4);
    // punch thwack smack
    this.pop(1.6, 0.75, dist);
    setTimeout(() => this.squeak(1.5, 0.6, dist), 60);
  }

  // -------------------------------------------------- BABY VOICE ANNOUNCER
  /**
   * Speaks a phrase in a squeaky baby voice using formant synthesis.
   * No speech API — the timbre is identical in every browser, and it can never
   * be blocked or rate-limited by the OS.
   */
  speak(text: string) {
    if (!this.enabled) return;
    const key = normalizePhrase(text);
    let tokens = LEXICON[key];
    if (!tokens) {
      if (key.startsWith("warm milk")) tokens = LEXICON["warm milk team healed"];
      else if (key.startsWith("unstoppable")) tokens = LEXICON["unstoppable giggles"];
      else if (key.startsWith("one capture")) tokens = LEXICON["one capture left match point"];
      else tokens = LEXICON["???"];
    }
    this.blip(1.7, 0.3);
    this.renderVoice(tokens, text.indexOf("!") >= 0);
  }

  private renderVoice(tokens: string[], excited: boolean) {
    const ctx = this.ctx;
    // A baby's vocal tract is much shorter, so every formant shifts up.
    const FS = 1.36;
    const baseF0 = excited ? 470 : 435;

    interface Seg {
      v: number;
      n: number;
      f1: number;
      f2: number;
      f3: number;
      nf: number;
      nb: number;
      d: number;
      f0: number;
    }
    const segs: Seg[] = [];
    let lastVoiced = -1;

    const count = tokens.length;
    tokens.forEach((tok, i) => {
      const stressed = tok.charCodeAt(0) === 39; // leading apostrophe
      const p = PHON[stressed ? tok.slice(1) : tok];
      if (!p) return;
      const d = p.d * (stressed ? 1.22 : 1);
      const f0 = baseF0 * (stressed ? 1.09 : 1) * (1 - (i / count) * 0.13);
      const amp = p.a ?? 1;
      const vowel = (f1: number, f2: number, f3: number, dur: number, pitch: number, a = amp) => {
        segs.push({ v: a, n: 0, f1: f1 * FS, f2: f2 * FS, f3: f3 * FS, nf: 2000, nb: 1200, d: dur, f0: pitch });
        lastVoiced = segs.length - 1;
      };

      switch (p.k) {
        case "v":
          vowel(p.f1!, p.f2!, p.f3!, d, f0);
          // diphthong: glide into the target vowel
          if (p.t1 !== undefined) vowel(p.t1, p.t2!, p.t3!, d * 0.7, f0 * 1.05);
          break;
        case "n":
          segs.push({ v: 0, n: amp, f1: 600 * FS, f2: 1500 * FS, f3: 2500 * FS, nf: p.nf!, nb: p.nb!, d, f0 });
          break;
        case "vn":
          segs.push({
            v: amp * 0.7,
            n: amp * 0.8,
            f1: p.f1! * FS,
            f2: p.f2! * FS,
            f3: p.f3! * FS,
            nf: p.nf!,
            nb: p.nb!,
            d,
            f0,
          });
          lastVoiced = segs.length - 1;
          break;
        case "p":
        case "vp": {
          const voicedClosure = p.k === "vp" ? 0.22 : 0;
          if (voicedClosure > 0) {
            segs.push({
              v: voicedClosure,
              n: 0,
              f1: 260 * FS,
              f2: 900 * FS,
              f3: 2200 * FS,
              nf: 1200,
              nb: 900,
              d: d * 0.55,
              f0: f0 * 0.96,
            });
            lastVoiced = segs.length - 1;
          } else {
            segs.push({ v: 0, n: 0, f1: 600 * FS, f2: 1500 * FS, f3: 2500 * FS, nf: 1500, nb: 900, d: d * 0.6, f0 });
          }
          // the burst
          segs.push({
            v: voicedClosure > 0 ? 0.14 : 0,
            n: 0.55,
            f1: 600 * FS,
            f2: 1500 * FS,
            f3: 2500 * FS,
            nf: p.nf!,
            nb: p.nb!,
            d: 0.019,
            f0,
          });
          break;
        }
      }
    });

    if (!segs.length) return;

    // excited squeak: last voiced syllable bends upward and hangs on
    if (excited && lastVoiced >= 0) {
      const s = segs[lastVoiced];
      s.f0 *= 1.17;
      s.d *= 1.2;
    }

    // ------------------------------------------------------------ the voice
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const vib = ctx.createOscillator();
    vib.type = "sine";
    vib.frequency.value = 6.4;
    const vibG = ctx.createGain();
    vibG.gain.value = baseF0 * 0.014; // squeaky wobble
    vib.connect(vibG);
    vibG.connect(osc.frequency);

    const srcG = ctx.createGain();
    srcG.gain.value = 0.0001;

    const formant = (q: number, gain: number) => {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      srcG.connect(f);
      f.connect(g);
      return { f, g };
    };
    const F1 = formant(7, 1);
    const F2 = formant(10, 0.62);
    const F3 = formant(13, 0.3);

    const nz = ctx.createBufferSource();
    nz.buffer = this.noiseBuf;
    nz.loop = true;
    const nzF = ctx.createBiquadFilter();
    nzF.type = "bandpass";
    nzF.Q.value = 0.9;
    const nzG = ctx.createGain();
    nzG.gain.value = 0.0001;
    nz.connect(nzF);
    nzF.connect(nzG);

    const mix = ctx.createGain();
    mix.gain.value = 0.9;
    F1.g.connect(mix);
    F2.g.connect(mix);
    F3.g.connect(mix);
    nzG.connect(mix);

    const tilt = ctx.createBiquadFilter();
    tilt.type = "highshelf";
    tilt.frequency.value = 1600;
    tilt.gain.value = 5; // extra toy-phone squeak
    const outG = ctx.createGain();
    outG.gain.value = 0.5;
    mix.connect(tilt);
    tilt.connect(outG);
    outG.connect(this.master);

    // ----------------------------------------------------------- schedule
    let t = this.t + 0.04;
    osc.frequency.setValueAtTime(segs[0].f0, t);
    srcG.gain.setValueAtTime(0.0001, t);
    nzG.gain.setValueAtTime(0.0001, t);
    nzF.frequency.setValueAtTime(segs[0].nf, t);

    for (const s of segs) {
      const st = t;
      const en = t + s.d;
      if (s.v > 0) srcG.gain.linearRampToValueAtTime(0.42 * s.v, st + 0.02);
      else srcG.gain.linearRampToValueAtTime(0.0001, st + 0.016);
      // formants and pitch glide — this is what makes it sound like words
      F1.f.frequency.linearRampToValueAtTime(s.f1, st + s.d * 0.6);
      F2.f.frequency.linearRampToValueAtTime(s.f2, st + s.d * 0.6);
      F3.f.frequency.linearRampToValueAtTime(s.f3, st + s.d * 0.6);
      osc.frequency.linearRampToValueAtTime(s.f0, st + s.d * 0.75);
      nzF.frequency.linearRampToValueAtTime(s.nf, st + 0.012);
      if (s.n > 0) {
        nzG.gain.linearRampToValueAtTime(0.3 * s.n, st + 0.014);
        nzG.gain.linearRampToValueAtTime(0.0001, en);
      } else {
        nzG.gain.linearRampToValueAtTime(0.0001, st + 0.014);
      }
      t = en;
    }
    srcG.gain.linearRampToValueAtTime(0.0001, t + 0.05);
    nzG.gain.linearRampToValueAtTime(0.0001, t + 0.05);

    const stop = t + 0.12;
    osc.start(this.t);
    vib.start(this.t);
    nz.start(this.t);
    osc.stop(stop);
    vib.stop(stop);
    nz.stop(stop);
  }
}

// ==========================================================================
//  SQUEAKY BABY VOICE — a tiny formant speech synthesizer.
//  A glottal sawtooth (very high f0) drives three parallel band-pass formant
//  filters whose frequencies are scaled up to imitate a baby's short vocal
//  tract. Fricatives and stop bursts come from a noise source. Formant and
//  pitch values glide between segments, which is what makes words intelligible.
// ==========================================================================

type PhonKind = "v" | "n" | "vn" | "p" | "vp";

interface Phon {
  k: PhonKind;
  /** vowel / voiced formants */
  f1?: number;
  f2?: number;
  f3?: number;
  /** diphthong glide target */
  t1?: number;
  t2?: number;
  t3?: number;
  /** noise centre frequency / bandwidth */
  nf?: number;
  nb?: number;
  /** base duration in seconds */
  d: number;
  /** amplitude scale */
  a?: number;
}

const PHON: Record<string, Phon> = {
  // ---- vowels
  iy: { k: "v", f1: 270, f2: 2290, f3: 3010, d: 0.115 },
  ih: { k: "v", f1: 390, f2: 1990, f3: 2550, d: 0.09 },
  eh: { k: "v", f1: 530, f2: 1840, f3: 2480, d: 0.1 },
  ae: { k: "v", f1: 660, f2: 1720, f3: 2410, d: 0.12 },
  aa: { k: "v", f1: 730, f2: 1090, f3: 2440, d: 0.12 },
  ao: { k: "v", f1: 570, f2: 840, f3: 2410, d: 0.12 },
  uh: { k: "v", f1: 440, f2: 1020, f3: 2240, d: 0.09 },
  uw: { k: "v", f1: 300, f2: 870, f3: 2240, d: 0.11 },
  ah: { k: "v", f1: 520, f2: 1480, f3: 2500, d: 0.08 },
  er: { k: "v", f1: 490, f2: 1350, f3: 1690, d: 0.12 },
  // ---- diphthongs (glide to the target formants)
  ey: { k: "v", f1: 530, f2: 1840, f3: 2480, t1: 300, t2: 2290, t3: 3010, d: 0.16 },
  ay: { k: "v", f1: 730, f2: 1090, f3: 2440, t1: 300, t2: 2290, t3: 3010, d: 0.18 },
  ow: { k: "v", f1: 570, f2: 840, f3: 2410, t1: 320, t2: 800, t3: 2200, d: 0.16 },
  oy: { k: "v", f1: 570, f2: 840, f3: 2410, t1: 300, t2: 2290, t3: 3010, d: 0.18 },
  // ---- nasals & approximants
  m: { k: "v", f1: 280, f2: 900, f3: 2200, d: 0.075, a: 0.62 },
  n: { k: "v", f1: 280, f2: 1700, f3: 2600, d: 0.07, a: 0.62 },
  ng: { k: "v", f1: 280, f2: 2300, f3: 2750, d: 0.08, a: 0.62 },
  l: { k: "v", f1: 380, f2: 880, f3: 2575, d: 0.07, a: 0.8 },
  r: { k: "v", f1: 410, f2: 1300, f3: 1600, d: 0.07, a: 0.8 },
  w: { k: "v", f1: 300, f2: 610, f3: 2200, d: 0.065, a: 0.8 },
  y: { k: "v", f1: 300, f2: 2200, f3: 3000, d: 0.06, a: 0.8 },
  // ---- fricatives
  s: { k: "n", nf: 6800, nb: 2400, d: 0.105 },
  z: { k: "vn", f1: 350, f2: 1600, f3: 2600, nf: 6800, nb: 2400, d: 0.09, a: 0.55 },
  sh: { k: "n", nf: 3100, nb: 1700, d: 0.1, a: 0.9 },
  zh: { k: "vn", f1: 350, f2: 1600, f3: 2400, nf: 3100, nb: 1700, d: 0.08, a: 0.5 },
  f: { k: "n", nf: 4800, nb: 3200, d: 0.085, a: 0.55 },
  v: { k: "vn", f1: 350, f2: 1200, f3: 2300, nf: 4800, nb: 3200, d: 0.07, a: 0.42 },
  th: { k: "n", nf: 5600, nb: 2800, d: 0.08, a: 0.4 },
  dh: { k: "vn", f1: 350, f2: 1300, f3: 2400, nf: 5600, nb: 2800, d: 0.05, a: 0.36 },
  h: { k: "n", nf: 1500, nb: 1300, d: 0.06, a: 0.3 },
  // ---- stops (closure + burst)
  p: { k: "p", nf: 900, nb: 900, d: 0.055 },
  b: { k: "vp", nf: 900, nb: 900, d: 0.05 },
  t: { k: "p", nf: 4200, nb: 2600, d: 0.05 },
  d: { k: "vp", nf: 4200, nb: 2600, d: 0.045 },
  k: { k: "p", nf: 2200, nb: 1400, d: 0.06 },
  g: { k: "vp", nf: 2000, nb: 1300, d: 0.05 },
};

/** Hand-written pronunciations for every announcer line. "'" marks a stressed syllable. */
const LEXICON: Record<string, string[]> = {
  "they have your flag": ["dh", "ey", "hh", "ae", "v", "y", "ao", "r", "f", "l", "ae", "'g"],
  "you have their flag": ["y", "uw", "hh", "ae", "v", "dh", "eh", "r", "f", "l", "ae", "'g"],
  "flag returned": ["f", "l", "ae", "g", "r", "ih", "t", "er", "'n", "d"],
  "three captures left": ["th", "r", "iy", "k", "ae", "p", "t", "sh", "er", "z", "l", "eh", "f", "t"],
  "two captures left": ["t", "uw", "k", "ae", "p", "t", "sh", "er", "z", "l", "eh", "f", "t"],
  "one capture left match point": [
    "w", "ah", "n", "k", "ae", "p", "t", "sh", "er", "l", "eh", "f", "t",
    "m", "ae", "t", "sh", "p", "oy", "n", "t",
  ],
  "double giggle": ["d", "ah", "b", "ah", "l", "g", "ih", "g", "ah", "'l"],
  "giggling spree": ["g", "ih", "g", "ah", "l", "ih", "ng", "s", "p", "r", "iy"],
  "giggle fit": ["g", "ih", "g", "ah", "l", "f", "ih", "t"],
  "unstoppable giggles": [
    "ah", "n", "s", "t", "aa", "p", "ah", "b", "ah", "l", "g", "ih", "g", "ah", "l", "z",
  ],
  "warm milk team healed": ["w", "ao", "r", "m", "m", "ih", "l", "k", "t", "iy", "m", "h", "iy", "l", "d"],
  "quad giggle": ["k", "w", "aa", "d", "g", "ih", "g", "ah", "l"],
  "you win": ["y", "uw", "w", "ih", "n"],
  "you lose": ["y", "uw", "l", "uw", "z"],
  // fallback: a happy squeaky babble
  "???": ["b", "ah", "b", "ah", "b", "ah", "'b", "ah"],
};

function normalizePhrase(s: string) {
  return s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

let _sfx: SFX | null = null;
export function getSFX(): SFX {
  if (!_sfx) _sfx = new SFX();
  return _sfx;
}
