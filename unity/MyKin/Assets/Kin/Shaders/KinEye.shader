// The KIN's eye, with its expressions drawn in the material (Nintendo-style), so a blink or a
// happy squint never shows a geometry seam. The iris is the concept's painted eye, front-projected
// (UV 0.5,0.5 = pupil centre). Driven by KinCreature through a MaterialPropertyBlock:
//   _Lid      0 open … 1 closed (curved lash line in fur colour above it)
//   _Happy    0 … 1 "^ ^" closed arcs
//   _Sleepy   heavy, soft upper lid
//   _Worried  inner corner lifts (uses _Side: +1 left eye, −1 right eye)
//   _Pupil    dilation (0.7 small … 1.4 big)
//   _Look     iris offset in UV (eye look-around)
// Live catchlights: a key-light specular and a fixed view-space window, so the eyes sparkle.
Shader "Kin/Eye"
{
    Properties
    {
        _Iris ("Iris (no catchlights)", 2D) = "white" {}
        _FurColor ("Lid Fur Color", Color) = (0.97, 0.955, 0.945, 1)
        _LashColor ("Lash Color", Color) = (0.06, 0.07, 0.09, 1)
        _Side ("Side (+1 L, -1 R)", Float) = 1
        _Lid ("Lid", Range(0, 1)) = 0
        _Happy ("Happy", Range(0, 1)) = 0
        _Sleepy ("Sleepy", Range(0, 1)) = 0
        _Worried ("Worried", Range(0, 1)) = 0
        _Pupil ("Pupil", Range(0.6, 1.5)) = 1
        _Look ("Look (uv offset xy)", Vector) = (0, 0, 0, 0)
        _FlipV ("Flip V", Float) = 0
        _Catch ("Catchlight", Range(0, 2)) = 1
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry+1" }
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            CBUFFER_START(UnityPerMaterial)
                half4 _FurColor; half4 _LashColor; half _Side; half _Lid; half _Happy; half _Sleepy; half _Worried;
                half _Pupil; float4 _Look; half _FlipV; half _Catch;
            CBUFFER_END
            TEXTURE2D(_Iris); SAMPLER(sampler_Iris);
            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct V { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; float3 normalWS : TEXCOORD2; float fog : TEXCOORD3; };

            V vert(A i)
            {
                V o;
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS);
                o.uv = i.uv;
                if (_FlipV > 0.5) o.uv.y = 1 - o.uv.y;
                o.fog = ComputeFogFactor(o.positionCS.z);
                return o;
            }

            half band(float d, float w) { return 1 - smoothstep(w * 0.6, w, abs(d)); }

            half4 frag(V i) : SV_Target
            {
                float2 c = float2(0.5, 0.5);
                float2 uv = i.uv;
                // Iris with look offset and pupil dilation (scale the inner disc about the centre).
                float2 q = uv - c - _Look.xy;
                float rr = length(q);
                float dil = lerp(1.0 / _Pupil, 1.0, smoothstep(0.08, 0.3, rr));
                half3 iris = SAMPLE_TEXTURE2D(_Iris, sampler_Iris, c + q * dil).rgb;
                // No white sclera ring: the rim fades into a soft dark lash line, like the concept.
                iris = lerp(iris, _LashColor.rgb, smoothstep(0.36, 0.43, rr));

                // Upper lid edge: a soft downward-curving arc; worried lifts the inner corner.
                float x = uv.x - 0.5;
                float inner = -x * _Side; // + towards the nose
                float close = saturate(max(_Lid, _Sleepy * 0.48));
                float edge = lerp(1.08, -0.06, close) - 0.55 * x * x * (1 - close * 0.6) + _Worried * 0.22 * saturate(inner * 2 + 0.3);
                half lid = smoothstep(edge - 0.012, edge + 0.012, uv.y);
                half lash = band(uv.y - edge, lerp(0.035, 0.05, close));
                // Lower lid hint when closed, so a blink reads as a gentle curve, not a cut.
                // Lids are soft fur: a little darker towards the socket edge so they read as rounded.
                half3 lidFur = _FurColor.rgb * lerp(1.0, 0.82, smoothstep(0.22, 0.5, rr));
                half3 col = lerp(iris, lidFur, lid);
                col = lerp(col, _LashColor.rgb, lash * (1 - _Happy) * (1 - smoothstep(0.7, 0.9, close)));
                // Fully closed: a soft "‿" lash curve, so a blink or sleep reads peaceful, not blank.
                float shutY = 0.5 - 0.22 * (1 - saturate((x * x) / 0.16));
                half shut = band(uv.y - shutY, 0.05) * (1 - smoothstep(0.36, 0.42, abs(x))) * smoothstep(0.75, 1.0, close);
                col = lerp(col, _LashColor.rgb, shut * (1 - _Happy));

                // Happy "^ ^": fur everywhere + an upward arc stroke.
                float arcY = 0.36 + 0.2 * (1 - saturate((x * x) / 0.16));
                half arc = band(uv.y - arcY, 0.075) * (1 - smoothstep(0.36, 0.42, abs(x)));
                half3 happy = lerp(lidFur, _LashColor.rgb, arc);
                col = lerp(col, happy, _Happy);

                // Lighting: soft, with sparkling catchlights on the open eye.
                float3 n = normalize(i.normalWS);
                float3 v = GetWorldSpaceNormalizeViewDir(i.positionWS);
                Light l = GetMainLight();
                half diff = saturate(dot(n, l.direction) * 0.5 + 0.5);
                half3 lit = col * (SampleSH(n) * 0.9 + l.color * diff * 0.55);
                half open = (1 - lid) * (1 - _Happy);
                float3 h = normalize(l.direction + v);
                half spec = pow(saturate(dot(n, h)), 900) * 2.5;
                // Catchlights: a big soft window up-left and a small one down-right (they ride with the
                // look offset like real reflections), plus the key light's own glint.
                float2 e = uv - c - _Look.xy * 0.5;
                half big = 1 - smoothstep(0.055, 0.075, length(e - float2(-0.11, 0.12)));
                half small = 1 - smoothstep(0.022, 0.032, length(e - float2(0.1, -0.1)));
                lit += (spec * l.color + (big * 0.95 + small * 0.8)) * _Catch * open;
                lit = MixFog(lit, i.fog);
                return half4(lit, 1);
            }
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
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            float4 vert(float4 p : POSITION) : SV_POSITION { return TransformObjectToHClip(p.xyz); }
            half frag() : SV_Target { return 0; }
            ENDHLSL
        }
    }
}
