import * as THREE from "three";
import {
  DEFAULT_COLOR_SETTINGS,
  applyColor,
  type ColorSettings,
  type LedPlacement,
} from "@glowbe/core";
import type { FrameSource } from "./frame-source";
import { normalizeTimelineFps } from "./timeline-fps";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const NONE_FILL = "#3a3a42";

/**
 * Central playback engine: a single source of truth for the current frame.
 *
 * All 3D views share ONE CanvasTexture backed by a display canvas; the LED
 * views sample a small sampling canvas. A master clock (driven by the ticker)
 * calls `render(time)` once per animation frame so every view stays in sync —
 * this is what makes a global timeline and image sequences work without drift.
 *
 * Sampling uses bilinear interpolation in the CPU readback buffer; image
 * sequences crossfade adjacent frames by phase while playing (paused uses a
 * discrete frame for lighter scrubbing). Both can be disabled via
 * `setPlaybackSmoothing(false)` for lower CPU (nearest-neighbor UV, no crossfade).
 * The same raster is used for `computeLedColors` / device streaming as for the
 * on-screen preview.
 */
export class PlaybackEngine {
  readonly displayCanvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly displayCtx: CanvasRenderingContext2D;
  private readonly sampleCanvas: HTMLCanvasElement;
  private readonly sampleCtx: CanvasRenderingContext2D;
  private sampleData: ImageData | null = null;

  private images: HTMLImageElement[] = [];
  private video: HTMLVideoElement | null = null;
  private ownedUrls: string[] = [];

  source: FrameSource = { kind: "none" };
  fps = 60;

  /** Master clock (seconds). Owned here so playback never drifts. */
  time = 0;
  playing = false;

  /** Bilinear UV + sequence crossfade (when off: nearest UV, discrete frames). */
  private playbackSmoothing = true;

  // --- Centralized per-LED sampling + color pipeline (Phase 2) ---
  private leds: LedPlacement[] = [];
  private colorSettings: ColorSettings = DEFAULT_COLOR_SETTINGS;
  private overrides = new Map<number, [number, number, number]>();
  /** Packed managed RGB (preview path: WB + gamma only), length 3*ledCount. */
  ledColors = new Uint8Array(0);

  private readonly displayW = 1024;
  private readonly displayH = 512;
  private readonly sampleW = 256;
  private readonly sampleH = 128;

