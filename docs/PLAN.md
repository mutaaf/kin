# KIN delivery plan

Source vision: `docs/blueprint/` (README, PDF, moodboard). This plan amends the blueprint in a few places.

## Decisions (reversible, recorded)
1. **Rendering:** three.js for Home, Crossing and Party (light, always on). Babylon.js + Havok for Sports/Arena later, lazy-loaded per mode. The genome → creature contract is shared, so a KIN looks the same in both.
2. **Surfaces in every phase:** web/PWA, plus iPhone and iPad through Capacitor (`ios/`), all from one codebase. Android comes later on the same shell.
3. **Transport order:** BroadcastChannel (same device, done) → Cloudflare Durable Object relay, one Lobby per datacenter (done, live) → WebRTC DataChannel for LAN latency → laptop relay for no-internet LAN → native peers (Multipeer / Wi-Fi Aware) in the native shell.
4. **Pairing is invisible, never a QR code (user decision, 2026-10-22).** The **stitch**: slide one finger off one screen onto the other. The relay matches the out/in halves by timing and facing edges (`src/stitch/match.ts`). The same gesture calibrates the seam: which edges touch and the vertical offset. Two simultaneous pairs are refused, not guessed. The relay connects only when someone makes the gesture.
4b. **Seam:** both screens evaluate one hop curve in a shared pixel space (`render/choreo.ts`). Windows on one display use real screen geometry; linked devices use the stitch calibration. Linked touch devices ease to a shared physical scale (~19 mm per world unit), so a KIN doesn't change size between iPhone and iPad.
4c. **AI director (bring your own key, user decision 2026-10-22):** the established COLD GAS contract. A free Workers AI model by default; one paste connects Claude, OpenAI, xAI or Gemini (detected from the key, live model list, cheapest fast model). The key stays on the device and travels per call as `x-kin-key`, never stored. The model may only pick ONE act from the brain's safe vocabulary, validated on both sides. Every call plays live in an aurora-field theatre (READ → THINK → SPEAK) with its real model, tokens, timing and cost.
4d. **Studio overhaul (user request 2026-10-22, "100x more lovable", physics, every object its own controller, endless care):** two parallel tracks. The **creature** track covers a sculpted soft body, shell fur, expressive eyes, touch zones, personality idles, voice and growth. The **world** track covers Rapier physics, materials, an actor system where each object has its own controller, and a humane care and progression loop. Then a **landing page** at /kin/about/ with an aurora-field hero and a live two-instance trailer.
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
- Ads (2026-10-30): one Marquee banner on the web landing page only; AdSense isn't approved, so it shows nothing yet. Native AdMob is not built.
- Device-to-device linking runs through the internet relay (mutaafaziz.com). Fully offline LAN linking (laptop relay / native peers) is later.
- Stitch pairing is unit-tested and verified against the live relay with simulated devices, **but not yet on physical phones**. Tune the timing window (`WINDOW`) and the edge zone (`EDGE_PX`) on real glass.
- After a relay reconnect, devices must stitch again to rejoin a room.
- Window geometry uses `screenX` and the chrome size. Both windows should be the same browser for pixel-exact alignment.
- Left/right edges only (phones side by side). Top/bottom edges arrive with the stitch swipe.
- The return hop approximates the guest's start point as its landing spot.
- Frame rates have not been measured on physical devices yet (simulator and SwiftShader only).

## Risks
COPPA/kids review before any public social feature · "KIN" trademark search before launch · iOS
suspends background web views (the life sim catches up from timestamps) · venue Wi-Fi often blocks
client-to-client traffic (hence relay first) · creature designs must stay original (the moodboard has
Pokémon-adjacent silhouettes we deliberately do not copy).
