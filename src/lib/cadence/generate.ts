// DB-touching half of the cadence engine. Thin on purpose: all the date math
// and eligibility rules live in ./engine.ts (pure, unit-tested); this module
// only loads config, calls into that math, and writes the result.
//
// Used from two places, both server-side with the caller's own RLS-scoped
// client (no service role needed — a workspace member already has normal
// read/write rights on leads/tasks/cadence_steps):
//   - POST /api/tasks/complete — advances ONE lead right after its current
//     step is marked done, so the next task appears immediately.
//   - GET /api/cron/follow-ups — bootstraps step 1 for brand-new leads that
//     have never had a follow-up generated (cadence_step = 0).

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeNextStep, type CadenceStepConfig, type Channel } from "./engine.ts";

export interface LeadCadenceState {
  id: string;
  companyName: string;
  status: string;
  cadencePaused: boolean;
  cadenceStep: number;
  cadenceAnchorDate: string | null;
  lastContact: string | null;
  createdAt: string;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  call: "Call",
};

/** The CRM never sends outreach itself — this is a reminder task only. */
function taskTitle(channel: Channel, companyName: string): string {
  return `${CHANNEL_LABEL[channel]} follow-up — ${companyName}`;
}

export async function loadCadenceSteps(
  db: SupabaseClient,
  workspaceId: string,
): Promise<CadenceStepConfig[]> {
  const { data, error } = await db
    .from("cadence_steps")
    .select("step_number, interval_days, channel")
    .eq("workspace_id", workspaceId)
    .order("step_number", { ascending: true });
  if (error) throw new Error(`loadCadenceSteps: ${error.message}`);
  return (data ?? []).map((r) => ({
    stepNumber: r.step_number as number,
    intervalDays: r.interval_days as number,
    channel: r.channel as Channel,
  }));
}

export interface GeneratedTask {
  id: string;
  title: string;
  dueDate: string;
  priority: string;
  type: string;
  isDone: boolean;
  relatedTo: string;
  cancelledAt: string | null;
}

/**
 * Creates the next cadence task for one lead, if one is due and does not
 * already exist. Returns the created task (API-route shaped), or null when
 * there is nothing to generate: the lead is paused/won/lost, the cadence has
 * no further configured step, or that step was already generated before
 * (the unique index on tasks(lead_id, cadence_step) is the hard backstop for
 * that last case — a 23505 here is treated the same as "already exists").
 */
export async function generateNextFollowUp(
  db: SupabaseClient,
  workspaceId: string,
  lead: LeadCadenceState,
  steps: CadenceStepConfig[],
): Promise<GeneratedTask | null> {
  if (lead.cadencePaused || lead.status === "won" || lead.status === "lost") return null;

  const anchor =
    lead.cadenceStep === 0 ? lead.lastContact || lead.createdAt.slice(0, 10) : lead.cadenceAnchorDate;
  if (!anchor) return null;

  const next = computeNextStep(steps, lead.cadenceStep, anchor);
  if (!next) return null;

  const { data: existing, error: existingError } = await db
    .from("tasks")
    .select("id")
    .eq("lead_id", lead.id)
    .eq("cadence_step", next.stepNumber)
    .maybeSingle();
  if (existingError) throw new Error(`generateNextFollowUp dedupe check: ${existingError.message}`);
  if (existing) return null;

  const { data: task, error: insertError } = await db
    .from("tasks")
    .insert({
      workspace_id: workspaceId,
      title: taskTitle(next.channel, lead.companyName),
      due_date: next.dueDate,
      priority: "medium",
      type: "follow-up",
      related_to: lead.companyName,
      lead_id: lead.id,
      cadence_step: next.stepNumber,
      channel: next.channel,
    })
    .select("id, title, due_date, priority, type, is_done, related_to, cancelled_at")
    .single();
  if (insertError) {
    // 23505 = unique_violation: another request already generated this exact
    // step for this lead between our dedupe check and this insert. That is
    // the dedup working as intended, not a failure.
    if ((insertError as { code?: string }).code === "23505") return null;
    throw new Error(`generateNextFollowUp insert: ${insertError.message}`);
  }

  const { error: updateError } = await db
    .from("leads")
    .update({ cadence_step: next.stepNumber, cadence_anchor_date: next.dueDate })
    .eq("id", lead.id);
  if (updateError) throw new Error(`generateNextFollowUp lead update: ${updateError.message}`);

  return {
    id: task.id as string,
    title: task.title as string,
    dueDate: task.due_date as string,
    priority: task.priority as string,
    type: task.type as string,
    isDone: task.is_done === true,
    relatedTo: task.related_to as string,
    cancelledAt: (task.cancelled_at as string | null) ?? null,
  };
}
