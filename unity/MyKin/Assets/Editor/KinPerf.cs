// Rough frame-cost probe on this Mac (not a phone): times the habitat camera rendering the scene
// at phone resolution, with the creature's face/fur update, over many frames.
//   GRAPHICS=1 scripts/unity-batch.sh <log> -executeMethod KinPerf.Run
using System.Diagnostics;
using System.Linq;
using Kin.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Debug = UnityEngine.Debug;

public static class KinPerf
{
    public static void Run()
    {
        EditorSceneManager.OpenScene("Assets/Scenes/Main.unity");
        var cam = GameObject.Find("HabitatCamera").GetComponent<Camera>();
        var kin = Object.FindFirstObjectByType<KinCreature>();
        var meadow = Object.FindFirstObjectByType<KinMeadow>();
        kin.Build();
        meadow.Build();
        cam.transform.position = new Vector3(0.22f, 0.17f, 0.62f);
        cam.transform.LookAt(new Vector3(0, 0.15f, 0));
        var rt = new RenderTexture(1179, 2556, 24) { antiAliasing = 4 };
        cam.targetTexture = rt;
        foreach (int shells in new[] { 0, 8, 14 })
        {
            kin.SetShells(shells);
            for (int i = 0; i < 10; i++) { meadow.Draw(cam); cam.Render(); }
            var times = new double[60];
            for (int i = 0; i < times.Length; i++)
            {
                var sw = Stopwatch.StartNew();
                kin.Tick(1 / 60f, false);
                meadow.Draw(cam);
                cam.Render();
                GL.Flush();
                times[i] = sw.Elapsed.TotalMilliseconds;
            }
            var s = times.OrderBy(x => x).ToArray();
            Debug.Log($"KIN_PERF shells={shells} median={s[30]:0.00}ms p90={s[54]:0.00}ms (1179x2556, MSAA4, editor CPU submit, M1 Max)");
        }
        cam.targetTexture = null;
        rt.Release();
    }
}
