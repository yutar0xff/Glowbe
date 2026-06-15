/**
 * Glowbe prototype firmware — UDP FRAME RGB output.
 *
 * 表示方針:
 * - 完全フレームが揃ったときだけ LED を更新する（部分フレームでは前表示を維持）。
 * - 受信途絶・リンクタイムアウトでも消灯しない（最後に表示したフレームを保持）。
 * - オプションでプレイアウト遅延（ジッタバッファ）: `include/glowbe_playout.h` を参照。
 */
#include <Arduino.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <cstring>

#include "glowbe_layout.h"
#include "glowbe_playout.h"
#include "glowbe_udp.h"
#include "glowbe_wire.h"
#include "led_driver.h"

#if __has_include("wifi_config.h")
#include "wifi_config.h"
#else
#error "Copy include/wifi_config.h.example to include/wifi_config.h and set credentials."
#endif

#ifndef GLOWBE_MDNS_HOSTNAME
#define GLOWBE_MDNS_HOSTNAME "glowbe-proto"
#endif

namespace {

constexpr uint16_t kUdpPort = 49152;
constexpr uint16_t kStatusPort = 49153;
constexpr uint32_t kStatusIntervalMs = 1000;
constexpr uint32_t kLinkStaleLogMs = 10000;
constexpr uint16_t kMaxPacketsPerLoop = 32;

glowbe::wire::FrameAssembler assembler(GLOWBE_LED_COUNT);
glowbe::playout::Ring g_playout;

uint32_t frames_rx = 0;
uint32_t drops = 0;
uint32_t udp_errors = 0;
uint32_t last_udp_rx_ms = 0;
uint32_t fps_window_start = 0;
uint16_t fps_window_count = 0;
uint16_t fps_rx_x10 = 0;
IPAddress last_peer;
bool have_last_peer = false;

void applyCompleteFrame(const uint8_t* rgb) {
  glowbe_led_set_rgb(rgb);
  glowbe_led_show();
}

void sendStatusTo(const IPAddress& ip) {
  uint8_t pkt[20] = {};
  pkt[0] = glowbe::wire::kMagic0;
  pkt[1] = glowbe::wire::kMagic1;
  pkt[2] = glowbe::wire::kVersion;
  pkt[3] = 3;
  pkt[4] = static_cast<uint8_t>(frames_rx);
  pkt[5] = static_cast<uint8_t>(frames_rx >> 8);
  pkt[6] = static_cast<uint8_t>(frames_rx >> 16);
  pkt[7] = static_cast<uint8_t>(frames_rx >> 24);
  pkt[8] = static_cast<uint8_t>(fps_rx_x10);
  pkt[9] = static_cast<uint8_t>(fps_rx_x10 >> 8);
  pkt[10] = static_cast<uint8_t>(drops);
  pkt[11] = static_cast<uint8_t>(drops >> 8);
  pkt[12] = static_cast<int8_t>(WiFi.RSSI());
  pkt[13] = pkt[14] = pkt[15] = 0;
  const uint32_t lh = GLOWBE_LAYOUT_HASH;
  pkt[16] = static_cast<uint8_t>(lh & 0xff);
  pkt[17] = static_cast<uint8_t>((lh >> 8) & 0xff);
  pkt[18] = static_cast<uint8_t>((lh >> 16) & 0xff);
  pkt[19] = static_cast<uint8_t>((lh >> 24) & 0xff);
  glowbe::udp::send(pkt, sizeof(pkt), ip, kStatusPort);
}

void noteFrameRx() {
  frames_rx++;
  const uint32_t now = millis();
  if (fps_window_start == 0) {
    fps_window_start = now;
  }
  fps_window_count++;
  if (now - fps_window_start >= 1000) {
    fps_rx_x10 = static_cast<uint16_t>((fps_window_count * 1000UL * 10) / (now - fps_window_start));
    fps_window_start = now;
    fps_window_count = 0;
  }
  last_udp_rx_ms = now;
}

bool startMdns() {
  if (GLOWBE_MDNS_HOSTNAME[0] == '\0') {
    return false;
  }
  if (!MDNS.begin(GLOWBE_MDNS_HOSTNAME)) {
    Serial.println("mDNS: begin failed");
    return false;
  }
  MDNS.addService("glowbe", "udp", kUdpPort);
  Serial.printf("mDNS: %s.local (port %u)\n", GLOWBE_MDNS_HOSTNAME, kUdpPort);
  return true;
}

bool startUdpListen() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }
  if (!glowbe::udp::listen(kUdpPort)) {
    Serial.printf("UDP listen failed on port %u (errno=%d)\n", kUdpPort, errno);
    return false;
  }
  Serial.printf("UDP %s:%u (fd=%d)\n", WiFi.localIP().toString().c_str(), kUdpPort,
                glowbe::udp::fd());
  return true;
}

void onWifiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.println(WiFi.localIP());
      g_playout.reset();
      startUdpListen();
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      if (glowbe::udp::fd() >= 0) {
        close(glowbe::udp::fd());
        glowbe::udp::fd() = -1;
      }
      have_last_peer = false;
      last_udp_rx_ms = 0;
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
#if GLOWBE_PLAYOUT_LAG_FRAMES > 0
  Serial.printf("playout: lag_frames=%d ring_cap=%d\n", GLOWBE_PLAYOUT_LAG_FRAMES, GLOWBE_PLAYOUT_RING_CAP);
#else
  Serial.println("playout: off (lag_frames=0)");
#endif

  glowbe_led_init();
  glowbe_led_clear();
  g_playout.reset();

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
  startMdns();
  startUdpListen();
}

void loop() {
  const uint32_t now = millis();

  uint8_t buf[glowbe::wire::kHeaderSize + glowbe::wire::kMaxChunkPayload];
  IPAddress from;
  uint16_t packets_processed = 0;

  while (packets_processed < kMaxPacketsPerLoop) {
    const int n = glowbe::udp::recv(buf, sizeof(buf), &from);
    if (n == -2) {
      udp_errors++;
      startUdpListen();
      break;
    }
    if (n <= 0) {
      break;
    }

    last_peer = from;
    have_last_peer = true;

    glowbe::wire::FrameHeader hdr;
    if (glowbe::wire::parseHeader(buf, static_cast<size_t>(n), hdr)) {
      const uint8_t* payload = buf + glowbe::wire::kHeaderSize;
      if (assembler.ingest(hdr, payload, GLOWBE_LED_COUNT)) {
        g_playout.push(assembler.buffer(), applyCompleteFrame);
        noteFrameRx();
      }
    } else {
      drops++;
    }
    packets_processed++;
  }

  static uint32_t last_diag = 0;
  if (now - last_diag >= 5000) {
    last_diag = now;
    const bool link_stale =
        last_udp_rx_ms > 0 && (now - last_udp_rx_ms >= kLinkStaleLogMs);
    Serial.printf(
        "diag: ip=%s frames=%lu drops=%lu frame_aborts=%lu udp_err=%lu fps_x10=%u rssi=%d%s\n",
        WiFi.localIP().toString().c_str(), static_cast<unsigned long>(frames_rx),
        static_cast<unsigned long>(drops),
        static_cast<unsigned long>(assembler.incomplete_frame_aborts()),
        static_cast<unsigned long>(udp_errors), fps_rx_x10, WiFi.RSSI(),
        link_stale ? " link_stale(hold_last)" : "");
  }

  static uint32_t last_status = 0;
  if (now - last_status >= kStatusIntervalMs && WiFi.status() == WL_CONNECTED) {
    last_status = now;
    sendStatusTo(have_last_peer ? last_peer : IPAddress(255, 255, 255, 255));
  }
}
