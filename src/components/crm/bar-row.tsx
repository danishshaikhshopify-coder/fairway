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
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right tabular-nums">{display}</span>
    </div>
  );
}
