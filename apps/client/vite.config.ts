import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Lee VITE_* del .env en la raíz del monorepo.
  envDir: "../..",
  server: {
    port: 5173,
    host: "localhost",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
