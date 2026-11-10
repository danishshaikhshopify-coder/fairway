// Marks a task done and, if it was a follow-up cadence step, immediately
// generates the lead's next step (requirement: "completing a follow-up
// should schedule the next eligible step"). Uses the caller's own
// RLS-scoped client throughout — a workspace member already has full
// read/write rights on tasks/leads/cadence_steps, so no service role is
// needed here, unlike the Gmail/Team routes.

import { badRequest, readJson, requireActor, serverError } from "@/lib/api/auth";
import { TASK_COLUMNS } from "@/lib/supabase/repository";
import { generateNextFollowUp, loadCadenceSteps } from "@/lib/cadence/generate";

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId } = result.actor;

  const body = await readJson<{ id?: string }>(request);
  const id = body?.id;
  if (typeof id !== "string" || !id) return badRequest("id is required.");

  const { data: before, error: beforeError } = await db
    .from("tasks")
    .select("id, lead_id, cadence_step")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) return serverError(beforeError.message);
  if (!before) return Response.json({ error: "not_found", message: "Task not found." }, { status: 404 });

  const { data: task, error: updateError } = await db
    .from("tasks")
    .update({ is_done: true, completed_at: new Date().toISOString() })
    .eq("id", id)
    .select(TASK_COLUMNS)
    .single();
  if (updateError) return serverError(updateError.message);

  let nextTask: Record<string, unknown> | null = null;
  const leadId = before.lead_id as string | null;
  const cadenceStep = before.cadence_step as number | null;
  if (leadId && cadenceStep != null) {
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select(
        "id, company_name, status, cadence_paused, cadence_step, cadence_anchor_date, last_contact, created_at",
      )
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) return serverError(leadError.message);
    if (lead) {
      try {
        const steps = await loadCadenceSteps(db, workspaceId);
        const created = await generateNextFollowUp(
          db,
          workspaceId,
          {
            id: lead.id as string,
            companyName: lead.company_name as string,
            status: lead.status as string,
            cadencePaused: lead.cadence_paused === true,
            cadenceStep: (lead.cadence_step as number) ?? 0,
            cadenceAnchorDate: lead.cadence_anchor_date as string | null,
            lastContact: lead.last_contact as string | null,
            createdAt: lead.created_at as string,
          },
          steps,
        );
        if (created) {
          nextTask = {
            id: created.id,
            title: created.title,
            due_date: created.dueDate,
            priority: created.priority,
            type: created.type,
            is_done: created.isDone,
            related_to: created.relatedTo,
            cancelled_at: created.cancelledAt,
          };
        }
      } catch (error) {
        // Never fail the user's "mark complete" action over automation —
        // log it and move on, matching crm-store's optimistic-write philosophy.
        console.error("[tasks/complete] follow-up generation failed", error);
      }
    }
  }

  return Response.json({ task, nextTask });
}
