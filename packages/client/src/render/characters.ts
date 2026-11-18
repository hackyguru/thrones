import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchFow } from './fow';
import { shade } from './materials';

/**
 * Realistic animated humans built in Blender by scripts/blender/build_soldiers.py:
 * an MPFB/MakeHuman (CC0) South-Asian man with real face, eyes and skin, wearing baked, photo-textured
 * period garments (angarkha/jama, churidar, dhoti, kamarband, pagri, khula-khud, zirah, chahar-aina)
 * and carrying modelled weapons; animated with the Quaternius Universal Animation Library (CC0),
 * retargeted onto the rig.
 *
 * Cloth textures carry a dye mask in alpha: the game tints those areas (civ / team colours) while
 * zari borders, metal and leather keep their baked colours.
 */

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;
/** world units per metre (character ≈ 1 unit tall at the game's RTS scale) */
export const HUMAN_SCALE = 0.56;

const SKINS = ['a', 'b', 'c', 'd'];
const WEAPONS = ['talwar', 'dhal', 'bhala', 'lance', 'kaman', 'tarkash', 'scabbard'] as const;
/** garments whose alpha channel is a dye mask */
const DYED = new Set(['jama_top', 'jama_skirt', 'kurta_skirt', 'pajama', 'dhoti', 'kamarband', 'pagri', 'pheta', 'angavastra']);
/** only the big silhouette pieces cast shadows (each caster is an extra draw call in the shadow pass) */
const SHADOW_CASTERS = new Set(['jama_top', 'jama_skirt', 'kurta_skirt', 'dhoti', 'pajama', 'pagri', 'pheta', 'khud', 'zirah', 'body_torso', 'body_thighs', 'body_shins', 'body_head']);

interface Template {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  /** bind-pose bone transforms in model space */
  boneWorld: Map<string, THREE.Matrix4>;
  weapons: Map<string, THREE.Object3D>;
  skins: THREE.Texture[];
}

let tpl: Template | null = null;
export const charactersReady = () => !!tpl;

export async function loadCharacters(): Promise<void> {
  const gl = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const skinTex = (n: string) =>
    tl.loadAsync(`${BASE}skins/skin_${n}.jpg`).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
  const [ch, an, ...skins] = await Promise.all([gl.loadAsync(BASE + 'soldier.glb'), gl.loadAsync(BASE + 'anims.glb'), ...SKINS.map(skinTex)]);
  const weapons = new Map<string, THREE.Object3D>();
  for (const name of WEAPONS) {
    const w = ch.scene.getObjectByName(name);
    if (!w) continue;
    w.removeFromParent();
    w.position.set(0, 0, 0);
    w.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = name !== 'tarkash';
      const mm = m.material as THREE.MeshStandardMaterial;
      mm.envMapIntensity = 1;
      patchFow(mm, undefined, 'weapon');
    });
    weapons.set(name, w);
  }
  ch.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.castShadow = SHADOW_CASTERS.has(m.name);
    m.receiveShadow = true;
    const sm = m.material as THREE.MeshStandardMaterial;
    // cloth is matte (no plastic sheen); metal keeps its reflections
    if (sm.metalness < 0.5) {
      sm.roughness = Math.max(sm.roughness, m.name.startsWith('body_') ? 0.6 : 0.93);
      sm.envMapIntensity = m.name.startsWith('body_') ? 0.6 : 0.42;
    } else sm.envMapIntensity = 1;
    if (/eyebrows|eyelashes|hair/.test(m.name)) {
      sm.transparent = false;
      sm.alphaTest = 0.4;
      sm.side = THREE.DoubleSide;
      m.castShadow = false;
    } else if (!m.name.startsWith('body_') && m.name !== 'eyes') {
      sm.side = THREE.DoubleSide;
    }
    if (!DYED.has(m.name)) patchFow(sm, undefined, 'char');
  });
  ch.scene.updateMatrixWorld(true);
  const boneWorld = new Map<string, THREE.Matrix4>();
  ch.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) boneWorld.set(o.name, o.matrixWorld.clone());
  });
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of an.animations) clips.set(c.name, c);
  tpl = { scene: ch.scene, clips, boneWorld, weapons, skins };
}

