// Every presentation of KIN's Live Activity. Widget extension only: compiling SwiftUI views into
// the app target made the app hard-link SwiftUICore (iOS 18+), which crashed it at launch on 15–17.
//
// Design rules: the creature is the hero; one accent (mint) on graphite or porcelain glass; one
// short thought; needs as slim segments (a word appears only when one is low); one primary action,
// the care it most wants, and the rest quiet. Numbers and the thought animate when state changes.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Lock Screen / banner / StandBy

@available(iOS 17.0, *)
struct LockScreenView: View {
    let a: KINAttributes
    let s: KINAttributes.ContentState
    let stale: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isLuminanceReduced) private var dim

    var body: some View {
        let t = KINTheme(scheme, dim: dim)
        VStack(spacing: 12) {
            HStack(alignment: .center, spacing: 14) {
                KINAvatar(size: 62, badge: avatarBadge(s), theme: t)
                VStack(alignment: .leading, spacing: 5) {
                    Header(a: a, s: s, t: t)
                    Thought(s: s, t: t, size: 15, stale: stale)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    NeedMeter(s: s, t: t, segment: 24).padding(.top, 3)
                }
            }
            if !dim { CareBar(s: s, t: t, style: .pills) }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .activityBackgroundTint(t.background)
        .activitySystemActionForegroundColor(t.fg)
    }
}

// MARK: - Dynamic Island

@available(iOS 17.0, *)
struct IslandLeading: View {
    let a: KINAttributes
    let s: KINAttributes.ContentState
    var body: some View {
        KINAvatar(size: 46, badge: avatarBadge(s)).padding(.leading, 6).padding(.top, 4)
    }
}

@available(iOS 17.0, *)
struct IslandCenter: View {
    let a: KINAttributes
    let s: KINAttributes.ContentState
    var body: some View {
        let t = KINTheme.island
        VStack(spacing: 1) {
            Text(a.name).font(.system(size: 16, weight: .semibold, design: .rounded)).foregroundStyle(t.fg)
            Text(status(s)).font(.system(size: 12, weight: .medium, design: .rounded)).foregroundStyle(t.accent).lineLimit(1)
        }
        .padding(.top, 6)
    }
}

@available(iOS 17.0, *)
struct IslandTrailing: View {
    let s: KINAttributes.ContentState
    var body: some View {
        let t = KINTheme.island
        VStack(alignment: .trailing, spacing: 1) {
            Text(s.temperatureText)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText(value: s.tempC))
                .foregroundStyle(t.fg)
            Image(systemName: weatherSymbol(s.weather))
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(t.fg2)
        }
        .padding(.trailing, 6)
        .padding(.top, 6)
    }
}

@available(iOS 17.0, *)
struct IslandBottom: View {
    let s: KINAttributes.ContentState
    var body: some View {
        let t = KINTheme.island
        VStack(spacing: 10) {
            Thought(s: s, t: t, size: 15, stale: false)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
            HStack(alignment: .center) {
                NeedMeter(s: s, t: t, segment: 18)
                Spacer(minLength: 8)
                CareBar(s: s, t: t, style: .circles)
            }
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
    }
}

@available(iOS 17.0, *)
struct CompactLeading: View {
    let s: KINAttributes.ContentState
    var body: some View { KINAvatar(size: 24, glow: false) }
}

@available(iOS 17.0, *)
struct CompactTrailing: View {
    let s: KINAttributes.ContentState
    var body: some View {
        let t = KINTheme.island
        if let low = s.lowest {
            // Only when something actually wants attention: one tiny ring in that need's colour.
            ZStack {
                Circle().stroke(t.track, lineWidth: 2)
                Circle().trim(from: 0, to: max(0.05, low.value))
                    .stroke(t.need(low.key), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: needSymbol(low.key)).font(.system(size: 8, weight: .bold)).foregroundStyle(t.need(low.key))
            }
            .frame(width: 20, height: 20)
        } else {
            Text(s.temperatureText)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText(value: s.tempC))
                .foregroundStyle(t.accent)
        }
    }
}

@available(iOS 17.0, *)
struct MinimalView: View {
    let s: KINAttributes.ContentState
    var body: some View { KINAvatar(size: 20, glow: false, ring: wellbeing(s)) }
}

// MARK: - Pieces

@available(iOS 17.0, *)
struct Header: View {
    let a: KINAttributes
    let s: KINAttributes.ContentState
    let t: KINTheme
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(a.name)
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .foregroundStyle(t.fg)
            Text(status(s))
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(t.accent)
                .lineLimit(1)
            Spacer(minLength: 6)
            HStack(spacing: 4) {
                Image(systemName: weatherSymbol(s.weather)).symbolRenderingMode(.hierarchical)
                Text(s.temperatureText).monospacedDigit().contentTransition(.numericText(value: s.tempC))
            }
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(t.fg2)
            .fixedSize()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(s.weather), \(s.temperatureText)")
        }
    }
}

/// The creature's current thought, in a refined serif italic. Cross-fades when it changes.
@available(iOS 17.0, *)
struct Thought: View {
    let s: KINAttributes.ContentState
    let t: KINTheme
    let size: CGFloat
    let stale: Bool
    var body: some View {
        Text(s.line.isEmpty ? moodLine(s.mood) : s.line)
            .font(.system(size: size, weight: .regular, design: .serif).italic())
            .foregroundStyle(t.fg.opacity(stale || t.dim ? 0.6 : 0.92))
            .lineSpacing(1)
            .id(s.line)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            .accessibilityLabel("Thinking: \(s.line)")
    }
}

