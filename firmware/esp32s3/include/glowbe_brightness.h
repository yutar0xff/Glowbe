#pragma once

#include "glowbe_layout.h"

// White at full drive: 5 mA per RGB channel → 15 mA/LED.
// Cap all-white current to 80% of a 4 A adapter (3.2 A).
constexpr uint32_t kGlowbeAdapterMa = 4000;
constexpr uint32_t kGlowbeSupplyUtilizationPercent = 80;
constexpr uint32_t kGlowbeLedWhiteMa = 15;

constexpr uint32_t kGlowbeSupplyBudgetMa =
    (kGlowbeAdapterMa * kGlowbeSupplyUtilizationPercent) / 100u;

constexpr uint32_t kGlowbeBrightnessDenom =
    static_cast<uint32_t>(GLOWBE_LED_COUNT) * kGlowbeLedWhiteMa;

constexpr uint32_t kGlowbeBrightnessRaw =
    kGlowbeBrightnessDenom == 0u
        ? 0u
        : (255u * kGlowbeSupplyBudgetMa) / kGlowbeBrightnessDenom;

constexpr uint8_t kGlowbeLedBrightness = static_cast<uint8_t>(
    kGlowbeBrightnessRaw > 255u ? 255u : kGlowbeBrightnessRaw);
