import * as THREE from 'three';

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private sunOffset = new THREE.Vector3(-22, 38, 16);
  private onResize = () => this.resize();

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
    this.scene.background = new THREE.Color(0x0e0b08);
    this.scene.fog = new THREE.Fog(0xcdb58c, 55, 130);

    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x8a7550, 1.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffdcae, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -36;
    sc.right = 36;
    sc.top = 36;
    sc.bottom = -36;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // subtle cool fill from the opposite side
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.35);
    fill.position.set(30, 20, -30);
    this.scene.add(fill);

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** keep the shadow frustum centred on what the camera looks at */
  focusShadows(x: number, z: number, radius: number) {
    const r = Math.max(20, Math.min(60, radius));
    const sc = this.sun.shadow.camera;
    if (sc.right !== r) {
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.updateProjectionMatrix();
    }
    // snap to shadow texels to avoid shimmering
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    x = Math.round(x / texel) * texel;
    z = Math.round(z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
