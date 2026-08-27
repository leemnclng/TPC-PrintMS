import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer is loaded by Electron from a file:// build in production and from
// the Vite dev server in development, so we keep the base relative and the
// dev server on a fixed, predictable port for the Electron main process to
// wait on (see apps/desktop/src/main.ts).
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
