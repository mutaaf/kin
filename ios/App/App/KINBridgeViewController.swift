// Capacitor 8 (SPM) registers app-local plugins from a CAPBridgeViewController subclass.
// Main.storyboard points at this class (customModule "App").

import Capacitor
import UIKit
import WebKit

class KINBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(ARPlugin()) // KINAR: the real room as KIN's world
        #if DEBUG
        forceWhatsNewIfAsked()
        #endif
    }

    #if DEBUG
    /// Debug-only switch to preview the "What's new" modal on a phone or simulator: launch with
    /// `-KINWhatsNew YES` (simctl launch argument or Xcode scheme argument; it lands in
    /// UserDefaults' argument domain and is never saved). The page reads `window.__KIN_WHATSNEW__`
    /// (src/whatsnew/decide.ts FORCE_GLOBAL), shows the modal and records nothing.
    private func forceWhatsNewIfAsked() {
        guard UserDefaults.standard.bool(forKey: "KINWhatsNew") else { return }
        let script = WKUserScript(source: "window.__KIN_WHATSNEW__ = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
    }
    #endif
}
