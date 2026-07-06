import { DEFAULT_PINS } from "@glowbe/core";

/** Shared compact control chrome for MCU wiring table (header cells, rows, footer). */
export const MCU_TABLE_BTN_CLASS =
  "rounded-md border border-border bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-40";

/** Default GPIO for a row index when `wirePinGpio` is sparse. */
export function gpioValueForRow(ri: number, wirePinGpio: number[]): number {
  return wirePinGpio[ri] ?? DEFAULT_PINS[ri] ?? -1;
}

/** Table / list label for a face chain cell: empty → em dash; strip `face-` prefix. */
export function formatFaceChainCell(id: string): string {
  if (!id) return "—";
  return id.replace(/^face-/, "");
}

/** Drop rightmost columns that are empty in every GPIO row (fixes phantom “—” cells). */
export function maxDisplayWireColumns(chains: string[][]): number {
  if (chains.length === 0) return 1;
  const mRaw = Math.max(1, ...chains.map((r) => r.length));
  let m = mRaw;
  while (m > 1 && chains.every((r) => !((r[m - 1] ?? "").length > 0))) m--;
  return m;
}
