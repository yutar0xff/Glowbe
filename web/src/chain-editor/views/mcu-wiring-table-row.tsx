

import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  formatFaceChainCell,
  MCU_TABLE_BTN_CLASS,
} from "@/chain-editor/wiring-table-utils";
import { cn } from "@/lib/utils";
import { selectClass } from "@/chain-editor/views/panel-ui";

export type McuWiringTableRowProps = {
  readOnly?: boolean;
  rowIndex: number;
  row: string[];
  maxCols: number;
  totalRows: number;
  gpioValue: number;
  pinOptions: readonly number[];
  checked: boolean;
  walkActive: boolean;
  assignment: { pinIndex: number; colIndex: number } | null;
  accentColor?: string;
  onRowBackgroundClick: () => void;
  onToggleRowCheck: () => void;
  onGpioChange: (pin: number) => void;
  onWalkToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleAssignmentCell: (colIndex: number) => void;
  onCellContextMenu: (colIndex: number, faceId: string) => void;
  onRemoveCell: (colIndex: number) => void;
};

export function McuWiringTableRow({
  readOnly = false,
  rowIndex: ri,
  row,
  maxCols,
  totalRows,
  gpioValue,
  pinOptions,
  checked,
  walkActive,
  assignment,
  accentColor,
  onRowBackgroundClick,
  onToggleRowCheck,
  onGpioChange,
  onWalkToggle,
  onMoveUp,
  onMoveDown,
  onToggleAssignmentCell,
  onCellContextMenu,
  onRemoveCell,
}: McuWiringTableRowProps) {
  const btn = MCU_TABLE_BTN_CLASS;

  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-border/80 last:border-0 transition-colors",
      )}
      style={
        accentColor ? { boxShadow: `inset 3px 0 0 0 ${accentColor}` } : undefined
      }
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, select, option, input, label")) {
          return;
        }
        onRowBackgroundClick();
      }}
    >
      <td className="px-1 py-1 align-middle text-center">
        <input
          type="checkbox"
          readOnly
          checked={checked}
          className="size-3.5 cursor-pointer accent-primary"
          aria-label={`Select GPIO row ${ri + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRowCheck();
          }}
        />
      </td>
      <td className="px-1 py-1 align-middle">
        <select
          value={gpioValue}
          disabled={readOnly}
          onChange={(e) => onGpioChange(parseInt(e.target.value, 10))}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(selectClass, "max-w-[5.5rem] text-[10px]")}
        >
          {pinOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td className="px-0.5 py-1 align-middle text-center">
        <button
          type="button"
          disabled={readOnly}
          className={cn(
            btn,
            "px-1.5 py-0.5 text-[10px]",
            walkActive && "border-amber-500/80 bg-amber-500/20 text-amber-100",
          )}
          title="Append each plain 3D face click to this row (Din→Dout)"
          onClick={(e) => {
            e.stopPropagation();
            onWalkToggle();
          }}
        >
          {walkActive ? "On" : "Walk"}
        </button>
      </td>
      <td className="px-0.5 py-1 align-middle" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            disabled={readOnly || ri === 0}
            title="Move row up"
            className={cn(btn, "flex size-6 items-center justify-center p-0")}
            onClick={onMoveUp}
          >
            <ChevronUp className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            disabled={readOnly || ri >= totalRows - 1}
            title="Move row down"
            className={cn(btn, "flex size-6 items-center justify-center p-0")}
            onClick={onMoveDown}
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </div>
      </td>
      {Array.from({ length: maxCols }, (_, ci) => {
        const faceId = row[ci] ?? "";
        const active =
          assignment?.pinIndex === ri && assignment?.colIndex === ci;
        return (
          <td key={ci} className="group/cell relative px-1 py-1 align-middle">
            <button
              type="button"
              disabled={readOnly}
              className={cn(
                "w-full min-w-[4.5rem] rounded border px-1 py-0.5 pr-5 font-mono text-[10px] transition-colors",
                active
                  ? "border-amber-500 bg-amber-500/15 text-amber-100"
                  : "border-border bg-card hover:bg-accent/40",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onToggleAssignmentCell(ci);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onCellContextMenu(ci, faceId);
              }}
            >
              {formatFaceChainCell(faceId)}
            </button>
            {(faceId || ci < row.length) && (
              <button
                type="button"
                disabled={readOnly}
                title={
                  faceId
                    ? "Remove face and shift later hops left"
                    : "Remove empty slot and shift later hops left"
                }
                className="absolute right-0.5 top-0.5 z-[1] flex size-5 items-center justify-center rounded-sm border border-border/80 bg-card/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover/cell:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveCell(ci);
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </td>
        );
      })}
      <td className="border-l border-border/60 bg-muted/20" aria-hidden />
    </tr>
  );
}
