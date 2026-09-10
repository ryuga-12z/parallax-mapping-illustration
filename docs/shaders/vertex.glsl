// Vertex shader (three.js RawShaderMaterial / GLSL ES 3.0)
// #version 宣言は three.js が自動付与するため記述しない。

precision highp float;

// geometry から流し込まれる頂点属性
in vec3 position;
in vec3 normal;
in vec2 uv;
// 平面用途のため (1, 0, 0, 1) 固定を明示的に付与
in vec4 tangent;

// three.js が自動でセットするビルトイン uniform
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

out vec2 vUv;
// タンジェント空間の視線（オブジェクト中心基準・固定）
out vec3 vViewDirTS;
// ワールド空間の法線
out vec3 vNormalWS;
// アスペクト補正 = オブジェクトのスケール
out vec2 vAspectFix;
// ピクセル単位の視線（ホログラム表現に使用）
out vec3 vViewDirTS_PP;

void main() {
    // ワールド空間の各種ベクトル。平面は等倍スケール前提のため mat3(modelMatrix) で十分。
    vec3 posWS       = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 normalWS    = normalize(mat3(modelMatrix) * normal);
    vec3 tangentWS   = normalize(mat3(modelMatrix) * tangent.xyz);
    vec3 bitangentWS = normalize(cross(normalWS, tangentWS) * tangent.w);

    // 視線をタンジェント空間へ変換。
    // 頂点ごとではなくオブジェクト中心を基準に 1 本に固定することで、
    // 補間による不均一な UV スケーリングを防ぐ。
    vec3 objCenterWS = modelMatrix[3].xyz;
    vec3 viewWS      = cameraPosition - objCenterWS;

    // HLSL の mul(TBN, v) は行ベクトル規約のため、GLSL では transpose を挟む。
    mat3 TBN   = mat3(tangentWS, bitangentWS, normalWS);
    vViewDirTS = transpose(TBN) * viewWS;

    vNormalWS = normalWS;

    // ピクセル単位の視線（ホログラムのきらめき位置に使用）
    vec3 viewWS_pp = cameraPosition - posWS;
    vViewDirTS_PP  = transpose(TBN) * viewWS_pp;

    // アスペクト補正 = モデル行列の各軸の長さ（= オブジェクトのスケール値）
    vAspectFix = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));

    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
