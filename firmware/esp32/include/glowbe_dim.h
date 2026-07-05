#pragma once

#include <stdint.h>

#include "glowbe_brightness.h"

inline uint8_t glowbe_dim_channel(uint8_t channel) {
  return static_cast<uint8_t>((static_cast<uint16_t>(channel) * kGlowbeLedBrightness) / 255u);
}
