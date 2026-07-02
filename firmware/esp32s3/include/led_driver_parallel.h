#pragma once

#include <Arduino.h>
#include <NeoPixelBus.h>

#include "glowbe_dim.h"
#include "glowbe_layout.h"

#ifndef GLOWBE_MAX_LINE_LEDS
#error "GLOWBE_MAX_LINE_LEDS is missing — run tools/layout-compile.ts for this layout"
#endif

namespace glowbe::led_parallel {

constexpr uint32_t kLatchSettleUs = 300;

inline RgbColor dimRgb(uint8_t r, uint8_t g, uint8_t b) {
  return RgbColor(glowbe_dim_channel(r), glowbe_dim_channel(g), glowbe_dim_channel(b));
}

template <typename Strip>
void waitReady(Strip* const* lines, uint8_t line_count) {
  for (;;) {
    bool all = true;
    for (uint8_t line = 0; line < line_count; line++) {
      if (!lines[line]->CanShow()) {
        all = false;
        break;
      }
    }
    if (all) {
      delayMicroseconds(kLatchSettleUs);
      return;
    }
    yield();
  }
}

template <typename Strip>
void setRgb(Strip* const* lines, uint8_t line_count, const uint8_t* rgb) {
  waitReady(lines, line_count);
  static const RgbColor black(0, 0, 0);
  size_t offset = 0;
  for (uint8_t line = 0; line < line_count; line++) {
    Strip* strip = lines[line];
    const uint16_t n = GLOWBE_LINE_LED_COUNTS[line];
    for (uint16_t i = 0; i < n; i++) {
      strip->SetPixelColor(i, dimRgb(rgb[offset], rgb[offset + 1], rgb[offset + 2]));
      offset += 3;
    }
    for (uint16_t i = n; i < GLOWBE_MAX_LINE_LEDS; i++) {
      strip->SetPixelColor(i, black);
    }
  }
}

template <typename Strip>
void show(Strip* const* lines, uint8_t line_count) {
  for (uint8_t line = 0; line < line_count; line++) {
    lines[line]->Show();
  }
  waitReady(lines, line_count);
}

template <typename Strip>
void clear(Strip* const* lines, uint8_t line_count) {
  waitReady(lines, line_count);
  for (uint8_t line = 0; line < line_count; line++) {
    lines[line]->ClearTo(RgbColor(0, 0, 0));
  }
  show(lines, line_count);
}

}  // namespace glowbe::led_parallel
