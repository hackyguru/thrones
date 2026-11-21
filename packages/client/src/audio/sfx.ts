import { Music } from './music';

type Group = 'melee' | 'swing' | 'unsheathe' | 'chop' | 'mine' | 'build' | 'ui' | 'coins' | 'cloth' | 'collapse' | 'drop';

/**
 * Sound: CC0 recordings (OpenGameArt, see ASSETS.md) for combat, work and UI, placed in stereo
 * around the camera, plus synthesised accents and generative Hindustani music (music.ts).
 */
class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private last = new Map<string, number>();
  private music: Music | null = null;
  private musicMode: 'menu' | 'game' | null = null;
  private samples = new Map<Group, AudioBuffer[]>();
  /** world position -> { gain 0..1, pan -1..1 } relative to the camera (set by the game) */
  listener: ((x: number, y: number) => { gain: number; pan: number }) | null = null;
  private battle = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem('thrones.muted') === '1';
    } catch {
      /* ignore */
    }
  }

  /** must be called from a user gesture */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.music = new Music(this.ctx, this.master);
    if (this.musicMode) this.music.start(this.musicMode);
    void this.loadSamples();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('thrones.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  private async loadSamples() {
    const c = this.ctx!;
    const base = `${import.meta.env.BASE_URL}assets/audio/`;
    try {
      const list = (await (await fetch(base + 'sounds.json')).json()) as Record<Group, string[]>;
      await Promise.all(
        Object.entries(list).map(async ([g, files]) => {
          const bufs = await Promise.all(files.map(async (f) => c.decodeAudioData(await (await fetch(base + f)).arrayBuffer())));
          this.samples.set(g as Group, bufs);
        }),
      );
    } catch (err) {
      console.warn('sound samples unavailable', err);
    }
  }

  /** play a recorded sound; with a world position it is attenuated and panned around the camera */
  play(g: Group, opts: { x?: number; y?: number; vol?: number; rate?: number; throttle?: number } = {}) {
    const c = this.ctx, bus = this.sfxBus;
    const list = this.samples.get(g);
    if (!c || !bus || !list?.length) return false;
    if (opts.throttle && !this.throttle('s:' + g, opts.throttle)) return true;
    let vol = opts.vol ?? 0.6;
    let pan = 0;
    if (opts.x !== undefined && this.listener) {
      const l = this.listener(opts.x, opts.y!);
      if (l.gain < 0.03) return true;
      vol *= l.gain;
      pan = l.pan;
    }
    const src = c.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = (opts.rate ?? 1) * (0.92 + Math.random() * 0.16);
    const g2 = c.createGain();
    g2.gain.value = vol;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    src.connect(g2).connect(p).connect(bus);
    src.start();
    return true;
  }

  /** combat near the camera raises the music's battle drums */
  noteBattle(amount = 0.08) {
    this.battle = Math.min(1, this.battle + amount);
  }

  update(dt: number) {
    this.battle = Math.max(0, this.battle - dt * 0.06);
    this.music?.setIntensity(this.battle);
  }

  /** 'menu': alap over the tanpura; 'game': sitar with tabla, war drums in battle */
  startMusic(mode: 'menu' | 'game') {
    this.musicMode = mode;
    this.battle = 0;
    this.music?.start(mode);
  }

  /** a work stroke (axe, pick, hammer) at a world position */
  work(kind: 'chop' | 'mine' | 'build' | 'hoe', x: number, y: number) {
    // a hoe biting soil: the dull knock of the build sample, pitched down and quiet
    if (kind === 'hoe') this.play('build', { x, y, vol: 0.18, rate: 0.55 });
    else this.play(kind, { x, y, vol: kind === 'build' ? 0.4 : 0.5 });
  }

  private throttle(key: string, ms: number) {
    const now = performance.now();
    if (now - (this.last.get(key) ?? 0) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slide = 0) {
    const c = this.ctx, m = this.master;
    if (!c || !m) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(m);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', when = 0) {
    const c = this.ctx, m = this.master;
    if (!c || !m || !this.noiseBuf) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(m);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  click() {
    if (!this.play('ui', { vol: 0.35, throttle: 40 })) this.tone(880, 0.06, 'triangle', 0.08);
  }
  hover() {
    if (this.throttle('hover', 40)) this.tone(1320, 0.03, 'sine', 0.025);
  }
  error() {
    this.tone(180, 0.15, 'square', 0.05);
  }
  select(kind: string) {
    if (!this.throttle('select', 120)) return;
    if (kind === 'building') this.tone(330, 0.12, 'triangle', 0.08);
    else if (kind === 'villager') {
      if (!this.play('cloth', { vol: 0.45 })) this.tone(660, 0.08, 'triangle', 0.07);
    } else if (!this.play('unsheathe', { vol: 0.32 })) {
      this.tone(392, 0.09, 'sawtooth', 0.04);
      this.noise(0.08, 0.05, 3000, 4);
    }
  }
  command(kind: 'move' | 'attack' | 'gather') {
    if (!this.throttle('cmd', 100)) return;
    if (kind === 'attack') {
      this.tone(220, 0.12, 'sawtooth', 0.06, 0, 0.6);
      this.noise(0.1, 0.06, 2500, 3);
    } else if (kind === 'gather') this.tone(587, 0.08, 'triangle', 0.06);
    else this.tone(523, 0.07, 'triangle', 0.06);
  }
  place() {
    this.play('drop', { vol: 0.5 });
    this.noise(0.25, 0.08, 300, 0.7, 'lowpass');
  }
  sword(x?: number, y?: number) {
    if (!this.throttle('sword', 70)) return;
    this.noteBattle();
    if (this.play('melee', { x, y, vol: 0.5 })) return;
    this.noise(0.12, 0.1, 4500 + Math.random() * 2000, 8);
    this.tone(1800 + Math.random() * 800, 0.1, 'square', 0.015);
  }
  thud() {
    if (!this.throttle('thud', 90)) return;
    this.noise(0.12, 0.12, 400, 1, 'lowpass');
  }
  arrow(x?: number, y?: number) {
    if (!this.throttle('arrow', 60)) return;
    this.noteBattle(0.04);
    this.play('swing', { x, y, vol: 0.35, rate: 1.3 });
    this.noise(0.18, 0.03, 2400, 2, 'highpass');
  }
  death() {
    if (!this.throttle('death', 150)) return;
    this.tone(200, 0.3, 'sawtooth', 0.03, 0, 0.5);
  }
  collapse() {
    this.play('collapse', { vol: 0.7 });
    this.noise(1.2, 0.2, 200, 0.5, 'lowpass');
  }
  built() {
    this.play('build', { vol: 0.5 });
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.05, 0.1 + i * 0.08));
  }
  trained() {
    if (!this.throttle('trained', 200)) return;
    this.tone(784, 0.12, 'triangle', 0.05);
    this.tone(1046, 0.16, 'triangle', 0.04, 0.08);
  }
  deposit(gold: boolean) {
    if (gold) this.play('coins', { vol: 0.35, throttle: 300 });
  }
  alert() {
    // conch-like horn
    this.tone(233, 0.9, 'sawtooth', 0.05, 0, 1.02);
    this.tone(466, 0.9, 'sine', 0.04, 0, 1.02);
  }
  victory() {
    [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.08, i * 0.14));
  }
  defeat() {
    [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.7, 'sine', 0.08, i * 0.25));
  }

  /** menu music (kept for existing callers) */
  startDrone() {
    this.startMusic('menu');
  }
  stopDrone() {
    this.startMusic('game');
  }
}

export const sfx = new Sfx();
if (import.meta.env.DEV) (window as unknown as { __sfx: Sfx }).__sfx = sfx;
