#pragma once

#include <Arduino.h>
#include <WiFi.h>

namespace glowbe::stream {

struct Diag {
  uint32_t frames_rx;
  uint32_t frames_applied;
  uint32_t drops;
  uint32_t frame_aborts;
  uint32_t queue_drops;
  uint32_t udp_errors;
  uint16_t fps_rx_x10;
  bool link_economy;
  bool link_stale;
};

void reset();
void bringUp();
bool startMdns();

void onWifiGotIp();
void onWifiDisconnected();

void service(uint32_t now_ms);
Diag snapshotDiag();
void sendStatusToPeer();

}  // namespace glowbe::stream
