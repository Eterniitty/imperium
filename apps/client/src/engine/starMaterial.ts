import * as THREE from "three";
import { withLogDepth } from "./logDepth";

/**
 * Material de estrellas del mapa: cada estrella es un punto con núcleo
 * brillante y halo. Todas las de un sector se dibujan en una sola llamada.
 * Las estrellas se desvanecen al acercarse al borde del radio de carga para
 * que la aparición de sectores nuevos no se note.
 */
export function createStarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 800 },
      uFocus: { value: new THREE.Vector3() },
      uFadeRadius: { value: 250 },
    },
    ...withLogDepth({
vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float size;
      uniform float uScale;
      uniform vec3 uFocus;
      uniform float uFadeRadius;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * world;
        gl_Position = projectionMatrix * mv;
        float d = distance(world.xyz, uFocus);
        vAlpha = 1.0 - smoothstep(uFadeRadius * 0.65, uFadeRadius, d);
        float px = size * uScale / max(-mv.z, 0.001);
        // Las estrellas lejanas no bajan de 2.5 px, pero pierden brillo.
        vAlpha *= clamp(px / 2.5, 0.35, 1.0);
        gl_PointSize = clamp(px, 2.5, 64.0);
        vColor = color;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.32, 0.0, d);
        float halo = exp(-d * d * 4.5) * 0.6;
        vec3 col = mix(vColor, vec3(1.0), core * 0.55);
        gl_FragColor = vec4(col * (core + halo) * vAlpha, 1.0);
      }
    `
}),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
