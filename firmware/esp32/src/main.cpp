/**
 * Glowbe firmware — UDP FRAME RGB output.
 */
#include <Arduino.h>
#include <WiFi.h>

#include "glowbe_brightness.h"
#include "glowbe_frame_queue.h"
#include "glowbe_layout.h"
#include "glowbe_playout.h"
#include "glowbe_stream_workers.h"
#include "led_driver.h"

#if __has_include("wifi_config.h")
#include "wifi_config.h"
#else
#error "Copy include/wifi_config.h.example to include/wifi_config.h and set credentials."
#endif

namespace {

constexpr uint32_t kStatusIntervalActiveMs = 1000;
constexpr uint32_t kStatusIntervalEconomyMs = 10000;
constexpr uint32_t kDiagIntervalMs = 5000;

void onWifiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.println(WiFi.localIP());
      glowbe::stream::onWifiGotIp();
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      glowbe::stream::onWifiDisconnected();
      break;
    default:
      break;
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("Glowbe layout=%s leds=%d lines=%d driver=%s\n", GLOWBE_LAYOUT_ID, GLOWBE_LED_COUNT,
                GLOWBE_DATA_LINES, glowbe_led_driver_name());
  Serial.printf("brightness: 4A x %u%% -> %umA budget, led scale %u/255 (~%u%%)\n",
                kGlowbeSupplyUtilizationPercent, kGlowbeSupplyBudgetMa, kGlowbeLedBrightness,
                static_cast<unsigned>((static_cast<uint32_t>(kGlowbeLedBrightness) * 100u) / 255u));
#if GLOWBE_PLAYOUT_LAG_FRAMES > 0
  Serial.printf("playout: lag_frames=%d ring_cap=%d queue_depth=%d\n", GLOWBE_PLAYOUT_LAG_FRAMES,
                GLOWBE_PLAYOUT_RING_CAP, GLOWBE_FRAME_QUEUE_DEPTH);
#else
  Serial.printf("playout: off queue_depth=%d\n", GLOWBE_FRAME_QUEUE_DEPTH);
#endif

  glowbe_led_init();
  glowbe_led_clear();
  glowbe::stream::reset();

  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(GLOWBE_WIFI_SSID, GLOWBE_WIFI_PASSWORD);
  Serial.printf("WiFi connecting to %s\n", GLOWBE_WIFI_SSID);

  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi failed");
    return;
  }

  Serial.printf("MAC %s\n", WiFi.macAddress().c_str());
  glowbe::stream::startMdns();
  glowbe::stream::bringUp();
}

void loop() {
  const uint32_t now = millis();
  glowbe::stream::service(now);

  const glowbe::stream::Diag d = glowbe::stream::snapshotDiag();

  static uint32_t last_diag = 0;
  if (now - last_diag >= kDiagIntervalMs) {
    last_diag = now;
    Serial.printf(
        "diag: ip=%s frames=%lu applied=%lu drops=%lu frame_aborts=%lu queue_drops=%lu "
        "udp_err=%lu fps_x10=%u rssi=%d%s%s\n",
        WiFi.localIP().toString().c_str(), static_cast<unsigned long>(d.frames_rx),
        static_cast<unsigned long>(d.frames_applied), static_cast<unsigned long>(d.drops),
        static_cast<unsigned long>(d.frame_aborts), static_cast<unsigned long>(d.queue_drops),
        static_cast<unsigned long>(d.udp_errors), d.fps_rx_x10, WiFi.RSSI(),
        d.link_economy ? " economy" : "", d.link_stale ? " link_stale(hold_last)" : "");
  }

  static uint32_t last_status = 0;
  const uint32_t status_interval = d.link_economy ? kStatusIntervalEconomyMs : kStatusIntervalActiveMs;
  if (now - last_status >= status_interval && WiFi.status() == WL_CONNECTED) {
    last_status = now;
    glowbe::stream::sendStatusToPeer();
  }

  delay(10);
}
