/** Inline SVG icons drawn in a consistent engraved-gold style. */
const wrap = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" class="ico" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  food: wrap(
    `<path d="M12 21V9" stroke="#6b4a1e" stroke-width="1.6"/>
     <g fill="#e9c25a" stroke="#8a6420" stroke-width=".6">
     <ellipse cx="12" cy="5" rx="1.6" ry="2.8"/><ellipse cx="9.2" cy="8" rx="1.4" ry="2.5" transform="rotate(-30 9.2 8)"/>
     <ellipse cx="14.8" cy="8" rx="1.4" ry="2.5" transform="rotate(30 14.8 8)"/><ellipse cx="8.6" cy="12" rx="1.3" ry="2.3" transform="rotate(-40 8.6 12)"/>
     <ellipse cx="15.4" cy="12" rx="1.3" ry="2.3" transform="rotate(40 15.4 12)"/></g>`,
  ),
  wood: wrap(
    `<g stroke="#4a2c14" stroke-width=".8"><rect x="3" y="12" width="18" height="5" rx="2.5" fill="#9a6a3a"/>
     <rect x="5" y="7" width="15" height="5" rx="2.5" fill="#b07a44"/></g>
     <circle cx="5.5" cy="14.5" r="2" fill="#e0b47a" stroke="#4a2c14" stroke-width=".6"/>
     <circle cx="7.5" cy="9.5" r="2" fill="#e0b47a" stroke="#4a2c14" stroke-width=".6"/>`,
  ),
  gold: wrap(
    `<g stroke="#7a5410" stroke-width=".7" fill="#f2c440"><ellipse cx="12" cy="17" rx="8" ry="3"/><ellipse cx="12" cy="14" rx="7" ry="2.6"/>
     <ellipse cx="12" cy="11" rx="6" ry="2.3"/><ellipse cx="12" cy="8" rx="5" ry="2"/></g>
     <path d="M10 8h4" stroke="#fff3b0" stroke-width=".8"/>`,
  ),
  stone: wrap(
    `<g stroke="#4a4844" stroke-width=".8"><path d="M3 18l3-7 5-2 4 3 1 6z" fill="#a7a49c"/><path d="M12 18l2-6 5-1 3 7z" fill="#8f8c85"/>
     <path d="M7 10l3-5 5 1 1 5-5 1z" fill="#bdbab2"/></g>`,
  ),
  pop: wrap(
    `<circle cx="12" cy="6.5" r="3" fill="#e8d3a8" stroke="#6b4a1e" stroke-width=".8"/>
     <path d="M5 21c0-5 3-8 7-8s7 3 7 8z" fill="#c9a24a" stroke="#6b4a1e" stroke-width=".8"/>
     <path d="M8.5 5.2c1-2.6 6-2.6 7 0" fill="#d94a2a" stroke="#6b2a10" stroke-width=".6"/>`,
  ),
  sword: wrap(`<path d="M5 19l10-10 2-5-5 2-10 10z" fill="#d8dbe0" stroke="#555" stroke-width=".7"/><path d="M4 15l5 5M3 21l2-2" stroke="#c9a24a" stroke-width="2"/>`),
  shield: wrap(`<circle cx="12" cy="12" r="8.5" fill="#8a5a2b" stroke="#c9a24a" stroke-width="1.6"/><circle cx="12" cy="12" r="2" fill="#e8c35a"/><circle cx="8" cy="9" r="1" fill="#e8c35a"/><circle cx="16" cy="9" r="1" fill="#e8c35a"/><circle cx="12" cy="17" r="1" fill="#e8c35a"/>`),
  bow: wrap(`<path d="M6 3c9 4 9 14 0 18" fill="none" stroke="#8a5a2b" stroke-width="2"/><path d="M6 3v18" stroke="#eee" stroke-width=".6"/><path d="M4 12h15l-2-2m2 2l-2 2" stroke="#ddd" stroke-width="1"/>`),
  boot: wrap(`<path d="M7 3h5v9l7 3v4H6z" fill="#8a5a2b" stroke="#4a2c14" stroke-width=".8"/>`),
  eye: wrap(`<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" fill="#e8d3a8" stroke="#6b4a1e"/><circle cx="12" cy="12" r="3" fill="#3a2a1a"/>`),
  stop: wrap(`<rect x="5" y="5" width="14" height="14" rx="2" fill="#b0302a" stroke="#f3d98b" stroke-width="1.4"/>`),
  attack: wrap(`<path d="M4 20L16 8m-2-4l6 0 0 6" stroke="#f3d98b" stroke-width="2.2" fill="none"/><path d="M20 20L8 8" stroke="#e05a3a" stroke-width="2.2"/>`),
  aggressive: wrap(`<path d="M12 3l2.2 5.2 5.6.5-4.3 3.7 1.3 5.5L12 15l-4.8 2.9 1.3-5.5L4.2 8.7l5.6-.5z" fill="#e05a3a" stroke="#f3d98b" stroke-width="1"/>`),
  defensive: wrap(`<path d="M12 3l8 3v6c0 5-3.6 8-8 9-4.4-1-8-4-8-9V6z" fill="#3a6aa8" stroke="#f3d98b" stroke-width="1.3"/><path d="M8 12l3 3 5-6" stroke="#f3d98b" stroke-width="1.6" fill="none"/>`),
  hold: wrap(`<path d="M12 3v15" stroke="#c9a24a" stroke-width="1.8"/><path d="M12 4h7l-2 3 2 3h-7z" fill="#e05a3a" stroke="#f3d98b" stroke-width=".8"/><path d="M6 21h12l-2-3H8z" fill="#8a5a2b" stroke="#f3d98b" stroke-width=".8"/>`),
  trash: wrap(`<path d="M6 7h12l-1 13H7z" fill="#7a2a20" stroke="#f3d98b" stroke-width="1"/><path d="M4 7h16M9 4h6" stroke="#f3d98b" stroke-width="1.6"/>`),
  menu: wrap(`<path d="M4 7h16M4 12h16M4 17h16" stroke="#f3d98b" stroke-width="2"/>`),
  sound: wrap(`<path d="M4 9h4l5-4v14l-5-4H4z" fill="#f3d98b"/><path d="M16 8c2 2 2 6 0 8M18.5 5.5c3.5 3.5 3.5 9.5 0 13" stroke="#f3d98b" stroke-width="1.6" fill="none"/>`),
  mute: wrap(`<path d="M4 9h4l5-4v14l-5-4H4z" fill="#f3d98b"/><path d="M16 9l5 6M21 9l-5 6" stroke="#e05a3a" stroke-width="2"/>`),
  crown: wrap(`<path d="M3 18l1.5-10 4.5 4 3-7 3 7 4.5-4L21 18z" fill="#e8c35a" stroke="#7a5410" stroke-width="1"/><rect x="3" y="18" width="18" height="2.5" fill="#c9a24a" stroke="#7a5410" stroke-width=".8"/>`),
};

export function costHtml(cost: Partial<Record<'food' | 'wood' | 'gold' | 'stone', number>>, have?: Record<string, number>) {
  return Object.entries(cost)
    .filter(([, v]) => v)
    .map(([k, v]) => `<span class="cost ${have && have[k] < (v as number) ? 'short' : ''}">${ICONS[k as 'food']}${v}</span>`)
    .join('');
}
