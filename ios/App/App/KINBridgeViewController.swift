// Capacitor 8 (SPM) registers app-local plugins from a CAPBridgeViewController subclass.
// Main.storyboard points at this class (customModule "App").

import Capacitor
import UIKit

class KINBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
