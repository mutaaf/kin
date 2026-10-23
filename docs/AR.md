# KIN in your real room (AR)

On every camera-capable device, KIN's default home is **the real room through the camera**, like
Pokémon GO's AR+: the KIN hops onto your floor or table at real scale (~14 cm), stays put as you
walk around it, looks at you, sits in its own contact shadow, is lit by your room, and hides
behind real furniture and people where the device can measure depth. The habitat diorama is the
fallback and the "Home" view.

## The capability ladder

Camera image and depth are **independent layers**, chosen from what the device really has and how
it's doing right now (`src/ar/tiers.ts`, pure, tested as a matrix in `tests/ar.tiers.test.ts`).

| Tier | When | What you get |
|---|---|---|
| **full** · AR · LiDAR | LiDAR device, camera allowed, cool enough | Live camera; classified room mesh (floor/table/seat/wall/…) as colliders and occluders; LiDAR scene-depth occlusion (furniture, pets, people); room light |
| **camera** · AR | ARKit without LiDAR (A12+), or WebXR on Android Chrome | Live camera; planes, raycast; people occlusion where supported (A12+); contact shadows on planes |
| **room** | LiDAR device with "Show camera" off, or too dark for video (smoothed, 4 s hysteresis) | No camera image: a softly lit miniature of your real room's mesh, tinted per surface kind, with full physics and occlusion. Opt-in or automatic fallback, never the default |
| **camera-view** · AR+ off | Camera but no room tracking (old devices, browsers without WebXR) | Live camera behind KIN, gyroscope turns the view; KIN on a virtual floor. Labelled; never claims to see real surfaces |
| **diorama** · Home | No camera, permission denied, unsupported, AR switched off | The habitat, unchanged |

Live conditions shed load in order, then drop a tier:

- **Heat** (`ProcessInfo.thermalState`): *serious* turns off scene depth and slows mesh updates; *critical* drops LiDAR devices to the camera tier and camera-only devices to the habitat.
- **Low Power Mode** and **battery < 10 %** (not charging): lighter features; low battery also drops to the camera tier.
- **Memory warning**: mesh and depth streaming stop, and the last mesh is kept.
- **Tracking limited**: the KIN holds its last surface and a gentle hint explains why ("slow down", "more light", "finding the room again").
- **Darkness** (ARKit ambient light < 60 lm for 4 s): room mode on LiDAR devices; a warning on others.

Tier changes fade through graphite (≈0.4 s) and never move the KIN when switching between ARKit
tiers, because tracking is kept and only the session's features change.

## Device matrix

| Devices | LiDAR | Default tier |
|---|---|---|
| iPhone 12 Pro / Pro Max and later Pro models (incl. **iPhone 15 Pro Max**), iPad Pro 2020 and later | yes | full |
| Other iPhones and iPads with A12 Bionic or later (XS/XR and later, iPad Air 3+, iPad mini 5+) | no | camera (with people occlusion) |
| A9–A11 iPhones/iPads (6s–X) | no | camera (planes only, no people occlusion) |
| Android with ARCore + Chrome WebXR | no | camera (WebXR) |
| Other phones and tablets with a camera | no | camera-view (AR+ off) |
| Desktop, devices without a camera | — | diorama |

The ladder decides from the capability checks themselves (`supportsSceneReconstruction`,
`supportsFrameSemantics`, camera presence and permission, WebXR support), never from the model
name. The model is reported for diagnostics only.

## How it works

ARKit can't be reached from a web view, and rewriting the creature natively would fork its look.
So the app is a hybrid:

- **Native** (`ios/App/App/ARPlugin.swift`, plugin `KINAR`): an `ARSCNView` renders the camera
  *behind* the transparent web view and runs `ARWorldTrackingConfiguration`. It uses planes,
  classified scene reconstruction, smoothed scene depth or person segmentation, and environment
  texturing. Each frame it calls `window.__kinAR.f([...])` with a compact array: projection, view,
  tracking and reason, lumens, kelvin. There's no JSON and no base64, and a frame is dropped if
  the previous one hasn't landed. Planes (≤ 2 Hz each), mesh chunks (tier-capped rate, decoded
  from base64 typed arrays), 128×96 occlusion depth (≤ 15 Hz) and recognised objects (≈ 1 Hz)
  arrive as separate messages.
