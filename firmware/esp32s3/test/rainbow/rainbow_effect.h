#pragma once

#include <stdint.h>

namespace glowbe::rainbow {

inline void hsv_to_rgb(uint8_t h, uint8_t s, uint8_t v, uint8_t& r, uint8_t& g, uint8_t& b) {
  if (s == 0) {
    r = g = b = v;
    return;
  }
  const uint8_t region = h / 43;
  const uint8_t remainder = static_cast<uint8_t>((h - region * 43) * 6);
  const uint8_t p = static_cast<uint8_t>((v * (255 - s)) >> 8);
  const uint8_t q = static_cast<uint8_t>((v * (255 - ((s * remainder) >> 8))) >> 8);
  const uint8_t t = static_cast<uint8_t>((v * (255 - ((s * (255 - remainder)) >> 8))) >> 8);
  switch (region) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }
}

inline void fill_frame(uint8_t* rgb, uint16_t led_count, uint8_t hue_offset) {
  if (led_count == 0) {
    return;
  }
  const uint16_t span = led_count > 1 ? static_cast<uint16_t>(led_count - 1) : 1;
  for (uint16_t i = 0; i < led_count; i++) {
    const uint8_t h = static_cast<uint8_t>(hue_offset + (static_cast<uint32_t>(i) * 255u) / span);
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    hsv_to_rgb(h, 255, 255, r, g, b);
    const size_t off = static_cast<size_t>(i) * 3u;
    rgb[off] = r;
    rgb[off + 1] = g;
    rgb[off + 2] = b;
  }
}

inline void scale_bytes(uint8_t* rgb, size_t len, unsigned percent) {
  for (size_t i = 0; i < len; i++) {
    rgb[i] = static_cast<uint8_t>((static_cast<uint32_t>(rgb[i]) * percent) / 100u);
  }
}

}  // namespace glowbe::rainbow
