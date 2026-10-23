// The KIN's body: PBR fur base (base colour, tangent normal, ORM) with crystals driven by the
// crystal mask (glossy, translucent-looking, emissive mint, fresnel sparkle), a soft fluff rim,
// and cheek blush placed by KinCreature. The visible softness comes from Kin/FurShell layers
// drawn on top (extra materials on the same skinned renderer, so GPU skinning is free).
Shader "Kin/Fur"
{
    Properties
    {
        _BaseMap ("Base Color", 2D) = "white" {}
        _BaseTint ("Base Tint", Color) = (1, 1, 1, 1)
        [Normal] _NormalMap ("Normal", 2D) = "bump" {}
        _NormalScale ("Normal Scale", Range(0, 2)) = 0.8
        _ORM ("ORM (AO, Rough, Metal)", 2D) = "white" {}
        _CrystalMask ("Crystal Mask", 2D) = "black" {}
        _CrystalColor ("Crystal Color", Color) = (0.43, 0.9, 0.79, 1)
        _CrystalGlow ("Crystal Glow", Range(0, 4)) = 1.1
        _FurSmoothness ("Fur Smoothness", Range(0, 1)) = 0.18
        _RimColor ("Fluff Rim", Color) = (1, 0.98, 0.96, 1)
        _RimPower ("Rim Power", Range(0.5, 8)) = 2.6
        _RimStrength ("Rim Strength", Range(0, 2)) = 0.45
        _BlushColor ("Blush", Color) = (1, 0.62, 0.7, 1)
        _BlushAmount ("Blush Amount", Range(0, 1)) = 0.5
        _CheekL ("Cheek L (ws xyz, r)", Vector) = (0, -100, 0, 0.02)
        _CheekR ("Cheek R (ws xyz, r)", Vector) = (0, -100, 0, 0.02)
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        CBUFFER_START(UnityPerMaterial)
            float4 _BaseMap_ST;
            half4 _BaseTint;
            half _NormalScale;
            half4 _CrystalColor;
            half _CrystalGlow;
            half _FurSmoothness;
            half4 _RimColor;
            half _RimPower;
            half _RimStrength;
            half4 _BlushColor;
            half _BlushAmount;
            float4 _CheekL;
            float4 _CheekR;
        CBUFFER_END
        TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
        TEXTURE2D(_NormalMap); SAMPLER(sampler_NormalMap);
        TEXTURE2D(_ORM); SAMPLER(sampler_ORM);
        TEXTURE2D(_CrystalMask); SAMPLER(sampler_CrystalMask);
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; float4 tangentOS : TANGENT; float2 uv : TEXCOORD0; };
            struct V
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float3 normalWS : TEXCOORD2;
                float4 tangentWS : TEXCOORD3;
                float fog : TEXCOORD4;
            };

            V vert(A i)
            {
                V o;
                VertexPositionInputs p = GetVertexPositionInputs(i.positionOS.xyz);
                VertexNormalInputs n = GetVertexNormalInputs(i.normalOS, i.tangentOS);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = n.normalWS;
                o.tangentWS = float4(n.tangentWS, i.tangentOS.w * GetOddNegativeScale());
                o.uv = TRANSFORM_TEX(i.uv, _BaseMap);
                o.fog = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            half blush(float3 ws, float4 c)
            {
                float d = distance(ws, c.xyz) / max(c.w, 1e-4);
                return saturate(1 - d * d);
            }

            half4 frag(V i) : SV_Target
            {
                half4 base = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseTint;
                half3 orm = SAMPLE_TEXTURE2D(_ORM, sampler_ORM, i.uv).rgb;
                half crystal = SAMPLE_TEXTURE2D(_CrystalMask, sampler_CrystalMask, i.uv).r;
                half3 nTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, i.uv), _NormalScale);
                float3 bitangent = i.tangentWS.w * cross(i.normalWS, i.tangentWS.xyz);
                float3 nWS = normalize(TransformTangentToWorld(nTS, half3x3(i.tangentWS.xyz, bitangent, i.normalWS)));
                float3 vWS = GetWorldSpaceNormalizeViewDir(i.positionWS);

                // Cheek blush, soft and warm, placed in world space from the head bone.
                half b = max(blush(i.positionWS, _CheekL), blush(i.positionWS, _CheekR)) * _BlushAmount * (1 - crystal);
                half3 albedo = lerp(base.rgb, base.rgb * _BlushColor.rgb, b * 0.6);
                albedo = lerp(albedo, lerp(albedo, _CrystalColor.rgb, 0.55), crystal);

                InputData d = (InputData)0;
                d.positionWS = i.positionWS;
                d.normalWS = nWS;
                d.viewDirectionWS = vWS;
                d.shadowCoord = TransformWorldToShadowCoord(i.positionWS);
                d.fogCoord = i.fog;
                d.bakedGI = SampleSH(nWS);
                d.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(i.positionCS);
                d.shadowMask = half4(1, 1, 1, 1);

                SurfaceData s = (SurfaceData)0;
                s.albedo = albedo;
                s.metallic = 0;
                s.specular = half3(0, 0, 0);
                s.smoothness = lerp(_FurSmoothness * (1 - orm.g), 0.92, crystal);
                s.normalTS = nTS;
                s.occlusion = lerp(1, orm.r, 0.85);
                s.alpha = 1;
                half fres = pow(1 - saturate(dot(nWS, vWS)), _RimPower);
                // Crystals glow from within and sparkle at grazing angles; fur gets a soft halo.
                s.emission = crystal * _CrystalColor.rgb * (_CrystalGlow * (0.35 + fres * 1.6))
                           + (1 - crystal) * _RimColor.rgb * fres * _RimStrength * 0.35;
                half4 c = UniversalFragmentPBR(d, s);
                c.rgb = MixFog(c.rgb, i.fog);
                return c;
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ZWrite On ZTest LEqual ColorMask 0
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            float3 _LightDirection;
            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            float4 vert(A i) : SV_POSITION
            {
                float3 p = TransformObjectToWorld(i.positionOS.xyz);
                float3 n = TransformObjectToWorldNormal(i.normalOS);
                float4 c = TransformWorldToHClip(ApplyShadowBias(p, n, _LightDirection));
                #if UNITY_REVERSED_Z
                    c.z = min(c.z, UNITY_NEAR_CLIP_VALUE);
                #else
                    c.z = max(c.z, UNITY_NEAR_CLIP_VALUE);
                #endif
                return c;
            }
            half4 frag() : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On ColorMask R
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            struct A { float4 positionOS : POSITION; };
            float4 vert(A i) : SV_POSITION { return TransformObjectToHClip(i.positionOS.xyz); }
            half frag() : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct V { float4 positionCS : SV_POSITION; float3 n : TEXCOORD0; };
            V vert(A i) { V o; o.positionCS = TransformObjectToHClip(i.positionOS.xyz); o.n = TransformObjectToWorldNormal(i.normalOS); return o; }
            half4 frag(V i) : SV_Target { return half4(NormalizeNormalPerPixel(i.n), 0); }
            ENDHLSL
        }
    }
}
