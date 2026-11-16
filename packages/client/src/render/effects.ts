import * as THREE from 'three';
import { mat } from './materials';
import type { TerrainView } from './terrain';

interface Flight {
  mesh: THREE.Group;
  sx: number;
  sy: number;
  sh: number;
  tx: number;
  ty: number;
  th: number;
  t: number;
  dur: number;
  arc: number;
  target: () => { x: number; y: number } | null;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grav: number;
}

interface Marker {
  mesh: THREE.Mesh;
  t: number;
}

export class Effects {
  group = new THREE.Group();
  private flights: Flight[] = [];
  private arrowPool: THREE.Group[] = [];
  private particles: Particle[] = [];
  private markers: Marker[] = [];
  private pGeo = new THREE.IcosahedronGeometry(0.08, 0);
  private ringGeo = new THREE.RingGeometry(0.35, 0.45, 24).rotateX(-Math.PI / 2);

  constructor(private terrain: TerrainView) {}

  arrow(sx: number, sy: number, tx: number, ty: number, durSec: number, fromH: number, target: () => { x: number; y: number } | null) {
    let mesh = this.arrowPool.pop();
    if (!mesh) {
      mesh = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.5), mat(0x5a3b22));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4).rotateX(Math.PI / 2), mat(0xb8bcc4, { metal: 0.8, rough: 0.3 }));
      tip.position.z = 0.28;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.1), mat(0xf3ecd9));
      fl.position.z = -0.22;
      mesh.add(shaft, tip, fl);
      mesh.traverse((o) => (o.castShadow = true));
    }
    mesh.visible = true;
    this.group.add(mesh);
    const d = Math.hypot(tx - sx, ty - sy);
    this.flights.push({
      mesh, sx, sy, sh: this.terrain.groundAt(sx, sy) + fromH, tx, ty, th: 0, t: 0, dur: Math.max(0.1, durSec), arc: Math.min(2.5, d * 0.18), target,
    });
  }

  burst(x: number, y: number, h: number, color: number, count: number, opts: { speed?: number; up?: number; size?: number; life?: number; grav?: number } = {}) {
    const base = this.terrain.groundAt(x, y) + h;
    const m = mat(color);
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 400) break;
      const mesh = new THREE.Mesh(this.pGeo, m);
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 1.5) * (0.4 + Math.random() * 0.8);
      mesh.position.set(x + (Math.random() - 0.5) * 0.3, base, y + (Math.random() - 0.5) * 0.3);
      const size = (opts.size ?? 1) * (0.6 + Math.random() * 0.8);
      mesh.scale.setScalar(size);
      this.group.add(mesh);
      const life = (opts.life ?? 0.8) * (0.6 + Math.random() * 0.6);
      this.particles.push({
        mesh, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (opts.up ?? 2) * (0.5 + Math.random()),
        life, max: life, size, grav: opts.grav ?? 6,
      });
    }
  }

  dust(x: number, y: number, radius: number, count = 24) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.burst(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.2, Math.random() < 0.5 ? 0xb59a74 : 0x8f7a5c, 1, {
        speed: 0.8, up: 1.6, size: 2.2, life: 1.4, grav: 0.6,
      });
    }
  }

  marker(x: number, y: number, color: number, scale = 1) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.userData.s = scale;
    m.position.set(x, this.terrain.groundAt(x, y) + 0.06, y);
    this.group.add(m);
    this.markers.push({ mesh: m, t: 0 });
  }

  update(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const tg = f.target();
      if (tg) {
        f.tx = tg.x;
        f.ty = tg.y;
      }
      f.th = this.terrain.groundAt(f.tx, f.ty) + 0.6;
      const k = Math.min(1, f.t / f.dur);
      const x = f.sx + (f.tx - f.sx) * k;
      const z = f.sy + (f.ty - f.sy) * k;
      const y = f.sh + (f.th - f.sh) * k + Math.sin(k * Math.PI) * f.arc;
      const k2 = Math.min(1, k + 0.02);
      const x2 = f.sx + (f.tx - f.sx) * k2, z2 = f.sy + (f.ty - f.sy) * k2;
      const y2 = f.sh + (f.th - f.sh) * k2 + Math.sin(k2 * Math.PI) * f.arc;
      f.mesh.position.set(x, y, z);
      f.mesh.lookAt(x2, y2, z2);
      if (k >= 1) {
        this.group.remove(f.mesh);
        this.arrowPool.push(f.mesh);
        this.flights.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const ground = this.terrain.groundAt(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < ground) {
        p.mesh.position.y = ground;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.mesh.scale.setScalar(p.size * Math.max(0, p.life / p.max));
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      const k = m.t / 0.6;
      m.mesh.scale.setScalar((1.4 - k * 0.8) * (m.mesh.userData.s ?? 1));
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1) {
        this.group.remove(m.mesh);
        (m.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
      }
    }
  }
}
