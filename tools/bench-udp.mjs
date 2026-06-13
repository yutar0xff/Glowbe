#!/usr/bin/env node
/**
 * Send Glowbe Wire FRAME with RGB loop pattern.
 * Usage: node tools/bench-udp.mjs <esp-ip> [fps]
 */
import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(
  readFileSync(join(REPO, "assets/compiled/prototype-icosahedron-15.meta.json"), "utf8"),
);

const hostArg = process.argv[2];
const fps = Number(process.argv[3] ?? "60");
if (!hostArg) {
  console.error("Usage: node tools/bench-udp.mjs <esp-ip> [fps]");
  process.exit(2);
}

const PORT = 49152;
const LED_COUNT = meta.ledCount;
const PAYLOAD_LEN = LED_COUNT * 3;

const LEDS_PER_LINE = 45;

function hsvToRgb(h, s, v) {
  if (s === 0) return [v, v, v];
  const region = Math.floor(h / 43);
  const remainder = (h % 43) * 6;
  const p = Math.floor((v * (255 - s)) / 255);
  const q = Math.floor((v * (255 - (s * remainder) / 255)) / 255);
  const t = Math.floor((v * (255 - (s * (255 - remainder)) / 255)) / 255);
  switch (region) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function fillLoopRgb(tMs, buf) {
  const t = tMs >>> 0;
  for (let g = 0; g < LED_COUNT; g++) {
    const line = Math.floor(g / LEDS_PER_LINE);
    const i = g % LEDS_PER_LINE;
    const hue = (Math.floor(t / 8) + line * 40 + i * 2) & 0xff;
    const [r, gr, b] = hsvToRgb(hue, 220, 180);
    const o = g * 3;
    buf[o] = r;
    buf[o + 1] = gr;
    buf[o + 2] = b;
  }
}

function buildPacket(frameId, tMs) {
  const pkt = Buffer.alloc(16 + PAYLOAD_LEN);
  pkt.writeUInt8(0x47, 0);
  pkt.writeUInt8(0x42, 1);
  pkt.writeUInt8(1, 2);
  pkt.writeUInt8(1, 3);
  pkt.writeUInt32LE(frameId >>> 0, 4);
  pkt.writeUInt16LE(LED_COUNT, 8);
  pkt.writeUInt16LE(0, 10);
  pkt.writeUInt16LE(1, 12);
  pkt.writeUInt16LE(PAYLOAD_LEN, 14);
  fillLoopRgb(tMs, pkt.subarray(16));
  return pkt;
}

let espIp = hostArg.includes(".") ? hostArg : `${hostArg}.local`;
if (!/^\d+\.\d+\.\d+\.\d+$/.test(espIp)) {
  try {
    espIp = (await lookup(espIp, { family: 4 })).address;
  } catch (err) {
    console.error(`Cannot resolve ${espIp}: ${err.code ?? err.message}`);
    process.exit(1);
  }
}

const sock = createSocket("udp4");
sock.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});

let frameId = 0;
let sent = 0;
const started = Date.now();
const intervalMs = 1000 / fps;

console.log(`FRAME RGB -> ${espIp}:${PORT} @ ${fps} fps`);

const timer = setInterval(() => {
  const tMs = Date.now() - started;
  sock.send(buildPacket(frameId++, tMs), PORT, espIp, (err) => {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }
    if (++sent % fps === 0) {
      console.log(`sent ${sent}`);
    }
  });
}, intervalMs);

process.on("SIGINT", () => {
  clearInterval(timer);
  sock.close();
});
