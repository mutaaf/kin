import { defineConfig } from 'vitest/config';

// Web: served at https://mutaafaziz.com/kin/ (Cloudflare Worker route, like the other games).
// Native (`--mode native`): relative base, bundled into the iOS/iPadOS app by Capacitor.
export default defineConfig(({ mode }) => ({
  base: mode === 'native' ? './' : '/kin/',
  build: { outDir: mode === 'native' ? 'dist/native' : 'dist/kin', emptyOutDir: true, target: 'es2022' },
  server: { port: 5188 },
  preview: { port: 5189 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
