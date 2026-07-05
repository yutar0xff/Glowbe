/**
 * ESP32 — NeoPixelBus I2S0 並列（WS2812x）。
 */
#include <Arduino.h>
#include <NeoPixelBus.h>

#include "glowbe_layout.h"
#include "led_driver.h"
#include "led_driver_parallel.h"

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

}  // namespace

void glowbe_led_init() {
  g_line_count = GLOWBE_DATA_LINES;
  for (uint8_t line = 0; line < g_line_count; line++) {
    g_lines[line] = new Strip(GLOWBE_MAX_LINE_LEDS, GLOWBE_GPIO_PINS[line]);
  }
  for (uint8_t line = 0; line < g_line_count; line++) {
    g_lines[line]->Begin();
  }
}

void glowbe_led_wait_ready() {
  glowbe::led_parallel::waitReady(g_lines, g_line_count);
}

void glowbe_led_set_rgb(const uint8_t* rgb) {
  glowbe::led_parallel::setRgb(g_lines, g_line_count, rgb);
}

void glowbe_led_show() {
  glowbe::led_parallel::show(g_lines, g_line_count);
}

void glowbe_led_apply_rgb(const uint8_t* rgb) {
  glowbe_led_set_rgb(rgb);
  glowbe_led_show();
}

void glowbe_led_clear() {
  glowbe::led_parallel::clear(g_lines, g_line_count);
}

const char* glowbe_led_driver_name() {
#if GLOWBE_DATA_LINES > 8
  return "esp32-neopixelbus-i2s0-x16";
#else
  return "esp32-neopixelbus-i2s0-x8";
#endif
}
