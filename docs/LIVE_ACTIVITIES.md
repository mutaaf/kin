# Live Activities (iOS / iPadOS)

Your KIN on the Lock Screen, in StandBy and in the Dynamic Island: its face, what it's doing, the
real sky, its current thought, its needs, and **Feed · Play · Pet** (**Tuck in** at night) buttons
that work without opening the app.

Everything lives in **`ios/LiveActivity/`**, self-contained, so the same Live Activity drops into
today's Capacitor app and into Unity's exported Xcode project.

## Design

Apple-design-award restraint; the creature is the hero.

- **One accent** (mint `#6EE5CA`) on graphite (dark) or porcelain glass (light). Light mode uses a
  deeper mint and deeper need colours for text, so words keep AA contrast.
- **Portrait first.** A round crop of *this user's* creature (snapshot from the app) with a hairline
  mint rim and a soft halo; until a snapshot exists, the bundled portrait made from the hero art
  (`Widget/Assets.xcassets/KINPortraitDefault`). A tiny shoulder badge shows state: asleep (moon),
  visiting (walking), just cared for (heart, 15 min).
- **Type:** name in SF Pro Rounded semibold 17, status in mint, temperature with
  `.numericText` transitions, the thought in a refined serif italic that cross-fades when it changes.
- **Needs** as five slim segments; a word appears only when one is low ("Peckish", "Sleepy",
  "Wants a cuddle"). No rings, no numbers.
- **One primary action:** of Feed · Play/Tuck in · Pet, only the care the KIN most wants is filled;
  the others are quiet glass. Lock Screen uses pills, the Dynamic Island uses 40 pt circles.
- **Dynamic Island:** compact leading = the portrait; compact trailing = one tiny ring in a low
  need's colour, else the temperature in mint; minimal = the portrait with a wellbeing arc.
- **Always-on / StandBy** (`isLuminanceReduced`): glows off, colours dimmed, buttons hidden.
- **Accessibility:** VoiceOver labels on needs, weather, buttons and the thought; Dynamic Type within
  ActivityKit's limits.
- Haptics: the system gives button taps its own press feedback; an intent running in the background
  can't play custom haptics.

Reviewed renders of every presentation: `/private/tmp/claude-501/la2/r2/` (see "Verifying").

## How it fits together

| Piece | File (`ios/LiveActivity/…`) | Compiled into |
|---|---|---|
| `KINAttributes` | `Shared/KINAttributes.swift` | app (+ native target) + widget. Identity + `ContentState` (~400 bytes; limit 4 KB). |
| `KINStore` | `Shared/KINStore.swift` | app (+ native target) + widget. App Group `group.com.mutaafaziz.kin`: state, pending care, opt-out, `portrait.png`; `applyCare` = the creature's instant, humane reaction. |
| `CareIntent` | `Shared/CareIntent.swift` | app + widget. iOS 17 `LiveActivityIntent`, runs in the app's process: records the care, updates the activity at once. |
| `KINLiveEngine` | `Engine/KINLiveEngine.swift` | native target. Engine-agnostic core: automatic start/replace/update, snapshot, pending care, opt-out, DEBUG demo. |
| Views | `Widget/*.swift`, `Widget/Assets.xcassets` | **widget only**. Design system (`KINPortrait.swift`), every presentation (`KINActivityViews.swift`), configuration + DEBUG renderer (`KINLiveActivity.swift`). |
| Capacitor bridge | `ios/App/App/LiveActivityPlugin.swift` | Capacitor app only. JS `KINLive.*` → engine. Registered by `KINBridgeViewController`. |
| Unity bridge | `Unity/KINLiveUnity.swift` + `Unity/KINLive.cs` | Unity only. C ABI (`@_cdecl`) → engine; C# wrapper with `[DllImport("__Internal")]`. |
| Web bridge | `src/platform/live.ts` | Typed wrapper, no-op on the web. Integration lines for app.ts at its top. |
| Installer | `scripts/ios-la-install.sh` / `.rb` | Adds all of the above to any Xcode project. Idempotent (a second run leaves the project byte-identical). `scripts/ios-add-widget.sh` still works (delegates). |

SwiftUI views compile into the **widget extension only**: in the app they made the binary hard-link
`SwiftUICore` (iOS 18+), crashing it at launch on iOS 15–17. The installer enforces this and sets
`ENABLE_DEBUG_DYLIB = NO` for the same reason.

## Installing into a project

```sh
# Capacitor (default; also run by scripts/testflight.sh and scripts/ios-device.sh paths)
sh scripts/ios-la-install.sh

# Unity export (run after every "Build" from Unity; --copy vendors the folder into the export)
sh scripts/ios-la-install.sh --project <export>/Unity-iPhone.xcodeproj --app-target Unity-iPhone \
   --native-target UnityFramework --bridge unity --copy
```

