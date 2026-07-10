#pragma once

#include "glowbe_layout.h"

// Full white: 16 mA per LED. Global cap via GLOWBE_MAX_CURRENT_MA (build env or -D).
#ifndef GLOWBE_MAX_CURRENT_MA
#define GLOWBE_MAX_CURRENT_MA 3200u
#endif

constexpr uint32_t kGlowbeMaxCurrentMa = GLOWBE_MAX_CURRENT_MA;
constexpr uint32_t kGlowbeLedWhiteMa = 16u;

constexpr uint32_t kGlowbeBrightnessDenom =
    static_cast<uint32_t>(GLOWBE_LED_COUNT) * kGlowbeLedWhiteMa;

constexpr uint32_t kGlowbeBrightnessRaw =
    kGlowbeBrightnessDenom == 0u
        ? 0u
        : (255u * kGlowbeMaxCurrentMa) / kGlowbeBrightnessDenom;

constexpr uint8_t kGlowbeLedBrightness = static_cast<uint8_t>(
    kGlowbeBrightnessRaw > 255u ? 255u : kGlowbeBrightnessRaw);
