#include "glowbe_stream_workers.h"

#include <ESPmDNS.h>
#include <cstring>

#include "glowbe_frame_queue.h"
#include "glowbe_playout.h"
#include "glowbe_udp.h"
#include "glowbe_wire.h"
#include "led_driver.h"

#if __has_include("wifi_config.h")
#include "wifi_config.h"
#endif

#ifndef GLOWBE_MDNS_HOSTNAME
#define GLOWBE_MDNS_HOSTNAME "glowbe-proto"
#endif

#ifndef GLOWBE_LINK_ECONOMY_AFTER_MS
#define GLOWBE_LINK_ECONOMY_AFTER_MS 2500
#endif

namespace glowbe::stream {
namespace {

constexpr uint16_t kUdpPort = 49152;
constexpr uint16_t kStatusPort = 49153;
constexpr uint32_t kLinkStaleLogMs = 10000;
constexpr uint32_t kLinkEconomyAfterMs = GLOWBE_LINK_ECONOMY_AFTER_MS;
constexpr uint16_t kMaxPacketsPerRecvBurst = 64;
constexpr uint32_t kEconomyRecvIdleMs = 5;

glowbe::wire::FrameAssembler assembler(GLOWBE_LED_COUNT);
glowbe::playout::Ring g_playout;
glowbe::frame_queue::Queue g_frame_queue;

TaskHandle_t g_udp_task = nullptr;
TaskHandle_t g_led_task = nullptr;
portMUX_TYPE g_peer_mux = portMUX_INITIALIZER_UNLOCKED;

volatile uint32_t frames_rx = 0;
volatile uint32_t frames_applied = 0;
volatile uint32_t drops = 0;
volatile uint32_t udp_errors = 0;
volatile uint32_t last_udp_rx_ms = 0;
volatile uint32_t fps_window_start = 0;
volatile uint16_t fps_window_count = 0;
volatile uint16_t fps_rx_x10 = 0;
volatile bool link_economy = false;
volatile uint32_t wifi_ready_ms = 0;
volatile int8_t link_mode_request = -1;

bool stream_up = false;

IPAddress last_peer;
volatile bool have_last_peer = false;

alignas(4) uint8_t last_ingested_rgb[glowbe::playout::Ring::kRgbBytes];
bool have_last_ingested = false;

alignas(4) uint8_t last_applied_rgb[glowbe::playout::Ring::kRgbBytes];
bool have_last_applied = false;

alignas(4) uint8_t led_task_rgb[glowbe::playout::Ring::kRgbBytes];

void closeUdp() {
  if (glowbe::udp::fd() >= 0) {
    close(glowbe::udp::fd());
    glowbe::udp::fd() = -1;
  }
}

bool listenUdp(bool force_rebind) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }
  if (!force_rebind && glowbe::udp::fd() >= 0) {
    return true;
  }
  if (!glowbe::udp::listen(kUdpPort)) {
    Serial.printf("UDP listen failed on port %u (errno=%d)\n", kUdpPort, errno);
    return false;
  }
  Serial.printf("UDP %s:%u (fd=%d)\n", WiFi.localIP().toString().c_str(), kUdpPort,
                glowbe::udp::fd());
  return true;
}

void enqueueFrameForDisplay(const uint8_t* rgb) { g_frame_queue.push(rgb); }

void flushFpsWindow(uint32_t now) {
  if (fps_window_start == 0 || now - fps_window_start < 1000) {
    return;
  }
  fps_rx_x10 = static_cast<uint16_t>((fps_window_count * 1000UL * 10) / (now - fps_window_start));
  fps_window_start = now;
  fps_window_count = 0;
}

void noteFrameRx() {
  frames_rx++;
  const uint32_t now = millis();
  if (fps_window_start == 0) {
    fps_window_start = now;
  }
  fps_window_count++;
  flushFpsWindow(now);
  last_udp_rx_ms = now;
}

void applyLinkEconomy(bool economy) {
  if (link_economy == economy) {
    return;
  }
  link_economy = economy;
  WiFi.setSleep(economy);
  Serial.printf("link: %s (wifi modem sleep %s)\n", economy ? "economy" : "active",
                economy ? "on" : "off");
}

void requestLinkEconomy(bool economy) { link_mode_request = economy ? 1 : 0; }

void noteLinkTraffic() {
  last_udp_rx_ms = millis();
  if (link_economy) {
    requestLinkEconomy(false);
  }
}

void deliverCompleteFrame() {
  const uint8_t* rgb = assembler.buffer();
  const size_t n = glowbe::playout::Ring::kRgbBytes;
  if (have_last_ingested && memcmp(rgb, last_ingested_rgb, n) == 0) {
    noteFrameRx();
    return;
  }
  memcpy(last_ingested_rgb, rgb, n);
  have_last_ingested = true;
  g_playout.reset();
  g_playout.push(rgb, enqueueFrameForDisplay);
  noteFrameRx();
}

void processUdpPacket(const uint8_t* buf, int n, const IPAddress& from) {
  portENTER_CRITICAL(&g_peer_mux);
  last_peer = from;
  have_last_peer = true;
  portEXIT_CRITICAL(&g_peer_mux);

  noteLinkTraffic();

  if (n >= static_cast<int>(glowbe::wire::kHeaderSize) && buf[0] == glowbe::wire::kMagic0 &&
      buf[1] == glowbe::wire::kMagic1 && buf[2] == glowbe::wire::kVersion &&
      buf[3] == glowbe::wire::kMsgLink) {
    bool active = true;
    if (glowbe::wire::parseLink(buf, static_cast<size_t>(n), active)) {
      requestLinkEconomy(!active);
    } else {
      drops++;
    }
    return;
  }

  glowbe::wire::FrameHeader hdr;
  if (glowbe::wire::parseHeader(buf, static_cast<size_t>(n), hdr)) {
    const uint8_t* payload = buf + glowbe::wire::kHeaderSize;
    if (assembler.ingest(hdr, payload, GLOWBE_LED_COUNT)) {
      deliverCompleteFrame();
    }
  } else {
    drops++;
  }
}

