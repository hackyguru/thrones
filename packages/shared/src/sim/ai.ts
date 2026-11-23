import { TICK_RATE } from '../constants';
import { CIVS } from '../data/civs';
import { buildingStats, canAfford, trainable, unitAge, unitStats } from '../data/stats';
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { TECHS, techBlocker, type TechId } from '../data/techs';
import { mulberry32, type Rng } from '../rng';
import type { BuildingType, CivId, Cost, Difficulty, ResourceType, UnitType } from '../types';
import type { Entity, World } from './world';

/**
 * How each difficulty plays. Harder levels never get extra resources or vision: they simply
 * manage the economy better, read the enemy army, retreat from lost fights and raid.
 */
interface Profile {
  /** villager target */
  vills: number;
  /** seconds until the first attack, then between attacks */
  firstAttack: number;
  interval: number;
  wave0: number;
  waveGrow: number;
  /** 0..1 how strictly it builds counters to what it has seen */
  counter: number;
  retreat: boolean;
  /** villagers run home from raiders */
  flee: boolean;
  /** cavalry raids on enemy villagers */
  raid: boolean;
  /** archers pick off wounded units, melee goes for archers */
  focus: boolean;
  /** production buildings it is willing to own */
  maxProd: number;
  towers: number;
  /** base defense radius */
  defendR: number;
  /** villager counts at which it advances to age II / III */
  age2: number;
  age3: number;
  /** upgrades it researches, in priority order */
  techs: TechId[];
  /** standing army it keeps per minute after minute 4 */
  armyRate: number;
  /** most soldiers it will field */
  maxArmy: number;
  /** ticks between decisions (faster = sharper reactions) */
  think?: number;
  /** splits villagers by age and stockpiles, and rebalances them often */
  smartEco?: boolean;
}

const ECO: TechId[] = ['iron_axe', 'mining_picks', 'bullock_carts', 'irrigation', 'bow_saw', 'deep_shafts'];
const ARMS: TechId[] = ['forging', 'fletching', 'lamellar', 'quilted', 'wootz_steel', 'mail'];

export const PROFILES: Record<Difficulty, Profile> = {
  guided: { vills: 12, firstAttack: 1200, interval: 240, wave0: 4, waveGrow: 1, counter: 0, retreat: false, flee: false, raid: false, focus: false, maxProd: 1, towers: 0, defendR: 12, age2: 99, age3: 99, techs: [], armyRate: 0.4, maxArmy: 8 },
  easy: { vills: 16, firstAttack: 540, interval: 170, wave0: 4, waveGrow: 2, counter: 0.15, retreat: false, flee: false, raid: false, focus: false, maxProd: 2, towers: 0, defendR: 12, age2: 16, age3: 99, techs: ['iron_axe'], armyRate: 0.8, maxArmy: 12 },
  normal: { vills: 28, firstAttack: 360, interval: 110, wave0: 7, waveGrow: 3, counter: 0.55, retreat: true, flee: false, raid: false, focus: false, maxProd: 4, towers: 1, defendR: 18, age2: 15, age3: 26, techs: ['iron_axe', 'mining_picks', 'forging', 'bullock_carts', 'fletching', 'lamellar', 'irrigation'], armyRate: 2.6, maxArmy: 60 },
  hard: { vills: 38, firstAttack: 345, interval: 105, wave0: 8, waveGrow: 3, counter: 0.85, retreat: true, flee: true, raid: true, focus: true, maxProd: 6, towers: 2, defendR: 22, age2: 15, age3: 25, techs: [...ECO.slice(0, 2), 'forging', 'bullock_carts', 'fletching', 'lamellar', 'irrigation', 'quilted', 'bow_saw', 'deep_shafts', 'wootz_steel', 'mail'], armyRate: 3.2, maxArmy: 80, smartEco: true },
  raja: { vills: 42, firstAttack: 300, interval: 90, wave0: 10, waveGrow: 3, counter: 1, retreat: true, flee: true, raid: true, focus: true, maxProd: 7, towers: 3, defendR: 26, age2: 13, age3: 25, techs: [...ECO.slice(0, 2), 'forging', 'bullock_carts', 'fletching', 'lamellar', 'irrigation', 'quilted', 'bow_saw', 'deep_shafts', 'wootz_steel', 'mail'], armyRate: 4.2, maxArmy: 110, think: 5, smartEco: true },
};

