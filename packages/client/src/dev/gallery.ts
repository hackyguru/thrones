import * as THREE from 'three';
import { BUILD_MENU, BUILDINGS, CIVS, PLAYER_COLORS, UNITS, type CivId, type UnitType } from '@thrones/shared';
import { Engine } from '../render/engine';
import { FogOfWar } from '../render/fow';
import { buildBuilding, buildUnit, type Rig } from '../render/models';
import { play } from '../render/characters';
import { mat } from '../render/materials';

/** Dev page: /?gallery=mughal  — every building and unit of a civ, for art iteration. */
export function startGallery(stage: HTMLElement, civ: CivId, view: string) {
  const engine = new Engine(stage);
  const fow = new FogOfWar(64);
  fow.revealAll = true;
  fow.animate(0, true);
  const pc = PLAYER_COLORS[0].hex;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), mat(0x8a9a5a, { tex: 'plaster', scale: 0.5 }));
  ground.position.set(32, 0, 32);
  ground.receiveShadow = true;
  engine.scene.add(ground);
  const types = BUILD_MENU;
  let x = 20;
  for (const t of types) {
    const b = buildBuilding(t, civ, pc);
    const s = BUILDINGS[t].size;
    x += s / 2 + 0.6;
    b.position.set(x, 0, 30);
    engine.scene.add(b);
    x += s / 2 + 0.6;
  }
  const units = (Object.keys(UNITS) as UnitType[]).filter((u) => !UNITS[u].uniqueTo || UNITS[u].uniqueTo === civ);
  const rigs: Rig[] = [];
  units.forEach((u, i) => {
    const r = buildUnit(u, civ, pc, i * 3 + 1);
    rigs.push(r);
    // show a variety of actions
    if (r.human) play(r.human, ['Sword_Attack', 'Walk_Loop', 'Sword_Idle', 'Spell_Simple_Shoot', 'Fixing_Kneeling'][i % 5]);
    r.root.position.set(24 + i * 1.6, 0, 34.5);
    r.root.rotation.y = -0.4;
    engine.scene.add(r.root);
  });
  const cam = engine.camera;
  // ?view=hero&u=2&clip=Sword_Idle : eye-level close-up of one unit
  const q = new URLSearchParams(location.search);
  const hero = view === 'hero';
  const hu = Number(q.get('u') ?? 1);
  if (hero && rigs[hu]?.human && q.get('clip')) play(rigs[hu].human!, q.get('clip')!);
  if (hero) rigs[hu].root.rotation.y = Number(q.get('rot') ?? 0.3);
  const tk = q.get('tool') as keyof Rig['tools'] | null;
  if (hero && tk && rigs[hu].tools[tk]) rigs[hu].tools[tk]!.visible = true;
  const target = hero ? new THREE.Vector3(24 + hu * 1.6, Number(q.get('y') ?? 0.62), 34.5) : view === 'units' ? new THREE.Vector3(29, 0.6, 34.5) : new THREE.Vector3(36, 0.8, 30);
  const dist = hero ? Number(q.get('d') ?? 2.4) : view === 'units' ? 9 : view === 'close' ? 9 : 20;
  let t = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    t += 0.016;
    for (const r of rigs) {
      r.human?.mixer.update(0.016);
      for (const x of r.riders ?? []) x.mixer.update(0.016);
      r.mount?.mixer.update(0.016);
    }
    const yaw = 0.6 + Math.sin(t * 0.15) * 0.15;
    if (hero) cam.position.set(target.x + Math.sin(yaw * 0.3) * dist * 0.4, target.y + dist * 0.2, target.z + dist);
    else cam.position.set(target.x + Math.sin(yaw) * dist * 0.6, target.y + dist * 0.62, target.z + Math.cos(yaw) * dist * 0.75);
    cam.lookAt(target);
    engine.focusShadows(target.x, target.z, 22);
    engine.render();
  };
  loop();
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;top:10px;left:10px;color:#fff;font:16px sans-serif;text-shadow:0 1px 3px #000';
  label.textContent = CIVS[civ].name;
  document.body.appendChild(label);
}
