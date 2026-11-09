"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/crm/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { useToday } from "@/lib/use-today";
import { fadeUp, staggerList } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatDate, formatFullCurrency, isOverdue } from "@/lib/format";
import {
  PIPELINE_LABELS,
  PIPELINE_STAGES,
  type Lead,
  type PipelineStage,
} from "@/lib/types";

function LeadMenu({
  lead,
  onMove,
  onView,
}: {
  lead: Lead;
  onMove: (stage: PipelineStage) => void;
  onView: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${lead.company}`}
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onView}>View details</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PIPELINE_STAGES.map((target) => (
          <DropdownMenuItem
            key={target}
            disabled={target === lead.status}
            onClick={() => onMove(target)}
          >
            {PIPELINE_LABELS[target]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeadCardBody({
  lead,
  overdue,
  onMove,
  onView,
}: {
  lead: Lead;
  overdue: boolean;
  onMove: (stage: PipelineStage) => void;
  onView: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{lead.company}</p>
          <p className="truncate text-xs text-muted-foreground">{lead.contact}</p>
        </div>
        <LeadMenu lead={lead} onMove={onMove} onView={onView} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {formatFullCurrency(lead.value)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          Score {lead.score}
        </span>
      </div>
      {lead.nextFollowUp ? (
        <div
          className={cn(
            "mt-2 border-t border-border pt-2 text-right text-xs",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {overdue ? "Overdue " : "Follow-up "}
          {formatDate(lead.nextFollowUp)}
        </div>
      ) : null}
    </>
  );
}

export default function PipelinePage() {
  const { leads, moveLead } = useCrm();
  const router = useRouter();
  const today = useToday();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);
  const [mobileStage, setMobileStage] = useState<PipelineStage>("new");

  // Lost leads leave the board. `draggingId` can only reference a rendered
  // (non-lost) card, so no extra allowance is needed while dragging.
  const boardLeads = leads.filter((l) => l.status !== "lost");

  function dropLead(id: string, stage: PipelineStage) {
    const lead = leads.find((l) => l.id === id);
    setDraggingId(null);
    setOverStage(null);
    if (!lead || lead.status === stage) return;
    moveLead(id, stage);
    toast.success(`${lead.company} moved to ${PIPELINE_LABELS[stage]}.`);
  }

  const mobileStageLeads = boardLeads.filter((l) => l.status === mobileStage);
  const mobileStageValue = mobileStageLeads.reduce((sum, l) => sum + l.value, 0);

  return (
    <motion.div
      className="space-y-4 sm:space-y-6"
      variants={staggerList}
      initial="hidden"
      animate="show"
    >
      <PageHeader title="Pipeline" />

      {boardLeads.length === 0 ? (
        <EmptyState
          title="No deals on the board"
          description="Add a lead on the Leads page to populate the pipeline."
        />
      ) : (
        <>
          {/* Mobile: one stage at a time, selected via chips */}
          <div className="md:hidden">
            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
              role="group"
              aria-label="Choose a pipeline stage"
            >
              {PIPELINE_STAGES.map((stage) => {
                const count = boardLeads.filter((l) => l.status === stage).length;
                const active = stage === mobileStage;
                return (
                  <button
                    key={stage}
                    type="button"
                    aria-pressed={active}
                    onClick={(e) => {
                      setMobileStage(stage);
                      e.currentTarget.scrollIntoView({
                        block: "nearest",
                        inline: "center",
                      });
                    }}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {PIPELINE_LABELS[stage]}
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-xs tabular-nums",
                        active
                          ? "bg-primary-foreground/20"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="font-semibold">
                {PIPELINE_LABELS[mobileStage]}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatFullCurrency(mobileStageValue)}
              </span>
            </div>

            <motion.div
              key={mobileStage}
              className="mt-3 space-y-2.5"
              variants={staggerList}
              initial="hidden"
              animate="show"
            >
              {mobileStageLeads.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  No leads in this stage yet. Move a lead here with its ⋯ menu.
                </div>
              ) : (
                mobileStageLeads.map((lead) => (
                  <motion.div
                    key={lead.id}
                    variants={fadeUp}
                    className="rounded-xl border border-border bg-card p-3.5 shadow-xs"
                  >
                    <LeadCardBody
                      lead={lead}
                      overdue={lead.status !== "won" && isOverdue(lead.nextFollowUp, today)}
                      onMove={(stage) => dropLead(lead.id, stage)}
                      onView={() => router.push(`/leads?lead=${lead.id}`)}
                    />
                  </motion.div>
                ))
              )}
            </motion.div>
          </div>

          {/* Desktop: kanban board */}
          <motion.div
            className="hidden gap-4 overflow-x-auto pb-2 md:flex"
            variants={staggerList}
          >
            {PIPELINE_STAGES.map((stage) => {
              const stageLeads = boardLeads.filter((l) => l.status === stage);
              const total = stageLeads.reduce((sum, l) => sum + l.value, 0);
              return (
                <motion.section
                  key={stage}
                  variants={fadeUp}
                  aria-label={`${PIPELINE_LABELS[stage]} stage`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overStage !== stage) setOverStage(stage);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setOverStage((s) => (s === stage ? null : s));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || draggingId;
                    if (id) dropLead(id, stage);
                  }}
                  className={cn(
                    "flex w-72 min-w-0 shrink-0 flex-col rounded-xl border bg-muted/30 p-2 transition-all lg:w-auto lg:flex-1",
                    overStage === stage && "border-primary bg-primary/5 ring-2 ring-primary/20",
                  )}
                >
                  <header className="flex items-center justify-between gap-2 px-1 pb-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">
                        {PIPELINE_LABELS[stage]}
                      </h2>
                      <span className="rounded-full bg-background px-1.5 py-px text-xs tabular-nums text-muted-foreground ring-1 ring-border">
                        {stageLeads.length}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatFullCurrency(total)}
                    </span>
                  </header>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {stageLeads.length === 0 ? (
                      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                        Drop leads here
                      </p>
                    ) : (
                      stageLeads.map((lead) => {
                        const overdue =
                          lead.status !== "won" && isOverdue(lead.nextFollowUp, today);
                        return (
                          <article
                            key={lead.id}
                            draggable
                            onDragStart={(e) => {
                              setDraggingId(lead.id);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", lead.id);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setOverStage(null);
                            }}
                            className={cn(
                              "cursor-grab rounded-lg border border-border bg-card p-3 shadow-xs transition-all active:cursor-grabbing",
                              draggingId === lead.id &&
                                "scale-[1.03] opacity-90 shadow-lg ring-2 ring-primary/40",
                            )}
                          >
                            <LeadCardBody
                              lead={lead}
                              overdue={overdue}
                              onMove={(target) => dropLead(lead.id, target)}
                              onView={() => router.push(`/leads?lead=${lead.id}`)}
                            />
                          </article>
                        );
                      })
                    )}
                  </div>
                </motion.section>
              );
            })}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
