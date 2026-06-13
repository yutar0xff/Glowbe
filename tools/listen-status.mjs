#!/usr/bin/env node
/**
 * Listen for Glowbe STATUS packets (UDP 49153) from ESP.
 * Usage: node tools/listen-status.mjs [seconds]
 */
import { createSocket } from "node:dgram";

const seconds = Number(process.argv[2] ?? "15");
const PORT = 49153;

const sock = createSocket({ type: "udp4", reuseAddr: true });
sock.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

sock.on("message", (msg) => {
  if (msg.length < 16) return;
  const frames = msg.readUInt32LE(4);
  const fpsX10 = msg.readUInt16LE(8);
  const parseErr = msg.readUInt16LE(10);
  const rssi = msg.readInt8(12);
  console.log(
    `status: frames=${frames} fps=${(fpsX10 / 10).toFixed(1)} parse_err=${parseErr} rssi=${rssi}`,
  );
});

sock.bind(PORT, () => {
  console.log(`Listening on UDP ${PORT} for ${seconds}s ...`);
});

setTimeout(() => {
  sock.close();
  process.exit(0);
}, seconds * 1000);
