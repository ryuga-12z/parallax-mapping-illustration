// イラスト立体視シミュレーター - three.js 実装
// three.js でシーンを構築し、GLSL シェーダーを RawShaderMaterial で実行する。
// GUI は lil-gui。イラストレイヤーはユーザーが読み込む前提、ホログラム用ドットは assets 内で固定。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';

// ── 定数 ──────────────────────────────────────────────
// プレースホルダー背景の生成サイズ（アスペクト比 1.6）。Quad のスケール基準となる。
const PLACEHOLDER_W = 1024;
const PLACEHOLDER_H = 640;

// Tex0 のサイズ制約
const MAX_LONG_SIDE  = 2048; // 長辺の上限。超過時はダウンサンプル
const MIN_SHORT_SIDE = 320;  // 短辺の下限。未満は読込拒否

// マウスホバー傾斜
const MAX_ANGLE  = 30;  // 基準角度（°）
const TILT_SPEED = 8;   // 追従の滑らかさ（Slerp 係数 = speed * dt）
const DEG = Math.PI / 180;
// 実質最大角 = MAX_ANGLE * TILT_AMP_FACTOR。
// 値を大きくするとホログラムのリングマスク発火帯を横断しやすくなる。
const TILT_AMP = MAX_ANGLE * -0.5;

// ── レンダラー ─────────────────────────────────────────
// alpha:true + premultiplied 出力により、透明部分は CSS 背景が透ける。
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);

// ── 色空間 ──────────────────────────────────────────────
// RawShaderMaterial は three.js の自動 sRGB 出力エンコード（colorspace_fragment）を注入しない。
// この状態で入力テクスチャを SRGBColorSpace にすると、GPU 側で sRGB → linear のデコードだけが働き、
// linear のまま sRGB フレームバッファに書き込まれるため、画面全体が暗く見える現象が発生する。
// 本ツールはライティングや PBR を伴わない 2D 合成のため、
//   入力デコード無効 + 出力エンコード無効 = gamma(sRGB) 空間のパススルー
// で統一する。canvas の #fff が CSS の白と一致するようになる。
// outputColorSpace / toneMapping は RawShaderMaterial には効かないが明示しておく。
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();

// パララックス表現のため透視投影を使用。
// 回転はホバー傾斜が担当し、OrbitControls は Pan/Zoom のみ有効化する。
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 2.4);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.enablePan    = true;
controls.enableZoom   = true;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.6;
controls.maxDistance = 8;
// enableRotate=false のため、左ドラッグにも Pan を割り当てる
controls.mouseButtons = {
  LEFT:   THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT:  THREE.MOUSE.PAN,
};
controls.touches = {
  ONE: THREE.TOUCH.PAN,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

// ── ジオメトリ ─────────────────────────────────────────
// 単位 1x1 の平面をベースにし、mesh.scale で横長にする。
// これによりシェーダー側の aspectFix（= modelMatrix のスケール）が
// オブジェクトの transform.scale と等しい意味を持つ。
const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
// 平面のためタンジェントは全頂点で (1, 0, 0, 1) 固定
const vtxCount = geometry.attributes.position.count;
const tangents = new Float32Array(vtxCount * 4);
for (let i = 0; i < vtxCount; i++) {
  tangents[i * 4 + 0] = 1;
  tangents[i * 4 + 1] = 0;
  tangents[i * 4 + 2] = 0;
  tangents[i * 4 + 3] = 1;
}
geometry.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4));

// ── uniform ───────────────────────────────────────────
const uniforms = {
  uTex0:           { value: null },
  uTex1:           { value: null },
  uTex2:           { value: null },
  uTex3:           { value: null },
  // ホログラム用ドットは固定ロード（GUI からは変更不可、uniform は保持）
  uHologramTex:    { value: null },
  uHologramTex2:   { value: null },
  uRootDepth:      { value: 0.5 },
  uDepth0:         { value: 0.0 },
  uDepth1:         { value: 0.4 },
  uDepth2:         { value: 0.75 },
  uDepth3:         { value: 1.0 },
  uHologramEnable: { value: false },
  uHologramTexST:  { value: new THREE.Vector4(1, 1, 0, 0) },
  uHologramTex2ST: { value: new THREE.Vector4(1, 1, 0, 0) },
};

// Tex0 の現在解像度。Tex1〜3 のクランプ / 中央配置の基準として使用する。
let tex0W = PLACEHOLDER_W;
let tex0H = PLACEHOLDER_H;

