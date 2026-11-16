import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CIV_IDS, GameRunner, MAX_PLAYERS, PLAYER_COLORS,
  type CivId, type ClientMsg, type PlayerInfo, type RoomState, type RoomSummary, type ServerMsg,
} from '@thrones/shared';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../client/dist', import.meta.url));

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  roomId: string | null;
  msgCount: number;
  msgWindow: number;
}

interface Room {
  state: RoomState;
  runner: GameRunner | null;
  /** clientId -> game slot */
  slotOf: Map<string, number>;
}

const clients = new Map<string, Client>();
const rooms = new Map<string, Room>();

function send(c: Client | undefined, msg: ServerMsg) {
  if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}

function summaries(): RoomSummary[] {
  return [...rooms.values()].map((r) => ({
    id: r.state.id,
    name: r.state.name,
    players: r.state.slots.length,
    maxPlayers: r.state.maxPlayers,
    status: r.state.status,
    host: clients.get(r.state.hostId)?.name ?? '?',
  }));
}

function broadcastRooms() {
  const msg: ServerMsg = { type: 'rooms', rooms: summaries() };
  for (const c of clients.values()) if (!c.roomId) send(c, msg);
}

function broadcastRoom(room: Room) {
  for (const s of room.state.slots) if (s.clientId) send(clients.get(s.clientId), { type: 'room', room: room.state });
}

function freeColor(room: Room): number {
  const used = new Set(room.state.slots.map((s) => s.color));
  for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
  return 0;
}

