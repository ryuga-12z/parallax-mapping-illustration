using UnityEngine;
using UnityEngine.InputSystem;

public class QuadTilt : MonoBehaviour
{
    [SerializeField] float maxAngle = 30f;   // 最大傾き角
    [SerializeField] float speed = 8f;       // 追従のなめらかさ

    void Update()
    {
        if (Mouse.current == null) return;

        // マウス位置を画面の中心基準で -1〜1 に正規化
        Vector2 m = Mouse.current.position.ReadValue();
        float nx = (m.x / Screen.width)  * 2f - 1f;
        float ny = (m.y / Screen.height) * 2f - 1f;

        // 横の動きで Y軸、縦の動きで X軸を傾ける
        Quaternion target = Quaternion.Euler(ny * (maxAngle*-0.2f), nx * (maxAngle*-0.2f), 0f);
        transform.rotation = Quaternion.Slerp(transform.rotation, target, speed * Time.deltaTime);
    }
}