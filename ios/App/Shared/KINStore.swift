// Shared state between the app and the widget extension, in the App Group container.
// Compiled into BOTH targets.
//
//   live.attributes   the KIN's static identity (JSON KINAttributes) for starting activities natively
//   live.state        the latest ContentState the web app wants shown (JSON)
//   live.pendingCare  care done from the activity, not yet applied by the web app's care model
//   live.enabled      the in-app opt-out (absent = enabled)
//   portrait.png      a small snapshot of the user's own creature (from the web canvas)

import Foundation

@available(iOS 16.1, *)
enum KINStore {
    static let group = "group.com.mutaafaziz.kin"

    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }

    static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }

    static var portraitURL: URL? { container?.appendingPathComponent("portrait.png") }

    // MARK: enabled

    static var enabled: Bool {
        get { defaults.object(forKey: "live.enabled") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "live.enabled") }
    }

    // MARK: identity + state

    static func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }

    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static var attributes: KINAttributes? {
        get { load(KINAttributes.self, key: "live.attributes") }
        set { if let v = newValue { save(v, key: "live.attributes") } else { defaults.removeObject(forKey: "live.attributes") } }
    }

    static var state: KINAttributes.ContentState? {
        get { load(KINAttributes.ContentState.self, key: "live.state") }
        set { if let v = newValue { save(v, key: "live.state") } else { defaults.removeObject(forKey: "live.state") } }
    }

    // MARK: care from the activity

    struct Care: Codable { let verb: String; let at: Double }

    static func recordCare(_ verb: String, at: Date = Date()) {
        var list = load([Care].self, key: "live.pendingCare") ?? []
        list.append(Care(verb: verb, at: at.timeIntervalSince1970 * 1000))
        save(Array(list.suffix(50)), key: "live.pendingCare")
    }

    /// Hand the pending care to the web app's care model, exactly once.
    static func takePendingCare() -> [Care] {
        let list = load([Care].self, key: "live.pendingCare") ?? []
        defaults.removeObject(forKey: "live.pendingCare")
        return list
    }

    static let verbs: Set<String> = ["feed", "play", "pet", "tuck"]

    /// The creature's immediate response to care, shown in the activity before the app ever opens.
    /// Humane: care only ever fills a need; nothing here punishes.
    static func applyCare(_ verb: String, to s: KINAttributes.ContentState, name: String) -> KINAttributes.ContentState {
        var n = s
        let fill = { (v: Double, by: Double) in min(1, v + by) }
        switch verb {
        case "feed":
            n.hunger = fill(n.hunger, 0.45); n.affection = fill(n.affection, 0.05)
            n.mood = "happy"; n.doing = "munching"; n.line = ["Nom. Thank you.", "Crunchy! More later?", "That hit the spot."].randomElement()!
        case "play":
            n.play = fill(n.play, 0.4); n.rest = max(0, n.rest - 0.05); n.affection = fill(n.affection, 0.08)
            n.mood = "happy"; n.doing = "playing"; n.line = ["Again! Again!", "Got it! Did you see?", "Best game ever."].randomElement()!
        case "pet":
            n.affection = fill(n.affection, 0.35)
            n.mood = "content"; n.doing = "leaning into your hand"; n.line = ["Mmm, right there.", "Purr.", "You're my favourite."].randomElement()!
        case "tuck":
            n.rest = fill(n.rest, 0.3); n.affection = fill(n.affection, 0.1)
            n.mood = "sleepy"; n.doing = "tucked in"; n.mode = n.mode == "away" ? n.mode : "asleep"
            n.line = ["Goodnight. Stay close?", "So cozy. Night night.", "Dreaming of the ball already."].randomElement()!
        default:
            return s
        }
        n.lastCared = Date().timeIntervalSince1970
        _ = name
        return n
    }
}
