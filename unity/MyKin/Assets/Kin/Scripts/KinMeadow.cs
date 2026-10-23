// Sky Meadow's living ground: thousands of instanced grass blades and glowing flowers around the
// KIN, drawn with RenderMeshInstanced (one call per few thousand), swaying with the real wind.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kin.App
{
    [ExecuteAlways]
    public class KinMeadow : MonoBehaviour
    {
        public Material grassMaterial;
        public Material flowerMaterial;
        public int blades = 9000;
        public float radius = 1.6f;
        public int flowers = 70;
        public Vector2 wind = new Vector2(0.4f, 0.15f);
        public int seed = 7;

        Mesh blade, bloom;
        readonly List<Matrix4x4[]> bladeBatches = new();
        Matrix4x4[] flowerMats;

        void OnEnable() => Build();

        public void Build()
        {
            blade = BladeMesh();
            bloom = BloomMesh();
            var r = new System.Random(seed);
            float R() => (float)r.NextDouble();
            bladeBatches.Clear();
            var batch = new List<Matrix4x4>();
            for (int i = 0; i < blades; i++)
            {
                // Denser at the edges, a clearing in the middle where the KIN lives.
                float a = R() * Mathf.PI * 2, d = Mathf.Sqrt(R()) * radius;
                if (d < 0.25f && R() < 0.6f) continue;
                var p = transform.TransformPoint(new Vector3(Mathf.Cos(a) * d, 0, Mathf.Sin(a) * d));
                float s = Mathf.Lerp(0.6f, 1.3f, R()) * Mathf.Lerp(0.5f, 1f, Mathf.InverseLerp(0.2f, 0.6f, d));
                batch.Add(Matrix4x4.TRS(p, Quaternion.Euler((R() - 0.5f) * 18, R() * 360, (R() - 0.5f) * 18), new Vector3(s, s * Mathf.Lerp(0.8f, 1.5f, R()), s)));
                if (batch.Count == 1023) { bladeBatches.Add(batch.ToArray()); batch.Clear(); }
            }
            if (batch.Count > 0) bladeBatches.Add(batch.ToArray());
            flowerMats = new Matrix4x4[flowers];
            for (int i = 0; i < flowers; i++)
            {
                float a = R() * Mathf.PI * 2, d = Mathf.Lerp(0.35f, radius * 0.95f, Mathf.Sqrt(R()));
                var p = transform.TransformPoint(new Vector3(Mathf.Cos(a) * d, Mathf.Lerp(0.05f, 0.11f, R()), Mathf.Sin(a) * d));
                flowerMats[i] = Matrix4x4.TRS(p, Quaternion.Euler(0, R() * 360, 0), Vector3.one * Mathf.Lerp(0.6f, 1.2f, R()));
            }
        }

        void Update()
        {
            Shader.SetGlobalVector("_KinWind", new Vector4(wind.x, wind.y, Application.isPlaying ? Time.time : (float)(System.DateTime.Now.TimeOfDay.TotalSeconds % 1000), 0));
            Draw(null);
        }

        /// <summary>Draws the meadow (to every camera, or one camera for captures).</summary>
        public void Draw(Camera cam)
        {
            if (!grassMaterial || blade == null) return;
            var rp = new RenderParams(grassMaterial) { shadowCastingMode = ShadowCastingMode.Off, receiveShadows = true, camera = cam };
            foreach (var b in bladeBatches) Graphics.RenderMeshInstanced(rp, blade, 0, b);
            if (flowerMaterial && flowerMats != null)
                Graphics.RenderMeshInstanced(new RenderParams(flowerMaterial) { camera = cam }, bloom, 0, flowerMats);
        }

        static Mesh BladeMesh()
        {
            // A tapered, slightly curved blade, 5 cm tall (the KIN is 28 cm): a lawn, not a jungle.
            const float h = 0.05f, w = 0.0045f;
            var v = new List<Vector3>(); var uv = new List<Vector2>(); var t = new List<int>();
            const int seg = 4;
            for (int i = 0; i <= seg; i++)
            {
                float k = i / (float)seg;
                float ww = w * (1 - k);
                float bend = k * k * 0.012f;
                v.Add(new Vector3(-ww, k * h, bend)); v.Add(new Vector3(ww, k * h, bend));
                uv.Add(new Vector2(0, k)); uv.Add(new Vector2(1, k));
            }
            for (int i = 0; i < seg; i++)
            {
                int a = i * 2;
                t.AddRange(new[] { a, a + 2, a + 1, a + 1, a + 2, a + 3 });
            }
            var m = new Mesh { name = "Blade" };
            m.SetVertices(v); m.SetUVs(0, uv); m.SetTriangles(t, 0); m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        static Mesh BloomMesh()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            var m = Instantiate(go.GetComponent<MeshFilter>().sharedMesh);
            if (Application.isPlaying) Destroy(go); else DestroyImmediate(go);
            var vs = m.vertices;
            for (int i = 0; i < vs.Length; i++) vs[i] = Vector3.Scale(vs[i], new Vector3(0.022f, 0.016f, 0.022f));
            m.vertices = vs;
            m.RecalculateBounds();
            return m;
        }
    }
}
