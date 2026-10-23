// The Live Activity's design system: palette, theme (light/dark/always-on), and the creature's
// avatar. Widget extension only (SwiftUI views must not compile into the app: see KINActivityViews).
//
// Avatar source, best first: the snapshot the app rendered of THIS user's creature (portrait.png in
// the App Group), then the bundled portrait made from the hero art (KINPortraitDefault), so it
// looks right before the app ever sends a snapshot and even without the App Group entitlement.

import SwiftUI
import UIKit

enum Brand {
    static let graphite = Color(red: 0x0B / 255, green: 0x0D / 255, blue: 0x12 / 255)
    static let porcelain = Color(red: 0xF6 / 255, green: 0xF6 / 255, blue: 0xF3 / 255)
    static let mint = Color(red: 0x6E / 255, green: 0xE5 / 255, blue: 0xCA / 255)
    /// Mint deep enough to read as text on a light background (AA contrast on white).
    static let mintInk = Color(red: 0x0E / 255, green: 0x8C / 255, blue: 0x74 / 255)
    static let peri = Color(red: 0x9E / 255, green: 0xA8 / 255, blue: 0xFF / 255)
    static let amber = Color(red: 0xE9 / 255, green: 0xAF / 255, blue: 0x6B / 255)
    static let sky = Color(red: 0x8F / 255, green: 0xD3 / 255, blue: 0xFF / 255)
    static let rose = Color(red: 0xFF / 255, green: 0x93 / 255, blue: 0xA6 / 255)
}

/// One accent on graphite (dark) or on porcelain glass (light). Always-on (luminance reduced)
/// drops glows and lowers contrast so the Lock Screen stays calm at night and in StandBy.
struct KINTheme {
    let dark: Bool
    let dim: Bool

    init(_ scheme: ColorScheme, dim: Bool = false) {
        dark = scheme == .dark
        self.dim = dim
    }

    static let island = KINTheme(.dark)

    var fg: Color { dark ? Brand.porcelain : Brand.graphite }
    var fg2: Color { fg.opacity(dark ? 0.62 : 0.58) }
    var fg3: Color { fg.opacity(dark ? 0.36 : 0.32) }
    var track: Color { fg.opacity(dark ? 0.13 : 0.09) }
    var glass: Color { fg.opacity(dark ? 0.11 : 0.065) }
    var hairline: Color { fg.opacity(dark ? 0.10 : 0.08) }
    /// Text and strokes in the accent colour.
    var accent: Color { dark ? Brand.mint : Brand.mintInk }
    /// The filled primary button.
    var accentFill: Color { Brand.mint.opacity(dim ? 0.55 : 1) }
    /// Behind the whole card (ActivityKit blurs the wallpaper beneath it).
    var background: Color { dark ? Brand.graphite.opacity(0.93) : Color(white: 0.985).opacity(0.82) }

    func need(_ key: String) -> Color {
        let c: Color
        switch key {
        case "hunger": c = Brand.amber
        case "play": c = dark ? Brand.mint : Brand.mintInk
        case "rest": c = Brand.peri
        case "clean": c = Brand.sky
        default: c = Brand.rose
        }
        return dim ? c.opacity(0.6) : c
    }

    /// The same hue, deep enough to read as text on the light card.
    func needText(_ key: String) -> Color {
        guard !dark else { return need(key) }
        switch key {
        case "hunger": return Color(red: 0.66, green: 0.42, blue: 0.10)
        case "rest": return Color(red: 0.33, green: 0.38, blue: 0.80)
        case "clean": return Color(red: 0.13, green: 0.47, blue: 0.70)
        case "play": return Brand.mintInk
        default: return Color(red: 0.78, green: 0.24, blue: 0.36)
        }
    }
}

// MARK: - Avatar

@available(iOS 16.1, *)
struct KINAvatar: View {
    var size: CGFloat = 60
    /// Soft mint halo behind the portrait (off for tiny Dynamic Island sizes).
    var glow = true
    /// Optional overall-wellbeing arc around the portrait (minimal presentation).
    var ring: Double? = nil
    /// 'asleep' | 'away' | 'cared' | nil: a tiny badge on the portrait's shoulder.
    var badge: String? = nil
    var theme = KINTheme.island

    var body: some View {
        let rim = max(1, size * 0.026)
        ZStack {
            if glow && !theme.dim {
                Circle()
                    .fill(Brand.mint.opacity(theme.dark ? 0.28 : 0.22))
                    .frame(width: size * 1.02, height: size * 1.02)
                    .blur(radius: size * 0.14)
            }
            Self.portrait
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
                .saturation(theme.dim ? 0.7 : 1)
            // A hairline rim, brightest top-left like light catching fur.
            Circle()
                .strokeBorder(
                    LinearGradient(colors: [Brand.mint.opacity(0.95), Brand.mint.opacity(0.18), .white.opacity(0.45)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    lineWidth: rim
                )
                .frame(width: size, height: size)
            if let ring {
                Circle()
                    .trim(from: 0, to: max(0.03, min(1, ring)))
                    .stroke(theme.accent, style: StrokeStyle(lineWidth: rim * 1.6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: size + rim * 5, height: size + rim * 5)
            }
            if let badge, let symbol = Self.badgeSymbol(badge) {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.17, weight: .bold, design: .rounded))
                    .foregroundStyle(theme.dark ? Brand.graphite : Brand.porcelain)
                    .frame(width: size * 0.34, height: size * 0.34)
                    .background(Circle().fill(badge == "cared" ? Brand.rose : theme.accent))
                    .overlay(Circle().strokeBorder(theme.dark ? Brand.graphite : Brand.porcelain, lineWidth: max(1.2, size * 0.035)))
                    .offset(x: size * 0.36, y: size * 0.36)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    static func badgeSymbol(_ b: String) -> String? {
        switch b {
        case "asleep": return "moon.fill"
        case "away": return "figure.walk"
        case "cared": return "heart.fill"
        default: return nil
        }
    }

    /// The user's own creature if the app sent one, else the bundled hero portrait.
    static var portrait: Image {
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.mutaafaziz.kin")?.appendingPathComponent("portrait.png"),
           let data = try? Data(contentsOf: url), let img = UIImage(data: data) {
            return Image(uiImage: img)
        }
        return Image("KINPortraitDefault")
    }
}
