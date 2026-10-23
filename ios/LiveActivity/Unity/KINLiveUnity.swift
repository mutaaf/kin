// KINLive for Unity: a C ABI over KINLiveEngine, called from C# via [DllImport("__Internal")]
// (see KINLive.cs next to this file). NOT compiled into the Capacitor app.
//
// Where it goes: Unity links C# → native symbols from the UnityFramework target, so this file,
// Engine/KINLiveEngine.swift and Shared/{KINAttributes,KINStore}.swift are added to
// UnityFramework by scripts/ios-la-install.sh --native-target UnityFramework. CareIntent.swift
// (the Live Activity button intent) goes into the app target (Unity-iPhone), because iOS runs a
// LiveActivityIntent in the app's process. ActivityKit matches KINAttributes by type name, so the
// copies in the two modules interoperate.
//
// Calls are fire-and-forget from C# (Unity's main thread must never wait on ActivityKit);
// results that matter come back synchronously (isSupported, pendingCare) or via the App Group.

import Foundation

@available(iOS 16.1, *)
private func payload(_ json: UnsafePointer<CChar>?) -> [String: Any]? {
    guard let json, let data = String(cString: json).data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

/// Strings returned to C# are malloc'd; Unity's marshaller frees them (return type `string`).
private func cString(_ s: String) -> UnsafeMutablePointer<CChar>? { strdup(s) }

private func json(_ o: Any) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return "{}" }
    return s
}

@_cdecl("KINLive_activate")
public func KINLive_activate() {
    if #available(iOS 16.1, *) { KINLiveEngine.shared.activate() }
}

@_cdecl("KINLive_isSupported")
public func KINLive_isSupported() -> UnsafeMutablePointer<CChar>? {
    if #available(iOS 16.1, *) { return cString(json(KINLiveEngine.isSupported())) }
    return cString(#"{"supported":false,"authorized":false,"enabled":false,"running":0}"#)
}

@_cdecl("KINLive_start")
public func KINLive_start(_ state: UnsafePointer<CChar>?, _ restart: Bool) {
    guard #available(iOS 16.1, *), let p = payload(state) else { return }
    Task { _ = await KINLiveEngine.start(p, restart: restart) }
}

@_cdecl("KINLive_update")
public func KINLive_update(_ state: UnsafePointer<CChar>?) {
    guard #available(iOS 16.1, *), let p = payload(state) else { return }
    Task { _ = await KINLiveEngine.update(p) }
}

@_cdecl("KINLive_end")
public func KINLive_end() {
    guard #available(iOS 16.1, *) else { return }
    Task { await KINLiveEngine.end() }
}

/// PNG (or any image) bytes of the creature's portrait, e.g. from a RenderTexture.EncodeToPNG().
@_cdecl("KINLive_setSnapshot")
public func KINLive_setSnapshot(_ bytes: UnsafePointer<UInt8>?, _ length: Int32) -> Bool {
    guard #available(iOS 16.1, *), let bytes, length > 0 else { return false }
    return KINLiveEngine.setSnapshot(Data(bytes: bytes, count: Int(length)))
}

/// JSON array of care done from the activity since the last call: [{"verb":"feed","at":1729...}].
@_cdecl("KINLive_pendingCare")
public func KINLive_pendingCare() -> UnsafeMutablePointer<CChar>? {
    if #available(iOS 16.1, *) { return cString(json(KINLiveEngine.pendingCare())) }
    return cString("[]")
}

@_cdecl("KINLive_setEnabled")
public func KINLive_setEnabled(_ on: Bool) {
    guard #available(iOS 16.1, *) else { return }
    Task { await KINLiveEngine.setEnabled(on) }
}
