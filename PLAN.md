# Thrones — Development Plan

A browser-based, online-multiplayer real-time strategy game set across the empires of the
Indian subcontinent. Players pick a civilization (each with its own bonuses, unique unit and
architecture), gather resources, build a city, raise an army and conquer their rivals.

---

## 1. Technical architecture

```
packages/
  shared/   Pure TypeScript game simulation + data (no DOM, no Node APIs)
            ├─ data/      civilizations, units, buildings, stat modifiers
            ├─ sim/       world, map generation, pathfinding, units, combat, AI, session
            └─ protocol   network message types
  server/   Node.js WebSocket server: lobby, rooms, runs authoritative GameSession per room
  client/   Vite + Three.js browser client: menus, 3D renderer, input, HUD, audio
```

**Authoritative server simulation.** The server runs the simulation at 20 ticks/sec and sends
per-player snapshots at 10 Hz. Clients send *commands* only (move, gather, build, train…), so
clients cannot cheat on resources or unit stats. Each snapshot only contains what that player
can see (server-side fog of war = no map hacks). Clients interpolate between snapshots for
smooth 60 fps motion.

**The same simulation runs in the browser** for offline skirmish vs AI (`LocalConnection`),
which also makes development and testing fast — no server needed to try a change.

**Rendering:** Three.js, procedural low-poly art (no external assets needed yet): flat-shaded
models, real-time shadows, ACES tone mapping, animated water, fog-of-war injected into every
material's shader, model-rendered portrait icons. Each civ has its own architectural style.

## 2. Civilizations (v1)

| Civ | Architecture | Bonuses | Unique unit |
|---|---|---|---|
| Maurya Empire | Sandstone, stupa domes | Gold +20%, elephants −25% cost, elephants +15% HP | Gajasena (armored war elephant) |
| Chola Dynasty | Dravidian gopurams | Food +20%, build speed +25%, infantry +1 armor | Velaikkarar (royal guard infantry) |
| Mughal Empire | White marble, onion domes | Train speed +20%, buildings −15% wood, cavalry +10% HP | Mansabdar (horse archer) |
| Rajput Kingdoms | Fortified sandstone, chhatris | Melee attack +15%, buildings +15% HP, towers +1 range | Rajput Lancer (heavy charge cavalry) |
| Maratha Empire | Basalt hill-forts, saffron flags | Units +10% speed, cavalry −15% cost, +1 line of sight | Bargir (fast raiding cavalry) |
| Vijayanagara Empire | Granite pillared halls | Stone +25%, buildings +20% HP, ranged +15% HP | Nayaka Archer (long-range archer) |

## 3. Milestones

### M1 — Fundamentals (this build) ✅
- Monorepo, shared simulation, Node WebSocket server, Vite/Three.js client
- Main menu with live 3D backdrop, civilization codex, online lobby (create/join rooms,
  pick civ & colour, add AI slots), offline skirmish vs AI
- Procedural map: grass/dry/dirt/sand/water, forests, palms, gold, stone, berry bushes,
  fair resource placement per start position
- Economy: food/wood/gold/stone, villagers gather + drop off, population & houses
- Buildings: Durbar (town center), House, Storehouse, Farm, Barracks, Archery Range,
  Stable, Watch Tower — placement ghost, construction, training queues, rally points
- Military: swordsman, spearman, archer, horseman, war elephant + 6 unique units,
  melee/pierce armour, counter bonuses, projectiles, auto-acquire, retaliation, towers
- A* pathfinding with smoothing, group formations, unit separation
- Fog of war (explored / visible), server-side snapshot filtering
- RTS controls: box select, double-click select type, control groups, smart right-click,
  hotkeys, edge/keyboard pan, zoom, rotate, minimap
- HUD: resources, population, selection panel, command card, training queue, alerts
- Basic AI opponent (economy, build order, army waves)
- Victory / defeat screen with stats; procedural sound effects

### M2 — Depth
- Ages (Vedic → Classical → Imperial) with age-up and tech tree
- Upgrades (blacksmith, university), unique techs per civ
- Walls, gates, temples & monks/healers, fortress building for unique units
- Naval units (Chola fleets!) and water maps
- Formations, stances (aggressive/defensive/stand ground), attack-move, patrol
- Teams & diplomacy, more map types (river delta, Deccan plateau, Himalayan pass)

### M3 — Online
- Accounts & persistent profiles, matchmaking & ELO
- Reconnect to running games, spectators, replays (command log)
- Binary delta snapshots (bandwidth), lag compensation, server regions
- Chat & emotes in game

### M4 — Production quality
- Commissioned art: GLTF models with skeletal animation, terrain splat textures
- Music (raga-based score per civ), voice lines in regional languages
- Campaigns (Ashoka's Kalinga, Rajaraja's southern expedition, Shivaji's Swaraj)
- Settings, keybinding UI, accessibility, performance scaling

## 4. Running

```
npm install
npm run dev        # server on :8787, client on :5173 (proxied /ws)
npm run build && npm start   # production: server also serves client build on :8787
```
