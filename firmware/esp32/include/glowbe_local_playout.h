#pragma once

#include <Arduino.h>
#include <stdint.h>

namespace glowbe::local {

/// True while Runtime has requested onboard playlist (LOCAL playout=1).
bool active();

/// Called from UDP task when a LOCAL message arrives.
void setActive(bool playout);

/// Master brightness from Runtime LOCAL (0–255 linear). Applies while playout is active.
void setBrightnessU8(uint8_t brightness_u8);

/// Fill `rgb` (led_count*3) for the current playlist time. Call ~120 fps while active.
void renderFrame(uint8_t* rgb, uint16_t led_count, uint32_t now_ms);

/// Reset playlist clock (on enter local mode).
void resetPlaylist(uint32_t now_ms);

/// Frames rendered while local playout is active (for serial diag).
uint32_t framesRendered();

}  // namespace glowbe::local
