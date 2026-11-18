// Append-only audit trail for team-management/security events (B10). All
// writes go through the service role, same as `invitations`/`team_audit_log`
// RLS (zero authenticated/anon policies — see the B10 migration).
import type { SupabaseClient } from "@supabase/supabase-js";

export type TeamAuditAction =
  | "invitation_created"
  | "invitation_resent"
  | "invitation_cancelled"
  | "invitation_accepted"
  | "member_approved"
  | "member_rejected"
  | "role_changed"
  | "member_deactivated"
  | "member_removed"
  | "member_permanently_deleted"
  | "login_success"
  | "login_failure"
  | "login_blocked_pending_approval";

export interface TeamAuditEvent {
  workspaceId: string;
  actorMemberId?: string | null;
  targetEmail?: string | null;
  targetUserId?: string | null;
  action: TeamAuditAction;
  previousValue?: unknown;
  newValue?: unknown;
  result?: "success" | "failure";
}

/**
 * Best-effort audit write — a logging failure must never block or fail the
 * caller's actual action, so this swallows its own error (logging it to the
 * server console the same way other best-effort steps in this codebase do,
 * e.g. the ban-on-remove step in members/remove/route.ts).
 */
export async function logTeamEvent(db: SupabaseClient, event: TeamAuditEvent): Promise<void> {
  const { error } = await db.from("team_audit_log").insert({
    workspace_id: event.workspaceId,
    actor_member_id: event.actorMemberId ?? null,
    target_email: event.targetEmail ?? null,
    target_user_id: event.targetUserId ?? null,
    action: event.action,
    previous_value: event.previousValue ?? null,
    new_value: event.newValue ?? null,
    result: event.result ?? "success",
  });
  if (error) {
    console.error(`logTeamEvent: failed to record "${event.action}": ${error.message}`);
  }
}
