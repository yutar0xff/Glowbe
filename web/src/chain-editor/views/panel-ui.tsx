

import type { ReactNode } from "react";

export const selectClass =
  "w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary";

export const numberInputClass =
  "w-full rounded-md border border-border bg-secondary px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary";

export const panelButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40";

export const panelTabClass =
  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors border";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-2 text-xs ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
    </label>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
