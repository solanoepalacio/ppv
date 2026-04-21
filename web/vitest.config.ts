import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// libsodium-wrappers v0.7.16 ships a broken ESM entry: its
// `modules-esm/libsodium-wrappers.mjs` does `import './libsodium.mjs'`,
// but that file isn't inside the `libsodium-wrappers` package. Point
// Vite/Vitest at the CJS entry, which is self-contained.
const libsodiumCjs = fileURLToPath(
  new URL(
    './node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js',
    import.meta.url,
  ),
);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [
      ['src/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['src/test-setup.ts'],
    alias: {
      'libsodium-wrappers': libsodiumCjs,
    },
  },
});
