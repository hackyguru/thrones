// Scripted checks for walls and gates: laying a line, gates for friends only, breaking through.
import { GameSession, TICK_RATE } from '../src/index';
import type { Entity, World } from '../src/sim/world';

function setup() {
  const s = new GameSession({ seed: 5, players: [
    { slot: 0, name: 'a', civ: 'maurya', color: 0, isAI: false },
    { slot: 1, name: 'b', civ: 'chola', color: 1, isAI: false },
  ] });
  const w = s.world;
  for (const e of [...w.entities.values()]) if (e.kind === 'unit') w.removeEntity(e);
  for (const p of w.players) {
    p.age = 2;
    p.techs = ['age2'];
    p.res.stone = 1000;
  }
  return { s, w };
}
const run = (s: GameSession, sec: number) => { for (let i = 0; i < sec * TICK_RATE; i++) s.step(); };
let fail = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(ok ? 'PASS' : 'FAIL', name, info); if (!ok) fail++; };

/** clear a 30x16 arena in the middle of the map; returns its top-left tile */
function open(w: World) {
  const x0 = Math.floor(w.size / 2) - 13, y0 = Math.floor(w.size / 2) - 8;
  for (const e of [...w.entities.values()]) {
    if (e.kind === 'resource' && e.tx >= x0 - 2 && e.tx <= x0 + 32 && e.ty >= y0 - 2 && e.ty <= y0 + 18) w.removeEntity(e);
  }
  for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 30; x++) if (!w.walkable(x, y)) throw new Error('arena blocked at ' + x + ',' + y);
  return { x0, y0 };
}

/** a closed square of finished walls (owner 0) with a gate in the middle of the left side */
function ring(w: World, x0: number, y0: number, n: number) {
  let gate: Entity | null = null;
  for (let i = 0; i < n; i++)
    for (const [x, y] of [[x0 + i, y0], [x0 + i, y0 + n - 1], [x0, y0 + i], [x0 + n - 1, y0 + i]]) {
      if (w.occ[y * w.size + x]) continue;
      const isGate = x === x0 && y === y0 + (n >> 1);
      const b = w.placeBuilding(0, isGate ? 'gate' : 'wall', x, y, true);
      if (isGate) gate = b;
    }
  return gate!;
}
const inside = (e: Entity, x0: number, y0: number, n: number) => e.x > x0 + 1 && e.x < x0 + n - 1 && e.y > y0 + 1 && e.y < y0 + n - 1;
const walls = (w: World, owner: number) => [...w.entities.values()].filter((e) => e.owner === owner && e.type === 'wall');

{ // villagers lay a line and build it section by section
  const { s, w } = setup();
  const { x0, y0 } = open(w);
  const v = [0, 1, 2].map((i) => w.spawnUnit(0, 'villager', x0 + 2, y0 + 4 + i));
  const stone = w.players[0].res.stone;
  s.command(0, { c: 'wall', ids: v.map((e) => e.id), ax: x0 + 5, ay: y0 + 2, bx: x0 + 14, by: y0 + 8 });
  const placed = walls(w, 0);
  check('wall line placed', placed.length === 16, `${placed.length} sections, paid ${stone - w.players[0].res.stone} stone`);
  // the line must have no diagonal-only joints
  const set = new Set(placed.map((e) => e.tx + ',' + e.ty));
  const joined = placed.every((e) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => set.has(e.tx + dx + ',' + (e.ty + dy))));
  check('sections join edge to edge', joined);
  run(s, 70);
  check('all sections built', walls(w, 0).every((e) => e.built), walls(w, 0).filter((e) => !e.built).length + ' unfinished');
}

