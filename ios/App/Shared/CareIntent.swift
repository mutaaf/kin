// Care buttons that work right inside the Live Activity (Lock Screen and Dynamic Island), without
// opening the app. Compiled into BOTH targets: the widget references the intent type for its
// buttons; iOS runs a LiveActivityIntent's perform() in the app's process (in the background).

import ActivityKit
import AppIntents
import Foundation

@available(iOS 17.0, *)
struct CareIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Care for your KIN"
    static var description = IntentDescription("Feed, play with, pet or tuck in your KIN from the Live Activity.")
    static var isDiscoverable = false

    @Parameter(title: "Care") var verb: String

    init() {}
    init(verb: String) { self.verb = verb }

    func perform() async throws -> some IntentResult {
        guard KINStore.verbs.contains(verb) else { return .result() }
        // 1. Remember it for the web app's care model (applied once, the next time KIN opens).
        KINStore.recordCare(verb)
        // 2. React right now, in the activity itself.
        for activity in Activity<KINAttributes>.activities {
            let next = KINStore.applyCare(verb, to: activity.content.state, name: activity.attributes.name)
            KINStore.state = next
            await activity.update(ActivityContent(state: next, staleDate: Date().addingTimeInterval(4 * 3600), relevanceScore: 80))
        }
        return .result()
    }
}
