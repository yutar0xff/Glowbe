/// Prototype loop pattern (runtime / Web 用)。ワイヤバッファは **論理 RGB**（R,G,B 順）。
///
/// `uv` が `ledmap.json` 由来で LED 数と一致するときは **正距円筒 (u,v)** に基づき色相を決め、
/// タイル内も幾何に沿ったグラデーションにする。未ロード・不一致時はワイヤ順インデックスのフォールバック。
pub fn fill_loop_rgb(t_ms: u32, rgb: &mut [u8], uv: Option<&[(f32, f32)]>) {
    let led_count = rgb.len() / 3;
    match uv {
        Some(coords) if coords.len() == led_count => {
            for idx in 0..led_count {
                let (u, v) = coords[idx];
                let hue = hue_from_uv_time(u, v, t_ms);
                let (r, g, b) = hsv_to_rgb(hue, 220, 180);
                let o = idx * 3;
                rgb[o] = r;
                rgb[o + 1] = g;
                rgb[o + 2] = b;
            }
        }
        _ => fill_loop_rgb_chain_fallback(led_count, t_ms, rgb),
    }
}

fn hue_from_uv_time(u: f32, v: f32, t_ms: u32) -> u8 {
    let u = u.clamp(0.0, 1.0);
    let v = v.clamp(0.0, 1.0);
    let space = (u * 200.0 + v * 130.0) as u32;
    ((t_ms / 6).wrapping_add(space)) as u8
}

fn fill_loop_rgb_chain_fallback(led_count: usize, t_ms: u32, rgb: &mut [u8]) {
    let t = t_ms;
    for idx in 0..led_count {
        let hue = (t / 8 + (idx as u32) * 2) as u8;
        let (r, gr, b) = hsv_to_rgb(hue, 220, 180);
        let o = idx * 3;
        rgb[o] = r;
        rgb[o + 1] = gr;
        rgb[o + 2] = b;
    }
}

fn hsv_to_rgb(h: u8, s: u8, v: u8) -> (u8, u8, u8) {
    if s == 0 {
        return (v, v, v);
    }
    let region = h / 43;
    let remainder = (h % 43) as u16 * 6;
    let p = (v as u16 * (255 - s as u16) / 255) as u8;
    let q = (v as u16 * (255 - (s as u16 * remainder / 255)) / 255) as u8;
    let t = (v as u16 * (255 - (s as u16 * (255 - remainder) / 255)) / 255) as u8;
    match region {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uv_pattern_respects_position_not_index_order() {
        let t = 0u32;
        let mut a = [0u8; 6];
        let mut b = [0u8; 6];
        let uv_a = [(0.0f32, 0.0f32), (1.0f32, 1.0f32)];
        let uv_b = [(1.0f32, 1.0f32), (0.0f32, 0.0f32)];
        fill_loop_rgb(t, &mut a, Some(&uv_a));
        fill_loop_rgb(t, &mut b, Some(&uv_b));
        assert_eq!(&a[0..3], &b[3..6], "LED0 with (0,0) should match LED1 with (0,0) swapped");
        assert_eq!(&a[3..6], &b[0..3]);
    }

    #[test]
    fn fallback_linear_changes_with_index() {
        let t = 100u32;
        let mut rgb = [0u8; 6];
        fill_loop_rgb(t, &mut rgb, None);
        assert_ne!(rgb[0..3], rgb[3..6]);
    }
}
