//! Signed distance field from a square binary mask (pixel-art stamps).

pub fn sdf_from_mask(mask: &[bool], size: u32) -> Vec<f32> {
    let n = (size * size) as usize;
    debug_assert_eq!(mask.len(), n);
    let inf = 1e20f32;

    let mut dist_out = vec![0.0f32; n];
    let mut f = vec![0.0f32; size as usize];
    let mut d = vec![0.0f32; size as usize];
    for y in 0..size {
        for x in 0..size {
            let i = (y * size + x) as usize;
            f[x as usize] = if mask[i] { 0.0 } else { inf };
        }
        edt_1d(&f, &mut d, size as usize);
        for x in 0..size {
            dist_out[(y * size + x) as usize] = d[x as usize];
        }
    }

    let mut dist_out2 = vec![0.0f32; n];
    for x in 0..size {
        for y in 0..size {
            f[y as usize] = dist_out[(y * size + x) as usize];
        }
        edt_1d(&f, &mut d, size as usize);
        for y in 0..size {
            dist_out2[(y * size + x) as usize] = d[y as usize];
        }
    }

    let mut dist_in = vec![0.0f32; n];
    for y in 0..size {
        for x in 0..size {
            let i = (y * size + x) as usize;
            f[x as usize] = if mask[i] { inf } else { 0.0 };
        }
        edt_1d(&f, &mut d, size as usize);
        for x in 0..size {
            dist_in[(y * size + x) as usize] = d[x as usize];
        }
    }

    for x in 0..size {
        for y in 0..size {
            f[y as usize] = dist_in[(y * size + x) as usize];
        }
        edt_1d(&f, &mut d, size as usize);
        for y in 0..size {
            dist_in[(y * size + x) as usize] = d[y as usize];
        }
    }

    let half = size as f32 / 2.0;
    let mut sdf = vec![0.0f32; n];
    for i in 0..n {
        let out_d = dist_out2[i].sqrt();
        let in_d = dist_in[i].sqrt();
        sdf[i] = if mask[i] {
            -in_d / half
        } else {
            out_d / half
        };
    }
    sdf
}

fn edt_1d(f: &[f32], d: &mut [f32], n: usize) {
    let mut v = vec![0i32; n];
    let mut z = vec![0.0f32; n + 1];
    let mut k = 0usize;
    v[0] = 0;
    z[0] = f32::NEG_INFINITY;
    z[1] = f32::INFINITY;
    for q in 1..n {
        let mut s = intersection(q, f, v[k] as usize);
        while k > 0 && s <= z[k] {
            k -= 1;
            s = intersection(q, f, v[k] as usize);
        }
        k += 1;
        v[k] = q as i32;
        z[k] = s;
        z[k + 1] = f32::INFINITY;
    }
    k = 0;
    for q in 0..n {
        while z[k + 1] < q as f32 {
            k += 1;
        }
        let dx = q as f32 - v[k] as f32;
        d[q] = dx * dx + f[v[k] as usize];
    }
}

fn intersection(q: usize, f: &[f32], v: usize) -> f32 {
    ((f[q] + (q * q) as f32) - (f[v] + (v * v) as f32)) / (2.0 * q as f32 - 2.0 * v as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_center_is_inside() {
        let size = 32u32;
        let cx = 16.0f32;
        let cy = 16.0f32;
        let r = 8.0f32;
        let mut mask = vec![false; (size * size) as usize];
        for y in 0..size {
            for x in 0..size {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                mask[(y * size + x) as usize] = dx * dx + dy * dy <= r * r;
            }
        }
        let sdf = sdf_from_mask(&mask, size);
        let center = sdf[(16 * size + 16) as usize];
        assert!(center < 0.0, "center inside: {center}");
        let outside = sdf[(16 * size + 26) as usize];
        assert!(outside > 0.0, "outside positive: {outside}");
    }
}
