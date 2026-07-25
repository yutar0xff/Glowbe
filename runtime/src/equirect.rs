//! Low-resolution equirectangular RGB buffers (layout-independent).

pub const DEFAULT_WIDTH: u32 = 256;
pub const DEFAULT_HEIGHT: u32 = 128;

/// Bilinear sample from a single equirect RGB frame (`width * height * 3` bytes).
pub fn sample_bilinear_rgb(frame: &[u8], width: u32, height: u32, u: f32, v: f32) -> [u8; 3] {
    if width == 0 || height == 0 || frame.len() < (width * height * 3) as usize {
        return [0, 0, 0];
    }
    let w = width as usize;
    let h = height as usize;
    let u = u.rem_euclid(1.0);
    let v = v.clamp(0.0, 1.0);
    let x = u * width as f32;
    let y = v * (height.saturating_sub(1)) as f32;

    let x0 = x.floor() as usize % w;
    let x1 = (x0 + 1) % w;
    let y0 = y.floor() as usize;
    let y1 = (y0 + 1).min(h - 1);
    let tx = x - x.floor();
    let ty = y - y.floor();

    let idx = |xx: usize, yy: usize| (yy * w + xx) * 3;
    let c00 = &frame[idx(x0, y0)..idx(x0, y0) + 3];
    let c10 = &frame[idx(x1, y0)..idx(x1, y0) + 3];
    let c01 = &frame[idx(x0, y1)..idx(x0, y1) + 3];
    let c11 = &frame[idx(x1, y1)..idx(x1, y1) + 3];

    [
        lerp2(c00[0], c10[0], c01[0], c11[0], tx, ty),
        lerp2(c00[1], c10[1], c01[1], c11[1], tx, ty),
        lerp2(c00[2], c10[2], c01[2], c11[2], tx, ty),
    ]
}

fn lerp2(c00: u8, c10: u8, c01: u8, c11: u8, tx: f32, ty: f32) -> u8 {
    let top = c00 as f32 * (1.0 - tx) + c10 as f32 * tx;
    let bottom = c01 as f32 * (1.0 - tx) + c11 as f32 * tx;
    (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8
}

/// Resize an RGBA image to the default equirect resolution and pack as raw RGB.
pub fn rgba_to_equirect_rgb(img: &image::RgbaImage, width: u32, height: u32) -> Vec<u8> {
    let resized =
        image::imageops::resize(img, width, height, image::imageops::FilterType::Triangle);
    let mut out = vec![0u8; (width * height * 3) as usize];
    for (x, y, pixel) in resized.enumerate_pixels() {
        let o = ((y * width + x) * 3) as usize;
        out[o] = pixel[0];
        out[o + 1] = pixel[1];
        out[o + 2] = pixel[2];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bilinear_wraps_horizontally() {
        let mut frame = vec![0u8; 2 * 3];
        frame[0..3].copy_from_slice(&[255, 0, 0]);
        frame[3..6].copy_from_slice(&[0, 0, 255]);
        assert_eq!(sample_bilinear_rgb(&frame, 2, 1, 0.0, 0.0), [255, 0, 0]);
        assert_eq!(sample_bilinear_rgb(&frame, 2, 1, 0.5, 0.0), [0, 0, 255]);
        assert_eq!(sample_bilinear_rgb(&frame, 2, 1, 1.0, 0.0), [255, 0, 0]);
    }
}
