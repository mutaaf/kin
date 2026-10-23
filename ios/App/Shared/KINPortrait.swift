// The creature's face in the Live Activity. Prefers the snapshot the app rendered of THIS user's
// KIN (portrait.png in the App Group); falls back to a vector face drawn from the genome's hue,
// so it's never a generic icon.

import SwiftUI
import UIKit

enum Brand {
    static let graphite = Color(red: 0x0B / 255, green: 0x0D / 255, blue: 0x12 / 255)
    static let porcelain = Color(red: 0xF6 / 255, green: 0xF6 / 255, blue: 0xF3 / 255)
    static let mint = Color(red: 0x6E / 255, green: 0xE5 / 255, blue: 0xCA / 255)
    static let peri = Color(red: 0x9E / 255, green: 0xA8 / 255, blue: 0xFF / 255)
    static let amber = Color(red: 0xE9 / 255, green: 0xAF / 255, blue: 0x6B / 255)
    static let muted = Color(red: 0xF6 / 255, green: 0xF6 / 255, blue: 0xF3 / 255).opacity(0.62)

    static func fur(_ hue: Double, light: Double = 0.72) -> Color {
        Color(hue: (hue.truncatingRemainder(dividingBy: 360)) / 360, saturation: 0.5, brightness: light + 0.2)
    }
}

@available(iOS 16.1, *)
struct KINPortrait: View {
    let hue: Double
    let accentHue: Double
    var mood: String = "content"
    var size: CGFloat = 56

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [Brand.fur(hue, light: 0.55).opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: size * 0.62))
                .frame(width: size * 1.25, height: size * 1.25)
            if let img = Self.snapshot {
                Image(uiImage: img)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
            } else {
                KINFace(hue: hue, accentHue: accentHue, mood: mood)
                    .frame(width: size, height: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    /// Loaded once per render pass; widgets are short-lived, so no cache invalidation is needed.
    static var snapshot: UIImage? {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.mutaafaziz.kin")?.appendingPathComponent("portrait.png"),
              let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }
}

/// A soft, original creature face: round head, two ears, big glossy eyes with catchlights, blush.
@available(iOS 16.1, *)
struct KINFace: View {
    let hue: Double
    let accentHue: Double
    var mood: String

    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            let fur = Brand.fur(hue)
            let inner = Brand.fur(accentHue, light: 0.78)
            ZStack {
                // ears
                ForEach([-1.0, 1.0], id: \.self) { side in
                    Ear().fill(fur)
                        .overlay(Ear().inset(by: s * 0.06).fill(inner.opacity(0.85)))
                        .frame(width: s * 0.32, height: s * 0.36)
                        .rotationEffect(.degrees(side * 22))
                        .offset(x: side * s * 0.26, y: -s * 0.3)
                }
                // head
                Ellipse()
                    .fill(LinearGradient(colors: [fur.opacity(1), Brand.fur(hue, light: 0.6)], startPoint: .top, endPoint: .bottom))
                    .frame(width: s * 0.86, height: s * 0.78)
                    .offset(y: s * 0.06)
                // muzzle
                Ellipse().fill(Brand.porcelain.opacity(0.85))
                    .frame(width: s * 0.36, height: s * 0.22)
                    .offset(y: s * 0.2)
                // eyes
                ForEach([-1.0, 1.0], id: \.self) { side in
                    Eye(happy: mood == "happy", sleepy: mood == "sleepy")
                        .frame(width: s * 0.17, height: s * 0.2)
                        .offset(x: side * s * 0.17, y: s * 0.04)
                }
                // blush
                ForEach([-1.0, 1.0], id: \.self) { side in
                    Circle().fill(Color(red: 1, green: 0.55, blue: 0.62).opacity(0.45))
                        .frame(width: s * 0.11, height: s * 0.11)
                        .offset(x: side * s * 0.3, y: s * 0.17)
                }
                // nose + mouth
                Capsule().fill(Brand.graphite).frame(width: s * 0.06, height: s * 0.04).offset(y: s * 0.15)
                Smile().stroke(Brand.graphite, style: StrokeStyle(lineWidth: max(1, s * 0.02), lineCap: .round))
                    .frame(width: s * 0.1, height: s * 0.05).offset(y: s * 0.21)
            }
            .frame(width: s, height: s)
        }
    }
}

private struct Ear: InsettableShape {
    var inset: CGFloat = 0
    func path(in r: CGRect) -> Path {
        let r = r.insetBy(dx: inset, dy: inset)
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.maxY), control: CGPoint(x: r.maxX, y: r.minY + r.height * 0.35))
        p.addQuadCurve(to: CGPoint(x: r.minX, y: r.maxY), control: CGPoint(x: r.midX, y: r.maxY + r.height * 0.12))
        p.addQuadCurve(to: CGPoint(x: r.midX, y: r.minY), control: CGPoint(x: r.minX, y: r.minY + r.height * 0.35))
        return p
    }
    func inset(by amount: CGFloat) -> Ear { var e = self; e.inset += amount; return e }
}

private struct Smile: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY), control: CGPoint(x: r.midX, y: r.maxY * 1.6))
        return p
    }
}

@available(iOS 16.1, *)
private struct Eye: View {
    let happy: Bool
    let sleepy: Bool
    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            if happy || sleepy {
                // ^ ^ when delighted, a soft closed curve when sleepy
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h * (happy ? 0.62 : 0.5)))
                    p.addQuadCurve(to: CGPoint(x: w, y: h * (happy ? 0.62 : 0.5)), control: CGPoint(x: w / 2, y: happy ? h * 0.05 : h * 0.85))
                }
                .stroke(Brand.graphite, style: StrokeStyle(lineWidth: max(1.2, w * 0.16), lineCap: .round))
            } else {
                ZStack {
                    Ellipse().fill(RadialGradient(colors: [Color(white: 0.22), Brand.graphite], center: .init(x: 0.5, y: 0.65), startRadius: 0, endRadius: w))
                    Circle().fill(.white).frame(width: w * 0.42).offset(x: -w * 0.14, y: -h * 0.18)
                    Circle().fill(.white.opacity(0.85)).frame(width: w * 0.18).offset(x: w * 0.18, y: h * 0.2)
                }
            }
        }
    }
}
