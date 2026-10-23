// The real sky over the habitat: the sun's actual position for the device's place and time
// (same NOAA formula as the web app's src/env/sun.ts), warm golden hours, blue hour, moonlight,
// ambient colours and fireflies at night. `overrideHour` lets captures choose a time.
using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kin.App
{
    [ExecuteAlways]
    public class KinSky : MonoBehaviour
    {
        public Light sun;
        public Light fill;
        public Material skybox;
        public ParticleSystem fireflies;
        public double latitude = 32.78, longitude = -96.8; // coarse default (Dallas); refined on device
        [Range(-1, 24)] public float overrideHour = -1;

        public float SunElevation { get; private set; }

        void Update() => Apply();

        public void Apply()
        {
            var now = DateTime.Now;
            if (overrideHour >= 0) now = now.Date.AddHours(overrideHour);
            var (elev, az) = SunPosition(now.ToUniversalTime(), latitude, longitude);
            SunElevation = (float)elev;
            float day = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(-4, 14, (float)elev));
            float golden = Mathf.SmoothStep(0, 1, Mathf.InverseLerp(-6, 2, (float)elev)) * (1 - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(4, 16, (float)elev)));
            float night = 1 - day;
            if (sun)
            {
                // By night the key light becomes cool moonlight from a fixed, flattering angle.
                float e = elev < 2 ? 34 : Mathf.Max(8, (float)elev);
                float a = elev < 2 ? 210 : (float)az;
                sun.transform.rotation = Quaternion.Euler(e, a + 180, 0);
                var dayCol = Color.Lerp(new Color(1f, 0.84f, 0.68f), new Color(1f, 0.97f, 0.92f), Mathf.InverseLerp(4, 30, (float)elev));
                sun.color = Color.Lerp(new Color(0.66f, 0.76f, 1f), dayCol, day);
                sun.intensity = Mathf.Lerp(0.85f, 1.7f, day);
            }
            if (fill) fill.intensity = Mathf.Lerp(0.45f, 0.35f, day);
            Color zenith = Color.Lerp(new Color(0.05f, 0.07f, 0.18f), new Color(0.38f, 0.55f, 0.92f), day);
            zenith = Color.Lerp(zenith, new Color(0.26f, 0.3f, 0.6f), golden * 0.6f);
            Color horizon = Color.Lerp(new Color(0.12f, 0.16f, 0.32f), new Color(0.86f, 0.9f, 0.96f), day);
            horizon = Color.Lerp(horizon, new Color(1f, 0.66f, 0.42f), golden * 0.85f);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Color.Lerp(zenith, Color.white, 0.25f) * Mathf.Lerp(0.9f, 1.05f, day);
            RenderSettings.ambientEquatorColor = Color.Lerp(horizon, new Color(0.8f, 0.8f, 0.8f), 0.45f) * Mathf.Lerp(0.55f, 0.9f, day);
            RenderSettings.ambientGroundColor = Color.Lerp(new Color(0.08f, 0.1f, 0.12f), new Color(0.3f, 0.36f, 0.26f), day);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = 3f;
            RenderSettings.fogEndDistance = 22f;
            RenderSettings.fogColor = horizon;
            if (skybox)
            {
                RenderSettings.skybox = skybox;
                skybox.SetColor("_Zenith", zenith);
                skybox.SetColor("_Horizon", horizon);
                skybox.SetColor("_Below", Color.Lerp(horizon, new Color(0.2f, 0.22f, 0.26f), 0.5f));
                skybox.SetColor("_SunColor", night > 0.6f ? new Color(0.75f, 0.8f, 1f) * 0.7f : sun ? sun.color : Color.white);
                skybox.SetVector("_SunDir", sun ? -sun.transform.forward : Vector3.up);
                skybox.SetFloat("_Stars", Mathf.Clamp01((night - 0.4f) * 1.8f));
            }
            // Crystals glow brighter in the dark.
            Shader.SetGlobalFloat("_KinNight", night);
            if (fireflies)
            {
                var em = fireflies.emission;
                em.rateOverTime = night > 0.6f ? 6 : 0;
            }
        }

        /// <summary>NOAA simplified solar position: (elevation°, azimuth° from north).</summary>
        public static (double elev, double az) SunPosition(DateTime utc, double lat, double lon)
        {
            const double R = Math.PI / 180;
            double jd = (utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds / 86400000.0 + 2440587.5;
            double n = jd - 2451545.0;
            double L = (280.46 + 0.9856474 * n) % 360;
            double g = ((357.528 + 0.9856003 * n) % 360) * R;
            double lambda = (L + 1.915 * Math.Sin(g) + 0.02 * Math.Sin(2 * g)) * R;
            double eps = (23.439 - 0.0000004 * n) * R;
            double ra = Math.Atan2(Math.Cos(eps) * Math.Sin(lambda), Math.Cos(lambda));
            double dec = Math.Asin(Math.Sin(eps) * Math.Sin(lambda));
            double gmst = (18.697374558 + 24.06570982441908 * n) % 24;
            double ha = (gmst * 15 + lon) * R - ra;
            double phi = lat * R;
            double el = Math.Asin(Math.Sin(phi) * Math.Sin(dec) + Math.Cos(phi) * Math.Cos(dec) * Math.Cos(ha));
            double az = Math.Atan2(-Math.Sin(ha), Math.Tan(dec) * Math.Cos(phi) - Math.Sin(phi) * Math.Cos(ha));
            return (el / R, ((az / R) + 360) % 360);
        }
    }
}
