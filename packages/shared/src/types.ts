export type ResourceType = 'food' | 'wood' | 'gold' | 'stone';
export const RESOURCE_TYPES: ResourceType[] = ['food', 'wood', 'gold', 'stone'];
export type Resources = Record<ResourceType, number>;
export type Cost = Partial<Resources>;

export type CivId = 'maurya' | 'chola' | 'mughal' | 'rajput' | 'maratha' | 'vijayanagara';

export type UnitClass = 'villager' | 'infantry' | 'ranged' | 'cavalry' | 'elephant';
export type TargetClass = UnitClass | 'building';

export type UnitType =
  | 'villager'
  | 'swordsman'
  | 'spearman'
  | 'archer'
  | 'horseman'
  | 'elephant'
  | 'gajasena'
  | 'velaikkarar'
  | 'mansabdar'
  | 'rajput_lancer'
  | 'bargir'
  | 'nayaka_archer';

export type BuildingType =
  | 'town_center'
  | 'house'
  | 'storehouse'
  | 'farm'
  | 'barracks'
  | 'archery_range'
  | 'stable'
  | 'blacksmith'
  | 'tower'
  | 'wall'
  | 'gate';

export type ResourceNodeType = 'tree' | 'palm' | 'gold_mine' | 'stone_mine' | 'berry_bush';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'raja';

/** 0 aggressive (chase anything in sight), 1 defensive (engage, then return), 2 hold ground (never move) */
export type Stance = 0 | 1 | 2;

export type EntityKind = 'unit' | 'building' | 'resource';

/** Animation state sent to clients. */
export const Anim = { IDLE: 0, WALK: 1, ATTACK: 2, GATHER: 3, BUILD: 4 } as const;
export type AnimCode = (typeof Anim)[keyof typeof Anim];

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Commands (client -> server, validated by the simulation)
// ---------------------------------------------------------------------------
export type Command =
  | { c: 'smart'; ids: number[]; x: number; y: number; target?: number; queue?: boolean }
  | { c: 'move'; ids: number[]; x: number; y: number }
  /** attack-move: march in formation, fighting anything met on the way */
  | { c: 'amove'; ids: number[]; x: number; y: number }
  | { c: 'stance'; ids: number[]; s: Stance }
  | { c: 'attack'; ids: number[]; target: number }
  | { c: 'build'; ids: number[]; type: BuildingType; tx: number; ty: number }
  /** lay a line of wall foundations between two tiles */
  | { c: 'wall'; ids: number[]; ax: number; ay: number; bx: number; by: number }
  | { c: 'train'; building: number; type: UnitType }
  | { c: 'research'; building: number; tech: string }
  | { c: 'cancel'; building: number; index: number }
  | { c: 'rally'; building: number; x: number; y: number; target?: number }
  | { c: 'stop'; ids: number[] }
  | { c: 'delete'; ids: number[] };

// ---------------------------------------------------------------------------
// Snapshot data (server -> client)
// ---------------------------------------------------------------------------
export interface EntSnap {
  i: number;
  /** 0 unit, 1 building */
  k: 0 | 1;
  t: string;
  o: number;
  x: number;
  y: number;
  h: number;
  m: number;
  /** anim */
  a?: AnimCode;
  /** facing (radians) */
  f?: number;
  /** carry amount / type */
  c?: number;
  ct?: ResourceType;
  /** gather type (tool to show) */
  g?: ResourceType;
  /** construction progress (buildings, 0..1). Absent when complete. */
  p?: number;
  /** training / research queue (owner only): [unit type or tech id, progress] */
  q?: [string, number][];
  /** rally point (owner only) */
  r?: [number, number];
  /** farm food remaining */
  fa?: number;
  /** stance (own units only, absent = aggressive) */
  st?: Stance;
}

export type GameEvent =
  | { e: 'proj'; a: number; tg: number; sx: number; sy: number; tx: number; ty: number; d: number; k: 'arrow' | 'bolt' }
  | { e: 'hit'; tg: number; a: number; x: number; y: number }
  | { e: 'die'; i: number; x: number; y: number; t: string; o: number; k: 0 | 1 }
  | { e: 'built'; i: number; t: string }
  | { e: 'trained'; i: number; t: string }
  /** a tech finished (owner); age advances are announced to everyone */
  | { e: 'researched'; t: string; o: number }
  | { e: 'alert'; x: number; y: number }
  | { e: 'defeat'; o: number }
  | { e: 'popcap' };

export interface PlayerSnap {
  r: Resources;
  pop: number;
  cap: number;
  /** researched techs */
  tc?: string[];
}

export interface Snapshot {
  t: number;
  me: PlayerSnap | null;
  e: EntSnap[];
  /** resource amount changes [id, amount]; amount 0 = removed */
  rc?: [number, number][];
  ev?: GameEvent[];
  /** alive flags by slot */
  al: boolean[];
  /** age by slot */
  ag?: number[];
}

export interface PlayerInfo {
  slot: number;
  name: string;
  civ: CivId;
  color: number;
  isAI: boolean;
  /** per-AI difficulty (falls back to the match setting) */
  difficulty?: Difficulty;
}

export interface ResourceInit {
  i: number;
  t: ResourceNodeType;
  x: number;
  y: number;
  a: number;
}

export interface GameInit {
  seed: number;
  mapSize: number;
  /** one char per tile, terrain code */
  terrain: string;
  resources: ResourceInit[];
  players: PlayerInfo[];
  you: number;
  starts: Vec2[];
}

export interface PlayerStats {
  gathered: Resources;
  unitsTrained: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  buildingsLost: number;
  razed: number;
}

export interface GameOverInfo {
  winner: number;
  stats: { slot: number; name: string; civ: CivId; color: number; stats: PlayerStats; alive: boolean }[];
  durationSec: number;
}
