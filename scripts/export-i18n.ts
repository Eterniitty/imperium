// Exporta los textos del cliente de Unreal (claves «ue.*», en español e inglés) a JSON.
// Uso: node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs scripts/export-i18n.ts ../aeonarch-ue/Data/i18n.json
import { writeFileSync } from "node:fs";
import { en } from "../packages/shared/src/i18n/en.ts";
import { es } from "../packages/shared/src/i18n/es.ts";

const out = process.argv[2];
if (!out) {
  console.error("Falta la ruta de salida");
  process.exit(1);
}
// Cada idioma, como lista de pares [clave, texto] (más fácil de leer en Unreal que un objeto).
const pick = (dict: Record<string, string>) => Object.entries(dict).filter(([k]) => k.startsWith("ue."));
const data = { version: 1, es: pick(es), en: pick(en) };
const enKeys = new Set(data.en.map(([k]) => k));
const missing = data.es.map(([k]) => k).filter((k) => !enKeys.has(k));
if (missing.length) {
  console.error("Faltan en inglés: " + missing.join(", "));
  process.exit(1);
}
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`Escrito ${out}: ${data.es.length} textos en es y en.`);
