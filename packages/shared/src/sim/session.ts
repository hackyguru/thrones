import { MAP_SIZE, TICK_RATE } from '../constants';
import type { Command, EntSnap, GameEvent, GameInit, GameOverInfo, PlayerInfo, Snapshot } from '../types';
import { AIController } from './ai';
import { generateMap } from './mapgen';
import { r2, World, type Entity } from './world';

export interface SessionSetup {
  seed: number;
  players: PlayerInfo[];
  mapSize?: number;
  aiDifficulty?: 'easy' | 'normal';
}

/** One running match: the authoritative world plus AI players and snapshot generation. */
export class GameSession {
  world: World;
  private ais: AIController[] = [];
  private terrainStr: string;
  private initResources: GameInit['resources'];

  constructor(public setup: SessionSetup) {
    const size = setup.mapSize ?? MAP_SIZE;
    const map = generateMap(setup.seed, setup.players.length, size);
    this.world = new World(map, setup.players);
    let t = '';
    for (let i = 0; i < map.terrain.length; i++) t += map.terrain[i];
    this.terrainStr = t;
    this.initResources = [];
    for (const e of this.world.entities.values()) {
      if (e.kind === 'resource') this.initResources.push({ i: e.id, t: e.type as never, x: e.tx, y: e.ty, a: e.amount });
    }
    for (const p of setup.players) {
      if (p.isAI) this.ais.push(new AIController(this.world, p.slot, setup.seed, setup.aiDifficulty ?? 'normal'));
    }
  }

  initFor(slot: number): GameInit {
    return {
      seed: this.setup.seed,
      mapSize: this.world.size,
      terrain: this.terrainStr,
      resources: this.initResources,
      players: this.setup.players,
      you: slot,
      starts: this.world.starts,
    };
  }

  command(slot: number, cmd: Command) {
    try {
      this.world.command(slot, cmd);
    } catch (err) {
      console.error('command failed', err);
    }
  }

  resign(slot: number) {
    this.world.resign(slot);
  }

  step() {
    const w = this.world;
    w.step();
    for (const ai of this.ais) {
      if ((w.tick + ai.slot * 5) % (TICK_RATE / 2) === 0) ai.update();
    }
  }

  get over(): boolean {
    return this.world.winner !== -2;
  }

  gameOverInfo(): GameOverInfo {
    const w = this.world;
    return {
      winner: w.winner,
      durationSec: Math.round(w.tick / TICK_RATE),
      stats: w.players.map((p) => ({ slot: p.slot, name: p.name, civ: p.civ, color: p.color, stats: p.stats, alive: p.alive })),
    };
  }

  /** Build a snapshot for each requested slot, then clear pending events. */
  snapshots(slots: number[]): Map<number, Snapshot> {
    const w = this.world;
    const out = new Map<number, Snapshot>();
    const rc: [number, number][] = [];
    for (const id of w.changedRes) {
      const e = w.entities.get(id);
      rc.push([id, e ? Math.ceil(e.amount) : 0]);
    }
    w.changedRes.clear();
    const alive = w.players.map((p) => p.alive);
    for (const slot of slots) {
      const p = w.players[slot];
      const ents: EntSnap[] = [];
      for (const e of w.entities.values()) {
        if (e.kind === 'resource') continue;
        if (e.owner === slot || w.visibleTo(slot, e)) ents.push(serialize(e, e.owner === slot));
      }
      const ev: GameEvent[] = [];
      for (const r of w.events) {
        if (r.all || r.only === slot || (r.only === undefined && (r.also === slot || visibleAt(w, slot, r.x, r.y)))) ev.push(r.ev);
      }
      out.set(slot, {
        t: w.tick,
        me: p ? { r: { food: Math.floor(p.res.food), wood: Math.floor(p.res.wood), gold: Math.floor(p.res.gold), stone: Math.floor(p.res.stone) }, pop: p.pop, cap: p.popCap } : null,
        e: ents,
        rc: rc.length ? rc : undefined,
        ev: ev.length ? ev : undefined,
        al: alive,
      });
    }
    w.events.length = 0;
    return out;
  }
}

function visibleAt(w: World, slot: number, x: number, y: number) {
  const p = w.players[slot];
  if (!p) return true;
  const tx = Math.floor(x), ty = Math.floor(y);
  return w.inBounds(tx, ty) && p.visible[ty * w.size + tx] > 0;
}

function serialize(e: Entity, own: boolean): EntSnap {
  const s: EntSnap = { i: e.id, k: e.kind === 'unit' ? 0 : 1, t: e.type, o: e.owner, x: r2(e.x), y: r2(e.y), h: Math.ceil(e.hp), m: e.maxHp };
  if (e.kind === 'unit') {
    s.a = e.anim;
    s.f = r2(e.facing);
    if (e.carry > 0) {
      s.c = Math.floor(e.carry);
      s.ct = e.carryType!;
    }
    if (e.order?.type === 'gather') s.g = e.order.resType;
  } else {
    if (!e.built) s.p = r2(e.progress);
    if (e.type === 'farm') s.fa = Math.ceil(e.amount);
    if (own) {
      if (e.queue.length) s.q = e.queue.map((q) => [q.type, r2(q.progress)]);
      if (e.rally) s.r = [r2(e.rally.x), r2(e.rally.y)];
    }
  }
  return s;
}
