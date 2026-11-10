# KIN — agent notes

Read `docs/PLAN.md` (decisions, sprint status) and `docs/ENGINEERING.md` (principles) first. The
vision is in `docs/blueprint/`. AGENTS.md has the definition of done.

## Invariants (never break)
- A KIN is never lost or duplicated. Only the owner persists the creature; hosts hold leases.
  Any change to `src/session/cross.ts` must keep `tests/cross.property.test.ts` green.
- `src/core`, `src/protocol` and `src/session` stay pure: no three.js, DOM or timers (enforced by `tests/boundaries.test.ts`).
- Same seed ⇒ same creature. Never put `Math.random` in genome or brain decisions.
- No account and no signup wall. Never call `alert`, `confirm` or `prompt`.
- A version bump needs its What's new entry in `src/whatsnew/notes.ts` (see AGENTS.md, "What's new").

## Environment nuances
| Nuance | Why it matters |
|---|---|
| Web base path is `/kin/`; native builds use `--mode native` (base `./`, out `native-dist`) | Capacitor can't load absolute `/kin/` asset paths |
| `xcode-select -p` must be Xcode.app (it is, as of 2026-10-22); otherwise export `DEVELOPER_DIR` | xcodebuild under CommandLineTools fails with no clear error |
| Open Simulator by bundle id: `open -b com.apple.iphonesimulator` | `open -a Simulator` and the Xcode Developer/Applications path both fail on this machine |
| `IDERunDestination: Supported platforms ... empty` warning from xcodebuild is harmless | The build still succeeds |
| Capacitor 8 uses Swift Package Manager (no CocoaPods) | Don't run `pod install` in `ios/` |
| Headless screenshots: Playwright from `../outatime-88/node_modules` with SwiftShader flags | No Playwright dependency in this repo yet |
| Vite reloads the page once on first run while it optimizes dependencies | E2E scripts must wait ~2.5 s after the first load |
| `?sx=` shifts a window's reported screen x | Headless two-window tests have no real window layout |
| Open-Meteo is called directly from the client (free, keyless, CORS) | Offline falls back to the cached reading, then a mild default |
| Cloudflare Free plan caps Durable Object **namespaces at 100 per account**; every Worker *preview* of a DO Worker creates new ones | outatime-88 previews leaked 97 and blocked deploys (cleaned 2026-10-22). Keep `preview_urls: false` here |
| `wrangler deploy` from this repo is the deploy path (no Workers Builds hookup yet) | Route `mutaafaziz.com/kin*` overrides the personal site only under /kin |
| Relay tests: `wss://mutaafaziz.com/kin/api/lobby?pool=<name>` isolates a lobby | Real clients use the datacenter (colo) as the pool |
| Native/dev builds talk to the production relay; `?relay=` overrides it | WKWebView origin is capacitor://localhost and the Worker doesn't check Origin |
| Native web bundle is `native-dist/` (outside `dist/`) | Everything in `dist/` is uploaded as site assets |
| Peer ids are `<deviceId>-<slot>`, with deviceId in localStorage `kin:device` | Every device's first home is slot "home", so slot alone collides |
| `tools/icon.html` renders the icon from the real creature; eyelids must be hidden there | KinView normally manages the lids; without it the eyes look half-shut |
| Store captures (`node scripts/store-shots.mjs`, for Lobby) need the real GPU: Chromium `--use-angle=metal` | Under SwiftShader a 3x frame takes >30 s, so frame-driven fades never finish and every shot comes out dim |
| A returning KIN's world takes ~25 s to light up after a page load | Screenshots taken sooner are dark; the store script waits 26 s per load |
| The KIN roams and often walks out of frame | Store shots are bursts in `store/lobby/cand/` (gitignored); `KIN_PICK` in `store/lobby.json`'s capture command records which candidate became each raw |
| Playwright's fake clock stalls the crossing (session timers) | The store script fakes the clock for solo scenes only, never for the two-instance crossing |
| Playwright sets `navigator.webdriver`, so What's new never shows under it | Preview the modal with `?whatsnew=1` (records nothing) |
| Forcing What's new on a simulator or phone | Debug build + launch argument `-KINWhatsNew YES` (simctl launch or Xcode scheme); Release ignores it |
