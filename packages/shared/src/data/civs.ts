import type { CivId, ResourceType, UnitClass, UnitType } from '../types';

export type ArchStyle = 'mauryan' | 'dravidian' | 'mughal' | 'rajput' | 'maratha' | 'vijayanagara';

export interface CivMods {
  gather?: Partial<Record<ResourceType, number>>;
  /** cost multiplier by unit class */
  unitCost?: Partial<Record<UnitClass, number>>;
  unitHp?: Partial<Record<UnitClass, number>>;
  /** attack multiplier for melee units by class */
  meleeAttack?: Partial<Record<UnitClass, number>>;
  armorMelee?: Partial<Record<UnitClass, number>>;
  speed?: number;
  los?: number;
  buildSpeed?: number;
  trainSpeed?: number;
  buildingHp?: number;
  buildingWoodCost?: number;
  towerRange?: number;
  /** farms worked faster (multiplier) */
  farm?: number;
  /** units available one age earlier than usual */
  earlyUnits?: UnitType[];
}

export interface CivDef {
  id: CivId;
  name: string;
  short: string;
  era: string;
  capital: string;
  tagline: string;
  description: string;
  arch: ArchStyle;
  /** UI accent colors */
  colors: { primary: string; secondary: string };
  emblem: string;
  bonuses: string[];
  unique: UnitType;
  mods: CivMods;
}

export const CIVS: Record<CivId, CivDef> = {
  maurya: {
    id: 'maurya', name: 'Maurya Empire', short: 'Maurya', era: '322 – 185 BCE', capital: 'Pataliputra',
    tagline: 'The Wheel of Dharma',
    description:
      'Forged by Chandragupta and guided by the Arthashastra of Chanakya, the Mauryas built the first empire to span the subcontinent, fielding thousands of war elephants.',
    arch: 'mauryan', colors: { primary: '#c7924a', secondary: '#5b3a1e' }, emblem: '☸',
    bonuses: ['Gold gathered 20% and wood 15% faster (the Arthashastra\'s state mines and forests)', 'War elephants from the Rajya Age', 'War elephants cost 25% less and have 15% more hit points'],
    unique: 'gajasena',
    mods: { gather: { gold: 1.2, wood: 1.15 }, unitCost: { elephant: 0.75 }, unitHp: { elephant: 1.15 }, earlyUnits: ['elephant'] },
  },
  chola: {
    id: 'chola', name: 'Chola Dynasty', short: 'Chola', era: '848 – 1279 CE', capital: 'Thanjavur',
    tagline: 'Lords of the Southern Seas',
    description:
      'From the Kaveri delta the Cholas raised towering temples and sent fleets across the Bay of Bengal. Their irrigated paddy fields fed a mighty, disciplined state.',
    arch: 'dravidian', colors: { primary: '#d9a13b', secondary: '#7a2318' }, emblem: '🐅',
    bonuses: ['Food gathered 5% faster (Kaveri paddies)', 'Villagers build 10% faster', 'Infantry +10% hit points'],
    unique: 'velaikkarar',
    mods: { gather: { food: 1.05 }, buildSpeed: 1.1, unitHp: { infantry: 1.1 } },
  },
  mughal: {
    id: 'mughal', name: 'Mughal Empire', short: 'Mughal', era: '1526 – 1857 CE', capital: 'Agra',
    tagline: 'Splendour of the Peacock Throne',
    description:
      'The Mughals combined Central Asian cavalry with a sophisticated administration — the mansabdari system — and left behind marble wonders like the Taj Mahal.',
    arch: 'mughal', colors: { primary: '#e8e2d0', secondary: '#1f5a43' }, emblem: '🌙',
    bonuses: ['Units train 17% faster', 'Buildings cost 15% less wood', 'Cavalry +10% hit points'],
    unique: 'mansabdar',
    mods: { trainSpeed: 1.17, buildingWoodCost: 0.85, unitHp: { cavalry: 1.1 } },
  },
  rajput: {
    id: 'rajput', name: 'Rajput Kingdoms', short: 'Rajput', era: '700 – 1700 CE', capital: 'Chittor',
    tagline: 'Valour of the Desert Forts',
    description:
      'Warrior clans of Rajputana held mighty hill forts like Chittorgarh and Kumbhalgarh, famed for their chivalry and ferocious cavalry charges.',
    arch: 'rajput', colors: { primary: '#e0703a', secondary: '#6a1b2a' }, emblem: '⚔',
    bonuses: ['Melee units +15% attack', 'Buildings +15% hit points', 'Towers +1 range'],
    unique: 'rajput_lancer',
    mods: {
      meleeAttack: { infantry: 1.15, cavalry: 1.15, elephant: 1.15 },
      buildingHp: 1.15,
      towerRange: 1,
    },
  },
  maratha: {
    id: 'maratha', name: 'Maratha Empire', short: 'Maratha', era: '1674 – 1818 CE', capital: 'Raigad',
    tagline: 'Swift as the Deccan Wind',
    description:
      'Shivaji Maharaj forged the Marathas into a power from the forts of the Sahyadri hills, using lightning cavalry raids to outmanoeuvre far larger armies.',
    arch: 'maratha', colors: { primary: '#f08a24', secondary: '#3b2a24' }, emblem: '🚩',
    bonuses: ['All units move 10% faster (Ganimi Kava)', 'Cavalry costs 15% less', 'Units +1 line of sight'],
    unique: 'bargir',
    mods: { speed: 1.1, unitCost: { cavalry: 0.85 }, los: 1 },
  },
  vijayanagara: {
    id: 'vijayanagara', name: 'Vijayanagara Empire', short: 'Vijayanagara', era: '1336 – 1646 CE', capital: 'Hampi',
    tagline: 'City of Victory',
    description:
      'From the granite boulders of Hampi, the Vijayanagara emperors built one of the largest cities in the world, defended by great walls and expert archers.',
    arch: 'vijayanagara', colors: { primary: '#b9b2a4', secondary: '#7d2e46' }, emblem: '🐘',
    bonuses: ['Farms worked 10% faster (the Tungabhadra canals)', 'Archers cost 15% less and have 15% more hit points', 'Buildings and walls +20% hit points'],
    unique: 'nayaka_archer',
    mods: { farm: 1.1, unitCost: { ranged: 0.85 }, buildingHp: 1.2, unitHp: { ranged: 1.15 } },
  },
};

export const CIV_IDS = Object.keys(CIVS) as CivId[];
