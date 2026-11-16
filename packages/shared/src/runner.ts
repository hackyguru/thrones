import { SNAPSHOT_EVERY, TICK_MS } from './constants';
import { GameSession, type SessionSetup } from './sim/session';
import type { Command, GameOverInfo, Snapshot } from './types';

export interface RunnerHooks {
  /** slots that should receive snapshots */
  listeners: () => number[];
  onSnapshot: (slot: number, snap: Snapshot) => void;
  onGameOver: (info: GameOverInfo) => void;
}

/** Drives a GameSession in real time. Used by both the server and offline skirmish. */
export class GameRunner {
  session: GameSession;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private ticks = 0;
  paused = false;

  constructor(setup: SessionSetup, private hooks: RunnerHooks) {
    this.session = new GameSession(setup);
  }

  start() {
    this.last = Date.now();
    this.timer = setInterval(() => this.pump(), TICK_MS / 2);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  command(slot: number, cmd: Command) {
    this.session.command(slot, cmd);
  }

  private pump() {
    const now = Date.now();
    this.acc += Math.min(500, now - this.last);
    this.last = now;
    if (this.paused) {
      this.acc = 0;
      return;
    }
    let n = 0;
    while (this.acc >= TICK_MS && n < 5) {
      this.acc -= TICK_MS;
      n++;
      this.session.step();
      this.ticks++;
      if (this.ticks % SNAPSHOT_EVERY === 0) {
        const snaps = this.session.snapshots(this.hooks.listeners());
        for (const [slot, s] of snaps) this.hooks.onSnapshot(slot, s);
      }
      if (this.session.over) {
        // flush final events
        const snaps = this.session.snapshots(this.hooks.listeners());
        for (const [slot, s] of snaps) this.hooks.onSnapshot(slot, s);
        this.hooks.onGameOver(this.session.gameOverInfo());
        this.stop();
        return;
      }
    }
  }
}
