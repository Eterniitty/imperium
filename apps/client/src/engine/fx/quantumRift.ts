/**
 * Efecto del salto cuántico: «la realidad falla». Un pase de posprocesado
 * propio (una escena a una textura y un cuadro a pantalla completa con un
 * sombreador) que solo trabaja mientras dura el efecto; el resto del tiempo el
 * motor dibuja como siempre y no cuesta nada.
 *
 * 1. Carga (los 5 s del motor, `telemetry.quantumCharge`): lente gravitatoria
 *    que curva el fondo hacia el punto de salto, grietas de luz que se abren en
 *    el espacio delante de la nave, aberración cromática y fallos de imagen
 *    (desplazamiento RGB, líneas de escaneo, bloques cortados) cada vez más fuertes;
 *    al final, el espacio se estira hacia la grieta.
 * 2. Salto (`jump`): la imagen se rompe como un cristal; los trozos salen
 *    despedidos con un destello y una sacudida breve, y detrás aparece el túnel.
 * 3. Llegada (`arrive`): la grieta se abre en el destino, la nave sale y se
 *    cierra con un último fallo de imagen.
 *
 * Con «reducir efectos» (accesibilidad) no hay destellos fuertes, ni sacudidas,
 * ni cortes de imagen rápidos. En calidad baja, menos muestras.
 */
import * as THREE from "three";

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tFrozen;
uniform float uTime;
uniform float uCharge;
uniform float uBreak;
uniform float uArrive;
uniform float uReduce;
uniform float uLow;
uniform float uAspect;
uniform vec2 uCenter;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }

// Voronoi con distancia al borde (x), id de la celda (yz) y su centro (w, en el vec4 de salida 2).
vec3 voronoi(vec2 x, out vec2 cellId, out vec2 cellCenter) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  md = 8.0;
  for (int j = -2; j <= 2; j++)
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  cellId = n + mg;
  cellCenter = x + mr;
  return vec3(md, 0.0, 0.0);
}

vec3 sampleCA(sampler2D tex, vec2 uv, vec2 off) {
  return vec3(texture2D(tex, uv + off).r, texture2D(tex, uv).g, texture2D(tex, uv - off).b);
}