// ---------------------------------------------------------------------------------------------
// materials: dyed cloth + skin variants, cached per colour
// ---------------------------------------------------------------------------------------------
const dyeCache = new Map<string, THREE.MeshStandardMaterial>();
function dyed(base: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
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
            // dye mask is stored in alpha as 0.5..1 (see scripts/blender/bake.py)
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
    patchFow(m, undefined, 'char');
    flatCache.set(key, m);
  }
  return m;
}

const skinCache = new Map<string, THREE.MeshStandardMaterial>();
function skinMat(base: THREE.MeshStandardMaterial, variant: number) {
  const key = base.uuid + ':' + variant;
  let m = skinCache.get(key);
  if (!m) {
    m = base.clone();
    m.map = tpl!.skins[variant];
    m.roughness = 0.6;
    m.envMapIntensity = 0.6;
    patchFow(m, undefined, 'char');
    skinCache.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
export interface HumanLook {
  /** tunic / jama colour (undefined = bare-chested) */
  top?: number;
  /** long flared jama to the shin */
  long?: boolean;
  /** dhoti colour (villagers) */
  dhoti?: number;
  /** churidar leggings colour */
  legs?: number;
  sash?: number;
  armor?: boolean;
  head: 'turban' | 'helmet' | 'bare';
  headColor: number;
  plume?: boolean;
  weapon: 'sword' | 'spear' | 'lance' | 'bow' | 'none';
  shield?: number;
  bigBow?: boolean;
  /** legacy: skin is now chosen from baked face/skin variants by seed */
  skinTint?: number;
}

export interface HumanRig {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  bones: Record<'head' | 'handR' | 'handL' | 'spine', THREE.Bone>;
  /** attach points for tools in the right hand / carried goods on the back */
  handR: THREE.Group;
  handL: THREE.Group;
  back: THREE.Group;
  headTop: THREE.Group;
  /** riders: a lower-body clip held independently of the upper-body action */
  legs?: THREE.AnimationAction;
}

/** convert a model-space placement into a child of `bone` */
function attach(bone: THREE.Bone, worldBind: THREE.Matrix4, obj: THREE.Object3D, local: THREE.Matrix4) {
  const m = new THREE.Matrix4().copy(worldBind).invert().multiply(local);
  m.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
}

function weapon(name: (typeof WEAPONS)[number], team?: number): THREE.Object3D {
  const w = tpl!.weapons.get(name)!.clone(true);
  if (team !== undefined)
    w.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'w_team') m.material = recolor(m.material as THREE.MeshStandardMaterial, team);
    });
  return w;
}

const mergedBody = new Map<string, THREE.BufferGeometry>();
/** the template trimmed to one outfit's meshes, so spawning a unit only clones what it wears */
const outfitCache = new Map<string, THREE.Group>();

function outfitTemplate(keep: (name: string) => boolean): THREE.Group {
  const t = tpl!;
  const names: string[] = [];
  t.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && keep(o.name)) names.push(o.name);
  });
  const key = names.sort().join('|');
  let g = outfitCache.get(key);
  if (!g) {
    g = SkeletonUtils.clone(t.scene) as THREE.Group;
    const drop: THREE.Object3D[] = [];
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !keep(o.name)) drop.push(o);
    });
    for (const d of drop) d.removeFromParent();
    outfitCache.set(key, g);
  }
  return g;
}

