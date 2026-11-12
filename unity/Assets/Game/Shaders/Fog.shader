// The fog of war. Drawn once over the whole picture after the ground and
// everything standing on it: for each dot on the screen it works out where on
// the map that dot is, looks the place up in the fog picture (Sight.cs), and
// darkens it by what it finds there. Things drawn afterwards (selection rings,
// order markers, the plot under the pointer) are not darkened.
Shader "Rts/Fog"
{
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" }
        ZWrite Off
        ZTest Always
        Cull Off
        // What is there already, dimmed toward the dark by how much fog lies on it.
        Blend SrcAlpha OneMinusSrcAlpha, Zero One

        Pass
        {
            Name "Fog"

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            TEXTURE2D(_RtsFogMap);
            SAMPLER(sampler_RtsFogMap);
            float4 _RtsFogScale;
            float4 _RtsFogDark;

            half4 Frag(Varyings input) : SV_Target
            {
                float2 uv = input.texcoord;
                float depth = SampleSceneDepth(uv);
                #if !UNITY_REVERSED_Z
                depth = lerp(UNITY_NEAR_CLIP_VALUE, 1.0, depth);
                #endif
                float3 world = ComputeWorldSpacePosition(uv, depth, UNITY_MATRIX_I_VP);
                // A tile at (x, y) is drawn at (x * 2, height, -y * 2) metres.
                float2 place = float2(world.x, -world.z) * _RtsFogScale.xy;
                float bright = SAMPLE_TEXTURE2D(_RtsFogMap, sampler_RtsFogMap, saturate(place)).r;
                // The picture says how bright the place should look to the eye;
                // the screen is mixed in light, where the same step is smaller.
                float kept = pow(saturate(bright), 1.9);
                return half4(_RtsFogDark.rgb, 1.0 - kept);
            }
            ENDHLSL
        }
    }
}
