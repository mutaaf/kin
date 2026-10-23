import { writeFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Cloudflare Web Analytics is on for the zone and injects a beacon into HTML; the game opts out
// with no-transform (same approach as the other games). _headers sits at the assets root.
const headers = {
  name: 'kin-headers',
  apply: 'build' as const,
  closeBundle() {
    writeFileSync(
      'dist/_headers',
      ['/kin/', '/kin/index.html'].map((p) => `${p}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`).join('') +
        '/kin/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
    );
  },
};

// Web: served at https://mutaafaziz.com/kin/ (Cloudflare Worker route, like the other games).
// Native (`--mode native`): relative base, bundled into the iOS/iPadOS app by Capacitor.
export default defineConfig(({ mode }) => ({
  base: mode === 'native' ? './' : '/kin/',
  plugins: mode === 'native' ? [] : [headers],
  build: { outDir: mode === 'native' ? 'native-dist' : 'dist/kin', emptyOutDir: true, target: 'es2022' },
  server: { port: 5188 },
  preview: { port: 5189 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
