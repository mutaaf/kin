// Brings the hero creature to life: shell fur, eyes that blink and emote in their material,
// cheek blush, mouth/cheek blendshapes, a head and eyes that look at what matters, and simple
// animator controls. The brain (Kin.Core) decides *what*; this decides *how it looks*.
using System.Collections.Generic;
using UnityEngine;

namespace Kin.App
{
    public enum Expression { Neutral, Happy, Petted, Sleepy, Asleep, Surprised, Worried, Curious }

    [ExecuteAlways]
    public class KinCreature : MonoBehaviour
    {
        [Header("Parts (assigned by the prefab builder)")]
        public SkinnedMeshRenderer body;
        public SkinnedMeshRenderer bodyLod1;
        public SkinnedMeshRenderer eyeL, eyeR, lids;
        public Animator animator;

        [Header("Materials")]
        public Material furMaterial;
        public Material shellMaterial;
        public Material eyeMaterialL, eyeMaterialR;

        [Header("Fur")]
        [Range(0, 24)] public int shellCount = 14;
        public Vector3 wind = new Vector3(0.0008f, 0, 0.0004f);

        [Header("Face")]
        public Expression expression = Expression.Neutral;
        [Range(0, 1)] public float blink;
        [Range(0.6f, 1.5f)] public float pupil = 1.05f;
        public Vector2 eyeLook;

        [Header("Look")]
        public Transform lookTarget;
        public Vector3? lookPoint;
        [Range(0, 1)] public float lookWeight = 1;

        readonly List<Material> shells = new();
        MaterialPropertyBlock mpbL, mpbR, mpbBody;
        Transform head, neck1, neck2, hips;
        Vector3 lastHips;
        float nextBlink, blinkT = -1;
        float happyW, sleepyW, worriedW, lidW, smileW, cheekW, mouthOW;
        Quaternion headLook = Quaternion.identity;
        float expressionUntil;
        Expression baseExpression = Expression.Neutral;
        int iSmile = -1, iOpen = -1, iO = -1, iCheeks = -1, iEars = -1;

        void OnEnable() => Build();

        // Exact eye centres: the eye mesh's bind-pose centre carried by the head bone (renderer
        // bounds on skinned meshes are approximate and drift, which mis-placed blush and lids).
        Vector3 eyeCentreL, eyeCentreR;
        float eyeRadius;
        int headIndexL = -1, headIndexR = -1;

        void CacheEyes()
        {
            int Idx(SkinnedMeshRenderer r) => r ? System.Array.FindIndex(r.bones, b => b && b.name == "head") : -1;
            headIndexL = Idx(eyeL); headIndexR = Idx(eyeR);
            if (eyeL) { eyeCentreL = eyeL.sharedMesh.bounds.center; eyeRadius = Mathf.Max(eyeL.sharedMesh.bounds.extents.x, eyeL.sharedMesh.bounds.extents.y); }
            if (eyeR) eyeCentreR = eyeR.sharedMesh.bounds.center;
        }

        Vector3 EyeWorld(SkinnedMeshRenderer r, int headIdx, Vector3 meshCentre)
        {
            if (!r || headIdx < 0) return r ? r.bounds.center : Vector3.zero;
            return r.bones[headIdx].localToWorldMatrix.MultiplyPoint3x4(r.sharedMesh.bindposes[headIdx].MultiplyPoint3x4(meshCentre));
        }

        public void Build()
        {
            if (body == null) return;
            if (lids) lids.enabled = false; // expressions are drawn in the eye material
            head = Find("head"); neck1 = Find("neck_01"); neck2 = Find("neck_02"); hips = Find("hips");
            var mesh = body.sharedMesh;
            iSmile = mesh.GetBlendShapeIndex("Mouth_Smile");
            iOpen = mesh.GetBlendShapeIndex("Mouth_Open");
            iO = mesh.GetBlendShapeIndex("Mouth_O");
            iCheeks = mesh.GetBlendShapeIndex("Cheeks_Puff");
            iEars = mesh.GetBlendShapeIndex("Ears_Relax");
            SetShells(shellCount);
            CacheEyes();
            if (eyeL && eyeMaterialL) eyeL.sharedMaterial = eyeMaterialL;
            if (eyeR && eyeMaterialR) eyeR.sharedMaterial = eyeMaterialR;
            mpbL ??= new MaterialPropertyBlock();
            mpbR ??= new MaterialPropertyBlock();
            mpbBody ??= new MaterialPropertyBlock();
            nextBlink = Time.time + Random.Range(1.5f, 4f);
            if (hips) lastHips = hips.position;
        }

        /// <summary>Fur quality ladder: 0 = no shells … 24. Rebuilds the extra materials.</summary>
        public void SetShells(int n)
        {
            shellCount = Mathf.Clamp(n, 0, 24);
            foreach (var m in shells) if (m) DestroyImmediate(m);
            shells.Clear();
            var mats = new List<Material> { furMaterial };
            for (int i = 0; i < shellCount && shellMaterial; i++)
            {
                var m = new Material(shellMaterial) { name = $"Shell_{i}", hideFlags = HideFlags.DontSave };
                m.SetFloat("_ShellH", (i + 1f) / shellCount);
                m.renderQueue = 2450 + i;
                shells.Add(m);
                mats.Add(m);
            }
            body.sharedMaterials = mats.ToArray();
            if (bodyLod1) bodyLod1.sharedMaterials = new[] { furMaterial };
        }

