// KIN's Live Activity: the Lock Screen / banner card and the Dynamic Island.
// Tesla restraint, creature warmth: graphite glass, one creature, soft need rings, the current
// thought, and care buttons that work without opening the app (iOS 17 LiveActivityIntent).

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

struct KINLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KINAttributes.self) { context in
            #if DEBUG
            let _ = DebugRender.capture(context.attributes, context.state)
            #endif
            LockScreenView(a: context.attributes, s: context.state, stale: context.isStale)
                .activityBackgroundTint(Brand.graphite.opacity(0.92))
                .activitySystemActionForegroundColor(Brand.porcelain)
        } dynamicIsland: { context in
            let a = context.attributes
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    KINPortrait(hue: a.hue, accentHue: a.accentHue, mood: s.mood, size: 52)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(s.temperatureText).font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Brand.porcelain)
                        Label(s.weather.capitalized, systemImage: weatherSymbol(s.weather))
                            .font(.caption2).foregroundStyle(Brand.muted).labelStyle(.titleAndIcon)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(a.name).font(.system(.headline, design: .serif)).foregroundStyle(Brand.porcelain)
                        Text(status(s)).font(.caption).foregroundStyle(Brand.mint).lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        Text("“\(s.line)”").font(.system(.subheadline, design: .serif).italic())
                            .foregroundStyle(Brand.porcelain).lineLimit(2).multilineTextAlignment(.center)
                        NeedRings(s: s, size: 20)
                        CareButtons(s: s, compact: true)
                    }
                    .padding(.top, 2)
                }
            } compactLeading: {
                KINPortrait(hue: a.hue, accentHue: a.accentHue, mood: s.mood, size: 24)
            } compactTrailing: {
                if let low = s.lowest {
                    Ring(value: low.value, tint: needTint(low.key), symbol: needSymbol(low.key)).frame(width: 20, height: 20)
                } else {
                    Image(systemName: moodSymbol(s.mood)).foregroundStyle(Brand.mint)
                }
            } minimal: {
                KINPortrait(hue: a.hue, accentHue: a.accentHue, mood: s.mood, size: 22)
            }
            .keylineTint(Brand.mint)
            .widgetURL(URL(string: "kin://home"))
        }
    }
}

#if DEBUG
/// DEBUG only: when the system asks this extension to render the activity, also write the exact
/// Lock Screen card (and an expanded-island stand-in) to PNGs in the App Group, so the design can
/// be reviewed from a headless simulator (simctl screenshots don't include these system surfaces).
enum DebugRender {
    static func capture(_ a: KINAttributes, _ s: KINAttributes.ContentState) {
        let work = {
            MainActor.assumeIsolated {
                guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: KINStore.group) else { return }
                let tag = s.lastCared == nil ? "before" : "after"
                write(lockCard(a, s), to: dir.appendingPathComponent("debug-lock-\(tag).png"))
                write(island(a, s), to: dir.appendingPathComponent("debug-island-\(tag).png"))
            }
        }
        if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
    }

    @MainActor static func write<V: View>(_ v: V, to url: URL) {
        let r = ImageRenderer(content: v.environment(\.colorScheme, .dark))
        r.scale = 3
        if let d = r.uiImage?.pngData() { try? d.write(to: url) }
    }

    static func lockCard(_ a: KINAttributes, _ s: KINAttributes.ContentState) -> some View {
        LockScreenView(a: a, s: s, stale: false)
            .frame(width: 364)
            .background(RoundedRectangle(cornerRadius: 24).fill(Brand.graphite.opacity(0.92)))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .padding(18)
            .background(LinearGradient(colors: [Color(red: 0.12, green: 0.16, blue: 0.3), Color(red: 0.45, green: 0.34, blue: 0.48)], startPoint: .top, endPoint: .bottom))
    }

    /// Mirrors the expanded Dynamic Island regions (leading / centre / trailing / bottom).
    static func island(_ a: KINAttributes, _ s: KINAttributes.ContentState) -> some View {
        VStack(spacing: 10) {
            HStack(alignment: .top) {
                KINPortrait(hue: a.hue, accentHue: a.accentHue, mood: s.mood, size: 52)
                Spacer()
                VStack(spacing: 2) {
                    Text(a.name).font(.system(.headline, design: .serif)).foregroundStyle(Brand.porcelain)
                    Text(status(s)).font(.caption).foregroundStyle(Brand.mint)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(s.temperatureText).font(.system(.title3, design: .rounded).weight(.semibold)).foregroundStyle(Brand.porcelain)
                    Label(s.weather.capitalized, systemImage: weatherSymbol(s.weather)).font(.caption2).foregroundStyle(Brand.muted)
                }
            }
            Text("“\(s.line)”").font(.system(.subheadline, design: .serif).italic()).foregroundStyle(Brand.porcelain).multilineTextAlignment(.center)
            NeedRings(s: s, size: 20)
            CareButtons(s: s, compact: true)
        }
        .padding(18)
        .frame(width: 372)
        .background(RoundedRectangle(cornerRadius: 44).fill(.black))
        .padding(12)
        .background(Color(white: 0.92))
    }
}
#endif
