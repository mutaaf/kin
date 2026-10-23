// The Live Activity's views. Widget extension only: compiling SwiftUI views into the app target
// made the app hard-link SwiftUICore (iOS 18+), which crashed it at launch on iOS 15–17.

import ActivityKit
import AppIntents
import SwiftUI

// MARK: - Lock Screen

@available(iOS 17.0, *)
struct LockScreenView: View {
    let a: KINAttributes
    let s: KINAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                KINPortrait(hue: a.hue, accentHue: a.accentHue, mood: s.mood, size: 56)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(a.name).font(.system(.title3, design: .serif).weight(.semibold)).foregroundStyle(Brand.porcelain)
                        Text(status(s)).font(.caption).foregroundStyle(Brand.mint).lineLimit(1)
                        Spacer(minLength: 4)
                        Text("\(s.temperatureText) \(Image(systemName: weatherSymbol(s.weather)))")
                            .font(.caption).foregroundStyle(Brand.muted).fixedSize()
                    }
                    Text("“\(s.line)”")
                        .font(.system(.subheadline, design: .serif).italic())
                        .foregroundStyle(Brand.porcelain.opacity(stale ? 0.6 : 0.95))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    NeedRings(s: s, size: 18).padding(.top, 2)
                }
            }
            CareButtons(s: s, compact: true)
        }
        .padding(14)
        .background(
            RadialGradient(colors: [Brand.fur(a.hue, light: 0.45).opacity(0.28), .clear], center: .topLeading, startRadius: 0, endRadius: 220)
        )
    }
}

// MARK: - Pieces

@available(iOS 17.0, *)
struct NeedRings: View {
    let s: KINAttributes.ContentState
    let size: CGFloat
    var body: some View {
        HStack(spacing: 6) {
            ForEach(s.needs, id: \.key) { n in
                Ring(value: n.value, tint: needTint(n.key), symbol: needSymbol(n.key))
                    .frame(width: size, height: size)
                    .accessibilityLabel("\(n.key) \(Int(n.value * 100)) percent")
            }
        }
    }
}

struct Ring: View {
    let value: Double
    let tint: Color
    let symbol: String
    var body: some View {
        ZStack {
            Circle().stroke(Brand.porcelain.opacity(0.12), lineWidth: 2.2)
            Circle().trim(from: 0, to: max(0.04, min(1, value)))
                .stroke(tint, style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Image(systemName: symbol).font(.system(size: 8, weight: .semibold)).foregroundStyle(tint.opacity(0.9))
        }
    }
}

@available(iOS 17.0, *)
struct CareButtons: View {
    let s: KINAttributes.ContentState
    let compact: Bool
    var body: some View {
        HStack(spacing: compact ? 8 : 6) {
            care("feed", "Feed", "fork.knife")
            if s.isNight { care("tuck", "Tuck in", "moon.zzz.fill") } else { care("play", "Play", "tennisball.fill") }
            care("pet", "Pet", "heart.fill")
        }
    }

    private func care(_ verb: String, _ label: String, _ symbol: String) -> some View {
        Button(intent: CareIntent(verb: verb)) {
            Label(label, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .labelStyle(.titleAndIcon)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, compact ? 12 : 10)
                .padding(.vertical, 7)
                .frame(maxWidth: compact ? .infinity : nil)
        }
        .buttonStyle(.plain)
        .foregroundStyle(verb == "feed" ? Brand.graphite : Brand.porcelain)
        .background(Capsule().fill(verb == "feed" ? Brand.mint : Brand.porcelain.opacity(0.12)))
        .accessibilityLabel("\(label) your KIN")
    }
}

// MARK: - Words and symbols

@available(iOS 16.1, *)
func status(_ s: KINAttributes.ContentState) -> String {
    switch s.mode {
    case "away": return "visiting \(s.friend ?? "a friend")"
    case "asleep": return "asleep"
    default: return s.doing
    }
}

func needTint(_ need: String) -> Color {
    switch need {
    case "hunger": return Brand.amber
    case "play": return Brand.mint
    case "rest": return Brand.peri
    case "clean": return Color(red: 0.62, green: 0.86, blue: 1)
    default: return Color(red: 1, green: 0.6, blue: 0.68)
    }
}

func needSymbol(_ need: String) -> String {
    switch need {
    case "hunger": return "fork.knife"
    case "play": return "tennisball.fill"
    case "rest": return "moon.fill"
    case "clean": return "drop.fill"
    default: return "heart.fill"
    }
}

func moodSymbol(_ mood: String) -> String {
    switch mood {
    case "happy": return "sparkles"
    case "sleepy": return "moon.zzz.fill"
    case "cozy": return "cup.and.saucer.fill"
    case "curious": return "eyes"
    case "shy": return "hand.raised.fingers.spread.fill"
    default: return "heart.fill"
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
