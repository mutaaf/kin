// KINLive: the bridge between the web app and iOS Live Activities (ActivityKit).
//
// Automatic by design. The web app keeps handing the plugin its latest state (`update`); the
// plugin keeps exactly one activity alive for the hatched KIN, without the player asking:
//   • start: as soon as a state arrives while the app is in the foreground (iOS only allows
//     requesting an activity from the foreground), and again at resign-active if none is running
//   • replace: an activity older than ~7.5 h is ended and restarted (the system ends them at 8 h)
//   • background: updates continue (allowed); the latest state is also kept in the App Group,
//     so care done from the activity's buttons reacts immediately (see Shared/CareIntent.swift)
// Respects the system Live Activities switch and an in-app opt-out (`setEnabled`).

import ActivityKit
import Capacitor
import Foundation
import UIKit

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "KINLive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingCare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
    ]

    private static let maxAge: TimeInterval = 7.5 * 3600

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(resignActive), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        #if DEBUG
        NSLog("[KINLive] plugin loaded, demo=%d", UserDefaults.standard.bool(forKey: "KINLiveDemo") ? 1 : 0)
        runDemoIfAsked()
        #endif
    }

    // MARK: JS API

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            call.resolve([
                "supported": true,
                "authorized": ActivityAuthorizationInfo().areActivitiesEnabled,
                "enabled": KINStore.enabled,
                "running": Activity<KINAttributes>.activities.count,
            ])
        } else {
            call.resolve(["supported": false, "authorized": false, "enabled": false, "running": 0])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { return call.resolve(["running": false]) }
        guard let (attrs, state) = Self.parse(call) else { return call.reject("bad state") }
        KINStore.attributes = attrs
        KINStore.state = state
        Task {
            let ok = await Self.ensure(force: call.getBool("restart") ?? false)
            call.resolve(["running": ok])
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { return call.resolve(["running": false]) }
        guard let (attrs, state) = Self.parse(call) else { return call.reject("bad state") }
        KINStore.attributes = attrs
        KINStore.state = state
        Task {
            // In the foreground this also starts one if none is running (automatic).
            let foreground = await MainActor.run { UIApplication.shared.applicationState == .active }
            let ok = foreground ? await Self.ensure(force: false) : await Self.push(state)
            call.resolve(["running": ok])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { return call.resolve() }
        Task {
            await Self.endAll()
            call.resolve()
        }
    }

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve(["saved": false]) }
        guard let b64 = call.getString("png")?.replacingOccurrences(of: "data:image/png;base64,", with: ""),
              let data = Data(base64Encoded: b64), let img = UIImage(data: data),
              let url = KINStore.portraitURL else { return call.resolve(["saved": false]) }
        // Keep it small: the widget process has a tight memory budget.
        let side: CGFloat = 180
        let r = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }())
        let small = r.image { _ in img.draw(in: CGRect(x: 0, y: 0, width: side, height: side)) }
        let ok = (try? small.pngData()?.write(to: url, options: .atomic)) != nil
        call.resolve(["saved": ok])
    }

    @objc func pendingCare(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve(["care": []]) }
        let list = KINStore.takePendingCare().map { ["verb": $0.verb, "at": $0.at] as [String: Any] }
        call.resolve(["care": list])
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        let on = call.getBool("enabled") ?? true
        KINStore.enabled = on
        Task {
            if #available(iOS 17.0, *) {
                if on { _ = await Self.ensure(force: false) } else { await Self.endAll() }
            }
            call.resolve(["enabled": on])
        }
    }

    // MARK: lifecycle (automatic)

    @objc private func resignActive() {
        if #available(iOS 17.0, *) { Task { _ = await Self.ensure(force: false) } }
    }

    @objc private func becameActive() {
        if #available(iOS 17.0, *) { Task { _ = await Self.ensure(force: false) } }
    }

    // MARK: ActivityKit

    /// Make sure exactly one current activity is running for the stored KIN. Foreground only for starts.
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
            await keep.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(4 * 3600), relevanceScore: relevance(state)))
            return true
        }
        do {
            _ = try Activity.request(
                attributes: attrs,
                content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(4 * 3600), relevanceScore: relevance(state)),
                pushType: nil
            )
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
        for a in all {
            await a.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(4 * 3600), relevanceScore: relevance(state)))
        }
        return !all.isEmpty
    }

    @available(iOS 17.0, *)
    static func endAll() async {
        for a in Activity<KINAttributes>.activities {
            await a.end(nil, dismissalPolicy: .immediate)
        }
        KINStore.defaults.removeObject(forKey: "live.startedAt")
    }

    /// Away visits and low needs rank higher when several apps have activities.
    @available(iOS 16.1, *)
    static func relevance(_ s: KINAttributes.ContentState) -> Double {
        if s.mode == "away" { return 90 }
        return s.lowest != nil ? 70 : 40
    }

    // MARK: parsing

    @available(iOS 16.1, *)
    static func parse(_ call: CAPPluginCall) -> (KINAttributes, KINAttributes.ContentState)? {
        guard let name = call.getString("name"), !name.isEmpty else { return nil }
        let clamp = { (k: String) in max(0, min(1, call.getDouble(k) ?? 0.8)) }
        let attrs = KINAttributes(name: String(name.prefix(16)), hue: call.getDouble("hue") ?? 160, accentHue: call.getDouble("accentHue") ?? 200, seed: call.getInt("seed") ?? 0)
        let state = KINAttributes.ContentState(
            mood: call.getString("mood") ?? "content",
            doing: String((call.getString("doing") ?? "at home").prefix(40)),
            hunger: clamp("hunger"), play: clamp("play"), rest: clamp("rest"), clean: clamp("clean"), affection: clamp("affection"),
            weather: call.getString("weather") ?? "sunny",
            tempC: call.getDouble("tempC") ?? 20,
            mode: call.getString("mode") ?? "home",
            friend: call.getString("friend").map { String($0.prefix(16)) },
            line: String((call.getString("line") ?? "").prefix(120)),
            lastCared: call.getDouble("lastCared"),
            fahrenheit: call.getBool("fahrenheit") ?? false
        )
        return (attrs, state)
    }

    // MARK: debug demo (simulator verification without the web integration)

    #if DEBUG
    /// `xcrun simctl launch <device> com.mutaafaziz.kin -KINLiveDemo YES [-KINLiveDemoCare feed]`
    private func runDemoIfAsked() {
        guard #available(iOS 17.0, *), UserDefaults.standard.bool(forKey: "KINLiveDemo") else { return }
        KINStore.attributes = KINAttributes(name: "Mosi", hue: 162, accentHue: 330, seed: 28)
        KINStore.state = KINAttributes.ContentState(
            mood: "curious", doing: "watching the rain", hunger: 0.32, play: 0.7, rest: 0.8, clean: 0.9, affection: 0.66,
            weather: "rainy", tempC: 14, mode: "home", friend: nil,
            line: "Pitter-patter on the mushroom. Very cozy under here.", lastCared: nil, fahrenheit: true
        )
        if UserDefaults.standard.string(forKey: "KINLiveDemoMode") == "asleep" {
            KINStore.state?.mode = "asleep"; KINStore.state?.weather = "starry"; KINStore.state?.mood = "sleepy"
            KINStore.state?.doing = "dozing in the nest"; KINStore.state?.rest = 0.35
            KINStore.state?.line = "The plant is glowing. I think the stars are doing the same."
        }
        let care = UserDefaults.standard.string(forKey: "KINLiveDemoCare")
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            let ok = await Self.ensure(force: true)
            Self.debugReport("start ok=\(ok)")
            if let care, KINStore.verbs.contains(care) {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                // Exactly what the activity's button runs.
                _ = try? await CareIntent(verb: care).perform()
                Self.debugReport("after \(care)")
            }
        }
    }

    /// Writes ActivityKit's view of the world into the App Group (readable from the simulator's container).
    @available(iOS 17.0, *)
    static func debugReport(_ tag: String) {
        let acts = Activity<KINAttributes>.activities.map { "\($0.id.prefix(8)) \($0.activityState) line=\($0.content.state.line) hunger=\($0.content.state.hunger)" }
        let line = "\(tag) authorized=\(ActivityAuthorizationInfo().areActivitiesEnabled) activities=\(acts.count) \(acts.joined(separator: " | ")) pending=\(KINStore.defaults.data(forKey: "live.pendingCare").map { String(decoding: $0, as: UTF8.self) } ?? "[]")"
        var log = KINStore.defaults.stringArray(forKey: "live.debug") ?? []
        log.append(line)
        KINStore.defaults.set(Array(log.suffix(20)), forKey: "live.debug")
    }

    #endif
}
