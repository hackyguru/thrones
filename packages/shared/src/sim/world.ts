import {
  INTERACT_RANGE, MAX_QUEUE, POP_HARD_CAP, PROJECTILE_SPEED, START_RESOURCES, TICK_RATE, Terrain,
} from '../constants';
import { BUILDINGS, RESOURCE_NODES, isWall, wallLine } from '../data/buildings';
import { buildingStats, canAfford, carryCapacity, gatherRate, pay, trainable, unitAge, unitStats, type BuildingStats, type UnitStats } from '../data/stats';
import { TECHS, techBlocker, techMods, techsAt, type TechId } from '../data/techs';
import { UNITS } from '../data/units';
import {
  Anim, type AnimCode, type BuildingType, type Command, type EntityKind, type GameEvent, type PlayerInfo,
  type PlayerStats, type ResourceNodeType, type ResourceType, type Stance, type TargetClass, type UnitType, type Vec2,
} from '../types';
import type { MapData } from './mapgen';
import { Pathfinder } from './pathfinding';

export interface Order {
  type: 'move' | 'attack' | 'gather' | 'build';
  x: number;
  y: number;
  target: number;
  resType?: ResourceType;
  phase?: 'go' | 'return';
  auto?: boolean;
  /** formation march: move no faster than this (tiles/s) */
  pace?: number;
  /** order to go back to once this one is done (breaking through a wall on the way) */
  resume?: Order;
  /** farming: the spot in the field being worked this trip */
  wx?: number;
  wy?: number;
  /** ticks spent walking to that spot inside the field */
  wt?: number;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  type: string;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  // footprint (buildings + resources)
  tx: number;
  ty: number;
  size: number;
  // unit
  us: UnitStats | null;
  order: Order | null;
  path: Vec2[] | null;
  pathIdx: number;
  repath: number;
  fails: number;
  anim: AnimCode;
  facing: number;
  carry: number;
  carryType: ResourceType | null;
  cooldown: number;
  lastFight: number;
  /** combat stance (absent in old saves = aggressive) */
  stance?: Stance;
  /** where a defensive / hold-ground unit belongs */
  guard?: Vec2 | null;
  /** attack-move destination, resumed after each fight */
  amove?: Vec2 | null;
  // building
  bs: BuildingStats | null;
  built: boolean;
  progress: number;
  builders: number;
  /** training or research; tech items have tech = true and type = TechId */
  queue: { type: UnitType; progress: number; started: boolean; tech?: boolean }[];
  rally: { x: number; y: number; target: number } | null;
  // resource / farm
  resType: ResourceType | null;
  amount: number;
}

export interface SimPlayer extends PlayerInfo {
  res: Record<ResourceType, number>;
  pop: number;
  popCap: number;
  alive: boolean;
  visible: Uint8Array;
  stats: PlayerStats;
  lastAlert: number;
  lastPopWarn: number;
  age: number;
  techs: string[];
}

export interface RoutedEvent {
  ev: GameEvent;
  x: number;
  y: number;
  /** only this slot receives it */
  only?: number;
  /** everyone receives it */
  all?: boolean;
  /** this slot also receives it even if not visible */
  also?: number;
}

interface Projectile {
  attacker: number;
  owner: number;
  target: number;
  ticks: number;
  atk: number;
  bonus?: Partial<Record<TargetClass, number>>;
}

const unitRadius = (e: Entity) => {
  const cls = e.us!.def.cls;
  return cls === 'elephant' ? 0.55 : cls === 'cavalry' ? 0.4 : 0.28;
};

function emptyStats(): PlayerStats {
  return {
    gathered: { food: 0, wood: 0, gold: 0, stone: 0 },
    unitsTrained: 0, unitsLost: 0, kills: 0, buildingsBuilt: 0, buildingsLost: 0, razed: 0,
  };
}

export class World {
  size: number;
  terrain: Uint8Array;
  /** entity occupying a tile (buildings incl. farms, resources) */
  occ: Int32Array;
  /** movement blocking */
  block: Uint8Array;
  /** gate tiles: owner + 1 (open to that player and allies, blocked to everyone else) */
  gate: Int16Array;
  entities = new Map<number, Entity>();
  players: SimPlayer[];
  tick = 0;
  nextId = 1;
  events: RoutedEvent[] = [];
  changedRes = new Set<number>();
  projectiles: Projectile[] = [];
  pf: Pathfinder;
  starts: Vec2[];
  private hash = new Map<number, Entity[]>();
  /** whose path is being planned, and whether it may go through enemy walls */
  private mover = -1;
  private breaching = false;
  winner = -2; // -2 = running
  private multiPlayerStart: boolean;

  constructor(map: MapData, players: PlayerInfo[]) {
    this.size = map.size;
    this.terrain = map.terrain;
    this.starts = map.starts;
    const n = this.size * this.size;
    this.occ = new Int32Array(n);
    this.block = new Uint8Array(n);
    this.gate = new Int16Array(n);
    for (let i = 0; i < n; i++) if (this.terrain[i] === Terrain.WATER) this.block[i] = 1;
    this.pf = new Pathfinder(this.size, (x, y) => this.passable(x, y, this.mover), (x, y) => this.breakCost(x, y));
    this.players = players.map((p) => ({
      ...p,
      res: { ...START_RESOURCES },
      pop: 0,
      popCap: 0,
      alive: true,
      visible: new Uint8Array(n),
      stats: emptyStats(),
      lastAlert: -1000,
      lastPopWarn: -1000,
      age: 1,
      techs: [],
    }));
    this.multiPlayerStart = players.length > 1;
    for (const r of map.resources) this.spawnResource(r.type, r.x, r.y);
    players.forEach((p, i) => {
      const s = map.starts[i];
      const tc = this.placeBuilding(p.slot, 'town_center', s.x - 2, s.y - 2, true);
      const spots = [[-1, 2.6], [0.2, 2.7], [1.4, 2.6], [2.8, 0]];
      for (let k = 0; k < 3; k++) this.spawnUnit(p.slot, 'villager', tc.x + spots[k][0], tc.y + spots[k][1]);
      this.spawnUnit(p.slot, 'horseman', tc.x + spots[3][0], tc.y + spots[3][1]);
    });
    this.recountPop();
    this.computeVisibility();
  }

