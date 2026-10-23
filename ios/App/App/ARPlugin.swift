// KINAR: the user's real room as KIN's world (ARKit), bridged to the web layer.
//
// Why hybrid: WKWebView can't reach ARKit, and rewriting the creature natively would fork the
// look. So an ARSCNView renders the live camera BEHIND a transparent web view, and the web layer
// draws the creature with three.js using this camera's exact projection and pose every frame.
//
// What streams to JS (window.__kinAR, see src/ar/native.ts):
//   f([...])  every ARKit frame (≈60 Hz, dropped if the previous call hasn't landed):
//             [time, tracking, projection(16), view(16), ambientLumens, colorTempK]
//   p({...})  plane anchors (added/updated, ≤ 2 Hz each): id, classification, transform, extent
//   r(id)     anchor removed
//   m({...})  LiDAR mesh chunks (≤ 1 per 2 s per anchor): vertices (Float32, anchor-local),
//             triangle indices, per-face classification, transform. Used for occlusion + colliders.
//   d({...})  people depth for occlusion (≈15 Hz, 8-bit metres×50, person pixels only) and the
//             screen→image transform to sample it
//   o({...})  one recognised real object at a time (≈1 Hz): label, confidence, world position, size
//
// Privacy: frames are processed on this device and dropped; nothing is stored or sent anywhere.
// Person segmentation is used only to hide the KIN behind people; no faces or identities.

import ARKit
import Capacitor
import UIKit
import Vision