- **Web** (`src/ar/`): `ArController` runs the ladder and owns the HUD (tier badge, "Show
  camera", shutter); `NativeArSession` drives the stage's AR camera.
  - **Placement:** the whole KIN world group is placed on the real surface at real scale, so the
    creature, toys, physics and brain keep their usual local units.
  - **Furniture occlusion:** LiDAR mesh renders depth-only.
  - **Depth occlusion:** a full-screen pass writes the measured depth (`gl_FragDepth`) before KIN
    draws.
  - **Lighting:** ARKit's light estimate sets the lights.
- **Real objects**: on-device saliency finds the most prominent object, Apple's on-device image
  classifier names it (restricted to that box, mapped to a friendly set: cup, plant, laptop,
  chair, book, shoe, ball, plush, cat, dog, lamp, …), and a raycast places it in the room. This
  gives one object at a time, about once a second, as `object-seen` events in KIN-local
  coordinates.
- **Physics**: `ArEnvironment` (`src/ar/types.ts`) exposes surfaces, mesh chunks,
  `surfaceHeightAt(x, z, fromY, step)` (the highest real surface a KIN can reach: on the table
  from above, never through it from below), raycast, and metres↔local conversions. The Realism
  track consumes it through `physics.setEnvironment(env)`.
- **AR+ photo**: the shutter renders one frame, and native composites the real camera frame
  underneath and opens the share sheet. Nothing is saved unless the player chooses to.

### Why occlusion works this way

Streaming full-resolution depth into WebGL every frame is too costly through a web view. The
static room is sent once as mesh (depth-only geometry, cheap and exact at furniture scale);
dynamic occluders (people, pets, moved chairs) come as a 128×96 8-bit depth image at ≤ 15 Hz,
about 16 KB a message. The cost is a frame or two of latency on moving people, which reads
naturally at a KIN's size.

### Known limits

- The camera image is rendered natively and the KIN in WebGL, so they can be up to one frame
  apart while you move fast. The KIN may appear to drift very slightly during quick pans, then
  settles.
- The KIN roams the area around where it was placed; following it across the room onto other
  surfaces comes with the physics environment hook.
- Real-object recognition names one prominent object at a time and doesn't track it continuously.

## Privacy

Camera frames are processed on the device and dropped; nothing is stored or sent anywhere. Person
segmentation is used only to hide KIN behind people (no faces, no identities). AR photos exist only
when the player taps the shutter, and leave the app only through the share sheet they choose.

## Verifying on a device

```sh
npm run ios:device                                   # build, install, launch
xcrun devicectl device process launch --console --terminate-existing \
  --device <udid> com.mutaafaziz.kin -- -KINARDemo   # AR diagnostics: logs every 5 s
```

`-KINARDemo` starts AR on its own and installs a counting sink in the page. It logs two lines every
5 s:

- `[KINAR] stats fps=… dropped=… build=…ms rt=…ms meshKB/s=… depthKB/s=… planes=… objects=…`
  (the native side)
- `[KINAR] web received (5 s): {"f":…, "avgFrameMs":…, "p":…, "m":…, "d":…, "o":…, "labels":[…]}`
  (what actually reached JS)

The first run asks for camera access on the phone.

## Files

`ios/App/App/ARPlugin.swift`, `ios/App/App/KINBridgeViewController.swift` (registration),
`ios/App/App/Info.plist` (camera and photo strings), `scripts/ios-add-ar.{sh,rb}` (idempotent
project wiring), `src/ar/{index,session,native,web,tiers,math,types}.ts`, `src/ar/ar.css`,
`src/render/stage.ts` (AR camera mode, `placeWorld`, room light, occluder layer),
`tests/ar.test.ts`, `tests/ar.tiers.test.ts`.
