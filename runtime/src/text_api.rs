//! Shared helpers for text mode HTTP handlers.

/// `#rrggbb`（先頭 `#` は任意）を RGB へ。長さ・16進が不正なら `None`。
pub fn parse_hex_rgb(s: &str) -> Option<[u8; 3]> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some([r, g, b])
}

/// RGB を `#rrggbb` 文字列へ。
#[must_use]
pub fn hex_rgb(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// content の最大文字数（過大なリボン生成を防ぐ）。
pub const MAX_CONTENT_CHARS: usize = 256;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        assert_eq!(parse_hex_rgb("#1a2b3c"), Some([0x1a, 0x2b, 0x3c]));
        assert_eq!(parse_hex_rgb("FFFFFF"), Some([255, 255, 255]));
        assert_eq!(hex_rgb([0, 128, 255]), "#0080ff");
        assert_eq!(parse_hex_rgb("#fff"), None);
        assert_eq!(parse_hex_rgb("zzzzzz"), None);
    }
}
