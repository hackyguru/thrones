import type { Vec2 } from '../types';

const SQRT2 = Math.SQRT2;

export interface PathResult {
  path: Vec2[];
  reached: boolean;
}

/** Grid A* with goal rectangles, partial paths and line-of-sight smoothing. */
export class Pathfinder {
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private state: Uint32Array; // gen*2 = open, gen*2+1 = closed
  private gen = 1;
  private heap: Int32Array;
  private heapKey: Float32Array;
  private heapSize = 0;

  constructor(
    public size: number,
    public walkable: (x: number, y: number) => boolean,
  ) {
    const n = size * size;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.state = new Uint32Array(n);
    this.heap = new Int32Array(n * 4);
    this.heapKey = new Float32Array(n * 4);
  }

  /**
   * Find a path from tile (sx,sy) to any walkable tile inside rect [x0..x1]x[y0..y1].
   * Returns tile-centre waypoints excluding the start.
   */
  find(sx: number, sy: number, x0: number, y0: number, x1: number, y1: number, maxNodes = 6000): PathResult {
    const size = this.size;
    sx = clamp(sx | 0, 0, size - 1);
    sy = clamp(sy | 0, 0, size - 1);
    x0 = clamp(x0, 0, size - 1);
    y0 = clamp(y0, 0, size - 1);
    x1 = clamp(x1, 0, size - 1);
    y1 = clamp(y1, 0, size - 1);
    this.gen += 2;
    if (this.gen > 0xfffffff0) {
      this.state.fill(0);
      this.gen = 3;
    }
    const OPEN = this.gen, CLOSED = this.gen + 1;
    const h = (x: number, y: number) => {
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
    };
    const start = sy * size + sx;
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = h(sx, sy);
    this.parent[start] = -1;
    this.state[start] = OPEN;
    this.push(start);
    let best = start;
    let bestH = this.f[start];
    let goal = -1;
    let expanded = 0;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.state[cur] === CLOSED) continue;
      this.state[cur] = CLOSED;
      const cx = cur % size, cy = (cur / size) | 0;
      const ch = h(cx, cy);
      if (ch === 0 && (cur === start || this.walkable(cx, cy))) {
        goal = cur;
        break;
      }
      if (ch < bestH) {
        bestH = ch;
        best = cur;
      }
      if (++expanded > maxNodes) break;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (!this.walkable(nx, ny)) continue;
          if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
          const ni = ny * size + nx;
          if (this.state[ni] === CLOSED) continue;
          const ng = this.g[cur] + (dx && dy ? SQRT2 : 1);
          if (this.state[ni] === OPEN && ng >= this.g[ni]) continue;
          this.g[ni] = ng;
          this.f[ni] = ng + h(nx, ny) * 1.001;
          this.parent[ni] = cur;
          this.state[ni] = OPEN;
          this.push(ni);
        }
      }
    }
    const end = goal >= 0 ? goal : best;
    const tiles: Vec2[] = [];
    for (let i = end; i !== -1 && i !== start; i = this.parent[i]) {
      tiles.push({ x: (i % size) + 0.5, y: ((i / size) | 0) + 0.5 });
    }
    tiles.reverse();
    return { path: this.smooth(sx + 0.5, sy + 0.5, tiles), reached: goal >= 0 };
  }

  /** Remove intermediate waypoints that have clear line of sight. */
  smooth(sx: number, sy: number, pts: Vec2[]): Vec2[] {
    if (pts.length <= 1) return pts;
    const out: Vec2[] = [];
    let ax = sx, ay = sy;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      // farthest visible point (cap lookahead for perf)
      const limit = Math.min(pts.length - 1, i + 24);
      j = limit;
      while (j > i && !this.lineClear(ax, ay, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]);
      ax = pts[j].x;
      ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  lineClear(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return true;
    const steps = Math.ceil(len / 0.25);
    const px = (-dy / len) * 0.32, py = (dx / len) * 0.32;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t, y = ay + dy * t;
      if (!this.walkable(Math.floor(x), Math.floor(y))) return false;
      if (!this.walkable(Math.floor(x + px), Math.floor(y + py))) return false;
      if (!this.walkable(Math.floor(x - px), Math.floor(y - py))) return false;
    }
    return true;
  }

  private push(i: number) {
    if (this.heapSize >= this.heap.length) return;
    const heap = this.heap, key = this.heapKey;
    const fi = this.f[i];
    let k = this.heapSize++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (key[p] <= fi) break;
      heap[k] = heap[p];
      key[k] = key[p];
      k = p;
    }
    heap[k] = i;
    key[k] = fi;
  }

  private pop(): number {
    const heap = this.heap, key = this.heapKey;
    const top = heap[0];
    const n = --this.heapSize;
    if (n === 0) return top;
    const last = heap[n], lastK = key[n];
    let k = 0;
    while (true) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && key[c + 1] < key[c]) c++;
      if (key[c] >= lastK) break;
      heap[k] = heap[c];
      key[k] = key[c];
      k = c;
    }
    heap[k] = last;
    key[k] = lastK;
    return top;
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