/// Five slim segments (fullness, play, rest, clean, affection) and, only if one is low, a word.
@available(iOS 17.0, *)
struct NeedMeter: View {
    let s: KINAttributes.ContentState
    let t: KINTheme
    var segment: CGFloat = 24
    var body: some View {
        HStack(spacing: 4) {
            ForEach(s.needs, id: \.key) { n in
                ZStack(alignment: .leading) {
                    Capsule().fill(t.track)
                    Capsule().fill(t.need(n.key)).frame(width: max(3, segment * min(1, max(0, n.value))))
                }
                .frame(width: segment, height: 4)
                .accessibilityElement()
                .accessibilityLabel("\(needName(n.key)) \(Int(n.value * 100)) percent")
            }
            if let low = s.lowest {
                Text(lowWord(low.key))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(t.needText(low.key))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.leading, 4)
            }
        }
    }
}

enum CareStyle { case pills, circles }

/// Feed · Play (Tuck in at night) · Pet. Runs CareIntent without opening the app. The care the
/// KIN most wants is the one filled button; the others are quiet glass.
@available(iOS 17.0, *)
struct CareBar: View {
    let s: KINAttributes.ContentState
    let t: KINTheme
    let style: CareStyle

    var body: some View {
        let primary = suggestedVerb(s)
        HStack(spacing: style == .pills ? 8 : 10) {
            button("feed", "Feed", "fork.knife", primary)
            if s.isNight { button("tuck", "Tuck in", "moon.zzz.fill", primary) } else { button("play", "Play", "tennisball.fill", primary) }
            button("pet", "Pet", "heart.fill", primary)
        }
    }

    @ViewBuilder
    private func button(_ verb: String, _ label: String, _ symbol: String, _ primary: String) -> some View {
        let on = verb == primary
        Button(intent: CareIntent(verb: verb)) {
            switch style {
            case .pills:
                HStack(spacing: 6) {
                    Image(systemName: symbol).font(.system(size: 12, weight: .bold))
                    Text(label).font(.system(size: 13, weight: .semibold, design: .rounded))
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .foregroundStyle(on ? Brand.graphite : t.fg)
                .background(Capsule().fill(on ? t.accentFill : t.glass))
                .overlay(Capsule().strokeBorder(on ? .clear : t.hairline, lineWidth: 0.5))
            case .circles:
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .foregroundStyle(on ? Brand.graphite : t.fg)
                    .background(Circle().fill(on ? t.accentFill : t.glass))
                    .overlay(Circle().strokeBorder(on ? .clear : t.hairline, lineWidth: 0.5))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) \(verb == "tuck" ? "" : "your KIN")")
    }
}

// MARK: - Words and symbols

@available(iOS 16.1, *)
func status(_ s: KINAttributes.ContentState) -> String {
    switch s.mode {
    case "away": return "visiting \((s.friend ?? "").isEmpty ? "a friend" : s.friend!)"
    case "asleep": return "asleep"
    default: return s.doing
    }
}

@available(iOS 16.1, *)
func avatarBadge(_ s: KINAttributes.ContentState) -> String? {
    if s.mode == "asleep" { return "asleep" }
    if s.mode == "away" { return "away" }
    if let at = s.lastCared, Date().timeIntervalSince1970 - at < 15 * 60 { return "cared" }
    return nil
}

/// The care the KIN most wants right now: the lowest need's verb (tuck in at night when tired).
@available(iOS 16.1, *)
func suggestedVerb(_ s: KINAttributes.ContentState) -> String {
    guard let low = s.lowest else { return s.isNight ? "tuck" : "pet" }
    switch low.key {
    case "hunger": return "feed"
    case "play": return s.isNight ? "tuck" : "play"
    case "rest": return s.isNight ? "tuck" : "pet"
    default: return "pet"
    }
}

@available(iOS 16.1, *)
func wellbeing(_ s: KINAttributes.ContentState) -> Double {
    s.needs.map(\.value).reduce(0, +) / Double(max(1, s.needs.count))
}

func needName(_ key: String) -> String {
    switch key {
    case "hunger": return "Fullness"
    case "play": return "Play"
    case "rest": return "Rest"
    case "clean": return "Clean"
    default: return "Affection"
    }
}

func lowWord(_ key: String) -> String {
    switch key {
    case "hunger": return "Peckish"
    case "play": return "Wants to play"
    case "rest": return "Sleepy"
    case "clean": return "Needs a bath"
    default: return "Wants a cuddle"
    }
}

func needSymbol(_ key: String) -> String {
    switch key {
    case "hunger": return "fork.knife"
    case "play": return "tennisball.fill"
    case "rest": return "moon.fill"
    case "clean": return "drop.fill"
    default: return "heart.fill"
    }
}

func moodLine(_ mood: String) -> String {
    switch mood {
    case "happy": return "Today is a good day."
    case "sleepy": return "Five more minutes…"
    case "curious": return "What is that over there?"
    case "cozy": return "Snug as anything."
    case "shy": return "Just watching for now."
    default: return "All is well in the garden."
    }
}

func weatherSymbol(_ w: String) -> String {
    switch w {
    case "rainy": return "cloud.rain.fill"
    case "snowy": return "cloud.snow.fill"
    case "windy": return "wind"
    case "hot": return "sun.max.fill"
    case "cold": return "thermometer.snowflake"
    case "starry": return "moon.stars.fill"
    case "cloudy": return "cloud.fill"
    default: return "sun.max.fill"
    }
}