// mesh はチルト更新から参照するためモジュールスコープに保持
let mesh = null;

// ── シェーダー読込 → マテリアル生成 ───────────────────────
async function loadShader(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`shader 読み込み失敗: ${url} (${res.status})`);
  return res.text();
}

async function boot() {
  const [vertexShader, fragmentShader] = await Promise.all([
    loadShader('./shaders/vertex.glsl'),
    loadShader('./shaders/fragment.glsl'),
  ]);

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,     // Unity の ZWrite Off 相当
    side: THREE.FrontSide, // Cull Back 相当
    // Unity の Blend One OneMinusSrcAlpha（premultiplied）に対応。
    // RGB / Alpha を明示的に指定する（デフォルトと同値だが可読性のため）。
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // プレースホルダー投入（Tex0 は 1 枚絵、Tex1〜3 は完全透明）。
  // Tex0 は制約経路を通して mesh.scale までを確定させる。
  installPlaceholders();

  // ホログラム用ドットを固定ロード
  loadHologramTextures();

  buildGUI();
  animate();
}

// ── トースト通知 ───────────────────────────────────────
// 画面下中央にフェード表示し、一定時間で消える。
// 連続呼び出し時は前の残タイマーをクリアする。
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg, ms = 3000) {
  if (!toastEl) return;
  toastEl.innerHTML = `<span class="icon">!</span>${msg}`;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimer = null;
  }, ms);
}

// ── canvas ユーティリティ ──────────────────────────────
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// gamma(sRGB) パススルー運用のため colorSpace は NoColorSpace 固定。
// これにより texture() は sRGB エンコードされた生値を返し、
// 出力までデコード / エンコードが挟まらない。
function canvasToTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

// ── プレースホルダー（Tex0 は 1 枚絵、Tex1〜3 は完全透明）──────
function makeBeachCanvas() {
  const w = PLACEHOLDER_W, h = PLACEHOLDER_H, c = makeCanvas(w, h), g = c.getContext('2d');

  // 空 → 海のベースグラデーション
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, '#ffe9d6');
  sky.addColorStop(0.32, '#ffd9bd');
  sky.addColorStop(0.55, '#ffc7b0');
  sky.addColorStop(0.56, '#8fd7d3'); // 水平線でスパッと海色に切り替え
  sky.addColorStop(0.80, '#5fc0c6');
  sky.addColorStop(1.00, '#3f9ea8');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // 太陽のソフトグロー
  const sunX = w * 0.72, sunY = h * 0.30, sunR = h * 0.42;
  const sun = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
  sun.addColorStop(0.0, 'rgba(255, 246, 224, 0.95)');
  sun.addColorStop(0.4, 'rgba(255, 214, 170, 0.55)');
  sun.addColorStop(1.0, 'rgba(255, 214, 170, 0.0)');
  g.fillStyle = sun;
  g.beginPath(); g.arc(sunX, sunY, sunR, 0, Math.PI * 2); g.fill();

  // 海面のきらめき（水平線直下に薄い横帯）
  g.save();
  g.globalAlpha = 0.18;
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const y = h * (0.58 + i * 0.055);
    g.fillRect(0, y, w, h * 0.012);
  }
  g.restore();

  // 手前の砂浜
  const sand = g.createLinearGradient(0, h * 0.9, 0, h);
  sand.addColorStop(0.0, 'rgba(255, 235, 205, 0.0)');
  sand.addColorStop(1.0, 'rgba(255, 227, 190, 0.5)');
  g.fillStyle = sand;
  g.fillRect(0, h * 0.9, w, h * 0.1);

  return c;
}

function makeTransparentCanvas(w, h) {
  const c = makeCanvas(w, h);
  // getContext した時点で全ピクセル透明（rgba 0, 0, 0, 0）
  c.getContext('2d');
  return c;
}

function installPlaceholders() {
  // Tex0 は 1 枚絵。制約経路（setTex0）を通して mesh.scale も確定させる。
  setTex0(makeBeachCanvas());

  // Tex1〜3 は完全透明な canvas を初期値に
  setLayerTexture('uTex1', canvasToTexture(makeTransparentCanvas(tex0W, tex0H)));
  setLayerTexture('uTex2', canvasToTexture(makeTransparentCanvas(tex0W, tex0H)));
  setLayerTexture('uTex3', canvasToTexture(makeTransparentCanvas(tex0W, tex0H)));
}

