"use client";

import { useMemo, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnimatedNumber } from "@/components/crm/animated-number";
import { HorizontalBarChart } from "@/components/crm/charts/horizontal-bar-chart";
import { SourceDonutChart } from "@/components/crm/charts/source-donut-chart";
import { EmptyState } from "@/components/crm/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { fadeUp, staggerList } from "@/lib/motion";
import { formatCurrency, formatFullCurrency } from "@/lib/format";
import {
  LEAD_SOURCES,
  PIPELINE_LABELS,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/types";

function StatRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0 last:pb-0">
      <div>
        <p className="text-sm">{label}</p>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function ReportsPage() {
  const { leads, owners } = useCrm();

  const funnel = useMemo(() => {
    const counts = PIPELINE_STAGES.map((stage) => ({
      stage,
      count: leads.filter((l) => l.status === stage).length,
    }));
    // Base on the largest stage, not just the entry stage: if "new" is empty
    // (e.g. every lead was moved on), a fixed base of 1 would inflate widths
    // to absurd percentages like 500%.
    const top = Math.max(...counts.map((c) => c.count), 1);
    return counts.map((row, index) => {
      const prev = index > 0 ? counts[index - 1].count : null;
      return {
        ...row,
        pctOfTop: Math.round((row.count / top) * 100),
        stepRate:
          prev !== null && prev > 0
            ? `${Math.round((row.count / prev) * 100)}% from previous stage`
            : "Entry point",
      };
    });
  }, [leads]);

  const sources = useMemo(() => {
    const total = leads.length || 1;
    return LEAD_SOURCES.map((source) => {
      const count = leads.filter((l) => l.source === source).length;
      return { source, count, share: Math.round((count / total) * 100) };
    }).filter((row) => row.count > 0);
  }, [leads]);

  const valueByStage = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => {
      const stageLeads = leads.filter((l) => l.status === stage);
      return {
        stage,
        value: stageLeads.reduce((sum, l) => sum + l.value, 0),
        count: stageLeads.length,
      };
    });
  }, [leads]);

  const conversion = useMemo(() => {
    const total = leads.length || 1;
    const contacted = leads.filter(
      (l) => l.status !== "new",
    ).length;
    const qualifiedLike = leads.filter((l) =>
      ["qualified", "proposal", "won"].includes(l.status),
    ).length;
    const won = leads.filter((l) => l.status === "won").length;
    const lost = leads.filter((l) => l.status === "lost").length;
    const active = leads.filter(
      (l) => !["won", "lost"].includes(l.status),
    );
    const avgDeal = active.length
      ? active.reduce((sum, l) => sum + l.value, 0) / active.length
      : 0;
    return {
      contactedRate: Math.round((contacted / total) * 100),
      qualifiedRate: Math.round((qualifiedLike / total) * 100),
      winRate: Math.round((won / (won + lost || 1)) * 100),
      avgDeal,
      closedCount: won + lost,
    };
  }, [leads]);

  const byOwner = useMemo(() => {
  const ownerList = owners.length
    ? owners
    : [...new Set(leads.map((l) => l.owner).filter(Boolean))];
  return ownerList
    .map((owner) => {
      const own = leads.filter((l) => l.owner === owner);
      return {
        owner,
        leads: own.length,
        activeValue: own
          .filter((l) => !["won", "lost"].includes(l.status))
          .reduce((sum, l) => sum + l.value, 0),
        wonValue: own
          .filter((l) => l.status === "won")
          .reduce((sum, l) => sum + l.value, 0),
        avgScore: own.length
          ? Math.round(own.reduce((sum, l) => sum + l.score, 0) / own.length)
          : 0,
      };
    })
    .filter((row) => row.leads > 0);
  }, [leads, owners]);

  const sourceChartData = useMemo(
    () => sources.map((row) => ({ key: row.source, label: row.source, value: row.share })),
    [sources],
  );

  const stageChartData = useMemo(
    () =>
      valueByStage.map((row) => ({
        key: row.stage,
        label: PIPELINE_LABELS[row.stage],
        value: row.value,
        count: row.count,
      })),
    [valueByStage],
  );

  if (leads.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reports" />
        <EmptyState
          title="No data to report on"
          description="Add leads on the Leads page to populate the reports."
        />
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={staggerList}
      initial="hidden"
      animate="show"
    >
      <PageHeader title="Reports" />

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lead funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {funnel.map((row) => (
                <div key={row.stage} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                    <span className="font-medium">
                      {PIPELINE_LABELS[row.stage as PipelineStage]}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.count} lead{row.count === 1 ? "" : "s"} · {row.pctOfTop}% ·{" "}
                      {row.stepRate}
                    </span>
                  </div>
                  <div className="h-7 overflow-hidden rounded-md bg-muted">
                    <motion.div
                      className="h-full origin-left rounded-md bg-primary/80"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: Math.max(row.pctOfTop, 6) / 100 }}
                      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Conversion rates</CardTitle>
            </CardHeader>
            <CardContent>
              <StatRow
                label="Contacted rate"
                hint="Leads past the new stage"
                value={<AnimatedNumber value={conversion.contactedRate} format={(v) => `${Math.round(v)}%`} />}
              />
              <StatRow
                label="Qualified rate"
                hint="Qualified, proposal or won"
                value={<AnimatedNumber value={conversion.qualifiedRate} format={(v) => `${Math.round(v)}%`} />}
              />
              <StatRow
                label="Win rate"
                hint={`Across ${conversion.closedCount} closed deals`}
                value={<AnimatedNumber value={conversion.winRate} format={(v) => `${Math.round(v)}%`} />}
              />
              <StatRow
                label="Average active deal"
                hint="Open pipeline value per lead"
                value={
                  <AnimatedNumber
                    value={conversion.avgDeal}
                    format={(v) => formatFullCurrency(Math.round(v))}
                  />
                }
              />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Lead sources</CardTitle>
            </CardHeader>
            <CardContent>
              <SourceDonutChart data={sourceChartData} />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Pipeline value by stage</CardTitle>
            </CardHeader>
            <CardContent>
              <HorizontalBarChart
                data={stageChartData}
                valueFormatter={formatCurrency}
                tooltipExtra={(row) =>
                  `${row.count} lead${row.count === 1 ? "" : "s"}`
                }
              />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={fadeUp}>
      <Card>
        <CardHeader>
          <CardTitle>Rep performance</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Active value</TableHead>
                <TableHead className="text-right">Won value</TableHead>
                <TableHead className="text-right">Avg score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byOwner.map((row) => (
                <TableRow key={row.owner}>
                  <TableCell className="font-medium">{row.owner}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.leads}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatFullCurrency(row.activeValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatFullCurrency(row.wonValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.avgScore}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  );
}