const PROD: BuildingType[] = ['barracks', 'archery_range', 'stable'];

/** rough fighting value of a unit: sqrt(hp × damage per second) */
function power(e: Entity): number {
  if (e.kind === 'building') return e.bs!.def.attack ? 9 : 0;
  const us = e.us!;
  return Math.sqrt(Math.max(1, e.hp) * (us.attack / us.def.cooldown)) * (us.def.cls === 'villager' ? 0.3 : 1);
}

export interface AISave {
  slot: number;
  wave: number;
  nextAttack: number;
  attacking: number[];
  raiders?: number[];
  raidUntil?: number;
  nextRaid?: number;
  seen?: [number, string, number, number, number][];
}

/** Scripted AI: boom, scout the enemy army by sight, build counters, attack in waves, retreat and raid. */
export class AIController {
  private rng: Rng;
  private wave = 0;
  private nextAttack: number;
  private attacking = new Set<number>();
  private raiders = new Set<number>();
  private raidUntil = 0;
  private nextRaid: number;
  /** enemy units we have seen: id -> type, last position, tick */
  private seen = new Map<number, { type: string; x: number; y: number; t: number }>();
  /** villagers fleeing raiders, until tick */
  private fleeing = new Map<number, number>();
  private p: Profile;

  constructor(
    private w: World,
    public slot: number,
    seed: number,
    difficulty: Difficulty = 'normal',
  ) {
    this.rng = mulberry32(seed ^ (slot * 7919));
    this.p = PROFILES[difficulty] ?? PROFILES.normal;
    this.nextAttack = TICK_RATE * this.p.firstAttack;
    this.nextRaid = TICK_RATE * 420;
  }

  /** how often the session should call update() */
  get thinkTicks() {
    return this.p.think ?? TICK_RATE / 2;
  }

  save(): AISave {
    return {
      slot: this.slot, wave: this.wave, nextAttack: this.nextAttack, attacking: [...this.attacking],
      raiders: [...this.raiders], raidUntil: this.raidUntil, nextRaid: this.nextRaid,
      seen: [...this.seen].map(([id, s]) => [id, s.type, s.x, s.y, s.t]),
    };
  }

  load(d: AISave, tick: number) {
    this.wave = d.wave;
    this.nextAttack = d.nextAttack;
    this.attacking = new Set(d.attacking);
    this.raiders = new Set(d.raiders ?? []);
    this.raidUntil = d.raidUntil ?? 0;
    this.nextRaid = d.nextRaid ?? this.nextRaid;
    this.seen = new Map((d.seen ?? []).map(([id, type, x, y, t]) => [id, { type, x, y, t }]));
    this.rng = mulberry32((this.slot * 7919) ^ tick);
  }

