# parallax-mapping-illustration

2.5Dイラスト向けの 4 レイヤー視差マッピング＋ホログラムシール表現シェーダー。
1 枚のイラストを「奥行きのある箱の中」のように見せる Unity URP シェーダーと、ブラウザのデモを同梱しています。

- **Unity URP 版（本体）**：[`unity/`](./unity/) — HLSL シェーダー + IMGUI コントローラー + マウス傾斜スクリプト
- **Web デモ（GLSL 移植）**：[`docs/`](./docs/) — three.js / WebGL2 でブラウザ上で動作。GitHub Pages公開用

## デモ

GitHub Pages :


## リポジトリ構成

```
parallax-mapping-illustration/
├── unity/                          Unity URP 用シェーダー本体
└── docs/                           ブラウザ用デモ
```

## Unity での使い方

このリポジトリは シェーダーと補助スクリプトのみを公開しています。
使用する場合は既存の Unity URP プロジェクトに手動で組み込んでください。

### 動作要件

- Unity 6.3 / URP 17 で動作確認済み
- Universal Render Pipeline (URP) が設定済みであること
- Input Systemパッケージ

### 導入手順

1. `unity/` 内のファイルをプロジェクトの `Assets/` 内の任意のフォルダにコピー
2. Material を新規作成し、Shader を `Custom/ParallaxMappingIllustration` に変更
3. Material のプロパティにテクスチャを割り当て
   - `Layer 0 (BG)` 〜 `Layer 3 (Overlay)`：奥 → 手前の順で 4 枚（全部埋めなくても動きます）
   - `Hologram Texture` / `Hologram Texture 2`：`unity/textures/dot.png`、`dot2.png` を割り当て
     - 任意のマスクデータを読み込ませる事でホログラム柄を調整できます。
4. シーンに `Quad`を配置し、作成した Material をアサイン
5. 同じ Quad に `Quad_inclination.cs`を追加。（再生するとマウス位置で Quad が傾きます）
6. 空の GameObject に `parallax_mapping_illustrationGUI.cs`を追加
   - `Target Renderer` に Quad の Renderer をアサイン
     - 再生中に IMGUI ウィンドウでリアルタイム調整ができます。

### シェーダープロパティ

| プロパティ | 範囲 | 説明 |
|---|---|---|
| `Layer 0 / 1 / 2 / 3` | Texture2D | 奥 → 手前 の 4 レイヤー。手前レイヤーは透過PNG推奨|
| `Room Depth` | 0.01–1.0 | 全体の奥行き量 |
| `Layer 0/1/2/3 Depth` | 0–1 | 各レイヤーの視差効果 |
| `Hologram Enable` | Toggle | ホログラム表現 ON/OFF |
| `Hologram Texture` / `Texture 2` | Texture2D | ホログラムのドットパターン |



## Web デモについて

Unity を立ち上げずにブラウザで挙動を確認できるように、ブラウザ版を [`docs/`](./docs/) に同梱しています。
詳細な使い方は [`docs/README.md`](./docs/README.md) を参照してください。

## License

MIT License
