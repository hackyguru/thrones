// The snapshot tells the client which gatherers are working a farm (they hoe) and which are foraging.
import { GameSession, TICK_RATE } from '../src/index';
const s = new GameSession({ seed: 3, players: [
  { slot: 0, name: 'a', civ: 'chola', color: 0, isAI: false },
  { slot: 1, name: 'b', civ: 'maurya', color: 1, isAI: false },
] });
const w = s.world;
const tc = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'town_center')!;
const farm = w.placeBuilding(0, 'farm', tc.tx + 5, tc.ty, true);
const v = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'villager')!;
s.command(0, { c: 'smart', ids: [v.id], x: farm.x, y: farm.y, target: farm.id });
// a second villager forages at the nearest wild food
const v2 = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'villager' && e !== v)!;
const bush = [...w.entities.values()].filter((e) => e.kind === 'resource' && e.resType === 'food')
  .sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y))[0];
s.command(0, { c: 'smart', ids: [v2.id], x: bush.x, y: bush.y, target: bush.id });
for (let i = 0; i < 15 * TICK_RATE; i++) s.step();
const snap = s.snapshots([0]).get(0)!;
const me = snap.e.find((e) => e.i === v.id)!;
const inField = (e: { x: number; y: number }) => e.x > farm.tx && e.y > farm.ty && e.x < farm.tx + 3 && e.y < farm.ty + 3;
const ok = me.g === 'food' && me.fm === 1 && me.a === 3 && inField(me);
const other = snap.e.filter((e) => e.t === 'villager' && e.i !== v.id && e.g);
const ok2 = other.length > 0 && other.every((e) => e.fm === undefined);
console.log(ok ? 'PASS' : 'FAIL', 'farmer flagged', JSON.stringify({ a: me.a, g: me.g, fm: me.fm, x: me.x, y: me.y, farm: [farm.tx, farm.ty] }));
console.log(ok2 ? 'PASS' : 'FAIL', 'other gatherers not flagged', other.map((e) => e.g).join(','));
// two more farmers on the same field: they work at different spots, all inside it
const more = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'villager' && e !== v && e !== v2).slice(0, 2);
s.command(0, { c: 'smart', ids: more.map((e) => e.id), x: farm.x, y: farm.y, target: farm.id });
const food0 = w.players[0].res.food;
for (let i = 0; i < 90 * TICK_RATE; i++) s.step();
const fs = [v, ...more];
const spread = fs.every((a, i) => fs.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > 0.3));
const ok3 = fs.every((e) => e.anim !== 3 || inField(e)) && spread;
console.log(ok3 ? 'PASS' : 'FAIL', 'farmers spread over the field', fs.map((e) => `${e.x.toFixed(2)},${e.y.toFixed(2)} a${e.anim}`).join(' '));
const ok4 = w.players[0].res.food > food0 + 60;
console.log(ok4 ? 'PASS' : 'FAIL', 'food keeps coming in', `${food0} -> ${w.players[0].res.food.toFixed(0)}`);
process.exit(ok && ok2 && ok3 && ok4 ? 0 : 1);
