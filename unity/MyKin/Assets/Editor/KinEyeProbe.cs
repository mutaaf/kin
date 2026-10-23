// Diagnostics: UV channels of the eye meshes (the front-projected iris UV must be channel 0).
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

public static class KinEyeProbe
{
    public static void Run()
    {
        var go = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kin/Art/kin_hero.fbx");
        foreach (var r in go.GetComponentsInChildren<SkinnedMeshRenderer>(true).Where(r => r.name.StartsWith("KIN_Eye")))
        {
            var m = r.sharedMesh;
            for (int ch = 0; ch < 4; ch++)
            {
                var uv = new List<Vector2>();
                m.GetUVs(ch, uv);
                if (uv.Count == 0) continue;
                Debug.Log($"KIN_EYEUV {r.name} ch{ch} n={uv.Count} x=[{uv.Min(u => u.x):0.00},{uv.Max(u => u.x):0.00}] y=[{uv.Min(u => u.y):0.00},{uv.Max(u => u.y):0.00}]");
            }
        }
    }
}
