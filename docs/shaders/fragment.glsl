// Fragment shader (three.js RawShaderMaterial / GLSL ES 3.0)
// 4 レイヤーのインテリアマッピング風パララックスと、任意で重ねるホログラム表現。

precision highp float;

in vec2 vUv;
in vec3 vViewDirTS;
in vec3 vNormalWS;
in vec2 vAspectFix;
in vec3 vViewDirTS_PP;

// three.js のビルトイン uniform（ホログラムのビュー空間法線に使用）
uniform mat4 viewMatrix;

// レイヤーテクスチャ（奥 → 手前）とホログラム用テクスチャ
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform sampler2D uHologramTex;
uniform sampler2D uHologramTex2;

uniform float uRootDepth;
uniform float uDepth0;
uniform float uDepth1;
uniform float uDepth2;
uniform float uDepth3;
// ホログラムの有効/無効は GUI 切替のレスポンス確保のためランタイム分岐とする
uniform bool  uHologramEnable;
// HLSL の _ST に相当。xy = タイリング / zw = オフセット
uniform vec4  uHologramTexST;
uniform vec4  uHologramTex2ST;

out vec4 fragColor;

// GLSL には HLSL の saturate が無いので自前で定義
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2  saturate(vec2 v)  { return clamp(v, 0.0, 1.0); }
vec3  saturate(vec3 v)  { return clamp(v, 0.0, 1.0); }
vec4  saturate(vec4 v)  { return clamp(v, 0.0, 1.0); }

// スペクトル状の虹色を返す
vec3 Rainbow(float t) {
    t = fract(t);
    return saturate(vec3(abs(t * 6.0 - 3.0) - 1.0,
                         2.0 - abs(t * 6.0 - 2.0),
                         2.0 - abs(t * 6.0 - 4.0)));
}

// スクリーンブレンドを opacity で元色と補間
vec3 ApplyBlend(vec3 base, vec3 blend, float opacity) {
    vec3 result = 1.0 - (1.0 - base) * (1.0 - blend);
    return mix(base, result, opacity);
}

void main() {
    vec2 uv = vUv;

    // タンジェント空間視線の XY を UV スクロール方向として使用。
    // z で除算することで透視投影的な視差量に変換する。
    vec3 vDir  = normalize(vViewDirTS);
    // ゼロ除算防止（背面カリングにより vDir.z > 0 が基本だが念のため）
    vec2 pDir  = vDir.xy / max(vDir.z, 1e-4);
    // 極端な斜め視線での UV 暴走を抑制
    vec2 pDirC = clamp(pDir, -1.0, 1.0);

    float depths[4] = float[4](uDepth0, uDepth1, uDepth2, uDepth3);

    // 奥から手前へ Porter-Duff "over" で合成（result.rgb は premultiplied）
    vec4 result = vec4(0.0);

    for (int i = 0; i < 4; i++) {
        // depth 値が大きいレイヤーほど大きく視差シフトする
        float scale   = depths[i] * uRootDepth * 0.15;
        vec2  S       = abs(pDirC) * scale;
        vec2  layerUV = saturate(uv * (1.0 - 2.0 * S) + S - pDirC * scale);

        vec4 layerCol;
        if      (i == 0) layerCol = texture(uTex0, layerUV);
        else if (i == 1) layerCol = texture(uTex1, layerUV);
        else if (i == 2) layerCol = texture(uTex2, layerUV);
        else             layerCol = texture(uTex3, layerUV);

        // premultiplied で引き継ぐ（出力側の One / OneMinusSrcAlpha と対応）
        result.rgb = layerCol.rgb * layerCol.a + result.rgb * (1.0 - layerCol.a);
        result.a   = layerCol.a + result.a * (1.0 - layerCol.a);
    }

    // ── ホログラム ─────────────────────────────────────────────
    if (uHologramEnable) {
        // Quad を傾けたときにリング状のマスクが現れる仕組み。
        // ビュー空間法線とワールド空間法線の内積からリング量を算出する。
        //
        // three.js の viewMatrix は world/view いずれも右手座標系のため、
        // Unity 実装（UNITY_MATRIX_V が world(LH) → view(RH) 変換で z 反転）と
        // 揃えるためにビュー空間側の z を反転する。この処理を入れない場合、
        // 正面時に mat3(viewMatrix) が単位行列に近づいて nd ≒ 1 → ring ≒ 1 となり、
        // ringMaskB の "+ smoothstep(0.15, 0.2, ring)" が常時発火してしまう。
        vec3  nWS      = normalize(vNormalWS);
        vec3  normalVS = mat3(viewMatrix) * nWS;
        normalVS.z     = -normalVS.z;
        float nd       = dot(normalize(normalVS), nWS);
        float ring     = nd * 0.5 + 0.5;
        float maskIntensity = 0.2;

        float ringMaskA = smoothstep(0.0, 0.1, ring) - smoothstep(0.05, 0.18, ring);
        ringMaskA = clamp(ringMaskA, 0.0, maskIntensity);
        float ringMaskB = smoothstep(0.0, 0.03, ring) - smoothstep(0.02, 0.1, ring);
        ringMaskB = clamp(ringMaskB + smoothstep(0.15, 0.2, ring), 0.0, maskIntensity);

        // ドットテクスチャ用 UV（アスペクト補正を適用）
        vec2 aspectFix = vAspectFix;
        vec2 uvDot1 = (uv * aspectFix) * uHologramTexST.xy  + uHologramTexST.zw;
        vec2 uvDot2 = (uv * aspectFix) * uHologramTex2ST.xy + uHologramTex2ST.zw;

        vec4 dotTex  = texture(uHologramTex,  uvDot1);
        vec4 dotTex2 = texture(uHologramTex2, uvDot2);

        vec3 vDirPP = normalize(vViewDirTS_PP);
        vec2 rb     = vDirPP.xy;
        rb = (rb + 1.0) * 3.0;

        // UV を中心 0.5、角度 -0.5rad で回転
        vec2  c  = vec2(0.5);
        float s  = sin(-0.5);
        float co = cos(-0.5);
        rb -= c;
        rb  = vec2(rb.x * co - rb.y * s, rb.x * s + rb.y * co);
        rb += c;

        rb = fract(rb);

        vec3 rainbow  = Rainbow(rb.x);
        vec3 sparkle1 = rainbow * dotTex.rgb;
        vec3 sparkle2 = rainbow * dotTex2.rgb;

        result.rgb = ApplyBlend(result.rgb, sparkle1, ringMaskA);
        result.rgb = ApplyBlend(result.rgb, sparkle2, ringMaskB);
    }

    fragColor = result;
}
