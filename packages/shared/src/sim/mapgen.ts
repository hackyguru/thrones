import { Terrain } from '../constants';
import { makeNoise, mulberry32, type Rng } from '../rng';
import type { ResourceNodeType, Vec2 } from '../types';

export interface MapResource {
  type: ResourceNodeType;
  x: number;
  y: number;
}

export interface MapData {
  size: number;
  terrain: Uint8Array;
  resources: MapResource[];
  /** tile coordinates of each player's town center centre */
  starts: Vec2[];
}

export function generateMap(seed: number, numPlayers: number, size: number): MapData {
  const rng = mulberry32(seed);
  const elev = makeNoise(rng);
  const moist = makeNoise(rng);
  const forestN = makeNoise(rng);
  const detail = makeNoise(rng);

  const n = Math.max(1, numPlayers);
  const c = size / 2;
  const radius = size * 0.34;
  const a0 = rng() * Math.PI * 2;
  const starts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * Math.PI * 2) / Math.max(n, 2);
    starts.push({ x: Math.round(c + Math.cos(a) * radius), y: Math.round(c + Math.sin(a) * radius) });
  }
  if (n === 1) starts[0] = { x: Math.round(c), y: Math.round(c) };

  const terrain = new Uint8Array(size * size);
  const idx = (x: number, y: number) => y * size + x;
  const distToStart = (x: number, y: number) => {
    let d = Infinity;
    for (const s of starts) d = Math.min(d, Math.hypot(x - s.x, y - s.y));
    return d;
  };

  let waterThreshold = 0.66;
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const e = elev(x / 26, y / 26);
        const m = moist(x / 20 + 50, y / 20 + 50);
        const d = detail(x / 7, y / 7);
        const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
        let t: number = Terrain.GRASS;
        if (e > waterThreshold && distToStart(x, y) > 17 && edge > 2) t = Terrain.WATER;
        else if (m < 0.4) t = Terrain.DRY;
        else if (d > 0.68) t = Terrain.DIRT;
        terrain[idx(x, y)] = t;
      }
    }
    if (allConnected(terrain, size, starts)) break;
    waterThreshold += 0.03;
  }

  // shores
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (terrain[idx(x, y)] === Terrain.WATER) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size && terrain[idx(nx, ny)] === Terrain.WATER) {
            nearWater = true;
            break;
          }
        }
      if (nearWater) terrain[idx(x, y)] = Terrain.SAND;
    }
  }

  const used = new Uint8Array(size * size);
  // Reserve town center areas
  for (const s of starts) {
    for (let y = s.y - 6; y <= s.y + 6; y++)
      for (let x = s.x - 6; x <= s.x + 6; x++)
        if (x >= 0 && y >= 0 && x < size && y < size) used[idx(x, y)] = 2;
  }

  const resources: MapResource[] = [];
  const free = (x: number, y: number) =>
    x >= 1 && y >= 1 && x < size - 1 && y < size - 1 && !used[idx(x, y)] && terrain[idx(x, y)] !== Terrain.WATER;
  const place = (type: ResourceNodeType, x: number, y: number) => {
    used[idx(x, y)] = 1;
    resources.push({ type, x, y });
  };

  const blob = (type: ResourceNodeType | ((x: number, y: number) => ResourceNodeType), cx: number, cy: number, count: number, r: Rng, spread = 0.0) => {
    let sx = Math.round(cx), sy = Math.round(cy);
    // find a free seed near the requested location
    let found = false;
    for (let rad = 0; rad < 6 && !found; rad++) {
      for (let dy = -rad; dy <= rad && !found; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (free(sx + dx, sy + dy)) {
            sx += dx;
            sy += dy;
            found = true;
            break;
          }
        }
    }
    if (!found) return 0;
    const frontier: Vec2[] = [{ x: sx, y: sy }];
    let placed = 0;
    while (frontier.length && placed < count) {
      const i = Math.floor(r() * frontier.length);
      const p = frontier.splice(i, 1)[0];
      if (!free(p.x, p.y)) continue;
      if (spread > 0 && r() < spread) continue;
      place(typeof type === 'function' ? type(p.x, p.y) : type, p.x, p.y);
      placed++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) frontier.push({ x: p.x + dx, y: p.y + dy });
    }
    return placed;
  };

  const treeType = (x: number, y: number): ResourceNodeType => {
    const t = terrain[idx(x, y)];
    if (t === Terrain.SAND) return 'palm';
    if (t === Terrain.DRY) return rng() < 0.45 ? 'palm' : 'tree';
    return rng() < 0.12 ? 'palm' : 'tree';
  };

  // Per-player fair resources
  for (const s of starts) {
    const base = rng() * Math.PI * 2;
    const slots = [0, 1, 2, 3, 4].map((k) => base + (k * Math.PI * 2) / 5 + (rng() - 0.5) * 0.4);
    const at = (a: number, d: number) => ({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d });
    // allow placement in the outer part of the reserved zone
    for (let y = s.y - 6; y <= s.y + 6; y++)
      for (let x = s.x - 6; x <= s.x + 6; x++)
        if (x >= 0 && y >= 0 && x < size && y < size && Math.hypot(x - s.x, y - s.y) > 5.5 && used[idx(x, y)] === 2)
          used[idx(x, y)] = 0;
    let p = at(slots[0], 7);
    blob('berry_bush', p.x, p.y, 7, rng);
    p = at(slots[1], 10);
    blob('gold_mine', p.x, p.y, 7, rng);
    p = at(slots[2], 11);
    blob('stone_mine', p.x, p.y, 5, rng);
    p = at(slots[3], 12);
    blob(treeType, p.x, p.y, 45, rng, 0.1);
    p = at(slots[4], 10);
    blob(treeType, p.x, p.y, 18, rng, 0.15);
  }

  // Global forests
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (!free(x, y)) continue;
      if (distToStart(x, y) < 14) continue;
      const f = forestN(x / 13, y / 13);
      if (f > 0.6 && rng() < 0.8) place(treeType(x, y), x, y);
      else if (rng() < 0.012) place(treeType(x, y), x, y);
    }
  }

  // Extra mines
  const extra = (type: ResourceNodeType, count: number, nodes: number) => {
    let made = 0;
    for (let tries = 0; tries < 400 && made < count; tries++) {
      const x = 4 + Math.floor(rng() * (size - 8));
      const y = 4 + Math.floor(rng() * (size - 8));
      if (!free(x, y) || distToStart(x, y) < 22) continue;
      if (blob(type, x, y, nodes, rng) > 0) made++;
    }
  };
  extra('gold_mine', n + 3, 6);
  extra('stone_mine', n + 2, 5);
  extra('berry_bush', n + 2, 6);

  return { size, terrain, resources, starts };
}

function allConnected(terrain: Uint8Array, size: number, starts: Vec2[]): boolean {
  if (starts.length < 2) return true;
  const seen = new Uint8Array(size * size);
  const q: number[] = [starts[0].y * size + starts[0].x];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % size, y = (i / size) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (seen[j] || terrain[j] === Terrain.WATER) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return starts.every((s) => seen[s.y * size + s.x]);
}
