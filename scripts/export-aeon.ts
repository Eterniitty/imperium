// Exporta los datos del sistema de Aeon (Era II) a JSON para el cliente de Unreal.
// Uso: node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/export-aeon.ts ../aeonarch-ue/Data/aeon.json
import { writeFileSync } from "node:fs";
import { AEON_FLIGHT, AEON_PLACES, AEON_STAR, AEON_WORLDS, parcelCount, validateAeon } from "../packages/content/src/aeon.ts";

const errors = validateAeon();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const out = process.argv[2];
if (!out) {
  console.error("Falta la ruta de salida");
  process.exit(1);
}
const data = {
  version: 1,
  star: AEON_STAR,
  worlds: AEON_WORLDS.map((w) => ({
    ...w,
    parcelCount: w.parcelFrequency ? parcelCount(w.parcelFrequency) : 0,
    moons: w.moons.map((m) => ({ ...m, parcelCount: m.parcelFrequency ? parcelCount(m.parcelFrequency) : 0 })),
  })),
  places: AEON_PLACES,
  flight: AEON_FLIGHT,
};
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`Escrito ${out}: ${data.worlds.length} mundos, ${data.worlds.reduce((n, w) => n + w.moons.length, 0)} lunas, ${data.places.length} lugares.`);
