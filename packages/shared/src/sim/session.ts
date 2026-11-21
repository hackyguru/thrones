import { MAP_SIZE, TICK_RATE } from '../constants';
import type { Command, Difficulty, EntSnap, GameEvent, GameInit, GameOverInfo, PlayerInfo, Snapshot } from '../types';
import { AIController, type AISave } from './ai';
import { buildingStats, unitStats } from '../data/stats';
import { generateMap } from './mapgen';
import { r2, World, type Entity } from './world';

export interface SessionSetup {
  seed: number;
  players: PlayerInfo[];
  mapSize?: number;
  aiDifficulty?: Difficulty;
}

/** One running match: the authoritative world plus AI players and snapshot generation. */
export class GameSession {
  world: World;
  private ais: AIController[] = [];
  /** restored from a save: the client must see current resource nodes, not the initial ones */
  private loaded = false;
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
      if (p.isAI) this.ais.push(new AIController(this.world, p.slot, setup.seed, p.difficulty ?? setup.aiDifficulty ?? 'normal'));
    }
  }

  initFor(slot: number): GameInit {
    return {
      seed: this.setup.seed,
      mapSize: this.world.size,
      terrain: this.terrainStr,
      resources: this.loaded
        ? [...this.world.entities.values()].filter((e) => e.kind === 'resource' && !e.dead).map((e) => ({ i: e.id, t: e.type as never, x: e.tx, y: e.ty, a: e.amount }))
        : this.initResources,
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
      if ((w.tick + ai.slot * 3) % ai.thinkTicks === 0) ai.update();
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
    const ages = w.players.map((p) => p.age);
    for (const slot of slots) {
      const p = w.players[slot];
      const ents: EntSnap[] = [];
      for (const e of w.entities.values()) {
        if (e.kind === 'resource') continue;
        if (e.owner === slot || w.visibleTo(slot, e)) ents.push(serialize(e, e.owner === slot, w));
      }
      const ev: GameEvent[] = [];
      for (const r of w.events) {
        if (r.all || r.only === slot || (r.only === undefined && (r.also === slot || visibleAt(w, slot, r.x, r.y)))) ev.push(r.ev);
      }
      out.set(slot, {
        t: w.tick,
        me: p ? { r: { food: Math.floor(p.res.food), wood: Math.floor(p.res.wood), gold: Math.floor(p.res.gold), stone: Math.floor(p.res.stone) }, pop: p.pop, cap: p.popCap, tc: p.techs.length ? p.techs : undefined } : null,
        e: ents,
        rc: rc.length ? rc : undefined,
        ev: ev.length ? ev : undefined,
        al: alive,
        ag: ages,
      });
    }
    w.events.length = 0;
    return out;
  }

  // ---------------------------------------------------------------------------
  // save / load (single-player)
  // ---------------------------------------------------------------------------
  /** the whole match as a JSON string (derived data such as unit stats is rebuilt on load) */
  serialize(): string {
    const w = this.world;
    const ents = [...w.entities.values()].map((e) => ({ ...e, us: null, bs: null }));
    const save: SaveData = {
      v: SAVE_VERSION,
      setup: this.setup,
      tick: w.tick,
      nextId: w.nextId,
      winner: w.winner,
      occ: b64(w.occ),
      block: b64(w.block),
      entities: ents,
      projectiles: w.projectiles,
      players: w.players.map((p) => ({ ...p, visible: b64(p.visible) })),
      ais: this.ais.map((a) => a.save()),
    };
    return JSON.stringify(save);
  }

  static deserialize(json: string): GameSession {
    const d = JSON.parse(json) as SaveData;
    if (d.v !== SAVE_VERSION) throw new Error('This save is from an older version of Thrones');
    const s = new GameSession(d.setup);
    const w = s.world;
    w.tick = d.tick;
    w.nextId = d.nextId;
    w.winner = d.winner;
    w.occ = new Int32Array(unb64(d.occ).buffer);
    w.block = unb64(d.block);
    w.entities.clear();
    for (const p of d.players) {
      // saves from before ages existed: everything was available, so treat them as fully advanced
      if (!p.techs) {
        p.techs = ['age2', 'age3'];
        p.age = 3;
      }
    }
    for (const e of d.entities) {
      const pl = d.players.find((p) => p.slot === e.owner);
      if (pl && e.kind === 'unit') e.us = unitStats(pl.civ, e.type as never, TICK_RATE, pl.techs);
      if (pl && e.kind === 'building') e.bs = buildingStats(pl.civ, e.type as never, pl.techs);
      w.entities.set(e.id, e);
      if (e.type === 'gate' && e.kind === 'building') w.gate[e.ty * w.size + e.tx] = e.owner + 1;
    }
    w.projectiles = d.projectiles;
    w.events = [];
    w.players = d.players.map((p) => ({ ...p, visible: unb64(p.visible) }));
    for (const a of d.ais) s.ais.find((x) => x.slot === a.slot)?.load(a, d.setup.seed ^ d.tick);
    s.loaded = true;
    return s;
  }
}

function visibleAt(w: World, slot: number, x: number, y: number) {
  const p = w.players[slot];
  if (!p) return true;
  const tx = Math.floor(x), ty = Math.floor(y);
  return w.inBounds(tx, ty) && p.visible[ty * w.size + tx] > 0;
}

function serialize(e: Entity, own: boolean, w: World): EntSnap {
  const s: EntSnap = { i: e.id, k: e.kind === 'unit' ? 0 : 1, t: e.type, o: e.owner, x: r2(e.x), y: r2(e.y), h: Math.ceil(e.hp), m: e.maxHp };
  if (e.kind === 'unit') {
    s.a = e.anim;
    s.f = r2(e.facing);
    if (e.carry > 0) {
      s.c = Math.floor(e.carry);
      s.ct = e.carryType!;
    }
    if (e.order?.type === 'gather') {
      s.g = e.order.resType;
      if (w.entities.get(e.order.target)?.type === 'farm') s.fm = 1;
    }
    if (own && e.stance) s.st = e.stance;
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

const SAVE_VERSION = 1;

interface SaveData {
  v: number;
  setup: SessionSetup;
  tick: number;
  nextId: number;
  winner: number;
  occ: string;
  block: string;
  entities: Entity[];
  projectiles: World['projectiles'];
  players: (Omit<World['players'][number], 'visible'> & { visible: string })[];
  ais: AISave[];
}

/** typed array <-> base64 (works in browsers and Node) */
function b64(a: ArrayBufferView): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
