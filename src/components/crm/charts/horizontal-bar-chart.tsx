"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./chart-tooltip";

export type BarChartRow = {
  key: string;
  label: string;
  value: number;
  count?: number;
};

/** Themed horizontal bar chart used for value-by-stage comparisons on the
 * Dashboard and Reports. Animation defaults to Recharts' "auto", which
 * already respects prefers-reduced-motion. */
export function HorizontalBarChart({
  data,
  valueFormatter = (v) => String(v),
  color = "var(--chart-1)",
  height,
  tooltipExtra,
}: {
  data: BarChartRow[];
  valueFormatter?: (value: number) => string;
  color?: string;
  height?: number;
  tooltipExtra?: (row: BarChartRow) => string | null;
}) {
  const rowHeight = 36;
  const chartHeight = height ?? Math.max(data.length * rowHeight, 140);

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={
              <ChartTooltip
                valueFormatter={valueFormatter}
                extraLine={
                  tooltipExtra ? (row) => tooltipExtra(row as BarChartRow) : undefined
                }
              />
            }
          />
          <Bar dataKey="value" name="Value" fill={color} radius={[0, 6, 6, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
