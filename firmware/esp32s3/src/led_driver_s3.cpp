/**
 * ESP32-S3 — NeoPixelBus LCD ペリフェラル並列（WS2812x）。
 */
#include <Arduino.h>
#include <NeoPixelBus.h>
#include <esp_heap_caps.h>

#include "glowbe_layout.h"
#include "led_driver.h"
#include "led_driver_parallel.h"

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

}  // namespace

void glowbe_led_init() {
  g_line_count = GLOWBE_DATA_LINES;
  Serial.printf("led_init: lines=%u drive_leds=%u heap=%u dma=%u\n",
                static_cast<unsigned>(g_line_count), static_cast<unsigned>(GLOWBE_MAX_LINE_LEDS),
                static_cast<unsigned>(ESP.getFreeHeap()),
                static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_DMA)));

  for (uint8_t line = 0; line < g_line_count; line++) {
    g_lines[line] = new Strip(GLOWBE_MAX_LINE_LEDS, GLOWBE_GPIO_PINS[line]);
    if (g_lines[line] == nullptr) {
      Serial.printf("led_init: OOM line %u gpio %u\n", line, GLOWBE_GPIO_PINS[line]);
      abort();
    }
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
  return "esp32s3-neopixelbus-lcd-x16";
#else
  return "esp32s3-neopixelbus-lcd-x8";
#endif
}
