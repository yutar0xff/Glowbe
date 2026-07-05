import { resolveRig } from "../resolve";
import type { LedPlacement, Rig } from "../schema";

export interface ChannelSummary {
  index: number;
  pin: number;
  ledCount: number;
}

export interface Calibration {
  schemaVersion: number;
  rigId: string;
  rigName: string;
  totalLeds: number;
  channels: ChannelSummary[];
  leds: LedPlacement[];
}

/** Group resolved placements into per-channel LED counts. */
export const channelLedCounts = (placements: LedPlacement[]): Map<number, number> => {
  const counts = new Map<number, number>();
  for (const p of placements) {
    counts.set(p.address.channel, (counts.get(p.address.channel) ?? 0) + 1);
  }
  return counts;
};

/**
 * Build the calibration payload sent to (or embedded in) the device, plus the
 * full resolved LED table used by Studio.
 */
export const buildCalibration = (rig: Rig): Calibration => {
  const placements = resolveRig(rig);
  const counts = channelLedCounts(placements);

  const channels: ChannelSummary[] =
    rig.channels.length > 0
      ? [...rig.channels]
          .sort((a, b) => a.index - b.index)
          .map((ch) => ({
            index: ch.index,
            pin: ch.pin,
            ledCount: counts.get(ch.index) ?? 0,
          }))
      : [{ index: 0, pin: -1, ledCount: placements.length }];

  return {
    schemaVersion: rig.meta.schemaVersion,
    rigId: rig.meta.id,
    rigName: rig.meta.name,
    totalLeds: placements.length,
    channels,
    leds: placements,
  };
};
