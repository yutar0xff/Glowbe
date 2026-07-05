/**
 * Wi-Fi なし虹色テスト（論理インデックス順に色相をずらす）。
 *
 *   uv run pio run -e 15panels-rainbow -t upload
 *   uv run pio run -e 60panels-rainbow -t upload
 *   uv run pio device monitor -e 60panels-rainbow
 */
#include <Arduino.h>

#include "glowbe_brightness.h"
#include "glowbe_layout.h"
#include "led_driver.h"
#include "rainbow_effect.h"

namespace {

constexpr uint32_t kFrameDelayMs = 40;
constexpr unsigned kExtraBrightnessPercent = 15;
alignas(4) uint8_t g_rgb[static_cast<size_t>(GLOWBE_LED_COUNT) * 3u];

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("rainbow layout=%s leds=%u driver=%s extra_brightness=%u%%\n", GLOWBE_LAYOUT_ID,
                static_cast<unsigned>(GLOWBE_LED_COUNT), glowbe_led_driver_name(),
                kExtraBrightnessPercent);
  glowbe_led_init();
  glowbe_led_clear();
}

void loop() {
  static uint8_t hue = 0;
  glowbe::rainbow::fill_frame(g_rgb, GLOWBE_LED_COUNT, hue);
  glowbe::rainbow::scale_bytes(g_rgb, sizeof(g_rgb), kExtraBrightnessPercent);
  glowbe_led_apply_rgb(g_rgb);
  hue = static_cast<uint8_t>(hue + 2u);
  delay(kFrameDelayMs);
}
