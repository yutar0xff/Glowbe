import { DEFAULT_PINS } from "@glowbe/core";
import {
  applyWiringToRig,
  chainsHaveAnyFace,
  initialWirePinChains,
  initialWirePinGpio,
  remapRowIndexAfterMove,
} from "./editor-wiring-rig";
import type { EditorState } from "./editor-store-types";
import type { ApplyRig, EditorStoreGet, EditorStoreSet } from "./editor-store-rig-core";

export function createEditorWiringSlice(
  set: EditorStoreSet,
  get: EditorStoreGet,
  applyRig: ApplyRig,
): Pick<
  EditorState,
  | "wirePinChains"
  | "wirePinGpio"
  | "wireReversed"
  | "wireConfigured"
  | "wireFaceRotations"
  | "wiringAssignmentTarget"
  | "wiringWalkPinIndex"
  | "wiringFocusedPinIndex"
  | "wiringCheckedPinIndices"
  | "attachmentPreviewCell"
  | "setWiringAssignmentTarget"
  | "setWiringWalkPin"
  | "appendWalkPinFace"
  | "setWirePinRowCount"
  | "assignWiringCellFace"
  | "removeWireChainCellAndCompact"
  | "appendWirePinColumn"
  | "setWirePinGpioRow"
  | "toggleFaceReversed"
  | "resetWiring"
  | "setAttachmentPreviewCell"
  | "removeWiringCheckedRows"
  | "moveWirePinRow"
  | "setWiringFocusedPin"
  | "wiringTableRowClick"
  | "setWireFaceRotation"
  | "cycleWireFaceRotation"
  | "appendWirePinRow"
