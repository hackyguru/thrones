/** Tiny procedural sound engine (WebAudio) — no audio assets needed. */
class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private last = new Map<string, number>();
  private drone: { stop: () => void } | null = null;

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
    this.tone(880, 0.06, 'triangle', 0.08);
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
    else if (kind === 'villager') this.tone(660, 0.08, 'triangle', 0.07);
    else {
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
    this.noise(0.25, 0.12, 300, 0.7, 'lowpass');
    this.tone(110, 0.2, 'sine', 0.12);
  }
  sword() {
    if (!this.throttle('sword', 70)) return;
    this.noise(0.12, 0.1, 4500 + Math.random() * 2000, 8);
    this.tone(1800 + Math.random() * 800, 0.1, 'square', 0.015);
  }
  thud() {
    if (!this.throttle('thud', 90)) return;
    this.noise(0.12, 0.12, 400, 1, 'lowpass');
  }
  arrow() {
    if (!this.throttle('arrow', 60)) return;
    this.noise(0.18, 0.04, 2400, 2, 'highpass');
  }
  death() {
    if (!this.throttle('death', 150)) return;
    this.tone(200, 0.3, 'sawtooth', 0.03, 0, 0.5);
  }
  collapse() {
    this.noise(1.2, 0.25, 200, 0.5, 'lowpass');
    this.noise(0.8, 0.1, 1200, 1, 'bandpass', 0.1);
  }
  built() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.07, i * 0.08));
  }
  trained() {
    if (!this.throttle('trained', 200)) return;
    this.tone(784, 0.12, 'triangle', 0.06);
    this.tone(1046, 0.16, 'triangle', 0.05, 0.08);
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

  /** soft tanpura-like drone (Pa–Sa–Sa–Sa) for the menu */
  startDrone() {
    const c = this.ctx, m = this.master;
    if (!c || !m || this.drone) return;
    const bus = c.createGain();
    bus.gain.value = 0.0;
    bus.gain.linearRampToValueAtTime(0.5, c.currentTime + 3);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    bus.connect(lp).connect(m);
    const sa = 130.81; // C3
    const notes = [sa * 1.5 / 2, sa, sa, sa / 2];
    let i = 0;
    const pluck = () => {
      const t = c.currentTime;
      const f = notes[i++ % notes.length];
      for (const [mult, v] of [[1, 0.05], [2, 0.03], [3, 0.018], [4, 0.012], [5, 0.008]] as const) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult * (1 + (Math.random() - 0.5) * 0.002);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + 3.3);
      }
    };
    pluck();
    const id = setInterval(pluck, 1150);
    this.drone = {
      stop: () => {
        clearInterval(id);
        bus.gain.setTargetAtTime(0, c.currentTime, 0.5);
        setTimeout(() => bus.disconnect(), 3000);
      },
    };
  }

  stopDrone() {
    this.drone?.stop();
    this.drone = null;
  }
}

export const sfx = new Sfx();
