pub const MAGIC0: u8 = 0x47;
pub const MAGIC1: u8 = 0x42;
pub const VERSION: u8 = 1;
pub const MSG_FRAME: u8 = 1;
pub const MSG_STATUS: u8 = 3;
pub const HEADER_SIZE: usize = 16;
/// Max RGB bytes per UDP datagram (MTU-friendly; must match firmware `kMaxChunkPayload`).
pub const MAX_CHUNK_PAYLOAD: usize = 1472;

/// Build one or more UDP datagrams for a full RGB frame.
pub fn encode_frame(led_count: u16, frame_id: u32, rgb: &[u8]) -> Vec<Vec<u8>> {
    let total = rgb.len();
    debug_assert_eq!(total, led_count as usize * 3);

    let mut packets = Vec::new();
    let mut offset = 0usize;
    let mut chunk_index = 0u16;

    while offset < total {
        let chunk_len = (total - offset).min(MAX_CHUNK_PAYLOAD);
        let chunk_count = total.div_ceil(MAX_CHUNK_PAYLOAD) as u16;

        let mut pkt = vec![0u8; HEADER_SIZE + chunk_len];
        pkt[0] = MAGIC0;
        pkt[1] = MAGIC1;
        pkt[2] = VERSION;
        pkt[3] = MSG_FRAME;
        pkt[4..8].copy_from_slice(&frame_id.to_le_bytes());
        pkt[8..10].copy_from_slice(&led_count.to_le_bytes());
        pkt[10..12].copy_from_slice(&chunk_index.to_le_bytes());
        pkt[12..14].copy_from_slice(&chunk_count.to_le_bytes());
        pkt[14..16].copy_from_slice(&(chunk_len as u16).to_le_bytes());
        pkt[HEADER_SIZE..HEADER_SIZE + chunk_len].copy_from_slice(&rgb[offset..offset + chunk_len]);

        packets.push(pkt);
        offset += chunk_len;
        chunk_index += 1;
    }

    packets
}

pub fn parse_status(data: &[u8]) -> Option<Status> {
    if data.len() < HEADER_SIZE {
        return None;
    }
    if data[0] != MAGIC0 || data[1] != MAGIC1 || data[2] != VERSION || data[3] != MSG_STATUS {
        return None;
    }
    let frames_complete = u32::from_le_bytes(data[4..8].try_into().ok()?);
    let fps_rx_x10 = u16::from_le_bytes(data[8..10].try_into().ok()?);
    let drops = u16::from_le_bytes(data[10..12].try_into().ok()?);
    let rssi = data[12] as i8;
    let layout_hash = if data.len() >= 20 {
        Some(u32::from_le_bytes(data[16..20].try_into().ok()?))
    } else {
        None
    };
    Some(Status {
        frames_complete,
        fps_rx_x10,
        drops,
        rssi,
        layout_hash,
    })
}

#[derive(Debug, Clone)]
pub struct Status {
    pub frames_complete: u32,
    pub fps_rx_x10: u16,
    /// Discarded/dropped packets (low 16 bits), per Glowbe Wire v1 STATUS offset 10.
    pub drops: u16,
    pub rssi: i8,
    /// Layout fingerprint from ESP (bytes 16–19 LE); `None` if packet is legacy 16-byte STATUS.
    pub layout_hash: Option<u32>,
}

impl Status {
    pub fn fps_rx(&self) -> f64 {
        self.fps_rx_x10 as f64 / 10.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_single_chunk_prototype() {
        let led_count = 225u16;
        let rgb: Vec<u8> = (0..led_count as usize * 3).map(|i| i as u8).collect();
        let pkts = encode_frame(led_count, 42, &rgb);
        assert_eq!(pkts.len(), 1);
        let p = &pkts[0];
        assert_eq!(&p[0..4], &[MAGIC0, MAGIC1, VERSION, MSG_FRAME]);
        assert_eq!(u32::from_le_bytes(p[4..8].try_into().unwrap()), 42);
        assert_eq!(u16::from_le_bytes(p[8..10].try_into().unwrap()), led_count);
        assert_eq!(u16::from_le_bytes(p[14..16].try_into().unwrap()), 675);
        assert_eq!(p.len(), HEADER_SIZE + 675);
    }

    #[test]
    fn parse_status_roundtrip_fields() {
        let mut pkt = [0u8; 16];
        pkt[0] = MAGIC0;
        pkt[1] = MAGIC1;
        pkt[2] = VERSION;
        pkt[3] = MSG_STATUS;
        pkt[4..8].copy_from_slice(&100u32.to_le_bytes());
        pkt[8..10].copy_from_slice(&602u16.to_le_bytes());
        pkt[10..12].copy_from_slice(&3u16.to_le_bytes());
        pkt[12] = (-55i8) as u8;
        let st = parse_status(&pkt).unwrap();
        assert_eq!(st.frames_complete, 100);
        assert!((st.fps_rx() - 60.2).abs() < 0.01);
        assert_eq!(st.drops, 3);
        assert_eq!(st.rssi, -55);
        assert!(st.layout_hash.is_none());
    }

    #[test]
    fn parse_status_with_layout_hash() {
        let mut pkt = [0u8; 20];
        pkt[0] = MAGIC0;
        pkt[1] = MAGIC1;
        pkt[2] = VERSION;
        pkt[3] = MSG_STATUS;
        pkt[16..20].copy_from_slice(&0x7c501117u32.to_le_bytes());
        let st = parse_status(&pkt).unwrap();
        assert_eq!(st.layout_hash, Some(0x7c501117));
    }

    #[test]
    fn encode_multi_chunk_when_payload_exceeds_max() {
        let led_count = 500u16;
        let rgb: Vec<u8> = vec![0; led_count as usize * 3];
        let pkts = encode_frame(led_count, 1, &rgb);
        assert!(pkts.len() > 1);
        let total_payload: usize = pkts.iter().map(|p| p.len() - HEADER_SIZE).sum();
        assert_eq!(total_payload, rgb.len());
    }
}
