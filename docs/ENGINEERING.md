# KIN engineering principles

Each principle comes from people whose ideas hold up. Each one is tied to where it's enforced in
this repo, so it stays a rule instead of a slogan.

| Principle | Whose idea | Where it lives |
|---|---|---|
| **State the invariant, then prove it under adversity.** A KIN is never lost or duplicated. | Dijkstra / Hoare (invariants), Lamport (safety vs liveness) | `src/session/cross.ts` header; `tests/cross.property.test.ts` runs 1,000 crossings with 20% drop, 15% duplication, 400 ms jitter, and crashes on both sides |
| **One owner per fact.** The home device owns the creature; the host holds only a time-bound lease. | Lamport, leases (Gray & Cheriton '89) | `Owner` / `Host` in `cross.ts`; the host never persists a guest |
| **Idempotent, retried messages beat "reliable" transports.** Retry the current step; answer duplicates, don't redo them. | End-to-end argument (Saltzer, Reed, Clark '84) | `Owner.retry`, `Host.done` tombstones |
| **Functional core, imperative shell.** Pure state machines take `now` as an input; timers and I/O live outside. | Backus, Hoare (CSP); "Boundaries" (Bernhardt) | `cross.ts` has no timers; `session.ts` is the only shell; `tests/boundaries.test.ts` enforces it |
| **Determinism from seeds.** Same seed → same creature on every device, and replayable decisions. | Knuth (TAOCP vol. 2) | `core/rng.ts`, `core/genome.ts`; brain variation is seeded per tick |
| **Depend on interfaces, substitute freely.** Tabs, relay, WebRTC and native radios are one `Transport`. | Liskov (substitution), Parnas (information hiding) | `src/transport/transport.ts` |
| **Clocks are estimates.** Schedule a shared moment in the future using the median offset; hide the residual error (cross the seam mid-air). | Lamport ('78), Cristian ('89), NTP (Mills) | `session.ts` clock.ping/pong; `T.LEAD`; `render/choreo.ts` |
| **Measure, then optimize.** Fix only what the profile shows. Degrade resolution before you drop frames. | Knuth ("premature optimization"), Lampson ("Hints for Computer System Design") | `Stage.govern`; the `?debug` HUD shows fps and the brain's reasons |
| **Keep it simple, keep it explainable.** Utility AI with a visible "why", not an opaque model every frame. | Lampson, Hoare ("obviously no deficiencies") | `core/brain.ts` returns `why[]` + scores |
| **Least privilege, least data.** No account, pseudonymous IDs, coarse location by default, schema check at every ingress. | Saltzer & Schroeder ('75) | `protocol/messages.ts parseEnvelope`, `env/sky.ts` (~11 km rounding), `main.ts` Web Lock |
| **Worse is better, ship the vertical slice.** One magical crossing before ten half-built pillars. | Gabriel, Brooks ("plan to throw one away") | `docs/PLAN.md` sprint gates |

## Performance budget (measure on real devices; these are targets)
- First creature pixel: under 2 s on a warm launch. Brain: 4 Hz. Simulation: pure and cheap. Render: 60 fps target, 30 fps floor.
- Draw calls: the diorama plus creatures are mostly shared geometry (one sphere reused for every soft part). Grass is a single `InstancedMesh`. Rain and snow are one buffer each.
- Pixel ratio is capped at 2, and `Stage.govern` steps it down after 1.5 s of slow frames.
- three.js is the main bundle cost (~600 kB min, ~150 kB gz). Babylon is reserved for Sports/Arena and will be lazy-loaded so it never touches Home or Crossing.
