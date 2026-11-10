// Scheduled follow-up bootstrap — same shared-secret pattern as the other
// two crons (google-sheets-sync, reminders). This one only has to handle
// BRAND-NEW leads: once a lead's step 1 task exists, every later step is
// generated immediately when the previous one is completed (see
// POST /api/tasks/complete), so this cron never needs to re-scan leads that
// are already mid-cadence.
//
// Never sends outreach — it only ever creates a task row reminding a human
// which action to take next.

import { getServiceSupabase } from "@/lib/supabase/server";
import { generateNextFollowUp, loadCadenceSteps } from "@/lib/cadence/generate";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = getServiceSupabase();
  if (!db) return Response.json({ error: "supabase_not_configured", generated: 0 }, { status: 200 });

  const { data: workspaces, error: wsError } = await db.from("workspaces").select("id");
  if (wsError) return Response.json({ error: wsError.message, generated: 0 }, { status: 500 });

  const results: { workspaceId: string; leadId: string; stepNumber: number; dueDate: string }[] = [];

  for (const workspace of workspaces ?? []) {
    const workspaceId = workspace.id as string;
    const steps = await loadCadenceSteps(db, workspaceId);
    if (steps.length === 0) continue;

    const { data: leads, error: leadsError } = await db
      .from("leads")
      .select("id, company_name, status, cadence_paused, last_contact, created_at")
      .eq("workspace_id", workspaceId)
      .eq("cadence_step", 0)
      .eq("cadence_paused", false)
      .not("status", "in", "(won,lost)");
    if (leadsError) continue;

    for (const lead of leads ?? []) {
      try {
        const created = await generateNextFollowUp(
          db,
          workspaceId,
          {
            id: lead.id as string,
            companyName: lead.company_name as string,
            status: lead.status as string,
            cadencePaused: lead.cadence_paused === true,
            cadenceStep: 0,
            cadenceAnchorDate: null,
            lastContact: lead.last_contact as string | null,
            createdAt: lead.created_at as string,
          },
          steps,
        );
        if (created) {
          results.push({
            workspaceId,
            leadId: lead.id as string,
            stepNumber: 1,
            dueDate: created.dueDate,
          });
        }
      } catch (error) {
        console.error("[cron/follow-ups] generation failed for lead", lead.id, error);
      }
    }
  }

  return Response.json({ generated: results.length, results });
}
