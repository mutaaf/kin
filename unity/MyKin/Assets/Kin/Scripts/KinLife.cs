// The KIN's life loop: the ported brain (Kin.Core) chooses what to do a few times a second; this
// turns each choice into motion and animation, handles touch (tap, pet by stroking), and keeps the
// record on the device. Works the same in the habitat and in AR (it only moves on its ground).
using System;
using System.Collections.Generic;
using Kin.Core;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.EnhancedTouch;
using Touch = UnityEngine.InputSystem.EnhancedTouch.Touch;

namespace Kin.App
{
    public class KinLife : MonoBehaviour
    {
        public KinCreature creature;
        public Camera viewCamera;
        public KinSky sky;
        public float roam = 0.7f;              // metres from home it wanders (scaled by the world)
        public Transform home;                 // the spot it calls home (habitat centre or AR anchor)

        KinRecord kin;
        Decision current;
        double until;
        readonly List<KinAction> recent = new();
        int tick;
        float nextThink;
        Vector3? walkTo;
        float petting;
        Vector2 lastTouch;
        Collider hitbox;
        KinZzz zzz;

        static double Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        void Awake()
        {
            EnhancedTouchSupport.Enable();
            uint seed = (uint)PlayerPrefs.GetInt("kin.seed", 0);
            if (seed == 0) { seed = (uint)UnityEngine.Random.Range(1, int.MaxValue); PlayerPrefs.SetInt("kin.seed", (int)seed); }
            kin = Creature.NewKin(Now, seed);
            if (!home) home = transform.parent ? transform.parent : null;
            // A soft capsule around the body for taps and strokes.
            var cap = creature.gameObject.AddComponent<CapsuleCollider>();
            cap.center = new Vector3(0, 0.14f, 0.02f);
            cap.radius = 0.1f;
            cap.height = 0.3f;
            cap.direction = 2;
            hitbox = cap;
            var head = creature.GetComponentsInChildren<Transform>(true);
            zzz = new GameObject("Zzz").AddComponent<KinZzz>();
            zzz.transform.SetParent(creature.transform, false);
            foreach (var t in head) if (t.name == "head") zzz.anchor = t;
        }

        void Update()
        {
            HandleTouch();
            if (Time.time >= nextThink)
            {
                nextThink = Time.time + 0.25f;
                Think();
            }
            Move();
            petting = Mathf.Max(0, petting - Time.deltaTime * 0.8f);
        }

        Weather WeatherNow() => new(20, 8, 0, false, 0.3, sky ? sky.SunElevation : 30);

        void Think()
        {
            tick++;
            var w = WeatherNow();
            kin = kin with { Drives = Brain.Drift(kin.Drives, current?.Action ?? KinAction.Idle, 0.25, petting > 0.2f, null, w) };
            if (current != null && Now < until && petting < 0.2f) return;
            if (petting > 0.2f) return;
            var ctx = new BrainContext(Now, w, petting > 0.2f, null, null);
            current = Brain.Decide(kin, ctx, recent, tick);
            recent.Add(current.Action);
            if (recent.Count > 8) recent.RemoveAt(0);
            until = Now + current.DurationMs;
            Perform(current.Action);
        }

        void Perform(KinAction a)
        {
            walkTo = null;
            creature.Wag(0);
            creature.Express(Expression.Neutral);
            if (zzz) zzz.active = a == KinAction.Sleep;
            creature.lookPoint = null;
            switch (a)
            {
                case KinAction.Wander:
                    var c = home ? home.position : Vector3.zero;
                    var d = UnityEngine.Random.insideUnitCircle * roam * transform.lossyScale.x;
                    var w = c + new Vector3(d.x, 0, d.y);
                    if (viewCamera)
                    {
                        // Mostly wander toward the camera side, so walks show the face, not the back.
                        var toCam = viewCamera.transform.position - c; toCam.y = 0;
                        if (Vector3.Dot(w - c, toCam) < 0 && UnityEngine.Random.value < 0.75f) w = c - (w - c) * 0.6f;
                    }
                    walkTo = w;
                    break;
                case KinAction.Sit:
                case KinAction.Bask:
                    // A proud sit, looking at you with a happy face (bask = content, eyes soft).
                    creature.Play("Sit_Enter");
                    creature.Express(a == KinAction.Bask ? Expression.Sleepy : Expression.Happy, 2.5f);
                    if (viewCamera) creature.lookPoint = viewCamera.transform.position;
                    break;
                case KinAction.Sleep:
                    creature.Play("Fall_Asleep");
                    creature.Express(Expression.Asleep);
                    break;
                case KinAction.Play:
                    creature.Play("Happy");
                    creature.Wag(1);
                    creature.Express(Expression.Happy);
                    break;
                case KinAction.Groom:
                    creature.Play("Idle_Look");
                    break;
                case KinAction.Shiver:
                case KinAction.Shelter:
                    creature.Play("Shake_Off");
                    creature.Express(Expression.Worried);
                    break;
                default:
                    creature.Play("Locomotion");
                    break;
            }
        }

