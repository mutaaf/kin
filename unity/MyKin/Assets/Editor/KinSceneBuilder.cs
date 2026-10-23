// Builds Assets/Scenes/Main.unity: the Sky Meadow habitat, the spotlight camera, the AR rig and
// the creature with its life loop. Idempotent.
//   scripts/unity-batch.sh <log> -executeMethod KinSceneBuilder.BuildMain
using System.IO;
using System.Linq;
using Kin.App;
using Unity.Cinemachine;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem.XR;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.XR.ARFoundation;

public static class KinSceneBuilder
{
    const string Mats = "Assets/Kin/Materials/";

    public static void BuildMain()
    {
        EnsureArBackgroundFeature();
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // Lights + sky.
        var sun = Light("Sun", LightType.Directional, new Color(1f, 0.92f, 0.8f), 1.7f, LightShadows.Soft);
        sun.shadowStrength = 0.8f;
        var fill = Light("Fill", LightType.Directional, new Color(0.7f, 0.8f, 1f), 0.3f, LightShadows.None);
        fill.transform.eulerAngles = new Vector3(20, 140, 0);
        var skyMat = MatAsset("Kin_Sky", "Kin/SkyGradient");

        // Habitat.
        var habitat = new GameObject("Habitat");
        BuildHabitat(habitat.transform);
        var fireflies = Fireflies(habitat.transform);
        var skyGo = new GameObject("Sky");
        var sky = skyGo.AddComponent<KinSky>();
        sky.sun = sun; sky.fill = fill; sky.skybox = skyMat; sky.fireflies = fireflies;

        // Creature.
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kin/Kin.prefab");
        var root = new GameObject("KinRoot");
        var kinGo = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root.transform);
        var kin = kinGo.GetComponent<KinCreature>();
        var life = root.AddComponent<KinLife>();
        life.creature = kin; life.sky = sky; life.home = habitat.transform;

        // Habitat camera: Cinemachine spotlight that frames the KIN large on phones.
        var camGo = new GameObject("HabitatCamera");
        var cam = camGo.AddComponent<Camera>();
        cam.nearClipPlane = 0.02f; cam.farClipPlane = 60;
        cam.clearFlags = CameraClearFlags.Skybox;
        var data = camGo.AddComponent<UniversalAdditionalCameraData>();
        data.renderPostProcessing = true;
        data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        camGo.AddComponent<CinemachineBrain>();
        camGo.tag = "MainCamera";
        camGo.transform.position = new Vector3(0.25f, 0.22f, 0.75f);
        var vcamGo = new GameObject("Spotlight");
        var vcam = vcamGo.AddComponent<CinemachineCamera>();
        vcam.Follow = kinGo.transform;
        var head = kinGo.GetComponentsInChildren<Transform>().First(t => t.name == "head");
        vcam.LookAt = head;
        var lens = vcam.Lens;
        lens.FieldOfView = 34;
        lens.NearClipPlane = 0.02f;
        vcam.Lens = lens;
        var follow = vcamGo.AddComponent<CinemachineFollow>();
        follow.FollowOffset = new Vector3(0.18f, 0.12f, 0.62f);
        follow.TrackerSettings.BindingMode = Unity.Cinemachine.TargetTracking.BindingMode.WorldSpace;
        var compose = vcamGo.AddComponent<CinemachineRotationComposer>();
        compose.Composition.ScreenPosition = new Vector2(0, 0.08f);
        life.viewCamera = cam;
        var vol = new GameObject("Post").AddComponent<Volume>();
        vol.isGlobal = true;
        vol.sharedProfile = AssetDatabase.LoadAssetAtPath<VolumeProfile>("Assets/Settings/KinPost.asset");

