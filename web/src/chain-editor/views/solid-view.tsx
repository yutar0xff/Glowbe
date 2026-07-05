

import { useState } from "react";
import { edgeLengthForRadius } from "@glowbe/core";
import { useEditorStore, type SolidPreset } from "@/chain-editor/stores/editor-store";
import { useEditorReadOnly } from "@/chain-editor/chain-profile-editor-context";
import {
  EDITOR_SOLID_PRESET_LABELS,
  EDITOR_SOLID_PRESETS,
} from "@/chain-editor/editor-solid-presets";
import { ProfileSolidPanel } from "@/chain-editor/views/profile-solid-panel";
import { Field, Section, Stat, numberInputClass, selectClass } from "@/chain-editor/views/panel-ui";

function SolidSizeSection({
  preset,
  radius,
  setRadius,
  setEdgeLength,
  readOnly,
}: {
  preset: SolidPreset;
  radius: number;
  setRadius: (mm: number) => void;
  setEdgeLength: (mm: number) => void;
  readOnly: boolean;
}) {
  const edge = edgeLengthForRadius(preset, radius);
  const [radiusText, setRadiusText] = useState(radius.toFixed(1));
  const [edgeText, setEdgeText] = useState(edge.toFixed(1));

  return (
    <Section title="Size">
      <Field label="Sphere radius (mm)">
        <input
          type="number"
          min={1}
          step={1}
          disabled={readOnly}
          value={radiusText}
          onChange={(e) => setRadiusText(e.target.value)}
          onBlur={() => {
            const v = parseFloat(radiusText);
            if (Number.isFinite(v) && v > 0) setRadius(v);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={numberInputClass}
        />
      </Field>
      <Field label="Mean face edge length (mm)">
        <input
          type="number"
          min={1}
          step={1}
          disabled={readOnly}
          value={edgeText}
          onChange={(e) => setEdgeText(e.target.value)}
          onBlur={() => {
            const v = parseFloat(edgeText);
            if (Number.isFinite(v) && v > 0) setEdgeLength(v);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={numberInputClass}
        />
      </Field>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Radius and edge length are linked: editing one updates the other and rescales the
        whole device. Face padding stays fixed in mm.
      </p>
    </Section>
  );
}

/** Device body: solid preset and physical size (radius ↔ mean edge length). */
export function SolidView() {
  const readOnly = useEditorReadOnly();
  const rig = useEditorStore((s) => s.rig);
  const leds = useEditorStore((s) => s.leds);
  const error = useEditorStore((s) => s.error);
  const setSolidPreset = useEditorStore((s) => s.setSolidPreset);
  const setRadius = useEditorStore((s) => s.setRadius);
  const setEdgeLength = useEditorStore((s) => s.setEdgeLength);

  const preset = rig.solid.preset;
  const radius = rig.solid.radius;
  const activeFaces = rig.solid.faces.filter(
    (f) => !rig.solid.disabledFaceIds.includes(f.id),
  ).length;

  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-y-auto bg-background p-4">
      <Section title="Solid">
        <ProfileSolidPanel />
        <Field label="Solid shape">
          <select
            value={preset}
            disabled={readOnly}
            onChange={(e) => setSolidPreset(e.target.value as SolidPreset)}
            className={selectClass}
          >
            {EDITOR_SOLID_PRESETS.map((p) => (
              <option key={p} value={p}>
                {EDITOR_SOLID_PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <SolidSizeSection
        key={`${preset}-${radius}`}
        preset={preset}
        radius={radius}
        setRadius={setRadius}
        setEdgeLength={setEdgeLength}
        readOnly={readOnly}
      />

      <div className="mt-auto rounded-md border border-border bg-card p-3 text-xs">
        <Stat label="Active faces" value={activeFaces} />
        <Stat label="Total LEDs" value={leds.length} />
        {error && <div className="mt-2 text-destructive">⚠ {error}</div>}
      </div>
    </div>
  );
}
