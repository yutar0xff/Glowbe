

import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { DEFAULT_PINS } from "@glowbe/core";
import {
  MCU_TABLE_BTN_CLASS,
  maxDisplayWireColumns,
} from "@/chain-editor/wiring-table-utils";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/chain-editor/stores/editor-store";
import { useEditorReadOnly } from "@/chain-editor/chain-profile-editor-context";
import {
  WIRING_ROW_CHECK_COLORS,
  wiringCheckedRowColorSlot,
} from "@/chain-editor/wiring-helpers";
import { Section, Stat } from "@/chain-editor/views/panel-ui";
import {
  gpioValueForRow,
  McuWiringTableRow,
} from "@/chain-editor/views/mcu-wiring-table-row";

const btn = MCU_TABLE_BTN_CLASS;

/**
 * MCU wiring: pin rows × hop columns (Din→Dout). Check rows for colored 3D chains;
 * click a cell, then pick a face in 3D, or use **Walk** to append hops.
 */
export function McuWiringTable() {
  const readOnly = useEditorReadOnly();
  const leds = useEditorStore((s) => s.leds);
  const wirePinChains = useEditorStore((s) => s.wirePinChains);
  const wirePinGpio = useEditorStore((s) => s.wirePinGpio);
  const wireConfigured = useEditorStore((s) => s.wireConfigured);
  const wiringAssignmentTarget = useEditorStore((s) => s.wiringAssignmentTarget);
  const wiringWalkPinIndex = useEditorStore((s) => s.wiringWalkPinIndex);
  const wiringCheckedPinIndices = useEditorStore((s) => s.wiringCheckedPinIndices);
  const setWiringAssignmentTarget = useEditorStore((s) => s.setWiringAssignmentTarget);
  const setWiringWalkPin = useEditorStore((s) => s.setWiringWalkPin);
  const wiringTableRowClick = useEditorStore((s) => s.wiringTableRowClick);
  const appendWirePinRow = useEditorStore((s) => s.appendWirePinRow);
  const appendWirePinColumn = useEditorStore((s) => s.appendWirePinColumn);
  const setWirePinGpioRow = useEditorStore((s) => s.setWirePinGpioRow);
  const resetWiring = useEditorStore((s) => s.resetWiring);
  const assignWiringCellFace = useEditorStore((s) => s.assignWiringCellFace);
  const removeWireChainCellAndCompact = useEditorStore(
    (s) => s.removeWireChainCellAndCompact,
  );
  const removeWiringCheckedRows = useEditorStore((s) => s.removeWiringCheckedRows);
  const moveWirePinRow = useEditorStore((s) => s.moveWirePinRow);

  const usedChannels = useMemo(
    () => new Set(leds.map((l) => l.address.channel)).size,
    [leds],
  );

  const displayChains = wirePinChains;

  const maxCols = useMemo(() => maxDisplayWireColumns(displayChains), [displayChains]);

  const pinOptions = useMemo(() => {
    const u = [...new Set(DEFAULT_PINS)].sort((a, b) => a - b);
    return u;
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">
      <Section title="MCU inputs (pins → face chain)">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Each <strong className="text-foreground">row</strong> is one GPIO / parallel line. Columns
          are Din→Dout along that line. Use the left checkbox (or click the row) to highlight that
          line in 3D with a matching color. Click a cell, then pick a face in the 3D view, or turn{" "}
          <strong className="text-foreground">Walk</strong> on and click faces in order. Hover a
          cell and use <strong className="text-foreground">×</strong> to remove that hop or an empty
          slot (later faces shift left). <strong className="text-foreground">Ctrl/⌘+click</strong> in 3D
          toggles face selection. <strong className="text-foreground">Right-click</strong> a filled
          cell still clears it. Use <strong className="text-foreground">+</strong> in the header for
          a hop column, or <strong className="text-foreground">+ Add GPIO row</strong> below. Click
          empty space in the 3D view to clear face and row checks.
        </p>
        {wiringWalkPinIndex != null && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
            Recording pin row <strong className="text-foreground">{wiringWalkPinIndex + 1}</strong>:
            click faces in the 3D view in Din→Dout order.{" "}
            <strong className="text-foreground">Esc</strong> (focus the 3D panel) or click Walk
            again to stop.
          </p>
        )}
      </Section>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="w-8 shrink-0 px-1 py-1.5 text-center font-medium" aria-label="Select" />
              <th className="px-2 py-1.5 font-medium">Pin</th>
              <th className="w-14 px-1 py-1.5 font-medium">Walk</th>
              <th className="w-11 shrink-0 px-0.5 py-1.5 text-center font-medium" title="Reorder GPIO rows">
                Order
              </th>
              {Array.from({ length: maxCols }, (_, c) => (
                <th key={c} className="px-2 py-1.5 font-medium">
                  {c === 0 ? "Din (in)" : `→ ${c}`}
                </th>
              ))}
              <th className="w-10 shrink-0 border-l border-border/60 px-0.5 py-1.5 text-center font-medium">
                <button
                  type="button"
                  title="Add hop column (all rows)"
                  disabled={readOnly}
                  className={cn(btn, "inline-flex size-7 items-center justify-center p-0")}
                  onClick={(e) => {
                    e.stopPropagation();
                    appendWirePinColumn();
                  }}
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayChains.map((row, ri) => {
              const slot = wiringCheckedRowColorSlot(wiringCheckedPinIndices, ri);
              const accent =
                slot != null
                  ? WIRING_ROW_CHECK_COLORS[slot % WIRING_ROW_CHECK_COLORS.length]
                  : undefined;
              return (
                <McuWiringTableRow
                  key={ri}
                  readOnly={readOnly}
                  rowIndex={ri}
                  row={row}
                  maxCols={maxCols}
                  totalRows={displayChains.length}
                  gpioValue={gpioValueForRow(ri, wirePinGpio)}
                  pinOptions={pinOptions}
                  checked={wiringCheckedPinIndices.includes(ri)}
                  walkActive={wiringWalkPinIndex === ri}
                  assignment={wiringAssignmentTarget}
                  accentColor={accent}
                  onRowBackgroundClick={() => wiringTableRowClick(ri)}
                  onToggleRowCheck={() => wiringTableRowClick(ri)}
                  onGpioChange={(pin) => setWirePinGpioRow(ri, pin)}
                  onWalkToggle={() =>
                    setWiringWalkPin(wiringWalkPinIndex === ri ? null : ri)
                  }
                  onMoveUp={() => moveWirePinRow(ri, ri - 1)}
                  onMoveDown={() => moveWirePinRow(ri, ri + 1)}
                  onToggleAssignmentCell={(ci) => {
                    const active =
                      wiringAssignmentTarget?.pinIndex === ri &&
                      wiringAssignmentTarget?.colIndex === ci;
                    setWiringAssignmentTarget(
                      active ? null : { pinIndex: ri, colIndex: ci },
                    );
                  }}
                  onCellContextMenu={(ci, faceId) => {
                    if (faceId) assignWiringCellFace(ri, ci, "");
                    else if (ci < row.length) removeWireChainCellAndCompact(ri, ci);
                  }}
                  onRemoveCell={(ci) => removeWireChainCellAndCompact(ri, ci)}
                />
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/15 px-2 py-1.5">
          <button
            type="button"
            className={cn(btn, "inline-flex items-center gap-1")}
            disabled={readOnly || wiringCheckedPinIndices.length === 0}
            title="Remove all checked GPIO rows"
            onClick={() => removeWiringCheckedRows()}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete checked rows
          </button>
          <button
            type="button"
            className={cn(btn, "inline-flex items-center gap-1")}
            disabled={readOnly || displayChains.length >= 10}
            title="Adds a new GPIO row, checks it for 3D highlight, and starts Walk on it"
            onClick={() => appendWirePinRow()}
          >
            <Plus className="size-3.5" aria-hidden />
            Add GPIO row
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="rounded-md border border-border bg-card p-2 text-xs">
          <Stat label="GPIO rows (parallel lines)" value={displayChains.length} />
          <Stat label="Used channels (resolved)" value={usedChannels} />
          <Stat label="Wiring" value={wireConfigured ? "custom" : "unset"} />
        </div>
        <button
          type="button"
          className={btn}
          disabled={readOnly}
          onClick={resetWiring}
          title="Remove all GPIO rows and face assignments"
        >
          Clear wiring
        </button>
      </div>
    </div>
  );
}
