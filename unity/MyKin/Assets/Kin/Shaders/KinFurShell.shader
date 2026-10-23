// One shell of the KIN's fur. KinCreature adds N materials of this shader to the body's skinned
// renderer (extra materials re-draw the last submesh, so the GPU-skinned body is reused for free);
// each shell pushes the surface out along the normal, bends with gravity, wind and the creature's
// motion, and keeps only the pixels inside a strand. Density follows (1 − crystal mask), so the
// crystals stay clean. Cheap per pixel: alpha test + wrap-lit colour, no shadows cast.
Shader "Kin/FurShell"
{
    Properties
    {
        _BaseMap ("Base Color", 2D) = "white" {}
        _BaseTint ("Base Tint", Color) = (1, 1, 1, 1)
        _CrystalMask ("Crystal Mask", 2D) = "black" {}
        _ShellH ("Shell Height (0..1)", Range(0, 1)) = 0.5
        _FurLength ("Fur Length (m)", Range(0, 0.02)) = 0.0055
        _Density ("Strand Density", Range(50, 2000)) = 620
        _Thickness ("Strand Thickness", Range(0.1, 1.5)) = 0.95
        _Gravity ("Gravity", Range(0, 2)) = 0.55
        _RootShade ("Root Shade", Range(0, 1)) = 0.42
        _Sheen ("Tip Sheen", Range(0, 1)) = 0.35
    }

    SubShader
    {
        Tags { "RenderType" = "TransparentCutout" "RenderPipeline" = "UniversalPipeline" "Queue" = "AlphaTest" }
        Pass
        {
            Name "FurShell"
            Tags { "LightMode" = "UniversalForward" }
            Cull Back
            ZWrite On
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseTint;
                half _ShellH;
                float _FurLength;
                float _Density;
                half _Thickness;
                half _Gravity;
                half _RootShade;
                half _Sheen;
            CBUFFER_END
            // Set per frame by KinCreature (global so all shells share one value).
            float4 _KinFurForce; // xyz world-space displacement (wind + motion lag), w unused
            float4 _KinEyeL;     // xyz eye centre (world), w radius: no fur grows over the eyes
            float4 _KinEyeR;

            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            TEXTURE2D(_CrystalMask); SAMPLER(sampler_CrystalMask);

            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct V { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; float3 normalWS : TEXCOORD2; float fog : TEXCOORD3; };

            V vert(A i)
            {
                V o;
                float h = _ShellH;
                float3 nWS = TransformObjectToWorldNormal(i.normalOS);
                float3 p = TransformObjectToWorld(i.positionOS.xyz);
                // Out along the normal; tips bend with gravity and with the wind/motion force (h²).
                p += nWS * (_FurLength * h);
                p += (float3(0, -_Gravity * _FurLength, 0) + _KinFurForce.xyz) * (h * h);
                o.positionWS = p;
                o.positionCS = TransformWorldToHClip(p);
                o.normalWS = nWS;
                o.uv = TRANSFORM_TEX(i.uv, _BaseMap);
                o.fog = ComputeFogFactor(o.positionCS.z);
                return o;
            }

            float hash(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }

            half4 frag(V i) : SV_Target
            {
                half crystal = SAMPLE_TEXTURE2D(_CrystalMask, sampler_CrystalMask, i.uv).r;
                // Keep the eyes clear: the sockets are painted dark, and strands there would bury them.
                clip(min(distance(i.positionWS, _KinEyeL.xyz) - _KinEyeL.w, distance(i.positionWS, _KinEyeR.xyz) - _KinEyeR.w));
                // Strands: one per cell, random radius and length; they thin towards the tips.
                float2 g = i.uv * _Density;
                float2 cell = floor(g);
                float2 f = frac(g) - 0.5;
                float r = hash(cell);
                float len = lerp(0.55, 1.0, hash(cell + 17.0));
                float radius = _Thickness * 0.5 * (1 - _ShellH / len);
                clip(min(radius - length(f), 0.5 - crystal) * (len - _ShellH));
                half3 base = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).rgb * _BaseTint.rgb;
                // Around the eyes the texture holds the dark socket paint; fur there is face-white.
                float eyeD = min(distance(i.positionWS, _KinEyeL.xyz) / _KinEyeL.w, distance(i.positionWS, _KinEyeR.xyz) / _KinEyeR.w);
                base = lerp(half3(0.96, 0.95, 0.94) * _BaseTint.rgb, base, smoothstep(1.2, 1.9, eyeD));
                base *= lerp(0.92, 1.06, r);
                // Roots darker (self-shadowing), tips lighter with a soft sheen.
                half shade = lerp(1 - _RootShade, 1, _ShellH);
                float3 n = normalize(i.normalWS);
                Light l = GetMainLight(TransformWorldToShadowCoord(i.positionWS));
                half wrap = saturate((dot(n, l.direction) + 0.5) / 1.5);
                float3 v = GetWorldSpaceNormalizeViewDir(i.positionWS);
                half sheen = pow(1 - saturate(dot(n, v)), 3) * _Sheen * _ShellH;
                half3 c = base * shade * (SampleSH(n) + l.color * wrap * lerp(0.6, 1, l.shadowAttenuation)) + sheen * l.color;
                c = MixFog(c, i.fog);
                return half4(c, 1);
            }
            ENDHLSL
        }
    }
}
