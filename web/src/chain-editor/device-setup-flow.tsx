

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChainProfileEditor } from "@/chain-editor/chain-profile-editor-context";
import { useEditorStore } from "@/chain-editor/stores/editor-store";
import { panelButtonClass } from "./views/panel-ui";
import { SolidView } from "./views/solid-view";
import { FaceLayoutView } from "./views/face-layout-view";
import { Wiring3dView } from "./views/wiring-3d-view";
import { DeviceOrientationView } from "./views/device-orientation-view";
import { SaveFirmwareStep } from "./views/save-firmware-step";

const DEVICE_STEPS = [
  {
    id: "solid",
    title: "Solid & panels",
    caption: "Polyhedron preset, enabled faces, and sphere size.",
  },
  {
    id: "face-layout",
    title: "In-face LEDs",
    caption: "LED count, chain pattern, and in-face padding.",
  },
  {
    id: "wiring",
    title: "Face-to-face chain",
    caption: "GPIO lines and visit order between panels.",
  },
  {
    id: "orientation",
    title: "Face attachment",
    caption: "120° rotation and strip direction per face.",
  },
  {
    id: "save",
    title: "Save & firmware",
    caption: "Save the profile and flash firmware with the generated header.",
  },
] as const;

type StepId = (typeof DEVICE_STEPS)[number]["id"];

function renderStep(id: StepId) {
  switch (id) {
    case "solid":
      return <SolidView />;
    case "face-layout":
      return <FaceLayoutView />;
    case "wiring":
      return <Wiring3dView />;
    case "orientation":
      return <DeviceOrientationView />;
    case "save":
      return <SaveFirmwareStep />;
    default:
      return null;
  }
}

export function DeviceSetupFlow() {
  const editor = useChainProfileEditor();
  const setDockApi = useEditorStore((s) => s.setDockApi);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setDockApi(null);
  }, [setDockApi]);

  const max = DEVICE_STEPS.length - 1;
  const safeStep = Math.min(Math.max(0, step), max);
  const stepMeta = DEVICE_STEPS[safeStep]!;

  const body = useMemo(() => renderStep(stepMeta.id), [stepMeta.id]);
  const showPresetBanner = editor?.isPresetLocked && stepMeta.id !== "save";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {showPresetBanner ? (
        <p className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-950 dark:text-amber-50 sm:px-4">
          Preset template selected — settings are read-only. Duplicate on step 1 or go to step 5
          after creating a custom copy.
        </p>
      ) : null}
      <nav
        className="shrink-0 border-b border-border bg-card/90 px-3 py-2 sm:px-4"
        aria-label="Device workspace"
      >
        <ol className="flex flex-wrap items-center gap-1 sm:gap-2">
          {DEVICE_STEPS.map((s, i) => {
            const active = i === safeStep;
            const done = i < safeStep;
            return (
              <li key={s.id} className="flex items-center gap-1 sm:gap-2">
                {i > 0 ? (
                  <span className="hidden text-muted-foreground sm:inline" aria-hidden>
                    →
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-left text-[11px] transition-colors sm:px-2.5 sm:py-1.5 sm:text-xs",
                    active
                      ? "border-primary bg-primary/15 font-medium text-foreground"
                      : done
                        ? "border-border bg-secondary/60 text-foreground hover:bg-accent/50"
                        : "border-transparent bg-muted/30 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span className="tabular-nums text-muted-foreground">{i + 1}. </span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex min-h-0 shrink-0 items-start justify-between gap-3 border-b border-border bg-card/50 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Chain profile
          </p>
          <h2 className="text-sm font-semibold text-foreground">{stepMeta.title}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
            {stepMeta.caption}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={panelButtonClass}
            disabled={safeStep <= 0}
            onClick={() => setStep((x) => Math.max(0, x - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
            Back
          </button>
          <button
            type="button"
            className={panelButtonClass}
            disabled={safeStep >= max}
            onClick={() => setStep((x) => Math.min(max, x + 1))}
          >
            Next
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
