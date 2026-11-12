// Remove a partner/admin. Owner-only, and the owner can target neither
// themselves nor another owner — see canManageTeam() and the role/self
// checks below.
//
// This never deletes the workspace_members row (or the auth.users row): the
// ownership columns on leads/companies/contacts/tasks/activities/
// lead_score_events/lead_imports reference workspace_members(id) with
// `on delete set null` (see the B1 remediation migration) — deleting the
// member would silently null out who owned/created/was assigned every one
// of those rows, destroying exactly the audit trail requirement #6 asks to
// preserve. Instead this sets is_active = false (the same flag every
// tenant-table RLS policy already gates on — see is_workspace_member() in
// the B7 migration, which revokes data access immediately) and bans the
// Supabase Auth account so they cannot sign in or refresh a session either.
// Banning is best-effort: is_active = false alone already blocks every data
// query, so a ban failure does not stop the removal from succeeding.

import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";
import { canRemoveMember } from "@/lib/team/invites";

const PERMANENT_BAN = "876000h"; // 100 years — supabase-js's own documented "ban forever" value.

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId, memberId: actingMemberId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can remove team members.");

  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  if (typeof id !== "string" || !id) {
    return Response.json({ error: "bad_request", message: "id is required." }, { status: 400 });
  }

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data: member, error: fetchError } = await db
    .from("workspace_members")
    .select("id, user_id, role")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (fetchError) return serverError(fetchError.message);
  if (!member) {
    return Response.json({ error: "not_found", message: "Member not found." }, { status: 404 });
  }
  const eligible = canRemoveMember(member, actingMemberId);
  if (!eligible.ok) {
    return Response.json({ error: "forbidden", message: eligible.error }, { status: 403 });
  }

  const { error: updateError } = await db
    .from("workspace_members")
    .update({ is_active: false })
    .eq("id", id);
  if (updateError) return serverError(updateError.message);

  const { error: banError } = await db.auth.admin.updateUserById(member.user_id, {
    ban_duration: PERMANENT_BAN,
  });
  if (banError) {
    // Not fatal — is_active = false already blocks every RLS-gated query —
    // but it must not fail silently: log it so a stuck session (still valid
    // until it expires/refreshes) can be investigated, not just assumed away.
    console.error(`Remove: banning auth user ${member.user_id} failed: ${banError.message}`);
  }

  return Response.json({ removed: true, authBanned: !banError });
}
