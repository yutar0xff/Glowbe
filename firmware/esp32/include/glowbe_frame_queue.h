#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

#include "glowbe_layout.h"

#ifndef GLOWBE_FRAME_QUEUE_DEPTH
#define GLOWBE_FRAME_QUEUE_DEPTH 3
#endif

namespace glowbe::frame_queue {

class Queue {
 public:
  static constexpr size_t kRgbBytes = static_cast<size_t>(GLOWBE_LED_COUNT) * 3U;

  bool init() {
    if (queue_ != nullptr) {
      return true;
    }
    queue_ = xQueueCreateStatic(GLOWBE_FRAME_QUEUE_DEPTH, kRgbBytes, storage_, &control_);
    return queue_ != nullptr;
  }

  void push(const uint8_t* rgb) {
    if (queue_ == nullptr) {
      return;
    }
    if (xQueueSend(queue_, rgb, 0) != pdTRUE) {
      if (xQueueReceive(queue_, scratch_, 0) == pdTRUE) {
        queue_drops_++;
      }
      if (xQueueSend(queue_, rgb, 0) != pdTRUE) {
        queue_drops_++;
      }
    }
  }

  bool pop(uint8_t* rgb, TickType_t wait_ticks) {
    if (queue_ == nullptr) {
      return false;
    }
    return xQueueReceive(queue_, rgb, wait_ticks) == pdTRUE;
  }

  void reset() {
    if (queue_ == nullptr) {
      queue_drops_ = 0;
      return;
    }
    while (xQueueReceive(queue_, scratch_, 0) == pdTRUE) {
    }
    queue_drops_ = 0;
  }

  uint32_t queue_drops() const { return queue_drops_; }

 private:
  QueueHandle_t queue_ = nullptr;
  StaticQueue_t control_ = {};
  alignas(4) uint8_t storage_[GLOWBE_FRAME_QUEUE_DEPTH * kRgbBytes] = {};
  alignas(4) uint8_t scratch_[kRgbBytes] = {};
  volatile uint32_t queue_drops_ = 0;
};

}  // namespace glowbe::frame_queue
