import type { BuildingType, Cost, ResourceType, UnitClass } from '../types';

export type Age = 1 | 2 | 3;

export const AGES: Record<Age, { name: string; native: string; description: string }> = {
  1: { name: 'Janapada Age', native: 'Janapada', description: 'A cluster of villages under a chieftain.' },
  2: { name: 'Rajya Age', native: 'Rajya', description: 'A kingdom with standing armies, smiths and towers.' },
  3: { name: 'Samrajya Age', native: 'Samrajya', description: 'An empire: war elephants, elite units and the finest arms.' },
};

export type TechId =
  | 'age2'
  | 'age3'
  | 'iron_axe'
  | 'bow_saw'
  | 'mining_picks'
  | 'deep_shafts'
  | 'irrigation'
  | 'bullock_carts'
  | 'forging'
  | 'wootz_steel'
  | 'lamellar'
  | 'mail'
  | 'fletching'
  | 'quilted';

/** What a tech changes. Gather values are added multipliers (0.15 = +15%). */
export interface TechEffect {
  gather?: Partial<Record<ResourceType, number>>;
  /** farms: extra gather rate and extra food per new farm */
  farmRate?: number;
  farmFood?: number;
  carry?: number;
  villagerSpeed?: number;
  /** melee attack for these classes */
  melee?: { classes: UnitClass[]; amount: number };
  /** ranged units: attack and range; also towers and town centres */
  ranged?: { attack: number; range: number };
  armorMelee?: { classes: UnitClass[]; amount: number };
  armorPierce?: { classes: UnitClass[]; amount: number };
  age?: Age;
}

export interface TechDef {
  id: TechId;
  name: string;
  /** researched at */
  at: BuildingType;
  age: Age;
  cost: Cost;
  /** seconds */
  time: number;
  requires?: TechId;
  description: string;
  icon: 'age' | 'axe' | 'pick' | 'plough' | 'cart' | 'sword' | 'armor' | 'arrow' | 'quilt';
  effect: TechEffect;
}

const MELEE: UnitClass[] = ['infantry', 'cavalry', 'elephant'];

export const TECHS: Record<TechId, TechDef> = {
  age2: {
    id: 'age2', name: 'Advance to the Rajya Age', at: 'town_center', age: 1, cost: { food: 400 }, time: 55,
    description: 'Become a kingdom. Unlocks archers, cavalry, the stable, the blacksmith, towers and new upgrades.',
    icon: 'age', effect: { age: 2 },
  },
  age3: {
    id: 'age3', name: 'Advance to the Samrajya Age', at: 'town_center', age: 2, cost: { food: 700, gold: 250 }, time: 80, requires: 'age2',
    description: 'Become an empire. Unlocks war elephants, your unique unit and the strongest upgrades.',
    icon: 'age', effect: { age: 3 },
  },
  iron_axe: {
    id: 'iron_axe', name: 'Iron Axe', at: 'storehouse', age: 1, cost: { food: 80, wood: 50 }, time: 20,
    description: 'Villagers chop wood 20% faster.', icon: 'axe', effect: { gather: { wood: 0.2 } },
  },
  bow_saw: {
    id: 'bow_saw', name: 'Bow Saw', at: 'storehouse', age: 2, cost: { food: 150, wood: 100 }, time: 30, requires: 'iron_axe',
    description: 'Villagers chop wood a further 15% faster.', icon: 'axe', effect: { gather: { wood: 0.15 } },
  },
  mining_picks: {
    id: 'mining_picks', name: 'Mining Picks', at: 'storehouse', age: 1, cost: { food: 80, wood: 60 }, time: 20,
    description: 'Villagers mine gold and stone 15% faster.', icon: 'pick', effect: { gather: { gold: 0.15, stone: 0.15 } },
  },
  deep_shafts: {
    id: 'deep_shafts', name: 'Deep Shafts', at: 'storehouse', age: 2, cost: { food: 150, wood: 120 }, time: 30, requires: 'mining_picks',
    description: 'Villagers mine gold and stone a further 15% faster.', icon: 'pick', effect: { gather: { gold: 0.15, stone: 0.15 } },
  },
  irrigation: {
    id: 'irrigation', name: 'Irrigation Canals', at: 'town_center', age: 2, cost: { food: 100, wood: 150 }, time: 30,
    description: 'Farms are worked 20% faster and new farms hold 50% more food.', icon: 'plough', effect: { farmRate: 0.2, farmFood: 0.5 },
  },
  bullock_carts: {
    id: 'bullock_carts', name: 'Bullock Carts', at: 'town_center', age: 2, cost: { food: 175, wood: 75 }, time: 35,
    description: 'Villagers carry 4 more and walk 10% faster.', icon: 'cart', effect: { carry: 4, villagerSpeed: 0.1 },
  },
  forging: {
    id: 'forging', name: 'Forging', at: 'blacksmith', age: 2, cost: { food: 150 }, time: 30,
    description: 'Infantry, cavalry and elephants +1 attack.', icon: 'sword', effect: { melee: { classes: MELEE, amount: 1 } },
  },
  wootz_steel: {
    id: 'wootz_steel', name: 'Wootz Steel', at: 'blacksmith', age: 3, cost: { food: 220, gold: 120 }, time: 45, requires: 'forging',
    description: 'The famed crucible steel of South India: infantry, cavalry and elephants a further +2 attack.', icon: 'sword',
    effect: { melee: { classes: MELEE, amount: 2 } },
  },
  lamellar: {
    id: 'lamellar', name: 'Lamellar Armour', at: 'blacksmith', age: 2, cost: { food: 120 }, time: 30,
    description: 'Infantry and cavalry +1 melee armour.', icon: 'armor', effect: { armorMelee: { classes: ['infantry', 'cavalry'], amount: 1 } },
  },
  mail: {
    id: 'mail', name: 'Zirah Mail', at: 'blacksmith', age: 3, cost: { food: 200, gold: 100 }, time: 45, requires: 'lamellar',
    description: 'Infantry, cavalry and elephants a further +1 melee and +1 pierce armour.', icon: 'armor',
    effect: { armorMelee: { classes: MELEE, amount: 1 }, armorPierce: { classes: MELEE, amount: 1 } },
  },
  fletching: {
    id: 'fletching', name: 'Fletching', at: 'blacksmith', age: 2, cost: { food: 100, gold: 50 }, time: 30,
    description: 'Archers, towers and the Durbar +1 attack and +1 range.', icon: 'arrow', effect: { ranged: { attack: 1, range: 1 } },
  },
  quilted: {
    id: 'quilted', name: 'Quilted Armour', at: 'blacksmith', age: 2, cost: { food: 100, wood: 50 }, time: 30,
    description: 'Archers and infantry +1 pierce armour.', icon: 'quilt', effect: { armorPierce: { classes: ['ranged', 'infantry'], amount: 1 } },
  },
};