function sanitize(s: unknown, max = 24): string {
  return String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

function leaveRoom(c: Client) {
  const room = c.roomId ? rooms.get(c.roomId) : undefined;
  c.roomId = null;
  if (!room) return;
  if (room.state.status === 'playing' && room.runner) {
    const slot = room.slotOf.get(c.id);
    if (slot !== undefined) room.runner.session.resign(slot);
    room.slotOf.delete(c.id);
  }
  room.state.slots = room.state.slots.filter((s) => s.clientId !== c.id);
  const humans = room.state.slots.filter((s) => s.clientId);
  if (!humans.length) {
    room.runner?.stop();
    rooms.delete(room.state.id);
  } else {
    if (room.state.hostId === c.id) room.state.hostId = humans[0].clientId!;
    if (room.state.status === 'lobby') room.state.slots.forEach((s, i) => (s.slot = i));
    broadcastRoom(room);
  }
  send(c, { type: 'room', room: null });
  broadcastRooms();
}

function startGame(room: Room) {
  const st = room.state;
  if (st.slots.length < 1) return;
  const seed = (Math.random() * 2 ** 31) | 0;
  const players: PlayerInfo[] = st.slots.map((s, i) => ({
    slot: i,
    name: s.name,
    civ: (s.civ === 'random' ? CIV_IDS[Math.floor(Math.random() * CIV_IDS.length)] : s.civ) as CivId,
    color: s.color,
    isAI: s.isAI,
  }));
  room.slotOf.clear();
  st.slots.forEach((s, i) => {
    if (s.clientId) room.slotOf.set(s.clientId, i);
  });
  st.status = 'playing';
  const runner = new GameRunner(
    { seed, players },
    {
      listeners: () => [...room.slotOf.values()],
      onSnapshot: (slot, snap) => {
        for (const [cid, s] of room.slotOf) if (s === slot) send(clients.get(cid), { type: 'snap', s: snap });
      },
      onGameOver: (info) => {
        for (const cid of room.slotOf.keys()) send(clients.get(cid), { type: 'gameOver', info });
        room.runner = null;
        st.status = 'lobby';
        broadcastRooms();
      },
    },
  );
  room.runner = runner;
  for (const [cid, slot] of room.slotOf) send(clients.get(cid), { type: 'gameStart', init: runner.session.initFor(slot) });
  runner.start();
  broadcastRooms();
}

function handle(c: Client, msg: ClientMsg) {
  const room = c.roomId ? rooms.get(c.roomId) : undefined;
  const isHost = room?.state.hostId === c.id;
  switch (msg.type) {
    case 'hello':
      c.name = sanitize(msg.name) || 'Raja';
      send(c, { type: 'rooms', rooms: summaries() });
      break;
    case 'listRooms':
      send(c, { type: 'rooms', rooms: summaries() });
      break;
    case 'createRoom': {
      if (room) leaveRoom(c);
      const id = randomUUID().slice(0, 6);
      const r: Room = {
        state: {
          id, name: sanitize(msg.name, 32) || `${c.name}'s Durbar`, hostId: c.id, status: 'lobby', maxPlayers: MAX_PLAYERS,
          slots: [{ slot: 0, name: c.name, civ: 'random', color: 0, isAI: false, clientId: c.id }],
        },
        runner: null,
        slotOf: new Map(),
      };
      rooms.set(id, r);
      c.roomId = id;
      broadcastRoom(r);
      broadcastRooms();
      break;
    }
    case 'joinRoom': {
      const r = rooms.get(msg.roomId);
      if (!r) return send(c, { type: 'error', message: 'That room no longer exists.' });
      if (r.state.status !== 'lobby') return send(c, { type: 'error', message: 'That game has already started.' });
      if (r.state.slots.length >= r.state.maxPlayers) return send(c, { type: 'error', message: 'Room is full.' });
      if (room) leaveRoom(c);
      r.state.slots.push({ slot: r.state.slots.length, name: c.name, civ: 'random', color: freeColor(r), isAI: false, clientId: c.id });
      c.roomId = r.state.id;
      broadcastRoom(r);
      broadcastRooms();
      break;
    }
    case 'leaveRoom':
      leaveRoom(c);
      break;
    case 'setCiv':
    case 'setColor': {
      if (!room || room.state.status !== 'lobby') return;
      const target = msg.slot !== undefined && isHost
        ? room.state.slots.find((s) => s.slot === msg.slot && (s.isAI || s.clientId === c.id))
        : room.state.slots.find((s) => s.clientId === c.id);
      if (!target) return;
      if (msg.type === 'setCiv') {
        if (msg.civ !== 'random' && !CIV_IDS.includes(msg.civ)) return;
        target.civ = msg.civ;
      } else {
        const col = msg.color | 0;
        if (col < 0 || col >= PLAYER_COLORS.length) return;
        if (room.state.slots.some((s) => s !== target && s.color === col)) return;
        target.color = col;
      }
      broadcastRoom(room);
      break;
    }
    case 'addAI': {
      if (!room || !isHost || room.state.status !== 'lobby' || room.state.slots.length >= room.state.maxPlayers) return;
      const n = room.state.slots.filter((s) => s.isAI).length + 1;
      room.state.slots.push({ slot: room.state.slots.length, name: `AI Raja ${n}`, civ: 'random', color: freeColor(room), isAI: true });
      broadcastRoom(room);
      broadcastRooms();
      break;
    }
    case 'removeSlot': {
      if (!room || !isHost || room.state.status !== 'lobby') return;
      const s = room.state.slots.find((x) => x.slot === msg.slot);
      if (!s || !s.isAI) return;
      room.state.slots = room.state.slots.filter((x) => x !== s);
      room.state.slots.forEach((x, i) => (x.slot = i));
      broadcastRoom(room);
      broadcastRooms();
      break;
    }
    case 'startGame':
      if (room && isHost && room.state.status === 'lobby') startGame(room);
      break;
    case 'cmd': {
      if (!room?.runner) return;
      const slot = room.slotOf.get(c.id);
      if (slot === undefined || typeof msg.cmd !== 'object' || !msg.cmd) return;
      room.runner.command(slot, msg.cmd);
      break;
    }
    case 'resign': {
      if (!room?.runner) return;
      const slot = room.slotOf.get(c.id);
      if (slot !== undefined) room.runner.session.resign(slot);
      break;
    }
    case 'chat': {
      if (!room) return;
      const text = sanitize(msg.text, 200);
      if (!text) return;
      const color = room.state.slots.find((s) => s.clientId === c.id)?.color;
      for (const s of room.state.slots) if (s.clientId) send(clients.get(s.clientId), { type: 'chat', from: c.name, text, color });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP (serves the production client build) + WebSocket
// ---------------------------------------------------------------------------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '') p = '/index.html';
    let file = join(STATIC_DIR, p);
    if (!file.startsWith(STATIC_DIR)) throw new Error('bad path');
    try {
      if (!(await stat(file)).isFile()) throw 0;
    } catch {
      file = join(STATIC_DIR, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Thrones server is running. Build the client (npm run build) or use the Vite dev server on :5173.');
  }
}

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size, rooms: rooms.size }));
    return;
  }
  void serveStatic(req, res);
});
const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: 64 * 1024,
  // snapshots are repetitive JSON: compression cuts bandwidth ~5-8x for long-distance players
  perMessageDeflate: {
    threshold: 512,
    zlibDeflateOptions: { level: 3 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: false,
  },
});

// Heartbeat: hosting proxies drop idle sockets, and dead peers must be cleaned up.
const alive = new WeakMap<WebSocket, boolean>();
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 20000);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  const c: Client = { id: randomUUID(), ws, name: 'Raja', roomId: null, msgCount: 0, msgWindow: Date.now() };
  clients.set(c.id, c);
  send(c, { type: 'welcome', id: c.id });
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - c.msgWindow > 1000) {
      c.msgWindow = now;
      c.msgCount = 0;
    }
    if (++c.msgCount > 80) return; // flood protection
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    try {
      handle(c, msg);
    } catch (err) {
      console.error('handler error', err);
    }
  });
  ws.on('close', () => {
    leaveRoom(c);
    clients.delete(c.id);
  });
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`⚔  Thrones server listening on http://localhost:${PORT}  (ws: /ws)`);
});
