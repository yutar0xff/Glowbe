import { describe, expect, it } from "vitest";
import {
  activeFaceIds,
  buildStudioLayoutFile,
  parseStudioLayoutFile,
  rig60Panels,
  triangleLayout,
  wiringSnapshotFromRig,
} from "../index";
import { buildWiringFromChains } from "../wiring";

describe("studio layout file", () => {
  it("round-trips rig and wiring", () => {
    const base = rig60Panels(120);
    const faces = activeFaceIds(base).slice(0, 3);
    const rig = {
      ...base,
      faceLayouts: [triangleLayout({ paddingMm: 2 })],
      ...buildWiringFromChains({
        chains: [[faces[0]!, faces[1]!], [faces[2]!]],
        pins: [13, 14],
        reversed: [faces[1]!],
        faceRotations: { [faces[2]!]: 1 },
      }),
    };
    const wiring = {
      wirePinChains: [[faces[0]!, faces[1]!], [faces[2]!, ""]],
      wirePinGpio: [13, 14],
      wireConfigured: true,
      wireReversed: [faces[1]!],
      wireFaceRotations: { [faces[2]!]: 1 },
      wiringCheckedPinIndices: [1],
    };
    const editor = {
      ledPreviewDiameterMm: 4.5,
      showViewerAxes: false,
      showSolidOutline: true,
      hideBackfaceDiscrete: false,
      hideBackfaceDeviceRig: true,
      color: { brightness: 0.8, gamma: 1.2, whiteBalance: { r: 1, g: 1, b: 0.9 } },
      paintColor: [10, 20, 30] as [number, number, number],
      ledOverrides: [{ globalIndex: 0, rgb: [1, 2, 3] as [number, number, number] }],
      playbackSmoothing: false,
    };
    const file = buildStudioLayoutFile({ rig, wiring, editor });
    const parsed = parseStudioLayoutFile(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.layout.rig.solid.radius).toBe(120);
    expect(parsed.layout.rig.faceLayouts[0]?.ledCount).toBeGreaterThan(0);
    expect(parsed.layout.rig.faceLayouts[0]?.paddingMm).toBe(2);
    expect(parsed.wiring.wirePinChains[0]).toEqual([faces[0], faces[1]]);
    expect(parsed.wiring.wireReversed).toContain(faces[1]);
    expect(parsed.editor.ledPreviewDiameterMm).toBe(4.5);
    expect(parsed.editor.ledOverrides).toHaveLength(1);
    expect(parsed.editor.playbackSmoothing).toBe(false);
  });

  it("derives wiring from rig when block is omitted", () => {
    const rig = rig60Panels(100);
    const file = buildStudioLayoutFile({
      rig,
      wiring: wiringSnapshotFromRig(rig),
      editor: {
        ledPreviewDiameterMm: 3,
        showViewerAxes: true,
        showSolidOutline: true,
        hideBackfaceDiscrete: true,
        hideBackfaceDeviceRig: true,
        color: { brightness: 1, gamma: 1, whiteBalance: { r: 1, g: 1, b: 1 } },
        paintColor: [255, 80, 0],
        ledOverrides: [],
        playbackSmoothing: true,
      },
    });
    const { wiring: _, ...withoutWiring } = file;
    const parsed = parseStudioLayoutFile(withoutWiring);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.wiring.wirePinChains.length).toBeGreaterThan(0);
  });

  it("rejects invalid files", () => {
    expect(parseStudioLayoutFile({ kind: "wrong" }).ok).toBe(false);
  });
});
