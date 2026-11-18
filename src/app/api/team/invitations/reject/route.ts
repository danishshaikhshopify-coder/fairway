// Owner rejects someone currently awaiting approval. Their Auth ban is left
// exactly as it already is — rejecting never needs to touch it. Their
// workspace_members row (created inert, is_active = false) gets removed_at
// stamped, the same shape a Remove leaves behind: without this, the row has
// no matching invitation status for the UI's Approval-requests bucket, is
// not is_active for the Active bucket, and has no removed_at for the
// Removed bucket — it would be invisible, with no way to ever permanently
// delete it. Stamping removed_at here reuses the existing Removed-member
// lifecycle instead of inventing a new one.

import { canManageTeam, forbidden, badRequest, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";
import { logTeamEvent } from "@/lib/team/audit";

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId, memberId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can reject team members.");

  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  if (typeof id !== "string" || !id) return badRequest("id is required.");

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data: invitation, error: fetchError } = await db
    .from("invitations")
    .select("id, email, status")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (fetchError) return serverError(fetchError.message);
  if (!invitation) {
    return Response.json({ error: "not_found", message: "Invitation not found." }, { status: 404 });
  }
  if (invitation.status !== "awaiting_approval") {
    return Response.json(
      { error: "not_awaiting_approval", message: "Only an invitation awaiting approval can be rejected." },
      { status: 409 },
    );
  }

  const { data: authUsers, error: listError } = await db.auth.admin.listUsers();
  if (listError) return serverError(listError.message);
  const existingUser = authUsers?.users.find(
    (u) => (u.email ?? "").toLowerCase() === (invitation.email as string).toLowerCase(),
  );
  if (!existingUser) return serverError("Could not find the invited person's account.");

  const { data: member, error: memberError } = await db
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", existingUser.id)
    .maybeSingle();
  if (memberError) return serverError(memberError.message);
  if (!member) return serverError("Could not find the invited person's membership.");

  const { error: removeError } = await db
    .from("workspace_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", member.id);
  if (removeError) return serverError(removeError.message);

  const { error: rejectError } = await db
    .from("invitations")
    .update({ status: "rejected", rejected_at: new Date().toISOString() })
    .eq("id", id);
  if (rejectError) return serverError(rejectError.message);

  await logTeamEvent(db, {
    workspaceId,
    actorMemberId: memberId,
    targetEmail: invitation.email as string,
    targetUserId: existingUser.id,
    action: "member_rejected",
    result: "success",
  });

  return Response.json({ rejected: true });
}
