// KIN Live Activity for Unity. Drop into Assets/Scripts (or Assets/Plugins/iOS/KIN). The native
// side (ios/LiveActivity/Unity/KINLiveUnity.swift + Engine + Shared) is added to the exported
// Xcode project by scripts/ios-la-install.sh; nothing native needs to live under Assets.
//
// Usage:
//   KINLive.Activate();                       // once at startup
//   KINLive.Update(new KINLive.State { ... }); // whenever the KIN's state changes (throttle ~1/min
//                                             // unless something meaningful changed)
//   foreach (var c in KINLive.PendingCare()) careModel.Apply(c.verb, c.at); // on resume
//   KINLive.SetSnapshot(portraitTexture.EncodeToPNG());                      // after hatch
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;

public static class KINLive
{
    /// The same payload as the web app's LiveState (src/platform/live.ts). Needs are 0..1, 1 = fully satisfied.
    [Serializable]
    public class State
    {
        public string name;
        public double hue = 165, accentHue = 172;
        public int seed;
        public string mood = "content";   // happy | content | curious | sleepy | shy | cozy | sad
        public string doing = "at home";
        public double hunger = 0.8, play = 0.8, rest = 0.8, clean = 0.8, affection = 0.8;
        public string weather = "sunny";  // sunny | cloudy | rainy | snowy | windy | hot | cold | starry
        public double tempC = 20;
        public string mode = "home";      // home | away | asleep
        public string friend;             // when mode == away
        public string line = "";          // the current thought (≤ 120 chars)
        public bool fahrenheit;
    }

    [Serializable] public class Care { public string verb; public double at; }
    [Serializable] class CareList { public Care[] items; }

#if UNITY_IOS && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void KINLive_activate();
    [DllImport("__Internal")] static extern string KINLive_isSupported();
    [DllImport("__Internal")] static extern void KINLive_start(string json, bool restart);
    [DllImport("__Internal")] static extern void KINLive_update(string json);
    [DllImport("__Internal")] static extern void KINLive_end();
    [DllImport("__Internal")] static extern bool KINLive_setSnapshot(byte[] bytes, int length);
    [DllImport("__Internal")] static extern string KINLive_pendingCare();
    [DllImport("__Internal")] static extern void KINLive_setEnabled(bool on);
#else
    static void KINLive_activate() { }
    static string KINLive_isSupported() => "{\"supported\":false}";
    static void KINLive_start(string json, bool restart) { }
    static void KINLive_update(string json) { }
    static void KINLive_end() { }
    static bool KINLive_setSnapshot(byte[] bytes, int length) => false;
    static string KINLive_pendingCare() => "[]";
    static void KINLive_setEnabled(bool on) { }
#endif

    public static void Activate() => KINLive_activate();
    public static string IsSupportedJson() => KINLive_isSupported();
    public static void Start(State s, bool restart = false) => KINLive_start(JsonUtility.ToJson(s), restart);
    public static void Update(State s) => KINLive_update(JsonUtility.ToJson(s));
    public static void End() => KINLive_end();
    public static bool SetSnapshot(byte[] png) => png != null && png.Length > 0 && KINLive_setSnapshot(png, png.Length);
    public static void SetEnabled(bool on) => KINLive_setEnabled(on);

    public static IReadOnlyList<Care> PendingCare()
    {
        var raw = KINLive_pendingCare();
        if (string.IsNullOrEmpty(raw) || raw == "[]") return Array.Empty<Care>();
        // JsonUtility can't parse a bare array: wrap it.
        var list = JsonUtility.FromJson<CareList>("{\"items\":" + raw + "}");
        return list?.items ?? Array.Empty<Care>();
    }
}
