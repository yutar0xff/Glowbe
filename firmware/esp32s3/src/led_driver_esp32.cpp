/**
 * ESP32（無印）— RMT per data line.
 *
 * Wi-Fi 受信と RMT 送出が同時に走るため、UDP 経路ではチラつき対策は main の
 * 受信ドレイン + 単回 show、および FastLED.setDither(0) で行う。
 */
#include <Arduino.h>
#include <FastLED.h>

#include "glowbe_layout.h"
#include "led_driver.h"

namespace {

constexpr uint16_t kMaxLedsPerLine = 64;
CRGB strips[GLOWBE_DATA_LINES][kMaxLedsPerLine];

}  // namespace

void glowbe_led_init() {
  for (uint8_t line = 0; line < GLOWBE_DATA_LINES; line++) {
    if (GLOWBE_LINE_LED_COUNTS[line] > kMaxLedsPerLine) {
      while (true) {
        delay(1000);
      }
    }
  }
  GLOWBE_FASTLED_REGISTER_RMT(strips);
  FastLED.setBrightness(255);
  // 輝度 < 255 時の時間ディザーが低輝度でチラつきに見えるのを止める
  FastLED.setDither(0);
  // TODO: set budget (mA) from PCB / supply rating.
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 4000);
}

void glowbe_led_set_rgb(const uint8_t* rgb) {
  size_t offset = 0;
  for (uint8_t line = 0; line < GLOWBE_DATA_LINES; line++) {
    const uint16_t n = GLOWBE_LINE_LED_COUNTS[line];
    for (uint16_t i = 0; i < n; i++) {
      // Wire payload is logical RGB; FastLED GRB template reorders for the strip.
      CRGB c(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
      glowbe_led_dim(c);
      strips[line][i] = c;
      offset += 3;
    }
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
  for (uint8_t line = 0; line < GLOWBE_DATA_LINES; line++) {
    const uint16_t n = GLOWBE_LINE_LED_COUNTS[line];
    for (uint16_t i = 0; i < n; i++) {
      CRGB c = CHSV(static_cast<uint8_t>(t / 8 + line * 40 + i * 2), 220, 180);
      glowbe_led_dim(c);
      strips[line][i] = c;
    }
  }
  FastLED.show();
}

void glowbe_led_test_pattern(uint32_t t_ms) {
  glowbe_led_rainbow_pattern(static_cast<int32_t>(t_ms), false);
}

const char* glowbe_led_driver_name() {
  return "esp32-rmt-per-line";
}
