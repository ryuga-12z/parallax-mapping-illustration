// parallax-mapping-illustrationGUI.cs
// parallax-mapping-illustration シェーダーのパラメータを Game View 上の IMGUI ウィンドウで
// リアルタイム編集するコントローラー。

using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.InputSystem;

public class ParallaxMappingGUI : MonoBehaviour
{
    [Header("対象レンダラー")]
    public Renderer targetRenderer;

    // ウィンドウの位置・サイズ
    private Rect _windowRect = new Rect(20, 20, 310, 370);

    // スペースキーで表示・非表示を切り替え（デフォルトは表示）
    private bool _guiVisible = true;

    // 各パラメータ値（シェーダーデフォルトに合わせた初期値）
    private float _rootDepth = 0.5f;
    private float _depth0    = 0.0f;
    private float _depth1    = 0.4f;
    private float _depth2    = 0.75f;
    private float _depth3    = 1.0f;
    private bool _hologramEnable = false;

    // シェーダープロパティ名を ID 化（文字列タイポ防止 & パフォーマンス向上）
    private static class Prop
    {
        public static readonly int RootDepth = Shader.PropertyToID("_RootDepth");
        public static readonly int Depth0    = Shader.PropertyToID("_Depth0");
        public static readonly int Depth1    = Shader.PropertyToID("_Depth1");
        public static readonly int Depth2    = Shader.PropertyToID("_Depth2");
        public static readonly int Depth3    = Shader.PropertyToID("_Depth3");
        public static readonly int Tex0       = Shader.PropertyToID("_Tex0");
        public static readonly int Tex1       = Shader.PropertyToID("_Tex1");
        public static readonly int Tex2       = Shader.PropertyToID("_Tex2");
        public static readonly int Tex3       = Shader.PropertyToID("_Tex3");
        public static readonly int HologramEnable = Shader.PropertyToID("_HologramEnable");
    }

    // ランタイムで読み込んだテクスチャ（OnDestroy で解放するために保持）
    private readonly Texture2D[] _loadedTextures  = new Texture2D[4];
    // OnGUI 内のアロケーションを抑えるための表示用キャッシュ済み文字列
    private readonly string[]    _texDisplayNames  = { "none", "none", "none", "none" };

    // ウィンドウ ID（シーン内の他ウィンドウと衝突しないよう InstanceID を使用）
    private int _windowId;

    // ─── Windows ネイティブファイルダイアログ (comdlg32.dll) ─────────────────────
#if UNITY_EDITOR_WIN || UNITY_STANDALONE_WIN
    /// <summary>GetOpenFileName に渡す OPENFILENAME 構造体。</summary>
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private class OpenFileName
    {
        public int    lStructSize       = Marshal.SizeOf(typeof(OpenFileName));
        public IntPtr hwndOwner         = IntPtr.Zero;
        public IntPtr hInstance         = IntPtr.Zero;
        public string lpstrFilter       = null;
        public string lpstrCustomFilter = null;
        public int    nMaxCustFilter    = 0;
        public int    nFilterIndex      = 0;
        public string lpstrFile         = null;
        public int    nMaxFile          = 0;
        public string lpstrFileTitle    = null;
        public int    nMaxFileTitle     = 0;
        public string lpstrInitialDir   = null;
        public string lpstrTitle        = null;
        public int    Flags             = 0;
        public short  nFileOffset       = 0;
        public short  nFileExtension    = 0;
        public string lpstrDefExt       = null;
        public IntPtr lCustData         = IntPtr.Zero;
        public IntPtr lpfnHook          = IntPtr.Zero;
        public string lpTemplateName    = null;
        public IntPtr pvReserved        = IntPtr.Zero;
        public int    dwReserved        = 0;
        public int    flagsEx           = 0;
    }

