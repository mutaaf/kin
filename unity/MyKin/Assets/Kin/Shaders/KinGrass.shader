// Instanced meadow grass (drawn by KinMeadow with RenderMeshInstanced): tapered blades that sway
// with the real wind, darker at the root, warm at the tip, lit by the sun with soft translucency.
Shader "Kin/Grass"
{
    Properties
    {
        _Root ("Root", Color) = (0.22, 0.4, 0.24, 1)
        _Tip ("Tip", Color) = (0.72, 0.88, 0.5, 1)
        _Translucency ("Translucency", Range(0, 1)) = 0.45
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull Off
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            CBUFFER_START(UnityPerMaterial)
                half4 _Root; half4 _Tip; half _Translucency;
            CBUFFER_END
            float4 _KinWind; // xy direction*strength, z time
            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct V { float4 positionCS : SV_POSITION; float h : TEXCOORD0; float3 positionWS : TEXCOORD1; float3 normalWS : TEXCOORD2; float fog : TEXCOORD3; float tint : TEXCOORD4; };
            V vert(A i)
            {
                UNITY_SETUP_INSTANCE_ID(i);
                V o;
                float h = i.uv.y;
                float3 p = TransformObjectToWorld(i.positionOS.xyz);
                float3 origin = TransformObjectToWorld(float3(0, 0, 0));
                float phase = origin.x * 3.1 + origin.z * 2.3;
                float gust = 0.6 + 0.4 * sin(_KinWind.z * 0.8 + origin.x * 0.7);
                float sway = (length(_KinWind.xy) * gust + 0.015) * sin(_KinWind.z * 2.2 + phase) + length(_KinWind.xy) * 0.6;
                float2 dir = length(_KinWind.xy) > 1e-4 ? normalize(_KinWind.xy) : float2(1, 0);
                p.xz += dir * sway * h * h * 0.08;
                o.positionWS = p;
                o.positionCS = TransformWorldToHClip(p);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS);
                o.h = h;
                o.tint = frac(sin(dot(origin.xz, float2(12.9898, 78.233))) * 43758.5453);
                o.fog = ComputeFogFactor(o.positionCS.z);
                return o;
            }
            half4 frag(V i, bool front : SV_IsFrontFace) : SV_Target
            {
                float3 n = normalize(front ? i.normalWS : -i.normalWS);
                Light l = GetMainLight(TransformWorldToShadowCoord(i.positionWS));
                half3 albedo = lerp(_Root.rgb, _Tip.rgb, i.h) * lerp(0.85, 1.12, i.tint);
                half ndl = saturate(dot(n, l.direction) * 0.5 + 0.5);
                float3 v = GetWorldSpaceNormalizeViewDir(i.positionWS);
                half back = pow(saturate(dot(v, -l.direction)), 3) * _Translucency * i.h;
                half3 c = albedo * (SampleSH(n) + l.color * ndl * l.shadowAttenuation) + albedo * l.color * back;
                return half4(MixFog(c, i.fog), 1);
            }
            ENDHLSL
        }
    }
}
