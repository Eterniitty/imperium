/**
 * Búfer de profundidad logarítmico en shaders propios. El motor lo usa para que
 * convivan objetos de metros (naves) y de millones de metros (estrellas,
 * órbitas) sin parpadeos; los ShaderMaterial propios tienen que escribir su
 * profundidad igual que los de Three.js, o se taparían mal entre sí.
 */
export function withLogDepth(shader: { vertexShader: string; fragmentShader: string }): { vertexShader: string; fragmentShader: string } {
  const vertexShader = `#include <common>\n#include <logdepthbuf_pars_vertex>\n${shader.vertexShader.replace(
    /(gl_Position\s*=[^;]*;)/,
    "$1\n#include <logdepthbuf_vertex>\n",
  )}`;
  const fragmentShader = `#include <logdepthbuf_pars_fragment>\n${shader.fragmentShader.replace(/void main\(\)\s*\{/, "void main() {\n#include <logdepthbuf_fragment>\n")}`;
  if (vertexShader === shader.vertexShader || !vertexShader.includes("logdepthbuf_vertex") || !fragmentShader.includes("logdepthbuf_fragment")) {
    throw new Error("withLogDepth: no se encontró gl_Position o main() en el shader");
  }
  return { vertexShader, fragmentShader };
}
