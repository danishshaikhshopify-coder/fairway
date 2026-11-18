// Runs right after /invite/accept establishes a session and the partner
// sets a new password — for BOTH a brand-new invite and a reactivation
// (re-inviting a removed member). Neither path grants active access here
// anymore: the owner must explicitly approve first (see ../approve and
// ../reject). This only moves the matching invitation from 'pending' to
// 'awaiting_approval' and bans the auth account so they cannot sign in in
// the meantime — workspace_members.is_active stays false until the owner
// acts. See ../approve/route.ts for what actually flips it.
//
// No owner/actor gate here on purpose: the caller is mid-registration and
// therefore NOT an active member yet (requireActor() would 403 them). Their
// own session (via getUser(), not a cookie sniff) is the only identity that
// matters — it decides nothing beyond "mark this already-authenticated
// person's invitation as awaiting approval."

import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/auth";
import { normaliseEmail, PERMANENT_BAN } from "@/lib/team/invites";
import { logTeamEvent } from "@/lib/team/audit";

export async function POST(): Promise<Response> {
  const db = await getServerSupabase();
  if (!db) {
    return Response.json(
      { error: "not_configured", message: "Live mode is not configured." },
      { status: 503 },
    );
  }

  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData.user?.email) {
    return Response.json({ error: "unauthorized", message: "Sign in to continue." }, { status: 401 });
  }

  const service = getServiceSupabase();
  if (!service) return serverError("Service role is not configured.");

  // The pending-invite uniqueness constraint is per-workspace, not global,
  // so the same email can hold a live pending invite in more than one
  // workspace at once. Picking only the single most-recent one could pick
  // the wrong workspace. Check every pending invite for this email and act
  // on whichever one actually matches a (not-yet-active) membership row.
  const { data: invitations, error: invitationError } = await service
    .from("invitations")
    .select("id, workspace_id, role")
    .eq("email", normaliseEmail(userData.user.email))
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (invitationError) return serverError(invitationError.message);
  if (!invitations || invitations.length === 0) return Response.json({ status: "none" });

  for (const invitation of invitations) {
    const { data: member, error: memberError } = await service
      .from("workspace_members")
      .select("id, is_active")
      .eq("workspace_id", invitation.workspace_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (memberError) return serverError(memberError.message);
    if (!member || member.is_active) continue;

    const { error: awaitingError } = await service
      .from("invitations")
      .update({ status: "awaiting_approval", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);
    if (awaitingError) return serverError(awaitingError.message);

    const { error: banError } = await service.auth.admin.updateUserById(userData.user.id, {
      ban_duration: PERMANENT_BAN,
    });
    if (banError) {
      // Not fatal — is_active stays false, which already blocks every
      // RLS-gated query — but it must not fail silently.
      console.error(`Complete: banning auth user ${userData.user.id} failed: ${banError.message}`);
    }

    await logTeamEvent(service, {
      workspaceId: invitation.workspace_id,
      targetEmail: userData.user.email,
      targetUserId: userData.user.id,
      action: "invitation_accepted",
      result: "success",
    });

    return Response.json({ status: "awaiting_approval" });
  }

  return Response.json({ status: "none" });
}
