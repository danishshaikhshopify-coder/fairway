"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/crm/empty-state";
import {
  BusinessTypeBadge,
  LeadStatusBadge,
  QualificationBadge,
} from "@/components/crm/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { useToday } from "@/lib/use-today";
import { fadeUp, staggerList } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDate, formatFullCurrency, isOverdue } from "@/lib/format";

// One bar component for both the table's compact score and the detail
// panel's larger ones, so fit/lead scores read the same way everywhere.
function ScoreBar({
  score,
  size = "sm",
}: {
  score: number;
  size?: "sm" | "lg";
}) {
  const tone =
    score >= 80
      ? "bg-emerald-500"
      : score >= 60
        ? "bg-primary"
        : score >= 45
          ? "bg-amber-500"
          : "bg-destructive";
  if (size === "lg") {
    return (
      <div className="h-2 overflow-hidden rounded-sm bg-muted">
        <div
          className={cn("h-full origin-left rounded-r-sm transition-transform", tone)}
          style={{ width: "100%", transform: `scaleX(${score / 100})` }}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-sm bg-muted">
        <div
          className={cn("h-full origin-left rounded-r-sm transition-transform", tone)}
          style={{ width: "100%", transform: `scaleX(${score / 100})` }}
        />
      </div>
      <span className="font-mono text-sm tabular-nums">{score}</span>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p className="text-sm leading-6">{children}</p>
    </div>
  );
}

export default function LeadIntelligencePage() {
  const { leads } = useCrm();
  const today = useToday();
  const [selectedId, setSelectedId] = useState<string | null>(leads[0]?.id ?? null);

  const sorted = useMemo(
    () => [...leads].sort((a, b) => b.fitScore - a.fitScore),
    [leads],
  );

  const selected = leads.find((l) => l.id === selectedId) ?? sorted[0] ?? null;

  if (leads.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Lead intelligence" />
        <EmptyState
          title="No leads to analyze"
          description="Add a lead on the Leads page to see intelligence cards here."
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
      <PageHeader title="Lead intelligence" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <motion.div variants={fadeUp} className="min-w-0">
        <Card>
          <CardContent className="overflow-x-auto p-0 sm:p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Fit score</TableHead>
                  <TableHead className="hidden xl:table-cell">
                    Follow-up health
                  </TableHead>
                  <TableHead>Qualification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((lead) => (
                  <TableRow
                    key={lead.id}
                    data-selected={lead.id === selected?.id ? "true" : undefined}
                    onClick={() => setSelectedId(lead.id)}
                    className="cursor-pointer data-[selected=true]:bg-muted/60"
                  >
                    <TableCell>
                      <div className="min-w-36">
                        <button
                          type="button"
                          aria-current={lead.id === selected?.id ? "true" : undefined}
                          className="cursor-pointer text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {lead.company}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {lead.contact} · {lead.owner}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <BusinessTypeBadge type={lead.businessType} />
                    </TableCell>
                    <TableCell>
                      <ScoreBar score={lead.fitScore} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="line-clamp-2 max-w-56 text-xs text-muted-foreground">
                        {lead.followUpEvidence}
                      </span>
                    </TableCell>
                    <TableCell>
                      <QualificationBadge qualification={lead.qualification} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </motion.div>

        {selected ? (
          <motion.div key={selected.id} variants={fadeUp} initial="hidden" animate="show">
          <Card className="h-fit lg:sticky lg:top-20">
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{selected.company}</h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.contact}
                  </p>
                </div>
                <LeadStatusBadge status={selected.status} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <BusinessTypeBadge type={selected.businessType} />
                <QualificationBadge qualification={selected.qualification} />
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Business-fit score</span>
                    <span className="font-mono font-medium tabular-nums">
                      {selected.fitScore}/100
                    </span>
                  </div>
                  <ScoreBar score={selected.fitScore} size="lg" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Lead score</span>
                    <span className="font-mono tabular-nums">{selected.score}/100</span>
                  </div>
                  <ScoreBar score={selected.score} size="lg" />
                </div>
              </div>

              <DetailBlock label="Evidence / source notes">
                {selected.evidence}
              </DetailBlock>

              <DetailBlock label="Follow-up evidence">
                {selected.followUpEvidence}
              </DetailBlock>

              <DetailBlock label="Recommended next action">
                {selected.recommendedAction}
              </DetailBlock>

              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Estimated value</p>
                  <p className="font-medium tabular-nums">
                    {formatFullCurrency(selected.value)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Next follow-up</p>
                  <p
                    className={cn(
                      "font-medium",
                      selected.nextFollowUp &&
                        isOverdue(selected.nextFollowUp, today) &&
                        "text-destructive",
                    )}
                  >
                    {selected.nextFollowUp
                      ? formatDate(selected.nextFollowUp)
                      : "None scheduled"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}
