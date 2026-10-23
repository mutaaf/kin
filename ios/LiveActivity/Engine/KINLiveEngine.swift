// The engine-agnostic core of KIN's Live Activity. Both host bridges are thin wrappers over this:
//   • Capacitor (today):  ios/App/App/LiveActivityPlugin.swift  → JS `KINLive.*`
//   • Unity (next):       ios/LiveActivity/Unity/KINLiveUnity.swift → C# [DllImport("__Internal")]
//
// Automatic by design. The host keeps handing over its latest state (`update`); the engine keeps
// exactly one activity alive for the hatched KIN, without the player asking:
//   • start: as soon as a state arrives while the app is in the foreground (iOS only allows
//     requesting an activity from the foreground), and again at resign-active if none is running
//   • replace: an activity older than ~7.5 h is ended and restarted (the system ends them at 8 h)
//   • background: updates continue (allowed); the latest state is also kept in the App Group, so
//     care done from the activity's buttons reacts immediately (see Shared/CareIntent.swift)
// Respects the system Live Activities switch and an in-app opt-out (`setEnabled`).

import ActivityKit
import Foundation
import UIKit

@available(iOS 16.1, *)
public final class KINLiveEngine: NSObject {
    public static let shared = KINLiveEngine()
    private static let maxAge: TimeInterval = 7.5 * 3600
    private var observing = false