        // AR rig (inactive until the session reports support).
        var ar = BuildAr(sun, life, habitat, cam);

        Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Main.unity", true) };
        Debug.Log("KIN_SCENE ok ar=" + (ar != null));
    }

    static KinAR BuildAr(Light key, KinLife life, GameObject habitat, Camera habitatCam)
    {
        var sessionGo = new GameObject("AR Session");
        var session = sessionGo.AddComponent<ARSession>();
        sessionGo.AddComponent<ARInputManager>();

        var originGo = new GameObject("XR Origin");
        var origin = originGo.AddComponent<XROrigin>();
        var offset = new GameObject("Camera Offset");
        offset.transform.SetParent(originGo.transform, false);
        var camGo = new GameObject("AR Camera");
        camGo.transform.SetParent(offset.transform, false);
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = Color.black;
        cam.nearClipPlane = 0.05f; cam.farClipPlane = 30;
        var data = camGo.AddComponent<UniversalAdditionalCameraData>();
        data.renderPostProcessing = true;
        var camMgr = camGo.AddComponent<ARCameraManager>();
        camMgr.requestedLightEstimation = LightEstimation.AmbientIntensity
            | LightEstimation.AmbientColor
            | LightEstimation.AmbientSphericalHarmonics
            | LightEstimation.MainLightDirection;
        camGo.AddComponent<ARCameraBackground>();
        var occ = camGo.AddComponent<AROcclusionManager>();
        var tpd = camGo.AddComponent<TrackedPoseDriver>();
        tpd.positionInput = new UnityEngine.InputSystem.InputActionProperty(new UnityEngine.InputSystem.InputAction(binding: "<XRHMD>/centerEyePosition"));
        tpd.rotationInput = new UnityEngine.InputSystem.InputActionProperty(new UnityEngine.InputSystem.InputAction(binding: "<XRHMD>/centerEyeRotation"));
        origin.Camera = cam;
        origin.CameraFloorOffsetObject = offset;
        var raycaster = originGo.AddComponent<ARRaycastManager>();
        var planes = originGo.AddComponent<ARPlaneManager>();
        planes.requestedDetectionMode = UnityEngine.XR.ARSubsystems.PlaneDetectionMode.Horizontal;

        // LiDAR meshing: invisible occluders + colliders, so furniture hides and holds the KIN.
        var meshRoot = new GameObject("Room Mesh");
        meshRoot.transform.SetParent(originGo.transform, false);
        var meshing = meshRoot.AddComponent<ARMeshManager>();
        meshing.meshPrefab = MeshPrefab();
        meshing.density = 0.5f;
        meshing.enabled = false;

        var arGo = new GameObject("KinAR");
        var kar = arGo.AddComponent<KinAR>();
        kar.session = session; kar.cameraManager = camMgr; kar.raycaster = raycaster; kar.planes = planes;
        kar.occlusion = occ; kar.meshing = meshing; kar.arCamera = cam; kar.keyLight = key; kar.life = life;
        kar.habitatRoot = habitat; kar.habitatCamera = habitatCam;
        sessionGo.SetActive(true);
        camGo.SetActive(false);
        return kar;
    }

    static MeshFilter MeshPrefab()
    {
        const string path = "Assets/Kin/RoomMeshChunk.prefab";
        var go = new GameObject("RoomMeshChunk");
        var mf = go.AddComponent<MeshFilter>();
        go.AddComponent<MeshRenderer>().sharedMaterial = MatAsset("Kin_Occluder", "Kin/Occluder");
        go.AddComponent<MeshCollider>();
        var p = PrefabUtility.SaveAsPrefabAsset(go, path);
        Object.DestroyImmediate(go);
        return p.GetComponent<MeshFilter>();
    }

    static void BuildHabitat(Transform root)
    {
        // A softly lit floating meadow: a mossy disc on a rocky underside, a pond, glowing flowers,
        // and floating islands drifting in the distance.
        var ground = Prim(PrimitiveType.Cylinder, "Ground", root, new Vector3(0, -0.01f, 0), new Vector3(3.6f, 0.01f, 3.6f), Lit("Kin_Moss", new Color(0.36f, 0.55f, 0.32f), 0.12f));
        Prim(PrimitiveType.Sphere, "Underside", root, new Vector3(0, -0.55f, 0), new Vector3(3.5f, 1.1f, 3.5f), Lit("Kin_Rock", new Color(0.42f, 0.38f, 0.36f), 0.1f));
        var pond = Prim(PrimitiveType.Cylinder, "Pond", root, new Vector3(-0.55f, -0.004f, -0.35f), new Vector3(0.6f, 0.004f, 0.42f), Lit("Kin_Pond", new Color(0.2f, 0.42f, 0.5f), 0.96f));
        pond.GetComponent<Renderer>().sharedMaterial.SetFloat("_Metallic", 0.1f);
        var r = new System.Random(11);
        for (int i = 0; i < 7; i++)
        {
            float a = (float)r.NextDouble() * Mathf.PI * 2, d = 5 + (float)r.NextDouble() * 5;
            var p = new Vector3(Mathf.Cos(a) * d, 0.6f + (float)r.NextDouble() * 2.2f, Mathf.Sin(a) * d - 3);
            float s = 0.6f + (float)r.NextDouble() * 1.4f;
            Prim(PrimitiveType.Sphere, "IslandRock", root, p - new Vector3(0, 0.35f * s, 0), new Vector3(1.2f, 0.9f, 1.2f) * s, Lit("Kin_Rock", new Color(0.42f, 0.38f, 0.36f), 0.1f));
            Prim(PrimitiveType.Cylinder, "IslandTop", root, p, new Vector3(1.25f, 0.04f, 1.25f) * s, Lit("Kin_Moss", new Color(0.36f, 0.55f, 0.32f), 0.12f));
        }
        var meadow = new GameObject("Meadow").AddComponent<KinMeadow>();
        meadow.transform.SetParent(root, false);
        meadow.grassMaterial = MatAsset("Kin_Grass", "Kin/Grass");
        var flower = Lit("Kin_Flower", new Color(1f, 0.86f, 0.95f), 0.4f);
        flower.EnableKeyword("_EMISSION");
        flower.SetColor("_EmissionColor", new Color(0.9f, 0.55f, 1f) * 1.6f);
        flower.enableInstancing = true;
        meadow.flowerMaterial = flower;
        meadow.grassMaterial.enableInstancing = true;
        meadow.grassMaterial.SetColor("_Root", new Color(0.22f, 0.4f, 0.24f));
        meadow.grassMaterial.SetColor("_Tip", new Color(0.72f, 0.88f, 0.5f));
    }

    static ParticleSystem Fireflies(Transform root)
    {
        var go = new GameObject("Fireflies");
        go.transform.SetParent(root, false);
        go.transform.localPosition = new Vector3(0, 0.25f, 0);
        var ps = go.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.startLifetime = 6; main.startSpeed = 0.03f; main.startSize = 0.012f; main.maxParticles = 60;
        main.startColor = new Color(0.75f, 1f, 0.6f);
        var shape = ps.shape; shape.shapeType = ParticleSystemShapeType.Sphere; shape.radius = 1.2f;
        var noise = ps.noise; noise.enabled = true; noise.strength = 0.05f; noise.frequency = 0.4f;
        var em = ps.emission; em.rateOverTime = 0;
        var col = ps.colorOverLifetime; col.enabled = true;
        var g = new Gradient();
        g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
            new[] { new GradientAlphaKey(0, 0), new GradientAlphaKey(1, 0.3f), new GradientAlphaKey(1, 0.7f), new GradientAlphaKey(0, 1) });
        col.color = g;
        var pr = go.GetComponent<ParticleSystemRenderer>();
        var m = MatAsset("Kin_Firefly", "Universal Render Pipeline/Particles/Unlit");
        m.SetColor("_BaseColor", new Color(0.8f, 1f, 0.6f) * 2.5f);
        pr.sharedMaterial = m;
        return ps;
    }

    static Light Light(string n, LightType t, Color c, float i, LightShadows s)
    {
        var l = new GameObject(n).AddComponent<Light>();
        l.type = t; l.color = c; l.intensity = i; l.shadows = s;
        l.transform.eulerAngles = new Vector3(38, -38, 0);
        return l;
    }

    static GameObject Prim(PrimitiveType t, string n, Transform parent, Vector3 pos, Vector3 scale, Material m)
    {
        var go = GameObject.CreatePrimitive(t);
        go.name = n;
        go.transform.SetParent(parent, false);
        go.transform.localPosition = pos;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = m;
        return go;
    }

    static Material Lit(string name, Color c, float smooth)
    {
        var m = MatAsset(name, "Universal Render Pipeline/Lit");
        m.SetColor("_BaseColor", c);
        m.SetFloat("_Smoothness", smooth);
        return m;
    }

    static Material MatAsset(string name, string shader)
    {
        Directory.CreateDirectory(Mats);
        var path = Mats + name + ".mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m == null) { m = new Material(Shader.Find(shader)); AssetDatabase.CreateAsset(m, path); }
        m.shader = Shader.Find(shader);
        EditorUtility.SetDirty(m);
        return m;
    }

    /// <summary>URP needs the AR background feature on its renderer to draw the camera feed.</summary>
    static void EnsureArBackgroundFeature()
    {
        var rd = AssetDatabase.LoadAssetAtPath<UniversalRendererData>("Assets/Settings/KinRenderer.asset");
        if (rd == null || rd.rendererFeatures.Any(f => f is ARBackgroundRendererFeature)) return;
        var f = ScriptableObject.CreateInstance<ARBackgroundRendererFeature>();
        f.name = "ARBackground";
        AssetDatabase.AddObjectToAsset(f, rd);
        rd.rendererFeatures.Add(f);
        var so = new SerializedObject(rd);
        var map = so.FindProperty("m_RendererFeatureMap");
        map.InsertArrayElementAtIndex(map.arraySize);
        AssetDatabase.TryGetGUIDAndLocalFileIdentifier(f, out _, out long id);
        map.GetArrayElementAtIndex(map.arraySize - 1).longValue = id;
        so.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(rd);
        AssetDatabase.SaveAssets();
    }
}