  constructor() {
    this.displayCanvas = document.createElement("canvas");
    this.displayCanvas.width = this.displayW;
    this.displayCanvas.height = this.displayH;
    this.displayCtx = this.displayCanvas.getContext("2d")!;

    this.sampleCanvas = document.createElement("canvas");
    this.sampleCanvas.width = this.sampleW;
    this.sampleCanvas.height = this.sampleH;
    this.sampleCtx = this.sampleCanvas.getContext("2d", {
      willReadFrequently: true,
    })!;

    this.texture = new THREE.CanvasTexture(this.displayCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.clear();
  }

  /** Resolved LED count (highest globalIndex + 1; matches FRAME indexing). */
  get ledCount(): number {
    if (this.leds.length === 0) return 0;
    let max = 0;
    for (const led of this.leds) {
      if (led.globalIndex > max) max = led.globalIndex;
    }
    return max + 1;
  }

  get isVideo(): boolean {
    return this.video !== null;
  }

  get frameCount(): number {
    if (this.images.length > 0) return this.images.length;
    if (this.video && this.video.duration > 0) {
      return Math.max(1, Math.round(this.video.duration * this.fps));
    }
    return 1;
  }

  get duration(): number {
    if (this.video && this.video.duration > 0) return this.video.duration;
    return this.frameCount / this.fps;
  }

  async setSource(source: FrameSource): Promise<void> {
    // Tear down previous media and free its object URLs.
    this.video?.pause();
    this.video = null;
    this.images = [];
    for (const url of this.ownedUrls) URL.revokeObjectURL(url);
    this.ownedUrls = [];

    this.source = source;
    this.time = 0;

    if (source.kind === "image") {
      this.fps = 60;
      this.ownedUrls = [source.url];
      this.images = [await loadImage(source.url)];
    } else if (source.kind === "image-sequence") {
      this.fps = source.fps;
      this.ownedUrls = [...source.urls];
      this.images = await Promise.all(source.urls.map(loadImage));
    } else if (source.kind === "video") {
      this.fps = 60;
      this.ownedUrls = [source.url];
      this.video = await loadVideo(source.url);
    }
    this.render();
  }

  /** Advance the master clock by `dt` seconds (call once per animation frame). */
  advance(dt: number): void {
    if (!this.playing) return;
    if (this.video) {
      this.time = this.video.currentTime;
      return;
    }
    const dur = this.duration;
    this.time = dur > 0 ? (this.time + dt) % dur : this.time + dt;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (!this.video) return;
    if (playing) void this.video.play().catch(() => {});
    else this.video.pause();
  }

  seek(time: number): void {
    this.time = Math.max(0, Math.min(time, this.duration));
    if (this.video) this.video.currentTime = this.time;
    this.render();
  }

  setFps(fps: number): void {
    this.fps = normalizeTimelineFps(fps);
    if (this.time > this.duration) this.time = this.duration;
    this.render();
  }

  setPlaybackSmoothing(enabled: boolean): void {
    if (this.playbackSmoothing === enabled) return;
    this.playbackSmoothing = enabled;
    this.render();
    this.computeLedColors();
  }

  /** Draw the frame at the current master time. Safe to call every frame. */
  render(): void {
    if (this.images.length > 0) {
      const n = this.images.length;
      const phase = this.time * this.fps;
      const wrapped = n > 0 ? phase % n : 0;
      const idx0 = Math.min(n - 1, Math.max(0, Math.floor(wrapped)));
      const idx1 = n > 1 ? (idx0 + 1) % n : idx0;
      const t = wrapped - Math.floor(wrapped);
      const blend = this.playbackSmoothing && this.playing && n > 1 && t > 0;
      if (blend) {
        this.drawBlended(this.images[idx0]!, this.images[idx1]!, t);
      } else {
        this.drawElement(this.images[idx0]!);
      }
      return;
    }
    if (this.video) {
      this.drawElement(this.video);
      return;
    }
    this.clear();
  }

  sampleAt(u: number, v: number): Rgb {
    if (!this.sampleData) return { r: 58, g: 58, b: 66 };
    const uClamped = Math.min(1, Math.max(0, u));
    const vClamped = Math.min(1, Math.max(0, v));
    if (!this.playbackSmoothing) {
      const x = Math.min(
        this.sampleW - 1,
        Math.max(0, Math.floor(uClamped * this.sampleW)),
      );
      const y = Math.min(
        this.sampleH - 1,
        Math.max(0, Math.floor(vClamped * this.sampleH)),
      );
      const i = (y * this.sampleW + x) * 4;
      const d = this.sampleData.data;
      return { r: d[i] ?? 0, g: d[i + 1] ?? 0, b: d[i + 2] ?? 0 };
    }
    const wm = this.sampleW - 1;
    const hm = this.sampleH - 1;
    const fx = uClamped * wm;
    const fy = vClamped * hm;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, this.sampleW - 1);
    const y1 = Math.min(y0 + 1, this.sampleH - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const d = this.sampleData.data;
    const w = this.sampleW;

    const pick = (xx: number, yy: number): [number, number, number] => {
      const i = (yy * w + xx) * 4;
      return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0];
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const lerp4 = (
      c00: number,
      c10: number,
      c01: number,
      c11: number,
    ): number => lerp(lerp(c00, c10, tx), lerp(c01, c11, tx), ty);

    const [c00r, c00g, c00b] = pick(x0, y0);
    const [c10r, c10g, c10b] = pick(x1, y0);
    const [c01r, c01g, c01b] = pick(x0, y1);
    const [c11r, c11g, c11b] = pick(x1, y1);

    return {
      r: lerp4(c00r, c10r, c01r, c11r),
      g: lerp4(c00g, c10g, c01g, c11g),
      b: lerp4(c00b, c10b, c01b, c11b),
    };
  }

  setLeds(leds: LedPlacement[]): void {
    this.leds = leds;
    if (this.ledColors.length !== leds.length * 3) {
      this.ledColors = new Uint8Array(leds.length * 3);
    }
    this.computeLedColors();
  }

  setColorSettings(cs: ColorSettings): void {
    this.colorSettings = cs;
    this.computeLedColors();
  }

  setOverride(globalIndex: number, rgb: [number, number, number] | null): void {
    if (rgb) this.overrides.set(globalIndex, rgb);
    else this.overrides.delete(globalIndex);
  }

  clearOverrides(): void {
    this.overrides.clear();
  }

  hasOverrides(): boolean {
    return this.overrides.size > 0;
  }

  listOverrides(): { globalIndex: number; rgb: [number, number, number] }[] {
    return [...this.overrides.entries()]
      .map(([globalIndex, rgb]) => ({ globalIndex, rgb }))
      .sort((a, b) => a.globalIndex - b.globalIndex);
  }

  applyOverrides(items: { globalIndex: number; rgb: [number, number, number] }[]): void {
    this.overrides.clear();
    for (const { globalIndex, rgb } of items) {
      this.overrides.set(globalIndex, rgb);
    }
    this.computeLedColors();
  }

  /** Managed color for one LED (post pipeline). Reads the shared buffer. */
  colorAt(index: number): Rgb {
    const i = index * 3;
    return {
      r: this.ledColors[i] ?? 0,
      g: this.ledColors[i + 1] ?? 0,
      b: this.ledColors[i + 2] ?? 0,
    };
  }

  /**
   * Single batched pass: sample every LED at its UV (or use a manual override),
   * Apply preview color management (WB + gamma; brightness is device-only).
   */
  computeLedColors(): void {
    const leds = this.leds;
    if (leds.length === 0) {
      this.ledColors = new Uint8Array(0);
      return;
    }

    let maxGlobal = 0;
    for (const led of leds) {
      if (led.globalIndex > maxGlobal) maxGlobal = led.globalIndex;
    }
    const bufLen = (maxGlobal + 1) * 3;
    if (this.ledColors.length !== bufLen) {
      this.ledColors = new Uint8Array(bufLen);
    } else {
      this.ledColors.fill(0);
    }

    const out = this.ledColors;
    const cs = this.colorSettings;

    for (const led of leds) {
      const ov = this.overrides.get(led.globalIndex);
      let r: number;
      let g: number;
      let b: number;
      if (ov) {
        r = ov[0];
        g = ov[1];
        b = ov[2];
      } else {
        const s = this.sampleAt(led.uv.x, led.uv.y);
        r = s.r;
        g = s.g;
        b = s.b;
      }
      const [mr, mg, mb] = applyColor(r, g, b, cs);
      const o = led.globalIndex * 3;
      if (o + 2 >= out.length) continue;
      out[o] = mr;
      out[o + 1] = mg;
      out[o + 2] = mb;
    }
  }

  private drawElement(el: HTMLImageElement | HTMLVideoElement): void {
    try {
      this.displayCtx.drawImage(el, 0, 0, this.displayW, this.displayH);
      this.sampleCtx.drawImage(el, 0, 0, this.sampleW, this.sampleH);
      this.sampleData = this.sampleCtx.getImageData(0, 0, this.sampleW, this.sampleH);
      this.texture.needsUpdate = true;
    } catch {
      // Frame not decoded yet; keep the previous frame.
    }
  }

  /**
   * Linear crossfade on the display buffer, then one downscale to the sample
   * buffer (cheaper than compositing twice at sample resolution).
   */
  private drawBlended(
    a: HTMLImageElement,
    b: HTMLImageElement,
    t: number,
  ): void {
    try {
      const alpha = Math.min(1, Math.max(0, t));
      this.displayCtx.globalCompositeOperation = "source-over";
      this.displayCtx.globalAlpha = 1;
      this.displayCtx.drawImage(a, 0, 0, this.displayW, this.displayH);
      this.displayCtx.globalAlpha = alpha;
      this.displayCtx.drawImage(b, 0, 0, this.displayW, this.displayH);
      this.displayCtx.globalAlpha = 1;

      this.sampleCtx.globalAlpha = 1;
      this.sampleCtx.drawImage(this.displayCanvas, 0, 0, this.sampleW, this.sampleH);

      this.sampleData = this.sampleCtx.getImageData(0, 0, this.sampleW, this.sampleH);
      this.texture.needsUpdate = true;
    } catch {
      // Frame not decoded yet; keep the previous frame.
    }
  }

  private clear(): void {
    this.displayCtx.fillStyle = NONE_FILL;
    this.displayCtx.fillRect(0, 0, this.displayW, this.displayH);
    this.sampleData = null;
    this.texture.needsUpdate = true;
  }
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });

const loadVideo = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("Failed to load video"));
    video.src = url;
  });

let engine: PlaybackEngine | null = null;

/** Lazily create the client-only playback engine singleton. */
export const getPlayback = (): PlaybackEngine => {
  if (!engine) engine = new PlaybackEngine();
  return engine;
};
