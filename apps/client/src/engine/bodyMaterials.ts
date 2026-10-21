import * as THREE from "three";
import { withLogDepth } from "./logDepth";
import type { PlanetLook } from "./planetLook";

/**
 * Materiales de los cuerpos de un sistema: superficie de planetas y lunas,
 * atmósfera, anillos, superficie de la estrella y su corona.
 *
 * Todo se calcula por fragmento sobre la DIRECCIÓN en la esfera (nunca sobre
 * las coordenadas en metros, que son enormes), con más octavas de ruido cuanto
 * más pequeño es el píxel sobre la superficie (`fwidth` de la dirección): de
 * lejos, pocas octavas y sin parpadeo; de cerca, detalle hasta el tope que
 * marca la calidad (`uMaxOctaves`). La luz viene de la estrella, en el origen
 * del sistema (y del mundo). Las cuentas de rayos se hacen en coordenadas de
 * vista y en radios del cuerpo, para no perder precisión a esta escala.
 */

/** Uniformes comunes a todos los cuerpos de la vista de sistema (se actualizan una vez por fotograma). */
export interface BodyUniforms {
  uTime: THREE.IUniform<number>;
  uMaxOctaves: THREE.IUniform<number>;
  /** Color de la luz de la estrella (lineal). */
  uSunColor: THREE.IUniform<THREE.Color>;
}

export function createBodyUniforms(): BodyUniforms {
  return { uTime: { value: 0 }, uMaxOctaves: { value: 9 }, uSunColor: { value: new THREE.Color(1, 1, 1) } };
}

/** Ruido simplex 3D (Ashima Arts / Stefan Gustavson, licencia MIT) y suma de octavas con nivel de detalle. */
const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  // Hash sin senos (Dave Hoskins): estable entre tarjetas gráficas.
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  // Celdas de Voronoi: distancia al punto más cercano y al segundo. Con 'moving'
  // los puntos oscilan con 't' (granulado de la estrella).
  vec2 worley(vec3 p, float t, float moving) {
    vec3 c = floor(p);
    vec3 f = p - c;
    float d1 = 8.0;
    float d2 = 8.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 h = hash33(c + g);
      vec3 o = mix(h, 0.5 + 0.4 * sin(t + 6.2831 * h), moving);
      vec3 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return sqrt(vec2(d1, d2));
  }

  // Suma de octavas (aprox. -1..1). 'octaves' es fraccionario: la última entra
  // poco a poco, así el detalle aparece sin saltos al acercarse. 'gain' es lo que
  // pesa cada octava respecto a la anterior (más alto: más detalle fino).
  float fbmGain(vec3 p, float octaves, float gain) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      if (fi >= octaves) break;
      sum += snoise(p) * amp * clamp(octaves - fi, 0.0, 1.0);
      p = p * 2.03 + vec3(1.7, 9.2, 3.4);
      amp *= gain;
    }
    return sum;
  }
  float fbm(vec3 p, float octaves) { return fbmGain(p, octaves, 0.5); }

  // Octavas útiles para una frecuencia base, según lo que mide un píxel sobre la esfera unidad.
  float octavesFor(vec3 dir, float baseFreq, float maxOctaves) {
    float footprint = max(length(fwidth(dir)), 1e-7);
    return clamp(log2(0.5 / (footprint * baseFreq)) + 1.0, 1.0, maxOctaves);
  }
