// A soft "z z Z" that drifts up from a sleeping KIN: three pooled letters (no allocations per
// frame), billboarded to the camera, fading in and out on a slow loop.
using UnityEngine;

namespace Kin.App
{
    public class KinZzz : MonoBehaviour
    {
        public Transform anchor;      // the head
        public Camera viewCamera;
        public bool active;
        readonly TextMesh[] letters = new TextMesh[3];
        float t;

        void Awake()
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            for (int i = 0; i < letters.Length; i++)
            {
                var go = new GameObject("z" + i);
                go.transform.SetParent(transform, false);
                var tm = go.AddComponent<TextMesh>();
                tm.font = font;
                tm.text = i == 2 ? "Z" : "z";
                tm.fontSize = 64;
                tm.characterSize = 0.0016f * (1 + i * 0.35f);
                tm.anchor = TextAnchor.MiddleCenter;
                tm.color = new Color(0.86f, 0.95f, 1f, 0);
                go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
                letters[i] = tm;
            }
        }

        void LateUpdate()
        {
            t = active ? t + Time.deltaTime : 0;
            for (int i = 0; i < letters.Length; i++)
            {
                var l = letters[i];
                float u = active ? Mathf.Repeat(t * 0.33f - i * 0.28f, 1f) : 0;
                float a = active ? Mathf.Sin(u * Mathf.PI) * 0.9f : 0;
                var c = l.color; c.a = a; l.color = c;
                if (!anchor) continue;
                var up = Vector3.up * (0.03f + u * 0.08f) * transform.lossyScale.x;
                var side = (viewCamera ? viewCamera.transform.right : Vector3.right) * (0.04f + u * 0.03f + Mathf.Sin(u * 6) * 0.006f) * transform.lossyScale.x;
                l.transform.position = anchor.position + up + side;
                if (viewCamera) l.transform.rotation = viewCamera.transform.rotation;
            }
        }
    }
}
