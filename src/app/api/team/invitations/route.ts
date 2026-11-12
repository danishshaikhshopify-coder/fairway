// Admin-only partner invitations. Only the workspace owner may invite — see
// canManageTeam() — and every write goes through the service role so it is
// never gated by (or exposed to) ordinary RLS/grants on `invitations`
// (see the B7 migration: that table grants nothing to authenticated/anon).
//
// Inviting creates the pending invitation row FIRST, then asks Supabase Auth
// to create the user (which immediately fires handle_new_user(), which looks
// up that same pending row to decide which workspace/role to admit them
// into — see the B7 migration). Supabase emails the partner a sign-in link;
// there is no separate "signup" step for them to complete beyond setting a
// password at /invite/accept.

import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { AppUrlConfigError, getAppUrl } from "@/lib/app-url";
import { getServiceSupabase } from "@/lib/supabase/server";
import { validateInviteInput } from "@/lib/team/invites";

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can view invitations.");

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data, error } = await db
    .from("invitations")
    .select("id, email, role, status, created_at, accepted_at, revoked_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return serverError(error.message);

  return Response.json({ invitations: data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId, memberId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can invite partners.");

  const body = await request.json().catch(() => null);
  const validated = validateInviteInput(body);
  if (!validated.ok) return Response.json({ error: "bad_request", message: validated.error }, { status: 400 });
  const { email, role: inviteRole } = validated.value;

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  // inviteUserByEmail() errors on an email Supabase Auth already knows about
  // (any workspace, since auth.users is global) — but with a generic GoTrue
  // message. Check first so a re-invite of an existing/removed member gets a
  // clear, specific reason instead of a raw upstream error.
  const { data: existingAuthUsers } = await db.auth.admin.listUsers();
  const existingUser = existingAuthUsers?.users.find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  if (existingUser) {
    const { data: existingMember } = await db
      .from("workspace_members")
      .select("is_active")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existingUser.id)
      .maybeSingle();
    const message = existingMember
      ? existingMember.is_active
        ? "This person is already a member of this workspace."
        : "This person was removed from this workspace and cannot be re-invited."
      : "This email already has a Supabase account outside this workspace and cannot be invited.";
    return Response.json({ error: "already_member", message }, { status: 409 });
  }

  const { data: invitation, error: insertError } = await db
    .from("invitations")
    .insert({ workspace_id: workspaceId, email, role: inviteRole, invited_by: memberId })
    .select("id, email, role, status, created_at")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      return Response.json(
        { error: "already_invited", message: "There is already a pending invitation for this email." },
        { status: 409 },
      );
    }
    return serverError(insertError.message);
  }

  let origin: string;
  try {
    origin = getAppUrl();
  } catch (error) {
    await db.from("invitations").delete().eq("id", invitation.id);
    return serverError(
      error instanceof AppUrlConfigError
        ? error.message
        : "Application URL is not configured.",
    );
  }

  const { error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/invite/accept`,
  });
  if (inviteError) {
    // Roll the invitation back so a retry does not collide with the unique
    // pending-invite index.
    await db.from("invitations").delete().eq("id", invitation.id);
    return Response.json(
      { error: "invite_failed", message: inviteError.message },
      { status: 502 },
    );
  }

  return Response.json({ invitation });
}