void udpRecvTask(void*) {
  uint8_t buf[glowbe::wire::kHeaderSize + glowbe::wire::kMaxChunkPayload];
  IPAddress from;

  for (;;) {
    if (WiFi.status() != WL_CONNECTED || glowbe::udp::fd() < 0) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    uint16_t packets_processed = 0;
    while (packets_processed < kMaxPacketsPerRecvBurst) {
      const int n = glowbe::udp::recv(buf, sizeof(buf), &from);
      if (n == -2) {
        udp_errors++;
        listenUdp(true);
        break;
      }
      if (n <= 0) {
        break;
      }
      processUdpPacket(buf, n, from);
      packets_processed++;
    }

    const TickType_t idle_ticks =
        packets_processed == 0 ? pdMS_TO_TICKS(link_economy ? kEconomyRecvIdleMs : 1) : 1;
    vTaskDelay(idle_ticks);
  }
}

void ledDisplayTask(void*) {
  uint8_t* const rgb = led_task_rgb;
  const size_t n = glowbe::playout::Ring::kRgbBytes;

  for (;;) {
    if (!g_frame_queue.pop(rgb, portMAX_DELAY)) {
      continue;
    }
    if (have_last_applied && memcmp(rgb, last_applied_rgb, n) == 0) {
      continue;
    }
    glowbe_led_set_rgb(rgb);
    glowbe_led_show();
    memcpy(last_applied_rgb, rgb, n);
    have_last_applied = true;
    frames_applied++;
  }
}

void startWorkers() {
  if (g_udp_task != nullptr || g_led_task != nullptr) {
    return;
  }
  if (!g_frame_queue.init()) {
    Serial.println("frame queue init failed");
    return;
  }
  if (xTaskCreatePinnedToCore(udpRecvTask, "glowbe_udp", 8192, nullptr, 2, &g_udp_task, 0) !=
      pdPASS) {
    Serial.println("udp task create failed");
    return;
  }
  if (xTaskCreatePinnedToCore(ledDisplayTask, "glowbe_led", 8192, nullptr, 1, &g_led_task, 1) !=
      pdPASS) {
    Serial.println("led task create failed");
    return;
  }
  Serial.println("workers: udp=core0 led=core1");
}

}  // namespace

void reset() {
  assembler.reset();
  g_playout.reset();
  g_frame_queue.reset();
  have_last_ingested = false;
  have_last_applied = false;
  link_mode_request = -1;
}

void bringUp() {
  if (stream_up) {
    return;
  }
  wifi_ready_ms = millis();
  applyLinkEconomy(false);
  if (!listenUdp(false)) {
    return;
  }
  startWorkers();
  if (g_udp_task == nullptr) {
    closeUdp();
    return;
  }
  stream_up = true;
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

void onWifiGotIp() {
  if (!stream_up) {
    bringUp();
    return;
  }
  wifi_ready_ms = millis();
  reset();
  applyLinkEconomy(false);
  listenUdp(true);
}

void onWifiDisconnected() {
  stream_up = false;
  closeUdp();
  portENTER_CRITICAL(&g_peer_mux);
  have_last_peer = false;
  portEXIT_CRITICAL(&g_peer_mux);
  last_udp_rx_ms = 0;
}

void service(uint32_t now_ms) {
  flushFpsWindow(now_ms);

  if (link_mode_request >= 0) {
    const bool economy = link_mode_request != 0;
    link_mode_request = -1;
    applyLinkEconomy(economy);
  }

  if (!link_economy) {
    const uint32_t anchor = last_udp_rx_ms > 0 ? last_udp_rx_ms : wifi_ready_ms;
    if (anchor != 0 && now_ms - anchor >= kLinkEconomyAfterMs) {
      applyLinkEconomy(true);
    }
  }
}

Diag snapshotDiag() {
  const uint32_t now = millis();
  const bool link_stale = last_udp_rx_ms > 0 && (now - last_udp_rx_ms >= kLinkStaleLogMs);
  return Diag{frames_rx,
              frames_applied,
              drops,
              assembler.incomplete_frame_aborts(),
              g_frame_queue.queue_drops(),
              udp_errors,
              fps_rx_x10,
              link_economy,
              link_stale};
}

void sendStatusToPeer() {
  IPAddress peer;
  bool have_peer = false;
  portENTER_CRITICAL(&g_peer_mux);
  peer = last_peer;
  have_peer = have_last_peer;
  portEXIT_CRITICAL(&g_peer_mux);

  uint8_t pkt[20] = {};
  pkt[0] = glowbe::wire::kMagic0;
  pkt[1] = glowbe::wire::kMagic1;
  pkt[2] = glowbe::wire::kVersion;
  pkt[3] = 3;
  const uint32_t fc = frames_rx;
  pkt[4] = static_cast<uint8_t>(fc);
  pkt[5] = static_cast<uint8_t>(fc >> 8);
  pkt[6] = static_cast<uint8_t>(fc >> 16);
  pkt[7] = static_cast<uint8_t>(fc >> 24);
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
  glowbe::udp::send(pkt, sizeof(pkt), have_peer ? peer : IPAddress(255, 255, 255, 255),
                    kStatusPort);
}

}  // namespace glowbe::stream
