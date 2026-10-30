# KIN — operating charter for coding agents

Act as principal engineer, technical game designer and product craft lead. Treat the user
experience as the acceptance test. Make sensible, reversible decisions and record them in
`docs/PLAN.md`. Don't ask for general design clarification.

## Definition of done (per change)
1. `npm run check` passes (types, the property test, unit tests, web build).
2. If you touched native-facing code, `npm run ios:sim` still builds, and iPhone + iPad screenshots look right.
3. You looked at the change in a real render (screenshot), not just the tests.
4. No future idea is represented as finished. Update the "Known limitations" list in PLAN.md.
5. Commit and push. Keep CHANGELOG-style notes in the PR body, not in a shared file.
6. **Launcher registration**, once the app is publicly live: mutaafaziz.com (every edition, the ⌘K
   dock, deep links) **and** Digital Craft `/labs`.

## Non-goals (for now)
Open world, AI chatbot, MMO, blockchain, pet trading, generative 3D pipeline, unrestricted chat,
unlicensed IP, in-app purchases, and gameplay that depends on fold/hinge hardware.

## Ads and privacy (owner decision, 2026-10-30)
Mutaaf decided on 2026-10-30 to monetize the whole collection through Marquee
(mutaafaziz.com/ads), split by audience. KIN is a **kids** app, so:
- One banner only, `about-footer` (banner, `menu` context), at the foot of the landing page
  `/kin/about/`. Never put a slot in the app page (`index.html`), the Unity preview (`/kin/play/`)
  or anywhere over the creature. No interstitials, and no rewarded ads: KIN has no natural opt-in
  reward, and skipping a bond-level gate for an ad would be pay-to-progress.
- Web only. `src/landing/ads.ts` skips the loader when `Capacitor.isNativePlatform()`; native
  AdMob is a later phase.
- Marquee tags Google requests child-directed, runs only kid-safe sponsors, and never clicks out.
  AdSense isn't approved yet, so the slot resolves with no fill and collapses. Never block on an ad.
- Ad privacy policy: https://mutaafaziz.com/ads/privacy/ (linked from the landing footer).
  `tests/ads.test.ts` guards these rules.
