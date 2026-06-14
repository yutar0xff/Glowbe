/// Prototype loop pattern (runtime / Web 用)。ワイヤバッファは **論理 RGB**（R,G,B 順）。
pub fn fill_loop_rgb(led_count: usize, t_ms: u32, rgb: &mut [u8]) {
    const LEDS_PER_LINE: usize = 45;
    let t = t_ms;

    for g in 0..led_count {
        let line = g / LEDS_PER_LINE;
        let i = g % LEDS_PER_LINE;
        let hue = (t / 8 + (line as u32) * 40 + (i as u32) * 2) as u8;
        let (r, gr, b) = hsv_to_rgb(hue, 220, 180);
        let o = g * 3;
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
