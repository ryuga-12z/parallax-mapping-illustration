// parallax-mapping-illustration
// 2.5D イラスト向け 視差マッピングシェーダー（4レイヤー構成）
//
// レイヤー構成（奥 → 手前）:
//   Tex0 : BG      (最奥 — 背景— デフォルトでは視差シフトなし)
//   Tex1 : Mid     (中景)
//   Tex2 : FG      (前景)
//   Tex3 : Overlay (最前面)
//　　4枚無くても動く

Shader "Custom/ParallaxMappingIllustration"
{
    Properties
    {
        [Header(Layers  back to front)]
        [NoScaleOffset] _Tex0 ("Layer 0  BG",       2D) = "black" {}
        [NoScaleOffset] _Tex1 ("Layer 1  Mid",      2D) = "black" {}
        [NoScaleOffset] _Tex2 ("Layer 2  FG",       2D) = "black" {}
        [NoScaleOffset] _Tex3 ("Layer 3  Overlay",  2D) = "black" {}

        [Header(Room)]
        _RootDepth      ("Root Depth",      Range(0.01, 1.0))    = 0.5

        [Header(Layer Depths  0 surface  1 deepest)]
        _Depth0         ("Layer 0  BG",     Range(0.0, 1.0))     = 0.0
        _Depth1         ("Layer 1  Mid",    Range(0.0, 1.0))     = 0.4
        _Depth2         ("Layer 2  FG",     Range(0.0, 1.0))     = 0.75
        _Depth3         ("Layer 3  Overlay",Range(0.0, 1.0))     = 1.0

        [Toggle(_HOLOGRAM_ON)] _HologramEnable ("Hologram Enable", Float) = 0
        _HologramTex ("Hologram Texture", 2D) = "white" {}
        _HologramTex2 ("Hologram Texture 2", 2D) = "white" {}

    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
        }

        // result.rgb は premultiplied 形式で出力されるため One/OneMinusSrcAlpha を使用。
        // SrcAlpha/OneMinusSrcAlpha にすると alpha が二重適用され色が暗くなる。
        Blend One OneMinusSrcAlpha
        ZWrite Off
        Cull Back

        Pass
        {
            Name "Forward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex   vert
            #pragma fragment frag
            #pragma shader_feature_local _HOLOGRAM_ON

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"


            //虹
            float3 Rainbow(float t)
            {
                t = frac(t);
                return saturate(float3(abs(t * 6 - 3) - 1,
                                    2 - abs(t * 6 - 2),
                                    2 - abs(t * 6 - 4)));
            }

            //スクリーンBlend関数
            float3 ApplyBlend(float3 base ,float3 blend, float opacity){
                float3 result = 1 - (1 - base) * (1 - blend); 
                
                return lerp(base,result,opacity);
            }

            // ─── 構造体定義 ──────────────────────────────────────────────────────────

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
                float3 normalOS   : NORMAL;
                float4 tangentOS  : TANGENT;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 viewDirTS  : TEXCOORD1;   // タンジェント空間の視線方向
                float3 normalWS  : TEXCOORD2;   // ワールド空間の法線
                float2 aspectFix : TEXCOORD3; // アスペクト補正値
                float3 viewDirTS_PP : TEXCOORD4;  // PerPixel の意
            };

            // ─── ユニフォーム変数 ────────────────────────────────────────────────────

            TEXTURE2D(_Tex0); SAMPLER(sampler_Tex0);
            TEXTURE2D(_Tex1); SAMPLER(sampler_Tex1);
            TEXTURE2D(_Tex2); SAMPLER(sampler_Tex2);
            TEXTURE2D(_Tex3); SAMPLER(sampler_Tex3);
            TEXTURE2D(_HologramTex); SAMPLER(sampler_HologramTex);
            TEXTURE2D(_HologramTex2); SAMPLER(sampler_HologramTex2);

            CBUFFER_START(UnityPerMaterial)
                // _ST 変数は SRP Batcher 互換のために宣言が必要
                float4 _Tex0_ST, _Tex1_ST, _Tex2_ST, _Tex3_ST;
                float4 _HologramTex_ST, _HologramTex2_ST;
                float  _RootDepth;
                float  _Depth0, _Depth1, _Depth2, _Depth3;
            CBUFFER_END

            // ─── 頂点シェーダー ──────────────────────────────────────────────────────

            Varyings vert(Attributes IN)
            {
                Varyings OUT;

                VertexPositionInputs posIn  = GetVertexPositionInputs(IN.positionOS.xyz);
                VertexNormalInputs   normIn = GetVertexNormalInputs(IN.normalOS, IN.tangentOS);

                OUT.positionCS = posIn.positionCS;
                OUT.uv         = IN.uv;

                // 視線ベクトルをタンジェント空間に変換。
                // 頂点ごとではなくオブジェクト中心基準で1本に固定することで、
                // 補間による不均一なUVスケーリングを防ぐ。
                float3 objCenterWS = float3(UNITY_MATRIX_M[0][3], UNITY_MATRIX_M[1][3], UNITY_MATRIX_M[2][3]);
                float3 viewWS = GetWorldSpaceViewDir(objCenterWS);
                float3x3 TBN   = float3x3(
                    normIn.tangentWS,
                    normIn.bitangentWS,
                    normIn.normalWS
                );
                OUT.viewDirTS = mul(TBN, viewWS);
                OUT.normalWS = normIn.normalWS;

                // PerPixel 用の視線ベクトルをタンジェント空間に変換。
                float3 posWS = TransformObjectToWorld(IN.positionOS.xyz);
                float3 viewWS_pp = GetWorldSpaceViewDir(posWS);
                OUT.viewDirTS_PP = mul(TBN, viewWS_pp);

                //UVのアス比補正はShaderlabで出来る。つよい。
                //UNITY_MATRIX_M（オブジェクト→ワールド行列）の各列の長さ = そのオブジェクトのScale値。
                float sx = length(float3(UNITY_MATRIX_M[0].x, UNITY_MATRIX_M[1].x, UNITY_MATRIX_M[2].x));
                float sy = length(float3(UNITY_MATRIX_M[0].y, UNITY_MATRIX_M[1].y, UNITY_MATRIX_M[2].y));
                OUT.aspectFix = float2(sx, sy);

                return OUT;
            }

            // ─── フラグメントシェーダー ────────────────────────────────────────────────

            float4 frag(Varyings IN) : SV_Target
            {
                float2 uv = IN.uv;

                // タンジェント空間の視線XY成分をUVスクロール方向として使用。
                // vDir.z で除算することで透視投影的な視差量を得る。
                // depth=0.0（BG）→ オフセット小、depth=1.0（FG）→ オフセット大。
                float3 vDir  = normalize(IN.viewDirTS);
                // ゼロ除算防止（Cull Back により vDir.z > 0 が基本保証されるが念のため）
                float2 pDir  = vDir.xy / max(vDir.z, 1e-4);
                // 斜め角が極端な場合の UV 暴走を防ぐ
                float2 pDirC = clamp(pDir, -1.0, 1.0);

                float depths[4] = { _Depth0, _Depth1, _Depth2, _Depth3 };

                // 奥から手前へ合成
                float4 result = float4(0.0, 0.0, 0.0, 0.0);

                UNITY_UNROLL
                for (int i = 0; i < 4; i++)
                {
                    // depth が小さい（奥）ほど動かず、手前ほど大きくシフトする
                    float  scale   = depths[i] * _RootDepth * 0.15;
                    float2 S       = abs(pDirC) * scale;
                    float2 layerUV = saturate(uv * (1.0 - 2.0 * S) + S - pDirC * scale);

                    float4 layerCol;
                    if      (i == 0) layerCol = SAMPLE_TEXTURE2D(_Tex0, sampler_Tex0, layerUV);
                    else if (i == 1) layerCol = SAMPLE_TEXTURE2D(_Tex1, sampler_Tex1, layerUV);
                    else if (i == 2) layerCol = SAMPLE_TEXTURE2D(_Tex2, sampler_Tex2, layerUV);
                    else             layerCol = SAMPLE_TEXTURE2D(_Tex3, sampler_Tex3, layerUV);

                    // Porter-Duff "over" 合成（奥から手前 / ストレートアルファ）
                    // result.rgb は premultiplied で引き継がれるため Blend One OneMinusSrcAlpha と対応
                    result.rgb = layerCol.rgb * layerCol.a + result.rgb * (1.0 - layerCol.a);
                    result.a   = layerCol.a + result.a * (1.0 - layerCol.a);
                }


                #if defined(_HOLOGRAM_ON)
                    //リングマスク
                    // Quadを傾けた時に、normalVSとnormalWSの内積で作ったマスクでホログラムが見えるようにしてる
                    float3 normalVS = TransformWorldToViewDir(IN.normalWS, true);
                    float nd = dot(normalize(normalVS), normalize(IN.normalWS));
                    float ring = nd * 0.5 + 0.5;
                    float maskIntensity = 0.2;

                    float ringMaskA = smoothstep(0.0, 0.1, ring) - smoothstep(0.05, 0.18, ring);
                    ringMaskA = clamp(ringMaskA, 0.0, maskIntensity);
                    float ringMaskB = smoothstep(0.0, 0.03, ring) - smoothstep(0.02, 0.1, ring);
                    ringMaskB = clamp(ringMaskB + smoothstep(0.15, 0.2, ring), 0.0, maskIntensity);


                    // レインボー
                    // ---レインボーテクスチャ用のUV---
                    float2 aspectFix = IN.aspectFix;

                    float2 uvDot1 = (uv * aspectFix) * _HologramTex_ST.xy  + _HologramTex_ST.zw;
                    float2 uvDot2 = (uv * aspectFix) * _HologramTex2_ST.xy + _HologramTex2_ST.zw;
                    // ---レインボーテクスチャ用のUVここまで---
                    
                    //マスクテクスチャと合成
                    float4 dotTex = SAMPLE_TEXTURE2D(_HologramTex, sampler_HologramTex, uvDot1);
                    float4 dotTex2 = SAMPLE_TEXTURE2D(_HologramTex2, sampler_HologramTex2, uvDot2);
                    
                    float3 vDirPP = normalize(IN.viewDirTS_PP);
                    float2 rb = vDirPP.xy;
                    rb = (rb + 1.0) * 3.0; 

                    // ---UV回転---
                    float2 c = float2(0.5, 0.5);
                    float  s = sin(-0.5), co = cos(-0.5);
                    rb -= c;
                    rb = float2(rb.x * co - rb.y * s, rb.x * s + rb.y * co);
                    rb += c;
                    // ---回転ここまで---

                    rb = frac(rb);

                    float h = rb.x;
                    float3 rainbow = Rainbow(h);

                    float3 sparkle1 = rainbow*dotTex.rgb;
                    float3 sparkle2 = rainbow*dotTex2.rgb;


                    result.rgb = ApplyBlend(result.rgb, sparkle1, ringMaskA);
                    result.rgb = ApplyBlend(result.rgb, sparkle2, ringMaskB);
                #endif


                
                return result;
            }

            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