@objc(ARPlugin)
public class ARPlugin: CAPPlugin, CAPBridgedPlugin, ARSessionDelegate {
    public let identifier = "ARPlugin"
    public let jsName = "KINAR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "raycast", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "conditions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
    ]

    private var arView: ARSCNView?
    private var running = false
    private var wantPeople = true
    private var wantMesh = true
    private var wantObjects = true
    /// Ladder features, set by the web layer's tier choice (src/ar/tiers.ts) via start/configure.
    private var showVideo = true
    private var wantSceneDepth = true
    private var meshInterval: CFTimeInterval = 2
    private var depthInterval: CFTimeInterval = 1.0 / 15

    // Bridge flow control and measurements.
    private var evalInFlight = false
    private var sent = 0, dropped = 0
    private var buildMs = 0.0, rtMs = 0.0
    private var meshBytes = 0, depthBytes = 0, objectsSeen = 0, planesSent = 0
    private var statsAt = CACurrentMediaTime()
    private var lastStats: [String: Any] = [:]

    private let work = DispatchQueue(label: "kin.ar.work", qos: .userInitiated)
    private let vision = DispatchQueue(label: "kin.ar.vision", qos: .utility)
    private var planeSentAt: [UUID: CFTimeInterval] = [:]
    private var meshSentAt: [UUID: CFTimeInterval] = [:]
    private var meshBusy = false
    private var depthAt: CFTimeInterval = 0
    private var depthBusy = false
    private var visionAt: CFTimeInterval = 0
    private var visionBusy = false

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(pauseForBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(resumeFromBackground), name: UIApplication.willEnterForegroundNotification, object: nil)
        // Live conditions feed the web layer's tier choice: heat, Low Power Mode, battery, memory.
        nc.addObserver(self, selector: #selector(conditionsChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(conditionsChanged), name: Notification.Name.NSProcessInfoPowerStateDidChange, object: nil)
        nc.addObserver(self, selector: #selector(conditionsChanged), name: UIDevice.batteryLevelDidChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(conditionsChanged), name: UIDevice.batteryStateDidChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(memoryWarning), name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        DispatchQueue.main.async { UIDevice.current.isBatteryMonitoringEnabled = true }
        // Diagnostics: launched with -KINARDemo (devicectl), start AR by itself and log what the
        // web layer actually receives. Never on a normal launch.
        if ProcessInfo.processInfo.arguments.contains("-KINARDemo") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.runDiagnostics() }
        }
    }

    private func runDiagnostics() {
        NSLog("[KINAR] diagnostics: supported=%d lidar=%d sceneDepth=%d people=%d camera=%d thermal=%@",
              ARWorldTrackingConfiguration.isSupported ? 1 : 0,
              ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) ? 1 : 0,
              ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) ? 1 : 0,
              ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) ? 1 : 0,
              AVCaptureDevice.authorizationStatus(for: .video).rawValue,
              (currentConditions()["thermal"] as? String) ?? "?")
        // A counting sink in the page: proves frames, planes, mesh, depth and objects reach JS.
        eval("""
        window.__kinARdbg={f:0,p:0,m:0,d:0,o:0,c:0,last:0,dt:0,labels:[]};
        window.__kinAR={f:function(a){var g=window.__kinARdbg;var n=performance.now();if(g.last)g.dt+=n-g.last;g.last=n;g.f++;},
          p:function(){__kinARdbg.p++},r:function(){},m:function(){__kinARdbg.m++},d:function(){__kinARdbg.d++},
          o:function(o){__kinARdbg.o++;__kinARdbg.labels.push(o.label)},c:function(){__kinARdbg.c++},e:function(){}};
        """)
        mountView()
        run(reset: true)
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.bridge?.webView?.evaluateJavaScript("(function(g){var r=JSON.stringify({f:g.f,p:g.p,m:g.m,d:g.d,o:g.o,c:g.c,avgFrameMs:g.f>1?g.dt/(g.f-1):0,labels:g.labels.slice(-5)});g.f=0;g.dt=0;g.last=0;g.p=0;g.m=0;g.d=0;g.o=0;return r})(window.__kinARdbg)") { r, _ in
                NSLog("[KINAR] web received (5 s): %@", (r as? String) ?? "nil")
            }
        }
    }

    // MARK: JS API

    /// Real capabilities, never assumed: ARKit tracking, LiDAR mesh, scene depth, people
    /// occlusion, whether a back camera exists, and its permission.
    @objc func isSupported(_ call: CAPPluginCall) {
        let hasCamera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
        var info = utsname()
        uname(&info)
        let model = withUnsafePointer(to: &info.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
        call.resolve([
            "supported": ARWorldTrackingConfiguration.isSupported,
            "lidar": ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification),
            "sceneDepth": ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
            "smoothedSceneDepth": ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth),
            "people": ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth),
            "hasCamera": hasCamera,
            "camera": AVCaptureDevice.authorizationStatus(for: .video).rawValue, // 0 undetermined, 1 restricted, 2 denied, 3 authorized
            "model": model,
        ])
    }

    @objc func conditions(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.currentConditions()) }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else { return call.resolve(["running": false, "reason": "unsupported"]) }
        readFeatures(call)
        DispatchQueue.main.async {
            self.mountView()
            self.run(reset: true)
            call.resolve(["running": true])
        }
    }

    /// Change tier features live (camera image on/off, mesh, depth, rates) without losing tracking:
    /// the KIN stays exactly where it is in the room.
    @objc func configure(_ call: CAPPluginCall) {
        readFeatures(call)
        DispatchQueue.main.async {
            self.arView?.isHidden = !self.showVideo
            if self.running { self.run(reset: false) }
            call.resolve(["ok": true])
        }
    }

    /// AR+ photo: the real camera frame with the rendered KIN composited on top, offered through the
    /// share sheet. Only ever on the player's explicit tap; nothing is saved otherwise.
    @objc func snapshot(_ call: CAPPluginCall) {
        guard let b64 = call.getString("png"), let data = Data(base64Encoded: b64.replacingOccurrences(of: "data:image/png;base64,", with: "")),
              let overlay = UIImage(data: data)
        else { return call.reject("no image") }
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView, let vc = self.bridge?.viewController else { return call.reject("no view") }
            let size = web.bounds.size
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = UIScreen.main.scale
            let image = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
                if self.showVideo, let cam = self.arView?.snapshot() {
                    cam.draw(in: CGRect(origin: .zero, size: size))
                } else {
                    UIColor(red: 0.043, green: 0.051, blue: 0.071, alpha: 1).setFill()
                    ctx.fill(CGRect(origin: .zero, size: size))
                }
                overlay.draw(in: CGRect(origin: .zero, size: size))
            }
            let share = UIActivityViewController(activityItems: [image], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = web
            share.popoverPresentationController?.sourceRect = CGRect(x: size.width / 2, y: size.height - 80, width: 1, height: 1)
            share.completionWithItemsHandler = { _, completed, _, _ in call.resolve(["shared": completed]) }
            vc.present(share, animated: true)
        }
    }

    private func readFeatures(_ call: CAPPluginCall) {
        if let v = call.getBool("video") { showVideo = v }
        if let v = call.getBool("people") { wantPeople = v }
        if let v = call.getBool("mesh") { wantMesh = v }
        if let v = call.getBool("sceneDepth") { wantSceneDepth = v }
        if let v = call.getBool("objects") { wantObjects = v }
        if let hz = call.getDouble("meshHz") { meshInterval = hz > 0 ? 1 / hz : .infinity }
        if let hz = call.getDouble("depthHz") { depthInterval = hz > 0 ? 1 / hz : .infinity }
    }

    private func currentConditions() -> [String: Any] {
        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = "nominal"
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        @unknown default: thermal = "nominal"
        }
        let dev = UIDevice.current
        return [
            "thermal": thermal,
            "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "battery": dev.batteryLevel >= 0 ? Double(dev.batteryLevel) : NSNull(),
            "charging": dev.batteryState == .charging || dev.batteryState == .full,
        ]
    }

    @objc private func conditionsChanged() {
        DispatchQueue.main.async {
            self.eval("window.__kinAR&&__kinAR.c(\(Self.json(self.currentConditions())))")
        }
    }

    @objc private func memoryWarning() {
        DispatchQueue.main.async {
            var c = self.currentConditions()
            c["memoryWarning"] = true
            self.eval("window.__kinAR&&__kinAR.c(\(Self.json(c)))")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.unmountView()
            call.resolve(["running": false])
        }
    }

    /// Screen point (CSS px == UIKit points: the web view fills the screen) → real-world surface.
    @objc func raycast(_ call: CAPPluginCall) {
        let x = call.getDouble("x", 0), y = call.getDouble("y", 0)
        DispatchQueue.main.async {
            guard let view = self.arView, self.running,
                  let q = view.raycastQuery(from: CGPoint(x: x, y: y), allowing: .estimatedPlane, alignment: .any),
                  let hit = view.session.raycast(q).first
            else { return call.resolve(["hit": false]) }
            let t = hit.worldTransform
            var cls = "unknown"
            if let plane = hit.anchor as? ARPlaneAnchor { cls = Self.planeClass(plane) }
            call.resolve([
                "hit": true,
                "position": [t.columns.3.x, t.columns.3.y, t.columns.3.z],
                "normal": [t.columns.1.x, t.columns.1.y, t.columns.1.z],
                "classification": cls,
                "target": hit.target == .existingPlaneGeometry ? "plane" : "estimated",
            ])
        }
    }

    @objc func stats(_ call: CAPPluginCall) {
        call.resolve(lastStats)
    }

    // MARK: Session

    private func mountView() {
        guard arView == nil, let web = bridge?.webView else { return }
        // The bridge view controller's view IS the web view, so the AR view goes into its superview,
        // right behind it, and follows its frame.
        let host = web.superview ?? web.window
        let v = ARSCNView(frame: web.frame)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.automaticallyUpdatesLighting = false
        v.rendersCameraGrain = true
        v.rendersMotionBlur = false
        v.isUserInteractionEnabled = false
        v.session.delegate = self
        v.session.delegateQueue = nil // main
        host?.insertSubview(v, belowSubview: web)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        arView = v
    }

    private func unmountView() {
        running = false
        arView?.session.pause()
        arView?.removeFromSuperview()
        arView = nil
        if let web = bridge?.webView {
            web.isOpaque = true
            web.backgroundColor = UIColor(red: 0.043, green: 0.051, blue: 0.071, alpha: 1)
        }
        planeSentAt.removeAll()
        meshSentAt.removeAll()
    }

    /// (Re)configure the session from the ladder features. `reset: false` keeps the world map, so
    /// changing tiers never moves the KIN.
    private func run(reset: Bool) {
        guard let view = arView else { return }
        view.isHidden = !showVideo
        let c = ARWorldTrackingConfiguration()
        c.planeDetection = [.horizontal, .vertical]
        c.environmentTexturing = .automatic
        c.isLightEstimationEnabled = true
        if wantMesh, ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
            c.sceneReconstruction = .meshWithClassification
        }
        // LiDAR scene depth occludes everything (furniture moving, pets, people); without it,
        // person segmentation still hides the KIN behind people.
        if wantSceneDepth, ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
            c.frameSemantics.insert(.smoothedSceneDepth)
        } else if wantPeople, ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
            c.frameSemantics.insert(.personSegmentationWithDepth)
        }
        view.session.run(c, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
        running = true
        NSLog("[KINAR] session %@ video=%d mesh=%d sceneDepth=%d people=%d", reset ? "started" : "reconfigured", showVideo ? 1 : 0,
              c.sceneReconstruction == .meshWithClassification ? 1 : 0, c.frameSemantics.contains(.smoothedSceneDepth) ? 1 : 0,
              c.frameSemantics.contains(.personSegmentationWithDepth) ? 1 : 0)
    }

    @objc private func pauseForBackground() {
        guard running else { return }
        arView?.session.pause()
    }

    @objc private func resumeFromBackground() {
        guard running, let view = arView, let c = view.session.configuration else { return }
        view.session.run(c) // keep the map: the KIN stays where it was
    }

    // MARK: Frames

    public func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard running, let view = arView else { return }
        let t0 = CACurrentMediaTime()
        let orientation = view.window?.windowScene?.interfaceOrientation ?? .portrait
        let size = view.bounds.size
        let cam = frame.camera
        let proj = cam.projectionMatrix(for: orientation, viewportSize: size, zNear: 0.01, zFar: 60)
        let viewM = cam.viewMatrix(for: orientation)
        // tracking: 0 none, 1 limited, 2 normal; reason: 0 none, 1 initializing, 2 excessive motion,
        // 3 insufficient features (too dark or blank surfaces), 4 relocalizing
        var tracking = 0, reason = 0
        switch cam.trackingState {
        case .normal: tracking = 2
        case .limited(let r):
            tracking = 1
            switch r {
            case .initializing: reason = 1
            case .excessiveMotion: reason = 2
            case .insufficientFeatures: reason = 3
            case .relocalizing: reason = 4
            @unknown default: reason = 0
            }
        default: tracking = 0
        }
        if evalInFlight {
            dropped += 1
        } else {
            var nums: [Float] = [Float(frame.timestamp.truncatingRemainder(dividingBy: 100_000)), Float(tracking)]
            nums.reserveCapacity(37)
            Self.append(proj, to: &nums)
            Self.append(viewM, to: &nums)
            nums.append(Float(frame.lightEstimate?.ambientIntensity ?? 1000))
            nums.append(Float(frame.lightEstimate?.ambientColorTemperature ?? 6500))
            nums.append(Float(reason))
            let js = "window.__kinAR&&__kinAR.f([" + nums.map { Self.fmt($0) }.joined(separator: ",") + "])"
            buildMs += (CACurrentMediaTime() - t0) * 1000
            evalInFlight = true
            let sentAt = CACurrentMediaTime()
            bridge?.webView?.evaluateJavaScript(js) { [weak self] _, _ in
                guard let self else { return }
                self.evalInFlight = false
                self.rtMs += (CACurrentMediaTime() - sentAt) * 1000
                self.sent += 1
            }
        }
        let now = CACurrentMediaTime()
        let hasDepth = frame.smoothedSceneDepth != nil || frame.sceneDepth != nil || frame.segmentationBuffer != nil
        if hasDepth, !depthBusy, now - depthAt > depthInterval {
            depthAt = now
            sendDepth(frame, orientation: orientation, size: size)
        }
        if wantObjects, !visionBusy, now - visionAt > 1.0 {
            visionAt = now
            recognise(frame, orientation: orientation, size: size)
        }
        if now - statsAt > 5 { logStats(now) }
    }

    public func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { handle(anchors) }
    public func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { handle(anchors) }
    public func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        for a in anchors {
            planeSentAt[a.identifier] = nil
            meshSentAt[a.identifier] = nil
            eval("window.__kinAR&&__kinAR.r('\(a.identifier.uuidString)')")
        }
    }

    public func session(_ session: ARSession, didFailWithError error: Error) {
        NSLog("[KINAR] session error: %@", error.localizedDescription)
        eval("window.__kinAR&&__kinAR.e(\(Self.jsonString(error.localizedDescription)))")
    }

    private func handle(_ anchors: [ARAnchor]) {
        let now = CACurrentMediaTime()
        for a in anchors {
            if let p = a as? ARPlaneAnchor {
                if let at = planeSentAt[p.identifier], now - at < 0.5 { continue }
                planeSentAt[p.identifier] = now
                planesSent += 1
                // iOS 16+ reports a rotated extent; iOS 15 has the axis-aligned (deprecated) one.
                var ew = p.extent.x, eh = p.extent.z, erot: Float = 0
                if #available(iOS 16.0, *) {
                    ew = p.planeExtent.width; eh = p.planeExtent.height; erot = p.planeExtent.rotationOnYAxis
                }
                var t: [Float] = []
                Self.append(p.transform, to: &t)
                let obj: [String: Any] = [
                    "id": p.identifier.uuidString, "cls": Self.planeClass(p),
                    "align": p.alignment == .horizontal ? "h" : "v",
                    "t": t, "c": [p.center.x, p.center.y, p.center.z],
                    "ex": ew, "ez": eh, "rot": erot,
                ]
                eval("window.__kinAR&&__kinAR.p(\(Self.json(obj)))")
            } else if let m = a as? ARMeshAnchor, wantMesh {
                if let at = meshSentAt[m.identifier], now - at < meshInterval { continue }
                if meshBusy { continue }
                meshSentAt[m.identifier] = now
                sendMesh(m)
            }
        }
    }

    private func sendMesh(_ m: ARMeshAnchor) {
        meshBusy = true
        let g = m.geometry
        var t: [Float] = []
        Self.append(m.transform, to: &t)
        let id = m.identifier.uuidString
        work.async { [weak self] in
            let vCount = g.vertices.count
            let fCount = g.faces.count
            // Vertices: packed float3 (stride may be 16).
            var verts = [Float](repeating: 0, count: vCount * 3)
            let vb = g.vertices.buffer.contents().advanced(by: g.vertices.offset)
            for i in 0..<vCount {
                let p = vb.advanced(by: i * g.vertices.stride).assumingMemoryBound(to: Float.self)
                verts[i * 3] = p[0]; verts[i * 3 + 1] = p[1]; verts[i * 3 + 2] = p[2]
            }
            // Faces: indices (UInt32) → UInt16 when they fit (they almost always do per anchor).
            let ib = g.faces.buffer.contents()
            let n = fCount * 3
            let wide = vCount > 65_535
            var idxData = Data(capacity: n * (wide ? 4 : 2))
            for i in 0..<n {
                let v: UInt32 = g.faces.bytesPerIndex == 4
                    ? ib.advanced(by: i * 4).assumingMemoryBound(to: UInt32.self).pointee
                    : UInt32(ib.advanced(by: i * 2).assumingMemoryBound(to: UInt16.self).pointee)
                if wide { var x = v; idxData.append(Data(bytes: &x, count: 4)) } else { var x = UInt16(v); idxData.append(Data(bytes: &x, count: 2)) }
            }
            var cls = Data(count: fCount)
            if let c = g.classification {
                let cb = c.buffer.contents().advanced(by: c.offset)
                cls.withUnsafeMutableBytes { dst in
                    for i in 0..<fCount { dst[i] = cb.advanced(by: i * c.stride).assumingMemoryBound(to: UInt8.self).pointee }
                }
            }
            let vData = verts.withUnsafeBufferPointer { Data(buffer: $0) }
            let obj: [String: Any] = [
                "id": id, "t": t, "nv": vCount, "nf": fCount, "wide": wide,
                "v": vData.base64EncodedString(), "i": idxData.base64EncodedString(), "c": cls.base64EncodedString(),
            ]
            let js = "window.__kinAR&&__kinAR.m(\(Self.json(obj)))"
            DispatchQueue.main.async {
                guard let self else { return }
                self.meshBytes += js.utf8.count
                self.eval(js) { self.meshBusy = false }
            }
        }
    }

    /// Occlusion depth for the web layer, 128×96, 8-bit metres × 50 (0 = nothing to occlude), plus
    /// the normalised screen → image transform. LiDAR scene depth covers everything in the room;
    /// without LiDAR, person segmentation gives depth for people only.
    private func sendDepth(_ frame: ARFrame, orientation: UIInterfaceOrientation, size: CGSize) {
        if let scene = (frame.smoothedSceneDepth ?? frame.sceneDepth)?.depthMap {
            sendSceneDepth(scene, inv: frame.displayTransform(for: orientation, viewportSize: size).inverted())
            return
        }
        guard let seg = frame.segmentationBuffer, let depth = frame.estimatedDepthData else { return }
        depthBusy = true
        let inv = frame.displayTransform(for: orientation, viewportSize: size).inverted()
        work.async { [weak self] in
            CVPixelBufferLockBaseAddress(seg, .readOnly)
            CVPixelBufferLockBaseAddress(depth, .readOnly)
            defer {
                CVPixelBufferUnlockBaseAddress(seg, .readOnly)
                CVPixelBufferUnlockBaseAddress(depth, .readOnly)
            }
            let sw = CVPixelBufferGetWidth(seg), sh = CVPixelBufferGetHeight(seg)
            let dw = CVPixelBufferGetWidth(depth), dh = CVPixelBufferGetHeight(depth)
            let ow = 128, oh = 96
            guard let sb = CVPixelBufferGetBaseAddress(seg), let db = CVPixelBufferGetBaseAddress(depth) else {
                DispatchQueue.main.async { self?.depthBusy = false }
                return
            }
            let srow = CVPixelBufferGetBytesPerRow(seg), drow = CVPixelBufferGetBytesPerRow(depth)
            var out = Data(count: ow * oh)
            var any = false
            out.withUnsafeMutableBytes { (o: UnsafeMutableRawBufferPointer) in
                for y in 0..<oh {
                    for x in 0..<ow {
                        let sx = x * sw / ow, sy = y * sh / oh
                        let person = sb.advanced(by: sy * srow + sx).assumingMemoryBound(to: UInt8.self).pointee
                        if person == 0 { continue }
                        let dx = x * dw / ow, dy = y * dh / oh
                        let m = db.advanced(by: dy * drow + dx * 4).assumingMemoryBound(to: Float32.self).pointee
                        o[y * ow + x] = UInt8(max(1, min(255, Int(m * 50))))
                        any = true
                    }
                }
            }
            let obj: [String: Any] = [
                "w": ow, "h": oh, "any": any, "src": "people",
                "b": any ? out.base64EncodedString() : "",
                "t": [inv.a, inv.b, inv.c, inv.d, inv.tx, inv.ty],
            ]
            let js = "window.__kinAR&&__kinAR.d(\(Self.json(obj)))"
            DispatchQueue.main.async {
                guard let self else { return }
                self.depthBytes += js.utf8.count
                self.eval(js) { self.depthBusy = false }
            }
        }
    }

    private func sendSceneDepth(_ depth: CVPixelBuffer, inv: CGAffineTransform) {
        depthBusy = true
        work.async { [weak self] in
            CVPixelBufferLockBaseAddress(depth, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
            let dw = CVPixelBufferGetWidth(depth), dh = CVPixelBufferGetHeight(depth)
            let drow = CVPixelBufferGetBytesPerRow(depth)
            let ow = 128, oh = 96
            guard let db = CVPixelBufferGetBaseAddress(depth) else {
                DispatchQueue.main.async { self?.depthBusy = false }
                return
            }
            var out = Data(count: ow * oh)
            out.withUnsafeMutableBytes { (o: UnsafeMutableRawBufferPointer) in
                for y in 0..<oh {
                    for x in 0..<ow {
                        let m = db.advanced(by: (y * dh / oh) * drow + (x * dw / ow) * 4).assumingMemoryBound(to: Float32.self).pointee
                        // Beyond ~5 m nothing needs occluding at KIN's scale; NaN/0 = unknown.
                        o[y * ow + x] = m.isFinite && m > 0 ? UInt8(max(1, min(255, Int(m * 50)))) : 0
                    }
                }
            }
            let obj: [String: Any] = [
                "w": ow, "h": oh, "any": true, "src": "scene",
                "b": out.base64EncodedString(), "t": [inv.a, inv.b, inv.c, inv.d, inv.tx, inv.ty],
            ]
            let js = "window.__kinAR&&__kinAR.d(\(Self.json(obj)))"
            DispatchQueue.main.async {
                guard let self else { return }
                self.depthBytes += js.utf8.count
                self.eval(js) { self.depthBusy = false }
            }
        }
    }

    /// One prominent real object at a time: objectness saliency finds it, Apple's on-device image
    /// classifier names it (restricted to the box), a raycast puts it in the room.
    private func recognise(_ frame: ARFrame, orientation: UIInterfaceOrientation, size: CGSize) {
        visionBusy = true
        let image = frame.capturedImage
        let display = frame.displayTransform(for: orientation, viewportSize: size)
        let fx = frame.camera.intrinsics.columns.0.x
        // Copy what we need: holding the ARFrame itself would starve ARKit's frame pool.
        let imgH = Float(frame.camera.imageResolution.height)
        vision.async { [weak self] in
            defer { DispatchQueue.main.async { self?.visionBusy = false } }
            let handler = VNImageRequestHandler(cvPixelBuffer: image, orientation: .right)
            let saliency = VNGenerateObjectnessBasedSaliencyImageRequest()
            try? handler.perform([saliency])
            guard let box = (saliency.results?.first?.salientObjects?.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height })?.boundingBox,
                  box.width * box.height > 0.01
            else { return }
            let classify = VNClassifyImageRequest()
            classify.regionOfInterest = box
            try? handler.perform([classify])
            guard let best = (classify.results ?? []).prefix(12).compactMap({ obs -> (String, String, Float)? in
                guard obs.confidence > 0.25, let friendly = ARObjects.friendly(obs.identifier) else { return nil }
                return (friendly, obs.identifier, obs.confidence)
            }).first else { return }
            // Box centre: upright (.right) Vision coords (origin bottom-left) → captured image coords
            // (origin top-left) → view coords via ARKit's display transform.
            let capX = 1 - box.midY, capY = 1 - box.midX
            let vp = CGPoint(x: capX, y: capY).applying(display)
            DispatchQueue.main.async {
                guard let self, let view = self.arView, self.running else { return }
                let pt = CGPoint(x: vp.x * size.width, y: vp.y * size.height)
                guard let q = view.raycastQuery(from: pt, allowing: .estimatedPlane, alignment: .any),
                      let hit = view.session.raycast(q).first,
                      let camT = view.session.currentFrame?.camera.transform
                else { return }
                let p = hit.worldTransform.columns.3
                let dist = simd_distance(SIMD3(p.x, p.y, p.z), SIMD3(camT.columns.3.x, camT.columns.3.y, camT.columns.3.z))
                // Upright box width maps to the captured image's height axis for portrait.
                let widthPx = Float(box.width) * imgH
                let extent = max(0.05, min(2.0, widthPx * dist / fx))
                self.objectsSeen += 1
                let obj: [String: Any] = [
                    "label": best.0, "raw": best.1, "conf": best.2,
                    "p": [p.x, p.y, p.z], "ext": extent, "sx": pt.x, "sy": pt.y,
                ]
                self.eval("window.__kinAR&&__kinAR.o(\(Self.json(obj)))")
            }
        }
    }

    // MARK: helpers

    private func eval(_ js: String, done: (() -> Void)? = nil) {
        guard let web = bridge?.webView else { done?(); return }
        web.evaluateJavaScript(js) { _, _ in done?() }
    }

    private func logStats(_ now: CFTimeInterval) {
        let secs = now - statsAt
        let n = max(1, sent)
        lastStats = [
            "fps": Double(sent) / secs, "dropped": dropped, "buildMs": buildMs / Double(n), "roundTripMs": rtMs / Double(n),
            "meshKBps": Double(meshBytes) / 1024 / secs, "depthKBps": Double(depthBytes) / 1024 / secs,
            "planes": planesSent, "objects": objectsSeen,
        ]
        NSLog("[KINAR] stats fps=%.1f dropped=%d build=%.3fms rt=%.2fms meshKB/s=%.1f depthKB/s=%.1f planes=%d objects=%d",
              Double(sent) / secs, dropped, buildMs / Double(n), rtMs / Double(n),
              Double(meshBytes) / 1024 / secs, Double(depthBytes) / 1024 / secs, planesSent, objectsSeen)
        statsAt = now
        sent = 0; dropped = 0; buildMs = 0; rtMs = 0; meshBytes = 0; depthBytes = 0
    }

    private static func append(_ m: simd_float4x4, to a: inout [Float]) {
        for c in [m.columns.0, m.columns.1, m.columns.2, m.columns.3] { a.append(c.x); a.append(c.y); a.append(c.z); a.append(c.w) }
    }

    private static func fmt(_ x: Float) -> String {
        x == 0 ? "0" : String(format: "%.6g", x)
    }

    private static func planeClass(_ p: ARPlaneAnchor) -> String {
        switch p.classification {
        case .floor: return "floor"
        case .table: return "table"
        case .seat: return "seat"
        case .wall: return "wall"
        case .ceiling: return "ceiling"
        case .door: return "door"
        case .window: return "window"
        default: return "unknown"
        }
    }

    private static func json(_ o: [String: Any]) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return "{}" }
        return s
    }

    private static func jsonString(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]), let a = String(data: d, encoding: .utf8) else { return "\"\"" }
        return String(a.dropFirst().dropLast())
    }
}