> {
  return {
    wirePinChains: initialWirePinChains,
    wirePinGpio: initialWirePinGpio,
    wireReversed: [],
    wireConfigured: false,
    wireFaceRotations: {},
    wiringAssignmentTarget: null,
    wiringWalkPinIndex: null,
    wiringFocusedPinIndex: null,
    wiringCheckedPinIndices: [],
    attachmentPreviewCell: null,

    setWiringAssignmentTarget: (wiringAssignmentTarget) =>
      set({ wiringAssignmentTarget, wiringWalkPinIndex: null }),

    setWiringWalkPin: (pinIndex) => {
      if (pinIndex == null) {
        set({ wiringWalkPinIndex: null });
        return;
      }
      set((s) => {
        const turningOff = s.wiringWalkPinIndex === pinIndex;
        return {
          wiringWalkPinIndex: turningOff ? null : pinIndex,
          wiringAssignmentTarget: null,
          wiringFocusedPinIndex: turningOff ? s.wiringFocusedPinIndex : pinIndex,
        };
      });
    },

    appendWalkPinFace: (faceId) => {
      const s = get();
      const wi = s.wiringWalkPinIndex;
      if (wi == null) return;
      const rowPeek = [...(s.wirePinChains[wi] ?? [])];
      while (rowPeek.length > 0 && rowPeek[rowPeek.length - 1] === "") rowPeek.pop();
      if (rowPeek.length > 0 && rowPeek[rowPeek.length - 1] === faceId) return;
      let chains = s.wirePinChains.map((r) => [...r]);
      const gpio = [...s.wirePinGpio];
      while (wi >= chains.length) {
        chains.push([]);
        gpio.push(DEFAULT_PINS[gpio.length] ?? -1);
      }
      chains = chains.map((r) => r.map((c) => (c === faceId ? "" : c)));
      const row = [...(chains[wi] ?? [])];
      while (row.length > 0 && row[row.length - 1] === "") row.pop();
      row.push(faceId);
      chains[wi] = row;
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(s.rig, chains, gpio, s.wireReversed, s.wireFaceRotations, configured);
      applyRig(rig, { wirePinChains: chains, wirePinGpio: gpio, wireConfigured: configured });
    },

    setWirePinRowCount: (n) => {
      const s = get();
      const count = Math.max(1, Math.min(10, Math.round(n)));
      let chains = [...s.wirePinChains];
      let gpio = [...s.wirePinGpio];
      if (count > chains.length) {
        for (let i = chains.length; i < count; i++) {
          chains.push([]);
          gpio.push(DEFAULT_PINS[i] ?? -1);
        }
      } else {
        chains = chains.slice(0, count);
        gpio = gpio.slice(0, count);
      }
      const walk =
        s.wiringWalkPinIndex != null && s.wiringWalkPinIndex >= count ? null : s.wiringWalkPinIndex;
      const focus =
        s.wiringFocusedPinIndex != null && s.wiringFocusedPinIndex >= count
          ? null
          : s.wiringFocusedPinIndex;
      const checked = s.wiringCheckedPinIndices.filter((i) => i < count);
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(s.rig, chains, gpio, s.wireReversed, s.wireFaceRotations, configured);
      applyRig(rig, {
        wirePinChains: chains,
        wirePinGpio: gpio,
        wireConfigured: configured,
        wiringWalkPinIndex: walk,
        wiringFocusedPinIndex: focus,
        wiringCheckedPinIndices: checked,
      });
    },

    assignWiringCellFace: (pinIndex, colIndex, faceId) => {
      const s = get();
      if (faceId.length > 0 && s.wirePinChains[pinIndex]?.[colIndex] === faceId) return;
      let chains = s.wirePinChains.map((r) => [...r]);
      const gpio = [...s.wirePinGpio];
      while (pinIndex >= chains.length) {
        chains.push([]);
        gpio.push(DEFAULT_PINS[gpio.length] ?? -1);
      }
      while (chains[pinIndex]!.length <= colIndex) {
        chains[pinIndex]!.push("");
      }
      if (faceId.length > 0) {
        chains = chains.map((r) => r.map((c) => (c === faceId ? "" : c)));
        const row = [...chains[pinIndex]!];
        while (row.length <= colIndex) row.push("");
        row[colIndex] = faceId;
        chains[pinIndex] = row;
      } else {
        const row = [...chains[pinIndex]!];
        if (colIndex < row.length) row[colIndex] = "";
        chains[pinIndex] = row;
      }
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(s.rig, chains, gpio, s.wireReversed, s.wireFaceRotations, configured);
      applyRig(rig, {
        wirePinChains: chains,
        wirePinGpio: gpio,
        wireConfigured: configured,
        wiringAssignmentTarget: null,
        wiringWalkPinIndex: null,
      });
    },

    removeWireChainCellAndCompact: (pinIndex, colIndex) => {
      const s = get();
      const row = [...(s.wirePinChains[pinIndex] ?? [])];
      if (colIndex < 0 || colIndex >= row.length) return;
      row.splice(colIndex, 1);
      const chains = s.wirePinChains.map((r, i) => (i === pinIndex ? row : [...r]));
      const gpio = [...s.wirePinGpio];
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(s.rig, chains, gpio, s.wireReversed, s.wireFaceRotations, configured);
      applyRig(rig, {
        wirePinChains: chains,
        wirePinGpio: gpio,
        wireConfigured: configured,
        wiringAssignmentTarget: null,
        wiringWalkPinIndex: null,
      });
    },

    appendWirePinColumn: () => {
      const s = get();
      let chains: string[][];
      let gpio = [...s.wirePinGpio];
      if (s.wirePinChains.length === 0) {
        chains = [[""]];
        gpio = [DEFAULT_PINS[0] ?? 13];
      } else {
        chains = s.wirePinChains.map((r) => [...r, ""]);
        while (gpio.length < chains.length) {
          gpio.push(DEFAULT_PINS[gpio.length] ?? -1);
        }
      }
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(
        s.rig,
        chains,
        gpio,
        s.wireReversed,
        s.wireFaceRotations,
        configured,
      );
      applyRig(rig, { wirePinChains: chains, wirePinGpio: gpio, wireConfigured: configured });
    },

    setWirePinGpioRow: (row, pinNumber) => {
      const s = get();
      const gpio = [...s.wirePinGpio];
      while (gpio.length <= row) {
        gpio.push(DEFAULT_PINS[gpio.length] ?? -1);
      }
      gpio[row] = pinNumber;
      const rig = applyWiringToRig(
        s.rig,
        s.wirePinChains,
        gpio,
        s.wireReversed,
        s.wireFaceRotations,
        s.wireConfigured,
      );
      applyRig(rig, { wirePinGpio: gpio, wireConfigured: s.wireConfigured });
    },

    toggleFaceReversed: (faceId) => {
      const s = get();
      const reversed = s.wireReversed.includes(faceId)
        ? s.wireReversed.filter((x) => x !== faceId)
        : [...s.wireReversed, faceId];
      const rig = applyWiringToRig(
        s.rig,
        s.wirePinChains,
        s.wirePinGpio,
        reversed,
        s.wireFaceRotations,
        s.wireConfigured,
      );
      applyRig(rig, { wireReversed: reversed, wireConfigured: s.wireConfigured });
    },

    resetWiring: () => {
      const chains: string[][] = [];
      const gpio: number[] = [];
      const rig = applyWiringToRig(get().rig, chains, gpio, [], {}, false);
      applyRig(rig, {
        wirePinChains: chains,
        wirePinGpio: gpio,
        wireReversed: [],
        wireConfigured: false,
        selectedFaceIds: [],
        wiringAssignmentTarget: null,
        wiringWalkPinIndex: null,
        wiringFocusedPinIndex: null,
        wiringCheckedPinIndices: [],
        wireFaceRotations: {},
        attachmentPreviewCell: null,
      });
    },

    setAttachmentPreviewCell: (attachmentPreviewCell) => set({ attachmentPreviewCell }),

    removeWiringCheckedRows: () => {
      const s = get();
      const drop = new Set(s.wiringCheckedPinIndices);
      if (drop.size === 0) return;
      const newChains = s.wirePinChains.filter((_, i) => !drop.has(i));
      const newGpio = s.wirePinGpio.filter((_, i) => !drop.has(i));
      const configured = chainsHaveAnyFace(newChains);
      const rig = applyWiringToRig(
        s.rig,
        newChains,
        newGpio,
        s.wireReversed,
        s.wireFaceRotations,
        configured,
      );
      applyRig(rig, {
        wirePinChains: newChains,
        wirePinGpio: newGpio,
        wireConfigured: configured,
        wiringCheckedPinIndices: [],
        wiringWalkPinIndex: null,
        wiringFocusedPinIndex: null,
        wiringAssignmentTarget: null,
        attachmentPreviewCell: null,
      });
    },

    moveWirePinRow: (fromIndex, toIndex) => {
      const s = get();
      const n = s.wirePinChains.length;
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) {
        return;
      }
      const chains = s.wirePinChains.map((r) => [...r]);
      const gpio = [...s.wirePinGpio];
      const [row] = chains.splice(fromIndex, 1);
      chains.splice(toIndex, 0, row);
      const [pin] = gpio.splice(fromIndex, 1);
      gpio.splice(toIndex, 0, pin);
      const remap = (i: number) => remapRowIndexAfterMove(fromIndex, toIndex, i);
      const checked = [...new Set(s.wiringCheckedPinIndices.map(remap))].sort((a, b) => a - b);
      const focus =
        s.wiringFocusedPinIndex != null ? remap(s.wiringFocusedPinIndex) : null;
      const walk = s.wiringWalkPinIndex != null ? remap(s.wiringWalkPinIndex) : null;
      const at = s.wiringAssignmentTarget;
      const nextAt =
        at != null ? { pinIndex: remap(at.pinIndex), colIndex: at.colIndex } : null;
      const ap = s.attachmentPreviewCell;
      const nextAp = ap ? { ri: remap(ap.ri), ci: ap.ci } : null;
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(
        s.rig,
        chains,
        gpio,
        s.wireReversed,
        s.wireFaceRotations,
        configured,
      );
      applyRig(rig, {
        wirePinChains: chains,
        wirePinGpio: gpio,
        wireConfigured: configured,
        wiringCheckedPinIndices: checked,
        wiringFocusedPinIndex: focus,
        wiringWalkPinIndex: walk,
        wiringAssignmentTarget: nextAt,
        attachmentPreviewCell: nextAp,
      });
    },

    setWiringFocusedPin: (wiringFocusedPinIndex) => set({ wiringFocusedPinIndex }),

    wiringTableRowClick: (pinIndex) =>
      set((s) => {
        const next = new Set(s.wiringCheckedPinIndices);
        if (next.has(pinIndex)) next.delete(pinIndex);
        else next.add(pinIndex);
        return {
          wiringCheckedPinIndices: [...next].sort((a, b) => a - b),
          wiringFocusedPinIndex: pinIndex,
        };
      }),

    setWireFaceRotation: (faceId, rotation) => {
      const s = get();
      const r = (((Math.round(rotation as number) % 3) + 3) % 3) as 0 | 1 | 2;
      const next = { ...s.wireFaceRotations, [faceId]: r };
      const configured = chainsHaveAnyFace(s.wirePinChains);
      const rig = applyWiringToRig(
        s.rig,
        s.wirePinChains,
        s.wirePinGpio,
        s.wireReversed,
        next,
        configured,
      );
      applyRig(rig, { wireFaceRotations: next, wireConfigured: configured });
    },

    cycleWireFaceRotation: (faceId) => {
      const s = get();
      const cur = (((s.wireFaceRotations[faceId] ?? 0) % 3) + 3) % 3;
      const next = ((cur + 1) % 3) as 0 | 1 | 2;
      const nextMap = { ...s.wireFaceRotations, [faceId]: next };
      const configured = chainsHaveAnyFace(s.wirePinChains);
      const rig = applyWiringToRig(
        s.rig,
        s.wirePinChains,
        s.wirePinGpio,
        s.wireReversed,
        nextMap,
        configured,
      );
      applyRig(rig, { wireFaceRotations: nextMap, wireConfigured: configured });
    },

    appendWirePinRow: () => {
      const s = get();
      if (s.wirePinChains.length >= 10) return;
      const chains = s.wirePinChains.map((r) => [...r]);
      const gpio = [...s.wirePinGpio];
      chains.push([]);
      gpio.push(DEFAULT_PINS[gpio.length] ?? -1);
      const newIndex = chains.length - 1;
      const configured = chainsHaveAnyFace(chains);
      const rig = applyWiringToRig(
        s.rig,
        chains,
        gpio,
        s.wireReversed,
        s.wireFaceRotations,
        configured,
      );
      const checked = new Set(s.wiringCheckedPinIndices);
      checked.add(newIndex);
      applyRig(rig, {
        wirePinChains: chains,
        wirePinGpio: gpio,
        wireConfigured: configured,
        wiringWalkPinIndex: newIndex,
        wiringFocusedPinIndex: newIndex,
        wiringCheckedPinIndices: [...checked].sort((a, b) => a - b),
        wiringAssignmentTarget: null,
      });
    },
  };
}
