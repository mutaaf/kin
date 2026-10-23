// AR mode (Pokémon GO AR+ style): the real room through the camera is the default on capable
// devices. Plane detection + tap-to-place, LiDAR meshing for occlusion and physics, people
// occlusion, and light estimation driving the key light. A capability ladder (ported from
// src/ar/tiers.ts) keeps it graceful on non-LiDAR phones and under thermal pressure.
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem.EnhancedTouch;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using Touch = UnityEngine.InputSystem.EnhancedTouch.Touch;

namespace Kin.App
{
    public enum ArTier { Full, CameraOnly, Diorama }

    public class KinAR : MonoBehaviour
    {
        public ARSession session;
        public ARCameraManager cameraManager;
        public ARRaycastManager raycaster;
        public ARPlaneManager planes;
        public AROcclusionManager occlusion;
        public ARMeshManager meshing;
        public Camera arCamera;
        public Light keyLight;
        public KinLife life;
        public GameObject habitatRoot;
        public Camera habitatCamera;

        public ArTier Tier { get; private set; } = ArTier.Diorama;
        public bool Active => Tier != ArTier.Diorama;
        bool placed;
        static readonly List<ARRaycastHit> Hits = new();

        IEnumerator Start()
        {
            EnhancedTouchSupport.Enable();
            SetAr(false);
            if (ARSession.state == ARSessionState.None || ARSession.state == ARSessionState.CheckingAvailability)
                yield return ARSession.CheckAvailability();
            if (ARSession.state == ARSessionState.Unsupported) { Tier = ArTier.Diorama; yield break; }
            Tier = SupportsMeshing() ? ArTier.Full : ArTier.CameraOnly;
            SetAr(true);
        }

        /// <summary>The tier ladder: LiDAR phones get meshing + depth occlusion; others planes + people.</summary>
        bool SupportsMeshing()
        {
            var descs = new List<UnityEngine.XR.XRMeshSubsystemDescriptor>();
            SubsystemManager.GetSubsystemDescriptors(descs);
            return descs.Count > 0;
        }

        public void SetAr(bool on)
        {
            if (session) session.enabled = on;
            if (arCamera) arCamera.gameObject.SetActive(on);
            if (habitatRoot) habitatRoot.SetActive(!on);
            if (habitatCamera) habitatCamera.gameObject.SetActive(!on);
            if (meshing) meshing.enabled = on && Tier == ArTier.Full;
            if (occlusion)
            {
                occlusion.requestedEnvironmentDepthMode = Tier == ArTier.Full ? EnvironmentDepthMode.Best : EnvironmentDepthMode.Disabled;
                occlusion.requestedHumanStencilMode = HumanSegmentationStencilMode.Best;
                occlusion.requestedHumanDepthMode = HumanSegmentationDepthMode.Best;
            }
            if (life) life.viewCamera = on ? arCamera : habitatCamera;
            if (!on) Tier = ArTier.Diorama;
        }

        void OnEnable() { if (cameraManager) cameraManager.frameReceived += OnFrame; }
        void OnDisable() { if (cameraManager) cameraManager.frameReceived -= OnFrame; }

        // Real room light drives the key light, so the KIN sits in the room's actual lighting.
        void OnFrame(ARCameraFrameEventArgs e)
        {
            if (!keyLight) return;
            var le = e.lightEstimation;
            if (le.averageBrightness.HasValue) keyLight.intensity = Mathf.Lerp(0.4f, 1.6f, le.averageBrightness.Value);
            if (le.averageColorTemperature.HasValue) keyLight.colorTemperature = le.averageColorTemperature.Value;
            if (le.colorCorrection.HasValue) keyLight.color = le.colorCorrection.Value;
            if (le.mainLightDirection.HasValue) keyLight.transform.rotation = Quaternion.LookRotation(le.mainLightDirection.Value);
            if (le.ambientSphericalHarmonics.HasValue)
            {
                RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Skybox;
                RenderSettings.ambientProbe = le.ambientSphericalHarmonics.Value;
            }
        }

        void Update()
        {
            if (!Active || raycaster == null) return;
            // First placement happens automatically on the first good surface; taps move it.
            Vector2? tap = null;
            if (Touch.activeTouches.Count > 0 && Touch.activeTouches[0].phase == UnityEngine.InputSystem.TouchPhase.Ended
                && Touch.activeTouches[0].time - Touch.activeTouches[0].startTime < 0.3f)
                tap = Touch.activeTouches[0].screenPosition;
            if (!placed) tap = new Vector2(Screen.width * 0.5f, Screen.height * 0.42f);
            if (tap == null) return;
            if (raycaster.Raycast(tap.Value, Hits, TrackableType.PlaneWithinPolygon))
            {
                var pose = Hits[0].pose;
                float dist = Vector3.Distance(pose.position, arCamera.transform.position);
                if (!placed && (dist < 0.3f || dist > 3f)) return;
                // Don't steal taps meant for the KIN itself.
                if (placed && Physics.Raycast(arCamera.ScreenPointToRay(tap.Value), out var h, 10) && h.collider.GetComponentInParent<KinCreature>()) return;
                life.SetHome(pose.position);
                var look = arCamera.transform.position - pose.position;
                look.y = 0;
                if (look.sqrMagnitude > 1e-4) life.creature.transform.rotation = Quaternion.LookRotation(look);
                placed = true;
            }
        }
    }
}