  update() {
    const w = this.w;
    const p = w.players[this.slot];
    if (!p || !p.alive) return;
    const civ = p.civ;
    const P = this.p;

    const villagers: Entity[] = [];
    const military: Entity[] = [];
    const buildings = new Map<BuildingType, Entity[]>();
    const enemies: Entity[] = [];
    for (const e of w.entities.values()) {
      if (e.owner === this.slot) {
        if (e.kind === 'unit') (e.type === 'villager' ? villagers : military).push(e);
        else if (e.kind === 'building') {
          const t = e.type as BuildingType;
          if (!buildings.has(t)) buildings.set(t, []);
          buildings.get(t)!.push(e);
        }
      } else if (e.kind === 'unit' && w.isEnemy(this.slot, e.owner) && w.visibleTo(this.slot, e)) {
        enemies.push(e);
        this.seen.set(e.id, { type: e.type, x: e.x, y: e.y, t: w.tick });
      }
    }
    for (const [id, s] of this.seen) if (!w.entities.has(id) || w.tick - s.t > TICK_RATE * 150) this.seen.delete(id);
    const list = (t: BuildingType) => buildings.get(t) ?? [];
    const tc = list('town_center')[0];
    const home = tc ?? (villagers[0] || military[0]);
    if (!home) return;
    const unfinished = [...buildings.values()].flat().filter((b) => !b.built);
    const prodCount = PROD.reduce((n, t) => n + list(t).length, 0);

    // --- villagers (paused while saving food for the next age, as a good player would) ---
    const nextAge: TechId | null = p.age === 1 ? 'age2' : p.age === 2 ? 'age3' : null;
    const ageReady = !!nextAge && villagers.length >= (nextAge === 'age2' ? P.age2 : P.age3) && !techBlocker(nextAge, p.techs, w.queuedTechs(this.slot));
    // keep a standing army while saving up, and never save while the base is under attack
    const minArmy = Math.floor(P.wave0 * (p.age === 1 ? 0.5 : 1.2));
    const underAttack = !!w.findEnemyNear(this.slot, home.x, home.y, P.defendR, false);
    const saving = ageReady && military.length >= minArmy && !underAttack;
    // a standing army that grows with game time comes before more villagers
    const armyFloor = Math.min(50, Math.max(0, Math.floor((w.tick / TICK_RATE / 60 - 3) * P.armyRate)));
    const armyBehind = military.length < armyFloor;
    if (tc && tc.built && !saving && tc.queue.length < 2 && villagers.length + tc.queue.length < P.vills && p.res.food >= (armyBehind ? 140 : 50)) {
      w.command(this.slot, { c: 'train', building: tc.id, type: 'villager' });
    }

    // --- construction ---
    const ok = (t: BuildingType) => BUILDINGS[t].age <= p.age;
    const tryBuild = (type: BuildingType, near: { x: number; y: number }, minR: number, maxR: number) => {
      if (!ok(type)) return false;
      const bs = buildingStats(civ, type);
      if (!canAfford(p.res, bs.cost)) return false;
      const spot = w.findPlacement(type, near.x, near.y, minR, maxR, this.rng);
      if (!spot) return false;
      const builder = this.pickBuilder(villagers);
      if (!builder) return false;
      w.command(this.slot, { c: 'build', ids: [builder.id], type, tx: spot.x, ty: spot.y });
      return true;
    };

    const housesBuilding = unfinished.filter((b) => b.type === 'house').length;
    const prodRate = 4 + prodCount * 2;
    if (p.popCap < 200 && p.popCap - p.pop < prodRate && housesBuilding < 1 + (villagers.length > 15 ? 1 : 0) + (prodCount > 3 ? 1 : 0)) {
      tryBuild('house', home, 4, 15);
    }
    const best = this.bestUnits(civ);
    // drop-off sites near busy, distant resources come first: walking is the biggest economic loss
    if (villagers.length >= 7 && !unfinished.some((b) => b.type === 'storehouse') && list('storehouse').length < 2 + Math.floor(villagers.length / 10)) this.expand(tryBuild, villagers, home);
    const nvAll = villagers.length;
    const farmWant = this.berriesLeft(home) < 3 ? Math.floor(nvAll * 0.35) : nvAll >= 14 ? Math.floor((nvAll - 10) * 0.3) : 0;
    if (unfinished.length < 2 + (P.maxProd > 4 ? 1 : 0)) {
      const nv = villagers.length;
      const has = (t: BuildingType) => list(t).length;
      if (!tc && nv > 0) tryBuild('town_center', home, 0, 10);
      else if (nv >= 6 && has('storehouse') < 1) this.buildStorehouse(tryBuild, home, 'wood');
      else if (nv >= 9 && has('barracks') < 1) tryBuild('barracks', home, 6, 14);
      else if (nv >= 12 && has('storehouse') < 2) this.buildStorehouse(tryBuild, home, 'gold');
      else if (has('farm') < farmWant) tryBuild('farm', home, 3, 11);
      else if (nv >= 14 && ok('archery_range') && has('archery_range') < 1) tryBuild('archery_range', home, 6, 15);
      else if (nv >= 17 && ok('stable') && has('stable') < 1) tryBuild('stable', home, 6, 15);
      else if (nv >= 18 && ok('blacksmith') && has('blacksmith') < 1 && P.techs.some((t) => TECHS[t].at === 'blacksmith')) tryBuild('blacksmith', home, 5, 14);
      else if (nv >= 20 && ok('tower') && has('tower') < P.towers) tryBuild('tower', this.towardEnemy(home, 7), 0, 5);
      else if (!this.expand(tryBuild, villagers, home) && nv >= 22 && prodCount < P.maxProd) {
        // spend a growing bank on more production of what the army needs most
        const r = p.res;
        if (r.food + r.gold + r.wood > 900 || prodCount < 3) {
          const want = best.map((u) => UNITS[u].trainedAt).find(ok) ?? 'barracks';
          tryBuild(want, home, 6, 18);
        }
      }
    }

    // --- villagers fleeing raiders ---
    for (const [id, until] of this.fleeing) if (w.tick > until || !w.entities.has(id)) this.fleeing.delete(id);
    if (P.flee && tc) {
      for (const v of villagers) {
        if (this.fleeing.has(v.id)) continue;
        const t = w.findEnemyNear(this.slot, v.x, v.y, 4, false);
        if (!t || t.type === 'villager' || Math.hypot(v.x - tc.x, v.y - tc.y) < 6) continue;
        const guards = military.filter((m) => Math.hypot(m.x - v.x, m.y - v.y) < 7).length;
        if (guards >= 2) continue;
        this.fleeing.set(v.id, w.tick + TICK_RATE * 14);
        w.groupMove([v], tc.x + (this.rng() - 0.5) * 4, tc.y + tc.size / 2 + 1);
      }
    }

    // --- gather assignment ---
    const counts: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle: Entity[] = [];
    for (const v of villagers) {
      if (v.order?.type === 'gather' && v.order.resType) counts[v.order.resType]++;
      else if (v.order?.type === 'build') continue;
      else if (!v.order && !this.fleeing.has(v.id)) idle.push(v);
    }
    for (const b of unfinished) {
      const builders = villagers.filter((v) => v.order?.type === 'build' && v.order.target === b.id).length;
      if (builders < (b.type === 'town_center' ? 3 : 1) && idle.length) w.orderBuild(idle.shift()!, b);
    }
    const n = villagers.length;
    const want: Record<ResourceType, number> = P.smartEco ? this.smartWant(n, p.age, p.res) : this.basicWant(n, p.res);
    const deficit = (rt: ResourceType) => want[rt] * n - counts[rt];
    const pickRes = () => {
      let best: ResourceType = 'food';
      let bestDef = -Infinity;
      for (const rt of Object.keys(want) as ResourceType[]) {
        if (deficit(rt) > bestDef) {
          bestDef = deficit(rt);
          best = rt;
        }
      }
      return best;
    };
    for (const v of idle) {
      const rt = pickRes();
      const target = w.findResource(this.slot, rt, home.x, home.y, 40) ?? w.findResource(this.slot, rt, home.x, home.y, 70) ?? w.findResource(this.slot, 'wood', home.x, home.y, 70);
      if (target) {
        w.orderGather(v, target);
        counts[rt]++;
      }
    }
    // better economies rebalance: move one worker from the most over-staffed resource
    const every = P.smartEco ? TICK_RATE * 2 : TICK_RATE * 4;
    if (P.counter >= 0.55 && n >= 12 && w.tick % every < TICK_RATE / 2) {
      const types = Object.keys(want) as ResourceType[];
      const over = types.reduce((a, b) => (deficit(a) < deficit(b) ? a : b));
      const under = types.reduce((a, b) => (deficit(a) > deficit(b) ? a : b));
      const gap = P.smartEco ? 1 : 1.5;
      if (deficit(over) < -gap && deficit(under) > gap) {
        const v = villagers.find((x) => x.order?.type === 'gather' && x.order.resType === over && x.carry < 2);
        const t = v && w.findResource(this.slot, under, v.x, v.y, 45);
        if (v && t) w.orderGather(v, t);
      }
    }

    // --- ages and upgrades ---
    const queued = w.queuedTechs(this.slot);
    let saveFor: Cost | null = null;
    const next: TechId | null = p.age === 1 ? 'age2' : p.age === 2 ? 'age3' : null;
    if (tc && tc.built && next && villagers.length >= (next === 'age2' ? P.age2 : P.age3) && !techBlocker(next, p.techs, queued)) {
      if (canAfford(p.res, TECHS[next].cost) && tc.queue.length < 2) w.command(this.slot, { c: 'research', building: tc.id, tech: next });
      else if (saving) saveFor = TECHS[next].cost;
    }
    const leaves = (cost: Cost) => {
      if (!canAfford(p.res, cost)) return false;
      if (!saveFor) return true;
      for (const [k, v] of Object.entries(cost) as [ResourceType, number][]) if (v && p.res[k] - v < (saveFor[k] ?? 0)) return false;
      return true;
    };
    if (villagers.length >= 8) {
      for (const id of P.techs) {
        if (techBlocker(id, p.techs, queued)) continue;
        const def = TECHS[id];
        const at = list(def.at).find((b) => b.built && b.queue.length < (def.at === 'town_center' ? 2 : 1));
        if (at && leaves(def.cost)) {
          w.command(this.slot, { c: 'research', building: at.id, tech: id });
          break;
        }
      }
    }

    // --- military production ---
    const reserveFood = villagers.length < P.vills && !armyBehind ? 50 : 0;
    const armyCap = military.length + PROD.reduce((n, t) => n + list(t).reduce((k, b) => k + b.queue.length, 0), 0) >= P.maxArmy;
    for (const t of PROD) {
      for (const b of list(t)) {
        if (armyCap || !b.built || b.queue.length >= 2) continue;
        const opts = trainable(civ, t);
        const ranked = this.bestUnits(civ, opts);
        for (const choice of ranked) {
          const cost = unitStats(civ, choice).cost;
          if (p.res.food - (cost.food ?? 0) < reserveFood || !leaves(cost)) continue;
          if (!b.rally) {
            const s = this.towardEnemy(home, 6);
            w.command(this.slot, { c: 'rally', building: b.id, x: s.x, y: s.y });
          }
          w.command(this.slot, { c: 'train', building: b.id, type: choice });
          break;
        }
      }
    }

    // --- defense: anything hostile near the town or any building ---
    for (const id of [...this.attacking]) if (!w.entities.has(id)) this.attacking.delete(id);
    for (const id of [...this.raiders]) if (!w.entities.has(id)) this.raiders.delete(id);
    let threat = w.findEnemyNear(this.slot, home.x, home.y, P.defendR, false);
    if (!threat) {
      for (const bs of buildings.values()) {
        for (const b of bs) {
          threat = w.findEnemyNear(this.slot, b.x, b.y, 6 + b.size / 2, false);
          if (threat) break;
        }
        if (threat) break;
      }
    }
    if (threat) {
      const near = enemies.filter((e) => Math.hypot(e.x - threat!.x, e.y - threat!.y) < 8);
      const enemyPow = near.reduce((s, e) => s + power(e), 0);
      const defenders = military.filter((m) => !this.attacking.has(m.id) && !this.raiders.has(m.id));
      let defPow = defenders.reduce((s, e) => s + power(e), 0);
      // big attack on the base: call the army home
      if (P.retreat && enemyPow > defPow * 1.2 && this.attacking.size) {
        for (const id of this.attacking) {
          const m = w.entities.get(id)!;
          defenders.push(m);
          defPow += power(m);
        }
        this.attacking.clear();
      }
      const busy = (m: Entity) => {
        const o = m.order;
        if (!o) return false;
        if (o.type === 'attack') return !o.auto || w.entities.get(o.target)?.kind === 'unit';
        if (o.type === 'move') return !!m.amove && Math.hypot(m.amove.x - threat!.x, m.amove.y - threat!.y) < 8;
        return true;
      };
      const fresh = defenders.filter((m) => !busy(m));
      if (fresh.length) w.attackMove(fresh, threat.x, threat.y);
      if (military.length === 0 && tc) {
        const nearVills = villagers.filter((v) => Math.hypot(v.x - threat!.x, v.y - threat!.y) < 6).slice(0, 6);
        if (threat.type !== 'elephant' && nearVills.length >= 3 && enemyPow < 25) for (const v of nearVills) w.orderAttack(v, threat, false);
      }
    }

    // --- attack waves ---
    const available = military.filter((m) => !this.attacking.has(m.id) && !this.raiders.has(m.id));
    const waveSize = Math.min(30, P.wave0 + this.wave * P.waveGrow);
    if (!threat && w.tick >= this.nextAttack && available.length >= waveSize) {
      const target = this.pickTarget(home);
      if (target) {
        w.attackMove(available, target.x, target.y);
        for (const m of available) this.attacking.add(m.id);
        this.wave++;
        this.nextAttack = w.tick + TICK_RATE * P.interval;
      }
    }
    this.manageArmy([...this.attacking], home, enemies, false);

    // --- raids ---
    if (P.raid) {
      if (!this.raiders.size && w.tick >= this.nextRaid) {
        const fast = available.filter((m) => m.us!.speed >= 2.2 && !m.us!.def.ranged && m.hp > m.maxHp * 0.7);
        const spot = this.raidSpot();
        if (fast.length >= 4 && spot) {
          const group = fast.slice(0, 8);
          w.attackMove(group, spot.x, spot.y);
          for (const m of group) this.raiders.add(m.id);
          this.raidUntil = w.tick + TICK_RATE * 45;
        }
        this.nextRaid = w.tick + TICK_RATE * 100;
      }
      if (this.raiders.size) {
        const done = w.tick > this.raidUntil;
        const ids = [...this.raiders];
        if (done || this.manageArmy(ids, home, enemies, true)) {
          const back = ids.map((id) => w.entities.get(id)!).filter(Boolean);
          const s = this.towardEnemy(home, 6);
          w.groupMove(back, s.x, s.y);
          this.raiders.clear();
        }
      }
    }
  }

