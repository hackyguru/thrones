import {
  GameRunner, GameSession, type ClientMsg, type Command, type Difficulty, type GameInit, type GameOverInfo, type PlayerInfo, type ServerMsg, type Snapshot,
} from '@thrones/shared';

/** What a running game needs from its transport. */
export interface GameLink {
  init: GameInit;
  online: boolean;
  send(cmd: Command): void;
  resign(): void;
  chat(text: string): void;
  onSnapshot: (s: Snapshot) => void;
  onGameOver: (info: GameOverInfo) => void;
  onChat: (from: string, text: string, color?: number) => void;
  close(): void;
}

/** Offline game: the authoritative simulation runs in the browser. */
export class LocalLink implements GameLink {
  init: GameInit;
  online = false;
  runner: GameRunner;
  onSnapshot: (s: Snapshot) => void = () => {};
  onGameOver: (info: GameOverInfo) => void = () => {};
  onChat: (from: string, text: string) => void = () => {};

  constructor(
    players: PlayerInfo[],
    public slot: number,
    opts: { seed?: number; difficulty?: Difficulty; fastForwardSec?: number; session?: GameSession } = {},
  ) {
    const seed = opts.seed ?? (Math.random() * 2 ** 31) | 0;
    this.runner = new GameRunner(
      opts.session?.setup ?? { seed, players, aiDifficulty: opts.difficulty },
      {
        listeners: () => [this.slot],
        onSnapshot: (_slot, s) => this.onSnapshot(s),
        onGameOver: (info) => this.onGameOver(info),
      },
      opts.session,
    );
    if (opts.fastForwardSec) {
      const n = opts.fastForwardSec * 20;
      for (let i = 0; i < n; i++) this.runner.session.step();
      this.runner.session.snapshots([this.slot]);
    }
    this.init = this.runner.session.initFor(slot);
  }

  start() {
    this.runner.start();
  }
  send(cmd: Command) {
    this.runner.command(this.slot, cmd);
  }
  resign() {
    this.runner.session.resign(this.slot);
  }
  chat() {}
  setPaused(p: boolean) {
    this.runner.paused = p;
  }
  get speed() {
    return this.runner.speed;
  }
  set speed(v: number) {
    this.runner.speed = v;
  }
  /** the whole match, for a save game */
  save(): string {
    return this.runner.session.serialize();
  }
  static fromSave(json: string): LocalLink {
    const session = GameSession.deserialize(json);
    const you = session.setup.players.find((p) => !p.isAI)?.slot ?? 0;
    const link = new LocalLink(session.setup.players, you, { session });
    // first snapshot carries everything currently visible
    link.runner.session.snapshots([you]);
    return link;
  }
  close() {
    this.runner.stop();
  }
}

type Handler = (msg: ServerMsg) => void;

/** WebSocket connection to the lobby/game server. */
export class Net {
  ws: WebSocket | null = null;
  id = '';
  private handlers = new Set<Handler>();
  connected = false;

  connect(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = import.meta.env.VITE_SERVER_URL ?? `${proto}://${location.host}/ws`;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        this.send({ type: 'hello', name });
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not reach the Thrones server'));
      };
      ws.onclose = () => {
        this.connected = false;
        for (const h of this.handlers) h({ type: 'error', message: 'Disconnected from server' });
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') this.id = msg.id;
        for (const h of this.handlers) h(msg);
      };
    });
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

/** Online game running over a Net connection. */
export class NetLink implements GameLink {
  online = true;
  onSnapshot: (s: Snapshot) => void = () => {};
  onGameOver: (info: GameOverInfo) => void = () => {};
  onChat: (from: string, text: string, color?: number) => void = () => {};
  private off: () => void;

  constructor(private net: Net, public init: GameInit) {
    this.off = net.on((msg) => {
      if (msg.type === 'snap') this.onSnapshot(msg.s);
      else if (msg.type === 'gameOver') this.onGameOver(msg.info);
      else if (msg.type === 'chat') this.onChat(msg.from, msg.text, msg.color);
    });
  }
  send(cmd: Command) {
    this.net.send({ type: 'cmd', cmd });
  }
  resign() {
    this.net.send({ type: 'resign' });
  }
  chat(text: string) {
    this.net.send({ type: 'chat', text });
  }
  close() {
    this.off();
  }
}
