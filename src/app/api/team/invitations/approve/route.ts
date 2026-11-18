// Owner approves someone currently awaiting approval (a brand-new invite or
// a reactivation that already completed password setup — see
// ../complete/route.ts). This is the ONLY place workspace_members.is_active
// flips true as part of this flow: everywhere else in Team Management
// leaves it false until the owner explicitly acts here.

import { canManageTeam, forbidden, badRequest, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";
import { logTeamEvent } from "@/lib/team/audit";

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId, memberId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can approve team members.");

  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  if (typeof id !== "string" || !id) return badRequest("id is required.");

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data: invitation, error: fetchError } = await db
    .from("invitations")
    .select("id, email, role, status")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (fetchError) return serverError(fetchError.message);
  if (!invitation) {
    return Response.json({ error: "not_found", message: "Invitation not found." }, { status: 404 });
  }
  if (invitation.status !== "awaiting_approval") {
    return Response.json(
      { error: "not_awaiting_approval", message: "Only an invitation awaiting approval can be approved." },
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

  const { error: activateError } = await db
    .from("workspace_members")
    .update({ is_active: true, role: invitation.role, removed_at: null })
    .eq("id", member.id);
  if (activateError) return serverError(activateError.message);

  const { error: unbanError } = await db.auth.admin.updateUserById(existingUser.id, { ban_duration: "none" });
  if (unbanError) {
    console.error(`Approve: lifting ban for auth user ${existingUser.id} failed: ${unbanError.message}`);
  }

  const { error: acceptError } = await db.from("invitations").update({ status: "accepted" }).eq("id", id);
  if (acceptError) return serverError(acceptError.message);

  await logTeamEvent(db, {
    workspaceId,
    actorMemberId: memberId,
    targetEmail: invitation.email as string,
    targetUserId: existingUser.id,
    action: "member_approved",
    previousValue: { isActive: false },
    newValue: { isActive: true, role: invitation.role },
    result: "success",
  });

  return Response.json({ approved: true });
}