    [DllImport("comdlg32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool GetOpenFileName([In, Out] OpenFileName ofn);
#endif
    // ────────────────────────────────────────────────────────────────────────────

    private Material _mat;

    private void Start()
    {
        // Inspector 未アサインの場合、同 GameObject の Renderer を自動取得
        if (targetRenderer == null)
            targetRenderer = GetComponent<Renderer>();

        if (targetRenderer != null)
        {
            // インスタンスコピーを取得して元のマテリアルアセットを汚さない
            _mat = targetRenderer.material;

            // 現在のマテリアル値を UI の初期値として読み込む（プロパティ存在確認付き）
            if (_mat.HasProperty(Prop.RootDepth)) _rootDepth = _mat.GetFloat(Prop.RootDepth);
            if (_mat.HasProperty(Prop.Depth0))    _depth0    = _mat.GetFloat(Prop.Depth0);
            if (_mat.HasProperty(Prop.Depth1))    _depth1    = _mat.GetFloat(Prop.Depth1);
            if (_mat.HasProperty(Prop.Depth2))    _depth2    = _mat.GetFloat(Prop.Depth2);
            if (_mat.HasProperty(Prop.Depth3))    _depth3    = _mat.GetFloat(Prop.Depth3);
            if (_mat.HasProperty(Prop.HologramEnable))
                _hologramEnable = _mat.GetFloat(Prop.HologramEnable) > 0.5f;
        }
        else
        {
            Debug.LogWarning("[イラスト立体視ツール] Target Renderer が未アサインです。Inspector で設定してください。");
        }

        // シーン内の他ウィンドウと ID が衝突しないよう InstanceID を使用
        _windowId = GetInstanceID();
    }

    private void Update()
    {
        // スペースキーでウィンドウの表示・非表示を切り替え
        if (Keyboard.current.spaceKey.wasPressedThisFrame)
        {
            _guiVisible = !_guiVisible;
        }
    }

    private void OnGUI()
    {
        if (_mat == null || !_guiVisible) return;

        _windowRect = GUILayout.Window(_windowId, _windowRect, DrawWindow, "イラスト立体視ツール");
    }

    /// <summary>GUILayout.Window のコールバック。スライダー群を描画して値が変化した時のみマテリアルへ反映する。</summary>
    private void DrawWindow(int id)
    {
        GUILayout.Space(4);

        // Root Depth
        ApplySlider("全体奥行き", ref _rootDepth, 0.01f, 1.0f, Prop.RootDepth);

        GUILayout.Space(8);
        GUILayout.Label("──各レイヤーの奥行き ──");

        // 各レイヤーの奥行き
        ApplySlider("レイヤー0  背景",      ref _depth0, 0f, 1f, Prop.Depth0);
        ApplySlider("レイヤー1  中景",     ref _depth1, 0f, 1f, Prop.Depth1);
        ApplySlider("レイヤー2  前景",      ref _depth2, 0f, 1f, Prop.Depth2);
        ApplySlider("レイヤー3  最前景", ref _depth3, 0f, 1f, Prop.Depth3);

        GUILayout.Space(8);
        bool newHolo = GUILayout.Toggle(_hologramEnable, "  ホログラム有効");
        if (newHolo != _hologramEnable)
        {
            _hologramEnable = newHolo;
            _mat.SetFloat(Prop.HologramEnable, _hologramEnable ? 1f : 0f);
            if (_hologramEnable) _mat.EnableKeyword("_HOLOGRAM_ON");
            else                 _mat.DisableKeyword("_HOLOGRAM_ON");
        }

        GUILayout.Space(10);
        GUILayout.Label("─── テクスチャ ───");

        // テクスチャスロット（ボタンでファイルピッカーを開く）
        DrawTexturePicker(0, "Tex0",   Prop.Tex0);
        DrawTexturePicker(1, "Tex1",   Prop.Tex1);
        DrawTexturePicker(2, "Tex2",   Prop.Tex2);
        DrawTexturePicker(3, "Tex3",   Prop.Tex3);

        GUILayout.Space(10);
        GUILayout.Label("[ Space ] メニュー表示/非表示切り替え");

        // ウィンドウ自体をドラッグ可能にする
        GUI.DragWindow();
    }

    /// <summary>「ラベル + スライダー + 数値」を1行で描画し、値が変化した時のみ SetFloat でマテリアルへ反映する。</summary>
    private void ApplySlider(string label, ref float value, float min, float max, int propId)
    {
        GUILayout.BeginHorizontal();
        GUILayout.Label(label, GUILayout.Width(125));
        float newVal = GUILayout.HorizontalSlider(value, min, max, GUILayout.Width(110));
        GUILayout.Label(newVal.ToString("F2"), GUILayout.Width(36));
        GUILayout.EndHorizontal();

        // 値が変化した時のみ GPU パラメータを更新（OnGUI は1フレームに複数回呼ばれるため）
        if (!Mathf.Approximately(newVal, value))
        {
            value = newVal;
            _mat.SetFloat(propId, value);
        }
    }

    /// <summary>テクスチャスロット1行を描画し、「...」ボタンでファイルピッカーを開いてテクスチャを差し替える。</summary>
    private void DrawTexturePicker(int slot, string label, int propId)
    {
        GUILayout.BeginHorizontal();
        GUILayout.Label(label, GUILayout.Width(100));

        // キャッシュ済みの表示名を使用（OnGUI 内でのアロケーション抑制）
        GUILayout.Label(_texDisplayNames[slot], GUILayout.Width(140));

        if (GUILayout.Button("...", GUILayout.Width(30)))
        {
#if UNITY_EDITOR_WIN || UNITY_STANDALONE_WIN
            // Windows: comdlg32.dll を P/Invoke で直接呼ぶ（追加 DLL 不要）
            // 呼び出し中は Unity メインスレッドが一時停止するが、デバッグ用途では許容範囲
            var ofn = new OpenFileName();
            ofn.lpstrFilter   = "画像ファイル\0*.png;*.jpg;*.jpeg\0\0";
            ofn.lpstrFile     = new string('\0', 260); // MAX_PATH
            ofn.nMaxFile      = 260;
            ofn.lpstrTitle    = "テクスチャを選択";
            // OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST
            ofn.Flags         = 0x00080000 | 0x00001000 | 0x00000800;
            if (GetOpenFileName(ofn))
                ApplyTextureFromFile(slot, ofn.lpstrFile.TrimEnd('\0'), propId);
#else
            Debug.LogWarning("[イラスト立体視ツール] ファイルピッカーは Windows 環境でのみ使用できます。");
#endif
        }

        GUILayout.EndHorizontal();
    }

    /// <summary>指定パスの PNG / JPG を読み込んでマテリアルのテクスチャスロットに設定する。</summary>
    private void ApplyTextureFromFile(int slot, string path, int propId)
    {
        // 対象テクスチャは 2048x1260 想定。予備幅を持たせても長辺 4096px 以上は拒否する
        const int  MaxLongSide = 4096;
        const long MaxBytes    = 32L * 1024 * 1024; // 32 MB 上限

        // ファイルサイズ上限チェック（全バイト読み込み前に確認してメモリ枯渇を防ぐ）
        try
        {
            if (new FileInfo(path).Length > MaxBytes)
            {
                Debug.LogError($"[イラスト立体視ツール] ファイルが大きすぎます（32 MB 以下にしてください）: {Path.GetFileName(path)}");
                return;
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException
                                             or System.Security.SecurityException or ArgumentException)
        {
            Debug.LogError($"[イラスト立体視ツール] ファイル情報の取得に失敗: {e.Message}");
            return;
        }

        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException
                                             or System.Security.SecurityException or ArgumentException)
        {
            Debug.LogError($"[イラスト立体視ツール] ファイル読み込み失敗: {e.Message}");
            return;
        }

        // マジックバイト検証（拡張子偽装・誤選択によるクラッシュを防ぐ）
        // PNG: 先頭8バイト = 89 50 4E 47 0D 0A 1A 0A
        // JPG: 先頭2バイト = FF D8
        bool isPng = bytes.Length >= 8
                     && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
                     && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A;
        bool isJpg = bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xD8;
        if (!isPng && !isJpg)
        {
            Debug.LogError($"[イラスト立体視ツール] PNG / JPG 以外のファイルは読み込めません: {Path.GetFileName(path)}");
            return;
        }

        var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        if (!tex.LoadImage(bytes)) // PNG / JPG を自動判別して展開
        {
            Destroy(tex);
            Debug.LogError($"[イラスト立体視ツール] テクスチャのデコードに失敗しました: {Path.GetFileName(path)}");
            return;
        }

        // 寸法チェック（長辺 4096px 以上は拒否）
        int longSide = Mathf.Max(tex.width, tex.height);
        if (longSide >= MaxLongSide)
        {
            Destroy(tex);
            Debug.LogError($"[イラスト立体視ツール] テクスチャが大きすぎます ({tex.width}x{tex.height})。長辺を {MaxLongSide - 1}px 以下にしてください。");
            return;
        }

        // 前回ランタイム読み込み分を解放
        if (_loadedTextures[slot] != null)
            Destroy(_loadedTextures[slot]);

        _loadedTextures[slot]  = tex;
        string fileName        = Path.GetFileName(path);
        // 表示用文字列を更新（OnGUI 内でのアロケーション抑制）
        _texDisplayNames[slot] = fileName.Length > 18 ? "..." + fileName.Substring(fileName.Length - 15) : fileName;
        _mat.SetTexture(propId, tex);
    }

    private void OnDestroy()
    {
        // Start() で生成したインスタンスマテリアルを解放してリークを防ぐ
        if (_mat != null)
            Destroy(_mat);

        // ランタイム読み込みテクスチャを解放
        for (int i = 0; i < _loadedTextures.Length; i++)
        {
            if (_loadedTextures[i] != null)
                Destroy(_loadedTextures[i]);
        }
    }
}