    /// Call once at launch (the bridges do). Starts the automatic lifecycle.
    public func activate() {
        guard !observing else { return }
        observing = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(lifecycle), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(lifecycle), name: UIApplication.didBecomeActiveNotification, object: nil)
        #if DEBUG
        runDemoIfAsked()
        #endif
    }

    @objc private func lifecycle() {
        if #available(iOS 17.0, *) { Task { _ = await Self.ensure(force: false) } }
    }

    // MARK: API (identical for every host)

    public static func isSupported() -> [String: Any] {
        if #available(iOS 17.0, *) {
            return [
                "supported": true,
                "authorized": ActivityAuthorizationInfo().areActivitiesEnabled,
                "enabled": KINStore.enabled,
                "running": Activity<KINAttributes>.activities.count,
            ]
        }
        return ["supported": false, "authorized": false, "enabled": false, "running": 0]
    }

    /// Store the state and make sure an activity shows it (start, replace or update).
    public static func start(_ payload: [String: Any], restart: Bool) async -> Bool {
        guard #available(iOS 17.0, *), let (attrs, state) = parse(payload) else { return false }
        KINStore.attributes = attrs
        KINStore.state = state
        return await ensure(force: restart)
    }

    /// The hot path: called whenever the host's state changes. Starts automatically in the foreground.
    public static func update(_ payload: [String: Any]) async -> Bool {
        guard #available(iOS 17.0, *), let (attrs, state) = parse(payload) else { return false }
        KINStore.attributes = attrs
        KINStore.state = state
        let foreground = await MainActor.run { UIApplication.shared.applicationState == .active }
        return foreground ? await ensure(force: false) : await push(state)
    }

    public static func end() async {
        if #available(iOS 17.0, *) { await endAll() }
    }

    /// A small portrait of the user's own creature for the activity (any image data; stored ≤180 px).
    public static func setSnapshot(_ data: Data) -> Bool {
        guard let img = UIImage(data: data), let url = KINStore.portraitURL else { return false }
        let side: CGFloat = 180 // the widget process has a tight memory budget
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        let small = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { _ in
            // Aspect-fill into the square.
            let s = max(side / img.size.width, side / img.size.height)
            let w = img.size.width * s, h = img.size.height * s
            img.draw(in: CGRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
        }
        return (try? small.pngData()?.write(to: url, options: .atomic)) != nil
    }

    /// Care done from the activity since the last call, handed over exactly once.
    public static func pendingCare() -> [[String: Any]] {
        KINStore.takePendingCare().map { ["verb": $0.verb, "at": $0.at] }
    }

    public static func setEnabled(_ on: Bool) async {
        KINStore.enabled = on
        if #available(iOS 17.0, *) {
            if on { _ = await ensure(force: false) } else { await endAll() }
        }
    }

    // MARK: ActivityKit

    /// Exactly one current activity for the stored KIN. Foreground only for starts.
    @available(iOS 17.0, *)
    @discardableResult
    static func ensure(force: Bool) async -> Bool {
        guard KINStore.enabled, ActivityAuthorizationInfo().areActivitiesEnabled,
              let attrs = KINStore.attributes, let state = KINStore.state else {
            if !KINStore.enabled { await endAll() }
            return false
        }
        let startedAt = KINStore.defaults.double(forKey: "live.startedAt")
        let tooOld = startedAt > 0 && Date().timeIntervalSince1970 - startedAt > maxAge
        let current = Activity<KINAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
        // One KIN, one activity: anything else (another seed, too old, forced) is replaced.
        let keep = current.first { $0.attributes.seed == attrs.seed && $0.attributes.name == attrs.name && !tooOld && !force }
        for a in current where a.id != keep?.id {
            await a.end(nil, dismissalPolicy: .immediate)
        }
        if let keep {
            await keep.update(content(state))
            return true
        }
        do {
            _ = try Activity.request(attributes: attrs, content: content(state), pushType: nil)
            KINStore.defaults.set(Date().timeIntervalSince1970, forKey: "live.startedAt")
            return true
        } catch {
            // Not in the foreground, or the system said no (limits, disabled): try again next time.
            NSLog("[KINLive] request failed: %@", String(describing: error))
            return false
        }
    }

    /// Background-safe: update the running activity, never start one.
    @available(iOS 17.0, *)
    static func push(_ state: KINAttributes.ContentState) async -> Bool {
        let all = Activity<KINAttributes>.activities
        for a in all { await a.update(content(state)) }
        return !all.isEmpty
    }

    @available(iOS 17.0, *)
    static func endAll() async {
        for a in Activity<KINAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
        KINStore.defaults.removeObject(forKey: "live.startedAt")
    }

    @available(iOS 16.2, *)
    static func content(_ s: KINAttributes.ContentState) -> ActivityContent<KINAttributes.ContentState> {
        ActivityContent(state: s, staleDate: Date().addingTimeInterval(4 * 3600), relevanceScore: relevance(s))
    }

    /// Away visits and low needs rank higher when several apps have activities.
    static func relevance(_ s: KINAttributes.ContentState) -> Double {
        if s.mode == "away" { return 90 }
        return s.lowest != nil ? 70 : 40
    }

    // MARK: parsing (the same payload shape for JS and C#: see src/platform/live.ts LiveState)

    static func parse(_ p: [String: Any]) -> (KINAttributes, KINAttributes.ContentState)? {
        guard let name = p["name"] as? String, !name.isEmpty else { return nil }
        let num = { (k: String) -> Double? in (p[k] as? NSNumber)?.doubleValue }
        let clamp = { (k: String) in max(0, min(1, num(k) ?? 0.8)) }
        let str = { (k: String, d: String, max: Int) in String(((p[k] as? String) ?? d).prefix(max)) }
        let attrs = KINAttributes(
            name: String(name.prefix(16)), hue: num("hue") ?? 160, accentHue: num("accentHue") ?? 200,
            seed: (p["seed"] as? NSNumber)?.intValue ?? 0
        )
        let state = KINAttributes.ContentState(
            mood: str("mood", "content", 16),
            doing: str("doing", "at home", 40),
            hunger: clamp("hunger"), play: clamp("play"), rest: clamp("rest"), clean: clamp("clean"), affection: clamp("affection"),
            weather: str("weather", "sunny", 12),
            tempC: num("tempC") ?? 20,
            mode: str("mode", "home", 8),
            friend: (p["friend"] as? String).map { String($0.prefix(16)) },
            line: str("line", "", 120),
            lastCared: num("lastCared"),
            fahrenheit: (p["fahrenheit"] as? Bool) ?? false
        )
        return (attrs, state)
    }

    // MARK: debug demo (simulator verification without a host integration)

    #if DEBUG
    /// `xcrun simctl launch <device> <bundle> -KINLiveDemo YES [-KINLiveDemoMode asleep|away] [-KINLiveDemoCare feed]`
    private func runDemoIfAsked() {
        guard #available(iOS 17.0, *), UserDefaults.standard.bool(forKey: "KINLiveDemo") else { return }
        KINStore.attributes = KINAttributes(name: "Lumi", hue: 165, accentHue: 172, seed: 28)
        var s = KINAttributes.ContentState(
            mood: "curious", doing: "watching the rain", hunger: 0.32, play: 0.72, rest: 0.8, clean: 0.9, affection: 0.66,
            weather: "rainy", tempC: 14, mode: "home", friend: nil,
            line: "Pitter-patter on the mushroom. Very cozy under here.", lastCared: nil, fahrenheit: true
        )
        switch UserDefaults.standard.string(forKey: "KINLiveDemoMode") {
        case "asleep":
            s.mode = "asleep"; s.weather = "starry"; s.mood = "sleepy"; s.doing = "dozing in the nest"; s.rest = 0.35
            s.line = "The plant is glowing. I think the stars are doing the same."
        case "away":
            s.mode = "away"; s.friend = "Nox"; s.mood = "happy"; s.doing = "visiting"; s.weather = "sunny"; s.tempC = 24
            s.line = "Nox has the best garden. Back soon!"
        default: break
        }
        KINStore.state = s
        let care = UserDefaults.standard.string(forKey: "KINLiveDemoCare")
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            let ok = await Self.ensure(force: true)
            Self.debugReport("start ok=\(ok)")
            if let care, KINStore.verbs.contains(care) {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                // Exactly what CareIntent.perform() (the activity's button) does. Inlined because in
                // Unity builds the intent lives in the app target, not beside this engine.
                KINStore.recordCare(care)
                for a in Activity<KINAttributes>.activities {
                    let next = KINStore.applyCare(care, to: a.content.state, name: a.attributes.name)
                    KINStore.state = next
                    await a.update(Self.content(next))
                }
                Self.debugReport("after \(care)")
            }
        }
    }

    @available(iOS 17.0, *)
    static func debugReport(_ tag: String) {
        let acts = Activity<KINAttributes>.activities.map { "\($0.id.prefix(8)) \($0.activityState) line=\($0.content.state.line) hunger=\($0.content.state.hunger)" }
        let line = "\(tag) authorized=\(ActivityAuthorizationInfo().areActivitiesEnabled) activities=\(acts.count) \(acts.joined(separator: " | "))"
        var log = KINStore.defaults.stringArray(forKey: "live.debug") ?? []
        log.append(line)
        KINStore.defaults.set(Array(log.suffix(20)), forKey: "live.debug")
    }
    #endif
}
