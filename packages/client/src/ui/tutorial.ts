import * as THREE from 'three';
import { RESOURCE_NODES, type Command, type ResourceType, type World } from '@thrones/shared';
import type { Game } from '../game/game';
import type { CEnt } from '../game/entities';
import type { Hud } from './hud';
import { isMac, orderVerb, settings } from './settings';
import { sfx } from '../audio/sfx';

/**
 * Guided first game: a short series of goals that teach the basics in a real match against a
 * passive rival. Each step watches the game state and moves on by itself once the player has done
 * it, glowing the command-card button to press and marking the spot to look at in the world.
 */
interface Step {
  title: string;
  text: () => string;
  /** progress line, e.g. "2 / 3 soldiers" */
  progress?: () => string;
  done?: () => boolean;
  /** command-card buttons to glow (matched against the button title) */
  glow?: () => RegExp | null;
  /** world spot to mark */
  mark?: () => { x: number; y: number } | null;
  enter?: () => void;
  /** shows a button instead of waiting for a condition */
  button?: string;
}

/** number of steps, for resuming from a save */
export const TUTORIAL_STEPS = 10;

export class Tutorial {
  step = 0;
  onStep: (i: number) => void = () => {};
  onFinish: () => void = () => {};
  private box: HTMLElement;
  private marker: HTMLElement;
  private steps: Step[];
  private check = 0;
  private startVills = 0;
  private raid: number[] = [];
  private v = new THREE.Vector3();

