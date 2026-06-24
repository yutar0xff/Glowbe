#ifndef GLOWBE_WIRE_H
#define GLOWBE_WIRE_H

#include <Arduino.h>
#include <cstring>

namespace glowbe::wire {

constexpr uint8_t kMagic0 = 0x47;
constexpr uint8_t kMagic1 = 0x42;
constexpr uint8_t kVersion = 1;
constexpr uint8_t kMsgFrame = 1;
constexpr uint8_t kMsgLink = 4;
constexpr uint8_t kHeaderSize = 16;
// Datagram = kHeaderSize + chunk; IPv4 UDP payload max 1472 → chunk ≤ 1456 (use 1440).
// Must match runtime `MAX_CHUNK_PAYLOAD`.
constexpr size_t kMaxChunkPayload = 1440;
/// Backward `frame_id` jump larger than this resets assembly (runtime restart).
constexpr int32_t kStreamResetFrameLag = 10000;

struct FrameHeader {
  uint32_t frame_id;
  uint16_t led_count;
  uint16_t chunk_index;
  uint16_t chunk_count;
  uint16_t payload_len;
};

inline bool parseHeader(const uint8_t* data, size_t len, FrameHeader& out) {
  if (len < kHeaderSize) return false;
  if (data[0] != kMagic0 || data[1] != kMagic1) return false;
  if (data[2] != kVersion || data[3] != kMsgFrame) return false;
  out.frame_id = (uint32_t)data[4] | ((uint32_t)data[5] << 8) | ((uint32_t)data[6] << 16) |
                 ((uint32_t)data[7] << 24);
  out.led_count = (uint16_t)data[8] | ((uint16_t)data[9] << 8);
  out.chunk_index = (uint16_t)data[10] | ((uint16_t)data[11] << 8);
  out.chunk_count = (uint16_t)data[12] | ((uint16_t)data[13] << 8);
  out.payload_len = (uint16_t)data[14] | ((uint16_t)data[15] << 8);
  if (out.payload_len > kMaxChunkPayload) return false;
  if (len < kHeaderSize + out.payload_len) return false;
  return true;
}

/// LINK (16 B): byte 4 — `0` = economy (modem sleep OK), non-zero = active.
inline bool parseLink(const uint8_t* data, size_t len, bool& active_out) {
  if (len < kHeaderSize) {
    return false;
  }
  if (data[0] != kMagic0 || data[1] != kMagic1 || data[2] != kVersion || data[3] != kMsgLink) {
    return false;
  }
  active_out = data[4] != 0;
  return true;
}

class FrameAssembler {
 public:
  explicit FrameAssembler(uint16_t expected_led_count)
      : expected_led_count_(expected_led_count),
        expected_bytes_(static_cast<size_t>(expected_led_count) * 3) {
    reset();
  }

  static bool frame_before(uint32_t a, uint32_t b) {
    return a != b && static_cast<int32_t>(a - b) < 0;
  }

  void reset() {
    assembling_id_ = 0;
    chunk_count_ = 0;
    received_bytes_ = 0;
    memset(received_mask_, 0, sizeof(received_mask_));
    memset(chunk_sizes_, 0, sizeof(chunk_sizes_));
    memset(buffer_, 0, sizeof(buffer_));
    have_last_completed_frame_ = false;
    last_completed_frame_id_ = 0;
  }

