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
