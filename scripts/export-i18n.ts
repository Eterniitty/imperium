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
const pick = (dict: Record<string, string>) => Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("ue.")));
const data = { version: 1, es: pick(es), en: pick(en) };
const missing = Object.keys(data.es).filter((k) => !(k in data.en));
if (missing.length) {
  console.error("Faltan en inglés: " + missing.join(", "));
  process.exit(1);
}
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(`Escrito ${out}: ${Object.keys(data.es).length} textos en es y en.`);
