export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
/** Snapshots are sent every N simulation ticks. */
export const SNAPSHOT_EVERY = 2;
export const MAP_SIZE = 128;
export const MAX_PLAYERS = 4;
export const POP_HARD_CAP = 200;
export const CARRY_CAPACITY = 10;
export const UNIT_RADIUS = 0.3;
export const MELEE_RANGE = 0.5;
export const INTERACT_RANGE = 0.6;
export const MAX_QUEUE = 5;
export const PROJECTILE_SPEED = 14; // tiles per second

export const START_RESOURCES = { food: 200, wood: 200, gold: 100, stone: 100 };

export const PLAYER_COLORS = [
  { id: 'saffron', name: 'Saffron', hex: 0xf08a24 },
  { id: 'indigo', name: 'Indigo', hex: 0x3d63d8 },
  { id: 'emerald', name: 'Emerald', hex: 0x27a865 },
  { id: 'crimson', name: 'Crimson', hex: 0xcc2f3b },
  { id: 'violet', name: 'Violet', hex: 0x8f4fc6 },
  { id: 'turquoise', name: 'Turquoise', hex: 0x17b3ad },
] as const;

export const Terrain = {
  GRASS: 0,
  DRY: 1,
  DIRT: 2,
  SAND: 3,
  WATER: 4,
} as const;
export type TerrainType = (typeof Terrain)[keyof typeof Terrain];
