// On-device smoothness log: every frame's duration goes into a ring buffer (no allocations), and
// every 20 s p50/p95/p99/max + the count of stalls over 33 ms are appended to
// <persistentDataPath>/frametimes.log, which `xcrun devicectl device copy from` can pull back.
using System.IO;
using UnityEngine;

namespace Kin.App
{
    public class KinFrameLog : MonoBehaviour
    {
        const int N = 1200;
        readonly float[] ms = new float[N];
        readonly float[] sorted = new float[N];
        int count;
        float since;
        string path;

        void Awake()
        {
            DontDestroyOnLoad(gameObject);
            path = Path.Combine(Application.persistentDataPath, "frametimes.log");
            File.AppendAllText(path, $"--- session {System.DateTime.Now:O} {SystemInfo.deviceModel} {Screen.width}x{Screen.height} target={Application.targetFrameRate}\n");
        }

        KinQuality quality;

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            if (dt > 0.25f) return; // backgrounded / locked: not a frame the player saw
            ms[count % N] = dt * 1000f;
            count++;
            since += Time.unscaledDeltaTime;
            if (since < 20f) return;
            since = 0;
            int n = Mathf.Min(count, N);
            System.Array.Copy(ms, sorted, n);
            System.Array.Sort(sorted, 0, n);
            int stalls = 0;
            for (int i = 0; i < n; i++) if (sorted[i] > 34f) stalls++;
            string line = $"{Time.realtimeSinceStartup:0}s n={n} p50={sorted[n / 2]:0.0} p95={sorted[(int)(n * 0.95f)]:0.0} p99={sorted[(int)(n * 0.99f)]:0.0} max={sorted[n - 1]:0.0} stalls>34ms={stalls} target={Application.targetFrameRate} {Quality()}\n";
            File.AppendAllText(path, line);
            Debug.Log("KIN_FRAMES " + line);
        }

        string Quality()
        {
            if (!quality) quality = FindFirstObjectByType<KinQuality>();
            return quality ? quality.Describe() : "";
        }
    }
}
