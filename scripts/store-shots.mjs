// Raw store captures for Lobby (store/lobby.json → store/lobby/raw/{iphone,ipad}).
// Usage: npm run dev (another shell), then  node scripts/store-shots.mjs [iphone|ipad|cross|all]
//
// These are the real app: the same bundle the iPhone/iPad build wraps (vite --mode native only
// changes the base path), driven headless at the store's exact pixel sizes. The two-screen
// crossing uses the landing trailer's embed mode (?embed=1): two real instances side by side in
// one page, because a background tab doesn't render. The clock is faked with Playwright's clock
// (install + resume: time flows from the chosen instant), so the sky, the sun and the HUD's time all agree on the chosen hour.
// Playwright is borrowed from ../outatime-88 (see CLAUDE.md nuances).
import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync } from 'node:fs';
const require = createRequire(new URL('../../outatime-88/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.env.KIN_URL ?? 'http://localhost:5188/kin/';
const OUT = new URL('../store/lobby/raw/', import.meta.url).pathname;
const CAND = new URL('../store/lobby/cand/', import.meta.url).pathname;
const which = process.argv[2] ?? 'all';
// The real GPU (Metal). SwiftShader at 3x takes >30 s a frame, so frame-driven fades never finish and shots come out dim.
const GL = ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'];
const TZ = 'America/Chicago';
const at = (h, m = 0) => new Date(`2026-10-17T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`);

const DEVICES = {
  iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, // 1320×2868
  ipad: { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, // 2064×2752
};

async function solo(b, dev) {
  const D = DEVICES[dev];
  const { width: W, height: H } = D.viewport;
  mkdirSync(OUT + dev, { recursive: true });
  const ctx = await b.newContext({ ...D, timezoneId: TZ });
  await ctx.clock.install({ time: at(18, 10) });
  await ctx.clock.resume();
  const p = await ctx.newPage();
  // The KIN roams on its own and often walks out of frame, so every scene is a burst of
  // candidates in store/lobby/cand/ (gitignored). The first becomes the raw; pick a better one by
  // eye with KIN_PICK="iphone/01-meadow=3,ipad/03-play=1" (or copy it over).
  const picks = Object.fromEntries((process.env.KIN_PICK ?? '').split(',').filter(Boolean).map((x) => x.split('=')));
  const shot = async (n, burst = Number(process.env.KIN_BURST ?? 6)) => {
    mkdirSync(`${CAND}${dev}`, { recursive: true });
    for (let i = 0; i < burst; i++) {
      if (i) await p.waitForTimeout(2200);
      await p.screenshot({ path: `${CAND}${dev}/${n}-${i}.png`, timeout: 120000 });
    }
    copyFileSync(`${CAND}${dev}/${n}-${picks[`${dev}/${n}`] ?? 0}.png`, `${OUT}${dev}/${n}.png`);
    console.log('  ', dev, n);
  };
  // Plain DOM clicks: the action bar bobs (never "stable") and hides itself between touches.
  const btn = (name) => ({ click: () => p.locator(`button[aria-label="${name}"], button:text-is("${name}")`).first().evaluate((e) => e.click()) });
  const go = async (q) => {
    await p.goto(`${BASE}?k=lobby&${q}`);
    // A returning KIN's world takes ~25 s to light up after a load; earlier shots come out dim.
    await p.waitForTimeout(q.includes('first') ? 7000 : 26000);
  };
  const touch = async () => {
    await p.keyboard.press('Shift');
    await p.waitForTimeout(1600);
  };

  // The cocoon, before anything happens.
  await go('wx=clear&first');
  await p.waitForTimeout(4000);
  await shot('08-cocoon');
  await p.mouse.click(W / 2, H * 0.52);
  await p.waitForTimeout(900);
  await p.mouse.click(W / 2, H * 0.52);
  await p.waitForTimeout(5000);
  await btn("That's them").click();
  await p.waitForTimeout(4000);

  // Reload once hatched: the KIN comes home as it would on any later launch.
  // Golden hour, the controls receded: just the KIN and its world.
  await go('wx=clear');
  await p.waitForTimeout(8000);
  await shot('01-meadow');

  await touch();
  await btn('Play').click();
  await p.waitForTimeout(3000);
  await shot('03-play');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(1500);

  await touch();
  await btn('Train').click();
  await p.waitForTimeout(3000);
  await shot('04-train');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(1500);

  await touch();
  await p.locator('button[aria-label^="Your KIN"]').first().evaluate((e) => e.click());
  await p.waitForTimeout(4500);
  await shot('07-card');
  await p.keyboard.press('Escape');

  // Other skies: real time of day and weather drive the habitat.
  await ctx.clock.setSystemTime(at(8, 20));
  await go('wx=snow');
  await p.waitForTimeout(8000);
  await shot('05-snow');

  await ctx.clock.setSystemTime(at(21, 30));
  await go('wx=clear');
  await p.waitForTimeout(8000);
  await shot('06-night');

  await ctx.close();
}

async function cross(b) {
  const W = 440, H = 956;
  mkdirSync(OUT + 'iphone', { recursive: true });
  const ctx = await b.newContext({ viewport: { width: W * 2, height: H }, deviceScaleFactor: 3, timezoneId: TZ });
  // No fake clock here: the crossing's session timers stall under a fixed Date, and the
  // top-down crossing camera shows no sky.
  const p = await ctx.newPage();
  await p.goto(`${BASE}about/`);
  await p.evaluate(({ W, H }) => {
    document.documentElement.innerHTML = '<body style="margin:0;display:flex;background:#000"></body>';
    const mk = (slot, seed, name, sx) => {
      const f = document.createElement('iframe');
      f.id = slot;
      f.style.cssText = `width:${W}px;height:${H}px;border:0;display:block`;
      f.src = `/kin/?embed=1&room=lobby&k=${slot}&seed=${seed}&name=${name}&wx=clear&sx=${sx}`;
      document.body.appendChild(f);
    };
    mk('la', 28, 'Lumi', 0);
    mk('lb', 12, 'Nox', W);
  }, { W, H });
  await p.waitForTimeout(16000);
  const cmd = (id, m) => p.evaluate(([id, m]) => document.getElementById(id).contentWindow.postMessage({ kin: 'cmd', ...m }, location.origin), [id, m]);
  await cmd('la', { cmd: 'cinema', on: true });
  await cmd('lb', { cmd: 'cinema', on: true });
  await p.waitForTimeout(2500);
  await cmd('la', { cmd: 'visit' });
  // Lumi hops out, lands on Nox's screen and Nox reacts: a burst of paired captures, split into
  // the two phones. KIN_PICK="cross=N" chooses the pair (default 0).
  const pick = Number(((process.env.KIN_PICK ?? '').match(/cross=(\d+)/) ?? [])[1] ?? 0);
  mkdirSync(CAND + 'cross', { recursive: true });
  await p.waitForTimeout(Number(process.env.KIN_CROSS_MS ?? 1500));
  for (let i = 0; i < Number(process.env.KIN_BURST ?? 8); i++) {
    if (i) await p.waitForTimeout(1200);
    await p.screenshot({ path: `${CAND}cross/pair-${i}.png`, timeout: 120000 });
    await p.locator('#la').screenshot({ path: `${CAND}cross/a-${i}.png`, timeout: 120000 });
    await p.locator('#lb').screenshot({ path: `${CAND}cross/b-${i}.png`, timeout: 120000 });
  }
  copyFileSync(`${CAND}cross/a-${pick}.png`, `${OUT}iphone/02-cross-a.png`);
  copyFileSync(`${CAND}cross/b-${pick}.png`, `${OUT}iphone/02-cross-b.png`);
  console.log('   cross a+b');
  await ctx.close();
}

const b = await chromium.launch({ args: GL });
if (which === 'all' || which === 'iphone') await solo(b, 'iphone');
if (which === 'all' || which === 'ipad') await solo(b, 'ipad');
if (which === 'all' || which === 'cross') await cross(b);
await b.close();