  constructor(private game: Game, private hud: Hud, parent: HTMLElement, start = 0) {
    hud.hideHint();
    this.box = document.createElement('div');
    this.box.className = 'tutor hud-block';
    this.marker = document.createElement('div');
    this.marker.className = 'tutor-mark hidden';
    this.marker.innerHTML = '<i></i><b>▼</b>';
    parent.appendChild(this.box);
    parent.appendChild(this.marker);
    this.box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-tut-next]')) this.next();
      if (t.closest('[data-tut-skip]')) this.finish();
    });
    const order = orderVerb();
    const select = isMac ? 'Tap' : 'Click';
    this.steps = [
      {
        title: 'Welcome, Raja',
        text: () => `This is your <b>Durbar</b>, the heart of your realm, with a few villagers and a scout. A rival kingdom lies somewhere beyond the fog. It will leave you in peace while you learn.
          <br>Move the view with ${isMac ? 'a <b>two-finger scroll</b>' : 'the <b>arrow keys</b>'} or by touching the screen edge, and zoom with ${isMac ? 'a <b>pinch</b>' : 'the <b>mouse wheel</b>'}.`,
        button: 'Begin',
      },
      {
        title: 'Choose your villagers',
        text: () => `${select} a villager to select it, or <b>drag a box</b> around several of them.${settings.orderClick === 'double' ? ' One click only selects.' : ''}`,
        done: () => this.selected().some((e) => e.type === 'villager'),
        mark: () => this.mine('villager')[0] ?? null,
      },
      {
        title: 'Gather food',
        text: () => `With villagers selected, <b>${order}</b> the jamun bushes. They pick the fruit and carry it back to the Durbar on their own.${isMac && settings.orderClick === 'right' ? ' <span class="tutor-dim">(Two-finger tap, or hold ⌃ Control and click.)</span>' : ''}`,
        progress: () => `${this.gathering('food')} / 2 villagers picking`,
        done: () => this.gathering('food') >= 2,
        mark: () => this.nearestRes('food'),
      },
      {
        title: 'Train a villager',
        text: () => `More hands, more wealth. ${select} your <b>Durbar</b>, then press <b>Train Villager</b> on the card at the bottom right (or its key, <kbd>Q</kbd>). It costs 50 food.`,
        enter: () => (this.startVills = this.mine('villager').length),
        done: () => this.mine('villager').length > this.startVills || this.mine('town_center').some((b) => b.q?.some(([t]) => t === 'villager')),
        glow: () => /^Train Villager/,
        mark: () => this.mine('town_center')[0] ?? null,
      },
      {
        title: 'Chop wood',
        text: () => `Wood builds everything. Select a villager (the new one when it appears) and <b>${order}</b> a tree.`,
        progress: () => `${this.gathering('wood')} / 2 villagers cutting`,
        done: () => this.gathering('wood') >= 2,
        mark: () => this.nearestRes('wood'),
      },
      {
        title: 'Build a house',
        text: () => `Each house shelters 5 more people. Select a villager, press <b>Build House</b> (30 wood) and click an open spot near the Durbar. Your villager walks over and builds it.`,
        progress: () => (this.mine('house').length ? 'Building…' : ''),
        done: () => this.mine('house').some((b) => b.p === undefined),
        glow: () => /^Build House/,
      },
      {
        title: 'Raise a barracks',
        text: () => `Every kingdom needs defenders. The <b>Barracks</b> is on a villager’s <b>Military buildings</b> page (press <kbd>A</kbd>). It costs 150 wood, so keep your woodcutters busy. Two villagers build it twice as fast.`,
        progress: () => (this.mine('barracks').length ? 'Building…' : `${Math.floor(this.game.me.r.wood)} / 150 wood`),
        done: () => this.mine('barracks').some((b) => b.p === undefined),
        glow: () => /^Build Barracks|^Military buildings/,
        mark: () => this.mine('barracks')[0] ?? null,
      },
      {
        title: 'Train soldiers',
        text: () => `Select the barracks and train three soldiers. <b>Swordsmen</b> are sturdy all-rounders; <b>spearmen</b> are cheap and stop horsemen and elephants.`,
        progress: () => `${this.soldiers().length} / 3 soldiers`,
        done: () => this.soldiers().length >= 3,
        glow: () => /^Train (Swordsman|Spearman)/,
        mark: () => this.mine('barracks')[0] ?? null,
      },
      {
        title: 'Raiders!',
        text: () => `A band of raiders is coming for your villagers. Select your soldiers and <b>${order}</b> an enemy to attack, or press <kbd>A</kbd> and click near them to attack everything on the way.`,
        enter: () => (this.needRaid = true),
        progress: () => `${this.raidLeft()} raiders left`,
        done: () => this.raid.length > 0 && this.raidLeft() === 0,
        mark: () => this.raidLead(),
      },
      {
        title: 'Your realm awaits',
        text: () => `Well fought! Now grow:
          <ul>
            <li>Keep training villagers. Build <b>farms</b> when the bushes run out, and <b>storehouses</b> beside distant woods and mines.</li>
            <li>With 400 food, advance at the Durbar to the <b>Rajya Age</b> for archers, cavalry, towers and the blacksmith.</li>
            <li>Find the rival kingdom and destroy all it has built to win. Press <kbd>?</kbd> any time for the controls.</li>
          </ul>`,
        button: 'Rule on',
      },
    ];
    if (this.steps.length !== TUTORIAL_STEPS) console.warn('TUTORIAL_STEPS is out of date');
    this.step = Math.max(0, Math.min(start, this.steps.length - 1));
    this.resumed = this.step > 0;
    this.enter();
  }

  /** runs every frame */
  frame(dt: number) {
    if (this.step >= this.steps.length) return;
    if (!this.noted && this.game.ents.size) {
      this.noted = true;
      // the scout we start with doesn't count as a trained soldier (only known at the very start)
      if (this.game.tick < 100) this.noteStart();
    }
    const s = this.steps[this.step];
    if (this.needRaid && this.mine('town_center').length) {
      this.needRaid = false;
      this.spawnRaid();
    }
    this.check -= dt;
    if (this.check <= 0) {
      this.check = 0.3;
      if (s.done?.()) {
        sfx.click();
        this.next();
        return;
      }
      const p = this.box.querySelector('.tutor-progress');
      if (p && s.progress) p.textContent = s.progress();
      this.hud.setGlow(s.glow?.() ?? null);
    }
    this.placeMarker(s.mark?.() ?? null);
  }

  dispose() {
    this.hud.setGlow(null);
    this.box.remove();
    this.marker.remove();
  }

  private next() {
    this.step++;
    if (this.step >= this.steps.length) {
      this.finish();
      return;
    }
    this.enter();
  }

  private finish() {
    this.step = this.steps.length;
    this.onStep(this.step);
    this.dispose();
    this.onFinish();
  }

  private enter() {
    const s = this.steps[this.step];
    s.enter?.();
    this.onStep(this.step);
    const n = this.steps.length - 1;
    this.box.innerHTML = `<div class="tutor-head"><span class="tutor-count">${this.step === n ? 'Done' : `Step ${this.step + 1} of ${n}`}</span><button class="tutor-skip" data-tut-skip title="End the tutorial and keep playing">End tutorial</button></div>
      <div class="tutor-title">${s.title}</div>
      <div class="tutor-text">${s.text()}</div>
      ${s.progress ? `<div class="tutor-progress">${s.progress()}</div>` : ''}
      ${s.button ? `<div class="tutor-foot"><button class="btn small primary" data-tut-next>${s.button}</button></div>` : ''}`;
    this.box.classList.remove('pop');
    void this.box.offsetWidth;
    this.box.classList.add('pop');
    this.hud.setGlow(s.glow?.() ?? null);
    this.check = 0.5;
  }

  // --- state queries ----------------------------------------------------------
  private mine(type: string): CEnt[] {
    const g = this.game;
    return [...g.ents.values()].filter((e) => e.owner === g.you && e.type === type && e.dying < 0);
  }
  private selected(): CEnt[] {
    const g = this.game;
    return [...g.selection].map((id) => g.ents.get(id)).filter((e): e is CEnt => !!e && e.owner === g.you);
  }
  private gathering(r: ResourceType) {
    return this.mine('villager').filter((v) => v.g === r && !v.fm).length;
  }
  private soldiers() {
    const g = this.game;
    return [...g.ents.values()].filter((e) => e.owner === g.you && e.kind === 0 && e.type !== 'villager' && e.dying < 0 && !this.startScouts.has(e.id));
  }
  private startScouts = new Set<number>();
  private noted = false;
  /** the raid is sent once the match state has arrived (a resumed game starts empty) */
  private needRaid = false;
  private resumed = false;
  private nearestRes(r: ResourceType): { x: number; y: number } | null {
    const tc = this.mine('town_center')[0];
    if (!tc) return null;
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const e of this.game.resources.entries.values()) {
      if (RESOURCE_NODES[e.type].resType !== r || e.amount <= 0) continue;
      const d = Math.hypot(e.x - tc.x, e.y - tc.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // --- the raid ------------------------------------------------------------------
  /** the local sim (single player only) */
  private session() {
    return (this.game.link as unknown as { runner?: { session: { world: World; command: (slot: number, c: Command) => void } } }).runner?.session ?? null;
  }
  private spawnRaid() {
    const s = this.session();
    const g = this.game;
    const tc = this.mine('town_center')[0];
    if (!s || !tc) return;
    const w = s.world;
    const foe = w.players.find((p) => p.slot !== g.you)?.slot;
    if (foe === undefined) return;
    // come in from the direction of the rival, just beyond sight of the Durbar
    const etc = [...w.entities.values()].find((e) => e.owner === foe && e.type === 'town_center');
    let dx = etc ? etc.x - tc.x : 1, dy = etc ? etc.y - tc.y : 0;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // resumed from a save mid-raid: the raiders are already on their way
    this.raid = !this.resumed ? [] : [...w.entities.values()]
      .filter((e) => e.owner === foe && e.kind === 'unit' && e.type !== 'villager' && !e.dead && Math.hypot(e.x - tc.x, e.y - tc.y) < 26)
      .map((e) => e.id);
    this.resumed = false;
    if (this.raid.length) return;
    const types = ['swordsman', 'spearman'] as const;
    for (let i = 0; i < 2; i++) {
      const spot = w.nearestWalkable(tc.x + dx * 17 - dy * (i - 0.5) * 1.5, tc.y + dy * 17 + dx * (i - 0.5) * 1.5, 8, foe);
      if (!spot) continue;
      const u = w.spawnUnit(foe, types[i], spot.x, spot.y);
      this.raid.push(u.id);
    }
    if (this.raid.length) {
      s.command(foe, { c: 'amove', ids: this.raid, x: tc.x + dx * 3, y: tc.y + dy * 3 });
      // show the player where they come from
      g.camera.jumpTo(tc.x + dx * 9, tc.y + dy * 9);
    }
  }
  private raidLeft() {
    const s = this.session();
    if (!s) return 0;
    return this.raid.filter((id) => {
      const e = s.world.entities.get(id);
      return e && !e.dead;
    }).length;
  }
  private raidLead(): { x: number; y: number } | null {
    const s = this.session();
    if (!s) return null;
    for (const id of this.raid) {
      const e = s.world.entities.get(id);
      if (e && !e.dead) return e;
    }
    return null;
  }

  // --- the world marker --------------------------------------------------------
  private placeMarker(p: { x: number; y: number } | null) {
    if (!p) {
      this.marker.classList.add('hidden');
      return;
    }
    const g = this.game;
    this.v.set(p.x, g.terrain.groundAt(p.x, p.y) + 1.6, p.y).project(g.engine.camera);
    const W = window.innerWidth, H = window.innerHeight;
    let x = ((this.v.x + 1) / 2) * W, y = ((1 - this.v.y) / 2) * H;
    // behind the camera the projection mirrors: flip it so the edge arrow still points the right way
    if (this.v.z > 1) {
      x = W - x;
      y = H - y;
    }
    // keep clear of the top bar and the bottom panels
    const x0 = 30, x1 = W - 30, y0 = 90, y1 = H - 230;
    const off = this.v.z > 1 || x < x0 || x > x1 || y < y0 || y > y1;
    this.marker.classList.toggle('edge', off);
    this.marker.classList.remove('hidden');
    // never hide under the step card: sit at its right edge, pointing at the spot
    const r = this.box.getBoundingClientRect();
    if (!off && x > r.left && x < r.right + 20 && y > r.top && y < r.bottom + 30) {
      this.marker.classList.add('edge');
      this.marker.style.setProperty('--rot', `${Math.atan2(y - Math.min(y, r.bottom), x - (r.right + 22)) - Math.PI / 2}rad`);
      this.marker.style.transform = `translate(${r.right + 22}px, ${Math.min(y, r.bottom)}px)`;
      return;
    }
    if (off) {
      // pin to the screen edge, pointing toward the spot
      const cx = W / 2, cy = (y0 + y1) / 2;
      const dx = x - cx, dy = y - cy;
      const k = Math.min(Math.abs((dx > 0 ? x1 - cx : x0 - cx) / (dx || 1e-6)), Math.abs((dy > 0 ? y1 - cy : y0 - cy) / (dy || 1e-6)));
      x = cx + dx * k;
      y = cy + dy * k;
      if (x > r.left - 10 && x < r.right + 10 && y > r.top - 10 && y < r.bottom + 24) y = r.bottom + 26;
      this.marker.style.setProperty('--rot', `${Math.atan2(dy, dx) - Math.PI / 2}rad`);
    }
    this.marker.style.transform = `translate(${x}px, ${y}px)`;
  }

  private noteStart() {
    for (const e of this.game.ents.values()) if (e.owner === this.game.you && e.kind === 0 && e.type !== 'villager') this.startScouts.add(e.id);
  }
}