{ // a gate opens for its owner only
  const { s, w } = setup();
  const { x0, y0 } = open(w);
  const n = 9, rx = x0 + 10, ry = y0 + 3;
  ring(w, rx, ry, n);
  const mine = w.spawnUnit(0, 'swordsman', rx + 4.5, ry + 4.5);
  s.command(0, { c: 'move', ids: [mine.id], x: rx - 6, y: ry + 4.5 });
  run(s, 12);
  check('own unit walks out through the gate', mine.x < rx - 4, `at ${mine.x.toFixed(1)},${mine.y.toFixed(1)}`);
  s.command(0, { c: 'move', ids: [mine.id], x: rx + 4.5, y: ry + 4.5 });
  run(s, 12);
  check('and back in', inside(mine, rx, ry, n), `at ${mine.x.toFixed(1)},${mine.y.toFixed(1)}`);
  const foe = w.spawnUnit(1, 'villager', rx - 5, ry + 4.5);
  s.command(1, { c: 'move', ids: [foe.id], x: rx + 4.5, y: ry + 4.5 });
  run(s, 20);
  check('enemy cannot get in', !inside(foe, rx, ry, n), `at ${foe.x.toFixed(1)},${foe.y.toFixed(1)}`);
  check('nothing was knocked down by a plain move', walls(w, 0).every((e) => e.hp === e.maxHp));
}

{ // soldiers on attack-move batter their way through
  const { s, w } = setup();
  const { x0, y0 } = open(w);
  const n = 9, rx = x0 + 12, ry = y0 + 3;
  ring(w, rx, ry, n);
  const before = walls(w, 0).length;
  const g = [0, 1, 2, 3, 4].map((i) => w.spawnUnit(1, 'swordsman', x0 + 2, ry + 2 + i));
  s.command(1, { c: 'amove', ids: g.map((e) => e.id), x: rx + 4.5, y: ry + 4.5 });
  run(s, 120);
  check('attack-move broke a section', walls(w, 0).length < before, `${before - walls(w, 0).length} broken`);
  check('and got inside', g.some((e) => !e.dead && inside(e, rx, ry, n)), g.map((e) => `${e.x.toFixed(1)},${e.y.toFixed(1)}`).join(' '));
}

{ // an attack order on a building behind walls breaks in, then finishes the job
  const { s, w } = setup();
  const { x0, y0 } = open(w);
  const n = 9, rx = x0 + 12, ry = y0 + 3;
  ring(w, rx, ry, n);
  const house = w.placeBuilding(0, 'house', rx + 3, ry + 3, true);
  const g = [0, 1, 2, 3, 4, 5].map((i) => w.spawnUnit(1, 'swordsman', x0 + 2, ry + 2 + i));
  s.command(1, { c: 'attack', ids: g.map((e) => e.id), target: house.id });
  run(s, 180);
  check('attackers reached and razed the house', house.dead, `house hp ${house.hp}`);
}

{ // a gate placed on a wall section replaces it; saves keep gates working
  const { s, w } = setup();
  const { x0, y0 } = open(w);
  const v = w.spawnUnit(0, 'villager', x0 + 2, y0 + 5);
  s.command(0, { c: 'wall', ids: [v.id], ax: x0 + 6, ay: y0 + 2, bx: x0 + 6, by: y0 + 10 });
  run(s, 60);
  const mid = walls(w, 0).find((e) => e.ty === y0 + 6)!;
  s.command(0, { c: 'build', ids: [v.id], type: 'gate', tx: mid.tx, ty: mid.ty });
  run(s, 25);
  const gate = [...w.entities.values()].find((e) => e.type === 'gate');
  check('gate replaced the section', !!gate && gate.built && mid.dead, gate ? `built=${gate.built}` : 'no gate');
  const re = GameSession.deserialize(s.serialize()).world;
  check('gate is open to its owner after loading', !!gate && re.passable(gate.tx, gate.ty, 0) && !re.passable(gate.tx, gate.ty, 1));
}

{ // walls alone don't keep a player in the game
  const { s, w } = setup();
  for (const e of [...w.entities.values()]) if (e.owner === 1) w.removeEntity(e);
  w.placeBuilding(1, 'wall', 3, 3, true);
  run(s, 2);
  check('player with only walls is defeated', !w.players[1].alive);
}

console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
