# KIN delivery plan

Source vision: `docs/blueprint/` (README, PDF, moodboard). This plan amends the blueprint in a few places.

## Decisions (reversible, recorded)
1. **Rendering:** three.js for Home, Crossing and Party (light, always on). Babylon.js + Havok for Sports/Arena later, lazy-loaded per mode. The genome → creature contract is shared, so a KIN looks the same in both.
2. **Surfaces in every phase:** web/PWA, plus iPhone and iPad through Capacitor (`ios/`), all from one codebase. Android comes later on the same shell.
3. **Transport order:** BroadcastChannel (same device, done) → Cloudflare Durable Object room via QR/room code (phones on any network) → WebRTC DataChannel for LAN latency → laptop relay for no-internet LAN → native peers (Multipeer / Wi-Fi Aware) in the native shell.
4. **Seam:** both screens evaluate one hop curve in a shared pixel space (`render/choreo.ts`). Two windows on one display use the real screen geometry. Phones use a virtual side-by-side layout. **Next:** a stitch swipe (one finger across both screens) calibrates edge, vertical offset and scale.
5. **Look:** restrained graphite UI, a rich creature, and a **live sky** that follows real time, sun angle, temperature, wind and precipitation (Open-Meteo, coarse location by default).
6. **Hosting:** public repo `mutaaf/kin`, served at `mutaafaziz.com/kin` (Cloudflare Worker route, like the arcade games), listed in both launchers once live.

## Sprints
| Sprint | Ship | Gate | Status |
|---|---|---|---|
| 0 | Hatch → name → pet → persists, live sky, no signup; web + iPhone + iPad builds | First response under 2 s; runs on iPhone and iPad simulators | **done** |
| 1 | Two-window crossing: full state machine, leases, reactions, return with memory | 1,000-run property test green; crossing visible across two windows | **done** |
| 2 | Real phones: DO relay + QR room, stitch swipe, clock sync, on-device iPhone ↔ iPad ↔ web | A 20-second video that makes people gasp | next |
| 3 | Party (3–5 KIN), structured social intents, host handoff | Five KIN behave distinctly; losing a device corrupts nobody | |
| 4 | KIN DASH (Babylon + Havok, seeded, replayable) | Same seed + inputs ⇒ same result | |
| 5 | Wardrobe / skins (layered on the same rig) | Same outfit renders identically everywhere | |
| 6 | Online: optional accounts, sync, parental controls, store review | Abuse and privacy controls verified | |

**Kill criterion:** if the Sprint 2 video doesn't land, iterate on the crossing before building any other pillar.

## Known limitations (honest list)
- Crossing works between windows/tabs **on one device**. Phone-to-phone needs the Sprint 2 relay.
- Window geometry uses `screenX` and the chrome size. Both windows should be the same browser for pixel-exact alignment.
- Left/right edges only (phones side by side). Top/bottom edges arrive with the stitch swipe.
- The return hop approximates the guest's start point as its landing spot.
- Frame rates have not been measured on physical devices yet (simulator and SwiftShader only).

## Risks
COPPA/kids review before any public social feature · "KIN" trademark search before launch · iOS
suspends background web views (the life sim catches up from timestamps) · venue Wi-Fi often blocks
client-to-client traffic (hence relay first) · creature designs must stay original (the moodboard has
Pokémon-adjacent silhouettes we deliberately do not copy).
