import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// Ruta relativa (no `@imperium/shared/wiki`): así se empaqueta con la configuración en vez de cargarse como .ts sin compilar.
import { WIKI_ARTICLES, WIKI_HOME } from "../../packages/shared/src/wiki.ts";

const API_PORT = process.env.AEONARCH_API_PORT ?? "3000";
const root = dirname(fileURLToPath(import.meta.url));

/**
 * Wiki (`/wiki`, página aparte del juego). En desarrollo, `/wiki/<tema>` sirve
 * `wiki/index.html`; al compilar se copia esa página a `wiki/<tema>/index.html`
 * para cada artículo, así el servidor de archivos (Caddy en producción) la
 * encuentra sin reglas de reescritura.
 */
function wikiPages(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const url = req.url ?? "";
    const path = url.split("?")[0]!;
    if (path === "/wiki" || (path.startsWith("/wiki/") && !path.slice(6).includes(".") && !path.startsWith("/wiki/index.html"))) {
      req.url = "/wiki/index.html" + url.slice(path.length);
    }
    next();
  };
  return {
    name: "aeonarch-wiki-pages",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
    closeBundle() {
      const outDir = resolve(root, "dist");
      const page = resolve(outDir, "wiki/index.html");
      for (const { slug } of WIKI_ARTICLES) {
        if (slug === WIKI_HOME) continue;
        mkdirSync(resolve(outDir, "wiki", slug), { recursive: true });
        copyFileSync(page, resolve(outDir, "wiki", slug, "index.html"));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), wikiPages()],
  // Lee VITE_* del .env en la raíz del monorepo.
  envDir: "../..",
  server: {
    port: 5173,
    host: "localhost",
    // En desarrollo, las llamadas a la API van al servidor local (pnpm dev:server).
    // Las pruebas de navegador (pnpm e2e) apuntan a su propio servidor con AEONARCH_API_PORT.
    proxy: {
      "/api": `http://127.0.0.1:${API_PORT}`,
      "/ws": { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      // Dos páginas: el juego y la Wiki.
      input: {
        main: resolve(root, "index.html"),
        wiki: resolve(root, "wiki/index.html"),
      },
    },
  },
});
