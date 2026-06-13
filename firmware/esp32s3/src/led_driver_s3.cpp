/**
 * ESP32-S3 — LCD (I8080) + DMA multi-pin parallel (FastLED).
 */
#define FASTLED_USES_ESP32S3_I2S
#include <Arduino.h>
#include <FastLED.h>

#include "glowbe_layout.h"
#include "led_driver.h"

namespace {

CRGB leds[GLOWBE_LED_COUNT];

}  // namespace

void glowbe_led_init() {
  GLOWBE_FASTLED_REGISTER_PARALLEL(leds);
  FastLED.setBrightness(255);
  FastLED.setDither(0);
  // TODO: set budget (mA) from PCB / supply rating; prevents brownout on all-white.
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 4000);
}

void glowbe_led_set_rgb(const uint8_t* rgb) {
  for (int i = 0; i < GLOWBE_LED_COUNT; i++) {
    const size_t o = static_cast<size_t>(i) * 3;
    CRGB c(rgb[o], rgb[o + 1], rgb[o + 2]);
    glowbe_led_dim(c);
    leds[i] = c;
  }
}

void glowbe_led_show() {
  FastLED.show();
}

void glowbe_led_apply_rgb(const uint8_t* rgb) {
  glowbe_led_set_rgb(rgb);
  glowbe_led_show();
}

void glowbe_led_rainbow_pattern(int32_t t_ms, bool reverse) {
  const int32_t t = reverse ? -t_ms : t_ms;
  for (int i = 0; i < GLOWBE_LED_COUNT; i++) {
    CRGB c = CHSV(static_cast<uint8_t>(t / 8 + i * 2), 220, 180);
    glowbe_led_dim(c);
    leds[i] = c;
  }
  FastLED.show();
}

void glowbe_led_test_pattern(uint32_t t_ms) {
  glowbe_led_rainbow_pattern(static_cast<int32_t>(t_ms), false);
}

const char* glowbe_led_driver_name() {
  return "esp32s3-lcd-dma-parallel";
}