        Transform Find(string bone)
        {
            foreach (var b in body.bones) if (b && b.name == bone) return b;
            return null;
        }

        /// <summary>Midpoint between the eyes, in world space.</summary>
        public Vector3 FaceCentre()
        {
            if (headIndexL < 0) CacheEyes();
            return (EyeWorld(eyeL, headIndexL, eyeCentreL) + EyeWorld(eyeR, headIndexR, eyeCentreR)) * 0.5f;
        }

        // ── Public controls ───────────────────────────────────────────────────────────────────
        public void Express(Expression e, float seconds = 0)
        {
            if (seconds <= 0) { baseExpression = e; expression = e; expressionUntil = 0; return; }
            expression = e;
            expressionUntil = Time.time + seconds;
        }

        public void Play(string state, float fade = 0.18f)
        {
            if (animator && animator.isActiveAndEnabled) animator.CrossFadeInFixedTime(state, fade);
        }

        public void SetSpeed(float metresPerSecond)
        {
            if (animator && animator.isActiveAndEnabled) animator.SetFloat("Speed", metresPerSecond);
        }

        public void Wag(float w) { if (animator && animator.layerCount > 1) animator.SetLayerWeight(1, w); }

        // ── Per frame ─────────────────────────────────────────────────────────────────────────
        void Update() => Tick(Application.isPlaying ? Time.deltaTime : 0.016f, Application.isPlaying);

        /// <summary>Advance the face. Exposed so editor capture can pose a frame deterministically.</summary>
        public void Tick(float dt, bool live)
        {
            if (body == null) return;
            if (expressionUntil > 0 && Time.time > expressionUntil) { expression = baseExpression; expressionUntil = 0; }

            // Blinks: random 2.5–6 s, occasionally a double blink; none while happy-squinting/asleep.
            if (live)
            {
                if (blinkT < 0 && Time.time > nextBlink) blinkT = 0;
                if (blinkT >= 0)
                {
                    blinkT += dt;
                    blink = Mathf.Sin(Mathf.Clamp01(blinkT / 0.16f) * Mathf.PI);
                    if (blinkT > 0.16f)
                    {
                        blinkT = -1; blink = 0;
                        nextBlink = Time.time + (Random.value < 0.15f ? 0.22f : Random.Range(2.5f, 6f));
                    }
                }
            }

            float tHappy = expression is Expression.Happy or Expression.Petted ? 1 : 0;
            float tSleepy = expression == Expression.Sleepy ? 1 : 0;
            float tWorried = expression == Expression.Worried ? 1 : 0;
            float tLid = expression == Expression.Asleep ? 1 : expression == Expression.Surprised ? 0 : blink;
            float tSmile = expression switch { Expression.Happy => 1, Expression.Petted => 0.8f, Expression.Curious => 0.3f, Expression.Worried => 0, _ => 0.35f };
            float tCheek = expression == Expression.Petted ? 1 : expression == Expression.Happy ? 0.7f : 0;
            float tO = expression == Expression.Surprised ? 0.8f : 0;
            float k = live ? 1 - Mathf.Exp(-dt * 14) : 1;
            happyW = Mathf.Lerp(happyW, tHappy, k);
            sleepyW = Mathf.Lerp(sleepyW, tSleepy, k);
            worriedW = Mathf.Lerp(worriedW, tWorried, k);
            lidW = live && blinkT >= 0 ? tLid : Mathf.Lerp(lidW, tLid, k);
            smileW = Mathf.Lerp(smileW, tSmile, k);
            cheekW = Mathf.Lerp(cheekW, tCheek, k);
            mouthOW = Mathf.Lerp(mouthOW, tO, k);
            float targetPupil = expression == Expression.Surprised ? 1.3f : expression == Expression.Petted ? 1.2f : pupil;

            ApplyEye(eyeL, mpbL, +1, targetPupil);
            ApplyEye(eyeR, mpbR, -1, targetPupil);
            if (iSmile >= 0) body.SetBlendShapeWeight(iSmile, smileW * 100);
            if (iCheeks >= 0) body.SetBlendShapeWeight(iCheeks, cheekW * 100);
            if (iO >= 0) body.SetBlendShapeWeight(iO, mouthOW * 100);
            if (iEars >= 0) body.SetBlendShapeWeight(iEars, (sleepyW + (expression == Expression.Asleep ? 1 : 0)) * 60);

            // Blush follows the cheeks (just under and outside each eye), warmer when petted.
            if (eyeL && eyeR)
            {
                if (headIndexL < 0) CacheEyes();
                Vector3 l = EyeWorld(eyeL, headIndexL, eyeCentreL), r = EyeWorld(eyeR, headIndexR, eyeCentreR);
                Vector3 across = (l - r).normalized;
                Vector3 up = head ? head.up : Vector3.up;
                float rad = Vector3.Distance(l, r) * 0.42f;
                body.GetPropertyBlock(mpbBody, 0);
                mpbBody.SetVector("_CheekL", (Vector4)(l - up * rad * 1.15f + across * rad * 0.35f) + new Vector4(0, 0, 0, rad));
                mpbBody.SetVector("_CheekR", (Vector4)(r - up * rad * 1.15f - across * rad * 0.35f) + new Vector4(0, 0, 0, rad));
                mpbBody.SetFloat("_BlushAmount", 0.45f + cheekW * 0.4f + happyW * 0.15f);
                body.SetPropertyBlock(mpbBody, 0);
                // When the eyes close, fur grows in over the rim so the lid reads soft, not like a plate.
                float shut = Mathf.Max(lidW, happyW);
                if (furMaterial) Shader.SetGlobalColor("_KinLidFur", furMaterial.GetColor("_LidFur"));
                // Head axes for the eye shader: right = from the right eye to the left eye.
                Vector3 hr = (r - l).normalized;
                Vector3 hf = head ? Vector3.ProjectOnPlane(transform.forward, hr).normalized : transform.forward;
                Vector3 hu = Vector3.Cross(hf, hr).normalized;
                if (Vector3.Dot(hu, transform.up) < 0) hu = -hu;
                Shader.SetGlobalVector("_KinHeadRight", hr);
                Shader.SetGlobalVector("_KinHeadUp", hu);
                Shader.SetGlobalVector("_KinHeadFwd", hf);
                Shader.SetGlobalFloat("_KinLidClose", Mathf.SmoothStep(0, 1, Mathf.InverseLerp(0.35f, 0.9f, shut)));
                float eyeRad = eyeRadius * transform.lossyScale.x * Mathf.Lerp(1.02f, 0.5f, shut);
                Shader.SetGlobalVector("_KinEyeL", (Vector4)l + new Vector4(0, 0, 0, eyeRad));
                Shader.SetGlobalVector("_KinEyeR", (Vector4)r + new Vector4(0, 0, 0, eyeRad));
            }

            // Fur reacts to wind and trails the body's motion.
            if (hips && live)
            {
                Vector3 v = (hips.position - lastHips) / Mathf.Max(dt, 1e-4f);
                lastHips = hips.position;
                Vector3 gust = wind * (0.6f + 0.4f * Mathf.Sin(Time.time * 1.7f));
                Shader.SetGlobalVector("_KinFurForce", gust - Vector3.ClampMagnitude(v, 1.5f) * 0.0035f);
            }
            else Shader.SetGlobalVector("_KinFurForce", wind * 0.6f);
        }

