import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "node:url";

// libsodium-wrappers 0.7.16 ships a broken ESM entry (imports sibling
// `./libsodium.mjs` that isn't actually inside the package). Point Vite
// at the self-contained CJS build so both dev and prod bundles resolve.
const libsodiumCjs = fileURLToPath(
  new URL(
    "./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js",
    import.meta.url,
  ),
);

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "libsodium-wrappers": libsodiumCjs,
    },
  },
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
});
