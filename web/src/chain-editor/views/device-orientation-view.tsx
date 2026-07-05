

import { X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LedPattern } from "@glowbe/core";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/chain-editor/stores/editor-store";
import { useEditorReadOnly } from "@/chain-editor/chain-profile-editor-context";
import {
  formatFaceChainCell,
  maxDisplayWireColumns,
} from "@/chain-editor/wiring-table-utils";
import {
  wiringRowColoredFaceMap,
  WIRING_ROW_CHECK_COLORS,
  wiringCheckedRowColorSlot,
} from "@/chain-editor/wiring-helpers";
import { attachmentFacePointerDown } from "@/chain-editor/attachment-face-pointer";
import { Section } from "@/chain-editor/views/panel-ui";
import { AttachmentFaceStrip3d } from "@/chain-editor/r3f/attachment-face-strip-3d";
import { SolidOutline } from "@/chain-editor/r3f/solid-outline";
import { FacePickMeshes } from "@/chain-editor/r3f/face-pick-meshes";
import { rigVertexNorm } from "@/chain-editor/r3f/rig-norm";
import { StudioRigCanvas } from "@/chain-editor/r3f/studio-rig-canvas";

/** Face Attachment 3D: 面内ストリップの接続線は一色で表示する。 */
const ATTACHMENT_STRIP_LINE_COLOR = "#7dd3fc";

function patternLabelJa(pattern: LedPattern | undefined): string {
  switch (pattern) {
    case "zigzag":
      return "ジグザグ（奇数行が反転する蛇行）";
    case "parallel-rows":
      return "パラレル（各行が同じ向き）";
    case "triangular-rows":
      return "三角行格子";
    default:
      return pattern ?? "—";
  }
}

/**
 * Per-face attachment: 120° rotation only, in a chain-shaped table (read-only
 * face ids) + 3D strip preview for **all** resolved strips. 3D pick syncs table cell selection.
 */
