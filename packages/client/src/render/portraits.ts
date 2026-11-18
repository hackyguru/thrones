import * as THREE from 'three';
import { BUILDINGS, type BuildingType, type CivId, type UnitType } from '@thrones/shared';
import { buildBuilding, buildUnit } from './models';
import { fowUniforms } from './fow';
import { skyScene } from './engine';

let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
const cache = new Map<string, string>();
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

function setup() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(128, 128);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  env = pmrem.fromScene(skyScene(), 0.03).texture;
  pmrem.dispose();
  return renderer;
}

/** Render a model to a data URL (cached). */
export function portrait(kind: 'unit' | 'building', type: string, civ: CivId, color: number): string {
  const key = `${kind}:${type}:${civ}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = setup();
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a40, 1.4));
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  let obj: THREE.Object3D;
  if (kind === 'unit') {
    const rig = buildUnit(type as UnitType, civ, color, 3);
    obj = rig.root;
    obj.rotation.y = -0.5;
    const h = rig.height;
    if (rig.kind === 'human') {
      // head & shoulders framing
      cam.position.set(0, h * 0.72, h * 1.05);
      cam.lookAt(0, h * 0.62, 0);
      rig.armL.rotation.x = -0.3;
      rig.armR.rotation.x = -0.5;
    } else {
      obj.rotation.y = -0.9;
      fit(obj, cam, 0.62);
    }
  } else {
    obj = buildBuilding(type as BuildingType, civ, color);
    obj.rotation.y = -0.6;
    fit(obj, cam, 0.6);
    void BUILDINGS;
  }
  scene.add(obj);
  const prev = fowUniforms.uFow.value;
  fowUniforms.uFow.value = white;
  r.render(scene, cam);
  fowUniforms.uFow.value = prev;
  const url = r.domElement.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** frame an object from a 3/4 elevated view */
function fit(obj: THREE.Object3D, cam: THREE.PerspectiveCamera, pad: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const d = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * pad;
  const dir = new THREE.Vector3(0, 0.55, 1).normalize();
  cam.position.copy(sphere.center).addScaledVector(dir, d);
  cam.lookAt(sphere.center);
}
