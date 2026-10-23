// The Live Activity's data model. Compiled into BOTH the app and the KINWidgets extension.
// Static attributes never change for an activity's life; ContentState is what updates.
// Keep ContentState small: ActivityKit caps the encoded state at 4 KB.

import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct KINAttributes: ActivityAttributes {
    /// The KIN's name, e.g. "Lumi".
    var name: String
    /// Body hue in degrees (0…360), from the genome, so the fallback face matches the creature.
    var hue: Double
    /// Accent hue for ear tips and the glow.
    var accentHue: Double
    /// Genome seed: the same seed renders the same creature everywhere.
    var seed: Int

    struct ContentState: Codable, Hashable {
        /// 'happy' | 'content' | 'curious' | 'sleepy' | 'shy' | 'cozy' | 'sad'
        var mood: String
        /// What it's doing, in a few words ("basking", "asleep in the nest").
        var doing: String
        /// Humane needs, each 0…1 where 1 is fully satisfied. Never a countdown to harm.
        var hunger: Double
        var play: Double
        var rest: Double
        var clean: Double
        var affection: Double
        /// "sunny", "rainy", "snowy", "windy", "starry"…
        var weather: String
        var tempC: Double
        /// 'home' | 'away' | 'asleep'
        var mode: String
        /// The friend it's visiting, when mode == 'away'.
        var friend: String?
        /// A short line: the current thought, or a reaction to care ("Nom. Thank you.").
        var line: String
        /// When someone last cared for it (feed/play/pet/tuck), as seconds since 1970.
        var lastCared: Double?
        /// Use °F in the UI.
        var fahrenheit: Bool
    }
}

@available(iOS 16.1, *)
extension KINAttributes.ContentState {
    var needs: [(key: String, value: Double)] {
        [("hunger", hunger), ("play", play), ("rest", rest), ("clean", clean), ("affection", affection)]
    }

    /// The need that would most like attention, if any is noticeably low.
    var lowest: (key: String, value: Double)? {
        let l = needs.min { $0.value < $1.value }
        return (l?.value ?? 1) < 0.45 ? l : nil
    }

    var isNight: Bool { mode == "asleep" || weather == "starry" }

    var temperatureText: String {
        fahrenheit ? "\(Int((tempC * 1.8 + 32).rounded()))°" : "\(Int(tempC.rounded()))°"
    }
}
