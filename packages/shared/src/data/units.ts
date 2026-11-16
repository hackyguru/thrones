import type { BuildingType, CivId, Cost, TargetClass, UnitClass, UnitType } from '../types';

export interface UnitDef {
  type: UnitType;
  name: string;
  /** Flavor name in an Indian language */
  native: string;
  cls: UnitClass;
  hp: number;
  attack: number;
  /** 0 = melee */
  range: number;
  /** seconds between attacks */
  cooldown: number;
  armor: { melee: number; pierce: number };
  /** tiles per second */
  speed: number;
  los: number;
  cost: Cost;
  /** seconds */
  trainTime: number;
  pop: number;
  trainedAt: BuildingType;
  bonus?: Partial<Record<TargetClass, number>>;
  ranged?: boolean;
  uniqueTo?: CivId;
  /** first strike bonus damage after not fighting for a while */
  charge?: number;
  hotkey: string;
  description: string;
}

export const UNITS: Record<UnitType, UnitDef> = {
  villager: {
    type: 'villager', name: 'Villager', native: 'Grihasta', cls: 'villager',
    hp: 25, attack: 3, range: 0, cooldown: 1.5, armor: { melee: 0, pierce: 0 },
    speed: 1.7, los: 5, cost: { food: 50 }, trainTime: 12, pop: 1, trainedAt: 'town_center',
    bonus: { building: 2 }, hotkey: 'Q',
    description: 'Gathers resources and constructs buildings. The backbone of every empire.',
  },
  swordsman: {
    type: 'swordsman', name: 'Swordsman', native: 'Khadgadhari', cls: 'infantry',
    hp: 60, attack: 8, range: 0, cooldown: 1.5, armor: { melee: 1, pierce: 1 },
    speed: 1.5, los: 6, cost: { food: 60, gold: 20 }, trainTime: 14, pop: 1, trainedAt: 'barracks',
    bonus: { building: 3 }, hotkey: 'Q',
    description: 'Sturdy talwar infantry. Strong against spearmen and buildings.',
  },
  spearman: {
    type: 'spearman', name: 'Spearman', native: 'Bhaladar', cls: 'infantry',
    hp: 50, attack: 4, range: 0, cooldown: 1.6, armor: { melee: 0, pierce: 0 },
    speed: 1.5, los: 6, cost: { food: 35, wood: 25 }, trainTime: 12, pop: 1, trainedAt: 'barracks',
    bonus: { cavalry: 12, elephant: 16 }, hotkey: 'W',
    description: 'Cheap pike infantry. Deadly against cavalry and war elephants.',
  },
  archer: {
    type: 'archer', name: 'Archer', native: 'Dhanurdhara', cls: 'ranged',
    hp: 32, attack: 5, range: 5, cooldown: 2, armor: { melee: 0, pierce: 0 },
    speed: 1.5, los: 7, cost: { wood: 25, gold: 45 }, trainTime: 14, pop: 1, trainedAt: 'archery_range',
    bonus: { infantry: 2 }, ranged: true, hotkey: 'Q',
    description: 'Bamboo longbow archer. Strong against infantry, vulnerable to cavalry.',
  },
  horseman: {
    type: 'horseman', name: 'Horseman', native: 'Ashvarohi', cls: 'cavalry',
    hp: 100, attack: 7, range: 0, cooldown: 1.8, armor: { melee: 0, pierce: 2 },
    speed: 2.6, los: 8, cost: { food: 80, gold: 30 }, trainTime: 16, pop: 1, trainedAt: 'stable',
    bonus: { ranged: 4 }, hotkey: 'Q',
    description: 'Fast light cavalry. Raids villagers and runs down archers.',
  },
  elephant: {
    type: 'elephant', name: 'War Elephant', native: 'Gaja', cls: 'elephant',
    hp: 260, attack: 14, range: 0, cooldown: 2.2, armor: { melee: 1, pierce: 3 },
    speed: 1.05, los: 6, cost: { food: 140, gold: 75 }, trainTime: 24, pop: 2, trainedAt: 'stable',
    bonus: { building: 12, infantry: 4 }, hotkey: 'W',
    description: 'A towering armored elephant. Crushes infantry and buildings, weak to spearmen.',
  },
  // ---- unique units ----
  gajasena: {
    type: 'gajasena', name: 'Gajasena', native: 'Gajasena', cls: 'elephant',
    hp: 340, attack: 18, range: 0, cooldown: 2.2, armor: { melee: 2, pierce: 4 },
    speed: 1.1, los: 7, cost: { food: 150, gold: 85 }, trainTime: 26, pop: 2, trainedAt: 'stable',
    bonus: { building: 18, infantry: 6, cavalry: 4 }, uniqueTo: 'maurya', hotkey: 'E',
    description: 'Mauryan armored war elephant with bowmen in the howdah. The terror of Kalinga.',
  },
  velaikkarar: {
    type: 'velaikkarar', name: 'Velaikkarar', native: 'Velaikkarar', cls: 'infantry',
    hp: 85, attack: 10, range: 0, cooldown: 1.4, armor: { melee: 3, pierce: 2 },
    speed: 1.55, los: 6, cost: { food: 65, gold: 35 }, trainTime: 15, pop: 1, trainedAt: 'barracks',
    bonus: { building: 4, cavalry: 3 }, uniqueTo: 'chola', hotkey: 'E',
    description: 'Sworn royal guard of the Chola kings — heavily armored, never retreats.',
  },
  mansabdar: {
    type: 'mansabdar', name: 'Mansabdar', native: 'Mansabdar', cls: 'cavalry',
    hp: 75, attack: 6, range: 4, cooldown: 1.9, armor: { melee: 0, pierce: 1 },
    speed: 2.4, los: 8, cost: { wood: 40, gold: 60 }, trainTime: 18, pop: 1, trainedAt: 'stable',
    bonus: { infantry: 2 }, ranged: true, uniqueTo: 'mughal', hotkey: 'E',
    description: 'Mughal ranked horse archer. Shoots on the move and outpaces infantry.',
  },
  rajput_lancer: {
    type: 'rajput_lancer', name: 'Rajput Lancer', native: 'Kshatriya Savar', cls: 'cavalry',
    hp: 135, attack: 11, range: 0, cooldown: 1.8, armor: { melee: 2, pierce: 2 },
    speed: 2.3, los: 7, cost: { food: 75, gold: 75 }, trainTime: 19, pop: 1, trainedAt: 'stable',
    bonus: { ranged: 4, building: 2 }, charge: 14, uniqueTo: 'rajput', hotkey: 'E',
    description: 'Heavy cavalry whose first charge strikes with devastating force.',
  },
  bargir: {
    type: 'bargir', name: 'Bargir', native: 'Bargir', cls: 'cavalry',
    hp: 85, attack: 7, range: 0, cooldown: 1.5, armor: { melee: 0, pierce: 3 },
    speed: 3.2, los: 9, cost: { food: 60, gold: 25 }, trainTime: 12, pop: 1, trainedAt: 'stable',
    bonus: { ranged: 5, villager: 3 }, uniqueTo: 'maratha', hotkey: 'E',
    description: 'Lightning-fast Maratha raider. Masters of ganimi kava — guerrilla warfare.',
  },
  nayaka_archer: {
    type: 'nayaka_archer', name: 'Nayaka Archer', native: 'Nayaka Dhanushka', cls: 'ranged',
    hp: 42, attack: 6, range: 7, cooldown: 2, armor: { melee: 0, pierce: 1 },
    speed: 1.5, los: 9, cost: { wood: 35, gold: 40 }, trainTime: 15, pop: 1, trainedAt: 'archery_range',
    bonus: { infantry: 2, elephant: 3 }, ranged: true, uniqueTo: 'vijayanagara', hotkey: 'E',
    description: 'Vijayanagara elite archer with a great composite bow and unmatched range.',
  },
};
