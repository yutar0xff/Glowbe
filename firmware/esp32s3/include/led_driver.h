#pragma once

#include <stdint.h>

#include "glowbe_brightness.h"

void glowbe_led_init();
/// DMA 送出完了と WS2812 ラッチ待ち。
void glowbe_led_wait_ready();
void glowbe_led_set_rgb(const uint8_t* rgb);    // 論理 RGB →ストリップ RAM（Show しない）
void glowbe_led_show();                         // 全データ線をラッチ
void glowbe_led_apply_rgb(const uint8_t* rgb); // set_rgb + show
void glowbe_led_clear();                        // 全消灯 + show
const char* glowbe_led_driver_name();
