// AI ladder: each difficulty against the one below it, both seats, several seeds.
import { GameSession, TICK_RATE, type CivId, type Difficulty } from '../src/index';

const civs: CivId[] = ['maurya', 'chola', 'mughal', 'rajput', 'maratha', 'vijayanagara'];
const pairs: [Difficulty, Difficulty][] = (process.argv[2] ?? 'easy:normal,normal:hard,hard:raja').split(',').map((s) => s.split(':') as [Difficulty, Difficulty]);
const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
for (const [a, b] of pairs) {
  let wins = { [a]: 0, [b]: 0, draw: 0 } as Record<string, number>;
  for (const seed of seeds) {
    const swap = seed % 2 === 0;
    const diffs: Difficulty[] = swap ? [b, a] : [a, b];
    const pc = [civs[seed % 6], civs[(seed * 5 + 1) % 6]];
    const s = new GameSession({
      seed,
      players: diffs.map((d, i) => ({ slot: i, name: d, civ: pc[i], color: i, isAI: true, difficulty: d })),
    });
    const max = TICK_RATE * 60 * 45;
    const t0 = performance.now();
    while (s.world.tick < max && !s.over) {
      s.step();
      if (s.world.tick % 2 === 0) s.snapshots([0, 1]);
    }
    const info = s.gameOverInfo();
    const w = s.world;
    const mil = w.players.map((p) => [...w.entities.values()].filter((e) => e.owner === p.slot && e.kind === 'unit' && e.type !== 'villager').length);
    const res = info.winner >= 0 ? diffs[info.winner] : 'draw';
    wins[res]++;
    console.log(`seed ${seed} ${diffs[0]}(${pc[0]}) vs ${diffs[1]}(${pc[1]}): ${res} at ${Math.round(w.tick / TICK_RATE / 60)}m`,
      info.stats.map((x) => `${x.name} k${x.stats.kills}/l${x.stats.unitsLost} razed ${x.stats.razed} mil ${mil[x.slot]}`).join(' | '),
      `(${((performance.now() - t0) / w.tick).toFixed(2)} ms/tick)`);
  }
  console.log(`== ${a} vs ${b}:`, JSON.stringify(wins));
}
