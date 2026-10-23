// KINLive for Capacitor: the JS face of the Live Activity engine (ios/LiveActivity/Engine).
// All behaviour lives in KINLiveEngine so the Unity bridge (ios/LiveActivity/Unity) behaves
// identically. JS API (src/platform/live.ts): isSupported, start, update, end, setSnapshot,
// pendingCare, setEnabled.

import Capacitor
import Foundation

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

    override public func load() {
        if #available(iOS 16.1, *) { KINLiveEngine.shared.activate() }
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve(["supported": false, "authorized": false, "enabled": false, "running": 0]) }
        call.resolve(KINLiveEngine.isSupported())
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve(["running": false]) }
        let restart = call.getBool("restart") ?? false
        let payload = call.options as? [String: Any] ?? [:]
        Task { call.resolve(["running": await KINLiveEngine.start(payload, restart: restart)]) }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve(["running": false]) }
        let payload = call.options as? [String: Any] ?? [:]
        Task { call.resolve(["running": await KINLiveEngine.update(payload)]) }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        Task {
            await KINLiveEngine.end()
            call.resolve()
        }
    }

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *),
              let b64 = call.getString("png")?.replacingOccurrences(of: "data:image/png;base64,", with: ""),
              let data = Data(base64Encoded: b64) else { return call.resolve(["saved": false]) }
        call.resolve(["saved": KINLiveEngine.setSnapshot(data)])
    }

    @objc func pendingCare(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve(["care": []]) }
        call.resolve(["care": KINLiveEngine.pendingCare()])
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { return call.resolve() }
        let on = call.getBool("enabled") ?? true
        Task {
            await KINLiveEngine.setEnabled(on)
            call.resolve(["enabled": on])
        }
    }
}
