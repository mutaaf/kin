// The habitat sky: a soft three-colour gradient (zenith → horizon glow → below), a gentle sun or
// moon disc with halo, and twinkling stars at night. KinSky sets every colour from the real sun,
// so golden hour is a warm band at the horizon under a deepening blue, never a flat neon fill.
Shader "Kin/SkyGradient"
{
    Properties
    {
        _Zenith ("Zenith", Color) = (0.42, 0.55, 0.9, 1)
        _Horizon ("Horizon", Color) = (0.95, 0.85, 0.75, 1)
        _Below ("Below", Color) = (0.3, 0.32, 0.36, 1)
        _SunDir ("Sun Dir", Vector) = (0, 0.3, 1, 0)
        _SunColor ("Sun Color", Color) = (1, 0.9, 0.75, 1)
        _SunSize ("Sun Size", Range(0.001, 0.05)) = 0.012
        _Stars ("Stars", Range(0, 1)) = 0
        _HorizonWidth ("Horizon Width", Range(0.02, 0.6)) = 0.22
    }
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" "RenderPipeline" = "UniversalPipeline" }
        Cull Off ZWrite Off
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            CBUFFER_START(UnityPerMaterial)
                half4 _Zenith, _Horizon, _Below, _SunColor; float4 _SunDir; half _SunSize, _Stars, _HorizonWidth;
            CBUFFER_END
            struct V { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; };
            V vert(float4 p : POSITION) { V o; o.pos = TransformObjectToHClip(p.xyz); o.dir = p.xyz; return o; }
            float hash(float3 p) { p = frac(p * 0.3183099 + 0.1); p *= 17; return frac(p.x * p.y * p.z * (p.x + p.y + p.z)); }
            half4 frag(V i) : SV_Target
            {
                float3 d = normalize(i.dir);
                float y = d.y;
                half3 c = lerp(_Horizon.rgb, _Zenith.rgb, smoothstep(0, 1, saturate(y / _HorizonWidth * 0.5 + 0.0) ));
                c = lerp(c, _Zenith.rgb, smoothstep(_HorizonWidth, 0.9, y));
                c = lerp(c, _Below.rgb, smoothstep(0.0, -0.18, y));
                float3 s = normalize(_SunDir.xyz);
                float sd = dot(d, s);
                half disc = smoothstep(1 - _SunSize, 1 - _SunSize * 0.6, sd);
                half halo = pow(saturate(sd), 64) * 0.5 + pow(saturate(sd), 8) * 0.15;
                c += _SunColor.rgb * (disc * 3 + halo);
                // Stars: sparse hashed points, twinkling, above the horizon only.
                float3 g = floor(d * 220);
                half st = step(0.9975, hash(g)) * smoothstep(0.05, 0.3, y);
                c += st * _Stars * (0.6 + 0.4 * sin(_Time.y * 2 + hash(g + 3) * 30));
                return half4(c, 1);
            }
            ENDHLSL
        }
    }
}
