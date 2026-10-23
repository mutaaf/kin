// Headless project setup (idempotent): URP tuned for phones, the cinematic post stack, player
// settings for iOS/Android/WebGL, and the AR loaders.
//   scripts/unity-batch.sh <log> -executeMethod KinSetup.SetupProject
using System.IO;
using UnityEditor;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.XR.Management;

public static class KinSetup
{
    const string SettingsDir = "Assets/Settings";

    public static void SetupProject()
    {
        Directory.CreateDirectory(SettingsDir);
        var urp = SetupUrp();
        SetupVolume();
        SetupPlayer();
        SetupXr();
        AssetDatabase.SaveAssets();
        Debug.Log($"KIN_SETUP ok urp={AssetDatabase.GetAssetPath(urp)}");
    }

    static UniversalRenderPipelineAsset SetupUrp()
    {
        const string rdPath = SettingsDir + "/KinRenderer.asset";
        const string urpPath = SettingsDir + "/KinURP.asset";
        var rd = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(rdPath);
        if (rd == null)
        {
            rd = ScriptableObject.CreateInstance<UniversalRendererData>();
            AssetDatabase.CreateAsset(rd, rdPath);
        }
        var urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(urpPath);
        if (urp == null)
        {
            urp = UniversalRenderPipelineAsset.Create(rd);
            AssetDatabase.CreateAsset(urp, urpPath);
        }
        urp.msaaSampleCount = 4;
        urp.supportsHDR = true;
        urp.useSRPBatcher = true;
        urp.shadowDistance = 6f; // a small world: spend the shadow map on the creature
        urp.renderScale = 1f;
        urp.supportsCameraDepthTexture = true; // DOF + AR occlusion
        urp.supportsCameraOpaqueTexture = true; // crystal refraction
        var so = new SerializedObject(urp);
        Set(so, "m_SoftShadowsSupported", true);
        Set(so, "m_MainLightShadowmapResolution", 2048);
        Set(so, "m_AdditionalLightsRenderingMode", 1); // per pixel
        so.ApplyModifiedPropertiesWithoutUndo();
        var rso = new SerializedObject(rd);
        Set(rso, "m_RenderingMode", 0); // forward: best for mobile tilers with MSAA
        rso.ApplyModifiedPropertiesWithoutUndo();

        GraphicsSettings.defaultRenderPipeline = urp;
        for (int i = 0; i < QualitySettings.names.Length; i++)
        {
            QualitySettings.SetQualityLevel(i, false);
            QualitySettings.renderPipeline = urp;
        }
        EditorUtility.SetDirty(urp);
        return urp;
    }

    static void SetupVolume()
    {
        const string path = SettingsDir + "/KinPost.asset";
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(path);
        if (profile == null)
        {
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, path);
        }
        var bloom = Get<Bloom>(profile);
        bloom.intensity.Override(0.55f);
        bloom.threshold.Override(1.05f);
        bloom.scatter.Override(0.72f);
        var tone = Get<Tonemapping>(profile);
        tone.mode.Override(TonemappingMode.Neutral);
        var color = Get<ColorAdjustments>(profile);
        color.postExposure.Override(0.15f);
        color.contrast.Override(8f);
        color.saturation.Override(6f);
        color.colorFilter.Override(new Color(1f, 0.97f, 0.93f)); // warm
        var wb = Get<WhiteBalance>(profile);
        wb.temperature.Override(8f);
        var vig = Get<Vignette>(profile);
        vig.intensity.Override(0.22f);
        vig.smoothness.Override(0.5f);
        var dof = Get<DepthOfField>(profile);
        dof.active = false; // the portrait camera mode turns it on
        dof.mode.Override(DepthOfFieldMode.Bokeh);
        dof.focusDistance.Override(0.6f);
        dof.aperture.Override(4f);
        EditorUtility.SetDirty(profile);
    }

    static T Get<T>(VolumeProfile p) where T : VolumeComponent
    {
        if (!p.TryGet(out T c))
        {
            c = p.Add<T>(true);
            c.name = typeof(T).Name;
            AssetDatabase.AddObjectToAsset(c, p);
        }
        return c;
    }

    static void SetupPlayer()
    {
        PlayerSettings.companyName = "Mutaaf Aziz";
        PlayerSettings.productName = "MyKin";
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.iOS, "com.mutaafaziz.kin");
        PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.mutaafaziz.kin");
        PlayerSettings.bundleVersion = "0.2.0";
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.iOS, ScriptingImplementation.IL2CPP);
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.iOS, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.iOS, new[] { GraphicsDeviceType.Metal });
        PlayerSettings.iOS.targetOSVersionString = "15.0";
        PlayerSettings.iOS.targetDevice = iOSTargetDevice.iPhoneAndiPad;
        PlayerSettings.iOS.cameraUsageDescription =
            "MyKin uses the camera to show your KIN in your real room. Frames are processed on your device only and are never stored or sent anywhere.";
        PlayerSettings.iOS.appleDeveloperTeamID = "Z73865R687";
        PlayerSettings.iOS.appleEnableAutomaticSigning = true;
        PlayerSettings.iOS.requiresPersistentWiFi = false;
        PlayerSettings.statusBarHidden = true;
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
        PlayerSettings.allowedAutorotateToPortrait = true;
        PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
        PlayerSettings.allowedAutorotateToLandscapeLeft = true;
        PlayerSettings.allowedAutorotateToLandscapeRight = true;
        // Input System + legacy (some AR Foundation samples still read Input).
        var so = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
        Set(so, "activeInputHandler", 2);
        so.ApplyModifiedPropertiesWithoutUndo();
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true;
    }

    static void SetupXr()
    {
        Assign(BuildTargetGroup.iOS, "UnityEngine.XR.ARKit.ARKitLoader");
        Assign(BuildTargetGroup.Android, "UnityEngine.XR.ARCore.ARCoreLoader");
    }

    static void Assign(BuildTargetGroup group, string loader)
    {
        var perTarget = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(group);
        if (perTarget == null)
        {
            EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget buildTargetSettings);
            if (buildTargetSettings == null)
            {
                buildTargetSettings = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                Directory.CreateDirectory("Assets/XR");
                AssetDatabase.CreateAsset(buildTargetSettings, "Assets/XR/XRGeneralSettingsPerBuildTarget.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, buildTargetSettings, true);
            }
            perTarget = ScriptableObject.CreateInstance<XRGeneralSettings>();
            perTarget.name = group + " Settings";
            buildTargetSettings.SetSettingsForBuildTarget(group, perTarget);
            AssetDatabase.AddObjectToAsset(perTarget, buildTargetSettings);
        }
        if (perTarget.Manager == null)
        {
            var mgr = ScriptableObject.CreateInstance<XRManagerSettings>();
            mgr.name = group + " Providers";
            AssetDatabase.AddObjectToAsset(mgr, AssetDatabase.GetAssetPath(perTarget));
            perTarget.Manager = mgr;
        }
        perTarget.InitManagerOnStart = true;
        bool ok = XRPackageMetadataStore.AssignLoader(perTarget.Manager, loader, group);
        Debug.Log($"KIN_XR {group} {loader} assigned={ok}");
        EditorUtility.SetDirty(perTarget);
    }

    static void Set(SerializedObject so, string prop, object v)
    {
        var p = so.FindProperty(prop);
        if (p == null) { Debug.LogWarning($"KIN_SETUP missing {prop}"); return; }
        switch (v)
        {
            case bool b: p.boolValue = b; break;
            case int i: p.intValue = i; break;
            case float f: p.floatValue = f; break;
        }
    }
}