  /**
   * Keep an attacking group fighting sensibly. Returns true if it retreated.
   * Retreats when clearly outmatched; otherwise keeps it marching from target to target.
   */
  private manageArmy(ids: number[], home: Entity, enemies: Entity[], raid: boolean): boolean {
    const w = this.w;
    const army = ids.map((id) => w.entities.get(id)).filter((e): e is Entity => !!e);
    if (!army.length) return false;
    let cx = 0, cy = 0;
    for (const m of army) {
      cx += m.x;
      cy += m.y;
    }
    cx /= army.length;
    cy /= army.length;
    const P = this.p;
    if (P.retreat) {
      const ownPow = army.reduce((s, e) => s + power(e), 0);
      let foePow = 0;
      for (const e of enemies) if (Math.hypot(e.x - cx, e.y - cy) < 9) foePow += power(e);
      for (const e of w.entities.values()) {
        if (e.kind === 'building' && e.bs!.def.attack && w.isEnemy(this.slot, e.owner) && Math.hypot(e.x - cx, e.y - cy) < 9) foePow += power(e);
      }
      const hurt = raid && army.some((m) => m.hp < m.maxHp * 0.35);
      if (foePow > ownPow * (raid ? 0.8 : 1.9) || hurt) {
        const s = this.towardEnemy(home, 5);
        w.groupMove(army, s.x, s.y);
        if (!raid) {
          for (const m of army) this.attacking.delete(m.id);
          this.nextAttack = Math.max(this.nextAttack, w.tick + TICK_RATE * P.interval * 0.6);
        }
        return true;
      }
    }
    for (const m of army) {
      const o = m.order;
      if (!o || (o.type === 'move' && !m.amove)) {
        const t = raid ? this.raidSpot() : this.pickTarget({ x: cx, y: cy });
        if (t) w.attackMove([m], t.x, t.y);
        continue;
      }
      if (!P.focus || o.type !== 'attack') continue;
      // focus fire: archers finish off the wounded, melee goes for archers and raiders hunt villagers
      const cur = w.entities.get(o.target);
      const reach = m.us!.def.ranged ? m.us!.range + 1 : 3;
      let best: Entity | null = null;
      let bs = Infinity;
      for (const e of enemies) {
        const d = w.distTo(m, e);
        if (d > reach) continue;
        let s = d * 0.4 + (e.hp / e.maxHp) * 3;
        if (!m.us!.def.ranged && e.us!.def.ranged) s -= 2;
        if (raid && e.type === 'villager') s -= 3;
        s -= ((m.us!.def.bonus?.[e.us!.def.cls] ?? 0) / 4);
        if (s < bs) {
          bs = s;
          best = e;
        }
      }
      if (best && best !== cur && (!cur || cur.kind === 'building' || bs < -0.5 || (cur.kind === 'unit' && cur.hp / cur.maxHp > 0.5))) {
        w.orderAttack(m, best, true);
      }
    }
    return false;
  }

