// Holds 60 fps on the phone by spending pixels wisely. Watches the median frame time and walks a
// ladder (render scale → fur shell count → MSAA) down when frames run long and back up when there
// is headroom. Pauses (backgrounding) are ignored. Logs every change for the frame log.
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Kin.App
{
    public class KinQuality : MonoBehaviour
    {
        public KinCreature creature;
        static readonly (float scale, int shells, int msaa)[] Ladder =
        {
            (1.0f, 14, 4), (0.85f, 14, 4), (0.75f, 12, 4), (0.7f, 10, 2), (0.62f, 8, 2), (0.55f, 6, 1),
        };
        int level = 2; // phones start at 0.75 scale: 1290×2796 is a lot of fur pixels
        readonly float[] window = new float[90];
        readonly float[] sorted = new float[90];
        int n;
        float holdUntil;

        void Start() => Apply();

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            if (dt > 0.25f) return; // a pause, not a slow frame
            window[n++ % window.Length] = dt * 1000;
            if (n < window.Length || Time.unscaledTime < holdUntil) return;
            System.Array.Copy(window, sorted, window.Length);
            System.Array.Sort(sorted);
            float p50 = sorted[sorted.Length / 2];
            if (p50 > 18f && level < Ladder.Length - 1) { level++; Apply(); }
            else if (p50 < 13.5f && level > 0) { level--; Apply(); }
        }

        void Apply()
        {
            var (scale, shells, msaa) = Ladder[level];
            if (UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset urp)
            {
                urp.renderScale = scale;
                urp.msaaSampleCount = msaa;
            }
            if (creature) creature.SetShells(shells);
            holdUntil = Time.unscaledTime + 3f; // let it settle before judging again
            n = 0;
            Debug.Log($"KIN_QUALITY level={level} scale={scale} shells={shells} msaa={msaa} target={Application.targetFrameRate}");
        }

        public string Describe() => $"q{level} scale={Ladder[level].scale} shells={Ladder[level].shells} msaa={Ladder[level].msaa}";
    }
}
