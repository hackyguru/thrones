/** Player preferences + platform-aware control descriptions. */
export const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

function load(k: string, d: string) {
  try {
    return localStorage.getItem('thrones.' + k) ?? d;
  } catch {
    return d;
  }
}
function save(k: string, v: string) {
  try {
    localStorage.setItem('thrones.' + k, v);
  } catch {
    /* ignore */
  }
}

export type OrderClick = 'single' | 'double' | 'right';
export type Graphics = 'auto' | 'high' | 'medium' | 'low';

export const settings = {
  /**
   * How orders are given to selected units:
   *  - 'right':  two-finger tap on a trackpad / right-click on a mouse (default)
   *  - 'double': double-click the ground / enemy / resource
   *  - 'single': single left-click
   */
  get orderClick(): OrderClick {
    const v = load('orderClick', 'right');
    return v === 'single' || v === 'double' ? v : 'right';
  },
  set orderClick(v: OrderClick) {
    save('orderClick', v);
  },
  /** left-click (single or double) gives orders */
  get leftClickCommands() {
    return this.orderClick !== 'right';
  },
  /** graphics quality; 'auto' adapts render resolution / frame rate to keep motion smooth */
  get graphics(): Graphics {
    const v = load('graphics', 'auto');
    return v === 'high' || v === 'medium' || v === 'low' ? v : 'auto';
  },
  set graphics(v: Graphics) {
    save('graphics', v);
  },
  get hintSeen() {
    return load('hintSeen', '0') === '1';
  },
  set hintSeen(v: boolean) {
    save('hintSeen', v ? '1' : '0');
  },
};

const K = isMac
  ? { right: 'Two-finger tap (or ⌃ Control + click)', ctrl: '⌃ Control or ⌥ Option', del: 'Delete', pan: 'Two-finger scroll · arrow keys · screen edge', zoom: 'Pinch · + / −' }
  : { right: 'Right-click', ctrl: 'Ctrl', del: 'Delete', pan: 'Arrow keys · screen edge · middle-drag', zoom: 'Mouse wheel · + / −' };

/** Rows of [action, keys] describing the current control scheme. */
export function controlRows(): [string, string][] {
  const oc = settings.orderClick;
  return [
    ['Select a unit or building', isMac ? 'One-finger tap / click it' : 'Click it'],
    ['Select many units', 'Click and drag a box · Shift+click to add'],
    ['Select all of one type on screen', 'Double-click one of your units'],
    ['Move / attack / gather / build', `${orderVerb(true)} the ground, an enemy, a resource or a foundation`],
    ['Move (from the command card)', 'M, then click where to go'],
    ['Attack-move', 'A, then click an enemy or the ground (fights everything on the way)'],
    ['Stance: aggressive · defensive · hold ground', 'S · D · F with soldiers selected'],
    ['Set a building’s rally point', K.right],
    ['Deselect', oc === 'right' ? 'Esc · click empty ground' : 'Esc'],
    ['Control groups', `${K.ctrl} + 1–9 to set · 1–9 to recall (twice to jump)`],
    ['Pan camera', K.pan],
    ['Zoom · rotate', `${K.zoom} · [ ]`],
    ['Town centre · idle villager · centre on selection', 'H · . (period) · Space'],
    ['Command card', 'Q W E R · A S D F · Z X C V'],
    ['Delete selected', K.del],
    ['Menu', 'Esc (nothing selected) · F10'],
  ];
}

export function controlsTable(): string {
  return `<table class="keys">${controlRows()
    .map(([a, k]) => `<tr><td>${a}</td><td>${k}</td></tr>`)
    .join('')}</table>`;
}

export const rightClickName = K.right;

/** "Double-click" / "Click" / "Right-click" for instructional text */
export function orderVerb(capital = false): string {
  const oc = settings.orderClick;
  const v = oc === 'double' ? 'double-click' : oc === 'single' ? 'click' : isMac ? 'two-finger tap' : 'right-click';
  return capital ? v[0].toUpperCase() + v.slice(1) : v;
}