`;

/**
 * Tramo de un rayo dentro de una capa esférica (atmósfera). Todo en radios del
 * cuerpo: 'rd' rayo unitario desde la cámara, 'cc' centro del cuerpo respecto a
 * la cámara, 'ra' radio exterior, 'tMax' distancia máxima a lo largo del rayo.
 * Devuelve el punto medio del tramo (respecto al centro) y su profundidad
 * normalizada (1 = rozando la superficie de lado a lado).
 */
const ATMOSPHERE_GLSL = /* glsl */ `
  vec4 atmosphereSegment(vec3 rd, vec3 cc, float ra, float tMax) {
    float t = dot(cc, rd);
    vec3 cr = cross(rd, cc);
    float h2 = dot(cr, cr);
    float r2 = ra * ra;
    if (h2 >= r2) return vec4(0.0, 0.0, 1.0, 0.0);
    float k = sqrt(r2 - h2);
    float entry = max(t - k, 0.0);
    float exitT = min(t + k, tMax);
    if (h2 < 1.0) {
      float s = t - sqrt(1.0 - h2);
      if (s > 0.0) exitT = min(exitT, s);
    }
    float depth = max(exitT - entry, 0.0);
    vec3 mid = rd * (0.5 * (entry + exitT)) - cc;
    return vec4(mid, depth / (2.0 * sqrt(r2 - 1.0)));
  }

  // Luz dispersada por la atmósfera a lo largo del rayo: color y cantidad (0..1).
  vec4 atmosphereLight(vec3 rd, vec3 cc, float ra, float tMax, vec3 L, vec3 atmoColor, float density, vec3 sunColor) {
    vec4 seg = atmosphereSegment(rd, cc, ra, tMax);
    if (seg.w <= 0.0) return vec4(0.0);
    float amount = 1.0 - exp(-seg.w * density * 1.8);
    float sunSide = dot(normalize(seg.xyz), L);
    float lit = smoothstep(-0.3, 0.45, sunSide);
    // A contraluz (la estrella detrás del planeta), un anillo cálido en el borde.
    float forward = pow(max(dot(rd, L), 0.0), 10.0) * smoothstep(-0.7, 0.0, sunSide);
    vec3 col = atmoColor * sunColor * (lit * 1.25) + mix(atmoColor, vec3(1.0, 0.75, 0.5), 0.5) * sunColor * forward * 1.5;
    return vec4(col * amount, amount);
  }
