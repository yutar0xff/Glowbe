/**
 * ESP32（無印）— NeoPixelBus I2S0 並列（WS2812x）。
 *
 * `NeoEsp32I2s0X8Ws2812xMethod`（または X16）でデータ線ごとに NeoPixelBus を生成する。
 * Arduino-ESP32 のデフォルト X8 エイリアスは I2S1 側のため、明示的に I2S0 を選択する。
 */
#include <Arduino.h>
#include <NeoPixelBus.h>

#include "glowbe_layout.h"
#include "led_driver.h"

namespace {

#if GLOWBE_DATA_LINES > 8
using StripMethod = NeoEsp32I2s0X16Ws2812xMethod;
#else
using StripMethod = NeoEsp32I2s0X8Ws2812xMethod;
#endif

using Strip = NeoPixelBus<NeoGrbFeature, StripMethod>;

static_assert(GLOWBE_DATA_LINES > 0, "layout");
static_assert(GLOWBE_DATA_LINES <= 16, "NeoPixelBus parallel: max 16 lines (use X16 layout)");

Strip* g_lines[16];
uint8_t g_line_count = 0;

RgbColor dimRgb(uint8_t r, uint8_t g, uint8_t b) {
  const uint16_t k = kGlowbeLedBrightness;
  return RgbColor(static_cast<uint8_t>((static_cast<uint16_t>(r) * k) / 255u),
                    static_cast<uint8_t>((static_cast<uint16_t>(g) * k) / 255u),
                    static_cast<uint8_t>((static_cast<uint16_t>(b) * k) / 255u));
}

}  // namespace

void glowbe_led_init() {
  g_line_count = GLOWBE_DATA_LINES;
  for (uint8_t line = 0; line < g_line_count; line++) {
    const uint16_t n = GLOWBE_LINE_LED_COUNTS[line];
    const uint8_t pin = GLOWBE_GPIO_PINS[line];
    g_lines[line] = new Strip(n, pin);
    g_lines[line]->Begin();
  }
}

void glowbe_led_wait_ready() {
  for (;;) {
    bool all = true;
    for (uint8_t line = 0; line < g_line_count; line++) {
      if (!g_lines[line]->CanShow()) {
        all = false;
        break;
      }
    }
    if (all) {
      return;
    }
    yield();
  }
}

void glowbe_led_set_rgb(const uint8_t* rgb) {
  glowbe_led_wait_ready();
  size_t offset = 0;
  for (uint8_t line = 0; line < g_line_count; line++) {
    Strip* s = g_lines[line];
    const uint16_t n = GLOWBE_LINE_LED_COUNTS[line];
    for (uint16_t i = 0; i < n; i++) {
      const RgbColor c = dimRgb(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
      s->SetPixelColor(i, c);
      offset += 3;
    }
  }
}

void glowbe_led_show() {
  for (uint8_t line = 0; line < g_line_count; line++) {
    g_lines[line]->Show();
  }
}

void glowbe_led_apply_rgb(const uint8_t* rgb) {
  glowbe_led_set_rgb(rgb);
  glowbe_led_show();
}

void glowbe_led_clear() {
  glowbe_led_wait_ready();
  for (uint8_t line = 0; line < g_line_count; line++) {
    Strip* s = g_lines[line];
    s->ClearTo(RgbColor(0, 0, 0));
  }
  glowbe_led_show();
}

const char* glowbe_led_driver_name() {
#if GLOWBE_DATA_LINES > 8
  return "esp32-neopixelbus-i2s0-x16";
#else
  return "esp32-neopixelbus-i2s0-x8";
#endif
}