  /** trainable units ranked by how well they answer the enemy army we've seen */
  private bestUnits(c: CivId, opts?: UnitType[]): UnitType[] {
    const age = this.w.players[this.slot]?.age ?? 1;
    const options = (opts ?? PROD.flatMap((t) => trainable(c, t))).filter((u) => unitAge(c, u) <= age);
    const counts = new Map<string, number>();
    let total = 0;
    for (const s of this.seen.values()) {
      if (s.type === 'villager') continue;
      counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
      total++;
    }
    const unique = CIVS[c].unique;
    const scored = options.map((u) => {
      const def = UNITS[u];
      let s = 1;
      if (total) {
        for (const [t, k] of counts) {
          const ed = UNITS[t as UnitType];
          s += ((k / total) * ((def.bonus?.[ed.cls] ?? 0) - (ed.bonus?.[def.cls] ?? 0))) / 5 * this.p.counter;
        }
      } else if (def.cls === 'infantry' && def.bonus?.cavalry) s -= 0.2; // spearmen only when needed
      if (u === unique) s += 0.35;
      s += (this.rng() - 0.5) * (1.3 - this.p.counter);
      return { u, s };
    });
    return scored.sort((a, b) => b.s - a.s).map((x) => x.u);
  }

  /** a storehouse near remote work sites, so villagers stop walking across the map */
  private expand(tryBuild: (t: BuildingType, near: { x: number; y: number }, a: number, b: number) => boolean, villagers: Entity[], home: Entity): boolean {
    const w = this.w;
    const sites = new Map<string, { x: number; y: number; n: number }>();
    for (const v of villagers) {
      const o = v.order;
      if (o?.type !== 'gather') continue;
      const t = w.entities.get(o.target);
      if (!t || t.kind !== 'resource') continue;
      // distance from the resource to the nearest drop-off's edge
      let near = Infinity;
      for (const e of w.entities.values()) {
        if (e.kind === 'building' && e.owner === this.slot && e.bs!.def.dropoff.includes(o.resType!)) near = Math.min(near, Math.hypot(e.x - t.x, e.y - t.y) - e.size / 2);
      }
      if (near < (o.resType === 'food' ? 4.5 : 6)) continue;
      const key = `${Math.floor(t.x / 8)},${Math.floor(t.y / 8)}`;
      const s = sites.get(key) ?? { x: t.x, y: t.y, n: 0 };
      s.n++;
      sites.set(key, s);
    }
    const best = [...sites.values()].sort((a, b) => b.n - a.n)[0];
    if (!best || best.n < 3 || Math.hypot(best.x - home.x, best.y - home.y) > 45) return false;
    return tryBuild('storehouse', best, 2, 5);
  }

