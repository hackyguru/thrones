import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchFow } from './fow';
import { HUMAN_SCALE } from './characters';

/**
 * Sculpted, rigged and animated mounts built by scripts/blender/build_animals.py:
 * a Marwari-type war horse and an Indian war elephant with their tack. Clips: Idle, Walk, Run, Attack, Death.
 */
const BASE = `${import.meta.env.BASE_URL}assets/characters/`;

interface Template {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}
const tpl = new Map<'horse' | 'elephant', Template>();
export const mountsReady = () => tpl.size === 2;

export async function loadMounts(): Promise<void> {
  const gl = new GLTFLoader();
  for (const kind of ['horse', 'elephant'] as const) {
    const g = await gl.loadAsync(`${BASE}${kind}.glb`);
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = !/eyes|bridle|anklets|tail|mane/.test(m.name);
      m.receiveShadow = true;
      const mm = m.material as THREE.MeshStandardMaterial;
      if (/hair/.test(mm.name)) {
        mm.transparent = false;
        mm.alphaTest = 0.35;
        mm.side = THREE.DoubleSide;
      }
      if (mm.metalness < 0.5) {
        mm.roughness = Math.max(mm.roughness, 0.7);
        mm.envMapIntensity = 0.45;
      }
      if (m.name === 'caparison' || m.name === 'jhool') mm.side = THREE.DoubleSide;
      if (!DYED.has(m.name)) patchFow(mm, undefined, 'mount');
    });
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of g.animations) clips.set(c.name, c);
    tpl.set(kind, { scene: g.scene, clips });
  }
}

/** pieces whose texture alpha (0.5..1) is a dye mask */
const DYED = new Set(['horse_body', 'caparison', 'jhool']);
const dyeCache = new Map<string, THREE.MeshStandardMaterial>();
function dyed(base: THREE.MeshStandardMaterial, color: number) {
  const key = base.uuid + ':' + color;
  let m = dyeCache.get(key);
  if (!m) {
    m = base.clone();
    const tint = { value: new THREE.Color(color) };
    patchFow(
      m,
      (sh) => {
        sh.uniforms.uTint = tint;
        sh.fragmentShader = 'uniform vec3 uTint;\n' + sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 dyeTex = texture2D(map, vMapUv);
            diffuseColor.rgb *= dyeTex.rgb * mix(vec3(1.0), uTint, clamp(dyeTex.a * 2.0 - 1.0, 0.0, 1.0));
          #endif`,
        );
      },
      'dyed',
    );
    dyeCache.set(key, m);
  }
  return m;
}
const flatCache = new Map<string, THREE.MeshStandardMaterial>();
function recolor(base: THREE.MeshStandardMaterial, color: number) {
  const key = base.uuid + ':' + color;
  let m = flatCache.get(key);
  if (!m) {
    m = base.clone();
    m.color.setHex(color);
    patchFow(m, undefined, 'mount');
    flatCache.set(key, m);
  }
  return m;
}

export interface MountRig {
  kind: 'horse' | 'elephant';
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  current: THREE.AnimationAction | null;
  actions: Map<string, THREE.AnimationAction>;
  seats: Record<string, THREE.Object3D>;
}

export function buildMount(kind: 'horse' | 'elephant', opts: { coat?: number; team: number; armored?: boolean }): MountRig {
  const t = tpl.get(kind)!;
  const model = SkeletonUtils.clone(t.scene) as THREE.Group;
  model.scale.setScalar(HUMAN_SCALE);
  const root = new THREE.Group();
  root.add(model);
  const drop: THREE.Object3D[] = [];
  const seats: Record<string, THREE.Object3D> = {};
  const coat = opts.coat ?? 0x6a4126;
  model.traverse((o) => {
    if (o.name.startsWith('seat')) seats[o.name] = o;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    const n = m.name;
    if ((n === 'barding' || n === 'chanfron' || n === 'bakhtar') && !opts.armored) drop.push(m);
    else if (n === 'mukhapatta') drop.push(m);
    else if (n === 'caparison' && opts.armored) drop.push(m);
    else if (n === 'horse_body') m.material = dyed(mat, coat);
    else if (n === 'elephant_body') m.material = recolor(mat, 0x8a8580); // Indian elephants are a dark slate grey
    else if (n === 'caparison' || n === 'jhool') m.material = dyed(mat, opts.team);
    else if (n === 'mane' || n === 'horse_tail') m.material = recolor(mat, new THREE.Color(coat).multiplyScalar(0.35).getHex());
    else if (mat.name === 'w_team') m.material = recolor(mat, opts.team);
  });
  for (const d of drop) d.removeFromParent();
  const mixer = new THREE.AnimationMixer(model);
  return { kind, root, mixer, current: null, actions: new Map(), seats };
}

export function playMount(r: MountRig, name: string, opts: { once?: boolean; timeScale?: number; fade?: number } = {}) {
  let a = r.actions.get(name);
  if (!a) {
    const clip = tpl.get(r.kind)?.clips.get(name);
    if (!clip) return;
    a = r.mixer.clipAction(clip);
    r.actions.set(name, a);
  }
  if (opts.timeScale !== undefined) a.timeScale = opts.timeScale;
  if (r.current === a) return;
  a.reset();
  a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = !!opts.once;
  a.play();
  if (r.current) r.current.crossFadeTo(a, opts.fade ?? 0.25, false);
  r.current = a;
}

export function mountClipDuration(kind: 'horse' | 'elephant', name: string) {
  return tpl.get(kind)?.clips.get(name)?.duration ?? 1;
}

/** seat a rider (a HumanRig root) on a seat node; the rider root keeps its own HUMAN_SCALE */
export function seatRider(seat: THREE.Object3D, riderRoot: THREE.Object3D, drop = 0) {
  riderRoot.scale.setScalar(1 / HUMAN_SCALE);
  riderRoot.position.set(0, -drop, 0);
  seat.add(riderRoot);
}
