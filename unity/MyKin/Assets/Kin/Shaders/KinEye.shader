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
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            CBUFFER_START(UnityPerMaterial)
                half4 _FurColor; half4 _LashColor; half _Side; half _Lid; half _Happy; half _Sleepy; half _Worried;
                half _Pupil; float4 _Look; half _FlipV; half _Catch;
            CBUFFER_END
            TEXTURE2D(_Iris); SAMPLER(sampler_Iris);
            float4 _KinEyeL, _KinEyeR; // eye centres (world) + radius, from KinCreature
            float4 _KinHeadRight, _KinHeadUp, _KinHeadFwd; // head axes (world), from KinCreature
            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct V { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; float3 normalWS : TEXCOORD2; float fog : TEXCOORD3; };

            V vert(A i)
            {
                V o;
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                // Closing swells the eyeball out to the socket's lip, so a shut eye is a flush,
                // furry lid with no hole or rim around it (the recess only exists while open).
                float shutAmt = saturate(max(max(_Lid, _Happy), _Sleepy * 0.48));
                float4 ec = _Side > 0 ? _KinEyeL : _KinEyeR;
                if (ec.w > 0) o.positionWS = ec.xyz + (o.positionWS - ec.xyz) * (1 + 0.32 * smoothstep(0.3, 1.0, shutAmt));
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

                // Lid features live in HEAD space (eye-local x right, y up, in eye radii), so lids and
                // creases sit where they should whatever the eye mesh's UV projection does.
                float4 ecf = _Side > 0 ? _KinEyeL : _KinEyeR;
                float3 rel = (i.positionWS - ecf.xyz) / max(ecf.w, 1e-4);
                float hx = dot(rel, _KinHeadRight.xyz) * 0.5; // ±0.5 across the eye, like uv.x - 0.5
                float hy = dot(rel, _KinHeadUp.xyz) * 0.5 + 0.5;
                if (ecf.w > 0) { uv = float2(hx + 0.5, hy); }
                // Upper lid edge: a soft downward-curving arc; worried lifts the inner corner.
                float x = uv.x - 0.5;
                float inner = -x * _Side; // + towards the nose
                float close = saturate(max(_Lid, _Sleepy * 0.48));
                float edge = lerp(1.08, -0.06, close) - 0.55 * x * x * (1 - close * 0.6) + _Worried * 0.22 * saturate(inner * 2 + 0.3);
                half lid = smoothstep(edge - 0.012, edge + 0.012, uv.y);
                half lash = band(uv.y - edge, lerp(0.035, 0.05, close));
                // Closed parts ARE the face's fur (colour sampled from the brow at build time), lit
                // with the same PBR model and matte finish as the body, so no disc or rim shows.
                half3 lidFur = _FurColor.rgb * 1.3; // the body's fur reads brighter (rim + shells); match it
                half3 col = lerp(iris, lidFur, lid);
                // A thin lash line rides the lid edge while it moves; it fades out once shut.
                col = lerp(col, _LashColor.rgb, lash * 0.85 * (1 - _Happy) * (1 - smoothstep(0.65, 0.85, close)));
                // Fully shut: a gentle "‿" crease, slightly soft and short, not a drawn stroke.
                float shutY = 0.44 - 0.12 * (1 - saturate((x * x) / 0.16));
                half shut = band(uv.y - shutY, 0.07) * (1 - smoothstep(0.32, 0.4, abs(x))) * smoothstep(0.8, 1.0, close);
                col = lerp(col, _LashColor.rgb * 1.3, shut * (1 - _Happy));
                // Happy "^ ^": the fur closes and a soft upward crease forms (cheeks push up below it).
                float arcY = 0.4 + 0.16 * (1 - saturate((x * x) / 0.16));
                half arc = band(uv.y - arcY, 0.085) * (1 - smoothstep(0.32, 0.4, abs(x)));
                col = lerp(col, lerp(lidFur, _LashColor.rgb * 1.6, arc * 0.9), _Happy);
                half open = (1 - lid) * (1 - _Happy);

                InputData d = (InputData)0;
                d.positionWS = i.positionWS;
                // A shut lid lies flush with the face: light it with the face's normal, not the ball's.
                d.normalWS = normalize(lerp(normalize(i.normalWS), _KinHeadFwd.xyz, 0.75 * (1 - open)));
                d.viewDirectionWS = GetWorldSpaceNormalizeViewDir(i.positionWS);
                d.shadowCoord = TransformWorldToShadowCoord(i.positionWS);
                d.bakedGI = SampleSH(d.normalWS);
                d.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(i.positionCS);
                d.shadowMask = half4(1, 1, 1, 1);
                SurfaceData sd = (SurfaceData)0;
                sd.albedo = col;
                sd.smoothness = lerp(0.16, 0.55, open); // glossy iris, matte fur lid
                sd.occlusion = 1;
                sd.alpha = 1;
                half3 lit = UniversalFragmentPBR(d, sd).rgb;
                // The same soft fluff rim the body has, on the closed lid.
                half fres = pow(1 - saturate(dot(d.normalWS, d.viewDirectionWS)), 2.6);
                lit += lidFur * fres * 0.16 * (1 - open);
                // Catchlights: a big soft window up-left and a small one down-right (they ride with the
                // look offset like real reflections).
                float2 e = uv - c - _Look.xy * 0.5;
                half big = 1 - smoothstep(0.055, 0.075, length(e - float2(-0.11, 0.12)));
                half small = 1 - smoothstep(0.022, 0.032, length(e - float2(0.1, -0.1)));
                lit += (big * 0.95 + small * 0.8) * _Catch * open;
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