export function DeviceOrientationView() {
  const readOnly = useEditorReadOnly();
  const camQuatRef = useRef(new THREE.Quaternion());
  const rig = useEditorStore((s) => s.rig);
  const leds = useEditorStore((s) => s.leds);
  const layoutRevision = useEditorStore((s) => s.layoutRevision);
  const wirePinChains = useEditorStore((s) => s.wirePinChains);
  const wireFaceRotations = useEditorStore((s) => s.wireFaceRotations);
  const wiringCheckedPinIndices = useEditorStore((s) => s.wiringCheckedPinIndices);
  const cycleWireFaceRotation = useEditorStore((s) => s.cycleWireFaceRotation);
  const wiringTableRowClick = useEditorStore((s) => s.wiringTableRowClick);
  const showViewerAxes = useEditorStore((s) => s.showViewerAxes);
  const attachmentPreviewCell = useEditorStore((s) => s.attachmentPreviewCell);
  const setAttachmentPreviewCell = useEditorStore((s) => s.setAttachmentPreviewCell);
  const setHighlightedFace = useEditorStore((s) => s.setHighlightedFace);
  const removeWireChainCellAndCompact = useEditorStore((s) => s.removeWireChainCellAndCompact);

  const maxCols = useMemo(() => maxDisplayWireColumns(wirePinChains), [wirePinChains]);

  const previewFaceId =
    attachmentPreviewCell != null
      ? (wirePinChains[attachmentPreviewCell.ri]?.[attachmentPreviewCell.ci] ?? "")
      : "";

  const stripPattern = rig.faceLayouts[0]?.pattern;

  useEffect(() => {
    if (attachmentPreviewCell == null) return;
    const id = wirePinChains[attachmentPreviewCell.ri]?.[attachmentPreviewCell.ci] ?? "";
    if (!id) setAttachmentPreviewCell(null);
  }, [wirePinChains, attachmentPreviewCell, setAttachmentPreviewCell]);

  const stripPairs = useMemo(() => {
    const m = new Map<string, { faceId: string; channel: number }>();
    for (const l of leds) {
      const k = `${l.faceId}\0${l.address.channel}`;
      if (!m.has(k)) m.set(k, { faceId: l.faceId, channel: l.address.channel });
    }
    return [...m.values()].sort(
      (a, b) => a.faceId.localeCompare(b.faceId) || a.channel - b.channel,
    );
  }, [leds]);

  const norm = useMemo(() => rigVertexNorm(rig), [rig]);
  const pickFaces = useMemo(
    () => rig.solid.faces.filter((f) => !rig.solid.disabledFaceIds.includes(f.id)),
    [rig],
  );

  const coloredOutline = useMemo(() => {
    const map = new Map<string, string>();
    const fromChecks = wiringRowColoredFaceMap(wiringCheckedPinIndices, wirePinChains);
    if (fromChecks) {
      for (const [id, c] of fromChecks) map.set(id, c);
    }
    if (previewFaceId && !map.has(previewFaceId)) {
      map.set(previewFaceId, "#fbbf24");
    }
    return map.size > 0 ? map : null;
  }, [wiringCheckedPinIndices, wirePinChains, previewFaceId]);

  const hoverFaceId = useEditorStore((s) => s.highlightedFaceId);

  return (
    <div className="flex h-full min-h-0 w-full bg-background">
      <div className="flex w-[min(520px,46vw)] shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="shrink-0 p-3 pb-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Table matches <strong className="text-foreground">Face-to-face</strong> GPIO rows
            (read-only). Use the left checkbox (or click the row) to highlight that line on the
            solid. Hover a <strong className="text-foreground">filled cell</strong> to outline that
            face. Click a filled cell to cycle corner rotation (0° → 120° → 240°). The 3D panel
            shows{" "}
            <strong className="text-foreground">every strip</strong> (all resolved face/channel
            LEDs); the amber cell is the table focus. Click a face in 3D to jump the table to that
            cell when it appears in the wiring table.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {wirePinChains.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-[11px] text-muted-foreground">
              No MCU rows yet. Add rows and assign faces in the{" "}
              <strong className="text-foreground">Wiring</strong> view first.
            </p>
          ) : (
            <Section title="Faces by GPIO row (orientation only)">
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[280px] border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="w-8 shrink-0 px-1 py-1.5 text-center font-medium" aria-label="Select row" />
                      <th className="w-10 px-1 py-1.5 text-center font-medium">#</th>
                      {Array.from({ length: maxCols }, (_, c) => (
                        <th key={c} className="px-1 py-1.5 font-medium">
                          {c === 0 ? "Din" : `→${c}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wirePinChains.map((row, ri) => {
                      const slot = wiringCheckedRowColorSlot(wiringCheckedPinIndices, ri);
                      const accent =
                        slot != null
                          ? WIRING_ROW_CHECK_COLORS[slot % WIRING_ROW_CHECK_COLORS.length]
                          : undefined;
                      return (
                        <tr
                          key={ri}
                          className="cursor-pointer border-b border-border/80 last:border-0"
                          style={
                            accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined
                          }
                          onClick={(e) => {
                            if (
                              (e.target as HTMLElement).closest(
                                "button, input, label, select, option, a",
                              )
                            ) {
                              return;
                            }
                            wiringTableRowClick(ri);
                          }}
                        >
                          <td className="px-1 py-1 text-center align-middle">
                            <input
                              type="checkbox"
                              readOnly
                              checked={wiringCheckedPinIndices.includes(ri)}
                              className="size-3.5 cursor-pointer accent-primary"
                              aria-label={`Select GPIO row ${ri + 1}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                wiringTableRowClick(ri);
                              }}
                            />
                          </td>
                          <td className="px-1 py-1 text-center text-muted-foreground align-middle">
                            {ri + 1}
                          </td>
                          {Array.from({ length: maxCols }, (_, ci) => {
                            const faceId = row[ci] ?? "";
                            const active =
                              attachmentPreviewCell?.ri === ri &&
                              attachmentPreviewCell?.ci === ci &&
                              Boolean(faceId);
                            const rot = wireFaceRotations[faceId] ?? 0;
                            return (
                              <td key={ci} className="group/cell p-0.5 align-top">
                                {faceId ? (
                                  <div
                                    className={cn(
                                      "flex min-h-[3.25rem] flex-col gap-0.5 rounded border px-1 py-0.5 transition-colors",
                                      readOnly ? "cursor-default" : "cursor-pointer",
                                      active
                                        ? "border-amber-500/80 bg-amber-500/10"
                                        : "border-border bg-card hover:bg-accent/30",
                                    )}
                                    onMouseEnter={() => setHighlightedFace(faceId)}
                                    onMouseLeave={() => setHighlightedFace(null)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (readOnly) {
                                        setAttachmentPreviewCell({ ri, ci });
                                        return;
                                      }
                                      cycleWireFaceRotation(faceId);
                                      setAttachmentPreviewCell({ ri, ci });
                                    }}
                                  >
                                    <span className="font-mono text-[10px] text-foreground">
                                      {formatFaceChainCell(faceId)}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {rot === 0 ? "0°" : rot === 1 ? "120°" : "240°"}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="group/cell relative min-h-[2rem] rounded border border-transparent bg-transparent px-1 py-0.5 pr-5 text-[10px] text-muted-foreground/40">
                                    —
                                    {ci < row.length ? (
                                      <button
                                        type="button"
                                        disabled={readOnly}
                                        title="空き列を削除して右側の面を詰める"
                                        className="absolute right-0 top-0.5 z-[1] flex size-5 items-center justify-center rounded-sm border border-border/80 bg-card/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover/cell:opacity-100"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeWireChainCellAndCompact(ri, ci);
                                        }}
                                      >
                                        <X className="size-3" aria-hidden />
                                      </button>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">
        <StudioRigCanvas
          camQuatRef={camQuatRef}
          className="absolute inset-0 h-full w-full"
          camera={{ position: [0, 0, 2.6], fov: 50 }}
          showAxes={showViewerAxes}
          trackballMinDistance={1.2}
          trackballMaxDistance={8}
          onPointerMissed={() => setAttachmentPreviewCell(null)}
        >
          <group scale={[1 / norm, 1 / norm, 1 / norm]}>
            {stripPairs.map((p) => {
              const rot = wireFaceRotations[p.faceId] ?? 0;
              const stripRenderKey = `${layoutRevision}-${p.faceId}-${p.channel}-${rot}`;
              return (
                <AttachmentFaceStrip3d
                  key={stripRenderKey}
                  rig={rig}
                  faceId={p.faceId}
                  channel={p.channel}
                  leds={leds}
                  stripPattern={stripPattern}
                  lineColor={ATTACHMENT_STRIP_LINE_COLOR}
                  stripRenderKey={stripRenderKey}
                />
              );
            })}
            <SolidOutline
              key={layoutRevision}
              rig={rig}
              coloredHighlights={coloredOutline ?? undefined}
              highlightFaceId={hoverFaceId}
            />
            <FacePickMeshes
              faces={pickFaces}
              pickEnabled={!readOnly}
              onFacePointerDown={attachmentFacePointerDown}
              onFacePointerOver={(id) => setHighlightedFace(id)}
              onFacePointerOut={() => setHighlightedFace(null)}
            />
          </group>
        </StudioRigCanvas>
        {previewFaceId ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <p className="rounded-md bg-background/85 px-2 py-1 text-[10px] text-muted-foreground">
              面内配線: <span className="text-foreground">{patternLabelJa(stripPattern)}</span>
              {" · "}
              <span className="font-mono text-foreground/90">{formatFaceChainCell(previewFaceId)}</span>
            </p>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <p className="rounded-md bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
              表でセルを選ぶか、配線表にある面を 3D でクリック
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