void main() {
  vec2 asp = vec2(uAspect, 1.0);
  vec2 uv = vUv;
  vec2 p = (uv - uCenter) * asp;
  float r = length(p);
  vec2 dir = r > 1e-4 ? p / r : vec2(0.0);
  float arriveEnv = sin(3.14159 * clamp(uArrive, 0.0, 1.0));
  float tear = max(uCharge * uCharge, arriveEnv * 0.8);
  float calm = 1.0 - 0.75 * uReduce;
  float tick = floor(uTime * (uReduce > 0.5 ? 4.0 : 14.0));

  // Sacudida breve al romperse y un temblor que crece con la carga.
  float shake = (uBreak > 0.0 ? pow(1.0 - uBreak, 2.0) * 0.014 : 0.0) + tear * 0.0025;
  uv += (vec2(hash(vec2(tick, 1.3)), hash(vec2(tick, 7.1))) - 0.5) * shake * (1.0 - uReduce);

  // Lente gravitatoria: el fondo se curva hacia el punto de salto.
  float lens = tear * 0.05 / (r * 7.0 + 0.5);
  uv -= dir / asp * lens;

  // Fallos de imagen: bloques desplazados y líneas que saltan.
  float glitchEnd = smoothstep(0.8, 0.9, uArrive) * (1.0 - smoothstep(0.93, 1.0, uArrive));
  float g = (tear * tear + glitchEnd * 0.8 + (uBreak > 0.0 ? (1.0 - uBreak) * 0.6 : 0.0)) * calm;
  vec2 block = floor(uv * vec2(22.0, 13.0));
  if (hash(block + tick) < g * 0.22) uv.x += (hash(block.yx + tick * 1.7) - 0.5) * 0.09 * g;
  float line = floor(uv.y * 140.0);
  if (hash(vec2(line, tick)) < g * 0.08) uv.x += (hash(vec2(tick, line)) - 0.5) * 0.04;

  // Estirarse hacia la grieta: desenfoque radial al final de la carga y al romperse.
  float pull = smoothstep(0.75, 1.0, uCharge) * (1.0 - step(0.001, uBreak)) + (uBreak > 0.0 ? (1.0 - uBreak) : 0.0) * 0.6;
  vec2 ca = dir / asp * (0.0015 + 0.01 * tear + 0.008 * g) * (0.3 + r);
  vec3 col = vec3(0.0);
  float samples = uLow > 0.5 ? 3.0 : 6.0;
  for (float i = 0.0; i < 6.0; i++) {
    if (i >= samples) break;
    vec2 s = uv + (uCenter - uv) * pull * 0.06 * i;
    col += sampleCA(tScene, s, ca);
  }
  col /= samples;

  // Grietas de luz en el espacio, delante de la nave: bordes de celdas deformados
  // (quebrados), solo algunos encendidos, con un halo suave.
  vec2 cid;
  vec2 cc;
  vec2 wp = p * 5.0 + vec2(3.7, 1.9);
  wp += 0.05 * vec2(sin(wp.y * 3.1 + 1.1) + abs(sin(wp.y * 9.0)), sin(wp.x * 2.7 + 2.3) + abs(sin(wp.x * 8.0)));
  float edge = voronoi(wp, cid, cc).x;
  float reach = 0.06 + tear * 0.55;
  float mask = 1.0 - smoothstep(reach * 0.4, reach, r + hash(cid) * 0.12);
  float lit = step(0.55, hash(cid)) * (0.6 + 0.4 * sin(uTime * 9.0 + hash(cid) * 40.0) * (1.0 - uReduce));
  float core = 1.0 - smoothstep(0.0, 0.006 + 0.012 * tear, edge);
  float halo = exp(-edge * 28.0) * 0.35;
  float crack = (core + halo) * mask * lit * tear;
  vec3 glow = mix(vec3(0.55, 0.7, 1.0), vec3(0.95, 0.75, 1.0), hash(cid + 9.0)) * crack * (1.0 + 2.2 * tear);
  glow += vec3(0.55, 0.7, 1.0) * tear * 0.02 / (r * r * 50.0 + 0.02) * calm;

  // Rotura: la imagen congelada se parte en trozos que caen hacia fuera, empezando
  // por el centro (por el agujero se ve ya el otro lado).
  if (uBreak > 0.0 && uBreak < 1.0) {
    vec2 id;
    vec2 center;
    vec2 bp = p * 4.5;
    bp += 0.12 * vec2(sin(bp.y * 5.0), sin(bp.x * 4.0));
    float e = voronoi(bp, id, center).x;
    float cr = length(center / 4.5);
    vec2 away = normalize(center + 1e-4);
    float h = hash(id);
    float delay = cr * 0.45 + h * 0.15;
    float t = max(0.0, uBreak - delay);
    vec2 off = (away * (0.5 + h) + (hash2(id) - 0.5) * 0.6) * t * t * 2.6 / asp;
    float a = 1.0 - smoothstep(0.05, 0.32, t);
    vec3 shard = texture2D(tFrozen, vUv - off).rgb * (0.8 + 0.4 * h);
    shard += vec3(0.7, 0.85, 1.0) * (1.0 - smoothstep(0.0, 0.006, e)) * 1.5 * (0.3 + t * 3.0);
    col = mix(col, shard, a);
    float flash = exp(-uBreak * 22.0) * (uReduce > 0.5 ? 0.12 : 1.2);
    col += vec3(0.8, 0.9, 1.0) * flash;
  }

  // Líneas de escaneo y separación de colores en los fallos.
  col *= 1.0 - g * 0.18 * (0.5 + 0.5 * sin(vUv.y * 900.0 + uTime * 40.0));
  gl_FragColor = vec4(col + glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Duraciones de la rotura y de la llegada, en segundos. */
const BREAK_SEC = 1.3;
const ARRIVE_SEC = 2.4;

export class QuantumRift {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  /** Índice del objetivo donde se dibuja; el otro guarda la imagen congelada al saltar. */
  private current = 0;
  private material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      tScene: { value: null },
      tFrozen: { value: null },
      uTime: { value: 0 },
      uCharge: { value: 0 },
      uBreak: { value: 0 },
      uArrive: { value: 0 },
      uReduce: { value: 0 },
      uLow: { value: 0 },
      uAspect: { value: 1 },
      uCenter: { value: new THREE.Vector2(0.5, 0.52) },
    },
    depthTest: false,
    depthWrite: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private time = 0;
  private breakT = -1;
  private arriveT = -1;
  private size = new THREE.Vector2();

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** El espacio se rompe: la imagen actual se parte y deja ver lo que se dibuje después (el túnel). */
  jump(): void {
    if (!this.targets) return;
    this.breakT = 0;
    this.arriveT = -1;
    // Lo último dibujado queda congelado; los fotogramas nuevos van al otro objetivo.
    this.current = 1 - this.current;
  }

  /** Llegada: la grieta se abre en el destino y se cierra tras la nave. */
  arrive(): void {
    this.arriveT = 0;
    this.breakT = -1;
  }

  /** Si el efecto está en marcha. */
  active(charge: number | null): boolean {
    return (charge !== null && charge > 0) || this.breakT >= 0 || this.arriveT >= 0;
  }

  /**
   * Dibuja la escena con el efecto si está en marcha y devuelve true; si no,
   * no hace nada y devuelve false (el motor dibuja como siempre).
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number, charge: number | null, opts: { reduce: boolean; low: boolean }): boolean {
    if (!this.active(charge)) {
      // Libera la memoria de vídeo cuando no hace falta.
      if (this.targets) {
        this.targets[0].dispose();
        this.targets[1].dispose();
        this.targets = null;
      }
      return false;
    }
    this.time += dt;
    if (this.breakT >= 0) {
      this.breakT += dt / BREAK_SEC;
      if (this.breakT >= 1) this.breakT = -1;
    }
    if (this.arriveT >= 0) {
      this.arriveT += dt / ARRIVE_SEC;
      if (this.arriveT >= 1) this.arriveT = -1;
    }
    renderer.getDrawingBufferSize(this.size);
    if (!this.targets || this.targets[0].width !== this.size.x || this.targets[0].height !== this.size.y) {
      this.targets?.[0].dispose();
      this.targets?.[1].dispose();
      const make = () => new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, depthBuffer: true });
      this.targets = [make(), make()];
    }
    const target = this.targets[this.current]!;
    const u = this.material.uniforms;
    u.tScene!.value = target.texture;
    u.tFrozen!.value = this.targets[1 - this.current]!.texture;
    u.uTime!.value = this.time;
    u.uCharge!.value = charge ?? 0;
    u.uBreak!.value = Math.max(0, this.breakT);
    u.uArrive!.value = Math.max(0, this.arriveT);
    u.uReduce!.value = opts.reduce ? 1 : 0;
    u.uLow!.value = opts.low ? 1 : 0;
    u.uAspect!.value = this.size.x / Math.max(1, this.size.y);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    return true;
  }

  dispose(): void {
    this.targets?.[0].dispose();
    this.targets?.[1].dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
