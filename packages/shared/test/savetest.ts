import { GameSession, TICK_RATE, type CivId } from '../src/index';

const civs: CivId[] = ['mughal', 'rajput', 'maratha', 'chola'];
const s = new GameSession({ seed: 9, players: civs.map((civ, i) => ({ slot: i, name: 'AI ' + civ, civ, color: i, isAI: true })) });
for (let i = 0; i < TICK_RATE * 60 * 8; i++) s.step();
const t0 = performance.now();
const json = s.serialize();
const t1 = performance.now();
const r = GameSession.deserialize(json);
const t2 = performance.now();
const sum = (x: GameSession) => {
  const w = x.world;
  let units = 0, blds = 0, res = 0, hp = 0;
  for (const e of w.entities.values()) { if (e.kind === 'unit') units++; else if (e.kind === 'building') blds++; else res++; hp += e.hp; }
  return { tick: w.tick, units, blds, res, hp: Math.round(hp), food: w.players.map((p) => Math.round(p.res.food)).join('/') };
};
console.log('save KB', (json.length / 1024).toFixed(0), 'ser ms', (t1 - t0).toFixed(1), 'load ms', (t2 - t1).toFixed(1));
console.log('original', JSON.stringify(sum(s)));
console.log('restored', JSON.stringify(sum(r)));
console.log('round trip identical:', r.serialize() === json);
for (let i = 0; i < TICK_RATE * 60 * 4; i++) { r.step(); s.step(); }
console.log('after 4 more min: original', JSON.stringify(sum(s)), '\n                    restored', JSON.stringify(sum(r)), 'over', r.over);
