import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getSky } from './assets';
import { settings, type Graphics } from '../ui/settings';

/** clamps extreme / invalid HDR values so one bad pixel can't poison the bloom blur */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      gl_FragColor = vec4(min(c.rgb, vec3(24.0)), c.a); }`,
};

/** warm late-afternoon grade + vignette, applied in linear space before tone mapping */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uWarm: { value: 0.06 },
    uSat: { value: 1.08 },
    uContrast: { value: 1.06 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uWarm; uniform float uSat; uniform float uContrast;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      // gentle contrast around mid-grey (in log-ish space)
      col = pow(max(col, 0.0), vec3(uContrast)) * 0.18 / pow(0.18, uContrast);
      // warm highlights, cool shadows
      col *= mix(vec3(0.96, 0.98, 1.04), vec3(1.0 + uWarm, 1.0 + uWarm * 0.35, 1.0 - uWarm), smoothstep(0.02, 0.6, l));
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      col *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sunOffset = new THREE.Vector3(-26, 34, 18);
  private onResize = () => this.resize();
  private target: THREE.WebGLRenderTarget;
  /** graphics preset and the auto governor's state */
  graphics: Graphics = 'auto';
  private scale = 1.75;
  private maxScale = 1.75;
  private minScale = 1.0;
  private lock60 = false;
  private frameParity = 0;
  private lastFrame = 0;
  private intervals: number[] = [];
  private refresh = 1000 / 60;
  private goodWindows = 0;
  private settle = 0;

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.scale));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 2, 300);
    this.scene.background = new THREE.Color(0x0e0b08);
    this.scene.fog = new THREE.Fog(0xd2bb94, 50, 125);

    // image-based lighting from a procedural sky (gives marble, gold and water real reflections)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const hdr = getSky();
    // real photographed sky (CC0 HDRI) when available, procedural gradient otherwise
    this.scene.environment = hdr ? pmrem.fromEquirectangular(hdr).texture : pmrem.fromScene(skyScene(), 0.03).texture;
    this.scene.environmentIntensity = hdr ? 0.5 : 0.55;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xfff0d8, 0x7a6644, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd7a0, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -36;
    sc.right = 36;
    sc.top = 36;
    sc.bottom = -36;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.3);
    fill.position.set(30, 20, -30);
    this.scene.add(fill);

    // post-processing chain (MSAA render target replaces canvas antialiasing)
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.target = target;
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    this.setGraphics(settings.graphics);
  }

  /**
   * Quality presets. 'auto' starts high and lets the frame governor lower the render resolution
   * (and, on 120 Hz screens, lock to an even 60 fps) whenever frames are being missed.
   */
  setGraphics(g: Graphics) {
    this.graphics = g;
    const dpr = window.devicePixelRatio || 1;
    const preset = { auto: [1.75, 2048, true, 4], high: [1.75, 2048, true, 4], medium: [1.25, 2048, true, 2], low: [1.0, 1024, false, 0] } as const;
    const [scale, shadow, bloom, samples] = preset[g];
    this.maxScale = Math.min(dpr, scale);
    this.minScale = Math.min(dpr, 1.0);
    this.scale = this.maxScale;
    this.lock60 = false;
    this.goodWindows = 0;
    this.intervals.length = 0;
    this.settle = 0;
    if (this.sun.shadow.mapSize.x !== shadow) {
      this.sun.shadow.mapSize.set(shadow, shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    this.renderer.shadowMap.type = g === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.bloom.enabled = bloom;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
    this.resize();
  }

  /** watch frame pacing and trade resolution for smoothness (auto mode only) */
  private govern(now: number) {
    if (this.lastFrame) {
      const dt = now - this.lastFrame;
      if (dt < 250) this.intervals.push(dt);
    }
    this.lastFrame = now;
    if (this.graphics !== 'auto' || this.intervals.length < 90) return;
    const iv = this.intervals.splice(0);
    const sorted = [...iv].sort((a, b) => a - b);
    // the display's refresh interval ≈ the fastest frames we see
    this.refresh = Math.min(this.refresh, sorted[Math.floor(sorted.length * 0.1)]);
    const budget = this.lock60 ? 1000 / 60 : this.refresh;
    const missed = iv.filter((d) => d > budget * 1.5).length / iv.length;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    if (missed > 0.08) {
      this.goodWindows = 0;
      if (this.scale > this.minScale + 0.01) {
        this.scale = Math.max(this.minScale, this.scale - 0.15);
        this.resize();
      } else if (!this.lock60 && this.refresh < 12) {
        this.lock60 = true; // 120 Hz screen we cannot fill: an even 60 beats an uneven 80–110
      } else if (this.bloom.enabled) {
        this.bloom.enabled = false;
      }
      this.settle = 1;
    } else if (missed < 0.01) {
      if (++this.goodWindows >= 4 && this.scale < this.maxScale - 0.01) {
        this.scale = Math.min(this.maxScale, this.scale + 0.1);
        this.resize();
        this.goodWindows = 0;
        this.settle = 1;
      }
    } else this.goodWindows = 0;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.scale);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
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
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    x = Math.round(x / texel) * texel;
    z = Math.round(z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }

  /** frame-pacing info for the debug overlay */
  get frameInfo() {
    return { scale: this.scale, lock60: this.lock60, refresh: this.refresh, graphics: this.graphics, bloom: this.bloom.enabled };
  }

  render() {
    const now = performance.now();
    if (this.lock60 && this.refresh < 12 && (this.frameParity++ & 1)) return; // skip alternate frames: steady 60
    this.govern(now);
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** a simple gradient sky with a warm sun glow, used only to bake environment lighting */
export function skyScene() {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sunDir: { value: new THREE.Vector3(-0.55, 0.62, 0.45).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 zenith = vec3(0.32, 0.5, 0.78);
        vec3 horizon = vec3(0.98, 0.84, 0.62);
        vec3 ground = vec3(0.36, 0.3, 0.2);
        vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon * 0.8, ground, pow(-h, 0.4));
        float sun = max(0.0, dot(normalize(vDir), sunDir));
        col += vec3(1.0, 0.82, 0.55) * (pow(sun, 64.0) * 6.0 + pow(sun, 6.0) * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(geo, m));
  return s;
}
