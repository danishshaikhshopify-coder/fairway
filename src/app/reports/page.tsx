"use client";

import { useMemo } from "react";
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
import { BarRow } from "@/components/crm/bar-row";
import { EmptyState } from "@/components/crm/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { formatCurrency, formatFullCurrency } from "@/lib/format";
import {
  LEAD_SOURCES,
  PIPELINE_LABELS,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/types";

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
    return PIPELINE_STAGES.map((stage) => ({
      stage,
      value: leads
        .filter((l) => l.status === stage)
        .reduce((sum, l) => sum + l.value, 0),
    }));
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

  const maxSourceShare = Math.max(...sources.map((s) => s.share), 1);
  const maxValue = Math.max(...valueByStage.map((r) => r.value), 1);

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
    <div className="space-y-6">
      <PageHeader title="Reports" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
                  <div
                    className="h-full rounded-md bg-primary/80"
                    style={{ width: `${Math.max(row.pctOfTop, 6)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversion rates</CardTitle>
          </CardHeader>
          <CardContent>
            <StatRow
              label="Contacted rate"
              hint="Leads past the new stage"
              value={`${conversion.contactedRate}%`}
            />
            <StatRow
              label="Qualified rate"
              hint="Qualified, proposal or won"
              value={`${conversion.qualifiedRate}%`}
            />
            <StatRow
              label="Win rate"
              hint={`Across ${conversion.closedCount} closed deals`}
              value={`${conversion.winRate}%`}
            />
            <StatRow
              label="Average active deal"
              hint="Open pipeline value per lead"
              value={formatFullCurrency(Math.round(conversion.avgDeal))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sources.map((row) => (
              <BarRow
                key={row.source}
                label={row.source}
                value={row.share}
                max={maxSourceShare}
                display={`${row.share}%`}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline value by stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {valueByStage.map((row) => (
              <BarRow
                key={row.stage}
                label={PIPELINE_LABELS[row.stage]}
                value={row.value}
                max={maxValue}
                display={formatCurrency(row.value)}
              />
            ))}
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}
