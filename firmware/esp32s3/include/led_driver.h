#pragma once

#include <stdint.h>

#include "glowbe_brightness.h"

void glowbe_led_init();
/// 前回の DMA 送出が完了するまで待つ（Wi-Fi 負荷下でのチラつき緩和）。
void glowbe_led_wait_ready();
void glowbe_led_set_rgb(const uint8_t* rgb);    // 論理 RGB →ストリップ RAM（Show しない）
void glowbe_led_show();                         // 全データ線をラッチ
void glowbe_led_apply_rgb(const uint8_t* rgb); // set_rgb + show
void glowbe_led_clear();                        // 全消灯 + show
const char* glowbe_led_driver_name();
