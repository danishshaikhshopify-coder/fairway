/** Horizontal metric bar used on the dashboard and reports charts. */
export function BarRow({
  label,
  count,
  value,
  max,
  display,
}: {
  label: string;
  count?: number;
  value: number;
  max: number;
  display: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex w-32 shrink-0 items-baseline gap-1.5">
        <span className="truncate">{label}</span>
        {count !== undefined ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full origin-left rounded-r-sm bg-primary transition-transform"
          style={{ width: "100%", transform: `scaleX(${pct / 100})` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right font-mono tabular-nums">
        {display}
      </span>
    </div>
  );
}
