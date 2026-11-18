// Permanent deletion of an already-removed member. Owner-only, and only for
// a member row that Remove (see ../remove/route.ts) already deactivated —
// this is the explicit, confirmed follow-up action for someone who is never
// coming back, not an alternative to Remove.
//
// This deletes the workspace_members row itself, which Remove deliberately
// never does (see its own comment on why: every business table references
// workspace_members(id) with `on delete set null`, so this is safe here for
// the same reason — leads/companies/contacts/tasks/activities keep their
// history, just with owner/creator/assignee columns nulled out instead of
// referencing a deleted row).
//
// The auth.users row is only deleted when the person has no OTHER workspace
// membership: auth.users -> profiles -> workspace_members all cascade on
// delete, so deleting the auth account here would silently remove their
// membership rows (and access) in every OTHER workspace they belong to —
// not just this one. When other memberships exist, only this workspace's
// row is deleted and the auth account is left alone.

import { badRequest, canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";
import { logTeamEvent } from "@/lib/team/audit";

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId, memberId: actingMemberId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can delete team members.");

  const body = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const id = input?.id;
  if (typeof id !== "string" || !id) return badRequest("id is required.");
  if (input?.confirm !== true) {
    return badRequest("confirm must be true to permanently delete a member.");
  }

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data: member, error: fetchError } = await db
    .from("workspace_members")
    .select("id, user_id, role, removed_at")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (fetchError) return serverError(fetchError.message);
  if (!member) {
    return Response.json({ error: "not_found", message: "Member not found." }, { status: 404 });
  }
  if (member.role === "owner") {
    return forbidden("The owner cannot be deleted.");
  }
  if (member.id === actingMemberId) {
    return forbidden("You cannot delete yourself.");
  }
  if (!member.removed_at) {
    return Response.json(
      {
        error: "not_removed",
        message: "Remove this member first; only a removed member can be permanently deleted.",
      },
      { status: 409 },
    );
  }

  const { data: otherMemberships, error: otherError } = await db
    .from("workspace_members")
    .select("id")
    .eq("user_id", member.user_id)
    .neq("workspace_id", workspaceId);
  if (otherError) return serverError(otherError.message);

  const { error: deleteError } = await db.from("workspace_members").delete().eq("id", id);
  if (deleteError) return serverError(deleteError.message);

  const hasOtherMemberships = (otherMemberships?.length ?? 0) > 0;
  let authDeleted = false;
  if (!hasOtherMemberships) {
    const { error: authError } = await db.auth.admin.deleteUser(member.user_id);
    if (authError) {
      // Not fatal — the membership row is already gone, which is what
      // actually revokes access — but it must not fail silently: log it so
      // an orphaned auth account can be investigated, not just assumed away.
      console.error(`Delete: removing auth user ${member.user_id} failed: ${authError.message}`);
    } else {
      authDeleted = true;
    }
  }

  await logTeamEvent(db, {
    workspaceId,
    actorMemberId: actingMemberId,
    targetUserId: member.user_id,
    action: "member_permanently_deleted",
    newValue: { authDeleted, otherWorkspaceMemberships: hasOtherMemberships },
    result: "success",
  });
  return Response.json({ deleted: true, authDeleted, otherWorkspaceMemberships: hasOtherMemberships });
}
