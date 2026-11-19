import type { BuildingType, Cost, ResourceNodeType, ResourceType, UnitType } from '../types';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  native: string;
  size: number;
  hp: number;
  cost: Cost;
  buildTime: number;
  los: number;
  pop: number;
  dropoff: ResourceType[];
  trains: UnitType[];
  /** age it becomes available */
  age: 1 | 2 | 3;
  attack?: { damage: number; range: number; cooldown: number };
  armor: { melee: number; pierce: number };
  /** blocks movement */
  blocking: boolean;
  /** food a farm holds */
  food?: number;
  hotkey: string;
  description: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  town_center: {
    type: 'town_center', age: 1, name: 'Durbar', native: 'Rajsabha', size: 4, hp: 2400,
    cost: { wood: 275, stone: 100 }, buildTime: 90, los: 9, pop: 10,
    dropoff: ['food', 'wood', 'gold', 'stone'], trains: ['villager'],
    attack: { damage: 5, range: 7, cooldown: 2 }, armor: { melee: 3, pierce: 7 }, blocking: true,
    hotkey: 'C', description: 'Seat of power. Trains villagers, accepts all resources and shoots arrows at enemies.',
  },
  house: {
    type: 'house', age: 1, name: 'House', native: 'Griha', size: 2, hp: 500,
    cost: { wood: 30 }, buildTime: 14, los: 3, pop: 5, dropoff: [], trains: [],
    armor: { melee: 1, pierce: 6 }, blocking: true,
    hotkey: 'Q', description: 'Supports 5 population.',
  },
  storehouse: {
    type: 'storehouse', age: 1, name: 'Storehouse', native: 'Kosh', size: 2, hp: 600,
    cost: { wood: 100 }, buildTime: 20, los: 4, pop: 0, dropoff: ['food', 'wood', 'gold', 'stone'], trains: [],
    armor: { melee: 1, pierce: 6 }, blocking: true,
    hotkey: 'W', description: 'Villagers drop off any resource here. Build near forests and mines.',
  },
  farm: {
    type: 'farm', age: 1, name: 'Farm', native: 'Kshetra', size: 3, hp: 250,
    cost: { wood: 60 }, buildTime: 10, los: 1, pop: 0, dropoff: [], trains: [],
    armor: { melee: 0, pierce: 0 }, blocking: false, food: 300,
    hotkey: 'E', description: 'A paddy field that provides a steady supply of food.',
  },
  barracks: {
    type: 'barracks', age: 1, name: 'Barracks', native: 'Senashala', size: 3, hp: 1200,
    cost: { wood: 150 }, buildTime: 30, los: 5, pop: 0, dropoff: [],
    trains: ['swordsman', 'spearman', 'velaikkarar'],
    armor: { melee: 1, pierce: 6 }, blocking: true,
    hotkey: 'A', description: 'Trains infantry.',
  },
  archery_range: {
    type: 'archery_range', age: 2, name: 'Archery Range', native: 'Dhanushala', size: 3, hp: 1200,
    cost: { wood: 150 }, buildTime: 30, los: 5, pop: 0, dropoff: [],
    trains: ['archer', 'nayaka_archer'],
    armor: { melee: 1, pierce: 6 }, blocking: true,
    hotkey: 'S', description: 'Trains archers.',
  },
  stable: {
    type: 'stable', age: 2, name: 'Stable', native: 'Ashvashala', size: 3, hp: 1200,
    cost: { wood: 175 }, buildTime: 35, los: 5, pop: 0, dropoff: [],
    trains: ['horseman', 'elephant', 'gajasena', 'mansabdar', 'rajput_lancer', 'bargir'],
    armor: { melee: 1, pierce: 6 }, blocking: true,
    hotkey: 'D', description: 'Trains cavalry and war elephants.',
  },
  blacksmith: {
    type: 'blacksmith', age: 2, name: 'Blacksmith', native: 'Loharshala', size: 3, hp: 1100,
    cost: { wood: 150 }, buildTime: 35, los: 5, pop: 0, dropoff: [], trains: [],
    armor: { melee: 1, pierce: 6 }, blocking: true,
    hotkey: 'F', description: 'Forges better weapons and armour for your army.',
  },
  tower: {
    type: 'tower', age: 2, name: 'Watch Tower', native: 'Burj', size: 2, hp: 750,
    cost: { wood: 50, stone: 125 }, buildTime: 40, los: 9, pop: 0, dropoff: [], trains: [],
    attack: { damage: 6, range: 7, cooldown: 2 }, armor: { melee: 2, pierce: 7 }, blocking: true,
    hotkey: 'T', description: 'Defensive tower that fires arrows at nearby enemies.',
  },
};

export const BUILD_MENU: BuildingType[] = [
  'house', 'storehouse', 'farm', 'town_center', 'barracks', 'archery_range', 'stable', 'blacksmith', 'tower',
];

export interface ResourceNodeDef {
  type: ResourceNodeType;
  resType: ResourceType;
  amount: number;
  name: string;
}

export const RESOURCE_NODES: Record<ResourceNodeType, ResourceNodeDef> = {
  tree: { type: 'tree', resType: 'wood', amount: 100, name: 'Neem Tree' },
  palm: { type: 'palm', resType: 'wood', amount: 80, name: 'Palm Tree' },
  gold_mine: { type: 'gold_mine', resType: 'gold', amount: 450, name: 'Gold Mine' },
  stone_mine: { type: 'stone_mine', resType: 'stone', amount: 350, name: 'Stone Quarry' },
  berry_bush: { type: 'berry_bush', resType: 'food', amount: 150, name: 'Jamun Bush' },
};

/** base gather rates in units per second */
export const GATHER_RATES: Record<string, number> = {
  wood: 0.75,
  gold: 0.65,
  stone: 0.6,
  berries: 0.7,
  farm: 0.6,
};
