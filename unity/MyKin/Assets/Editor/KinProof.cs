// Renders proof shots of the creature in a studio (real Metal, so run with GRAPHICS=1):
//   GRAPHICS=1 scripts/unity-batch.sh <log> -executeMethod KinProof.Capture
// Output: unity/MyKin/Proof/*.png
using System.IO;
using System.Linq;
using Kin.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class KinProof
{
    static string OutDir => Path.GetFullPath(Path.Combine(Application.dataPath, "../Proof"));

    public static void Capture()
    {
        Directory.CreateDirectory(OutDir);
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var cam = Studio(out var _);
        var kin = Spawn();
        var walk = Clip("Walk");
        var idle = Clip("Idle");

        // Face close-ups.
        void Face(string name, Expression e, float blink = 0, float t = 0.8f)
        {
            idle.SampleAnimation(kin.gameObject, t);
            kin.Express(e);
            kin.blink = blink;
            for (int i = 0; i < 40; i++) kin.Tick(0.016f, false);
            // Frame on the real face: midpoint of the eyes, a touch lower for the muzzle.
            var mid = kin.FaceCentre() - new Vector3(0, 0.012f, 0);
            var fwd = kin.transform.forward;
            Aim(cam, mid + fwd * 0.26f + kin.transform.right * 0.06f + Vector3.up * 0.015f, mid, 30);
            Shot(cam, name, 1024, 1024);
        }
        Debug.Log($"KIN_PROOF eyes L={kin.eyeL.bounds.center} R={kin.eyeR.bounds.center} fwd={kin.transform.forward}");
        Face("face_neutral", Expression.Neutral);
        Face("face_blink", Expression.Neutral, 1);
        Face("face_happy", Expression.Happy);
        Face("face_petted", Expression.Petted);
        Face("face_sleepy", Expression.Sleepy);
        Face("face_worried", Expression.Worried);
        Face("face_surprised", Expression.Surprised);

        // Hero 3/4 and a side view.
        idle.SampleAnimation(kin.gameObject, 1.2f);
        kin.Express(Expression.Neutral);
        kin.blink = 0;
        for (int i = 0; i < 40; i++) kin.Tick(0.016f, false);
        Aim(cam, new Vector3(0.3f, 0.2f, 0.62f), new Vector3(0, 0.13f, 0), 30);
        Shot(cam, "hero_34", 1280, 1280);
        Aim(cam, new Vector3(0.72f, 0.16f, 0.05f), new Vector3(0, 0.13f, 0), 30);
        Shot(cam, "hero_side", 1280, 1280);

        // Walk strip: 6 frames side by side.
        var frames = new Texture2D[6];
        Aim(cam, new Vector3(0.7f, 0.17f, 0.12f), new Vector3(0, 0.13f, 0), 32);
        for (int i = 0; i < 6; i++)
        {
            walk.SampleAnimation(kin.gameObject, walk.length * i / 6f);
            kin.transform.position = Vector3.zero;
            kin.Tick(0.016f, false);
            frames[i] = Render(cam, 512, 512);
        }
        var strip = new Texture2D(512 * 6, 512, TextureFormat.RGBA32, false);
        for (int i = 0; i < 6; i++) strip.SetPixels(512 * i, 0, 512, 512, frames[i].GetPixels());
        File.WriteAllBytes(Path.Combine(OutDir, "strip_walk.png"), strip.EncodeToPNG());
        Debug.Log("KIN_PROOF done " + OutDir);
    }

    /// <summary>The habitat at golden hour and at night, from the spotlight framing.</summary>
    public static void CaptureHabitat()
    {
        Directory.CreateDirectory(OutDir);
        EditorSceneManager.OpenScene("Assets/Scenes/Main.unity");
        var cam = GameObject.Find("HabitatCamera").GetComponent<Camera>();
        var kin = Object.FindFirstObjectByType<KinCreature>();
        var sky = Object.FindFirstObjectByType<Kin.App.KinSky>();
        var meadow = Object.FindFirstObjectByType<KinMeadow>();
        kin.Build();
        meadow.Build();
        Clip("Idle").SampleAnimation(kin.gameObject, 1.0f);
        kin.Tick(0.016f, false);
        foreach (var (name, hour) in new[] { ("habitat_golden", 18.6f), ("habitat_day", 11.5f), ("habitat_night", 22.5f) })
        {
            sky.overrideHour = hour;
            sky.Apply();
            DynamicGI.UpdateEnvironment();
            foreach (var (shot, pos, at, fov) in new[]
            {
                ("", new Vector3(0.22f, 0.17f, 0.62f), new Vector3(0, 0.15f, 0), 36f),
                ("_wide", new Vector3(0.9f, 0.55f, 2.1f), new Vector3(0, 0.15f, 0), 40f),
            })
            {
                Aim(cam, pos, at, fov);
                meadow.Draw(cam);
                Shot(cam, name + shot, 1170, 1600);
            }
        }
        Debug.Log("KIN_PROOF habitat done");
    }

    static AnimationClip Clip(string n) =>
        AssetDatabase.LoadAllAssetsAtPath("Assets/Kin/Art/kin_hero.fbx").OfType<AnimationClip>().First(c => c.name == n);

    static KinCreature Spawn()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kin/Kin.prefab");
        var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        var kin = go.GetComponent<KinCreature>();
        kin.Build();
        go.GetComponent<LODGroup>().ForceLOD(0);
        return kin;
    }

    public static Camera Studio(out Light key)
    {
        RenderSettings.ambientMode = AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.72f, 0.78f, 0.95f);
        RenderSettings.ambientEquatorColor = new Color(0.78f, 0.72f, 0.66f);
        RenderSettings.ambientGroundColor = new Color(0.36f, 0.34f, 0.3f);

        var camGo = new GameObject("Camera");
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.26f, 0.28f, 0.34f);
        cam.nearClipPlane = 0.02f;
        var data = camGo.AddComponent<UniversalAdditionalCameraData>();
        data.renderPostProcessing = true;
        data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

        var vol = new GameObject("Post").AddComponent<Volume>();
        vol.isGlobal = true;
        vol.sharedProfile = AssetDatabase.LoadAssetAtPath<VolumeProfile>("Assets/Settings/KinPost.asset");

        key = Dir("Key", new Vector3(38, -38, 0), new Color(1f, 0.93f, 0.82f), 1.9f, true);
        Dir("Fill", new Vector3(18, 140, 0), new Color(0.7f, 0.8f, 1f), 0.35f, false);
        Dir("Rim", new Vector3(20, 175, 0), new Color(0.85f, 1f, 0.97f), 1.4f, false);

        var ground = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        ground.name = "Ground";
        ground.transform.localScale = new Vector3(3, 0.002f, 3);
        ground.transform.position = new Vector3(0, -0.002f, 0);
        var gm = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        gm.SetColor("_BaseColor", new Color(0.55f, 0.6f, 0.56f));
        gm.SetFloat("_Smoothness", 0.15f);
        ground.GetComponent<Renderer>().sharedMaterial = gm;
        return cam;
    }

    static Light Dir(string n, Vector3 euler, Color c, float i, bool shadows)
    {
        var l = new GameObject(n).AddComponent<Light>();
        l.type = LightType.Directional;
        l.transform.eulerAngles = euler;
        l.color = c;
        l.intensity = i;
        l.shadows = shadows ? LightShadows.Soft : LightShadows.None;
        l.shadowStrength = 0.75f;
        return l;
    }

    public static void Aim(Camera cam, Vector3 pos, Vector3 at, float fov)
    {
        cam.transform.position = pos;
        cam.transform.LookAt(at);
        cam.fieldOfView = fov;
    }

    public static Texture2D Render(Camera cam, int w, int h)
    {
        var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { antiAliasing = 4 };
        cam.targetTexture = rt;
        var meadow = Object.FindFirstObjectByType<KinMeadow>();
        if (meadow) meadow.Draw(cam);
        cam.Render();
        if (meadow) meadow.Draw(cam);
        cam.Render(); // second frame: post-processing history settles
        RenderTexture.active = rt;
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
        tex.Apply();
        RenderTexture.active = null;
        cam.targetTexture = null;
        rt.Release();
        return tex;
    }

    public static void Shot(Camera cam, string name, int w, int h) =>
        File.WriteAllBytes(Path.Combine(OutDir, name + ".png"), Render(cam, w, h).EncodeToPNG());
}