  // -------------------------------------------------------------------------
  // grid helpers
  // -------------------------------------------------------------------------
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }
  walkable(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size && this.block[y * this.size + x] === 0;
  }
  walkableAt(x: number, y: number) {
    return this.walkable(Math.floor(x), Math.floor(y));
  }
  /** walkable for a given player: their own and allied gates are open */
  passable(x: number, y: number, owner: number) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    const i = y * this.size + x;
    if (this.block[i] === 0) return true;
    const g = this.gate[i];
    return g !== 0 && owner >= 0 && !this.isEnemy(owner, g - 1);
  }
  passableAt(x: number, y: number, owner: number) {
    return this.passable(Math.floor(x), Math.floor(y), owner);
  }
  /** an enemy wall or gate standing on this spot */
  private enemyWallAt(x: number, y: number, owner: number): Entity | null {
    if (!this.inBounds(x, y)) return null;
    const e = this.entities.get(this.occ[y * this.size + x]);
    return e && e.kind === 'building' && isWall(e.type) && this.isEnemy(owner, e.owner) ? e : null;
  }
  private breakCost(x: number, y: number): number {
    if (!this.breaching) return 0;
    const e = this.enemyWallAt(x, y, this.mover);
    // the cost of a detour worth avoiding by smashing through instead
    return e ? 10 + e.hp / 60 : 0;
  }
  /** soldiers attacking (not just walking) will batter through walls in their way */
  private canBreach(u: Entity) {
    return u.type !== 'villager' && (!!u.amove || (u.order?.type === 'attack' && !u.order.auto));
  }

  /** an own wall section that a gate placed here would replace */
  wallToReplace(slot: number, type: BuildingType, tx: number, ty: number): Entity | null {
    if (type !== 'gate' || !this.inBounds(tx, ty)) return null;
    const e = this.entities.get(this.occ[ty * this.size + tx]);
    return e && e.type === 'wall' && e.owner === slot ? e : null;
  }

  canPlace(type: BuildingType, tx: number, ty: number): boolean {
    const size = BUILDINGS[type].size;
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        if (!this.inBounds(x, y)) return false;
        const i = y * this.size + x;
        if (this.terrain[i] === Terrain.WATER || this.occ[i] !== 0) return false;
      }
    return true;
  }

  /** Find a valid placement near a point, spiralling outward. */
  findPlacement(type: BuildingType, cx: number, cy: number, minR: number, maxR: number, rnd: () => number): Vec2 | null {
    const size = BUILDINGS[type].size;
    for (let r = minR; r <= maxR; r++) {
      const cands: Vec2[] = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = Math.round(cx + dx - size / 2), ty = Math.round(cy + dy - size / 2);
          if (this.canPlace(type, tx, ty) && this.hasMargin(tx, ty, size)) cands.push({ x: tx, y: ty });
        }
      if (cands.length) return cands[Math.floor(rnd() * cands.length)];
    }
    return null;
  }

  /** keep a 1-tile walkable ring around AI buildings so they don't wall themselves in */
  private hasMargin(tx: number, ty: number, size: number) {
    for (let y = ty - 1; y <= ty + size; y++)
      for (let x = tx - 1; x <= tx + size; x++) {
        if (x >= tx && x < tx + size && y >= ty && y < ty + size) continue;
        if (!this.inBounds(x, y)) return false;
        const i = y * this.size + x;
        if (this.block[i]) return false;
        const o = this.occ[i];
        if (o && this.entities.get(o)?.kind === 'building') return false;
      }
    return true;
  }

  // -------------------------------------------------------------------------
  // entity creation
  // -------------------------------------------------------------------------
  private base(kind: EntityKind, type: string, owner: number, x: number, y: number): Entity {
    return {
      id: this.nextId++, kind, type, owner, x, y, hp: 1, maxHp: 1, dead: false,
      tx: Math.floor(x), ty: Math.floor(y), size: 1,
      us: null, order: null, path: null, pathIdx: 0, repath: 0, fails: 0, anim: Anim.IDLE, facing: Math.PI / 2,
      carry: 0, carryType: null, cooldown: 0, lastFight: -1000, stance: 0, guard: null, amove: null,
      bs: null, built: true, progress: 1, builders: 0, queue: [], rally: null,
      resType: null, amount: 0,
    };
  }

  spawnResource(type: ResourceNodeType, tx: number, ty: number): Entity {
    const def = RESOURCE_NODES[type];
    const e = this.base('resource', type, -1, tx + 0.5, ty + 0.5);
    e.resType = def.resType;
    e.amount = def.amount;
    e.hp = e.maxHp = 1;
    this.entities.set(e.id, e);
    const i = ty * this.size + tx;
    this.occ[i] = e.id;
    this.block[i] = 1;
    return e;
  }

  spawnUnit(owner: number, type: UnitType, x: number, y: number): Entity {
    const p = this.players[owner];
    const us = unitStats(p.civ, type, TICK_RATE, p.techs);
    const e = this.base('unit', type, owner, x, y);
    e.us = us;
    e.hp = e.maxHp = us.maxHp;
    e.facing = Math.PI / 2;
    this.entities.set(e.id, e);
    return e;
  }

  placeBuilding(owner: number, type: BuildingType, tx: number, ty: number, built: boolean): Entity {
    const p = this.players[owner];
    const bs = buildingStats(p.civ, type, p.techs);
    const size = bs.def.size;
    const e = this.base('building', type, owner, tx + size / 2, ty + size / 2);
    e.tx = tx;
    e.ty = ty;
    e.size = size;
    e.bs = bs;
    e.maxHp = bs.maxHp;
    e.built = built;
    e.progress = built ? 1 : 0;
    e.hp = built ? bs.maxHp : 1;
    if (type === 'farm') {
      e.resType = 'food';
      e.amount = Math.round((bs.def.food ?? 300) * (1 + techMods(p.techs).farmFood));
    }
    this.entities.set(e.id, e);
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        const i = y * this.size + x;
        this.occ[i] = e.id;
        if (bs.def.blocking) this.block[i] = 1;
        if (type === 'gate') this.gate[i] = owner + 1;
      }
    return e;
  }

  private clearFootprint(e: Entity) {
    for (let y = e.ty; y < e.ty + e.size; y++)
      for (let x = e.tx; x < e.tx + e.size; x++) {
        const i = y * this.size + x;
        if (this.occ[i] === e.id) {
          this.occ[i] = 0;
          this.gate[i] = 0;
          if (this.terrain[i] !== Terrain.WATER) this.block[i] = 0;
        }
      }
  }

  removeEntity(e: Entity) {
    if (e.dead && !this.entities.has(e.id)) return;
    e.dead = true;
    if (e.kind !== 'unit') this.clearFootprint(e);
    if (e.kind === 'resource') {
      e.amount = 0;
      this.changedRes.add(e.id);
    }
    this.entities.delete(e.id);
  }

  emit(ev: GameEvent, x: number, y: number, opts: { only?: number; all?: boolean; also?: number } = {}) {
    this.events.push({ ev, x, y, ...opts });
  }

  // -------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------
  distTo(u: Entity, e: Entity): number {
    const ru = u.kind === 'unit' ? unitRadius(u) : 0;
    if (e.kind === 'unit') return Math.max(0, Math.hypot(e.x - u.x, e.y - u.y) - unitRadius(e) - ru);
    const dx = Math.max(e.tx - u.x, 0, u.x - (e.tx + e.size));
    const dy = Math.max(e.ty - u.y, 0, u.y - (e.ty + e.size));
    return Math.max(0, Math.hypot(dx, dy) - ru);
  }

  visibleTo(slot: number, e: Entity): boolean {
    const vis = this.players[slot]?.visible;
    if (!vis) return true;
    if (e.kind === 'unit') {
      const tx = Math.floor(e.x), ty = Math.floor(e.y);
      return this.inBounds(tx, ty) && vis[ty * this.size + tx] > 0;
    }
    for (let y = e.ty; y < e.ty + e.size; y++)
      for (let x = e.tx; x < e.tx + e.size; x++) if (vis[y * this.size + x]) return true;
    return false;
  }

  isEnemy(a: number, b: number) {
    return a >= 0 && b >= 0 && a !== b;
  }

  private nearestDropoff(u: Entity, type: ResourceType): Entity | null {
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== 'building' || e.owner !== u.owner || !e.built) continue;
      if (!e.bs!.def.dropoff.includes(type)) continue;
      const d = this.distTo(u, e);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  findResource(owner: number, resType: ResourceType, x: number, y: number, maxDist: number, farmsOnly = false): Entity | null {
    let best: Entity | null = null;
    let bd = maxDist * maxDist;
    for (const e of this.entities.values()) {
      if (e.amount <= 0 || e.resType !== resType) continue;
      if (e.kind === 'building') {
        if (e.type !== 'farm' || e.owner !== owner || !e.built) continue;
      } else if (e.kind !== 'resource' || farmsOnly) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private nearestWalkable(x: number, y: number, maxR = 6, owner = -1): Vec2 | null {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (this.passable(tx, ty, owner)) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.passable(tx + dx, ty + dy, owner)) continue;
          const cx = tx + dx + 0.5, cy = ty + dy + 0.5;
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: cx, y: cy };
          }
        }
      if (best) return best;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // movement
  // -------------------------------------------------------------------------
  private pathToPoint(u: Entity, x: number, y: number): boolean {
    const goal = this.nearestWalkable(x, y, 6, u.owner);
    if (!goal) {
      u.path = [];
      return false;
    }
    const gx = Math.floor(goal.x), gy = Math.floor(goal.y);
    const r = this.find(u, gx, gy, gx, gy);
    u.path = r.path;
    u.pathIdx = 0;
    if (r.reached) {
      if (u.path.length) u.path[u.path.length - 1] = { x: goal.x, y: goal.y };
      else u.path = [{ x: goal.x, y: goal.y }];
    }
    return r.reached;
  }

  private pathToEntity(u: Entity, t: Entity, range: number) {
    const ex = Math.max(1, Math.floor(range));
    let x0: number, y0: number, x1: number, y1: number;
    if (t.kind === 'unit') {
      x0 = x1 = Math.floor(t.x);
      y0 = y1 = Math.floor(t.y);
    } else {
      x0 = t.tx;
      y0 = t.ty;
      x1 = t.tx + t.size - 1;
      y1 = t.ty + t.size - 1;
    }
    const r = this.find(u, x0 - ex, y0 - ex, x1 + ex, y1 + ex);
    u.path = r.path;
    u.pathIdx = 0;
    return r.reached;
  }

  private find(u: Entity, x0: number, y0: number, x1: number, y1: number) {
    this.mover = u.owner;
    this.breaching = this.canBreach(u);
    const r = this.pf.find(Math.floor(u.x), Math.floor(u.y), x0, y0, x1, y1);
    this.mover = -1;
    this.breaching = false;
    return r;
  }

  /** an enemy wall blocks the way: knock it down, then carry on */
  private breach(u: Entity, wall: Entity) {
    if (u.amove) {
      this.orderAttack(u, wall, true);
      return;
    }
    const prev = u.order!;
    u.order = { type: 'attack', x: wall.x, y: wall.y, target: wall.id, auto: false, resume: prev.resume ?? prev };
    u.path = null;
    u.fails = 0;
    u.repath = 0;
  }

  /** Advance along the path. Returns true when the path is finished. */
  private followPath(u: Entity): boolean {
    if (!u.path || u.pathIdx >= u.path.length) return true;
    const pace = u.order?.type === 'move' && u.order.pace ? Math.min(u.order.pace, u.us!.speed) : u.us!.speed;
    let step = pace / TICK_RATE;
    while (step > 1e-6 && u.pathIdx < u.path.length) {
      const wp = u.path[u.pathIdx];
      const dx = wp.x - u.x, dy = wp.y - u.y;
      const d = Math.hypot(dx, dy);
      // intermediate waypoints only need to be passed near: units crowding the same tile centre
      // would otherwise shove each other off it forever
      if (d < 0.45 && u.pathIdx < u.path.length - 1 && d > step) {
        u.pathIdx++;
        continue;
      }
      if (d > 1e-4) u.facing = Math.atan2(dy, dx);
      if (d <= step) {
        u.x = wp.x;
        u.y = wp.y;
        step -= d;
        u.pathIdx++;
      } else {
        const nx = u.x + (dx / d) * step, ny = u.y + (dy / d) * step;
        if (!this.passableAt(nx, ny, u.owner) && this.passableAt(u.x, u.y, u.owner)) {
          const wall = this.canBreach(u) ? this.enemyWallAt(Math.floor(nx), Math.floor(ny), u.owner) : null;
          if (wall && (u.order?.type !== 'attack' || u.order.target !== wall.id)) this.breach(u, wall);
          // otherwise something was built in our way — re-plan
          else u.path = null;
          return false;
        }
        u.x = nx;
        u.y = ny;
        step = 0;
      }
    }
    u.anim = Anim.WALK;
    return u.pathIdx >= u.path.length;
  }

  private stepToward(u: Entity, x: number, y: number) {
    const dx = x - u.x, dy = y - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return;
    u.facing = Math.atan2(dy, dx);
    const step = Math.min(d, u.us!.speed / TICK_RATE);
    const nx = u.x + (dx / d) * step, ny = u.y + (dy / d) * step;
    if (this.passableAt(nx, ny, u.owner)) {
      u.x = nx;
      u.y = ny;
      u.anim = Anim.WALK;
    }
  }

  /** Move toward a target until within range. Returns true when in range. */
  private approach(u: Entity, t: Entity, range: number): boolean {
    if (this.distTo(u, t) <= range) {
      u.path = null;
      u.fails = 0;
      return true;
    }
    if (u.repath > 0) u.repath--;
    const pathDone = !u.path || u.pathIdx >= u.path.length;
    if ((pathDone && u.repath <= 0) || (t.kind === 'unit' && u.repath <= 0)) {
      if (u.path && pathDone && u.path.length > 0) u.fails++;
      if (u.fails > 4) return false;
      this.pathToEntity(u, t, range);
      u.repath = t.kind === 'unit' ? 8 : 20;
    }
    if (u.path && u.pathIdx < u.path.length) this.followPath(u);
    else {
      const before = this.distTo(u, t);
      this.stepToward(u, t.x, t.y);
      if (this.distTo(u, t) >= before - 1e-4) {
        u.anim = Anim.IDLE;
        if (u.repath <= 0) u.fails++;
      }
    }
    return false;
  }

  /**
   * Farmers work inside the field, each at their own spot, picked afresh every trip so a few
   * farmers spread over the rows. Returns true once standing on the spot.
   */
  private toFarmSpot(u: Entity, t: Entity, o: Order): boolean {
    if (o.wx === undefined || o.wy === undefined) {
      const h = Math.imul(u.id * 7919 + this.tick, 2654435761) >>> 0;
      const along = 0.6 + ((h & 1023) / 1023) * (t.size - 1.2);
      const depth = 0.65 + (((h >>> 10) & 1023) / 1023) * 0.4;
      // work a row near the side of the field we come from, so the walk to the drop-off stays
      // short; where along that side is spread per farmer and per trip
      const cx = t.tx + t.size / 2, cy = t.ty + t.size / 2;
      if (Math.abs(u.x - cx) > Math.abs(u.y - cy)) {
        o.wx = u.x < cx ? t.tx + depth : t.tx + t.size - depth;
        o.wy = t.ty + along;
      } else {
        o.wx = t.tx + along;
        o.wy = u.y < cy ? t.ty + depth : t.ty + t.size - depth;
      }
      u.path = null;
      u.repath = 0;
      o.wt = 0;
    }
    const d = Math.hypot(o.wx - u.x, o.wy - u.y);
    if (d <= 0.25) {
      u.path = null;
      u.fails = 0;
      return true;
    }
    // at or in the field: it is open ground, so walk straight to the spot
    if (this.distTo(u, t) <= 0.6) {
      const before = d;
      this.stepToward(u, o.wx, o.wy);
      // blocked, or jostled by other farmers for a couple of seconds: work where we are
      o.wt = (o.wt ?? 0) + 1;
      if (Math.hypot(o.wx - u.x, o.wy - u.y) >= before - 1e-4 || o.wt > TICK_RATE * 2) {
        o.wx = u.x;
        o.wy = u.y;
        return true;
      }
      return false;
    }
    // still on the way: path to the field like any other target
    this.approach(u, t, 0.5);
    return false;
  }

  private face(u: Entity, t: Entity) {
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
  }

  private idle(u: Entity) {
    u.order = null;
    u.path = null;
    u.anim = Anim.IDLE;
    u.fails = 0;
  }

  // -------------------------------------------------------------------------
  // commands
  // -------------------------------------------------------------------------
  command(slot: number, cmd: Command) {
    const p = this.players[slot];
    if (!p || !p.alive) return;
    const ownUnits = (ids: number[]) => {
      const out: Entity[] = [];
      for (const id of ids.slice(0, 200)) {
        const e = this.entities.get(id);
        if (e && e.kind === 'unit' && e.owner === slot) out.push(e);
      }
      return out;
    };
    switch (cmd.c) {
      case 'move':
        this.groupMove(ownUnits(cmd.ids), cmd.x, cmd.y);
        break;
      case 'amove':
        this.attackMove(ownUnits(cmd.ids), cmd.x, cmd.y);
        break;
      case 'stance': {
        const st = cmd.s === 1 || cmd.s === 2 ? cmd.s : 0;
        for (const u of ownUnits(cmd.ids)) {
          if (u.type === 'villager') continue;
          u.stance = st;
          u.guard = { x: u.x, y: u.y };
          if (st === 2 && u.order?.type === 'attack' && u.order.auto) this.idle(u);
        }
        break;
      }
      case 'smart':
        this.smart(slot, ownUnits(cmd.ids), cmd.x, cmd.y, cmd.target);
        break;
      case 'attack': {
        const t = this.entities.get(cmd.target);
        if (!t || t.kind === 'resource' || !this.isEnemy(slot, t.owner)) return;
        for (const u of ownUnits(cmd.ids)) this.orderAttack(u, t, false);
        break;
      }
      case 'build': {
        const vills = ownUnits(cmd.ids).filter((u) => u.type === 'villager');
        if (!vills.length) return;
        const bs = buildingStats(p.civ, cmd.type, p.techs);
        if (!bs || bs.def.age > p.age) return;
        const old = this.wallToReplace(slot, cmd.type, cmd.tx | 0, cmd.ty | 0);
        if (!old && !this.canPlace(cmd.type, cmd.tx | 0, cmd.ty | 0)) return;
        if (!canAfford(p.res, bs.cost)) return;
        pay(p.res, bs.cost);
        if (old) this.removeEntity(old);
        const b = this.placeBuilding(slot, cmd.type, cmd.tx | 0, cmd.ty | 0, false);
        for (const u of vills) this.orderBuild(u, b);
        break;
      }
      case 'wall': {
        const vills = ownUnits(cmd.ids).filter((u) => u.type === 'villager');
        const bs = buildingStats(p.civ, 'wall', p.techs);
        if (!vills.length || bs.def.age > p.age) return;
        const placed: Entity[] = [];
        for (const [x, y] of wallLine(cmd.ax | 0, cmd.ay | 0, cmd.bx | 0, cmd.by | 0)) {
          if (!this.canPlace('wall', x, y)) continue; // existing walls, trees and buildings are skipped
          if (!canAfford(p.res, bs.cost)) break;
          pay(p.res, bs.cost);
          placed.push(this.placeBuilding(slot, 'wall', x, y, false));
        }
        if (!placed.length) return;
        // everyone starts at the end nearest the group and works along the line
        const cx = vills.reduce((a, u) => a + u.x, 0) / vills.length, cy = vills.reduce((a, u) => a + u.y, 0) / vills.length;
        const first = Math.hypot(placed[0].x - cx, placed[0].y - cy) <= Math.hypot(placed[placed.length - 1].x - cx, placed[placed.length - 1].y - cy) ? placed[0] : placed[placed.length - 1];
        for (const u of vills) this.orderBuild(u, first);
        break;
      }
      case 'train': {
        const b = this.entities.get(cmd.building);
        if (!b || b.kind !== 'building' || b.owner !== slot || !b.built) return;
        if (!trainable(p.civ, b.type as BuildingType).includes(cmd.type)) return;
        if (unitAge(p.civ, cmd.type) > p.age) return;
        if (b.queue.length >= MAX_QUEUE) return;
        const us = unitStats(p.civ, cmd.type, TICK_RATE);
        if (!canAfford(p.res, us.cost)) return;
        pay(p.res, us.cost);
        b.queue.push({ type: cmd.type, progress: 0, started: false });
        break;
      }
      case 'research': {
        const b = this.entities.get(cmd.building);
        const id = cmd.tech as TechId;
        if (!b || b.kind !== 'building' || b.owner !== slot || !b.built || !TECHS[id]) return;
        if (!techsAt(b.type as BuildingType).includes(id)) return;
        if (techBlocker(id, p.techs, this.queuedTechs(slot))) return;
        if (b.queue.length >= MAX_QUEUE || !canAfford(p.res, TECHS[id].cost)) return;
        pay(p.res, TECHS[id].cost);
        b.queue.push({ type: id as never, progress: 0, started: true, tech: true });
        break;
      }
      case 'cancel': {
        const b = this.entities.get(cmd.building);
        if (!b || b.kind !== 'building' || b.owner !== slot) return;
        const q = b.queue[cmd.index];
        if (!q) return;
        b.queue.splice(cmd.index, 1);
        pay(p.res, this.queueCost(p, q), 1);
        break;
      }
      case 'rally': {
        const b = this.entities.get(cmd.building);
        if (!b || b.kind !== 'building' || b.owner !== slot) return;
        b.rally = { x: cmd.x, y: cmd.y, target: cmd.target ?? 0 };
        break;
      }
      case 'stop':
        for (const u of ownUnits(cmd.ids)) {
          this.idle(u);
          u.amove = null;
          u.guard = { x: u.x, y: u.y };
        }
        break;
      case 'delete':
        for (const id of cmd.ids) {
          const e = this.entities.get(id);
          if (e && e.owner === slot && e.kind !== 'resource') this.kill(e, -1);
        }
        break;
    }
  }

  private smart(slot: number, units: Entity[], x: number, y: number, targetId?: number) {
    const t = targetId ? this.entities.get(targetId) : undefined;
    const movers: Entity[] = [];
    for (const u of units) {
      const vill = u.type === 'villager';
      if (!t) movers.push(u);
      else if (t.kind === 'resource') {
        if (vill) this.orderGather(u, t);
        else movers.push(u);
      } else if (this.isEnemy(slot, t.owner)) {
        this.orderAttack(u, t, false);
      } else if (t.kind === 'building' && t.owner === slot && vill) {
        if (!t.built) this.orderBuild(u, t);
        else if (t.type === 'farm') this.orderGather(u, t);
        else if (u.carry > 0 && t.bs!.def.dropoff.includes(u.carryType!)) {
          const prev = u.order?.type === 'gather' ? u.order : null;
          u.order = { type: 'gather', x: prev?.x ?? t.x, y: prev?.y ?? t.y, target: prev?.target ?? 0, resType: u.carryType!, phase: 'return' };
          u.path = null;
        } else movers.push(u);
      } else movers.push(u);
    }
    if (movers.length) this.groupMove(movers, x, y);
  }

  /**
   * Move a group in formation: melee in front, ranged behind, villagers at the back, each rank
   * keeping its left-to-right order so nobody crosses paths. A compact group marches at the pace
   * of its slowest member so it arrives together.
   */
  groupMove(units: Entity[], x: number, y: number) {
    if (!units.length) return;
    const send = (u: Entity, tx: number, ty: number, pace?: number) => {
      u.order = { type: 'move', x: tx, y: ty, target: 0, pace };
      u.path = null;
      u.fails = 0;
      u.amove = null;
      u.guard = { x: tx, y: ty };
    };
    if (units.length === 1) {
      send(units[0], x, y);
      return;
    }
    let cx = 0, cy = 0;
    for (const u of units) {
      cx += u.x;
      cy += u.y;
    }
    cx /= units.length;
    cy /= units.length;
    let fx = x - cx, fy = y - cy;
    const fl = Math.hypot(fx, fy);
    if (fl < 1e-3) {
      fx = 0;
      fy = 1;
    } else {
      fx /= fl;
      fy /= fl;
    }
    // lateral axis (right-hand side of the march direction)
    const lx = -fy, ly = fx;
    const rank = (u: Entity) => {
      const cls = u.us!.def.cls;
      return cls === 'villager' ? 3 : u.us!.def.ranged ? 2 : cls === 'cavalry' ? 1 : 0;
    };
    const big = units.some((u) => u.us!.def.cls === 'elephant');
    const spacing = big ? 1.35 : units.some((u) => u.us!.def.cls === 'cavalry') ? 1.15 : 0.95;
    const cols = Math.max(3, Math.min(14, Math.ceil(Math.sqrt(units.length * 2.2))));
    const ranks = [0, 1, 2, 3].map((r) =>
      units.filter((u) => rank(u) === r).sort((a, b) => (a.x - cx) * lx + (a.y - cy) * ly - ((b.x - cx) * lx + (b.y - cy) * ly)),
    );
    const slots: { u: Entity; row: number; col: number }[] = [];
    let row = 0;
    for (const list of ranks) {
      for (let i = 0; i < list.length; i += cols) {
        const chunk = list.slice(i, i + cols);
        chunk.forEach((u, k) => slots.push({ u, row, col: k - (chunk.length - 1) / 2 }));
        row++;
      }
    }
    const rows = row;
    // compact groups keep formation pace; scattered ones just converge
    let spread = 0;
    for (const u of units) spread = Math.max(spread, Math.hypot(u.x - cx, u.y - cy));
    const military = units.some((u) => u.type !== 'villager');
    const pace = military && spread < 9 ? Math.min(...units.map((u) => u.us!.speed)) : undefined;
    const taken = new Set<number>();
    for (const s of slots) {
      const back = (s.row - (rows - 1) / 2) * spacing;
      let tx = x + lx * s.col * spacing - fx * back;
      let ty = y + ly * s.col * spacing - fy * back;
      const key = (a: number, b: number) => Math.floor(a * 2) + Math.floor(b * 2) * 4096;
      if (!this.walkableAt(tx, ty) || taken.has(key(tx, ty))) {
        const w = this.nearestWalkable(tx, ty, 4);
        if (w) {
          tx = w.x + ((s.u.id % 5) - 2) * 0.08;
          ty = w.y + ((s.u.id % 3) - 1) * 0.08;
        } else {
          tx = x;
          ty = y;
        }
      }
      taken.add(key(tx, ty));
      send(s.u, tx, ty, pace);
    }
  }

  /** march in formation and fight whatever is met on the way, then carry on */
  attackMove(units: Entity[], x: number, y: number) {
    const fighters = units.filter((u) => u.type !== 'villager');
    const vills = units.filter((u) => u.type === 'villager');
    if (vills.length) this.groupMove(vills, x, y);
    if (!fighters.length) return;
    this.groupMove(fighters, x, y);
    for (const u of fighters) u.amove = { x: u.order!.x, y: u.order!.y };
  }

  orderAttack(u: Entity, t: Entity, auto: boolean) {
    if (!auto) {
      u.amove = null;
      u.guard = null;
    }
    u.order = { type: 'attack', x: t.x, y: t.y, target: t.id, auto };
    u.path = null;
    u.fails = 0;
    u.repath = 0;
  }

  orderGather(u: Entity, t: Entity) {
    if (u.type !== 'villager' || !t.resType) return;
    u.amove = null;
    u.order = { type: 'gather', x: t.x, y: t.y, target: t.id, resType: t.resType, phase: 'go' };
    if (u.carry > 0 && u.carryType !== t.resType) u.order.phase = 'return';
    u.path = null;
    u.fails = 0;
    u.repath = 0;
  }

  orderBuild(u: Entity, b: Entity) {
    u.amove = null;
    u.order = { type: 'build', x: b.x, y: b.y, target: b.id };
    u.path = null;
    u.fails = 0;
    u.repath = 0;
  }

  // -------------------------------------------------------------------------
  // simulation
  // -------------------------------------------------------------------------
  step() {
    if (this.winner !== -2) return;
    this.tick++;
    this.rebuildHash();
    for (const e of this.entities.values()) {
      if (e.dead) continue;
      if (e.kind === 'building') this.updateBuilding(e);
    }
    for (const e of this.entities.values()) {
      if (e.dead || e.kind !== 'unit') continue;
      this.updateUnit(e);
    }
    this.separate();
    this.updateProjectiles();
    this.recountPop();
    if (this.tick % 4 === 0) this.computeVisibility();
    if (this.tick % 20 === 0) this.checkVictory();
  }

  private updateUnit(u: Entity) {
    if (u.cooldown > 0) u.cooldown--;
    const o = u.order;
    if (!o) {
      u.anim = Anim.IDLE;
      if (u.amove) {
        // a fight on the march is over: carry on to the destination
        u.order = { type: 'move', x: u.amove.x, y: u.amove.y, target: 0 };
        u.path = null;
        return;
      }
      if (!u.guard) u.guard = { x: u.x, y: u.y };
      if ((this.tick + u.id) % 8 === 0) this.autoAcquire(u);
      if (!u.order && u.stance === 1 && Math.hypot(u.x - u.guard.x, u.y - u.guard.y) > 1.5 && (this.tick + u.id) % 8 === 4) {
        // defensive: walk back to post
        u.order = { type: 'move', x: u.guard.x, y: u.guard.y, target: 0 };
        u.path = null;
      }
      return;
    }
    switch (o.type) {
      case 'move':
        if (u.amove && (this.tick + u.id) % 6 === 0) {
          const t = this.findEnemyNear(u.owner, u.x, u.y, u.us!.los, true);
          if (t) {
            this.orderAttack(u, t, true);
            break;
          }
        }
        if (!u.path) {
          this.pathToPoint(u, o.x, o.y);
          const np = u.path as Vec2[] | null;
          if (!np || !np.length) {
            this.idle(u);
            break;
          }
        }
        if (this.followPath(u) && u.path) {
          this.idle(u);
          u.amove = null;
        }
        break;
      case 'attack':
        this.doAttack(u, o);
        break;
      case 'gather':
        this.doGather(u, o);
        break;
      case 'build':
        this.doBuild(u, o);
        break;
    }
  }

  private autoAcquire(u: Entity) {
    if (u.type === 'villager') return;
    const hold = u.stance === 2;
    const t = this.findEnemyNear(u.owner, u.x, u.y, hold ? u.us!.range + 1.2 : u.us!.los, true);
    if (t && (!hold || this.distTo(u, t) <= u.us!.range + 0.3)) this.orderAttack(u, t, true);
  }

  /** nearest visible enemy unit (or building if none) */
  findEnemyNear(owner: number, x: number, y: number, radius: number, includeBuildings: boolean): Entity | null {
    let best: Entity | null = null;
    let bd = radius * radius;
    const c = 4;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c);
    for (let gy = cy - r; gy <= cy + r; gy++)
      for (let gx = cx - r; gx <= cx + r; gx++) {
        const list = this.hash.get(gx + gy * 1024);
        if (!list) continue;
        for (const e of list) {
          if (e.dead || !this.isEnemy(owner, e.owner)) continue;
          const d = (e.x - x) ** 2 + (e.y - y) ** 2;
          if (d < bd && this.visibleTo(owner, e)) {
            bd = d;
            best = e;
          }
        }
      }
    if (best || !includeBuildings) return best;
    bd = radius * radius;
    for (const e of this.entities.values()) {
      // walls are only attacked when ordered, or when they stand in the way
      if (e.kind !== 'building' || isWall(e.type) || !this.isEnemy(owner, e.owner)) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd && this.visibleTo(owner, e)) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private doAttack(u: Entity, o: Order) {
    const t = this.entities.get(o.target);
    if (!t || t.dead) {
      if (o.resume) {
        // the wall is down: back to what we were doing
        u.order = o.resume;
        u.path = null;
        u.fails = 0;
        u.repath = 0;
        return;
      }
      this.idle(u);
      if (u.type !== 'villager') this.autoAcquire(u);
      return;
    }
    if (t.kind === 'unit') {
      if (!this.visibleTo(u.owner, t)) {
        // lost sight: march to the last known position, then give up
        if (o.auto) {
          this.idle(u);
          return;
        }
        if (!u.path) this.pathToPoint(u, o.x, o.y);
        if (this.followPath(u) && u.path) {
          this.idle(u);
          this.autoAcquire(u);
        }
        return;
      }
      o.x = t.x;
      o.y = t.y;
    }
    // auto-acquired targets: don't chase forever; stances limit it further
    if (o.auto) {
      const st = u.amove ? 0 : (u.stance ?? 0);
      const g = u.guard;
      const tooFar =
        st === 2 ? this.distTo(u, t) > u.us!.range + 0.3
        : st === 1 && g ? Math.hypot(t.x - g.x, t.y - g.y) > u.us!.los + 1
        : Math.hypot(t.x - u.x, t.y - u.y) > u.us!.los + 3;
      if (tooFar) {
        this.idle(u);
        return;
      }
    }
    const range = u.us!.range;
    if (this.approach(u, t, range)) {
      this.face(u, t);
      u.anim = Anim.ATTACK;
      if (u.cooldown <= 0) {
        this.performAttack(u, t);
        u.cooldown = u.us!.cooldownTicks;
      }
    } else if (u.fails > 4) this.idle(u);
  }

  private performAttack(u: Entity, t: Entity) {
    const def = u.us!.def;
    let atk = u.us!.attack;
    if (def.charge && this.tick - u.lastFight > TICK_RATE * 8) atk += def.charge;
    u.lastFight = this.tick;
    if (def.ranged) {
      this.fireProjectile(u.id, u.owner, u.x, u.y, t, atk, def.bonus, 'arrow');
    } else {
      this.applyDamage(u, u.owner, t, atk, def.bonus, false);
      this.emit({ e: 'hit', tg: t.id, a: u.id, x: r2(t.x), y: r2(t.y) }, t.x, t.y);
    }
  }

  private fireProjectile(attacker: number, owner: number, sx: number, sy: number, t: Entity, atk: number, bonus: Partial<Record<TargetClass, number>> | undefined, k: 'arrow' | 'bolt') {
    const d = Math.hypot(t.x - sx, t.y - sy);
    const ticks = Math.max(2, Math.round((d / PROJECTILE_SPEED) * TICK_RATE));
    this.projectiles.push({ attacker, owner, target: t.id, ticks, atk, bonus });
    const ev: GameEvent = { e: 'proj', a: attacker, tg: t.id, sx: r2(sx), sy: r2(sy), tx: r2(t.x), ty: r2(t.y), d: ticks, k };
    this.emit(ev, sx, sy, { also: t.owner });
  }

  private updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (--p.ticks > 0) continue;
      this.projectiles.splice(i, 1);
      const t = this.entities.get(p.target);
      if (!t || t.dead) continue;
      const src = this.entities.get(p.attacker) ?? null;
      this.applyDamage(src, p.owner, t, p.atk, p.bonus, true);
    }
  }

  applyDamage(src: Entity | null, srcOwner: number, t: Entity, atk: number, bonus: Partial<Record<TargetClass, number>> | undefined, pierce: boolean) {
    if (t.kind === 'resource') return;
    let armor: number, cls: TargetClass;
    if (t.kind === 'unit') {
      armor = pierce ? t.us!.armorPierce : t.us!.armorMelee;
      cls = t.us!.def.cls;
    } else {
      armor = pierce ? t.bs!.def.armor.pierce : t.bs!.def.armor.melee;
      cls = 'building';
    }
    const dmg = Math.max(1, atk + (bonus?.[cls] ?? 0) - armor);
    t.hp -= dmg;
    const owner = this.players[t.owner];
    if (owner && srcOwner !== t.owner && this.tick - owner.lastAlert > TICK_RATE * 10) {
      owner.lastAlert = this.tick;
      this.emit({ e: 'alert', x: r2(t.x), y: r2(t.y) }, t.x, t.y, { only: t.owner });
    }
    if (t.hp <= 0) {
      this.kill(t, srcOwner);
      return;
    }
    // retaliation
    if (t.kind === 'unit' && t.owner !== srcOwner) {
      t.lastFight = this.tick;
      if (t.type !== 'villager' && src && !src.dead && src.kind === 'unit') {
        const o = t.order;
        const cur = o?.type === 'attack' ? this.entities.get(o.target) : undefined;
        if (!o || (o.type === 'attack' && o.auto && (!cur || cur.kind === 'building'))) this.orderAttack(t, src, true);
      }
    }
  }

  kill(e: Entity, killer: number) {
    if (e.dead) return;
    const p = this.players[e.owner];
    const k = e.kind === 'unit' ? 0 : 1;
    this.emit({ e: 'die', i: e.id, x: r2(e.x), y: r2(e.y), t: e.type, o: e.owner, k }, e.x, e.y, { also: e.owner });
    if (p) {
      if (e.kind === 'unit') p.stats.unitsLost++;
      else p.stats.buildingsLost++;
    }
    const kp = this.players[killer];
    if (kp && killer !== e.owner) {
      if (e.kind === 'unit') kp.stats.kills++;
      else kp.stats.razed++;
    }
    // refund queued units when a building dies
    if (e.kind === 'building' && p) for (const q of e.queue) pay(p.res, this.queueCost(p, q), 1);
    e.queue = [];
    this.removeEntity(e);
  }

  private doGather(u: Entity, o: Order) {
    let t = this.entities.get(o.target);
    const valid = (x: Entity | undefined): boolean =>
      !!x && !x.dead && x.amount > 0 &&
      (x.kind === 'resource' || (x.kind === 'building' && x.type === 'farm' && x.built && x.owner === u.owner));
    if (!valid(t)) {
      const wasFarm = (t as Entity | undefined)?.type === 'farm';
      const alt = this.findResource(u.owner, o.resType!, o.x, o.y, wasFarm ? 12 : 10, wasFarm);
      if (alt) {
        o.target = alt.id;
        o.x = alt.x;
        o.y = alt.y;
        o.wx = o.wy = undefined;
        t = alt;
        u.path = null;
        u.fails = 0;
      } else if (u.carry > 0) {
        o.phase = 'return';
        t = undefined;
      } else {
        this.idle(u);
        return;
      }
    }
    const cap = carryCapacity(this.players[u.owner].techs);
    if (o.phase === 'return' || u.carry >= cap) {
      if (o.phase !== 'return') {
        o.phase = 'return';
        u.path = null;
        u.repath = 0;
      }
      const drop = u.carryType ? this.nearestDropoff(u, u.carryType) : null;
      if (!drop) {
        u.anim = Anim.IDLE;
        return;
      }
      if (this.approach(u, drop, INTERACT_RANGE)) {
        const p = this.players[u.owner];
        const ct = u.carryType!;
        p.res[ct] += u.carry;
        p.stats.gathered[ct] += u.carry;
        u.carry = 0;
        o.phase = 'go';
        o.wx = o.wy = undefined;
        u.path = null;
        u.repath = 0;
        if (!t) this.idle(u);
      } else if (u.fails > 4) this.idle(u);
      return;
    }
    if (!t) return;
    const farm = t.type === 'farm';
    if (farm ? this.toFarmSpot(u, t, o) : this.approach(u, t, INTERACT_RANGE)) {
      if (!farm) this.face(u, t);
      u.anim = Anim.GATHER;
      if (u.carryType !== o.resType) {
        u.carryType = o.resType!;
        u.carry = 0;
      }
      const gp = this.players[u.owner];
      const amt = Math.min(t.amount, gatherRate(gp.civ, o.resType!, t.kind === 'building' ? 'farm' : 'node', gp.techs) / TICK_RATE);
      u.carry += amt;
      t.amount -= amt;
      if (t.kind === 'resource') this.changedRes.add(t.id);
      if (t.amount <= 1e-6) {
        if (t.kind === 'resource') this.removeEntity(t);
        else this.kill(t, -1);
      }
      if (u.carry >= cap - 1e-6) {
        u.carry = cap;
        o.phase = 'return';
        u.path = null;
        u.repath = 0;
      }
    } else if (u.fails > 4) {
      // unreachable — try another node next tick
      const alt = this.findResource(u.owner, o.resType!, u.x, u.y, 8);
      if (alt && alt.id !== t.id) {
        o.target = alt.id;
        u.fails = 0;
        u.path = null;
      } else this.idle(u);
    }
  }

  private doBuild(u: Entity, o: Order) {
    const b = this.entities.get(o.target);
    if (!b || b.dead || b.owner !== u.owner || b.kind !== 'building') {
      this.idle(u);
      return;
    }
    if (b.built) {
      if (b.type === 'farm') {
        this.orderGather(u, b);
        return;
      }
      // help with the nearest unfinished foundation (walls are built section by section this way)
      let next: Entity | null = null;
      let nd = 10;
      for (const e of this.entities.values()) {
        if (e.kind !== 'building' || e.owner !== u.owner || e.built) continue;
        const d = Math.hypot(e.x - u.x, e.y - u.y);
        if (d < nd) {
          nd = d;
          next = e;
        }
      }
      if (next) {
        this.orderBuild(u, next);
        return;
      }
      // go back to a nearby resource if this was a dropoff
      if (b.bs!.def.dropoff.length && b.type !== 'town_center') {
        let best: Entity | null = null;
        for (const rt of ['wood', 'gold', 'stone'] as ResourceType[]) {
          const r = this.findResource(u.owner, rt, b.x, b.y, 6);
          if (r && (!best || Math.hypot(r.x - b.x, r.y - b.y) < Math.hypot(best.x - b.x, best.y - b.y))) best = r;
        }
        if (best) {
          this.orderGather(u, best);
          return;
        }
      }
      this.idle(u);
      return;
    }
    if (this.approach(u, b, INTERACT_RANGE)) {
      this.face(u, b);
      u.anim = Anim.BUILD;
      b.builders++;
    } else if (u.fails > 4) this.idle(u);
  }

  private updateBuilding(b: Entity) {
    const p = this.players[b.owner];
    if (!b.built) {
      if (b.builders > 0) {
        const n = b.builders;
        const rate = (1 + (n - 1) * 0.55) / (b.bs!.buildTime * TICK_RATE);
        b.progress = Math.min(1, b.progress + rate);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * rate);
        if (b.progress >= 1) {
          b.built = true;
          b.progress = 1;
          p.stats.buildingsBuilt++;
          this.emit({ e: 'built', i: b.id, t: b.type }, b.x, b.y, { only: b.owner });
        }
      }
      b.builders = 0;
      return;
    }
    // training
    if (b.queue.length && b.queue[0].tech) {
      const q = b.queue[0];
      const def = TECHS[q.type as unknown as TechId];
      q.progress += 1 / (def.time * TICK_RATE);
      if (q.progress >= 1) {
        b.queue.shift();
        this.applyTech(b.owner, def.id, b);
      }
    } else if (b.queue.length) {
      const q = b.queue[0];
      const us = unitStats(p.civ, q.type, TICK_RATE);
      if (!q.started) {
        if (p.pop + us.def.pop > Math.min(p.popCap, POP_HARD_CAP)) {
          if (this.tick - p.lastPopWarn > TICK_RATE * 8) {
            p.lastPopWarn = this.tick;
            this.emit({ e: 'popcap' }, b.x, b.y, { only: b.owner });
          }
        } else {
          q.started = true;
          p.pop += us.def.pop;
        }
      }
      if (q.started) {
        q.progress += 1 / (us.trainTime * TICK_RATE);
        if (q.progress >= 1) {
          b.queue.shift();
          this.spawnTrained(b, q.type);
        }
      }
    }
    // defensive fire
    const atk = b.bs!.def.attack;
    if (atk) {
      if (b.cooldown > 0) b.cooldown--;
      else {
        const range = b.bs!.attackRange;
        let best: Entity | null = null;
        let bd = Infinity;
        const r = range + b.size;
        const c = 4;
        const gr = Math.ceil(r / c);
        const cx = Math.floor(b.x / c), cy = Math.floor(b.y / c);
        for (let gy = cy - gr; gy <= cy + gr; gy++)
          for (let gx = cx - gr; gx <= cx + gr; gx++) {
            const list = this.hash.get(gx + gy * 1024);
            if (!list) continue;
            for (const e of list) {
              if (e.dead || !this.isEnemy(b.owner, e.owner)) continue;
              const d = this.distTo(e, b);
              if (d <= range && d < bd) {
                bd = d;
                best = e;
              }
            }
          }
        if (best) {
          this.fireProjectile(b.id, b.owner, b.x, b.y, best, b.bs!.attackDamage, undefined, 'arrow');
          b.cooldown = Math.round(atk.cooldown * TICK_RATE);
        }
      }
    }
  }

  private spawnTrained(b: Entity, type: UnitType) {
    const p = this.players[b.owner];
    const want = b.rally ?? { x: b.x, y: b.ty + b.size + 1, target: 0 };
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (let r = 0; r < 4 && !best; r++) {
      for (let y = b.ty - 1 - r; y <= b.ty + b.size + r; y++)
        for (let x = b.tx - 1 - r; x <= b.tx + b.size + r; x++) {
          const onRing = x === b.tx - 1 - r || x === b.tx + b.size + r || y === b.ty - 1 - r || y === b.ty + b.size + r;
          if (!onRing || !this.walkable(x, y)) continue;
          const d = (x + 0.5 - want.x) ** 2 + (y + 0.5 - want.y) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: x + 0.5, y: y + 0.5 };
          }
        }
    }
    if (!best) best = { x: b.x, y: b.ty + b.size + 0.5 };
    const u = this.spawnUnit(b.owner, type, best.x, best.y);
    u.facing = Math.atan2(want.y - best.y, want.x - best.x);
    p.stats.unitsTrained++;
    this.emit({ e: 'trained', i: u.id, t: type }, u.x, u.y, { only: b.owner });
    if (b.rally) {
      const t = b.rally.target ? this.entities.get(b.rally.target) : undefined;
      if (t && t.resType && type === 'villager' && (t.kind === 'resource' || (t.type === 'farm' && t.owner === b.owner))) this.orderGather(u, t);
      else if (t && t.kind === 'building' && t.owner === b.owner && !t.built && type === 'villager') this.orderBuild(u, t);
      else if (t && this.isEnemy(b.owner, t.owner)) this.orderAttack(u, t, false);
      else {
        const rx = b.rally.x + (((u.id * 37) % 13) / 13 - 0.5) * 1.2, ry = b.rally.y + (((u.id * 71) % 11) / 11 - 0.5) * 1.2;
        u.order = { type: 'move', x: rx, y: ry, target: 0 };
        u.guard = { x: rx, y: ry };
      }
    }
  }

  /** techs being researched anywhere by this player */
  queuedTechs(slot: number): string[] {
    const out: string[] = [];
    for (const e of this.entities.values()) {
      if (e.kind !== 'building' || e.owner !== slot) continue;
      for (const q of e.queue) if (q.tech) out.push(q.type);
    }
    return out;
  }

  private queueCost(p: SimPlayer, q: Entity['queue'][number]) {
    return q.tech ? TECHS[q.type as unknown as TechId].cost : unitStats(p.civ, q.type, TICK_RATE).cost;
  }

  /** a tech finished: record it and refresh every unit's and building's stats */
  applyTech(slot: number, id: TechId, at?: Entity) {
    const p = this.players[slot];
    if (!p || p.techs.includes(id)) return;
    p.techs.push(id);
    p.age = techMods(p.techs).age;
    for (const e of this.entities.values()) {
      if (e.owner !== slot) continue;
      if (e.kind === 'unit') {
        const us = unitStats(p.civ, e.type as UnitType, TICK_RATE, p.techs);
        e.hp += us.maxHp - e.maxHp;
        e.maxHp = us.maxHp;
        e.us = us;
      } else if (e.kind === 'building') {
        e.bs = buildingStats(p.civ, e.type as BuildingType, p.techs);
      }
    }
    const age = !!TECHS[id].effect.age;
    this.emit({ e: 'researched', t: id, o: slot }, at?.x ?? 0, at?.y ?? 0, age ? { all: true } : { only: slot });
  }

  private rebuildHash() {
    this.hash.clear();
    for (const e of this.entities.values()) {
      if (e.kind !== 'unit' || e.dead) continue;
      const k = Math.floor(e.x / 4) + Math.floor(e.y / 4) * 1024;
      let l = this.hash.get(k);
      if (!l) this.hash.set(k, (l = []));
      l.push(e);
    }
  }

  private separate() {
    for (const list of this.hash.values()) {
      for (const u of list) {
        if (u.dead) continue;
        const ru = unitRadius(u);
        const cx = Math.floor(u.x / 4), cy = Math.floor(u.y / 4);
        for (let gy = cy - 1; gy <= cy + 1; gy++)
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            const l2 = this.hash.get(gx + gy * 1024);
            if (!l2) continue;
            for (const v of l2) {
              if (v.id <= u.id || v.dead) continue;
              const min = ru + unitRadius(v);
              let dx = v.x - u.x, dy = v.y - u.y;
              let d2 = dx * dx + dy * dy;
              if (d2 >= min * min) continue;
              if (d2 < 1e-8) {
                const a = ((u.id * 7919 + v.id) % 628) / 100;
                dx = Math.cos(a) * 0.01;
                dy = Math.sin(a) * 0.01;
                d2 = 1e-4;
              }
              const d = Math.sqrt(d2);
              const overlap = (min - d) * 0.5;
              const nx = dx / d, ny = dy / d;
              // stationary units yield to moving ones
              const um = u.anim === Anim.WALK, vm = v.anim === Anim.WALK;
              let wu = 0.5, wv = 0.5;
              if (um && !vm) { wu = 0.25; wv = 0.75; }
              else if (vm && !um) { wu = 0.75; wv = 0.25; }
              const ux = u.x - nx * overlap * wu * 2, uy = u.y - ny * overlap * wu * 2;
              const vx = v.x + nx * overlap * wv * 2, vy = v.y + ny * overlap * wv * 2;
              if (this.passableAt(ux, uy, u.owner)) { u.x = ux; u.y = uy; }
              if (this.passableAt(vx, vy, v.owner)) { v.x = vx; v.y = vy; }
            }
          }
        // pushed into a blocked tile (e.g. a building was placed on us)
        if (!this.passableAt(u.x, u.y, u.owner)) {
          const w = this.nearestWalkable(u.x, u.y, 8, u.owner);
          if (w) {
            u.x = w.x;
            u.y = w.y;
            u.path = null;
          }
        }
        u.x = Math.min(this.size - 0.05, Math.max(0.05, u.x));
        u.y = Math.min(this.size - 0.05, Math.max(0.05, u.y));
      }
    }
  }

  private recountPop() {
    for (const p of this.players) {
      p.pop = 0;
      p.popCap = 0;
    }
    for (const e of this.entities.values()) {
      const p = this.players[e.owner];
      if (!p) continue;
      if (e.kind === 'unit') p.pop += e.us!.def.pop;
      else if (e.kind === 'building') {
        if (e.built) p.popCap += e.bs!.def.pop;
        for (const q of e.queue) if (q.started && !q.tech) p.pop += UNITS[q.type].pop;
      }
    }
    for (const p of this.players) p.popCap = Math.min(POP_HARD_CAP, p.popCap);
  }

  private static circles = new Map<number, Int16Array>();
  private static circle(r: number): Int16Array {
    let c = World.circles.get(r);
    if (c) return c;
    const pts: number[] = [];
    const rr = (r + 0.5) * (r + 0.5);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= rr) pts.push(dx, dy);
    c = Int16Array.from(pts);
    World.circles.set(r, c);
    return c;
  }

  computeVisibility() {
    for (const p of this.players) p.visible.fill(0);
    const size = this.size;
    for (const e of this.entities.values()) {
      if (e.owner < 0 || e.dead) continue;
      const p = this.players[e.owner];
      if (!p) continue;
      const los = e.kind === 'unit' ? e.us!.los : e.built ? e.bs!.def.los + Math.floor(e.size / 2) : 2;
      const c = World.circle(Math.round(los));
      const cx = Math.floor(e.x), cy = Math.floor(e.y);
      const vis = p.visible;
      for (let i = 0; i < c.length; i += 2) {
        const x = cx + c[i], y = cy + c[i + 1];
        if (x >= 0 && y >= 0 && x < size && y < size) vis[y * size + x] = 1;
      }
    }
  }

  private checkVictory() {
    const has = new Array(this.players.length).fill(false);
    for (const e of this.entities.values()) {
      if (e.owner < 0) continue;
      if (e.kind === 'unit' || (e.kind === 'building' && e.type !== 'farm' && !isWall(e.type))) has[e.owner] = true;
    }
    for (const p of this.players) {
      if (p.alive && !has[p.slot]) {
        p.alive = false;
        this.emit({ e: 'defeat', o: p.slot }, 0, 0, { all: true });
        // remove remaining farms
        for (const e of this.entities.values()) if (e.owner === p.slot) this.removeEntity(e);
      }
    }
    const alive = this.players.filter((p) => p.alive);
    if (this.multiPlayerStart && alive.length <= 1) this.winner = alive.length ? alive[0].slot : -1;
    if (!this.multiPlayerStart && alive.length === 0) this.winner = -1;
  }

  resign(slot: number) {
    const p = this.players[slot];
    if (!p || !p.alive) return;
    for (const e of [...this.entities.values()]) if (e.owner === slot) this.kill(e, -1);
  }
}

export function r2(v: number) {
  return Math.round(v * 100) / 100;
}
