// Regenerate the iOS app icon + splash from the procedural creature.
// Usage: node scripts/make-icons.mjs <seed>   (dev server must be running: npm run dev)
// Playwright is borrowed from ../outatime-88 (see CLAUDE.md nuances).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../outatime-88/package.json', import.meta.url));
const { chromium } = require('playwright');
const seed = process.argv[2] ?? '7';
const out = process.argv[3] ?? 'ios/App/App/Assets.xcassets';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [mode, size, file] of [
  ['icon', 1024, `${out}/AppIcon.appiconset/AppIcon-512@2x.png`],
  ['splash', 2732, `${out}/Splash.imageset/splash-2732x2732.png`],
]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.goto(`http://localhost:5188/kin/tools/icon.html?seed=${seed}&size=${size}&mode=${mode}`);
  await p.waitForFunction(() => document.title === 'ready', null, { timeout: 60000 });
  await p.locator('canvas').screenshot({ path: file, omitBackground: false });
  console.log('wrote', file);
}
await b.close();