What it does: groups `KINLiveActivity/{Shared,Engine,Widget,Unity}`; app target + Shared;
native target + model/store + engine (+ Unity bridge); creates/updates the `KINWidgets` extension
(iOS 17, bundle id `<app id>.widgets`, the app's team, matching versions, asset catalog); adds the App
Group to both targets' entitlements (creating `<App>/KINApp.entitlements` if the app has none, as in
Unity exports); sets `NSSupportsLiveActivities` in the app's Info.plist; declares the App Groups
capability so automatic signing registers it; embeds the extension; removes references to files that
moved.

### Unity specifics
- Unity's C# calls native symbols that must live in **`UnityFramework`**, so the engine, model/store
  and `KINLiveUnity.swift` go there (`--native-target UnityFramework`).
- `CareIntent` goes in the **app** target (`Unity-iPhone`): iOS runs a `LiveActivityIntent` in the
  app's process. The model/store compile into both modules; ActivityKit matches `KINAttributes` by
  type name, so the two copies interoperate.
- Put `Unity/KINLive.cs` in the Unity project's `Assets/Scripts`. Usage:
  `KINLive.Activate()` at startup; `KINLive.Update(state)` when the KIN changes (throttle like
  `LiveThrottle` in live.ts: meaningful changes now, else ~every 3 min); on resume
  `foreach (var c in KINLive.PendingCare()) careModel.Apply(c.verb, c.at)`;
  `KINLive.SetSnapshot(portrait.EncodeToPNG())` after hatch.
- **Unverified:** Unity isn't installed and licensed on this Mac yet, so the Unity path (installer
  against a real `Unity-iPhone.xcodeproj`, the C ABI, the C# wrapper) has not been compiled. The
  Capacitor path is built and rendered.

## Automatic

No "start" button. The host keeps calling `update(state)`. The engine keeps exactly one activity:
- **Start** as soon as a state arrives in the foreground, and on resign/become-active if none runs.
  iOS only lets an app *request* an activity from the foreground (or push-to-start).
- **Modes**: `home`, `away` (visiting a friend's screen, ranked higher), `asleep` (night; the middle
  button becomes **Tuck in**).
- **Replace** an activity older than ~7.5 h (the system ends them at 8 h).
- **Stale date** 4 h after each update.
- **Respects** the system switch and an in-app opt-out (`setEnabled(false)` ends it at once).

### System limits
- Active for up to **8 h**, then it may linger on the Lock Screen up to **4 h** more (12 h total).
- Updates without push are budgeted by the system; no push server today.
- `ContentState` under **4 KB** (we send ~400 bytes). Portrait ≤ 180×180 PNG (widget memory budget).

## Care from the activity
Tapping **Feed** runs `CareIntent(verb: "feed")` in the background: records `{ verb, at }` in the App
Group, then updates every running activity with `KINStore.applyCare` (the need fills, mood turns
happy, a reaction line: "Nom. Thank you.", "Again! Again!", "Mmm, right there.", "Goodnight. Stay
close?"). Next time the app is visible, `pendingCare()` hands the verbs to the care model exactly
once. Care only ever fills a need; nothing nags or guilts.

## Deployment targets
- **App: iOS 15.0**, Live Activity code behind availability checks.
- **KINWidgets: iOS 17.0** (interactive buttons need `LiveActivityIntent`).
- **Apple Watch Smart Stack:** watchOS 11 mirrors the activity from the compact presentations. A
  dedicated `.small` layout needs `supplementalActivityFamilies`, which is iOS 18-only and can't be
  conditionally applied in an iOS 17 extension (`WidgetBundleBuilder` has no `if #available`); it's
  left out rather than raising the extension to iOS 18.

## Verifying in the simulator
Simulator screenshots don't include the Lock Screen or Dynamic Island, so in DEBUG the **extension**
renders a contact sheet of every presentation whenever the system asks it to draw the activity:

```sh
xcrun simctl launch <device> com.mutaafaziz.kin -KINLiveDemo YES [-KINLiveDemoMode asleep|away] [-KINLiveDemoCare feed]
open "$(xcrun simctl get_app_container <device> com.mutaafaziz.kin group.com.mutaafaziz.kin)"
# debug-sheet.png: Now / After Feed / Night / Visiting × dark + light, StandBy dimmed,
#                  expanded islands, compact + minimal pills
# debug-lock-dark.png, debug-lock-light.png, debug-island.png
```
`live.debug` in the App Group's preferences records ActivityKit's view of the world.

## Needs the user / unverified
- **Real device:** Lock Screen, Dynamic Island and taps through the system haven't been observed on
  hardware; renders come from the extension itself in the simulator.
- **App Group signing:** until the App Group is registered once (Xcode › Signing & Capabilities, or the
  TestFlight API key), `scripts/ios-device.sh` builds without it; the activity then shows the bundled
  portrait instead of the user's own creature, and care still works (the intent runs in the app).
