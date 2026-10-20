import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Lee VITE_* del .env en la raíz del monorepo.
  envDir: "../..",
  server: {
    port: 5173,
    host: "localhost",
    // En desarrollo, las llamadas a la API van al servidor local (pnpm dev:server).
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