export const TECH_IDS = Object.keys(TECHS) as TechId[];

export function techsAt(building: BuildingType): TechId[] {
  return TECH_IDS.filter((t) => TECHS[t].at === building);
}

/** Combined effect of a player's researched techs. */
export interface TechMods {
  age: Age;
  gather: Record<ResourceType, number>;
  farmRate: number;
  farmFood: number;
  carry: number;
  villagerSpeed: number;
  melee: Partial<Record<UnitClass, number>>;
  rangedAttack: number;
  rangedRange: number;
  armorMelee: Partial<Record<UnitClass, number>>;
  armorPierce: Partial<Record<UnitClass, number>>;
  key: string;
}

const modsCache = new Map<string, TechMods>();

export function techMods(techs: readonly string[] | undefined): TechMods {
  const key = techs && techs.length ? [...techs].sort().join(',') : '';
  const hit = modsCache.get(key);
  if (hit) return hit;
  const m: TechMods = {
    age: 1, gather: { food: 0, wood: 0, gold: 0, stone: 0 }, farmRate: 0, farmFood: 0, carry: 0, villagerSpeed: 0,
    melee: {}, rangedAttack: 0, rangedRange: 0, armorMelee: {}, armorPierce: {}, key,
  };
  for (const id of techs ?? []) {
    const e = TECHS[id as TechId]?.effect;
    if (!e) continue;
    if (e.age && e.age > m.age) m.age = e.age;
    for (const [r, v] of Object.entries(e.gather ?? {}) as [ResourceType, number][]) m.gather[r] += v;
    m.farmRate += e.farmRate ?? 0;
    m.farmFood += e.farmFood ?? 0;
    m.carry += e.carry ?? 0;
    m.villagerSpeed += e.villagerSpeed ?? 0;
    if (e.melee) for (const c of e.melee.classes) m.melee[c] = (m.melee[c] ?? 0) + e.melee.amount;
    if (e.ranged) {
      m.rangedAttack += e.ranged.attack;
      m.rangedRange += e.ranged.range;
    }
    if (e.armorMelee) for (const c of e.armorMelee.classes) m.armorMelee[c] = (m.armorMelee[c] ?? 0) + e.armorMelee.amount;
    if (e.armorPierce) for (const c of e.armorPierce.classes) m.armorPierce[c] = (m.armorPierce[c] ?? 0) + e.armorPierce.amount;
  }
  modsCache.set(key, m);
  return m;
}

/** Why a tech can't be researched right now (null = it can). */
export function techBlocker(id: TechId, techs: readonly string[], queued: readonly string[] = []): string | null {
  const t = TECHS[id];
  const m = techMods(techs);
  if (techs.includes(id)) return 'Already researched';
  if (queued.includes(id)) return 'Already being researched';
  if (m.age < t.age) return `Requires the ${AGES[t.age].name}`;
  if (t.requires && !techs.includes(t.requires)) return `Requires ${TECHS[t.requires].name}`;
  if (t.effect.age && queued.some((q) => TECHS[q as TechId]?.effect.age)) return 'Already advancing';
  return null;
}