        void Move()
        {
            var t = creature.transform;
            if (zzz && !zzz.viewCamera) zzz.viewCamera = viewCamera;
            if (walkTo == null)
            {
                creature.SetSpeed(0);
                // Idle: turn (slowly, like a pet noticing you) so the face stays toward the camera.
                if (viewCamera && current?.Action != KinAction.Sleep)
                {
                    var toCam = viewCamera.transform.position - t.position;
                    toCam.y = 0;
                    if (toCam.sqrMagnitude > 1e-4)
                    {
                        var face = Quaternion.LookRotation(toCam.normalized, Vector3.up) * Quaternion.Euler(0, 18, 0); // a 3/4 face, not dead-on
                        if (Quaternion.Angle(t.rotation, face) > 25) t.rotation = Quaternion.RotateTowards(t.rotation, face, 70 * Time.deltaTime);
                    }
                }
                return;
            }
            var to = walkTo.Value - t.position;
            to.y = 0;
            float dist = to.magnitude;
            float scale = transform.lossyScale.x;
            if (dist < 0.03f * scale) { walkTo = null; creature.SetSpeed(0); return; }
            var want = Quaternion.LookRotation(to.normalized, Vector3.up);
            t.rotation = Quaternion.RotateTowards(t.rotation, want, 160 * Time.deltaTime);
            float facing = Mathf.Clamp01(Vector3.Dot(t.forward, to.normalized));
            float speed = 0.2f * facing;
            creature.SetSpeed(speed);
            t.position += t.forward * speed * scale * Time.deltaTime;
        }

        void HandleTouch()
        {
            if (!viewCamera) return;
            Vector2? pos = null; bool began = false, moved = false;
            if (Touch.activeTouches.Count > 0)
            {
                var tch = Touch.activeTouches[0];
                pos = tch.screenPosition;
                began = tch.phase == UnityEngine.InputSystem.TouchPhase.Began;
                moved = tch.phase == UnityEngine.InputSystem.TouchPhase.Moved;
            }
            else if (Mouse.current != null && Mouse.current.leftButton.isPressed)
            {
                pos = Mouse.current.position.ReadValue();
                began = Mouse.current.leftButton.wasPressedThisFrame;
                moved = !began && (pos.Value - lastTouch).sqrMagnitude > 4;
            }
            if (pos == null) return;
            var ray = viewCamera.ScreenPointToRay(pos.Value);
            if (hitbox.Raycast(ray, out var hit, 50))
            {
                // Look at the finger; strokes are petting, taps are a happy hello.
                creature.lookPoint = hit.point;
                if (moved)
                {
                    petting = Mathf.Min(1, petting + 0.08f);
                    if (petting > 0.3f) { creature.Express(Expression.Petted, 1.2f); creature.Play("Petted", 0.25f); }
                }
                else if (began)
                {
                    creature.Express(Expression.Happy, 1.4f);
                    creature.Play("Happy");
                    creature.Wag(1);
                }
            }
            lastTouch = pos.Value;
        }

        /// <summary>Move the KIN's home (AR placement) and hop there.</summary>
        public void SetHome(Vector3 p)
        {
            if (!home) home = new GameObject("KinHome").transform;
            home.position = p;
            creature.transform.position = p;
            creature.Play("Hop");
            creature.Express(Expression.Surprised, 0.8f);
        }
    }
}