  bool ingest(const FrameHeader& hdr, const uint8_t* payload, size_t expected_led_count) {
    if (hdr.led_count != expected_led_count || hdr.chunk_count == 0 ||
        hdr.chunk_index >= hdr.chunk_count || hdr.chunk_count > 64) {
      return false;
    }

    const uint16_t expected_chunks = chunkCountForPayload(expected_bytes_);
    if (hdr.chunk_count != expected_chunks) {
      return false;
    }

    if (have_last_completed_frame_ && frame_before(hdr.frame_id, last_completed_frame_id_)) {
      const int32_t delta =
          static_cast<int32_t>(hdr.frame_id - last_completed_frame_id_);
      if (delta < -kStreamResetFrameLag) {
        reset();
      } else {
        return false;
      }
    }
    if (chunk_count_ > 0 && frame_before(hdr.frame_id, assembling_id_)) {
      return false;
    }

    if (hdr.frame_id != assembling_id_ || chunk_count_ == 0) {
      if (chunk_count_ > 0 && !assembly_fully_received()) {
        incomplete_frame_aborts_++;
      }
      assembling_id_ = hdr.frame_id;
      chunk_count_ = hdr.chunk_count;
      received_bytes_ = 0;
      memset(received_mask_, 0, sizeof(received_mask_));
      memset(chunk_sizes_, 0, sizeof(chunk_sizes_));
      memset(buffer_, 0, expected_bytes_);
    }

    if (hdr.chunk_count != chunk_count_) {
      return false;
    }

    const size_t offset = chunkByteOffset(hdr.chunk_index, expected_bytes_);
    const uint16_t expected_len =
        static_cast<uint16_t>(chunkPayloadLen(hdr.chunk_index, hdr.chunk_count, expected_bytes_));
    if (hdr.payload_len != expected_len || offset + hdr.payload_len > expected_bytes_) {
      return false;
    }

    if (received_mask_[hdr.chunk_index]) {
      received_bytes_ -= chunk_sizes_[hdr.chunk_index];
    }

    memcpy(buffer_ + offset, payload, hdr.payload_len);
    chunk_sizes_[hdr.chunk_index] = hdr.payload_len;
    received_mask_[hdr.chunk_index] = true;
    received_bytes_ += hdr.payload_len;

    if (received_bytes_ != expected_bytes_) {
      return false;
    }
    for (uint16_t i = 0; i < chunk_count_; i++) {
      if (!received_mask_[i]) {
        return false;
      }
    }
    last_completed_frame_id_ = assembling_id_;
    have_last_completed_frame_ = true;
    return true;
  }

  const uint8_t* buffer() const { return buffer_; }

  /// Assembly aborted: new `frame_id` arrived before the previous frame had all chunks.
  uint32_t incomplete_frame_aborts() const { return incomplete_frame_aborts_; }

 private:
  bool assembly_fully_received() const {
    if (chunk_count_ == 0 || received_bytes_ != expected_bytes_) {
      return false;
    }
    for (uint16_t i = 0; i < chunk_count_; i++) {
      if (!received_mask_[i]) {
        return false;
      }
    }
    return true;
  }

  static uint16_t chunkCountForPayload(size_t total_rgb) {
    return static_cast<uint16_t>((total_rgb + kMaxChunkPayload - 1) / kMaxChunkPayload);
  }

  static size_t chunkByteOffset(uint16_t chunk_index, size_t total_rgb) {
    size_t off = 0;
    for (uint16_t i = 0; i < chunk_index; i++) {
      const size_t remain = total_rgb - off;
      const size_t len = remain > kMaxChunkPayload ? kMaxChunkPayload : remain;
      off += len;
    }
    return off;
  }

  static size_t chunkPayloadLen(uint16_t chunk_index, uint16_t chunk_count, size_t total_rgb) {
    if (chunk_index >= chunk_count) {
      return 0;
    }
    const size_t off = chunkByteOffset(chunk_index, total_rgb);
    const size_t remain = total_rgb - off;
    return remain > kMaxChunkPayload ? kMaxChunkPayload : remain;
  }

  uint16_t expected_led_count_;
  size_t expected_bytes_;
  uint32_t assembling_id_ = 0;
  uint16_t chunk_count_ = 0;
  size_t received_bytes_ = 0;
  uint16_t chunk_sizes_[64] = {};
  bool received_mask_[64] = {};
  uint8_t buffer_[4096];
  uint32_t incomplete_frame_aborts_ = 0;
  uint32_t last_completed_frame_id_ = 0;
  bool have_last_completed_frame_ = false;
};

}  // namespace glowbe::wire

#endif
