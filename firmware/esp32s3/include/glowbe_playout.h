#pragma once

#include <Arduino.h>
#include <cstring>

#include "glowbe_layout.h"

/**
 * プレイアウト（ジッタバッファ）
 *
 * - 0: 完全フレーム受信ごとに即 `apply`。
 * - N>0: 受信フレームをリングに積み、論理キュー長が N を超えたら最古を 1 回 `apply`。
 *   起動直後〜N フレームまでは遅延が溜まらないため、最新フレームを表示（黒つなぎを避ける）。
 *
 * 一般的なストリーミングの「リングバッファ + 再生遅延」に相当。UDP のバースト／欠落に対し
 * 表示タイミングをならす。遅延はおよそ N フレーム分（送信レートに依存）。
 *
 * ビルド上書き例（platformio.ini の build_flags）:
 *   -D GLOWBE_PLAYOUT_LAG_FRAMES=0
 *   -D GLOWBE_PLAYOUT_RING_CAP=12
 */
#ifndef GLOWBE_PLAYOUT_LAG_FRAMES
#define GLOWBE_PLAYOUT_LAG_FRAMES 2
#endif

#ifndef GLOWBE_PLAYOUT_RING_CAP
#define GLOWBE_PLAYOUT_RING_CAP 8
#endif

namespace glowbe::playout {

#if GLOWBE_PLAYOUT_LAG_FRAMES == 0

class Ring {
 public:
  static constexpr size_t kRgbBytes = static_cast<size_t>(GLOWBE_LED_COUNT) * 3U;

  void reset() {}

  void push(const uint8_t* rgb, void (*apply)(const uint8_t*)) { apply(rgb); }
};

#else

static_assert(GLOWBE_PLAYOUT_LAG_FRAMES < GLOWBE_PLAYOUT_RING_CAP,
              "GLOWBE_PLAYOUT_LAG_FRAMES must be < GLOWBE_PLAYOUT_RING_CAP");
static_assert(GLOWBE_PLAYOUT_RING_CAP >= GLOWBE_PLAYOUT_LAG_FRAMES + 2,
              "GLOWBE_PLAYOUT_RING_CAP should be at least lag+2 for burst headroom");

class Ring {
 public:
  static constexpr size_t kRgbBytes = static_cast<size_t>(GLOWBE_LED_COUNT) * 3U;
  static constexpr uint8_t kCap = GLOWBE_PLAYOUT_RING_CAP;
  static constexpr uint8_t kLag = GLOWBE_PLAYOUT_LAG_FRAMES;

  void reset() {
    memset(ring_, 0, sizeof(ring_));
    begin_ = 0;
    size_ = 0;
  }

  /// 完全フレーム `rgb` を投入。方針により 0 または 1 回 `apply`（set_rgb + show 等）を呼ぶ。
  void push(const uint8_t* rgb, void (*apply)(const uint8_t*)) {
    const uint8_t slot = static_cast<uint8_t>((begin_ + size_) % kCap);
    memcpy(ring_[slot], rgb, kRgbBytes);

    if (size_ < kCap) {
      size_++;
    } else {
      // 満杯: 最古スロットを上書きする前に読み取り位置を進める（ライブエッジ優先）
      begin_ = static_cast<uint8_t>((begin_ + 1U) % kCap);
    }

    if (size_ > kLag) {
      apply(ring_[begin_]);
      begin_ = static_cast<uint8_t>((begin_ + 1U) % kCap);
      size_--;
    } else {
      // ウォームアップ中は最新を表示（未受信による消灯を避ける）
      apply(rgb);
    }
  }

 private:
  alignas(4) uint8_t ring_[kCap][kRgbBytes];
  uint8_t begin_ = 0;
  uint8_t size_ = 0;
};

#endif

}  // namespace glowbe::playout
