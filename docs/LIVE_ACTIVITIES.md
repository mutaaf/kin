# Live Activities (iOS / iPadOS)

Your KIN on the Lock Screen and in the Dynamic Island: its face, what it's doing, the real sky,
soft need rings, its current thought, and **Feed · Play · Pet** (**Tuck in** at night) buttons
that work without opening the app.

## How it fits together

| Piece | Where | Role |
|---|---|---|
| `KINAttributes` | `ios/App/Shared/KINAttributes.swift` (app + extension) | Static identity (name, hue, seed) + `ContentState` (mood, doing, 5 needs, weather, mode home/away/asleep, friend, line, lastCared). Kept far under ActivityKit's 4 KB. |
| `KINStore` | `ios/App/Shared/KINStore.swift` (app + extension) | App Group `group.com.mutaafaziz.kin`: latest state, pending care, opt-out, `portrait.png`. `applyCare` = the creature's instant, humane reaction. |
| `CareIntent` | `ios/App/Shared/CareIntent.swift` (app + extension) | iOS 17 `LiveActivityIntent`. Runs in the app's process in the background: records the care for the web app, then updates the activity at once. |
| Views | `ios/App/Shared/KINActivityViews.swift`, `KINPortrait.swift` (**extension only**) | Lock Screen card, need rings, care buttons, the creature's face (snapshot, or a vector face from the hue). |
| `KINLiveActivity` | `ios/App/KINWidgets/` | `ActivityConfiguration`: Lock Screen + Dynamic Island (compact, minimal, expanded). |
| `LiveActivityPlugin` | `ios/App/App/LiveActivityPlugin.swift` | Capacitor plugin `KINLive`, registered by `KINBridgeViewController` (set in `SceneDelegate`). |
| Bridge | `src/platform/live.ts` | Typed wrapper, no-op on the web, pure helpers (`liveStateFrom`, `LiveThrottle`, `shouldRun`, `cleanCare`, `captureRegion`). The **integration lines for app.ts** are at the top of that file. |
| Project wiring | `scripts/ios-add-widget.sh` / `.rb` | Adds the `KINWidgets` target, shared sources, entitlements and embedding. Idempotent; `scripts/testflight.sh` runs it before archiving. |

## Automatic

No "start" button. The web app keeps calling `live.update(state)` (throttled to meaningful changes,
or once every 3 minutes). The plugin keeps exactly one activity for the hatched KIN:

- **Start** as soon as a state arrives while the app is in the foreground, and again on
  resign-active/become-active if none is running. iOS only lets an app *request* an activity from
  the foreground (or via push-to-start); from the background it can only *update*.
- **Modes** come from the state: `home` (ambient), `away` (visiting a friend's screen, ranked
  higher), `asleep` (night; the middle button becomes **Tuck in**).
- **Replace** an activity older than ~7.5 h with a fresh one (next time the app is foregrounded).
- **Stale date** 4 h after each update: the system dims it if nothing has refreshed it.
- **Respects** the system switch (Settings › KIN › Live Activities, i.e.
  `ActivityAuthorizationInfo().areActivitiesEnabled`) and an in-app opt-out (`live.setEnabled(false)`
  ends it at once).

### System limits to know
- An activity can be **active for up to 8 hours**; after that the system ends it, and it can stay on
  the Lock Screen for **up to 4 more hours** (12 h total). We restart before the 8 h mark whenever
  the app is opened.
- Updates without push are budgeted by the system; `NSSupportsLiveActivitiesFrequentUpdates` is set
  for future push updates (no push server today).
- `ContentState` must encode under **4 KB**: we send ~400 bytes (tested).
- Images: the portrait is read from the App Group (180×180 PNG); keep it small, the widget process
  has a tight memory budget.

## Care from the activity
Tapping **Feed** runs `CareIntent(verb: "feed")` in the background:
1. records `{ verb: "feed", at }` in the App Group (`live.pendingCare`);
2. updates every running activity with `KINStore.applyCare`: the need ring fills, mood becomes
   happy, a reaction line ("Nom. Thank you.", "Again! Again!", "Mmm, right there.", "Goodnight. Stay close?").

Next time KIN is visible, the web app calls `live.pendingCare()` and applies each verb to its care
model, exactly once. Copy is humane: care only ever fills a need; nothing nags or guilts.

## Deployment targets
- **App: iOS 15.0** (unchanged); everything Live-Activity is behind availability checks (`isSupported`
  reports `false` below iOS 17).
- **KINWidgets: iOS 17.0.** Interactive buttons need iOS 17's `LiveActivityIntent`; supporting
  16.2–16.x would mean a second, button-less layout for a few percent of devices.
- **Important:** SwiftUI views are compiled into the **extension only**. Compiling them into the app
  made the app binary hard-link `SwiftUICore` (iOS 18+), and it crashed at launch on iOS 15–17
  ("Library not loaded: SwiftUICore"). For the same reason the app's Debug builds set
  `ENABLE_DEBUG_DYLIB = NO`.

## Verifying in the simulator
Simulator screenshots don't include the Dynamic Island or the Lock Screen, and the headless
simulator can't be locked, so a DEBUG-only path is provided:

```sh
xcrun simctl launch <device> com.mutaafaziz.kin -KINLiveDemo YES [-KINLiveDemoCare feed|play|pet|tuck] [-KINLiveDemoMode asleep]
xcrun simctl launch <device> com.apple.Preferences     # background the app
xcrun simctl get_app_container <device> com.mutaafaziz.kin group.com.mutaafaziz.kin
```
- The demo starts an activity for a sample KIN, then (with `-KINLiveDemoCare`) runs the exact
  `CareIntent.perform()` the button runs.
- `live.debug` in the App Group's preferences records ActivityKit's view (authorized, activities,
  line, need values, pending care).
- In DEBUG, the **extension** writes `debug-lock-before/after.png` and `debug-island-*.png` into the
  App Group each time the system asks it to render the activity (exact views, rendered by the
  extension itself).

## Needs the user / unverified
- **Real device**: not tested on hardware yet (Lock Screen, Dynamic Island, button taps).
- **Button taps** were exercised by calling the intent's `perform()` directly; the system's tap →
  intent path is standard but unobserved here.
- **Signing**: the App Group `group.com.mutaafaziz.kin` and the extension's App ID
  `com.mutaafaziz.kin.widgets` should be registered automatically by automatic signing with
  `-allowProvisioningUpdates` and an App Manager API key. If the archive fails on provisioning,
  register both once at developer.apple.com (Identifiers › App Groups, then enable it on both App IDs).
