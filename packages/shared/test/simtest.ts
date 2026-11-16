import { GameSession, TICK_RATE, type CivId } from '../src/index';

const civs: CivId[] = (process.argv[2]?.split(',') as CivId[]) ?? ['maurya', 'maratha'];
const pairs = civs.length >= 2 ? civs : ['maurya', 'maratha'];
const seed = Number(process.argv[3] ?? 42);
const s = new GameSession({
  seed,
  players: pairs.map((civ, i) => ({ slot: i, name: 'AI ' + civ, civ: civ as CivId, color: i, isAI: true })),
});
const t0 = performance.now();
const maxTicks = TICK_RATE * 60 * 40;
let worst = 0;
for (let i = 0; i < maxTicks && !s.over; i++) {
  const a = performance.now();
  s.step();
  if (i % 2 === 0) s.snapshots([0, 1]);
  worst = Math.max(worst, performance.now() - a);
  if (i % (TICK_RATE * 120) === 0) {
    const w = s.world;
    const line = w.players.map((p) => {
      let u = 0, b = 0, m = 0;
      for (const e of w.entities.values()) if (e.owner === p.slot) { if (e.kind === 'unit') { u++; if (e.type !== 'villager') m++; } else b++; }
      return `${p.civ}: pop ${p.pop}/${p.popCap} units ${u} (mil ${m}) bld ${b} res ${Object.values(p.res).map(Math.floor).join('/')}`;
    });
    console.log(`t=${Math.round(i / TICK_RATE / 60)}m`, line.join(' | '));
  }
}
const ms = performance.now() - t0;
console.log('ticks', s.world.tick, 'avg ms/tick', (ms / s.world.tick).toFixed(3), 'worst', worst.toFixed(1));
console.log('over', s.over, JSON.stringify(s.gameOverInfo().stats.map((x) => ({ civ: x.civ, alive: x.alive, ...x.stats })), null, 0));
