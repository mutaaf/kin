// Builds the hero creature's materials, Animator controller and prefab from the imported FBX.
//   scripts/unity-batch.sh <log> -executeMethod KinBuilder.BuildAll
using System.Linq;
using Kin.App;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

public static class KinBuilder
{
    const string Art = "Assets/Kin/Art/";
    const string Out = "Assets/Kin/";

    public static void BuildAll()
    {
        AssetDatabase.ImportAsset(Art + "kin_hero.fbx", ImportAssetOptions.ForceUpdate);
        var mats = BuildMaterials();
        var ctrl = BuildController();
        BuildPrefab(mats, ctrl);
        AssetDatabase.SaveAssets();
        Debug.Log("KIN_BUILD ok");
    }

    static Texture2D Tex(string n) => AssetDatabase.LoadAssetAtPath<Texture2D>(Art + "Textures/" + n);

    static Material Mat(string name, string shader)
    {
        var path = Out + "Materials/" + name + ".mat";
        System.IO.Directory.CreateDirectory(Out + "Materials");
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m == null)
        {
            m = new Material(Shader.Find(shader));
            AssetDatabase.CreateAsset(m, path);
        }
        m.shader = Shader.Find(shader);
        return m;
    }

    static (Material fur, Material shell, Material eyeL, Material eyeR) BuildMaterials()
    {
        var fur = Mat("Kin_Fur", "Kin/Fur");
        fur.SetTexture("_BaseMap", Tex("kin_basecolor.png"));
        fur.SetTexture("_NormalMap", Tex("kin_normal.png"));
        fur.SetTexture("_ORM", Tex("kin_orm.png"));
        fur.SetTexture("_CrystalMask", Tex("kin_crystal_mask.png"));
        var shell = Mat("Kin_FurShell", "Kin/FurShell");
        shell.SetTexture("_BaseMap", Tex("kin_basecolor.png"));
        shell.SetTexture("_CrystalMask", Tex("kin_crystal_mask.png"));
        var eyeL = Mat("Kin_Eye_L", "Kin/Eye");
        eyeL.SetTexture("_Iris", Tex("kin_eye_L_nocatch.png"));
        eyeL.SetFloat("_Side", 1);
        var eyeR = Mat("Kin_Eye_R", "Kin/Eye");
        eyeR.SetTexture("_Iris", Tex("kin_eye_R_nocatch.png"));
        eyeR.SetFloat("_Side", -1);
        // Lids are the face's own fur: average the base colour of body vertices in a ring just
        // above and around each eye (bind pose), so a closed eye is the same white as its brow.
        var lid = LidFurColor();
        foreach (var e in new[] { eyeL, eyeR }) e.SetColor("_FurColor", lid);
        fur.SetColor("_LidFur", lid);
        Debug.Log($"KIN_BUILD lidFur={lid}");
        foreach (var m in new[] { fur, shell, eyeL, eyeR }) EditorUtility.SetDirty(m);
        return (fur, shell, eyeL, eyeR);
    }

    static Color LidFurColor()
    {
        var go = AssetDatabase.LoadAssetAtPath<GameObject>(Art + "kin_hero.fbx");
        var smrs = go.GetComponentsInChildren<SkinnedMeshRenderer>(true);
        var body = smrs.First(r => r.name == "KIN_LOD0").sharedMesh;
        var tex = new Texture2D(2, 2);
        tex.LoadImage(System.IO.File.ReadAllBytes(Art + "Textures/kin_basecolor.png"));
        var verts = body.vertices;
        var uvs = body.uv;
        Color sum = Color.black;
        int n = 0;
        foreach (var eye in smrs.Where(r => r.name.StartsWith("KIN_Eye")))
        {
            var c = eye.sharedMesh.bounds.center;
            float r = Mathf.Max(eye.sharedMesh.bounds.extents.x, eye.sharedMesh.bounds.extents.y);
            for (int i = 0; i < verts.Length; i++)
            {
                var d = verts[i] - c;
                float dist = new Vector2(d.x, d.y).magnitude;
                // A band above the eye (brow fur), clear of the dark socket paint.
                if (dist > r * 1.5f && dist < r * 2.4f && d.y > r * 0.4f && Mathf.Abs(d.z) < r * 1.5f)
                {
                    sum += tex.GetPixelBilinear(uvs[i].x, uvs[i].y);
                    n++;
                }
            }
        }
        Object.DestroyImmediate(tex);
        var col = n > 0 ? sum / n : new Color(0.95f, 0.94f, 0.93f);
        col.a = 1;
        Debug.Log($"KIN_BUILD lidSamples={n}");
        return col;
    }

    static AnimationClip Clip(string name) =>
        AssetDatabase.LoadAllAssetsAtPath(Art + "kin_hero.fbx").OfType<AnimationClip>().FirstOrDefault(c => c.name == name);

    static AnimatorController BuildController()
    {
        var path = Out + "KinAnimator.controller";
        AssetDatabase.DeleteAsset(path);
        var ctrl = AnimatorController.CreateAnimatorControllerAtPath(path);
        ctrl.AddParameter("Speed", AnimatorControllerParameterType.Float);
        var sm = ctrl.layers[0].stateMachine;

        // Locomotion: idle → walk → trot by speed (m/s at the creature's 0.28 m scale).
        var tree = new BlendTree { name = "Locomotion", blendParameter = "Speed", blendType = BlendTreeType.Simple1D, useAutomaticThresholds = false };
        AssetDatabase.AddObjectToAsset(tree, ctrl);
        tree.AddChild(Clip("Idle"), 0f);
        tree.AddChild(Clip("Walk"), 0.22f);
        tree.AddChild(Clip("Trot"), 0.6f);
        var loco = sm.AddState("Locomotion");
        loco.motion = tree;
        sm.defaultState = loco;

        string[] loops = { "Sit_Loop", "Lie_Sleep", "Eat", "Happy", "Petted", "Hop_Loop", "Idle_Look" };
        string[] once = { "Hop", "Sit_Enter", "Sit_Exit", "Fall_Asleep", "Head_Tilt", "Shake_Off", "Yawn", "Sneeze", "Look_At_Camera", "Paw_Up" };
        foreach (var n in loops)
        {
            var c = Clip(n);
            if (c) sm.AddState(n).motion = c;
        }
        foreach (var n in once)
        {
            var c = Clip(n);
            if (!c) continue;
            var s = sm.AddState(n);
            s.motion = c;
            // One-shots return to locomotion (Sit_Enter → Sit_Loop, Fall_Asleep → Lie_Sleep).
            var next = n == "Sit_Enter" ? FindState(sm, "Sit_Loop") : n == "Fall_Asleep" ? FindState(sm, "Lie_Sleep") : loco;
            var t = s.AddTransition(next);
            t.hasExitTime = true;
            t.exitTime = 0.92f;
            t.duration = 0.15f;
        }

        // Additive layers: a tail wag the code dials in, and ear twitches.
        AddAdditive(ctrl, "Tail", "Tail_Wag", 0f);
        AddAdditive(ctrl, "Ears", "Ear_Twitch", 1f);
        EditorUtility.SetDirty(ctrl);
        return ctrl;
    }

    static AnimatorState FindState(AnimatorStateMachine sm, string n) => sm.states.First(s => s.state.name == n).state;

    static void AddAdditive(AnimatorController ctrl, string layer, string clip, float weight)
    {
        var c = Clip(clip);
        if (!c) return;
        ctrl.AddLayer(layer);
        var layers = ctrl.layers;
        var l = layers[layers.Length - 1];
        l.blendingMode = AnimatorLayerBlendingMode.Additive;
        l.defaultWeight = weight;
        var empty = l.stateMachine.AddState("Off");
        l.stateMachine.defaultState = empty;
        var s = l.stateMachine.AddState(clip);
        s.motion = c;
        if (!c.isLooping)
        {
            var t = s.AddTransition(empty);
            t.hasExitTime = true;
            t.exitTime = 1f;
            t.duration = 0.05f;
        }
        else l.stateMachine.defaultState = s;
        ctrl.layers = layers;
    }

    static void BuildPrefab((Material fur, Material shell, Material eyeL, Material eyeR) m, AnimatorController ctrl)
    {
        var src = AssetDatabase.LoadAssetAtPath<GameObject>(Art + "kin_hero.fbx");
        var go = (GameObject)PrefabUtility.InstantiatePrefab(src);
        go.name = "Kin";
        var anim = go.GetComponent<Animator>();
        if (anim == null) anim = go.AddComponent<Animator>(); // Unity objects: no ?? (fake null)
        anim.runtimeAnimatorController = ctrl;
        anim.applyRootMotion = false;
        anim.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
        SkinnedMeshRenderer R(string n) => go.GetComponentsInChildren<SkinnedMeshRenderer>(true).First(r => r.name == n);
        var body = R("KIN_LOD0");
        var lod1 = R("KIN_LOD1");
        body.sharedMaterial = m.fur;
        lod1.sharedMaterial = m.fur;
        foreach (var r in go.GetComponentsInChildren<SkinnedMeshRenderer>(true))
        {
            r.updateWhenOffscreen = false;
            r.skinnedMotionVectors = false;
        }
        // LODs: the 10k body far away (eyes stay with both).
        // Unity auto-creates a LODGroup from the _LOD0/_LOD1 mesh names; reuse it.
        var group = go.GetComponent<LODGroup>();
        if (group == null) group = go.AddComponent<LODGroup>();
        group.SetLODs(new[]
        {
            new LOD(0.18f, new Renderer[] { body, R("KIN_Eye_L"), R("KIN_Eye_R") }),
            new LOD(0.01f, new Renderer[] { lod1, R("KIN_Eye_L"), R("KIN_Eye_R") }),
        });
        var kin = go.AddComponent<KinCreature>();
        kin.body = body;
        kin.bodyLod1 = lod1;
        kin.eyeL = R("KIN_Eye_L");
        kin.eyeR = R("KIN_Eye_R");
        kin.lids = R("KIN_Lids");
        kin.animator = anim;
        kin.furMaterial = m.fur;
        kin.shellMaterial = m.shell;
        kin.eyeMaterialL = m.eyeL;
        kin.eyeMaterialR = m.eyeR;
        kin.lids.enabled = false;
        body.sharedMaterials = new[] { m.fur }; // shells are added at runtime (quality ladder)
        PrefabUtility.SaveAsPrefabAsset(go, Out + "Kin.prefab");
        Object.DestroyImmediate(go);
    }
}
