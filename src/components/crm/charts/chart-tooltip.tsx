type TooltipPayloadEntry = {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

/** Shared Recharts tooltip content — a small floating glass surface, matching
 * the same transient-popover treatment as dropdowns and the command palette. */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter = (v: number) => String(v),
  extraLine,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  valueFormatter?: (value: number) => string;
  extraLine?: (row: Record<string, unknown>) => string | null;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const extra = extraLine && row ? extraLine(row) : null;

  return (
    <div className="glass-panel min-w-32 rounded-lg border px-3 py-2 text-xs shadow-lg">
      {label != null ? <p className="font-medium">{label}</p> : null}
      {extra ? <p className="text-muted-foreground">{extra}</p> : null}
      <div className="mt-1 space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            {entry.color ? (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
            ) : null}
            {entry.name && entry.name !== label ? (
              <span className="text-muted-foreground">{entry.name}</span>
            ) : null}
            <span className="ml-auto font-mono tabular-nums">
              {valueFormatter(Number(entry.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
