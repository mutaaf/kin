// KIN's Live Activity: Lock Screen / banner / StandBy and every Dynamic Island size. watchOS 11
// mirrors it into the Smart Stack from the compact views. Views live in KINActivityViews.swift.

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
        } dynamicIsland: { context in
            let a = context.attributes
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { IslandLeading(a: a, s: s) }
                DynamicIslandExpandedRegion(.trailing) { IslandTrailing(s: s) }
                DynamicIslandExpandedRegion(.center) { IslandCenter(a: a, s: s) }
                DynamicIslandExpandedRegion(.bottom) { IslandBottom(s: s) }
            } compactLeading: {
                CompactLeading(s: s)
            } compactTrailing: {
                CompactTrailing(s: s)
            } minimal: {
                MinimalView(s: s)
            }
            .keylineTint(Brand.mint)
            .widgetURL(URL(string: "kin://home"))
        }
    }
}

#if DEBUG
/// DEBUG only: when the system asks this extension to render the activity, also write a contact
/// sheet of every presentation (Lock Screen dark + light in several states, StandBy dim, expanded
/// island, compact, minimal) to PNGs in the App Group, so the design can be reviewed
/// from a headless simulator (simctl screenshots don't include these system surfaces).
enum DebugRender {
    static func capture(_ a: KINAttributes, _ s: KINAttributes.ContentState) {
        let work = {
            MainActor.assumeIsolated {
                guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: KINStore.group) else { return }
                write(sheet(a, s), to: dir.appendingPathComponent("debug-sheet.png"))
                write(lock(a, s, .dark), to: dir.appendingPathComponent("debug-lock-dark.png"))
                write(lock(a, s, .light), to: dir.appendingPathComponent("debug-lock-light.png"))
                write(island(a, s), to: dir.appendingPathComponent("debug-island.png"))
            }
        }
        if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
    }

    @MainActor static func write<V: View>(_ v: V, to url: URL) {
        let r = ImageRenderer(content: v)
        r.scale = 3
        if let d = r.uiImage?.pngData() { try? d.write(to: url) }
    }

    static func variants(_ s: KINAttributes.ContentState) -> [(String, KINAttributes.ContentState)] {
        var fed = s
        fed.hunger = 0.82; fed.mood = "happy"; fed.doing = "munching"; fed.line = "Nom. Thank you."; fed.lastCared = Date().timeIntervalSince1970
        var night = s
        night.mode = "asleep"; night.weather = "starry"; night.mood = "sleepy"; night.rest = 0.3; night.hunger = 0.7
        night.line = "The plant is glowing. I think the stars are doing the same."
        var away = s
        away.mode = "away"; away.friend = "Nox"; away.weather = "sunny"; away.tempC = 24; away.hunger = 0.8
        away.line = "Nox has the best garden. Back soon!"
        return [("Now", s), ("After Feed", fed), ("Night", night), ("Visiting", away)]
    }

    static func wallpaper(_ scheme: ColorScheme) -> some View {
        LinearGradient(
            colors: scheme == .dark
                ? [Color(red: 0.09, green: 0.12, blue: 0.24), Color(red: 0.36, green: 0.27, blue: 0.42)]
                : [Color(red: 0.86, green: 0.9, blue: 0.97), Color(red: 0.97, green: 0.88, blue: 0.84)],
            startPoint: .top, endPoint: .bottom
        )
    }

    static func lock(_ a: KINAttributes, _ s: KINAttributes.ContentState, _ scheme: ColorScheme, dim: Bool = false) -> some View {
        let t = KINTheme(scheme, dim: dim)
        return LockScreenView(a: a, s: s, stale: false)
            .environment(\.colorScheme, scheme)
            .environment(\.isLuminanceReduced, dim)
            .frame(width: 364)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(t.background))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(16)
            .background(dim ? AnyView(Color.black) : AnyView(wallpaper(scheme)))
    }

    /// Mirrors the expanded Dynamic Island's regions on the black island shape.
    static func island(_ a: KINAttributes, _ s: KINAttributes.ContentState) -> some View {
        VStack(spacing: 6) {
            HStack(alignment: .top) {
                IslandLeading(a: a, s: s)
                Spacer()
                IslandCenter(a: a, s: s)
                Spacer()
                IslandTrailing(s: s)
            }
            IslandBottom(s: s)
        }
        .padding(.horizontal, 14).padding(.vertical, 14)
        .frame(width: 372)
        .background(RoundedRectangle(cornerRadius: 46, style: .continuous).fill(.black))
        .environment(\.colorScheme, .dark)
        .padding(12)
        .background(Color(white: 0.93))
    }

    static func compact(_ s: KINAttributes.ContentState) -> some View {
        HStack(spacing: 0) {
            CompactLeading(s: s).padding(.leading, 7)
            Spacer()
            CompactTrailing(s: s).padding(.trailing, 10)
        }
        .frame(width: 236, height: 37)
        .background(Capsule().fill(.black))
        .environment(\.colorScheme, .dark)
    }

    static func minimal(_ s: KINAttributes.ContentState) -> some View {
        MinimalView(s: s).frame(width: 37, height: 37).background(Circle().fill(.black))
    }

    static func sheet(_ a: KINAttributes, _ s: KINAttributes.ContentState) -> some View {
        let v = variants(s)
        return VStack(alignment: .leading, spacing: 14) {
            ForEach(v.indices, id: \.self) { i in
                HStack(alignment: .top, spacing: 14) {
                    label(v[i].0)
                    lock(a, v[i].1, .dark)
                    lock(a, v[i].1, .light)
                }
            }
            HStack(alignment: .top, spacing: 14) {
                label("StandBy / AOD")
                lock(a, v[2].1, .dark, dim: true)
                island(a, v[0].1)
            }
            HStack(alignment: .top, spacing: 14) {
                label("Island")
                island(a, v[1].1)
                island(a, v[2].1)
            }
            HStack(alignment: .center, spacing: 18) {
                label("Compact")
                ForEach(v.indices, id: \.self) { i in compact(v[i].1) }
                minimal(v[0].1)
                minimal(v[1].1)
            }
        }
        .padding(20)
        .background(Color(white: 0.8))
    }

    static func label(_ t: String) -> some View {
        Text(t).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(.black.opacity(0.7)).frame(width: 96, alignment: .leading).padding(.top, 20)
    }
}
#endif
