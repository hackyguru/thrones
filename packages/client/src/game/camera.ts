import * as THREE from 'three';
import type { TerrainView } from '../render/terrain';

/** Classic RTS camera: looks at a ground target from a fixed pitch. */
export class RtsCamera {
  target = new THREE.Vector2(64, 64);
  dist = 26;
  wantDist = 26;
  yaw = Math.PI * 0.25;
  wantYaw = Math.PI * 0.25;
  pitch = 0.98;
  minDist = 9;
  maxDist = 52;
  keys = new Set<string>();
  edge = new THREE.Vector2();
  cinematic = false;
  private ray = new THREE.Raycaster();

  constructor(public cam: THREE.PerspectiveCamera, public mapSize: number, private terrain: TerrainView) {}

  zoom(delta: number) {
    this.wantDist = THREE.MathUtils.clamp(this.wantDist * Math.pow(1.0015, delta), this.minDist, this.maxDist);
  }

  rotate(d: number) {
    this.wantYaw += d;
  }

  jumpTo(x: number, y: number) {
    this.target.set(x, y);
    this.clamp();
  }

  /** pan in screen-space direction */
  pan(dx: number, dy: number) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // forward on screen = toward -camera offset
    this.target.x += dx * c + dy * s;
    this.target.y += -dx * s + dy * c;
    this.clamp();
  }

  private clamp() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.mapSize);
    this.target.y = THREE.MathUtils.clamp(this.target.y, 0, this.mapSize);
  }

  update(dt: number) {
    // the title-screen backdrop holds a still view of the living town
    if (!this.cinematic) {
      const sp = this.dist * 0.9 * dt;
      let dx = 0, dy = 0;
      if (this.keys.has('ArrowLeft')) dx -= 1;
      if (this.keys.has('ArrowRight')) dx += 1;
      if (this.keys.has('ArrowUp')) dy -= 1;
      if (this.keys.has('ArrowDown')) dy += 1;
      dx += this.edge.x;
      dy += this.edge.y;
      if (dx || dy) this.pan(dx * sp, dy * sp);
    }
    this.dist += (this.wantDist - this.dist) * Math.min(1, dt * 10);
    this.yaw += (this.wantYaw - this.yaw) * Math.min(1, dt * 8);
    const h = Math.max(0, this.terrain.groundAt(this.target.x, this.target.y));
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist);
    this.cam.position.set(this.target.x + off.x, h + off.y, this.target.y + off.z);
    this.cam.lookAt(this.target.x, h, this.target.y);
  }

  /** screen (NDC) -> ground point in map coordinates */
  groundFromNdc(nx: number, ny: number): THREE.Vector2 | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y >= -1e-4) return null;
    let h = 0;
    let px = 0, pz = 0;
    for (let i = 0; i < 4; i++) {
      const t = (h - o.y) / d.y;
      px = o.x + d.x * t;
      pz = o.z + d.z * t;
      h = this.terrain.groundAt(px, pz);
    }
    return new THREE.Vector2(px, pz);
  }
}