export function buildHuman(look: HumanLook, seed: number): HumanRig {
  const t = tpl!;
  const root = new THREE.Group();

  const villager = look.top === undefined && look.dhoti !== undefined;
  const wear = new Map<string, number | null>(); // mesh -> dye colour (null = baked colours)
  if (look.top !== undefined) {
    wear.set('jama_top', look.top);
    wear.set(look.long ? 'jama_skirt' : 'kurta_skirt', look.top);
  } else if (villager) wear.set('angavastra', look.sash ?? 0xe9dfc8);
  if (look.legs !== undefined) wear.set('pajama', look.legs);
  // a dhoti is worn on its own; under a coat the lower garment shows as leggings
  if (look.dhoti !== undefined) {
    if (look.top === undefined) wear.set('dhoti', look.dhoti);
    else if (look.legs === undefined) wear.set('pajama', look.dhoti);
  }
  if (look.top !== undefined || look.legs !== undefined) wear.set('kamarband', look.sash ?? shade(look.top ?? 0x8a2a1a, -0.4));
  if (look.armor) {
    wear.set('zirah', null);
    wear.set('chahar_aina', null);
  }
  if (look.head === 'turban') wear.set(villager ? 'pheta' : 'pagri', look.headColor);
  else if (look.head === 'helmet') wear.set('khud', null);
  if (!villager) wear.set('mojari', null);

  // bare skin that stays visible
  const covered = new Set<string>();
  if (look.top !== undefined || look.armor) covered.add('body_torso').add('body_upperarms').add('body_forearms');
  if (look.legs !== undefined || look.long || look.dhoti !== undefined) covered.add('body_thighs');
  if (wear.has('pajama')) covered.add('body_shins');
  if (wear.has('mojari')) covered.add('body_feet');
  const hideHair = look.head !== 'bare';

  const variant = seed % t.skins.length;
  // eyelashes are invisible at RTS distances: skip that draw call
  const keep = (n: string) =>
    n.startsWith('body_') ? !covered.has(n) : n === 'hair' ? !hideHair : n === 'eyes' || n === 'eyebrows' || wear.has(n);
  const model = SkeletonUtils.clone(outfitTemplate(keep)) as THREE.Group;
  model.scale.setScalar(HUMAN_SCALE);
  root.add(model);
  let body: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const n = m.name;
    if (n.startsWith('body_')) {
      m.material = skinMat(m.material as THREE.MeshStandardMaterial, variant);
      body ??= m;
    } else if (wear.has(n)) {
      const c = wear.get(n);
      if (c !== null && c !== undefined && DYED.has(n)) m.material = dyed(m.material as THREE.MeshStandardMaterial, c);
    }
  });
  const skinned = (body ?? model.getObjectByProperty('isSkinnedMesh', true)) as THREE.SkinnedMesh;

  // one skeleton for the whole unit (bone matrices computed once per frame instead of per piece)
  const shared = skinned.skeleton;
  const parts: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) parts.push(m);
  });
  for (const m of parts) if (m.skeleton !== shared) m.bind(shared, m.bindMatrix);
  // visible skin regions share one material: merge them into a single draw call
  const skinParts = parts.filter((m) => m.name.startsWith('body_'));
  if (skinParts.length > 1) {
    const key = skinParts.map((m) => m.name).sort().join('|');
    let geo = mergedBody.get(key);
    if (!geo) {
      geo = mergeGeometries(skinParts.map((m) => m.geometry))!;
      mergedBody.set(key, geo);
    }
    const merged = new THREE.SkinnedMesh(geo, skinParts[0].material);
    merged.name = 'body';
    merged.frustumCulled = false;
    merged.castShadow = true;
    merged.receiveShadow = true;
    skinParts[0].parent!.add(merged);
    merged.bind(shared, skinParts[0].bindMatrix);
    for (const m of skinParts) m.removeFromParent();
  }

  // --- bones & attachments ---
  const find = (n: string) => skinned.skeleton.bones.find((x) => x.name === n)!;
  const bones = { head: find('Head'), handR: find('hand_r'), handL: find('hand_l'), spine: find('spine_03') };
  const wb = (n: string) => t.boneWorld.get(n)!;
  const headP = new THREE.Vector3().setFromMatrixPosition(wb('Head'));
  const headTop = new THREE.Group();
  attach(bones.head, wb('Head'), headTop, new THREE.Matrix4().makeTranslation(headP.x, headP.y + 0.27, headP.z + 0.02));
  if (look.plume) {
    const j = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), patchFow(new THREE.MeshStandardMaterial({ color: 0xe8b04a, metalness: 1, roughness: 0.3 }), undefined, 'char'));
    j.position.set(0, -0.06, 0.1);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.16, 6), patchFow(new THREE.MeshStandardMaterial({ color: 0xf6f0e0, roughness: 0.8 }), undefined, 'char'));
    f.position.set(0.01, 0.02, 0.08);
    f.rotation.z = -0.3;
    headTop.add(j, f);
  }

  const hand = (name: 'hand_r' | 'hand_l') => {
    const p = new THREE.Vector3().setFromMatrixPosition(wb(name));
    const g = new THREE.Group();
    // grip sits inside the fist, a little past the wrist (T-pose: arms along ±x)
    attach(name === 'hand_r' ? bones.handR : bones.handL, wb(name), g, new THREE.Matrix4().makeTranslation(p.x + Math.sign(p.x) * 0.08, p.y - 0.015, p.z - 0.01));
    return g;
  };
  const handR = hand('hand_r'), handL = hand('hand_l');
  if (look.weapon === 'sword') handR.add(weapon('talwar'));
  else if (look.weapon === 'spear') handR.add(weapon('bhala'));
  else if (look.weapon === 'lance') handR.add(weapon('lance', look.headColor));
  else if (look.weapon === 'bow') {
    const b = weapon('kaman');
    // limbs along the forearm when carried; string toward the body
    b.rotation.z = Math.PI / 2;
    if (look.bigBow) b.scale.setScalar(1.15);
    handL.add(b);
  }
  if (look.shield !== undefined) {
    const sh = weapon('dhal', look.shield);
    sh.rotation.z = (Math.PI / 2) * Math.sign(new THREE.Vector3().setFromMatrixPosition(wb('hand_l')).x);
    sh.position.y = -0.05;
    handL.add(sh);
  }
  // sheathed talwar hanging at the left hip, hilt forward
  if (look.weapon === 'sword') {
    const pel = skinned.skeleton.bones.find((x) => x.name === 'pelvis')!;
    const hipL = new THREE.Vector3().setFromMatrixPosition(wb('thigh_l'));
    const sc = weapon('scabbard');
    const holder = new THREE.Group();
    const pelP = new THREE.Vector3().setFromMatrixPosition(wb('pelvis'));
    attach(pel, wb('pelvis'), holder, new THREE.Matrix4().makeTranslation(hipL.x * 1.9, pelP.y + 0.08, pelP.z + 0.06));
    sc.rotation.x = 2.62;
    holder.add(sc);
  }
  const spineP = new THREE.Vector3().setFromMatrixPosition(wb('spine_03'));
  const back = new THREE.Group();
  attach(bones.spine, wb('spine_03'), back, new THREE.Matrix4().makeTranslation(spineP.x, spineP.y, spineP.z - 0.17));
  if (look.weapon === 'bow') {
    const q = weapon('tarkash');
    q.rotation.z = 0.35;
    back.add(q);
  }

  // --- animation ---
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of t.clips) actions.set(name, mixer.clipAction(clip));
  return { root, mixer, actions, current: null, bones, handR, handL, back, headTop };
}