// ── ホログラム用ドット固定ロード ────────────────────────
// assets/dot.png・dot2.png を TextureLoader で読み込む。
// 相対 ../ 参照は使わず、web フォルダ内で自己完結させる。
function loadHologramTextures() {
  const loader = new THREE.TextureLoader();
  const setup = (uniformKey, url, fallbackSeed) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.NoColorSpace; // マスク用途のため生値で扱う
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
        uniforms[uniformKey].value = tex;
      },
      undefined,
      () => {
        // assets が存在しない / 読み込めない場合の保険
        console.warn(`ホログラムテクスチャ読込失敗: ${url} → 生成ドットで代替`);
        uniforms[uniformKey].value = makeFallbackDot(fallbackSeed);
      }
    );
  };
  setup('uHologramTex',  './assets/dot.png',  32);
  setup('uHologramTex2', './assets/dot2.png', 20);
}

// assets 読込失敗時のフォールバック（黒地 × 白ドット、タイル可）
function makeFallbackDot(cell) {
  const s = 256, c = makeCanvas(s, s), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#fff';
  for (let y = cell / 2; y < s; y += cell) {
    for (let x = cell / 2; x < s; x += cell) {
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = canvasToTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Tex0: アスペクト比吸着とサイズ制約 ───────────────────
// src は HTMLImageElement または canvas。制約通過時に true、拒否時に false を返す。
function setTex0(src) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;

  const shortSide = Math.min(sw, sh);
  const longSide  = Math.max(sw, sh);

  // 短辺が下限未満の画像は拒否
  if (shortSide < MIN_SHORT_SIDE) {
    console.warn(`Tex0 拒否: 短辺 ${shortSide}px は下限 ${MIN_SHORT_SIDE}px 未満`);
    showToast(`短辺 ${shortSide}px が小さすぎます（${MIN_SHORT_SIDE}px 以上の画像を選んでください）`);
    return false;
  }

  // 長辺が上限を超える場合はアスペクト比を維持して縮小
  let dw = sw, dh = sh;
  if (longSide > MAX_LONG_SIDE) {
    const k = MAX_LONG_SIDE / longSide;
    dw = Math.round(sw * k);
    dh = Math.round(sh * k);
  }

  const c = makeCanvas(dw, dh);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, dw, dh);

  const prev = uniforms.uTex0.value;
  uniforms.uTex0.value = canvasToTexture(c);
  if (prev && prev.dispose) prev.dispose();

  tex0W = dw;
  tex0H = dh;

  // Quad を新アスペクト比に吸着
  if (mesh) mesh.scale.set(dw / dh, 1, 1);

  return true;
}

// ── Tex1〜3: Tex0 解像度へクランプ / 中央等倍配置 ────────
// Tex0 サイズの透明 canvas に描き直したうえで CanvasTexture 化する。
function setLayerFromImage(uniformKey, src) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;

  const c = makeCanvas(tex0W, tex0H);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';

  let dw, dh;
  if (sw <= tex0W && sh <= tex0H) {
    // Tex0 より小さい場合は中央に等倍で配置（周囲は透明）
    dw = sw; dh = sh;
  } else {
    // Tex0 より大きい場合はアスペクト比維持で縮小してクランプ
    const k = Math.min(tex0W / sw, tex0H / sh);
    dw = Math.round(sw * k);
    dh = Math.round(sh * k);
  }
  const dx = (tex0W - dw) * 0.5;
  const dy = (tex0H - dh) * 0.5;
  g.drawImage(src, dx, dy, dw, dh);

  setLayerTexture(uniformKey, canvasToTexture(c));
}

// uniform への差し替えと前テクスチャの破棄をまとめる
function setLayerTexture(uniformKey, tex) {
  const prev = uniforms[uniformKey].value;
  uniforms[uniformKey].value = tex;
  if (prev && prev.dispose) prev.dispose();
}

