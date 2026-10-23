// Headless package setup: adds the registry packages MyKin needs at the versions the Package
// Manager recommends for this editor, plus the local core package. Run without -quit:
//   Unity -batchmode -nographics -projectPath unity/MyKin -executeMethod KinPackages.Add
using System.Linq;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

public static class KinPackages
{
    static readonly string[] Wanted =
    {
        "com.unity.render-pipelines.universal",
        "com.unity.inputsystem",
        "com.unity.xr.management",
        "com.unity.xr.arfoundation",
        "com.unity.xr.arkit",
        "com.unity.xr.arcore",
        "com.unity.animation.rigging",
        "com.unity.cinemachine",
        "com.unity.ugui",
        "file:../../Packages/com.mutaafaziz.kin.core",
    };

    static AddAndRemoveRequest req;

    public static void Add()
    {
        req = Client.AddAndRemove(Wanted, new string[0]);
        EditorApplication.update += Poll;
    }

    static void Poll()
    {
        if (!req.IsCompleted) return;
        EditorApplication.update -= Poll;
        if (req.Status == StatusCode.Success)
        {
            foreach (var p in req.Result.Where(p => Wanted.Any(w => w.Contains(p.name))))
                Debug.Log($"KIN_PKG {p.name} {p.version}");
            EditorApplication.Exit(0);
        }
        else
        {
            Debug.LogError($"KIN_PKG_FAIL {req.Error?.message}");
            EditorApplication.Exit(1);
        }
    }
}