/** keep only upper-body tracks (for riders: legs stay in the seated pose) */
const upperCache = new Map<string, THREE.AnimationClip>();
export function upperBody(clip: THREE.AnimationClip) {
  let c = upperCache.get(clip.name);
  if (!c) {
    const lower = /(pelvis|thigh|calf|foot|ball|root)/i;
    c = new THREE.AnimationClip(clip.name + '_upper', clip.duration, clip.tracks.filter((t) => !lower.test(t.name.split('.')[0])));
    upperCache.set(clip.name, c);
  }
  return c;
}

const lowerCache = new Map<string, THREE.AnimationClip>();
/** keep the legs (and hips) in a clip's pose regardless of what the upper body plays */
export function holdLegs(r: HumanRig, name: string) {
  if (r.legs?.getClip().name === name + '_lower') return;
  const clip = tpl?.clips.get(name);
  if (!clip) return;
  let c = lowerCache.get(name);
  if (!c) {
    const lower = /(pelvis|thigh|calf|foot|ball|root)/i;
    c = new THREE.AnimationClip(name + '_lower', clip.duration, clip.tracks.filter((t) => lower.test(t.name.split('.')[0])));
    lowerCache.set(name, c);
  }
  r.legs?.stop();
  r.legs = r.mixer.clipAction(c);
  r.legs.play();
}

/** smooth cross-fade to a clip */
export function play(r: HumanRig, name: string, opts: { once?: boolean; timeScale?: number; fade?: number; upper?: boolean } = {}) {
  let a = r.actions.get(name + (opts.upper ? '_upper' : ''));
  if (!a) {
    const clip = tpl?.clips.get(name);
    if (!clip) return;
    a = r.mixer.clipAction(opts.upper ? upperBody(clip) : clip);
    r.actions.set(name + (opts.upper ? '_upper' : ''), a);
  }
  if (opts.timeScale !== undefined) a.timeScale = opts.timeScale;
  if (r.current === a) return;
  a.reset();
  a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = !!opts.once;
  a.enabled = true;
  a.play();
  if (r.current) r.current.crossFadeTo(a, opts.fade ?? 0.2, false);
  r.current = a;
}

export function clipDuration(name: string) {
  return tpl?.clips.get(name)?.duration ?? 1;
}
