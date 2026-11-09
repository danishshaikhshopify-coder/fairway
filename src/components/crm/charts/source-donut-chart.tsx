"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip } from "./chart-tooltip";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export type DonutChartRow = { key: string; label: string; value: number };

/** Share-of-whole donut, used for lead-source breakdown on Reports. */
export function SourceDonutChart({
  data,
  height = 200,
  valueFormatter = (v) => `${v}%`,
}: {
  data: DonutChartRow[];
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div style={{ height, width: height }} className="mx-auto shrink-0 sm:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((row, i) => (
                <Cell key={row.key} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {data.map((row, i) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {valueFormatter(row.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
