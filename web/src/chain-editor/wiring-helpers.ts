/** I2S line colors (match previous 2:1 map). */
export const WIRING_CHANNEL_COLORS = [
  "#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa",
  "#22d3ee", "#fb7185", "#facc15", "#4ade80", "#c084fc",
];

/** Table row / 3D chain highlight when GPIO rows are checked (stable order = sorted row index). */
export const WIRING_ROW_CHECK_COLORS = [
  "#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#c084fc",
  "#fb7185", "#38bdf8", "#facc15", "#4ade80", "#93c5fd",
] as const;

/** Slot in sorted `checkedRowIndices` for a row index, or null if unchecked. */
export function wiringCheckedRowColorSlot(
  sortedChecked: readonly number[],
  rowIndex: number,
): number | null {
  const i = sortedChecked.indexOf(rowIndex);
  return i >= 0 ? i : null;
}

/** Face id → row check color for 3D outline (first row wins if a face appears in multiple). */
export function wiringRowColoredFaceMap(
  checkedPinRows: readonly number[],
  wirePinChains: readonly (readonly string[])[],
): Map<string, string> | null {
  if (checkedPinRows.length === 0) return null;
  const map = new Map<string, string>();
  const sorted = [...checkedPinRows].sort((a, b) => a - b);
  for (const ri of sorted) {
    const slot = wiringCheckedRowColorSlot(sorted, ri);
    if (slot == null) continue;
    const color = WIRING_ROW_CHECK_COLORS[slot % WIRING_ROW_CHECK_COLORS.length]!;
    for (const id of wirePinChains[ri] ?? []) {
      if (!id) continue;
      if (!map.has(id)) map.set(id, color);
    }
  }
  return map.size > 0 ? map : null;
}

export function channelForFaceIndex(order: string[], nCh: number, idx: number): number {
  const n = order.length;
  if (n === 0 || nCh < 1) return 0;
  const base = Math.floor(n / nCh);
  let rem = n % nCh;
  let start = 0;
  for (let c = 0; c < nCh; c++) {
    const len = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    if (idx >= start && idx < start + len) return c;
    start += len;
  }
  return nCh - 1;
}
