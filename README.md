# Thrones

A browser-based, online-multiplayer real-time strategy game set among the great empires of the Indian subcontinent:
Maurya, Chola, Mughal, Rajput, Maratha and Vijayanagara. Each has its own bonuses, unique unit and architecture.

See [PLAN.md](PLAN.md) for the roadmap.

## Quick start

```bash
npm install
npm run dev          # game server on :8787 + client on http://localhost:5173
```

Open http://localhost:5173. **Skirmish vs AI** runs entirely in the browser. **Multiplayer Online** needs the
server, which `npm run dev` starts. Open a second browser window to play against yourself.

Production: `npm run build && npm start`. The server then serves the built client and the WebSocket on `:8787`
(set `PORT` to change it).

## Layout

| Package | What it is |
|---|---|
| `packages/shared` | The authoritative game simulation (map gen, A* pathfinding, units, combat, economy, AI) and the shared data, types and protocol. Runs in Node and in the browser. |
| `packages/server` | Node WebSocket server: lobby, rooms, and one `GameRunner` per match at 20 ticks/s, with per-player fog-filtered snapshots. |
| `packages/client` | Vite + Three.js client: procedural low-poly models, fog-of-war shader, HUD, menus, input, WebAudio sound. |

## Useful scripts

- `npm run typecheck`: type-check all packages
- `npm run simtest -- maurya,chola 42`: run a headless AI-vs-AI match and print economy, combat and timing stats
- `http://localhost:5173/?ff=420`: fast-forward the title-screen AI match to watch a battle

## Controls

Left-click/drag to select. Right-click to move, gather, attack, build or set a rally point.
`Q W E R / A S D F / Z X C V` are command-card hotkeys. `Ctrl+1-9` sets a control group. Arrows, the screen edge
or middle-drag pan the camera; the wheel zooms; `[` `]` rotate. `H` jumps to the town centre, `.` cycles idle
villagers, `Esc`/`F10` opens the menu.
