

import { useEffect, useMemo, useRef } from "react";
import {
  faceInradius,
  generateBarycentric,
  paddingMmToFraction,
  resolveRowSizes,
  type Bary,
} from "@glowbe/core";
import { useEditorStore, type LedPattern } from "@/chain-editor/stores/editor-store";
import { useEditorReadOnly } from "@/chain-editor/chain-profile-editor-context";
import { Field, Section, Stat, numberInputClass, selectClass } from "@/chain-editor/views/panel-ui";

const TRIANGULAR_COUNTS = [1, 3, 6, 10, 15, 21];
const PATTERNS: LedPattern[] = ["triangular-rows", "zigzag", "parallel-rows"];

/**
 * In-face LED placement editor: a single triangular panel drawn large, LEDs
 * placed evenly per the layout, numbered + connected in chain order (Din→Dout),
 * with padding specified in physical millimeters.
 */
export function FaceLayoutView() {
  const readOnly = useEditorReadOnly();
  const rig = useEditorStore((s) => s.rig);
  const selectedFaceIds = useEditorStore((s) => s.selectedFaceIds);
  const updateLayout = useEditorStore((s) => s.updateLayout);
  const ledPreviewDiameterMm = useEditorStore((s) => s.ledPreviewDiameterMm);
  const setLedPreviewDiameterMm = useEditorStore((s) => s.setLedPreviewDiameterMm);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const layout = rig.faceLayouts[0]!;
  const primaryFaceId =
    selectedFaceIds.length > 0 ? selectedFaceIds[selectedFaceIds.length - 1]! : null;
  const refFace =
    rig.solid.faces.find((f) => f.id === primaryFaceId) ??
    rig.solid.faces.find((f) => !rig.solid.disabledFaceIds.includes(f.id)) ??
    rig.solid.faces[0]!;
  const inradius = faceInradius(refFace.vertices);
  /** Equilateral panel edge length (mm), same as summary “Edge length”. */
  const edgeLengthMm = inradius * 2 * Math.sqrt(3);

  const { bary, genError } = useMemo(() => {
    try {
      const rowSizes = resolveRowSizes(layout.ledCount, layout.rowSizes);
      const frac =
        layout.paddingMm != null
          ? paddingMmToFraction(layout.paddingMm, inradius)
          : (layout.padding ?? 0);
      return {
        bary: generateBarycentric(rowSizes, layout.pattern, frac, {
          mirrorLR: layout.chainMirrorLR,
        }),
        genError: null as string | null,
      };
    } catch (e) {
      return {
        bary: [] as Bary[],
        genError: e instanceof Error ? e.message : String(e),
      };
    }
  }, [
    layout.ledCount,
    layout.rowSizes,
    layout.pattern,
    layout.paddingMm,
    layout.padding,
    layout.chainMirrorLR,
    inradius,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Equilateral triangle, apex up, fit with margin.
      const m = 36;
      const side = Math.min(w - m * 2, (h - m * 2) / (Math.sqrt(3) / 2));
      const cx = w / 2;
      const triH = (side * Math.sqrt(3)) / 2;
      const top = (h - triH) / 2;
      const apex = { x: cx, y: top };
      const left = { x: cx - side / 2, y: top + triH };
      const right = { x: cx + side / 2, y: top + triH };
      // Barycentric basis: a→v0 (base-left), b→v1 (base-right), c→v2 (apex).
      const v0 = left;
      const v1 = right;
      const v2 = apex;
      const toXY = (p: Bary) => ({
        x: p.a * v0.x + p.b * v1.x + p.c * v2.x,
        y: p.a * v0.y + p.b * v1.y + p.c * v2.y,
      });

      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(v0.x, v0.y);
      ctx.lineTo(v1.x, v1.y);
      ctx.lineTo(v2.x, v2.y);
      ctx.closePath();
      ctx.stroke();

      const pts = bary.map(toXY);
      if (pts.length === 0) return;

      // Chain path Din→Dout.
      ctx.strokeStyle = "rgba(120,160,255,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      // LED dot radius (px): match `ledPreviewDiameterMm` to ref face edge in mm (`side` px = edgeLengthMm).
      const pxPerMm = edgeLengthMm > 0 ? side / edgeLengthMm : 1;
      const rFromMm = (ledPreviewDiameterMm / 2) * pxPerMm;
      const r = Math.max(1.5, Math.min(rFromMm, side * 0.18));

      pts.forEach((p, i) => {
        const isDin = i === 0;
        const isDout = i === pts.length - 1;
        ctx.beginPath();
        ctx.fillStyle = isDin ? "#34d399" : isDout ? "#f87171" : "#cbd5e1";
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0b0b0f";
        ctx.font = `${Math.max(6, Math.round(r * 1.1))}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y);
      });

      // Din / Dout labels.
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "#34d399";
      ctx.fillText("Din", pts[0]!.x, pts[0]!.y - r - 6);
      ctx.fillStyle = "#f87171";
      const last = pts[pts.length - 1]!;
      ctx.fillText("Dout", last.x, last.y - r - 6);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bary, ledPreviewDiameterMm, edgeLengthMm]);

  const paddingMm = layout.paddingMm ?? 0;
  const maxPadMm = inradius * 0.9;

  return (
    <div className="flex h-full w-full bg-background">
      <div className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border p-4">
        <Section title="In-face LED layout">
          <Field label="LEDs per face">
            <select
              value={layout.ledCount}
              disabled={readOnly}
              onChange={(e) =>
                updateLayout({ ledCount: parseInt(e.target.value, 10), rowSizes: undefined })
              }
              className={selectClass}
            >
              {TRIANGULAR_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} {n === 15 ? "(15panels 5·4·3·2·1)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chain pattern (from Din)">
            <select
              value={layout.pattern}
              disabled={readOnly}
              onChange={(e) => updateLayout({ pattern: e.target.value as LedPattern })}
              className={selectClass}
            >
              {PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={layout.chainMirrorLR ?? false}
              onChange={(e) => updateLayout({ chainMirrorLR: e.target.checked })}
              className="accent-primary"
            />
            チェーン左右反転（底辺）
          </label>
        </Section>

        <Section title="Preview LED size">
          <Field
            label={`LED dot diameter — ${ledPreviewDiameterMm.toFixed(1)} mm (to scale on ref face edge ${edgeLengthMm.toFixed(1)} mm; sphere R = ${rig.solid.radius.toFixed(0)} mm)`}
          >
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              disabled={readOnly}
              value={ledPreviewDiameterMm}
              onChange={(e) => setLedPreviewDiameterMm(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </Field>
        </Section>

        <Section title="Edge padding">
          <Field label={`Inset from edges — ${paddingMm.toFixed(1)} mm`}>
            <input
              type="range"
              min={0}
              max={Math.max(1, maxPadMm)}
              step={0.5}
              disabled={readOnly}
              value={Math.min(paddingMm, maxPadMm)}
              onChange={(e) => updateLayout({ paddingMm: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
          </Field>
          <Field label="Exact (mm)">
            <input
              type="number"
              min={0}
              step={0.5}
              disabled={readOnly}
              value={paddingMm}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                updateLayout({ paddingMm: Number.isFinite(v) && v >= 0 ? v : 0 });
              }}
              className={numberInputClass}
            />
          </Field>
        </Section>

        <div className="mt-auto rounded-md border border-border bg-card p-3 text-xs">
          <Stat label="Ref face" value={refFace.id} />
          <Stat label="Edge length" value={`${(inradius * 2 * Math.sqrt(3)).toFixed(1)} mm`} />
          <Stat label="Inradius" value={`${inradius.toFixed(1)} mm`} />
          {genError && <div className="mt-2 text-destructive">⚠ {genError}</div>}
        </div>
      </div>

      <div ref={wrapRef} className="relative min-w-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
