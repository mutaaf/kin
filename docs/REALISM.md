# Realism: bodies, feet and contact

The rule: **nothing skates, floats or passes through anything.** A KIN's feet plant and stay put,
its body is a real character in the physics world, and every object rests on the surface under it.

## Feet: a procedural gait with planted feet
`src/render/creature/gait.ts` (pure, no graphics; `tests/realism.test.ts`).

- **Feet are separate from the body.** The back feet used to be baked into the body's mesh, so
  they slid along with it. They are now their own meshes (`parts.feet`, children of the root),
  placed in world space every frame.
- **Stance and swing.** A planted foot keeps its exact world position (the tests assert zero
  movement) while the body moves over it. A foot steps when its hip has outrun it by a stride, or
  when the body has turned (turning in place steps the feet). Walk alternates feet, so one is
  always down. Fast or bouncy KIN hop instead, with both feet together.
- **Short, quick steps.** Cadence rises with speed, so the stride stays about a third of the body
  length. Feet never trail more than about 0.12 units at a walk.
- **Landing spots are predicted.** A foot lands where its hip will be half a stride from now, and
  is retargeted during the swing.
- **Uneven ground.** Each landing spot's height comes from `groundAt`, so feet plant on a block,
  a stepping stone, the nest rim, or a real AR table. Stepping up, the foot lifts before it
  travels over the edge; stepping down, it travels out before it drops. A swinging foot is never
  below the surface under it.
- **The body rides its feet.**
  - **Height:** from the ground under the body and the planted feet.
  - **Bob:** it rises as a foot swings through.
  - **Waddle:** it rolls over the supporting foot.
  - **Slope:** pitch and roll follow the terrain.
  - **Lean:** forward into acceleration, back when braking, and into turns.
  - **Touchdowns:** each landing gives a small squash.
- **Airborne, spinning or rolled over**, the feet ride with the body, then re-plant on landing.

## The body as a physical character
`src/world/physics.ts`.

- **Collider.** The KIN is a kinematic body moved by Rapier's character controller (`moveKin`).
  - **Shape:** a **flat-based cylinder** as wide as the head. A capsule's round bottom meets a
    ledge edge at a steep angle and the controller won't step up (measured: stuck at a 6 cm
    stone).
  - **Width:** head-width, so the head can't enter the mushroom cap.
- **Movement.** It slides along obstacles, steps up ledges up to `KIN_STEP` (7.5 cm), and stops
  at an 18 cm block.
- **Pushing.** It shoves toys with impulses scaled by `KIN_MASS`. The ball rolls ahead of it,
  while a heavy stone barely moves.
- **Passable scenery.** `addStatic(..., { passable: true })` (the nest's woven rim) is ignored by
  the body but stood on by the feet, so it climbs into bed over the rim.
- **Getting hit.** A thrown toy that arrives fast and heading at it triggers `view.bumped()`: a
  stagger away (through the controller), a squash, ears, a look at what hit it, and a "hey".
- **Giving up.** Blocked walking ends after 0.7 s rather than walking in place forever.
- **Fetch and eating** walk through the same path (`view.walkToward`). Their approach distances
  match the real contact distances: ball 0.44, berry 0.38.

## Objects conform
- **Contact shadows.** Every physical object gets one, in a single instanced draw
  (`views.ContactShadows`). The shadow is found by a ray down, so it lies on whatever is below.
  It's tight and dark in contact, and wider and fainter in the air.
- **Find colliders match what you see.** A flat pebble or shell is a cylinder and rests flat
  instead of rolling like a marble. Seeds and acorns are balls. Previously every find was a ball.
- **Find positions are exact.** Views anchored at their base are placed at the body's *rotated*
  bottom. Previously a fixed offset made finds hover 1.5 cm and pivot wrongly when tumbling.
- **Held and carried toys** are clamped above the surface under them, so they can't be pushed
  into the ground. Fetch carries the toy at `view.mouthWorld()`, just in front of the lips.
- **Eating** brings the mouth down to the food: `view.reach(point)` tips the head down further
  than a normal look and leans the body. A new script straightens it up, so an interrupted meal
  never leaves it bent.

## Environment API for AR
`src/world/env.ts` and `Physics.setEnvironment(env)`:

```ts
interface ArEnvironment {
  planes: { id; position; rotation: [x,y,z,w]; extent: [w, d]; classification? }[]; // normal = local +Y
  meshes: { id; positions; indices; faceClass? }[];   // world units, e.g. LiDAR scene meshes
  mode?: 'augment' | 'replace';  // replace: drop the lawn, garden walls and scenery colliders
}
physics.setEnvironment(env | null)           // null restores the diorama
physics.groundAt(x, z, fromY = 0.6) → y      // -Infinity over a void in 'replace' mode
physics.raycastDown({x, y, z}) → { y, normal, on: bodyId | 'env:<id>' | 'scenery' | 'ground' } | null
physics.kinFits(x, z)                        // can the KIN stand there?
```

The world wires `view.groundAt` and `view.mover` to these when physics loads, so the same
foot-planting works on the lawn and on real surfaces. Queries are re-indexed after scenery or AR
surfaces change, with a zero-length step; Rapier only indexes colliders during a step.

## Cost
Measured by `tests/realism.perf.test.ts` (Node, M-series): about **0.10 ms per frame** for the
gait, ground rays, character move and physics step together, in a busy garden. The character move
is 0.021 ms and the physics step 0.015 ms, against the ~16 ms phone frame. Not yet measured on a
device.

## Verify
- `npm test`: the gait rules, character physics, environment and cost tests.
- `/kin/tools/realism.html?scene=walk|step|mushroom|ball|berry|nest|turn&zoom=200`: a
  deterministic harness on its own clock. Its overlay marks planted feet in mint and swinging feet
  in amber, shows a footprint trail (planted feet never slide), and draws the collider ring.
  Playwright drives `window.__realism.start()` / `.advance(ms)`.

## Not done yet
- Petting doesn't press the fur where the finger is.
- The blanket doesn't drape (no cloth).
- The tail and ears aren't collision-tested against objects. The collider covers the head and
  body only.
- Visiting KIN (`guests` in `app.ts`) are not wired to the physics hooks. Set their `groundAt` and
  `mover` like the main view.
- Rapier has no rolling resistance; angular damping stands in for it.
