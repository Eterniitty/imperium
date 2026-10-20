// Empaqueta el servidor en dist/index.js con esbuild.
// Los paquetes del monorepo (@imperium/*) se incluyen en el paquete porque se
// publican como TypeScript; las dependencias de npm quedan fuera y se cargan
// desde node_modules.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@imperium/"));

// Versión visible en /api/health: versión del paquete + commit, p. ej. "0.1.0+3bd4488".
let commit = "sin-git";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Sin git disponible se compila igualmente.
}

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  define: { __SERVER_VERSION__: JSON.stringify(`${pkg.version}+${commit}`) },
  logLevel: "info",
});