  /** a point from home toward the nearest enemy start */
  private towardEnemy(home: { x: number; y: number }, dist: number) {
    const w = this.w;
    let tx = w.size / 2, ty = w.size / 2, bd = Infinity;
    w.players.forEach((pl, i) => {
      if (!pl.alive || !w.isEnemy(this.slot, pl.slot)) return;
      const s = w.starts[i];
      if (!s) return;
      const d = Math.hypot(s.x - home.x, s.y - home.y);
      if (d < bd) {
        bd = d;
        tx = s.x;
        ty = s.y;
      }
    });
    const dx = tx - home.x, dy = ty - home.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: home.x + (dx / l) * dist, y: home.y + (dy / l) * dist };
  }

  /** where enemy villagers were last seen working away from their town */
  private raidSpot(): { x: number; y: number } | null {
    const w = this.w;
    let best: { x: number; y: number } | null = null;
    let bs = -Infinity;
    for (const s of this.seen.values()) {
      if (s.type !== 'villager' || w.tick - s.t > TICK_RATE * 90) continue;
      let guard = 0;
      for (const e of w.entities.values()) {
        if (e.kind === 'building' && w.isEnemy(this.slot, e.owner) && e.bs!.def.attack && Math.hypot(e.x - s.x, e.y - s.y) < 9) guard++;
      }
      const score = -guard * 10 + this.rng();
      if (score > bs) {
        bs = score;
        best = s;
      }
    }
    if (best && bs > -5) return best;
    // never seen their workers: go look around their woodlines
    for (const e of w.entities.values()) {
      if (e.kind === 'building' && e.type === 'storehouse' && w.isEnemy(this.slot, e.owner)) return e;
    }
    return null;
  }

  /** fixed shares by villager count, nudged by what is running short or piling up */
  private basicWant(n: number, res: Record<ResourceType, number>): Record<ResourceType, number> {
    const want: Record<ResourceType, number> =
      n < 10
        ? { food: 0.6, wood: 0.4, gold: 0, stone: 0 }
        : n < 18
          ? { food: 0.48, wood: 0.34, gold: 0.18, stone: 0 }
          : { food: 0.4, wood: 0.3, gold: 0.22, stone: 0.08 };
    if (n >= 10) {
      for (const rt of Object.keys(want) as ResourceType[]) {
        const stock = res[rt];
        want[rt] *= stock > 600 ? 0.35 : stock > 350 ? 0.7 : stock < 80 ? 1.5 : 1;
      }
    }
    return normalize(want);
  }

  /** shares that follow what the current age spends, and react sooner to stockpiles */
  private smartWant(n: number, age: number, res: Record<ResourceType, number>): Record<ResourceType, number> {
    const want: Record<ResourceType, number> =
      n < 10
        ? { food: 0.6, wood: 0.4, gold: 0, stone: 0 }
        : age === 1
          ? { food: 0.58, wood: 0.36, gold: 0.06, stone: 0 }
          : { food: 0.42, wood: 0.28, gold: 0.24, stone: 0.06 };
    if (n >= 10) {
      for (const rt of Object.keys(want) as ResourceType[]) {
        const stock = res[rt];
        want[rt] *= stock > 450 ? 0.25 : stock > 250 ? 0.6 : stock < 100 ? 1.6 : 1;
      }
    }
    return normalize(want);
  }

  private pickBuilder(villagers: Entity[]): Entity | null {
    let best: Entity | null = null;
    for (const v of villagers) {
      if (v.order?.type === 'build' || this.fleeing.has(v.id)) continue;
      if (!v.order) return v;
      if (v.order.type === 'gather' && (v.order.resType === 'wood' || !best)) best = v;
    }
    return best;
  }

  private buildStorehouse(
    tryBuild: (t: BuildingType, near: { x: number; y: number }, a: number, b: number) => boolean,
    home: Entity,
    rt: ResourceType,
  ) {
    const r = this.w.findResource(this.slot, rt, home.x, home.y, 30);
    if (!r) return;
    if (Math.hypot(r.x - home.x, r.y - home.y) < 7) {
      tryBuild('storehouse', { x: (r.x + home.x) / 2, y: (r.y + home.y) / 2 }, 1, 6);
    } else tryBuild('storehouse', r, 2, 6);
  }

  private berriesLeft(home: Entity) {
    let n = 0;
    for (const e of this.w.entities.values())
      if (e.type === 'berry_bush' && Math.hypot(e.x - home.x, e.y - home.y) < 16) n++;
    return n;
  }

  private pickTarget(from: { x: number; y: number }): Entity | null {
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of this.w.entities.values()) {
      if (e.kind !== 'building' || e.type === 'wall' || e.type === 'gate' || !this.w.isEnemy(this.slot, e.owner)) continue;
      // walls are broken through on the way, never the goal; prefer production and town centers, avoid farms and walls of houses
      const weight = e.type === 'farm' ? 30 : e.type === 'house' ? 8 : e.type === 'tower' ? 6 : 0;
      const d = Math.hypot(e.x - from.x, e.y - from.y) + weight;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) return best;
    for (const e of this.w.entities.values()) {
      if (e.kind !== 'unit' || !this.w.isEnemy(this.slot, e.owner)) continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
}

function normalize(want: Record<ResourceType, number>): Record<ResourceType, number> {
  let sum = 0;
  for (const v of Object.values(want)) sum += v;
  if (sum > 0) for (const k of Object.keys(want) as ResourceType[]) want[k] /= sum;
  return want;
}
