// Runs right after /invite/accept establishes a session and the partner
// sets a new password. For a brand-new invite this is a no-op: the invite
// already got them a workspace_members row and flipped the invitation to
// 'accepted' at send time via handle_new_user() (see the parent route).
// It only does real work for a REACTIVATION (see
// POST /api/team/invitations' "re-inviting a REMOVED member" comment):
// that path leaves workspace_members.is_active = false on purpose — the
// owner's freshly chosen role only takes effect once the member has
// actually completed fresh authentication, which is exactly what calling
// this, right after updateUser({password}) succeeds, proves happened.
//
// No owner/actor gate here on purpose: the caller is mid-reactivation and
// therefore NOT an active member yet (requireActor() would 403 them). Their
// own session (via getUser(), not a cookie sniff) is the only identity that
// matters — it decides nothing beyond "finish admitting this already-
// authenticated person into the pending invite that names their email."

import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/auth";
import { normaliseEmail } from "@/lib/team/invites";

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

  const { data: invitation, error: invitationError } = await service
    .from("invitations")
    .select("id, workspace_id, role")
    .eq("email", normaliseEmail(userData.user.email))
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (invitationError) return serverError(invitationError.message);
  if (!invitation) return Response.json({ reactivated: false });

  const { data: member, error: memberError } = await service
    .from("workspace_members")
    .select("id, is_active")
    .eq("workspace_id", invitation.workspace_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (memberError) return serverError(memberError.message);
  if (!member || member.is_active) return Response.json({ reactivated: false });

  const { error: reactivateError } = await service
    .from("workspace_members")
    .update({ is_active: true, role: invitation.role, removed_at: null })
    .eq("id", member.id);
  if (reactivateError) return serverError(reactivateError.message);

  await service
    .from("invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  return Response.json({ reactivated: true });
}
