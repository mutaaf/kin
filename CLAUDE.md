# KIN — agent notes

Read `docs/PLAN.md` (decisions, sprint status) and `docs/ENGINEERING.md` (principles) first. The
vision is in `docs/blueprint/`. AGENTS.md has the definition of done.

## Invariants (never break)
- A KIN is never lost or duplicated. Only the owner persists the creature; hosts hold leases.
  Any change to `src/session/cross.ts` must keep `tests/cross.property.test.ts` green.
- `src/core`, `src/protocol` and `src/session` stay pure: no three.js, DOM or timers (enforced by `tests/boundaries.test.ts`).
- Same seed ⇒ same creature. Never put `Math.random` in genome or brain decisions.
- No account and no signup wall. Never call `alert`, `confirm` or `prompt`.

## Environment nuances
| Nuance | Why it matters |
|---|---|
| Web base path is `/kin/`; native builds use `--mode native` (base `./`, out `dist/native`) | Capacitor can't load absolute `/kin/` asset paths |
| `xcode-select -p` must be Xcode.app (it is, as of 2026-10-22); otherwise export `DEVELOPER_DIR` | xcodebuild under CommandLineTools fails with no clear error |
| Open Simulator by bundle id: `open -b com.apple.iphonesimulator` | `open -a Simulator` and the Xcode Developer/Applications path both fail on this machine |
| `IDERunDestination: Supported platforms ... empty` warning from xcodebuild is harmless | The build still succeeds |
| Capacitor 8 uses Swift Package Manager (no CocoaPods) | Don't run `pod install` in `ios/` |
| Headless screenshots: Playwright from `../outatime-88/node_modules` with SwiftShader flags | No Playwright dependency in this repo yet |
| Vite reloads the page once on first run while it optimizes dependencies | E2E scripts must wait ~2.5 s after the first load |
| `?sx=` shifts a window's reported screen x | Headless two-window tests have no real window layout |
| Open-Meteo is called directly from the client (free, keyless, CORS) | Offline falls back to the cached reading, then a mild default |