`;

const BODY_VERTEX = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vViewPos;
  varying vec3 vNormalView;
  varying vec3 vCenterView;
  void main() {
    vObjPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormalView = normalize(normalMatrix * normal);
    vCenterView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  uniform vec3 uSeed;
  uniform float uFreq;
  uniform vec3 uColors[5];
  uniform float uStops[5];
  uniform float uSeaLevel;
  uniform vec3 uDeepWater;
  uniform vec3 uShallowWater;
  uniform float uCapLatitude;
  uniform float uClouds;
  uniform vec3 uCloudColor;
  uniform float uRelief;
  uniform float uRadius;
  uniform float uBands;
  uniform float uBandFreq;
  uniform vec4 uStorm;
  uniform vec3 uStormColor;
  uniform float uLavaGlow;
  uniform vec3 uLavaColor;
  uniform float uCracks;
  uniform vec3 uCrackColor;
  uniform float uCraters;
  uniform vec3 uAtmoColor;
  uniform float uAtmoThickness;
  uniform float uAtmoDensity;
  uniform vec3 uSunColor;
  uniform float uMaxOctaves;
  uniform float uTime;
  varying vec3 vObjPos;
  varying vec3 vViewPos;
  varying vec3 vNormalView;
  varying vec3 vCenterView;
  ${NOISE_GLSL}
  ${ATMOSPHERE_GLSL}

  vec3 ramp(float v) {
    vec3 c = uColors[0];
    for (int i = 1; i < 5; i++) c = mix(c, uColors[i], smoothstep(uStops[i - 1], uStops[i], v));
    return c;
  }

  // Normal con relieve a partir de las derivadas de pantalla de la altura (en metros).
  vec3 bumpNormal(vec3 N, vec3 pos, float h) {
    vec3 dpdx = dFdx(pos);
    vec3 dpdy = dFdy(pos);
    float dhdx = dFdx(h);
    float dhdy = dFdy(h);
    vec3 r1 = cross(dpdy, N);
    vec3 r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    if (abs(det) < 1e-20) return N;
    vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
    return normalize(abs(det) * N - grad);
  }

  // Red de grietas (ruido en cresta deformado por el relieve): 0..1, 1 en el centro de la grieta.
  float crackLines(vec3 p, float n, float oct) {
    vec3 q = p * 2.3 + vec3(n * 1.8);
    float r = 1.0 - abs(snoise(q));
    if (oct > 5.0) r = max(r, (1.0 - abs(snoise(q * 3.7 + vec3(5.0)))) * mix(0.9, 0.97, clamp(oct - 5.0, 0.0, 1.0)));
    float w = max(fwidth(r), 0.004);
    return smoothstep(0.93 - w, 0.975 + w, r);
  }

  // Cráteres: cuenco hundido con borde levantado (aprox. -1..0.3), en celdas de Voronoi.
  float craters(vec3 p) {
    float d = worley(p, 0.0, 0.0).x;
    float inside = d < 0.32 ? (d * d) / (0.32 * 0.32) - 1.0 : 0.0;
    float e = (d - 0.32) / 0.07;
    float rim = exp(-e * e) * 0.3;
    return inside + rim;
  }

  void main() {
    vec3 dir = normalize(vObjPos);
    float oct = octavesFor(dir, uFreq, uMaxOctaves);
    vec3 p = dir * uFreq + uSeed;
    vec3 albedo;
    float height = 0.5;
    float water = 0.0;
    float ice = 0.0;
    vec3 emissive = vec3(0.0);
    float n = 0.0;

    if (uBands > 0.5) {
      // Gigantes: bandas por latitud, deformadas por turbulencia (con detalle según la distancia).
      float warp = fbm(p * vec3(1.0, 3.0, 1.0), oct);
      float lat = dir.y + warp * 0.045;
      float b = fbm(vec3(lat * uBandFreq, uSeed.x * 0.1, uSeed.z * 0.1), 4.0);
      float streaks = snoise(vec3(dir.x * 3.0, lat * uBandFreq * 7.0, dir.z * 3.0) + uSeed) * 0.07;
      // Remolinos estirados a lo largo de las bandas: dan detalle a cualquier distancia.
      float eddies = fbm(p * vec3(3.0, 9.0, 3.0) + vec3(warp * 1.5), max(oct - 1.0, 1.0));
      float v = clamp(0.5 + b * 0.95 + streaks + eddies * 0.16, 0.0, 1.0);
      albedo = ramp(v);
      if (uStorm.w > 0.0) {
        float d = distance(dir, uStorm.xyz) / uStorm.w + warp * 0.25;
        float s = 1.0 - smoothstep(0.55, 1.0, d);
        albedo = mix(albedo, uStormColor, s * (0.75 + 0.15 * sin(d * 14.0)));
      }
    } else {
      // Terreno con algo más de peso en las octavas finas: de cerca no se ve liso.
      n = fbmGain(p, oct, 0.56);
      height = clamp(n * 0.75 + 0.5, 0.0, 1.0);
      if (uCraters > 0.0) {
        float cr = craters(p * 2.2) * 0.14;
        if (oct > 4.0) cr += craters(p * 9.0 + vec3(3.0)) * 0.05 * clamp(oct - 4.0, 0.0, 1.0);
        height = clamp(height + cr * uCraters, 0.0, 1.0);
      }
      if (uSeaLevel > 0.0) {
        float aw = max(fwidth(height), 1e-4);
        water = 1.0 - smoothstep(uSeaLevel - aw, uSeaLevel + aw, height);
        float land = clamp((height - uSeaLevel) / (1.0 - uSeaLevel), 0.0, 1.0);
        vec3 sea = mix(uDeepWater, uShallowWater, smoothstep(uSeaLevel - 0.12, uSeaLevel, height));
        albedo = mix(ramp(land), sea, water);
      } else {
        albedo = ramp(height);
      }
      if (uLavaGlow > 0.0) {
        // Grietas incandescentes y lagos de lava en las zonas bajas.
        float glow = crackLines(p, n, oct) * (1.0 - smoothstep(0.4, 0.66, height));
        float lake = 1.0 - smoothstep(0.26, 0.31, height);
        glow = max(glow, lake * (0.75 + 0.25 * fbm(p * 6.0, max(oct - 3.0, 1.0))));
        albedo = mix(albedo, albedo * 0.4, glow);
        emissive = mix(uLavaColor, vec3(1.0, 0.6, 0.2), lake * 0.3) * uLavaGlow * glow * (1.0 - 0.35 * lake);
      }
      if (uCracks > 0.0) albedo = mix(albedo, uCrackColor, crackLines(p + vec3(7.0), n, oct) * uCracks);
      // Casquetes polares, con borde irregular.
      ice = smoothstep(uCapLatitude, uCapLatitude + 0.03, abs(dir.y) + n * 0.07);
      albedo = mix(albedo, vec3(0.86, 0.9, 0.96), ice);
      water *= 1.0 - ice;
    }

    vec3 N0 = normalize(vNormalView);
    vec3 N = N0;
    if (uRelief > 0.0) {
      float hb = mix(height, uSeaLevel, water) * (1.0 - 0.6 * ice);
      N = bumpNormal(N0, vViewPos, hb * uRelief * uRadius);
    }
    vec3 L = normalize(viewMatrix[3].xyz - vCenterView);
    vec3 V = normalize(-vViewPos);
    float geo = dot(N0, L);
    float day = smoothstep(-0.08, 0.14, geo);
    float diff = max(dot(N, L), 0.0) * day;
    // Lado nocturno casi negro: solo un resto de luz para intuir la silueta.
    vec3 col = albedo * (uSunColor * diff + vec3(0.018, 0.022, 0.034));
    vec3 H = normalize(L + V);
    col += uSunColor * pow(max(dot(N0, H), 0.0), 70.0) * 0.55 * water * day;
    col += emissive;

    if (uClouds > 0.0) {
      vec3 cp = dir * uFreq * 1.7 + uSeed.zxy + vec3(uTime * 0.0015, 0.0, 0.0);
      float c = fbm(cp + vec3(n * 0.4), max(oct - 1.0, 1.0));
      float th = 0.72 - uClouds * 0.35;
      // Las nubes van pintadas sobre la superficie: al bajar mucho se apartan para dejar ver el suelo.
      float altitude = length(vCenterView) / uRadius - 1.0;
      float cover = smoothstep(th, th + 0.14, c * 0.5 + 0.5) * smoothstep(0.015, 0.08, altitude);
      vec3 cloudLit = uCloudColor * (uSunColor * max(geo + 0.15, 0.0) * day + vec3(0.012, 0.014, 0.02));
      col = mix(col, cloudLit, cover * 0.9);
    }

    if (uAtmoDensity > 0.0) {
      vec4 a = atmosphereLight(-V, vCenterView / uRadius, 1.0 + uAtmoThickness, length(vViewPos) / uRadius, L, uAtmoColor, uAtmoDensity, uSunColor);
      col = col * (1.0 - a.w * 0.45) + a.rgb;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uAtmoColor;
  uniform float uAtmoThickness;
  uniform float uAtmoDensity;
  uniform float uRadius;
  uniform vec3 uSunColor;
  varying vec3 vViewPos;
  varying vec3 vCenterView;
  ${ATMOSPHERE_GLSL}
  void main() {
    vec3 rd = normalize(vViewPos);
    vec3 L = normalize(viewMatrix[3].xyz - vCenterView);
    vec4 a = atmosphereLight(rd, vCenterView / uRadius, 1.0 + uAtmoThickness, 1e20, L, uAtmoColor, uAtmoDensity, uSunColor);
    gl_FragColor = vec4(a.rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RING_FRAGMENT = /* glsl */ `
  uniform float uInner;
  uniform float uOuter;
  uniform float uRadius;
  uniform vec3 uColor;
  uniform vec3 uSeed;
  uniform float uGap;
  uniform vec3 uSunColor;
  varying vec3 vObjPos;
  varying vec3 vViewPos;
  varying vec3 vCenterView;
  ${NOISE_GLSL}
  void main() {
    float r = length(vObjPos.xy) / uRadius;
    if (r < uInner || r > uOuter) discard;
    float x = (r - uInner) / (uOuter - uInner);
    float fw = max(fwidth(r), 1e-6);
    // Bandas finas que solo aparecen cuando un píxel es más estrecho que ellas.
    float bands = snoise(vec3(r * 40.0, uSeed.x, uSeed.y)) * 0.5
      + snoise(vec3(r * 140.0, uSeed.y, uSeed.z)) * 0.3 * clamp(1.0 - fw * 140.0, 0.0, 1.0)
      + snoise(vec3(r * 520.0, uSeed.z, uSeed.x)) * 0.2 * clamp(1.0 - fw * 520.0, 0.0, 1.0);
    float dens = clamp(0.55 + bands * 0.7, 0.0, 1.0) * smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.88, 1.0, x));
    dens *= 1.0 - 0.9 * (1.0 - smoothstep(0.0, 0.015, abs(x - uGap)));
    // Sombra del planeta sobre el anillo.
    vec3 L = normalize(viewMatrix[3].xyz - vCenterView);
    vec3 toC = vCenterView - vViewPos;
    float shadow = 1.0;
    if (dot(toC, L) > 0.0) shadow = smoothstep(uRadius * 0.96, uRadius * 1.04, length(cross(L, toC)));
    vec3 col = uColor * uSunColor * (0.12 + 0.95 * shadow) * (0.8 + 0.4 * bands);
    gl_FragColor = vec4(col, dens * 0.8);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uDark;
  uniform vec3 uSeed;
  uniform float uMaxOctaves;
  uniform float uSpin;
  uniform float uShear;
  varying vec3 vObjPos;
  varying vec3 vViewPos;
  varying vec3 vNormalView;
  ${NOISE_GLSL}
  void main() {
    vec3 N = normalize(vNormalView);
    vec3 V = normalize(-vViewPos);
    float mu = clamp(dot(N, V), 0.0, 1.0);
    if (uDark > 0.5) {
      // Agujero negro: disco negro con un anillo de luz en el borde.
      gl_FragColor = vec4(uColor * pow(1.0 - mu, 3.0) * 1.5, 1.0);
      return;
    }
    // Giro (uSpin, ya reducido a una vuelta) con algo de rotación diferencial: el
    // ecuador se adelanta a los polos y vuelve (uShear, acotado). Si la diferencia
    // se acumulase sin fin, la superficie se retorcería hasta romperse en rayas.
    vec3 d0 = normalize(vObjPos);
    float spin = uSpin - uShear * d0.y * d0.y;
    float cs = cos(spin);
    float sn = sin(spin);
    vec3 dir = vec3(cs * d0.x + sn * d0.z, d0.y, -sn * d0.x + cs * d0.z);
    float t = uTime;
    // La estrella ES fuego: una masa de llamas que se revuelve. Turbulencia (suma de
    // ruidos en valor absoluto): volutas que se hinchan como llamaradas, con pliegues
    // oscuros entre ellas; algo deformada por otro ruido que se mueve, y que fluye.
    float footprint = max(length(fwidth(dir)), 1e-7);
    int octs = int(clamp(log2(0.5 / (footprint * 24.0)) + 2.0, 3.0, min(uMaxOctaves - 2.0, 7.0)));
    vec3 p = dir * 2.4 + uSeed;
    vec3 warp = vec3(snoise(p * 0.8 + vec3(0.0, t * 0.06, 0.0)), snoise(p * 0.8 + vec3(4.1, -t * 0.05, 2.3)), snoise(p * 0.8 + vec3(7.7, 1.9, t * 0.055)));
    vec3 pp = p + warp * 0.55;
    float turb = 0.0;
    float amp = 0.5;
    float fq = 1.0;
    for (int k = 0; k < 7; k++) {
      if (k >= octs) break;
      turb += amp * abs(snoise(pp * fq + vec3(0.0, 0.0, t * 0.09 * fq)));
      fq *= 2.03;
      amp *= 0.5;
    }
    float fire = snoise(p * 0.6 - vec3(t * 0.03));
    float I = clamp(1.15 - 1.75 * turb + 0.25 * fire, 0.0, 1.0);
    // Rampa de fuego teñida por el color de la estrella: brasa → naranja → amarillo → blanco.
    vec3 ember = uColor * vec3(0.55, 0.14, 0.05);
    vec3 orange = mix(uColor, vec3(1.0, 0.45, 0.1), 0.55);
    vec3 yellow = mix(uColor, vec3(1.0, 0.85, 0.35), 0.6);
    vec3 white = vec3(1.0, 0.97, 0.88);
    vec3 col = mix(ember, orange, smoothstep(0.0, 0.4, I));
    col = mix(col, yellow, smoothstep(0.45, 0.85, I));
    col = mix(col, white, smoothstep(0.88, 1.0, I));
    col *= 0.6 + 0.9 * I;
    // Borde: el fuego visto de lado se acumula y brilla más (al revés que una superficie).
    col *= 0.85 + 0.5 * pow(1.0 - mu, 2.0);
    col += orange * pow(1.0 - mu, 6.0) * (0.6 + 0.8 * I);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CORONA_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uTime;
  uniform float uDark;
  uniform vec3 uSeed;
  uniform float uNear;
  varying vec3 vViewPos;
  varying vec3 vCenterView;
  ${NOISE_GLSL}
  void main() {
    vec3 rd = normalize(vViewPos);
    vec3 cc = vCenterView / uRadius;
    float t = dot(cc, rd);
    float h = t > 0.0 ? length(cross(rd, cc)) : length(cc);
    // No tapa el disco: ahí la esfera de la estrella está delante y la profundidad la
    // oculta. Pero tampoco se descarta dentro del círculo exacto: la esfera es un
    // poliedro y su contorno queda un poco por dentro, y esa franja de un píxel se
    // veía negra; se rellena con el brillo del borde.
    if (h < 0.97) discard;
    // Dirección del punto del rayo más cercano a la estrella, en el mundo (estable al girar la cámara).
    vec3 closest = rd * max(t, 0.0) - cc;
    vec3 dirW = normalize((vec4(closest, 0.0) * viewMatrix).xyz);
    float x = max(h - 1.0, 0.0);
    // Cerca de la estrella el resplandor crece (la luz satura la vista).
    float halo = (0.5 * exp(-x * 7.0) + 0.24 * exp(-x * 1.5)) * (1.0 + 3.0 * uNear);
    float fade = 1.0 - smoothstep(2.8, 4.8, h);
    // La corona ocupa mucha pantalla: donde apenas se ve, no se calcula el ruido.
    if (halo * fade < 0.004) discard;
    float streak = snoise(dirW * 5.0 + uSeed + vec3(0.0, uTime * 0.02, 0.0));
    if (x < 0.8) streak += 0.5 * snoise(dirW * 13.0 + uSeed.zxy - vec3(uTime * 0.03)) * (1.0 - x / 0.8);
    float rays = 0.8 + 0.4 * streak * smoothstep(0.0, 0.35, x);
    float a = halo * max(rays, 0.0) * fade * (uDark > 0.5 ? 0.45 : 1.0);
    vec3 col = mix(uColor, vec3(1.0), 0.35 * exp(-x * 8.0)) * a;
    // Protuberancias: arcos de plasma rojizos pegados al borde que cambian despacio.
    if (uDark < 0.5 && x < 0.25) {
      float p = snoise(dirW * 9.0 + uSeed.yzx + vec3(uTime * 0.012, 0.0, 0.0));
      float loops = smoothstep(0.5, 0.78, p) * exp(-x * 22.0) * (0.6 + 0.4 * snoise(dirW * 30.0 - vec3(uTime * 0.02)));
      col += vec3(1.0, 0.42, 0.4) * max(loops, 0.0) * 0.9;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Llamas de la estrella en 3D: una capa hasta `uOuter` radios que se recorre
 * por pasos a lo largo de cada rayo de la vista (en coordenadas de vista y en
 * radios de la estrella, como la corona), sumando la luz de las lenguas de
 * fuego. Cada lengua sale de la superficie, sube (el ruido se desplaza hacia
 * fuera con el tiempo), se adelgaza y pasa de amarillo a rojo con la altura.
 * El rayo se para en la superficie: delante del disco se ven por encima, y en
 * el borde rompen la silueta. Pasos según la calidad (`uMaxOctaves`).
 */
const FLAME_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uOuter;
  uniform float uTime;
  uniform float uSpin;
  uniform vec3 uSeed;
  uniform float uMaxOctaves;
  varying vec3 vViewPos;
  varying vec3 vCenterView;
  ${NOISE_GLSL}
  void main() {
    vec3 rd = normalize(vViewPos);
    vec3 cc = vCenterView / uRadius;
    float b = dot(rd, cc);
    float c = dot(cc, cc) - uOuter * uOuter;
    float disc = b * b - c;
    if (disc <= 0.0) discard;
    float s = sqrt(disc);
    float t0 = max(b - s, 0.0);
    float t1 = b + s;
    // El rayo se para al tocar la superficie de la estrella.
    float c1 = dot(cc, cc) - 1.0;
    float d1 = b * b - c1;
    if (d1 > 0.0) {
      float tin = b - sqrt(d1);
      if (tin > 0.0) t1 = min(t1, tin);
    }
    if (t1 <= t0) discard;
    // Las llamas salen de toda la bola (en el contorno, que se ven de lado, algo más).
    float impact = length(cross(rd, cc));
    float facing = 0.3 + 0.7 * smoothstep(0.72, 1.0, impact);
    int steps = int(clamp((uMaxOctaves - 3.0) * 3.0, 8.0, 24.0));
    float dt = (t1 - t0) / float(steps);
    float cs = cos(uSpin);
    float sn = sin(uSpin);
    float tm = uTime;
    vec3 light = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      if (i >= steps) break;
      float t = t0 + (float(i) + 0.5) * dt;
      // Punto del rayo respecto al centro, en el mundo (estable al girar la cámara) y girando con la estrella.
      vec3 qv = rd * t - cc;
      vec3 qw = (vec4(qv, 0.0) * viewMatrix).xyz;
      vec3 q = vec3(cs * qw.x + sn * qw.z, qw.y, -sn * qw.x + cs * qw.z);
      float r = length(q);
      float h = clamp((r - 1.0) / (uOuter - 1.0), 0.0, 1.0);
      vec3 dir = q / r;
      // Lenguas: el ruido varía mucho de lado y poco con la altura, así que sale en
      // franjas que se alargan hacia fuera; la altura entra desplazada con el tiempo
      // (las llamas suben) y cada lengua se adelgaza al subir.
      float base = snoise(dir * 4.0 + uSeed + vec3(tm * 0.012));
      float rise = snoise(dir * 13.0 + uSeed.zxy + vec3(h * 1.6 - tm * 0.4));
      float fine = snoise(dir * 31.0 - vec3(h * 3.0 - tm * 0.7));
      float n = base * 0.45 + rise * 0.55 + fine * 0.18 + 0.2;
      float tongue = smoothstep(0.2 + h * 0.7, 0.42 + h * 0.7, n);
      // Sin banda continua en la base: cada lengua arranca de la superficie y se apaga arriba.
      float density = tongue * pow(1.0 - h, 1.3) * (0.35 + 0.65 * smoothstep(0.0, 0.12, h));
      vec3 col = mix(mix(uColor, vec3(1.0, 0.88, 0.6), 0.4), uColor * vec3(1.0, 0.38, 0.18), smoothstep(0.0, 0.7, h));
      light += col * density * dt;
    }
    gl_FragColor = vec4(light * 3.2 * facing, 1.0);
  }
`;

const RING_VERTEX = BODY_VERTEX;

/** Superficie procedural de un planeta o luna de radio `radius` (m). */
export function createPlanetMaterial(look: PlanetLook, radius: number, shared: BodyUniforms, withAtmosphere = true): THREE.ShaderMaterial {
  const atmo = withAtmosphere ? look.atmosphere : null;
  return new THREE.ShaderMaterial({
    uniforms: {
      uSeed: { value: look.seed },
      uFreq: { value: look.freq },
      uColors: { value: look.colors },
      uStops: { value: look.stops },
      uSeaLevel: { value: look.seaLevel },
      uDeepWater: { value: look.deepWater },
      uShallowWater: { value: look.shallowWater },
      uCapLatitude: { value: look.capLatitude },
      uClouds: { value: look.clouds },
      uCloudColor: { value: look.cloudColor },
      uRelief: { value: look.relief },
      uRadius: { value: radius },
      uBands: { value: look.bands ? 1 : 0 },
      uBandFreq: { value: look.bandFreq },
      uStorm: { value: look.storm },
      uStormColor: { value: look.stormColor },
      uLavaGlow: { value: look.lavaGlow },
      uLavaColor: { value: look.lavaColor },
      uCracks: { value: look.cracks },
      uCrackColor: { value: look.crackColor },
      uCraters: { value: look.craters },
      uAtmoColor: { value: atmo?.color ?? new THREE.Color(0, 0, 0) },
      uAtmoThickness: { value: atmo?.thickness ?? 0 },
      uAtmoDensity: { value: atmo?.density ?? 0 },
      uSunColor: shared.uSunColor,
      uMaxOctaves: shared.uMaxOctaves,
      uTime: shared.uTime,
    },
    ...withLogDepth({ vertexShader: BODY_VERTEX, fragmentShader: PLANET_FRAGMENT }),
  });
}

/**
 * Halo de la atmósfera: una capa algo mayor que el planeta, dibujada por
 * dentro (se ve también desde dentro de la atmósfera) y sumando luz.
 */
export function createAtmosphereMaterial(look: PlanetLook, radius: number, shared: BodyUniforms): THREE.ShaderMaterial {
  const atmo = look.atmosphere!;
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtmoColor: { value: atmo.color },
      uAtmoThickness: { value: atmo.thickness },
      uAtmoDensity: { value: atmo.density },
      uRadius: { value: radius },
      uSunColor: shared.uSunColor,
    },
    ...withLogDepth({ vertexShader: BODY_VERTEX, fragmentShader: ATMOSPHERE_FRAGMENT }),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Anillos de un gigante, entre `inner` y `outer` radios del planeta. */
export function createRingMaterial(
  opts: { inner: number; outer: number; radius: number; color: THREE.Color; seed: THREE.Vector3; gap: number },
  shared: BodyUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: opts.inner },
      uOuter: { value: opts.outer },
      uRadius: { value: opts.radius },
      uColor: { value: opts.color },
      uSeed: { value: opts.seed },
      uGap: { value: opts.gap },
      uSunColor: shared.uSunColor,
    },
    ...withLogDepth({ vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT }),
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}

/** Superficie de la estrella (granulado y manchas animados); `dark` para agujeros negros. */
export function createStarSurfaceMaterial(color: THREE.Color, seed: THREE.Vector3, dark: boolean, shared: BodyUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: shared.uTime,
      uDark: { value: dark ? 1 : 0 },
      uSeed: { value: seed },
      uMaxOctaves: shared.uMaxOctaves,
      uSpin: { value: 0 },
      uShear: { value: 0 },
    },
    ...withLogDepth({ vertexShader: BODY_VERTEX, fragmentShader: STAR_FRAGMENT }),
  });
}

/** Corona de la estrella: una capa grande que suma luz alrededor del disco, sin taparlo. */
export function createCoronaMaterial(color: THREE.Color, radius: number, seed: THREE.Vector3, dark: boolean, shared: BodyUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uRadius: { value: radius },
      uTime: shared.uTime,
      uDark: { value: dark ? 1 : 0 },
      uSeed: { value: seed },
      uNear: { value: 0 },
    },
    ...withLogDepth({ vertexShader: BODY_VERTEX, fragmentShader: CORONA_FRAGMENT }),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Llamas 3D de la estrella (ver `FLAME_FRAGMENT`); `spin` es el uniforme de giro de la superficie. */
export function createStarFlameMaterial(color: THREE.Color, radius: number, seed: THREE.Vector3, spin: THREE.IUniform<number>, shared: BodyUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uRadius: { value: radius },
      uOuter: { value: FLAME_SCALE },
      uTime: shared.uTime,
      uSpin: spin,
      uSeed: { value: seed },
      uMaxOctaves: shared.uMaxOctaves,
    },
    ...withLogDepth({ vertexShader: BODY_VERTEX, fragmentShader: FLAME_FRAGMENT }),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Altura de las llamas 3D (radios de la estrella, desde el centro). */
export const FLAME_SCALE = 1.45;

/** Vuelta de la estrella en su ecuador (s): rápida a propósito, para que se note que gira. */
export const STAR_SPIN_PERIOD_SEC = 90;

/** Radio de la corona respecto al de la estrella. */
export const CORONA_SCALE = 5;