// ── ファイル → 画像読込（Tex0 / Tex1〜3 共通）──────────────
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// 隠し input を 1 個使い回してファイル選択を受け付ける
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/*';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// slotIndex: 0 = Tex0（制約経路）, 1〜3 = レイヤー（クランプ経路）
function pickFile(uniformKey, slotIndex, controller, labelBase) {
  fileInput.value = ''; // 同一ファイル連続選択でも change を発火させるため
  fileInput.onchange = async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      let ok = true;
      if (slotIndex === 0) {
        ok = setTex0(img); // false は短辺不足による拒否
      } else {
        setLayerFromImage(uniformKey, img);
      }
      if (ok) {
        const short = file.name.length > 16 ? file.name.slice(0, 13) + '…' : file.name;
        controller.name(`${labelBase}: ${short}`);
      } else {
        // 拒否時はラベルを初期表示に戻す
        controller.name(`${labelBase}: 読込…`);
      }
    } catch (e) {
      console.warn(`画像読込失敗: ${file.name}`, e);
      showToast(`画像を読み込めませんでした（${file.name}）`);
      controller.name(`${labelBase}: 読込…`);
    }
  };
  fileInput.click();
}

// ── GUI ───────────────────────────────────────────────
function buildGUI() {
  const gui = new GUI({ title: 'Illustration Control' });

  // イラスト フォルダは Tex0〜3 の 4 スロットのみ。ホログラム用は固定ロード。
  const tex = gui.addFolder('イラスト');
  const actions = { tex0: () => {}, tex1: () => {}, tex2: () => {}, tex3: () => {} };
  const slots = [
    ['tex0', 'uTex0', '背景(解像度のベース画像)', 0],
    ['tex1', 'uTex1', 'レイヤー1', 1],
    ['tex2', 'uTex2', 'レイヤー2', 2],
    ['tex3', 'uTex3', 'レイヤー3', 3],
  ];

  const root = gui.addFolder('全体');
  root.add(uniforms.uRootDepth, 'value', 0.01, 1.0, 0.01).name('全体の奥行き感');

  const depth = gui.addFolder('各レイヤーの奥行き感');
  depth.add(uniforms.uDepth0, 'value', 0, 1, 0.01).name('背景');
  depth.add(uniforms.uDepth1, 'value', 0, 1, 0.01).name('レイヤー1');
  depth.add(uniforms.uDepth2, 'value', 0, 1, 0.01).name('レイヤー2');
  depth.add(uniforms.uDepth3, 'value', 0, 1, 0.01).name('レイヤー3');

  const holo = gui.addFolder('ホログラム（キラキラ）');
  holo.add(uniforms.uHologramEnable, 'value').name('ホログラムをON');


  for (const [actKey, uniformKey, label, slotIndex] of slots) {
    const ctrl = tex.add(actions, actKey).name(`${label}: 読込…`);
    // FunctionController はクリックで object[property]() を呼ぶだけのため、
    // 生成後に関数本体を差し替える。
    actions[actKey] = () => pickFile(uniformKey, slotIndex, ctrl, label);
  }

  // スペースキーで GUI・タイトルカード・ヒントの表示 / 非表示を一括切替（Unity 版 GUI と同挙動）。
  // 入力系要素にフォーカスがある場合は誤動作防止のためスキップする。
  const overlayEls = document.querySelectorAll('.brand, .hint');
  let uiVisible = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    uiVisible = !uiVisible;
    gui.show(uiVisible);
    overlayEls.forEach((el) => { el.hidden = !uiVisible; });
  });
}

// ── マウスホバー傾斜 ───────────────────────────────────
// マウス位置を画面中心基準で -1〜1 に正規化。
// ny は上を + にしたいため符号反転する。
let nx = 0, ny = 0;
window.addEventListener('pointermove', (e) => {
  nx = (e.clientX / window.innerWidth) * 2 - 1;
  ny = -((e.clientY / window.innerHeight) * 2 - 1);
});

const targetEuler = new THREE.Euler();
const targetQuat  = new THREE.Quaternion();
const clock = new THREE.Clock();

// ── ループ & リサイズ ──────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  if (mesh) {
    const dt = clock.getDelta();
    // 目標角: X = ny * TILT_AMP°, Y = nx * TILT_AMP°, Z = 0
    targetEuler.set(ny * TILT_AMP * DEG, nx * TILT_AMP * DEG, 0, 'XYZ');
    targetQuat.setFromEuler(targetEuler);
    // Slerp 係数 = speed * dt
    mesh.quaternion.slerp(targetQuat, Math.min(TILT_SPEED * dt, 1));
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font-family:sans-serif;color:#37474f;';
  el.innerHTML = `<div>起動に失敗しました。<br><small>${err.message}<br>ローカルサーバー経由で開いてください（file:// の直開きは不可）</small></div>`;
  document.body.appendChild(el);
});
