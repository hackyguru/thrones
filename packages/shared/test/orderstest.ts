// Scripted checks for formations, attack-move and stances.
import { GameSession, TICK_RATE } from '../src/index';
import type { Entity } from '../src/sim/world';

function setup() {
  const s = new GameSession({ seed: 5, players: [
    { slot: 0, name: 'a', civ: 'maurya', color: 0, isAI: false },
    { slot: 1, name: 'b', civ: 'chola', color: 1, isAI: false },
  ] });
  const w = s.world;
  // clear a test arena
  for (const e of [...w.entities.values()]) if (e.kind === 'unit') w.removeEntity(e);
  return { s, w };
}
const run = (s: GameSession, sec: number) => { for (let i = 0; i < sec * TICK_RATE; i++) s.step(); };
let fail = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(ok ? 'PASS' : 'FAIL', name, info); if (!ok) fail++; };

// clear an arena of trees and mines away from the towns
function open(w: ReturnType<typeof setup>['w']) {
  const x0 = Math.floor(w.size / 2) - 13, y0 = Math.floor(w.size / 2) - 6;
  for (const e of [...w.entities.values()]) {
    if (e.kind === 'resource' && e.tx >= x0 - 2 && e.tx <= x0 + 32 && e.ty >= y0 - 2 && e.ty <= y0 + 14) w.removeEntity(e);
  }
  for (let y = y0; y < y0 + 12; y++) for (let x = x0; x < x0 + 30; x++) if (!w.walkable(x, y)) throw new Error('arena blocked at ' + x + ',' + y);
  return { x: x0 + 3.5, y: y0 + 5.5 };
}

{ // formation: mixed group arrives together, ranged behind melee
  const { s, w } = setup();
  const o = open(w);
  const g: Entity[] = [];
  for (let i = 0; i < 6; i++) g.push(w.spawnUnit(0, 'swordsman', o.x + (i % 3), o.y + Math.floor(i / 3)));
  for (let i = 0; i < 4; i++) g.push(w.spawnUnit(0, 'archer', o.x + i, o.y + 3));
  g.push(w.spawnUnit(0, 'horseman', o.x - 1, o.y));
  s.command(0, { c: 'move', ids: g.map((e) => e.id), x: o.x + 20, y: o.y + 1 });
  run(s, 3);
  const xs = g.map((e) => e.x);
  check('formation keeps pace (spread while marching)', Math.max(...xs) - Math.min(...xs) < 5, `spread ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)}`);
  run(s, 14);
  const sw = g.filter((e) => e.type === 'swordsman'), ar = g.filter((e) => e.type === 'archer');
  const avg = (l: Entity[]) => l.reduce((a, e) => a + e.x, 0) / l.length;
  check('arrived', g.every((e) => !e.order), g.map((e) => e.x.toFixed(1)).join(','));
  check('melee in front of archers', avg(sw) > avg(ar), `${avg(sw).toFixed(2)} vs ${avg(ar).toFixed(2)}`);
}

{ // attack-move fights on the way, then carries on
  const { s, w } = setup();
  const o = open(w);
  const g = [0, 1, 2].map((i) => w.spawnUnit(0, 'swordsman', o.x, o.y + i));
  const foe = w.spawnUnit(1, 'villager', o.x + 9, o.y + 1);
  s.command(0, { c: 'amove', ids: g.map((e) => e.id), x: o.x + 22, y: o.y + 1 });
  run(s, 25);
  check('attack-move killed the enemy on the way', foe.dead);
  check('attack-move continued to destination', g.every((e) => e.x > o.x + 19), g.map((e) => e.x.toFixed(1)).join(','));
}

{ // plain move ignores enemies
  const { s, w } = setup();
  const o = open(w);
  const u = w.spawnUnit(0, 'swordsman', o.x, o.y);
  const foe = w.spawnUnit(1, 'villager', o.x + 9, o.y + 1.5);
  s.command(0, { c: 'move', ids: [u.id], x: o.x + 22, y: o.y });
  run(s, 16);
  check('move does not stop to fight', !foe.dead && u.x > o.x + 20);
}

{ // hold ground never moves; defensive returns to post; aggressive chases
  const { s, w } = setup();
  const o = open(w);
  const hold = w.spawnUnit(0, 'swordsman', o.x, o.y);
  const def = w.spawnUnit(0, 'swordsman', o.x, o.y + 3);
  const agg = w.spawnUnit(0, 'swordsman', o.x, o.y - 3);
  s.command(0, { c: 'stance', ids: [hold.id], s: 2 });
  s.command(0, { c: 'stance', ids: [def.id], s: 1 });
  const e1 = w.spawnUnit(1, 'villager', o.x + 3.5, o.y);
  const e2 = w.spawnUnit(1, 'villager', o.x + 3.5, o.y + 3);
  const e3 = w.spawnUnit(1, 'villager', o.x + 3.5, o.y - 3);
  for (const e of [e1, e2, e3]) e.order = { type: 'move', x: o.x + 24, y: e.y, target: 0 };
  run(s, 1);
  run(s, 14);
  check('hold ground stayed put', Math.hypot(hold.x - o.x, hold.y - o.y) < 0.6, `${hold.x.toFixed(2)},${hold.y.toFixed(2)}`);
  check('defensive returned to post', Math.hypot(def.x - o.x, def.y - (o.y + 3)) < 1.8, `${(def.x - o.x).toFixed(2)}`);
  check('aggressive chased', agg.x - o.x > 4 || e3.dead, `${(agg.x - o.x).toFixed(2)} dead=${e3.dead}`);
}
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
