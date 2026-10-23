# KIN — Living Worlds, Crossing Screens

A tiny, original, autonomous creature that lives under your real sky, and can hop off your
screen onto a friend's. Web, iPhone and iPad from one codebase.

> Place two windows side by side. Your KIN notices the other one, pads toward the seam, glances
> back at you, hops across, and lands on the other screen, where that KIN reacts in its own way.
> Call it home and it comes back with a memory.

## Run it
```sh
npm run up         # install if needed, typecheck, run tests, start http://localhost:5188/kin/
npm run ios:sim    # build the native app and launch it on an iPhone and an iPad simulator
npm run ios        # open in Xcode (to run on a physical device)
npm run check      # typecheck + tests + production web build
```

### Demo the crossing (same device)
1. Open http://localhost:5188/kin/ and tap the cocoon twice to hatch it.
2. Open **Gather → Open a friend window**, and hatch the second KIN too.
3. Put the windows side by side and press **Visit**. The KIN walks to the facing edge, peeks back
   at you, and hops across. Whether the other window must accept depends on its "Who can visit" setting.
4. **Call home** brings it back. The Memory Book records what happened.

### Demo URL switches
`?wx=rain|storm|snow|wind|heat|cold|clear` overrides the weather. `?hour=6.5` sets the time of
day. `?debug` shows the brain's reasoning and fps. `?k=<slot>` picks which home (each window is
its own home).

## What's real today
See `docs/PLAN.md` for sprint status and the honest list of limitations. The phone-to-phone relay
is next. Engineering principles: `docs/ENGINEERING.md`. Original vision: `docs/blueprint/`.

## Layout
```
src/core        creature, genome, utility-AI brain (pure, no DOM)
src/protocol    versioned envelope + validation
src/session     KIN CROSS state machines (pure) + session shell (presence, clock sync)
src/transport   BroadcastChannel today; relay/WebRTC/native next
src/env         live sky: sun position, weather, coarse/precise location
src/render      three.js stage, procedural creature, animation, crossing choreography
src/ui          HUD; src/audio synthesized sfx; src/platform native haptics/status bar
ios/            Capacitor iOS/iPadOS shell
```
