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
//
// Re-inviting a REMOVED member (workspace_members.removed_at set, Auth
// account banned — see members/remove/route.ts) is a different Auth call:
// inviteUserByEmail() creates a user, and this one already exists, so it
// always fails for them. Instead this rotates their password to a value no
// one is ever given (killing the old credential outright — "fresh
// authentication"), lifts the ban so the reset link below can establish a
// session, and sends a password-reset email to the same /invite/accept
// redirect, which already handles any Supabase callback shape regardless of
// what sent it. workspace_members stays is_active = false — access is not
// restored until POST /api/team/invitations/complete runs, right after they
// set a new password, which is also where the owner's freshly chosen role
// actually takes effect. See that route for why "banned" cannot be the
// signal a reactivation is pending.

import { randomUUID } from "node:crypto";
import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { AppUrlConfigError, getAppUrl } from "@/lib/app-url";
import { getServiceSupabase } from "@/lib/supabase/server";
import { EMAIL_RATE_LIMITED_MESSAGE, isEmailRateLimited, validateInviteInput } from "@/lib/team/invites";
import { logTeamEvent } from "@/lib/team/audit";

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can view invitations.");

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data, error } = await db
    .from("invitations")
    .select("id, email, role, status, created_at, accepted_at, revoked_at, rejected_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return serverError(error.message);

  const rows = data ?? [];
  // Full name, for the Approval Requests UI — one listUsers() call and one
  // batched profiles query, not N+1 per invitation.
  const { data: authUsers } = await db.auth.admin.listUsers();
  const emailToUserId = new Map(
    (authUsers?.users ?? []).map((u) => [(u.email ?? "").toLowerCase(), u.id]),
  );
  const userIds = rows
    .map((row) => emailToUserId.get((row.email as string).toLowerCase()))
    .filter((id): id is string => Boolean(id));
  const { data: profileRows } = userIds.length
    ? await db.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string }[] };
  const fullNameByUserId = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  const invitations = rows.map((row) => {
    const userId = emailToUserId.get((row.email as string).toLowerCase());
    return { ...row, fullName: (userId && fullNameByUserId.get(userId)) || "" };
  });

  return Response.json({ invitations });
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
  // message. Check first so re-inviting an existing/removed member gets a
  // clear, specific reason, or the reactivation path, instead of a raw
  // upstream error.
  const { data: existingAuthUsers } = await db.auth.admin.listUsers();
  const existingUser = existingAuthUsers?.users.find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  let reactivatingUserId: string | null = null;
  if (existingUser) {
    const { data: existingMember } = await db
      .from("workspace_members")
      .select("is_active")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existingUser.id)
      .maybeSingle();
    if (!existingMember) {
      return Response.json(
        {
          error: "already_member",
          message: "This email already has a Supabase account outside this workspace and cannot be invited.",
        },
        { status: 409 },
      );
    }
    if (existingMember.is_active) {
      return Response.json(
        { error: "already_member", message: "This person is already a member of this workspace." },
        { status: 409 },
      );
    }
    reactivatingUserId = existingUser.id;
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

  if (reactivatingUserId) {
    // Kill the old password outright (no one is ever given this value) and
    // lift the ban so the reset link can establish a session. is_active
    // stays false — see the route header comment.
    const { error: resetAccessError } = await db.auth.admin.updateUserById(reactivatingUserId, {
      password: `${randomUUID()}${randomUUID()}`,
      ban_duration: "none",
    });
    if (resetAccessError) {
      await db.from("invitations").delete().eq("id", invitation.id);
      return Response.json(
        { error: "invite_failed", message: resetAccessError.message },
        { status: 502 },
      );
    }
    const { error: resetEmailError } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/invite/accept`,
    });
    if (resetEmailError) {
      await db.from("invitations").delete().eq("id", invitation.id);
      if (isEmailRateLimited(resetEmailError)) {
        return Response.json({ error: "rate_limited", message: EMAIL_RATE_LIMITED_MESSAGE }, { status: 429 });
      }
      return Response.json(
        { error: "invite_failed", message: resetEmailError.message },
        { status: 502 },
      );
    }
    await logTeamEvent(db, {
      workspaceId,
      actorMemberId: memberId,
      targetEmail: email,
      action: "invitation_created",
      newValue: { role: inviteRole },
      result: "success",
    });
    return Response.json({ invitation });
  }

  const { error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/invite/accept`,
  });
  if (inviteError) {
    // Roll the invitation back so a retry does not collide with the unique
    // pending-invite index.
    await db.from("invitations").delete().eq("id", invitation.id);
    if (isEmailRateLimited(inviteError)) {
      return Response.json({ error: "rate_limited", message: EMAIL_RATE_LIMITED_MESSAGE }, { status: 429 });
    }
    return Response.json(
      { error: "invite_failed", message: inviteError.message },
      { status: 502 },
    );
  }

  await logTeamEvent(db, {
    workspaceId,
    actorMemberId: memberId,
    targetEmail: email,
    action: "invitation_created",
    newValue: { role: inviteRole },
    result: "success",
  });
  return Response.json({ invitation });
}
