// Prints what the hero FBX imported as (meshes, submeshes, blendshapes, bones, clips).
using System.Linq;
using UnityEditor;
using UnityEngine;

public static class KinInspect
{
    public static void Run()
    {
        AssetDatabase.ImportAsset("Assets/Kin/Art/kin_hero.fbx", ImportAssetOptions.ForceUpdate);
        var go = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kin/Art/kin_hero.fbx");
        foreach (var r in go.GetComponentsInChildren<Renderer>(true))
        {
            var smr = r as SkinnedMeshRenderer;
            var mesh = smr ? smr.sharedMesh : r.GetComponent<MeshFilter>()?.sharedMesh;
            var shapes = mesh ? string.Join(",", Enumerable.Range(0, mesh.blendShapeCount).Select(mesh.GetBlendShapeName)) : "";
            Debug.Log($"KIN_R {r.name} type={r.GetType().Name} parent={r.transform.parent?.name} verts={mesh?.vertexCount} sub={mesh?.subMeshCount} bones={smr?.bones.Length} shapes=[{shapes}] bounds={r.bounds.size}");
        }
        var clips = AssetDatabase.LoadAllAssetsAtPath("Assets/Kin/Art/kin_hero.fbx").OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview"));
        Debug.Log("KIN_CLIPS " + string.Join(" ", clips.Select(c => $"{c.name}:{c.length:0.00}s{(c.isLooping ? "L" : "")}")));
        Debug.Log("KIN_ROOT " + string.Join(",", go.GetComponentsInChildren<Transform>().Take(6).Select(t => t.name)));
    }
}
