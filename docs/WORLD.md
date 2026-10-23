# KIN world: physics, matter, actors, care

A small, deep, systemic garden. Nothing here is a chore list. Every object is its own little
actor with its own controller. The KIN notices them, and you can pick almost anything up and
throw it. Care is a relationship that grows forever and never punishes.

## Layers
| Layer | File | Pure? | Notes |
|---|---|---|---|
| Care and progression model | `src/core/care.ts` | yes | needs, verbs, bond, tricks, collection, garden, surprises, seasons |
| Actor runtime | `src/world/actors.ts` | yes | scheduler with per-actor cadence, sleep/wake, event bus |
| Controllers | `src/world/controllers.ts` | yes | each object's brain, as functions over plain state |
| Physics | `src/world/physics.ts` | no (WASM) | Rapier 3D, lazy chunk, fixed 60 Hz step, sleeping bodies |
| Matter | `src/world/matter.ts` | mostly | jelly soft body, feather aero, puddles, snow, leaves |
| Views | `src/world/views.ts` | no | three.js meshes for every actor |
| Care UI | `src/ui/care.ts` + `care.css` | no | wordless need glyphs, contextual verbs, drag and drop, the Garden Book |
| Integration | `src/world/attach.ts` | no | the one entry `app.ts` calls |

## Actors (each with its own controller)
| Actor | Matter | Controller (what it wants) | Cadence |
|---|---|---|---|
| Ball | rubber, bouncy (e = 0.72) | after a long time ignored, it rolls itself toward the KIN; wobbles when hit | 4 Hz |
| Wood blocks ×2 | heavy, high friction | notice being knocked over → `toppled` event | 1 Hz, sleeps |
| Jelly | soft body: rigid core + per-vertex spring skin that squashes on the ground | jiggles from impacts; `squished` when sat on | 30 Hz while awake |
| Feather | aero particle: drag, flutter lift, the real wind | lifts in gusts, drifts and settles | per frame while airborne |
| Plant | fixed collider | grows with real daylight; drinks rain; droops (never dies) when dry; bears berries | 0.2 Hz |
| Berries | small rigid spheres once picked or fallen | ripen over real time, fall when overripe, can be eaten | 0.5 Hz |
| Puddles | flat reflective decals | grow in real rain, shrink in sun and warmth, ripple while raining | 1 Hz |
| Snow | ground tint + caps on the mushroom and nest + footprints | builds up while it snows, melts above 1 °C | 1 Hz |
| Leaves | instanced flutter particles | blow in on strong wind (always in autumn), tumble, settle, leave | per frame when present |
| Butterflies | boids (cohesion, separation, plant attraction, KIN avoidance) | day, dry, > 10 °C | 20 Hz |
| Fireflies | boids, glow pulse | night | 20 Hz |
| Ladybug | ground crawler | wanders; flies to the KIN's head if it's calm and nearby (befriending) | 10 Hz |
| Bird (daily surprise) | hopper | lands, pecks, drops a feather, flees if the KIN runs at it | 10 Hz when present |
| Finds | pebble / shell / seed / crystal | dug up while wandering; tap to keep | event-driven |
| Garden plots | soil + sprout meshes | seeds grow over real days into flowers that attract butterflies | 0.1 Hz |

Actors talk only through events (`thrown`, `landed`, `eaten`, `toppled`, `rain-started`,
`rain-stopped`, `found`, `befriended`, `fruit-ripe`…). The creature's helper (`attach.ts`) turns
events into noticing, looking and fetching. It never takes a decision away from the player.

## Care model (src/core/care.ts)
- **Needs**, 1 = content: fullness, fun, clean, rest, affection. They drift gently (fullness
  −0.06/h, fun −0.08/h awake…) and **floor at 0.15**. Catch-up after an absence is capped at
  48 h. Low needs only change behaviour and show a soft glyph; nothing gets sick or dies.
  Coming back after more than 6 h triggers a reunion.
- **Verbs:** feed, bath, brush, play, pet, tuck in, trick, plant, water, find. Each one returns
  the deltas plus bond XP. XP has diminishing returns within an hour (an anti-grind cap, not a
  paywall).
- **Bond:** infinite levels (level n needs 60·n^1.35 XP), with names up to "Kindred" and then
  numbered. Levels unlock tricks, garden plots and decor.
- **Tricks:** sit, spin, high five, fetch, roll, dance. Success = 0.12 + 0.8·skill·mood. Each
  attempt teaches (+0.05·(1−skill), more on success), so skill visibly improves with practice.
- **Collection:** a catalogue with transparent rarity. Finds are seeded by date + KIN seed, so
  each day has its own.
- **Garden:** plots grow from seed over about two real days, faster when watered (rain counts).
- **Daily surprises:** a pure function of (date, seed) that returns that day's events.
- **Seasons:** from the date and hemisphere. Leaf colour, flowers and firefly density follow them.

## Performance (measured 2026-10-22, M-series laptop, Node; see tests/world.perf.test.ts)
- **Rapier:** `@dimforge/rapier3d-compat@0.19.3`, a lazy chunk of 2.24 MB raw / **842 KB gzip**, loaded on idle after first paint. 0.21 was 4.3 MB / 1.67 MB gzip: it bundles soft-body FEM, which we don't use. A further ~25 % saving is possible by switching to the non-compat build plus `vite-plugin-wasm`, so the binary streams instead of being base64.
- **Physics step,** busy garden (12 dynamic bodies, scenery colliders, the KIN wading through them, a thrown ball): **0.10 ms/step.** Tuning that got it there: `lengthUnit = 0.2`, because toys are about 0.1 units and Rapier's tolerances scale with it, and `numSolverIterations = 2`. Before tuning, the same scene was 0.69 ms. Resting bodies sleep and cost about 0.02 ms for the whole world.
- **World update** (actors + matter + jelly skin + views) in the SwiftShader browser harness: about 1.2 to 2 ms per frame including physics. That is a CPU-only GPU emulator; real phones will be lower.
- **Code:** about 45 KB raw of world, care and UI code on top of the app, plus the lazy Rapier chunk.
- Fixed 1/60 s step, at most 4 substeps per frame, sleeping enabled, props spawned 5 mm above rest (a COLD GAS lesson). Actors tick at their own cadence, and asleep actors cost nothing. Particles (leaves, fireflies) are one draw call each.
