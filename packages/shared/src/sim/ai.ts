import { TICK_RATE } from '../constants';
import { CIVS } from '../data/civs';
import { buildingStats, canAfford, trainable, unitStats } from '../data/stats';
import { mulberry32, type Rng } from '../rng';
import type { BuildingType, ResourceType, UnitType } from '../types';
import type { Entity, World } from './world';

/** A straightforward scripted AI: boom, build military, attack in waves. */
export class AIController {
  private rng: Rng;
  private wave = 0;
  private nextAttack: number;
  private attacking = new Set<number>();

  constructor(
    private w: World,
    public slot: number,
    seed: number,
    private difficulty: 'easy' | 'normal' = 'normal',
  ) {
    this.rng = mulberry32(seed ^ (slot * 7919));
    this.nextAttack = TICK_RATE * (difficulty === 'easy' ? 480 : 330);
  }

  update() {
    const w = this.w;
    const p = w.players[this.slot];
    if (!p || !p.alive) return;
    const civ = p.civ;

    const villagers: Entity[] = [];
    const military: Entity[] = [];
    const buildings = new Map<BuildingType, Entity[]>();
    for (const e of w.entities.values()) {
      if (e.owner !== this.slot) continue;
      if (e.kind === 'unit') (e.type === 'villager' ? villagers : military).push(e);
      else if (e.kind === 'building') {
        const t = e.type as BuildingType;
        if (!buildings.has(t)) buildings.set(t, []);
        buildings.get(t)!.push(e);
      }
    }
    const list = (t: BuildingType) => buildings.get(t) ?? [];
    const tc = list('town_center')[0];
    const home = tc ?? (villagers[0] || military[0]);
    if (!home) return;
    const unfinished = [...buildings.values()].flat().filter((b) => !b.built);

    // --- villagers ---
    const targetVills = this.difficulty === 'easy' ? 18 : 32;
    if (tc && tc.built && tc.queue.length < 2 && villagers.length + tc.queue.length < targetVills && p.res.food >= 50) {
      w.command(this.slot, { c: 'train', building: tc.id, type: 'villager' });
    }

    // --- construction ---
    const tryBuild = (type: BuildingType, near: { x: number; y: number }, minR: number, maxR: number) => {
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
    if (p.popCap < 200 && p.popCap - p.pop < 4 + list('barracks').length * 2 && housesBuilding < 1 + (villagers.length > 15 ? 1 : 0)) {
      tryBuild('house', home, 4, 14);
    }
    if (unfinished.length < 2) {
      const nv = villagers.length;
      const has = (t: BuildingType) => list(t).length;
      if (!tc && nv > 0) tryBuild('town_center', home, 0, 10);
      else if (nv >= 6 && has('storehouse') < 1) this.buildStorehouse(tryBuild, home, 'wood');
      else if (nv >= 9 && has('barracks') < 1) tryBuild('barracks', home, 6, 14);
      else if (nv >= 12 && has('storehouse') < 2) this.buildStorehouse(tryBuild, home, 'gold');
      else if (nv >= 12 && has('farm') < Math.floor(nv * 0.3) && this.berriesLeft(home) < 3) tryBuild('farm', home, 3, 9);
      else if (nv >= 14 && has('archery_range') < 1) tryBuild('archery_range', home, 6, 15);
      else if (nv >= 17 && has('stable') < 1) tryBuild('stable', home, 6, 15);
      else if (nv >= 20 && has('tower') < 1) tryBuild('tower', home, 6, 10);
      else if (nv >= 24 && has('barracks') < 2 && this.difficulty !== 'easy') tryBuild('barracks', home, 6, 16);
    }

    // --- gather assignment ---
    const counts: Record<ResourceType, number> = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle: Entity[] = [];
    for (const v of villagers) {
      if (v.order?.type === 'gather' && v.order.resType) counts[v.order.resType]++;
      else if (v.order?.type === 'build') continue;
      else if (!v.order) idle.push(v);
    }
    // send idle villagers to help unfinished buildings first
    for (const b of unfinished) {
      const builders = villagers.filter((v) => v.order?.type === 'build' && v.order.target === b.id).length;
      if (builders === 0 && idle.length) {
        const v = idle.shift()!;
        w.orderBuild(v, b);
      }
    }
    const n = villagers.length;
    const want: Record<ResourceType, number> =
      n < 10
        ? { food: 0.6, wood: 0.4, gold: 0, stone: 0 }
        : n < 18
          ? { food: 0.48, wood: 0.34, gold: 0.18, stone: 0 }
          : { food: 0.42, wood: 0.3, gold: 0.2, stone: 0.08 };
    for (const v of idle) {
      let best: ResourceType = 'food';
      let bestDef = -Infinity;
      for (const rt of Object.keys(want) as ResourceType[]) {
        const def = want[rt] * n - counts[rt];
        if (def > bestDef) {
          bestDef = def;
          best = rt;
        }
      }
      const target = w.findResource(this.slot, best, home.x, home.y, 40) ?? w.findResource(this.slot, 'wood', home.x, home.y, 60);
      if (target) {
        w.orderGather(v, target);
        counts[best]++;
      }
    }

    // --- military production ---
    const reserveFood = villagers.length < targetVills ? 60 : 0;
    for (const t of ['barracks', 'archery_range', 'stable'] as BuildingType[]) {
      for (const b of list(t)) {
        if (!b.built || b.queue.length >= 2) continue;
        const opts = trainable(civ, t);
        const unique = CIVS[civ].unique;
        let choice: UnitType = opts.includes(unique) && this.rng() < 0.45 ? unique : opts[Math.floor(this.rng() * opts.length)];
        const cost = unitStats(civ, choice).cost;
        if (p.res.food - (cost.food ?? 0) < reserveFood) continue;
        if (!canAfford(p.res, cost)) {
          choice = opts[0];
          if (!canAfford(p.res, unitStats(civ, choice).cost)) continue;
        }
        if (!b.rally) w.command(this.slot, { c: 'rally', building: b.id, x: home.x + (w.size / 2 - home.x) * 0.12, y: home.y + (w.size / 2 - home.y) * 0.12 });
        w.command(this.slot, { c: 'train', building: b.id, type: choice });
      }
    }

    // --- defense ---
    const threat = w.findEnemyNear(this.slot, home.x, home.y, 16, false);
    if (threat) {
      for (const m of military) {
        if (!m.order || (m.order.type === 'attack' && !this.attacking.has(m.id))) w.orderAttack(m, threat, false);
      }
      if (military.length === 0 && tc) {
        // villagers defend against lone raiders
        const nearVills = villagers.filter((v) => Math.hypot(v.x - threat.x, v.y - threat.y) < 6).slice(0, 6);
        if (threat.type !== 'elephant' && nearVills.length >= 3) for (const v of nearVills) w.orderAttack(v, threat, false);
      }
    }

    // --- attack waves ---
    for (const id of [...this.attacking]) if (!w.entities.has(id)) this.attacking.delete(id);
    const available = military.filter((m) => !this.attacking.has(m.id));
    const waveSize = Math.min(24, (this.difficulty === 'easy' ? 5 : 7) + this.wave * 3);
    if (w.tick >= this.nextAttack && available.length >= waveSize) {
      const target = this.pickTarget(home);
      if (target) {
        for (const m of available) {
          w.orderAttack(m, target, false);
          this.attacking.add(m.id);
        }
        this.wave++;
        this.nextAttack = w.tick + TICK_RATE * (this.difficulty === 'easy' ? 150 : 100);
      }
    }
    // attackers: engage nearby units, then continue to next target
    for (const id of this.attacking) {
      const m = w.entities.get(id)!;
      const cur = m.order?.type === 'attack' ? w.entities.get(m.order.target) : undefined;
      if (!cur || cur.kind === 'building') {
        const near = w.findEnemyNear(this.slot, m.x, m.y, 7, false);
        if (near) w.orderAttack(m, near, false);
        else if (!cur) {
          const t = this.pickTarget(m);
          if (t) w.orderAttack(m, t, false);
        }
      }
    }
  }

  private pickBuilder(villagers: Entity[]): Entity | null {
    let best: Entity | null = null;
    for (const v of villagers) {
      if (v.order?.type === 'build') continue;
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
      // resource is close to the town center already; still useful to have one
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
      if (e.kind !== 'building' || !this.w.isEnemy(this.slot, e.owner)) continue;
      // prefer military & town centers, avoid farms
      const weight = e.type === 'farm' ? 30 : e.type === 'house' ? 8 : 0;
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

