// Owner-only read of the workspace's team-management audit trail (see
// src/lib/team/audit.ts for what gets logged and why).

import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can view the activity log.");

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data, error } = await db
    .from("team_audit_log")
    .select("id, actor_member_id, target_email, target_user_id, action, previous_value, new_value, result, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return serverError(error.message);

  const entries = (data ?? []).map((row) => ({
    id: row.id,
    actorMemberId: row.actor_member_id,
    targetEmail: row.target_email,
    targetUserId: row.target_user_id,
    action: row.action,
    previousValue: row.previous_value,
    newValue: row.new_value,
    result: row.result,
    createdAt: row.created_at,
  }));

  return Response.json({ entries });
}
