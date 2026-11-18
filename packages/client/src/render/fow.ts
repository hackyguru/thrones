import * as THREE from 'three';

/**
 * Fog of war: a per-tile texture sampled in every world material's fragment shader.
 * 255 = visible, ~110 = explored, 0 = unexplored.
 */
export const fowUniforms = {
  uFow: { value: null as THREE.DataTexture | null },
  uMapSize: { value: 128 },
};

/** time uniform shared by animated (wind) shaders */
export const timeUniform = { value: 0 };

export function patchFow<T extends THREE.Material>(mat: T, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void, cacheKey = 'fow1'): T {
  mat.onBeforeCompile = (shader) => {
    extra?.(shader);
    shader.uniforms.uFow = fowUniforms.uFow;
    shader.uniforms.uMapSize = fowUniforms.uMapSize;
    shader.vertexShader =
      'varying vec2 vFowUv;\nuniform float uMapSize;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fowWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fowWP = instanceMatrix * fowWP;
        #endif
        fowWP = modelMatrix * fowWP;
        vFowUv = fowWP.xz / uMapSize;`,
      );
    shader.fragmentShader =
      'varying vec2 vFowUv;\nuniform sampler2D uFow;\n' +
      shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `float fowV = texture2D(uFow, vFowUv).r;
        gl_FragColor.rgb = mix(vec3(0.018, 0.016, 0.014), gl_FragColor.rgb, fowV);
        #include <fog_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => cacheKey;
  return mat;
}

export class FogOfWar {
  size: number;
  tex: THREE.DataTexture;
  data: Uint8Array<ArrayBuffer>;
  visible: Uint8Array;
  explored: Uint8Array;
  private current: Float32Array;
  revealAll = false;
  private circles = new Map<number, Int16Array>();

  constructor(size: number) {
    this.size = size;
    const n = size * size;
    this.data = new Uint8Array(n);
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    this.current = new Float32Array(n);
    this.tex = new THREE.DataTexture(this.data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    fowUniforms.uFow.value = this.tex;
    fowUniforms.uMapSize.value = size;
  }

  private circle(r: number) {
    let c = this.circles.get(r);
    if (c) return c;
    const pts: number[] = [];
    const rr = (r + 0.5) * (r + 0.5);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= rr) pts.push(dx, dy);
    c = Int16Array.from(pts);
    this.circles.set(r, c);
    return c;
  }

  beginVisibility() {
    this.visible.fill(0);
  }

  stamp(x: number, y: number, los: number) {
    const c = this.circle(Math.round(los));
    const cx = Math.floor(x), cy = Math.floor(y), s = this.size;
    for (let i = 0; i < c.length; i += 2) {
      const tx = cx + c[i], ty = cy + c[i + 1];
      if (tx < 0 || ty < 0 || tx >= s || ty >= s) continue;
      const k = ty * s + tx;
      this.visible[k] = 1;
      this.explored[k] = 1;
    }
  }

  isVisible(x: number, y: number) {
    if (this.revealAll) return true;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return false;
    return this.visible[ty * this.size + tx] === 1;
  }

  isExplored(x: number, y: number) {
    if (this.revealAll) return true;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return false;
    return this.explored[ty * this.size + tx] === 1;
  }

  /** Smoothly animate the texture toward the target values. */
  animate(dt: number, instant = false) {
    const k = instant ? 1 : Math.min(1, dt * 6);
    const n = this.data.length;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const target = this.revealAll || this.visible[i] ? 255 : this.explored[i] ? 115 : 0;
      const c = this.current[i];
      if (c !== target) {
        let v = c + (target - c) * k;
        if (Math.abs(v - target) < 1) v = target;
        this.current[i] = v;
        this.data[i] = v;
        changed = true;
      }
    }
    if (changed) this.tex.needsUpdate = true;
  }
}
