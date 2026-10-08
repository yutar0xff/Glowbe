/**
 * ESP onboard offline playout — port of Runtime `demo/rainbow-rings`.
 * UV/dir tables: tools/esp-local-tables.ts → glowbe_local_geom.h
 *
 * Hot path is tuned for ~120 fps on 60panels (ring phase is the expensive part).
 */
#include "glowbe_local_playout.h"

#include <cmath>
#include <cstring>

#include "glowbe_layout.h"
#include "glowbe_local_geom.h"
#if GLOWBE_LED_COUNT >= 1260
#include "glowbe_local_mate.h"
#define GLOWBE_LOCAL_HAS_MATE 1
#else
#define GLOWBE_LOCAL_HAS_MATE 0
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace glowbe::local {
namespace {

portMUX_TYPE g_active_mux = portMUX_INITIALIZER_UNLOCKED;
volatile bool g_active = false;
volatile uint32_t g_frames_rendered = 0;
uint32_t g_playlist_origin_ms = 0;
// Runtime LOCAL brightness (0–255). Default ~46% until first LOCAL with brightness.
volatile uint8_t g_brightness_u8 = 117;

constexpr float kRainbowRingsSoloS = 4.0f;
constexpr float kRainbowRingsBlendInS = 1.4f;
constexpr float kRainbowRingsBlendOutS = 0.2f;
constexpr float kRingFirstS = 0.614671f;
constexpr float kRingLastS = 11.541210f;
// Full demo/rainbow-rings period (solo + ring active). 15panels loops this.
constexpr float kRainbowRingsPeriodS = 14.926539f;
constexpr float kRainbowRingsActiveS = kRingLastS - kRingFirstS;
// 60panels: cut before rings→rainbow blend-out, then mate tour.
constexpr float kRainbowRingsPlaylistS =
    kRainbowRingsSoloS + kRainbowRingsActiveS - kRainbowRingsBlendOutS;

#if GLOWBE_LOCAL_HAS_MATE
constexpr float kMateTransS = 0.35f;
constexpr float kMateSlotS = 2.0f;
constexpr float kMateTourS = kMateSlotS * static_cast<float>(glowbe::local_mate::kExprCount);
constexpr float kMateFadeS = 0.55f;
constexpr float kMatePeriodS = kMateFadeS + kMateTourS + kMateFadeS;
constexpr float kPlaylistPeriodS = kRainbowRingsPlaylistS + kMatePeriodS;
static_assert(glowbe::local_mate::kLedCount == glowbe::local_geom::kLedCount,
              "mate bake LED count must match local geom");
static_assert(glowbe::local_mate::kExprCount == 4, "expected happy/surprised/sad/love");
#else
constexpr float kPlaylistPeriodS = kRainbowRingsPeriodS;
#endif

struct RingPulseSpec {
  float t0;
  float life_s;
  float center_u;
  float center_v;
  float amplitude;
  uint8_t color_r;
  uint8_t color_g;
  uint8_t color_b;
  float ring_speed;
};

constexpr RingPulseSpec kRingSpecs[] = {
    {1.249702f, 3.961384f, 0.774599f, 0.465797f, 1.088342f, 155, 66, 161, 0.928476f},
    {4.353400f, 3.902493f, 0.339651f, 0.774423f, 1.036462f, 193, 50, 148, 0.972484f},
    {7.622450f, 3.918760f, 0.143120f, 0.288575f, 1.016947f, 236, 53, 193, 0.959917f},
    {1.301470f, 3.698448f, 0.649216f, 0.722205f, 0.674755f, 167, 211, 193, 1.163568f},
    {3.750325f, 3.477352f, 0.168435f, 0.454448f, 0.807537f, 204, 51, 94, 1.478316f},
    {7.592398f, 3.835501f, 0.545808f, 0.756035f, 1.133312f, 144, 207, 250, 1.027906f},
    {0.697984f, 3.909401f, 0.110329f, 0.304132f, 0.738540f, 113, 193, 249, 0.967107f},
    {5.573320f, 3.536829f, 0.279513f, 0.275559f, 1.147066f, 124, 62, 230, 1.378040f},
    {3.000888f, 4.110400f, 0.467338f, 0.263883f, 0.948401f, 168, 84, 182, 0.833084f},
    {6.970412f, 3.708575f, 0.306035f, 0.620820f, 0.732537f, 229, 186, 153, 1.152330f},
    {6.647481f, 3.693342f, 0.637698f, 0.399729f, 0.812335f, 248, 162, 196, 1.169318f},
    {6.995489f, 3.990572f, 0.808080f, 0.693865f, 0.707490f, 109, 95, 203, 0.908109f},
    {7.232813f, 3.656843f, 0.179947f, 0.724517f, 0.924208f, 140, 130, 83, 1.212131f},
    {1.660290f, 4.055816f, 0.835583f, 0.251246f, 1.133293f, 240, 69, 78, 0.865662f},
    {0.614671f, 3.624359f, 0.304870f, 0.183800f, 0.822071f, 142, 185, 217, 1.252962f},
    {2.664712f, 3.618583f, 0.720524f, 0.340416f, 1.102391f, 138, 64, 225, 1.260511f},
    {0.967457f, 3.856226f, 0.121604f, 0.377045f, 0.972207f, 88, 162, 229, 1.010098f},
    {7.247515f, 4.078034f, 0.186134f, 0.566488f, 0.688780f, 135, 180, 136, 0.852099f},
};

constexpr size_t kRingSpecCount = sizeof(kRingSpecs) / sizeof(kRingSpecs[0]);

struct HotRing {
  float t0;
  float life_s;
  float cx, cy, cz;
  float c;
  float inv_c;
  float tau;
  float crest_t;
  float trail_angular;
  float amp;
  float pr, pg, pb;
};

float* g_ring_acc = nullptr;
uint8_t* g_ring_rgb = nullptr;
float* g_dir_xyz = nullptr;  // DRAM cache of PROGMEM dirs (n*3)
float* g_uv = nullptr;       // DRAM cache of PROGMEM uv (n*2)
HotRing g_hot_rings[kRingSpecCount];
uint8_t g_lin_to_srgb[256];
bool g_tables_ready = false;

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

float rem01(float u) {
  u = u - std::floor(u);
  if (u < 0.0f) {
    u += 1.0f;
  }
  return u;
}

float smoothstep01(float x) {
  x = clampf(x, 0.0f, 1.0f);
  return x * x * (3.0f - 2.0f * x);
}

// Handbook of Mathematical Functions style acos approximation (max err ~6e-5).
float fast_acos(float x) {
  x = clampf(x, -1.0f, 1.0f);
  const float negate = x < 0.0f ? 1.0f : 0.0f;
  x = fabsf(x);
  float ret = -0.0187293f;
  ret = ret * x + 0.0742610f;
  ret = ret * x - 0.2121144f;
  ret = ret * x + 1.5707288f;
  ret *= sqrtf(1.0f - x);
  ret = ret - 2.0f * negate * ret;
  return negate * static_cast<float>(M_PI) + ret;
}

void hsv_to_rgb_u8(uint8_t h, uint8_t s, uint8_t v, uint8_t& r, uint8_t& g, uint8_t& b) {
  if (s == 0) {
    r = g = b = v;
    return;
  }
  const uint8_t region = h / 43;
  const uint16_t remainder = static_cast<uint16_t>(h % 43) * 6u;
  const uint8_t p = static_cast<uint8_t>((static_cast<uint16_t>(v) * (255u - s)) / 255u);
  const uint8_t q =
      static_cast<uint8_t>((static_cast<uint16_t>(v) * (255u - (static_cast<uint16_t>(s) * remainder) / 255u)) / 255u);
  const uint8_t t = static_cast<uint8_t>(
      (static_cast<uint16_t>(v) * (255u - (static_cast<uint16_t>(s) * (255u - remainder)) / 255u)) / 255u);
  switch (region) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }
}

float srgb_byte_to_linear(uint8_t c) {
  const float s = static_cast<float>(c) / 255.0f;
  if (s <= 0.04045f) {
    return s / 12.92f;
  }
  return powf((s + 0.055f) / 1.055f, 2.4f);
}

uint8_t linear_to_srgb_u8_exact(float l) {
  l = clampf(l, 0.0f, 1.0f);
  const float s = l <= 0.0031308f ? 12.92f * l : 1.055f * powf(l, 1.0f / 2.4f) - 0.055f;
  return static_cast<uint8_t>(clampf(s * 255.0f + 0.5f, 0.0f, 255.0f));
}

void unit_dir_from_uv(float u, float v, float& x, float& y, float& z) {
  const float uu = rem01(u);
  const float vv = clampf(v, 0.0f, 1.0f);
  const float lambda = 2.0f * static_cast<float>(M_PI) * uu - static_cast<float>(M_PI);
  const float phi = static_cast<float>(M_PI) / 2.0f - static_cast<float>(M_PI) * vv;
  const float cphi = cosf(phi);
  x = cphi * cosf(lambda);
  y = sinf(phi);
  z = cphi * sinf(lambda);
}

struct RingDynamics {
  float c;
  float tau;
  float edge_w;
  float lifetime;
};

RingDynamics ring_dynamics(float ring_speed, float ring_thickness_rad) {
  const float speed = clampf(ring_speed, 0.12f, 12.0f);
  const float c = 2.6f * speed;
  const float edge_w =
      ring_thickness_rad > 1e-5f ? clampf(ring_thickness_rad, 0.025f, 0.38f) : 0.052f;
  const float tau = clampf(0.38f + edge_w * 1.0f, 0.12f, 2.5f);
  const float travel_full = static_cast<float>(M_PI) / (c > 1e-3f ? c : 1e-3f);
  const float lifetime = clampf(travel_full + tau * 5.0f, 0.25f, 15.0f);
  return RingDynamics{c, tau, edge_w, lifetime};
}

void build_tables(uint16_t n) {
  for (int i = 0; i < 256; i++) {
    g_lin_to_srgb[i] = linear_to_srgb_u8_exact(static_cast<float>(i) / 255.0f);
  }
  for (uint16_t i = 0; i < n; i++) {
    g_uv[i * 2u] = glowbe::local_geom::uvU(i);
    g_uv[i * 2u + 1u] = glowbe::local_geom::uvV(i);
    float x, y, z;
    glowbe::local_geom::dirAt(i, x, y, z);
    g_dir_xyz[i * 3u] = x;
    g_dir_xyz[i * 3u + 1u] = y;
    g_dir_xyz[i * 3u + 2u] = z;
  }
  for (size_t si = 0; si < kRingSpecCount; si++) {
    const RingPulseSpec& spec = kRingSpecs[si];
    HotRing& h = g_hot_rings[si];
    h.t0 = spec.t0;
    h.life_s = spec.life_s;
    unit_dir_from_uv(spec.center_u, spec.center_v, h.cx, h.cy, h.cz);
    const RingDynamics d = ring_dynamics(spec.ring_speed, 0.0f);
    h.c = d.c;
    h.inv_c = 1.0f / (d.c > 1e-3f ? d.c : 1e-3f);
    h.tau = d.tau;
    const float edge_t = (d.edge_w * h.inv_c) > 1e-3f ? (d.edge_w * h.inv_c) : 1e-3f;
    h.crest_t = edge_t * 1.22f;
    h.trail_angular = d.edge_w * 3.0f > 0.045f ? d.edge_w * 3.0f : 0.045f;
    h.amp = clampf(spec.amplitude, 0.0f, 4.0f);
    h.pr = srgb_byte_to_linear(spec.color_r);
    h.pg = srgb_byte_to_linear(spec.color_g);
    h.pb = srgb_byte_to_linear(spec.color_b);
  }
  g_tables_ready = true;
}

bool ensure_buffers(uint16_t n) {
  const size_t rgb_bytes = static_cast<size_t>(n) * 3u;
  if (g_ring_acc == nullptr) {
    g_ring_acc = static_cast<float*>(malloc(rgb_bytes * sizeof(float)));
  }
  if (g_ring_rgb == nullptr) {
    g_ring_rgb = static_cast<uint8_t*>(malloc(rgb_bytes));
  }
  if (g_dir_xyz == nullptr) {
    g_dir_xyz = static_cast<float*>(malloc(rgb_bytes * sizeof(float)));
  }
  if (g_uv == nullptr) {
    g_uv = static_cast<float*>(malloc(static_cast<size_t>(n) * 2u * sizeof(float)));
  }
  if (g_ring_acc == nullptr || g_ring_rgb == nullptr || g_dir_xyz == nullptr || g_uv == nullptr) {
    return false;
  }
  if (!g_tables_ready) {
    build_tables(n);
  }
  return true;
}

void release_buffers() {
  free(g_ring_acc);
  g_ring_acc = nullptr;
  free(g_ring_rgb);
  g_ring_rgb = nullptr;
  free(g_dir_xyz);
  g_dir_xyz = nullptr;
  free(g_uv);
  g_uv = nullptr;
  g_tables_ready = false;
}

uint8_t brightness_u8() { return g_brightness_u8; }

void render_rainbow_sweep(uint8_t* rgb, uint16_t n, uint32_t t_ms) {
  const uint8_t bright = brightness_u8();
  for (uint16_t i = 0; i < n; i++) {
    const float u = rem01(g_uv[i * 2u]);
    const float v = clampf(g_uv[i * 2u + 1u], 0.0f, 1.0f);
    const float phase = rem01(u + 0.35f * v);
    const uint32_t space = static_cast<uint32_t>(phase * 256.0f);
    const uint8_t hue = static_cast<uint8_t>((t_ms / 6u) + space);
    uint8_t r, g, b;
    hsv_to_rgb_u8(hue, 220, 180, r, g, b);
    const size_t o = static_cast<size_t>(i) * 3u;
    rgb[o] = static_cast<uint8_t>((static_cast<uint16_t>(r) * bright) / 255u);
    rgb[o + 1] = static_cast<uint8_t>((static_cast<uint16_t>(g) * bright) / 255u);
    rgb[o + 2] = static_cast<uint8_t>((static_cast<uint16_t>(b) * bright) / 255u);
  }
}

void apply_expanding_ring(float* acc, uint16_t n, const HotRing& h, float elapsed) {
  if (h.amp <= 0.0f) {
    return;
  }
  constexpr float kWakeFeatherS = 0.0045f;
  // Only LEDs near the wavefront contribute meaningfully.
  const float local_lo = -3.0f * h.crest_t;
  const float local_hi = 5.0f * h.tau;
  float theta_lo = h.c * (elapsed - local_hi);
  float theta_hi = h.c * (elapsed - local_lo);
  if (theta_lo < 0.0f) {
    theta_lo = 0.0f;
  }
  if (theta_hi > static_cast<float>(M_PI)) {
    theta_hi = static_cast<float>(M_PI);
  }
  if (theta_lo >= theta_hi) {
    return;
  }
  const float cos_hi = cosf(theta_lo);  // smaller theta → larger cos
  const float cos_lo = cosf(theta_hi);
  const float inv_crest_t = 1.0f / h.crest_t;
  const float inv_tau = 1.0f / h.tau;
  const float inv_trail = 1.0f / h.trail_angular;
  const float inv_wake = 1.0f / (2.0f * kWakeFeatherS > 1e-6f ? 2.0f * kWakeFeatherS : 1e-6f);
  const float* dir = g_dir_xyz;

  for (uint16_t i = 0; i < n; i++) {
    const float dx = dir[i * 3u];
    const float dy = dir[i * 3u + 1u];
    const float dz = dir[i * 3u + 2u];
    const float d = dx * h.cx + dy * h.cy + dz * h.cz;
    if (d < cos_lo || d > cos_hi) {
      continue;
    }
    const float theta = fast_acos(d);
    const float arrival = theta * h.inv_c;
    const float local = elapsed - arrival;
    const float wake = smoothstep01((local + 2.0f * kWakeFeatherS) * inv_wake);
    const float crest_x = local * inv_crest_t;
    const float crest = expf(-(crest_x * crest_x));
    float trail = 0.0f;
    if (local > 0.0f) {
      const float behind_rad = h.c * local;
      const float tg = behind_rad * inv_trail;
      const float trail_geom = expf(-(tg * tg));
      trail = expf(-local * inv_tau) * trail_geom;
    }
    const float profile = crest > trail ? crest : trail;
    const float wave = profile * h.amp * wake;
    if (wave <= 1e-4f) {
      continue;
    }
    const size_t o = static_cast<size_t>(i) * 3u;
    acc[o] += wave * h.pr;
    acc[o + 1] += wave * h.pg;
    acc[o + 2] += wave * h.pb;
  }
}

void finalize_ring_acc(const float* acc, uint8_t* rgb, uint16_t n) {
  const uint8_t bright = brightness_u8();
  for (uint16_t i = 0; i < n; i++) {
    const size_t o = static_cast<size_t>(i) * 3u;
    float r_lin = acc[o];
    float g_lin = acc[o + 1];
    float b_lin = acc[o + 2];
    const float m = r_lin > g_lin ? (r_lin > b_lin ? r_lin : b_lin) : (g_lin > b_lin ? g_lin : b_lin);
    if (m > 1.0f) {
      const float s = 1.0f / m;
      r_lin *= s;
      g_lin *= s;
      b_lin *= s;
    }
    const uint8_t r = g_lin_to_srgb[static_cast<uint8_t>(clampf(r_lin * 255.0f + 0.5f, 0.0f, 255.0f))];
    const uint8_t g = g_lin_to_srgb[static_cast<uint8_t>(clampf(g_lin * 255.0f + 0.5f, 0.0f, 255.0f))];
    const uint8_t b = g_lin_to_srgb[static_cast<uint8_t>(clampf(b_lin * 255.0f + 0.5f, 0.0f, 255.0f))];
    rgb[o] = static_cast<uint8_t>((static_cast<uint16_t>(r) * bright) / 255u);
    rgb[o + 1] = static_cast<uint8_t>((static_cast<uint16_t>(g) * bright) / 255u);
    rgb[o + 2] = static_cast<uint8_t>((static_cast<uint16_t>(b) * bright) / 255u);
  }
}

void render_expanding_rings(uint8_t* rgb, uint16_t n, float t_sec) {
  constexpr float kExpandingPeriodS = 12.5f;
  float t = fmodf(t_sec, kExpandingPeriodS);
  if (t < 0.0f) {
    t += kExpandingPeriodS;
  }
  std::memset(g_ring_acc, 0, static_cast<size_t>(n) * 3u * sizeof(float));
  for (size_t si = 0; si < kRingSpecCount; si++) {
    const HotRing& h = g_hot_rings[si];
    const float local = t - h.t0;
    if (local < 0.0f || local >= h.life_s) {
      continue;
    }
    apply_expanding_ring(g_ring_acc, n, h, local);
  }
  finalize_ring_acc(g_ring_acc, rgb, n);
}

void blend_rgb_into(uint8_t* base, const uint8_t* overlay, uint16_t n, float w) {
  w = clampf(w, 0.0f, 1.0f);
  const float base_w = 1.0f - w;
  const size_t bytes = static_cast<size_t>(n) * 3u;
  for (size_t i = 0; i < bytes; i++) {
    base[i] = static_cast<uint8_t>(
        clampf(static_cast<float>(base[i]) * base_w + static_cast<float>(overlay[i]) * w + 0.5f, 0.0f,
               255.0f));
  }
}

float rainbow_rings_ring_weight(float t, float solo, float active, float blend_in, float blend_out) {
  if (t <= solo) {
    return 0.0f;
  }
  const float lt = t - solo;
  const float rise = smoothstep01(lt / (blend_in > 1e-3f ? blend_in : 1e-3f));
  const float fall = smoothstep01((active - lt) / (blend_out > 1e-3f ? blend_out : 1e-3f));
  return rise < fall ? rise : fall;
}

#if GLOWBE_LOCAL_HAS_MATE
float ease_in_out_cubic(float t) {
  t = clampf(t, 0.0f, 1.0f);
  if (t < 0.5f) {
    return 4.0f * t * t * t;
  }
  const float u = -2.0f * t + 2.0f;
  return 1.0f - (u * u * u) * 0.5f;
}

void scale_rgb_brightness(uint8_t* rgb, uint16_t n, uint8_t bright) {
  const size_t bytes = static_cast<size_t>(n) * 3u;
  for (size_t i = 0; i < bytes; i++) {
    rgb[i] = static_cast<uint8_t>((static_cast<uint16_t>(rgb[i]) * bright) / 255u);
  }
}
#endif

/// `t` is time within one rainbow-rings period [0, kRainbowRingsPeriodS).
void render_rainbow_rings_at(uint8_t* rgb, uint16_t n, float t, float hue_elapsed_s) {
  const float solo = kRainbowRingsSoloS;
  const float active = (kRingLastS - kRingFirstS) > 1e-3f ? (kRingLastS - kRingFirstS) : 1e-3f;
  float blend_out = kRainbowRingsBlendOutS < active * 0.5f ? kRainbowRingsBlendOutS : active * 0.5f;
  float blend_in = kRainbowRingsBlendInS;
  const float max_in = (active - blend_out) > 1e-3f ? (active - blend_out) : 1e-3f;
  if (blend_in > max_in) {
    blend_in = max_in;
  }

  const uint32_t t_ms = static_cast<uint32_t>(hue_elapsed_s * 1000.0f);
  render_rainbow_sweep(rgb, n, t_ms);

  const float w = rainbow_rings_ring_weight(t, solo, active, blend_in, blend_out);
  if (w <= 0.0f) {
    return;
  }
  const float ring_t = kRingFirstS + (t - solo);
  render_expanding_rings(g_ring_rgb, n, ring_t);
  blend_rgb_into(rgb, g_ring_rgb, n, w);
}

#if GLOWBE_LOCAL_HAS_MATE
/// Mate tour local time in [0, kMateTourS).
void render_mate_tour(uint8_t* rgb, uint16_t n, float tour_t) {
  if (tour_t < 0.0f) {
    tour_t = 0.0f;
  }
  if (tour_t >= kMateTourS) {
    tour_t = kMateTourS - 1e-4f;
  }
  const uint8_t idx = static_cast<uint8_t>(tour_t / kMateSlotS);
  const uint8_t cur = idx < glowbe::local_mate::kExprCount ? idx : (glowbe::local_mate::kExprCount - 1);
  const float slot_local = tour_t - static_cast<float>(cur) * kMateSlotS;
  const float trans = kMateTransS < kMateSlotS ? kMateTransS : kMateSlotS;

  if (slot_local < trans && cur > 0) {
    const uint8_t prev = static_cast<uint8_t>(cur - 1u);
    glowbe::local_mate::blendFrames(prev, cur, ease_in_out_cubic(slot_local / trans), rgb);
  } else {
    glowbe::local_mate::copyFrame(cur, rgb);
  }
  scale_rgb_brightness(rgb, n, brightness_u8());
}

/// Mate segment local time in [0, kMatePeriodS): fade-in → tour → fade-out.
void render_mate_segment(uint8_t* rgb, uint16_t n, float mate_t, float elapsed_s) {
  if (mate_t < 0.0f) {
    mate_t = 0.0f;
  }
  if (mate_t >= kMatePeriodS) {
    mate_t = kMatePeriodS - 1e-4f;
  }

  const float fade = kMateFadeS > 1e-3f ? kMateFadeS : 1e-3f;
  const float rings_end_t = kRainbowRingsPlaylistS > 1e-3f ? kRainbowRingsPlaylistS - 1e-3f : 0.0f;

  if (mate_t < fade) {
    // Enter: rings (end of rainbow-rings playlist) → happy.
    render_rainbow_rings_at(rgb, n, rings_end_t, elapsed_s);
    render_mate_tour(g_ring_rgb, n, 0.0f);
    blend_rgb_into(rgb, g_ring_rgb, n, ease_in_out_cubic(mate_t / fade));
    return;
  }

  if (mate_t >= kMatePeriodS - fade) {
    // Exit: love → next-cycle rainbow start (solo rainbow; avoid g_ring_rgb aliasing).
    render_mate_tour(rgb, n, kMateTourS - 1e-4f);
    const uint32_t t_ms = static_cast<uint32_t>(elapsed_s * 1000.0f);
    render_rainbow_sweep(g_ring_rgb, n, t_ms);
    const float u = (mate_t - (kMatePeriodS - fade)) / fade;
    blend_rgb_into(rgb, g_ring_rgb, n, ease_in_out_cubic(u));
    return;
  }

  render_mate_tour(rgb, n, mate_t - fade);
}
#endif

void render_playlist(uint8_t* rgb, uint16_t n, float elapsed_s) {
  float t = fmodf(elapsed_s, kPlaylistPeriodS);
  if (t < 0.0f) {
    t += kPlaylistPeriodS;
  }
#if GLOWBE_LOCAL_HAS_MATE
  // 60panels: rainbow → rings → mate (fade in/out).
  if (t < kRainbowRingsPlaylistS) {
    render_rainbow_rings_at(rgb, n, t, elapsed_s);
    return;
  }
  render_mate_segment(rgb, n, t - kRainbowRingsPlaylistS, elapsed_s);
#else
  // 15panels: loop demo/rainbow-rings only.
  render_rainbow_rings_at(rgb, n, t, elapsed_s);
#endif
}

}  // namespace