/// Apple's on-device classifier speaks a large taxonomy; KIN cares about a friendly few.
enum ARObjects {
    private static let map: [(String, String)] = [
        ("cup", "cup"), ("mug", "cup"), ("coffee", "cup"), ("teacup", "cup"), ("glass", "cup"),
        ("bottle", "bottle"), ("houseplant", "plant"), ("plant", "plant"), ("flower", "plant"), ("cactus", "plant"),
        ("succulent", "plant"), ("laptop", "laptop"), ("computer", "laptop"), ("keyboard", "keyboard"),
        ("chair", "chair"), ("sofa", "sofa"), ("couch", "sofa"), ("book", "book"), ("shoe", "shoe"),
        ("sneaker", "shoe"), ("footwear", "shoe"), ("boot", "shoe"), ("ball", "ball"), ("teddy", "plush"),
        ("stuffed", "plush"), ("toy", "toy"), ("cat", "cat"), ("dog", "dog"), ("lamp", "lamp"),
        ("pillow", "pillow"), ("cushion", "pillow"), ("blanket", "blanket"), ("fruit", "fruit"), ("apple", "fruit"),
        ("banana", "fruit"), ("orange", "fruit"), ("bowl", "bowl"), ("phone", "phone"), ("television", "screen"),
        ("monitor", "screen"), ("guitar", "guitar"), ("table", "table"), ("desk", "table"), ("bed", "bed"),
        ("window", "window"), ("door", "door"), ("headphones", "headphones"), ("hat", "hat"), ("backpack", "bag"), ("bag", "bag"),
    ]

    static func friendly(_ identifier: String) -> String? {
        let id = identifier.lowercased()
        for (needle, label) in map where id.contains(needle) { return label }
        return nil
    }
}
