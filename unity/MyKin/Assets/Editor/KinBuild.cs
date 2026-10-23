// Player builds, headless:
//   scripts/unity-batch.sh <log> -executeMethod KinBuild.iOS     → unity/MyKin/Build/iOS (Xcode project)
//   scripts/unity-batch.sh <log> -executeMethod KinBuild.WebGL   → unity/MyKin/Build/WebGL
// The iOS post-process installs the Live Activity (widget extension + App Intents + bridge) into
// the exported project with scripts/ios-la-install.sh, so every export is complete.
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Callbacks;
using Debug = UnityEngine.Debug;

public static class KinBuild
{
    static readonly string[] Scenes = { "Assets/Scenes/Main.unity" };

    public static void iOS()
    {
        EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.iOS, BuildTarget.iOS);
        var r = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = Scenes,
            locationPathName = "Build/iOS",
            target = BuildTarget.iOS,
            options = BuildOptions.None,
        });
        Report(r, "iOS");
    }

    public static void WebGL()
    {
        EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
        // Small and fast to start: Brotli with a decompression fallback (works on any static host),
        // aggressive code stripping, IL2CPP optimised for size, no exception overhead, and
        // textures capped at 1024 in ASTC (with the web's own fallback where unsupported).
        var web = UnityEditor.Build.NamedBuildTarget.WebGL;
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true;
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.WebGL.nameFilesAsHashes = false;
        PlayerSettings.stripEngineCode = true;
        PlayerSettings.SetManagedStrippingLevel(web, ManagedStrippingLevel.High);
        PlayerSettings.SetIl2CppCodeGeneration(web, UnityEditor.Build.Il2CppCodeGeneration.OptimizeSize);
        PlayerSettings.SetIl2CppCompilerConfiguration(BuildTargetGroup.WebGL, Il2CppCompilerConfiguration.Master);
        EditorUserBuildSettings.webGLBuildSubtarget = WebGLTextureSubtarget.ASTC;
        foreach (var guid in AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/Kin" }))
        {
            var ti = AssetImporter.GetAtPath(AssetDatabase.GUIDToAssetPath(guid)) as TextureImporter;
            if (ti == null) continue;
            var w = ti.GetPlatformTextureSettings("WebGL");
            // Data maps (ORM, crystal mask, normal) read fine at 512 on a phone browser.
            var path = AssetDatabase.GUIDToAssetPath(guid);
            int size = path.Contains("orm") || path.Contains("mask") || path.Contains("normal") ? 512 : 1024;
            if (w.overridden && w.maxTextureSize == size) continue;
            w.overridden = true;
            w.maxTextureSize = size;
            w.format = TextureImporterFormat.ASTC_6x6;
            w.compressionQuality = 50;
            ti.SetPlatformTextureSettings(w);
            ti.SaveAndReimport();
        }
        var r = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = Scenes,
            locationPathName = "Build/WebGL",
            target = BuildTarget.WebGL,
            options = BuildOptions.None,
        });
        Report(r, "WebGL");
    }

    static void Report(BuildReport r, string what)
    {
        var s = r.summary;
        Debug.Log($"KIN_BUILD_{what} result={s.result} size={s.totalSize / 1048576f:0.0}MB errors={s.totalErrors} time={s.totalTime}");
        if (s.result != BuildResult.Succeeded) EditorApplication.Exit(1);
    }

    [PostProcessBuild(100)]
    public static void AfterBuild(BuildTarget target, string path)
    {
        if (target != BuildTarget.iOS) return;
        var repo = Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, "../../.."));
        var proj = Path.Combine(Path.GetFullPath(path), "Unity-iPhone.xcodeproj");
        var psi = new ProcessStartInfo("/bin/sh",
            $"scripts/ios-la-install.sh --project \"{proj}\" --app-target Unity-iPhone --native-target UnityFramework --bridge unity --copy")
        {
            WorkingDirectory = repo,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        using var p = Process.Start(psi);
        var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
        p.WaitForExit();
        Debug.Log($"KIN_LA_INSTALL exit={p.ExitCode}\n{output}");
        if (p.ExitCode != 0) throw new BuildFailedException("Live Activity install failed");
    }
}
