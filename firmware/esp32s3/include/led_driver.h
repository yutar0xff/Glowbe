#pragma once

#include <stdint.h>

#include <FastLED.h>

constexpr uint8_t kGlowbeLedBrightness = 30;

inline void glowbe_led_dim(CRGB& c) { c.nscale8_video(kGlowbeLedBrightness); }

void glowbe_led_init();
void glowbe_led_set_rgb(const uint8_t* rgb);   // wire buffer (GRB) → strip RAM, no show
void glowbe_led_show();                        // latch strips to LEDs
void glowbe_led_apply_rgb(const uint8_t* rgb); // set_rgb + show
void glowbe_led_rainbow_pattern(int32_t t_ms, bool reverse);
void glowbe_led_test_pattern(uint32_t t_ms);
const char* glowbe_led_driver_name();