        void ApplyEye(SkinnedMeshRenderer r, MaterialPropertyBlock b, float side, float pupilTarget)
        {
            if (!r) return;
            r.GetPropertyBlock(b);
            b.SetFloat("_Side", side);
            b.SetFloat("_Lid", Mathf.Max(lidW, happyW * 0)); // happy draws its own arcs
            b.SetFloat("_Happy", happyW);
            b.SetFloat("_Sleepy", sleepyW);
            b.SetFloat("_Worried", worriedW);
            b.SetFloat("_Pupil", pupilTarget);
            b.SetVector("_Look", new Vector4(eyeLook.x, eyeLook.y, 0, 0));
            r.SetPropertyBlock(b);
        }

        void LateUpdate()
        {
            if (!head || !Application.isPlaying) return;
            Vector3? target = lookTarget ? lookTarget.position : lookPoint;
            if (target == null) { headLook = Quaternion.Slerp(headLook, Quaternion.identity, Time.deltaTime * 4); }
            else
            {
                // Rotate the head (and a little of the neck) toward the target after the animation.
                Vector3 to = target.Value - head.position;
                Vector3 fwd = transform.forward;
                Quaternion want = Quaternion.FromToRotation(fwd, Vector3.Slerp(fwd, to.normalized, 0.85f));
                want = Quaternion.RotateTowards(Quaternion.identity, want, 50f);
                headLook = Quaternion.Slerp(headLook, want, Time.deltaTime * 6);
                // Eyes lead: offset the iris toward the target in eye space.
                Vector3 local = head.InverseTransformDirection(to.normalized);
                eyeLook = Vector2.Lerp(eyeLook, new Vector2(Mathf.Clamp(local.x, -1, 1) * 0.06f, Mathf.Clamp(local.y, -1, 1) * 0.04f), Time.deltaTime * 10);
            }
            Quaternion part = Quaternion.Slerp(Quaternion.identity, headLook, lookWeight);
            if (neck2) neck2.rotation = Quaternion.Slerp(Quaternion.identity, part, 0.3f) * neck2.rotation;
            head.rotation = Quaternion.Slerp(Quaternion.identity, part, 0.7f) * head.rotation;
        }

        void OnDisable()
        {
            foreach (var m in shells) if (m) DestroyImmediate(m);
            shells.Clear();
        }
    }
}
