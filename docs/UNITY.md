# KIN in Unity

## Core package: `unity/Packages/com.mutaafaziz.kin.core`

The engine-free heart of KIN, ported from the TypeScript in `src/` so the Unity client and the
web client behave identically and can cross with each other through the same Cloudflare relay.

| C# (namespace `Kin.Core`) | TypeScript source | What it is |
|---|---|---|
| `Rng` | `src/core/rng.ts` | mulberry32 + FNV-1a, **bit-exact** with the TS |
| `Genomes` | `src/core/genome.ts` | seed → look, traits, name, temperament |
| `Creature` | `src/core/creature.ts` | the durable record: remember, meet, catch-up |
| `Brain` | `src/core/brain.ts` | utility AI with explainable `why`, drift, arrival reactions |
| `Protocol`, `Msg` records | `src/protocol/messages.ts` | the versioned envelope, ingress validation, JSON |
| `Owner`, `Host`, `CrossTiming` | `src/session/cross.ts` | KIN CROSS state machines (pure, `now` is an input) |
| `Stitch` | `src/stitch/match.ts` | invisible stitch-swipe pairing |
| `Personas` | `src/core/persona.ts` | personality blend, growth, expression, persistence |
| `Care` | `src/core/care.ts` | humane needs, verbs, bond, garden, surprises, digs |
| `AiSchema` | `src/ai/schema.ts` | director card cleaning and thought/answer/analysis/snack validation |

Rules it keeps:
- `Runtime/Kin.Core.asmdef` has `noEngineReferences: true`: no `UnityEngine` anywhere, so the
  logic is testable without graphics or a network, exactly like the TS.
- C# 9 (what Unity 6 compiles). `Polyfills.cs` supplies `IsExternalInit` on .NET Standard 2.1.
- JSON uses **System.Text.Json**. Unity doesn't ship it: add `System.Text.Json.dll` (plus its
  dependencies) under `Assets/Plugins`, e.g. via NuGetForUnity. The asmdef already lists it as a
  precompiled reference.
- Wire format: camelCase keys, lowercase enum strings, `t` discriminator written first and read
  from any position, explicit `null`s (e.g. `"memory": null`). Times are `double` epoch ms
  (clock offsets make `startAt` fractional).
- Dates for daily surprises and digs are the player's **local** calendar (as in the TS); the
  persona's day key is **UTC** (also as in the TS).

## Tests (plain .NET, no Unity)

```sh
~/.dotnet/dotnet test unity/Core.Tests
```

- `CrossPropertyTests`: the happy path and the **1,000-run hostile-network property test**
  (20 % drops, 15 % duplicates, 400 ms jitter, crashes on both sides, random recalls and
  send-homes): after the network settles the KIN is in exactly one place. A mutant that never
  expires a host's lease is caught (seed 27, the same seed the TS suite catches it on).
- `ParityTests`: outputs pinned against the real TS, recorded in
  `Fixtures/ts-reference.json` by `Fixtures/ts-reference.gen.ts` (RNG streams, hashes, genomes,
  traits, names, brain decisions and scores, persona growth, care, surprises, digs, bond levels,
  stitch, AI validation, card cleaning). Regenerate after changing the TS core:
  `node_modules/.bin/esbuild unity/Core.Tests/Fixtures/ts-reference.gen.ts --bundle --platform=node --format=esm --outfile=/tmp/ref.mjs && node /tmp/ref.mjs > unity/Core.Tests/Fixtures/ts-reference.json`
- `ProtocolTests`: golden envelopes captured from the TS state machines during a full crossing
  parse in C# and re-serialise to the **same JSON string** (key order included); malformed,
  oversized and out-of-order inputs behave like the TS parser.
- `PersonaTests`, `CareTests`, `BehaviourTests`: ports of the TS behavioural suites.

## The MyKin app: `unity/MyKin` (Unity 6000.6.7f1, URP)

Everything is driven headlessly; no editor clicks are needed.

```sh
sh scripts/unity-batch.sh /tmp/u.log -executeMethod KinSetup.SetupProject      # URP, post, player, AR loaders
sh scripts/unity-stj.sh                                                         # vendor System.Text.Json for IL2CPP
sh scripts/unity-batch.sh /tmp/u.log -executeMethod KinBuilder.BuildAll         # creature: materials, Animator, prefab
sh scripts/unity-batch.sh /tmp/u.log -executeMethod KinSceneBuilder.BuildMain   # Assets/Scenes/Main.unity
GRAPHICS=1 sh scripts/unity-batch.sh /tmp/u.log -executeMethod KinProof.Capture        # creature proof renders
GRAPHICS=1 sh scripts/unity-batch.sh /tmp/u.log -executeMethod KinProof.CaptureHabitat # habitat proof renders
sh scripts/unity-ios.sh                                                         # iOS: export → LA install → sign → phone
sh scripts/unity-batch.sh /tmp/u.log -executeMethod KinBuild.WebGL              # unity/MyKin/Build/WebGL
```

| Piece | Where | Notes |
|---|---|---|
| Packages | `Packages/manifest.json` | URP 17.6, AR Foundation/ARKit/ARCore 6.6.2, Input System, Animation Rigging, Cinemachine, core via `file:` |
| Hero import | `Assets/Editor/KinArtImporter.cs` | generic rig, root motion on `root`, clip per take, loop flags from `kin_manifest.json` |
| Body | `Kin/Fur` shader | PBR fur + crystal glow/fresnel (brighter at night) + fluff rim + cheek blush |
| Fur | `Kin/FurShell` shader | 14 shells as extra materials on the same skinned renderer (free GPU skinning); gravity, wind, motion lag; crystals and eyes kept clear; `KinCreature.SetShells(n)` is the quality ladder |
| Eyes | `Kin/Eye` shader | concept iris, pupil dilation, look offset, catchlights; **blink, sleepy, worried and "^ ^" happy are drawn in the material** (the lid geometry is hidden: its seams showed) |
| Creature | `KinCreature.cs` | blinks, expressions, mouth/cheek/ear blendshapes, blush, fur force, head + eye look-at |
| Life | `KinLife.cs` | `Kin.Core.Brain` decides 4×/s → animation + wandering; tap = hello, stroke = petting |
| Habitat | `KinMeadow.cs`, `KinSky.cs` | instanced grass + glowing flowers, real-sun gradient sky with stars, fireflies at night |
| AR | `KinAR.cs` | session, plane placement, LiDAR mesh as depth-only occluder + colliders, people occlusion, light estimation → key light, tier ladder, habitat fallback |
| Live Activity | `Assets/Kin/Native/KINLive.cs` + iOS post-process | `KinBuild.AfterBuild` runs `scripts/ios-la-install.sh` on the Xcode export |

Environment nuances:
- `unity-batch.sh` defaults to `-nographics`; renders need `GRAPHICS=1` (a real Metal device).
- In editor scripts never use `??` on Unity objects (fake null): `GetComponent<T>() ?? Add…` returns a destroyed-looking object.
- The FBX's `_LOD0/_LOD1` mesh names make Unity create a `LODGroup` itself; reuse it.
- Without the App Group registered on Apple's side, signing fails; `unity-ios.sh` retries with `CODE_SIGN_ENTITLEMENTS=` (bundled portrait in the Live Activity).
