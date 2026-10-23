// Diagnostics: does sampling a clip move the bones, and which paths does the clip bind?
using System.Linq;
using UnityEditor;
using UnityEngine;

public static class KinAnimProbe
{
    public static void Run()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kin/Kin.prefab");
        var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        var hips = go.GetComponentsInChildren<Transform>().First(t => t.name == "hips");
        var clips = AssetDatabase.LoadAllAssetsAtPath("Assets/Kin/Art/kin_hero.fbx").OfType<AnimationClip>().ToArray();
        foreach (var n in new[] { "Sit_Loop", "Lie_Sleep", "Walk" })
        {
            var c = clips.First(x => x.name == n);
            var before = hips.localRotation.eulerAngles;
            c.SampleAnimation(go, c.length * 0.5f);
            var b = AnimationUtility.GetCurveBindings(c);
            Debug.Log($"KIN_ANIM {n} curves={b.Length} first={b.FirstOrDefault().path} hips {before} → {hips.localRotation.eulerAngles} legacy={c.legacy}");
        }
    }
}
