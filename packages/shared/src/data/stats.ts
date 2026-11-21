import { CIVS } from './civs';
import { BUILDINGS, type BuildingDef } from './buildings';
import { UNITS, type UnitDef } from './units';
import type { BuildingType, CivId, Cost, ResourceType, UnitType } from '../types';
import { techMods } from './techs';
import { MELEE_RANGE } from '../constants';

export interface UnitStats {
  def: UnitDef;
  maxHp: number;
  attack: number;
  range: number;
  cooldownTicks: number;
  armorMelee: number;
  armorPierce: number;
  speed: number;
  los: number;
  cost: Cost;
  trainTime: number;
}

export interface BuildingStats {
  def: BuildingDef;
  maxHp: number;
  cost: Cost;
  buildTime: number;
  attackRange: number;
  attackDamage: number;
}

const unitCache = new Map<string, UnitStats>();
const buildingCache = new Map<string, BuildingStats>();

function scaleCost(cost: Cost, mult: number, onlyWood = false): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(cost) as [ResourceType, number][]) {
    out[k] = onlyWood && k !== 'wood' ? v : Math.round(v * mult);
  }
  return out;
}

export function unitStats(civ: CivId, type: UnitType, tickRate = 20, techs?: readonly string[]): UnitStats {
  const t = techMods(techs);
  const key = civ + ':' + type + ':' + tickRate + ':' + t.key;
  const cached = unitCache.get(key);
  if (cached) return cached;
  const def = UNITS[type];
  const m = CIVS[civ].mods;
  const cls = def.cls;
  let attack = def.attack;
  if (!def.ranged && m.meleeAttack?.[cls]) attack = Math.round(attack * m.meleeAttack[cls]!);
  if (def.ranged) attack += t.rangedAttack;
  else attack += t.melee[cls] ?? 0;
  const s: UnitStats = {
    def,
    maxHp: Math.round(def.hp * (m.unitHp?.[cls] ?? 1)),
    attack,
    range: def.range > 0 ? def.range + t.rangedRange : MELEE_RANGE,
    cooldownTicks: Math.round(def.cooldown * tickRate),
    armorMelee: def.armor.melee + (m.armorMelee?.[cls] ?? 0) + (t.armorMelee[cls] ?? 0),
    armorPierce: def.armor.pierce + (t.armorPierce[cls] ?? 0),
    speed: def.speed * (m.speed ?? 1) * (cls === 'villager' ? 1 + t.villagerSpeed : 1),
    los: def.los + (m.los ?? 0),
    cost: scaleCost(def.cost, m.unitCost?.[cls] ?? 1),
    trainTime: def.trainTime / (m.trainSpeed ?? 1),
  };
  unitCache.set(key, s);
  return s;
}

export function buildingStats(civ: CivId, type: BuildingType, techs?: readonly string[]): BuildingStats {
  const t = techMods(techs);
  const key = civ + ':' + type + ':' + t.key;
  const cached = buildingCache.get(key);
  if (cached) return cached;
  const def = BUILDINGS[type];
  const m = CIVS[civ].mods;
  const s: BuildingStats = {
    def,
    maxHp: Math.round(def.hp * (m.buildingHp ?? 1)),
    cost: scaleCost(def.cost, m.buildingWoodCost ?? 1, true),
    buildTime: def.buildTime / (m.buildSpeed ?? 1),
    attackRange: def.attack ? def.attack.range + (type === 'tower' ? (m.towerRange ?? 0) : 0) + t.rangedRange : 0,
    attackDamage: def.attack ? def.attack.damage + t.rangedAttack : 0,
  };
  buildingCache.set(key, s);
  return s;
}

export function gatherRate(civ: CivId, resType: ResourceType, source: 'farm' | 'node', techs?: readonly string[]): number {
  const m = CIVS[civ].mods;
  const t = techMods(techs);
  let base: number;
  if (resType === 'food') base = source === 'farm' ? 0.6 : 0.7;
  else if (resType === 'wood') base = 0.75;
  else if (resType === 'gold') base = 0.65;
  else base = 0.6;
  return base * (m.gather?.[resType] ?? 1) * (source === 'farm' ? m.farm ?? 1 : 1) * (1 + t.gather[resType] + (source === 'farm' ? t.farmRate : 0));
}

/** what a villager can carry */
export function carryCapacity(techs?: readonly string[]): number {
  return 10 + techMods(techs).carry;
}

/** the age a unit becomes available to this civ (some get a unit one age early) */
export function unitAge(civ: CivId, type: UnitType): 1 | 2 | 3 {
  const a = UNITS[type].age;
  return CIVS[civ].mods.earlyUnits?.includes(type) && a > 1 ? ((a - 1) as 1 | 2) : a;
}

/** Units a building can train for this civ */
export function trainable(civ: CivId, type: BuildingType): UnitType[] {
  return BUILDINGS[type].trains.filter((u) => {
    const uq = UNITS[u].uniqueTo;
    return !uq || uq === civ;
  });
}

export function canAfford(res: Record<ResourceType, number>, cost: Cost): boolean {
  for (const [k, v] of Object.entries(cost) as [ResourceType, number][]) {
    if ((res[k] ?? 0) < v) return false;
  }
  return true;
}

export function pay(res: Record<ResourceType, number>, cost: Cost, sign = -1) {
  for (const [k, v] of Object.entries(cost) as [ResourceType, number][]) res[k] += sign * v;
}
