import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.AEONARCH_API_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
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
  },
});
