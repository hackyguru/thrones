/**
 * Generative Hindustani music, synthesised live (no recordings):
 *  - tanpura drone (Pa–Sa'–Sa'–Sa) with jawari buzz
 *  - sitar voice built with Karplus–Strong plucked-string synthesis, improvising in Raag Yaman,
 *    gliding between notes (meend)
 *  - tabla playing teental (16 beats) in-game; a free-rhythm alap on the menu
 *  - nagara / dhol war drums that swell with the intensity of battle
 */

// Raag Yaman: S R G M# P D N (all shuddh except tivra Ma). Semitones from Sa.
const YAMAN = [0, 2, 4, 6, 7, 9, 11];
const SA = 138.59; // C#3

type Mode = 'menu' | 'game';

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private verb: ConvolverNode;
  private dry: GainNode;
  private wet: GainNode;
  private sitarBus: GainNode;
  private tablaBus: GainNode;
  private warBus: GainNode;
  private droneBus: GainNode;
  private plucks = new Map<number, AudioBuffer>();
  private tanpuraBufs = new Map<number, AudioBuffer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private mode: Mode = 'menu';
  private intensity = 0;
  private targetIntensity = 0;
  // scheduling state
  private nextBeat = 0;
  private beat = 0;
  private nextNote = 0;
  private nextDrone = 0;
  private droneI = 0;
  private deg = 0; // current melodic position: index into the extended scale
  private lastFreq = 0;
  private phraseLeft = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.6);
    this.dry.connect(this.out);
    this.wet.connect(this.verb).connect(this.out);
    const bus = (g: number) => {
      const b = ctx.createGain();
      b.gain.value = g;
      b.connect(this.dry);
      b.connect(this.wet);
      return b;
    };
    this.sitarBus = bus(0.7);
    this.tablaBus = bus(0.42);
    this.warBus = bus(0);
    this.droneBus = bus(0.22);
  }

  start(mode: Mode) {
    this.mode = mode;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(mode === 'menu' ? 1.3 : 1.0, t, 1.2);
    this.nextBeat = this.nextNote = this.nextDrone = t + 0.15;
    this.beat = 0;
    this.phraseLeft = 0;
    this.deg = 7;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 60);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.6);
    const tm = this.timer;
    this.timer = null;
    setTimeout(() => tm && clearInterval(tm), 2500);
  }

  /** 0 = peace, 1 = pitched battle near the camera */
  setIntensity(x: number) {
    this.targetIntensity = Math.max(0, Math.min(1, x));
  }

  // ---------------------------------------------------------------------------
  private schedule() {
    const c = this.ctx;
    const ahead = c.currentTime + 0.25;
    this.intensity += (this.targetIntensity - this.intensity) * 0.04;
    this.warBus.gain.setTargetAtTime(this.mode === 'game' ? this.intensity * 0.55 : 0, c.currentTime, 0.8);
    this.tablaBus.gain.setTargetAtTime(this.mode === 'game' ? 0.42 * (1 - this.intensity * 0.35) : 0, c.currentTime, 0.8);
    const bpm = 76 + this.intensity * 34;
    const beatLen = 60 / bpm;

    while (this.nextDrone < ahead) {
      this.tanpura(this.nextDrone, [SA * 1.5 / 2, SA, SA, SA / 2][this.droneI++ % 4]);
      this.nextDrone += this.mode === 'menu' ? 1.25 : 1.1;
    }
    if (this.mode === 'game') {
      while (this.nextBeat < ahead) {
        this.tablaBeat(this.nextBeat, this.beat % 16, beatLen);
        if (this.intensity > 0.08) this.warBeat(this.nextBeat, this.beat % 8, beatLen);
        this.beat++;
        this.nextBeat += beatLen;
      }
    }
    while (this.nextNote < ahead) this.nextNote += this.melody(this.nextNote, beatLen);
  }

  // ---------------------------------------------------------------------------
  // melody: a random walk over Yaman with phrase shapes, resting on Sa / Pa / Ga / Ni
  private freqOf(d: number) {
    const oct = Math.floor(d / 7);
    const st = YAMAN[((d % 7) + 7) % 7] + oct * 12;
    return SA * 2 * Math.pow(2, st / 12); // sitar plays an octave above the drone
  }

  private melody(t: number, beatLen: number): number {
    const menu = this.mode === 'menu';
    if (this.phraseLeft <= 0) {
      // breathe between phrases
      this.phraseLeft = 3 + Math.floor(Math.random() * (menu ? 4 : 7));
      return menu ? 1.2 + Math.random() * 1.8 : beatLen * (1 + Math.floor(Math.random() * 3));
    }
    this.phraseLeft--;
    // step mostly by one scale degree; Yaman phrases favour N R G and avoid starting on Sa when rising
    const r = Math.random();
    let step = r < 0.42 ? 1 : r < 0.84 ? -1 : r < 0.92 ? 2 : -2;
    if (this.deg > 13) step = -Math.abs(step);
    if (this.deg < 2) step = Math.abs(step);
    this.deg += step;
    const resting = this.phraseLeft === 0;
    if (resting) {
      // end the phrase on a stable note
      const stable = [0, 2, 4, 6, 7, 9, 11, 14].map((x) => x);
      this.deg = stable.reduce((b, x) => (Math.abs(x - this.deg) < Math.abs(b - this.deg) ? x : b), stable[0]);
    }
    const f = this.freqOf(this.deg);
    const dur = menu ? (resting ? 2.4 : 0.55 + Math.random() * 0.9) : resting ? beatLen * 2 : beatLen * (Math.random() < 0.6 ? 0.5 : Math.random() < 0.5 ? 1 : 0.25);
    const glide = menu ? Math.random() < 0.55 : Math.random() < 0.22;
    this.sitar(t, f, glide && this.lastFreq ? this.lastFreq : 0, resting ? 0.3 : 0.24, Math.max(dur, 0.4) + 1.2);
    if (resting && Math.random() < 0.5) this.sitar(t + dur * 0.5, f * 2, 0, 0.06, 1.2); // chikari shimmer
    this.lastFreq = f;
    return dur;
  }

  // ---------------------------------------------------------------------------
  // instruments
  private pluck(freq: number, seconds: number, decay: number, bright: number): AudioBuffer {
    const key = Math.round(freq * 10) * 1000 + Math.round(decay * 1000) + bright;
    const hit = this.plucks.get(key);
    if (hit) return hit;
    const rate = this.ctx.sampleRate;
    const n = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(1, n, rate);
    const y = buf.getChannelData(0);
    // the two-point averaging filter adds half a sample of delay
    const N = Math.max(2, Math.round(rate / freq - 0.5));
    // excitation: filtered noise burst (pluck position / brightness)
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * bright * 0.1;
      y[i] = lp;
    }
    for (let i = N; i < n; i++) y[i] = decay * 0.5 * (y[i - N] + (i - N - 1 >= 0 ? y[i - N - 1] : 0));
    // jawari: the bridge's buzz — gentle asymmetric saturation adds the sitar's bright, nasal edge
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = y[i];
      y[i] = Math.tanh(v * 2.2) + 0.25 * v * Math.abs(v);
      peak = Math.max(peak, Math.abs(y[i]));
    }
    for (let i = 0; i < n; i++) y[i] /= peak || 1;
    this.plucks.set(key, buf);
    return buf;
  }

  private sitar(t: number, freq: number, from: number, vol: number, len: number) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.pluck(freq, 3.2, 0.9985, 8);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + len * 0.6, len * 0.25);
    if (from) {
      // meend: start on the previous note and slide into this one
      src.playbackRate.setValueAtTime(from / freq, t);
      src.playbackRate.setTargetAtTime(1, t + 0.04, 0.07);
    }
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    src.connect(hp).connect(g).connect(this.sitarBus);
    src.start(t);
    src.stop(t + len + 0.5);
  }

  private tanpura(t: number, freq: number) {
    const c = this.ctx;
    let buf = this.tanpuraBufs.get(freq);
    if (!buf) {
      buf = this.pluck(freq, 4.2, 0.9995, 4);
      this.tanpuraBufs.set(freq, buf);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.002;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.setTargetAtTime(0, t + 2.6, 0.6);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    src.connect(lp).connect(g).connect(this.droneBus);
    src.start(t);
    src.stop(t + 4.2);
  }

  /** dayan (treble drum): a tuned ring with a sharp attack */
  private dayan(t: number, open: boolean, vol: number) {
    const c = this.ctx;
    const f = SA * 2;
    for (const [mult, v] of [[1, 1], [2.02, 0.5], [2.93, 0.32], [4.1, 0.18]] as const) {
      const o = c.createOscillator();
      o.frequency.value = f * mult;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v * 0.3, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.55 : 0.12) / mult ** 0.5);
      o.connect(g).connect(this.tablaBus);
      o.start(t);
      o.stop(t + 0.7);
    }
    this.click(t, vol * 0.25, 3500);
  }

  /** bayan (bass drum): a boomy stroke whose pitch rises as the palm presses the skin */
  private bayan(t: number, vol: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(72, t);
    o.frequency.linearRampToValueAtTime(96, t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(this.tablaBus);
    o.start(t);
    o.stop(t + 0.75);
  }

  private click(t: number, vol: number, freq: number, bus: AudioNode = this.tablaBus) {
    const c = this.ctx;
    const n = c.createBufferSource();
    const len = Math.floor(c.sampleRate * 0.03);
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    n.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    n.connect(f).connect(g).connect(bus);
    n.start(t);
  }

  /** teental: dha dhin dhin dha | dha dhin dhin dha | dha tin tin ta | ta dhin dhin dha */
  private tablaBeat(t: number, b: number, beatLen: number) {
    const bols = ['dha', 'dhin', 'dhin', 'dha', 'dha', 'dhin', 'dhin', 'dha', 'dha', 'tin', 'tin', 'ta', 'ta', 'dhin', 'dhin', 'dha'];
    const bol = bols[b];
    const sam = b === 0 ? 1.25 : 1;
    const bass = bol === 'dha' || bol === 'dhin';
    if (bass && b !== 9 && b !== 10) this.bayan(t, 0.5 * sam);
    this.dayan(t, bol === 'dha' || bol === 'ta', (bol === 'tin' || bol === 'dhin' ? 0.65 : 0.85) * sam);
    // filler strokes between beats
    if (Math.random() < 0.35) this.dayan(t + beatLen * 0.5, false, 0.3);
  }

  /** nagara / dhol: battle drums */
  private warBeat(t: number, b: number, beatLen: number) {
    const c = this.ctx;
    const hit = (when: number, f: number, vol: number, len: number) => {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f * 1.6, when);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.06);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      o.connect(g).connect(this.warBus);
      o.start(when);
      o.stop(when + len + 0.05);
      this.click(when, vol * 0.5, 900, this.warBus);
    };
    if (b % 2 === 0) hit(t, 58, 0.9, 0.6);
    if (b === 3 || b === 7) hit(t + beatLen * 0.5, 64, 0.6, 0.4);
    if (this.intensity > 0.5) hit(t + beatLen * 0.75, 120, 0.35, 0.18);
  }

  private impulse(seconds: number) {
    const c = this.ctx;
    const n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return b;
  }
}
