// Startup: hold a graphite veil for a frame or two while every shader variant the app uses is
// compiled, so the first tap, blink or close-up never hitches; then fade the veil away. Sets a
// steady 60 fps target and keeps the main thread free (no blocking work here).
using System.Collections;
using UnityEngine;

namespace Kin.App
{
    public class KinBoot : MonoBehaviour
    {
        public ShaderVariantCollection variants;
        CanvasGroup veil;

        IEnumerator Start()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 0;
            veil = Veil();
            yield return null;
            if (variants) variants.WarmUp();
            else Shader.WarmupAllShaders();
            yield return null;
            for (float t = 0; t < 1; t += Time.unscaledDeltaTime / 0.45f)
            {
                veil.alpha = 1 - t * t;
                yield return null;
            }
            Destroy(veil.gameObject);
        }

        static CanvasGroup Veil()
        {
            var go = new GameObject("Veil");
            var c = go.AddComponent<Canvas>();
            c.renderMode = RenderMode.ScreenSpaceOverlay;
            c.sortingOrder = 1000;
            var img = new GameObject("Fill").AddComponent<UnityEngine.UI.Image>();
            img.transform.SetParent(go.transform, false);
            img.color = new Color(0.043f, 0.051f, 0.071f);
            var rt = img.rectTransform;
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.offsetMin = rt.offsetMax = Vector2.zero;
            return go.AddComponent<CanvasGroup>();
        }
    }
}
