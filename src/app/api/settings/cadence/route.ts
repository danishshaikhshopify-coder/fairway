// Settings -> Follow-ups. "Admin can configure follow-up intervals and
// channels" maps to canConfigure() (owner/admin), not the broader
// owner/admin/sales_rep tenant-write tier every other CRM table uses — see
// the cadence_steps RLS policies in the B8 migration, which enforce the
// same owner/admin-only rule at the database layer too.

import { badRequest, canConfigure, forbidden, readJson, requireActor, serverError } from "@/lib/api/auth";
import { validateCadenceSteps } from "@/lib/cadence/engine";

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, role } = result.actor;

  const { data, error } = await db
    .from("cadence_steps")
    .select("step_number, interval_days, channel")
    .eq("workspace_id", workspaceId)
    .order("step_number", { ascending: true });
  if (error) return serverError(error.message);

  return Response.json({
    canEdit: canConfigure(role),
    steps: (data ?? []).map((r) => ({
      stepNumber: r.step_number,
      intervalDays: r.interval_days,
      channel: r.channel,
    })),
  });
}

export async function PUT(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, role } = result.actor;
  if (!canConfigure(role)) return forbidden("Only an owner or admin can configure follow-up cadence.");

  const body = await readJson<{ steps?: unknown }>(request);
  const steps = body ? validateCadenceSteps(body.steps) : null;
  if (!steps) {
    return badRequest("steps must be a list of { stepNumber, intervalDays, channel }.");
  }

  const { error: deleteError } = await db.from("cadence_steps").delete().eq("workspace_id", workspaceId);
  if (deleteError) return serverError(deleteError.message);

  if (steps.length > 0) {
    const { error: insertError } = await db.from("cadence_steps").insert(
      steps.map((s) => ({
        workspace_id: workspaceId,
        step_number: s.stepNumber,
        interval_days: s.intervalDays,
        channel: s.channel,
      })),
    );
    if (insertError) return serverError(insertError.message);
  }

  return Response.json({ saved: true, steps });
}