bool active() {
  portENTER_CRITICAL(&g_active_mux);
  const bool v = g_active;
  portEXIT_CRITICAL(&g_active_mux);
  return v;
}

void setBrightnessU8(uint8_t brightness_u8) { g_brightness_u8 = brightness_u8; }

void setActive(bool playout) {
  portENTER_CRITICAL(&g_active_mux);
  const bool was = g_active;
  portEXIT_CRITICAL(&g_active_mux);

  if (playout == was) {
    return;
  }

  if (playout && !was) {
    g_playlist_origin_ms = millis();
    if (!ensure_buffers(GLOWBE_LED_COUNT)) {
      Serial.println("local playout: buffer alloc failed");
      portENTER_CRITICAL(&g_active_mux);
      g_active = false;
      portEXIT_CRITICAL(&g_active_mux);
      return;
    }
    g_frames_rendered = 0;
  }
  if (!playout && was) {
    release_buffers();
  }
  portENTER_CRITICAL(&g_active_mux);
  g_active = playout;
  portEXIT_CRITICAL(&g_active_mux);
  const unsigned pct = (static_cast<unsigned>(g_brightness_u8) * 100u + 127u) / 255u;
#if GLOWBE_LOCAL_HAS_MATE
  Serial.printf("local playout: %s (rainbow-rings + mate @ %u%%) heap=%u\n",
#else
  Serial.printf("local playout: %s (rainbow-rings @ %u%%) heap=%u\n",
#endif
                playout ? "on" : "off", pct, static_cast<unsigned>(ESP.getFreeHeap()));
}

void resetPlaylist(uint32_t now_ms) { g_playlist_origin_ms = now_ms; }

uint32_t framesRendered() { return g_frames_rendered; }

void renderFrame(uint8_t* rgb, uint16_t led_count, uint32_t now_ms) {
  if (rgb == nullptr || led_count == 0) {
    return;
  }
  if (led_count != glowbe::local_geom::kLedCount || !ensure_buffers(led_count)) {
    std::memset(rgb, 0, static_cast<size_t>(led_count) * 3u);
    return;
  }
  const float elapsed_s = static_cast<float>(now_ms - g_playlist_origin_ms) * 0.001f;
  render_playlist(rgb, led_count, elapsed_s);
  g_frames_rendered++;
}

}  // namespace glowbe::local
