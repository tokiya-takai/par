import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built assets go to the package's dist/ui, which `par serve` serves statically.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // Dev: run `par serve --port 8787` alongside `vite` and proxy the API to it.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
