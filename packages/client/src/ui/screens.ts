import { CIVS, CIV_IDS, PLAYER_COLORS, UNITS, unitStats, type CivId, type RoomState, type RoomSummary } from '@thrones/shared';
import { portrait } from '../render/portraits';
import { ICONS } from './icons';
import { escapeHtml } from './hud';
import { sfx } from '../audio/sfx';

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Wire hover/click sounds on buttons inside a root. */
export function sounds(root: HTMLElement) {
  root.addEventListener('mouseover', (e) => {
    if ((e.target as HTMLElement).closest('.btn, .civ-card, .room-row')) sfx.hover();
  });
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.btn, .civ-card')) sfx.click();
  });
}

export function civDetail(civ: CivId, color: number): string {
  const c = CIVS[civ];
  const u = UNITS[c.unique];
  const us = unitStats(civ, c.unique);
  return `<div class="civ-detail">
    <div class="cd-head"><span class="emblem big">${c.emblem}</span><div><h3>${c.name}</h3><div class="cd-era">${c.era} · ${c.capital}</div><div class="cd-tag">${c.tagline}</div></div></div>
    <p class="cd-desc">${c.description}</p>
    <div class="cd-cols">
      <div><h4>Civilization Bonuses</h4><ul class="bonuses">${c.bonuses.map((b) => `<li>${b}</li>`).join('')}</ul></div>
      <div class="cd-arch"><h4>Architecture</h4><img src="${portrait('building', 'town_center', civ, PLAYER_COLORS[color].hex)}"/></div>
    </div>
    <div class="cd-unique"><img src="${portrait('unit', c.unique, civ, PLAYER_COLORS[color].hex)}"/>
      <div><h4>Unique Unit — ${u.name}</h4><p>${u.description}</p>
      <div class="tip-stats">${ICONS.sword}${us.attack} ${ICONS.shield}${us.armorMelee}/${us.armorPierce} ♥ ${us.maxHp} ${u.ranged ? ICONS.bow + us.range : ''} ${ICONS.boot}${us.speed.toFixed(1)}</div></div></div>
  </div>`;
}

export function civPicker(selected: CivId | 'random', color: number, onPick: (c: CivId | 'random') => void, allowRandom = true): HTMLElement {
  const root = el(`<div class="civ-picker"><div class="civ-grid"></div><div class="civ-detail-wrap"></div></div>`);
  const grid = root.querySelector('.civ-grid') as HTMLElement;
  const detail = root.querySelector('.civ-detail-wrap') as HTMLElement;
  let cur = selected;
  const render = () => {
    grid.innerHTML =
      CIV_IDS.map((id) => {
        const c = CIVS[id];
        return `<button class="civ-card ${cur === id ? 'active' : ''}" data-civ="${id}" style="--c1:${c.colors.primary};--c2:${c.colors.secondary}">
          <span class="emblem">${c.emblem}</span><span class="cc-name">${c.short}</span><span class="cc-era">${c.era}</span></button>`;
      }).join('') +
      (allowRandom ? `<button class="civ-card ${cur === 'random' ? 'active' : ''}" data-civ="random"><span class="emblem">🎲</span><span class="cc-name">Random</span><span class="cc-era">Fate decides</span></button>` : '');
    detail.innerHTML =
      cur === 'random'
        ? `<div class="civ-detail random"><span class="emblem big">🎲</span><h3>Random Civilization</h3><p class="cd-desc">Let fate choose your dynasty when the game begins.</p></div>`
        : civDetail(cur, color);
  };
  grid.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-civ]');
    if (!b) return;
    cur = b.getAttribute('data-civ') as CivId | 'random';
    render();
    onPick(cur);
  });
  render();
  return root;
}

export function colorSwatches(selected: number, taken: number[], onPick: (c: number) => void): HTMLElement {
  const root = el(`<div class="swatches"></div>`);
  const render = () => {
    root.innerHTML = PLAYER_COLORS.map(
      (c, i) => `<button class="swatch ${i === selected ? 'active' : ''} ${taken.includes(i) && i !== selected ? 'taken' : ''}" data-col="${i}" title="${c.name}" style="background:${hex(c.hex)}"></button>`,
    ).join('');
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-col]');
    if (!b) return;
    const i = Number(b.getAttribute('data-col'));
    if (taken.includes(i) && i !== selected) return;
    selected = i;
    render();
    onPick(i);
  });
  render();
  return root;
}

export function civSelect(value: CivId | 'random', enabled: boolean): string {
  return `<select class="civ-select" ${enabled ? '' : 'disabled'}>
    <option value="random" ${value === 'random' ? 'selected' : ''}>🎲 Random</option>
    ${CIV_IDS.map((id) => `<option value="${id}" ${value === id ? 'selected' : ''}>${CIVS[id].emblem} ${CIVS[id].name}</option>`).join('')}
  </select>`;
}

export function roomList(rooms: RoomSummary[]): string {
  if (!rooms.length) return `<div class="empty-note">No open durbars. Create one and invite your rivals!</div>`;
  return rooms
    .map(
      (r) => `<div class="room-row ${r.status !== 'lobby' ? 'busy' : ''}">
        <div><b>${escapeHtml(r.name)}</b><small>Host: ${escapeHtml(r.host)}</small></div>
        <div class="rr-count">${r.players}/${r.maxPlayers}</div>
        <div>${r.status === 'lobby' ? `<button class="btn small" data-join="${r.id}">Join</button>` : '<span class="tag">In battle</span>'}</div>
      </div>`,
    )
    .join('');
}

export function roomSlots(room: RoomState, myId: string): string {
  const host = room.hostId === myId;
  return room.slots
    .map((s) => {
      const mine = s.clientId === myId;
      const editable = mine || (host && s.isAI);
      return `<div class="slot-row ${mine ? 'mine' : ''}" data-slot="${s.slot}">
        <i class="dot big" style="background:${hex(PLAYER_COLORS[s.color].hex)}"></i>
        <div class="slot-name">${escapeHtml(s.name)} ${s.clientId === room.hostId ? `<span class="tag">Host</span>` : ''} ${s.isAI ? '<span class="tag ai">AI</span>' : ''}</div>
        ${civSelect(s.civ, editable)}
        ${editable ? `<select class="color-select">${PLAYER_COLORS.map((c, i) => `<option value="${i}" ${i === s.color ? 'selected' : ''}>${c.name}</option>`).join('')}</select>` : `<span></span>`}
        ${host && s.isAI ? `<button class="btn small ghost" data-remove="${s.slot}">✕</button>` : '<span></span>'}
      </div>`;
    })
    .join('');
}
