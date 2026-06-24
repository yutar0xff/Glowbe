/**
 * ESP32-S3 — NeoPixelBus LCD ペリフェラル並列（WS2812x）。
 *
 * データ線ごとに `NeoPixelBus<NeoGrbFeature, NeoEsp32LcdX8Ws2812xMethod>`（または X16）を
 * 1 本ずつ生成し、内部マルチプレクサで同期出力する（公式例: NeoPixel_ESP32_LcdParallel）。
 */
#include <Arduino.h>
#include <NeoPixelBus.h>

#include "glowbe_dim.h"
#include "glowbe_layout.h"
#include "led_driver.h"

namespace {

#if GLOWBE_DATA_LINES > 8
using StripMethod = NeoEsp32LcdX16Ws2812xMethod;
#else
using StripMethod = NeoEsp32LcdX8Ws2812xMethod;
#endif

using Strip = NeoPixelBus<NeoGrbFeature, StripMethod>;

static_assert(GLOWBE_DATA_LINES > 0, "layout");
static_assert(GLOWBE_DATA_LINES <= 16, "NeoPixelBus parallel: max 16 lines (use X16 layout)");

Strip* g_lines[16];
uint8_t g_line_count = 0;

RgbColor dimRgb(uint8_t r, uint8_t g, uint8_t b) {
  return RgbColor(glowbe_dim_channel(r), glowbe_dim_channel(g), glowbe_dim_channel(b));
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
  return "esp32s3-neopixelbus-lcd-x16";
#else
  return "esp32s3-neopixelbus-lcd-x8";
#endif
}
