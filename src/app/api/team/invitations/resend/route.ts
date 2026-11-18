// Re-sends the access email for a still-pending invitation, without creating
// a second invitations row (the b7 unique partial index already blocks
// that) or touching workspace_members. By the time any invite exists,
// inviteUserByEmail() already created the auth.users row at send time (see
// the parent route's header comment) — so resetPasswordForEmail() is the
// right call here regardless of whether this invite is a fresh signup or a
// reactivation; inviteUserByEmail() itself is kept only as a defensive
// fallback for the invariant-violation case where that row is missing.

import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { AppUrlConfigError, getAppUrl } from "@/lib/app-url";
import { getServiceSupabase } from "@/lib/supabase/server";
import { EMAIL_RATE_LIMITED_MESSAGE, isEmailRateLimited } from "@/lib/team/invites";
import { logTeamEvent } from "@/lib/team/audit";

function resendFailure(error: { code?: string; message: string }): Response {
  if (isEmailRateLimited(error)) {
    return Response.json({ error: "rate_limited", message: EMAIL_RATE_LIMITED_MESSAGE }, { status: 429 });
  }
  return Response.json({ error: "resend_failed", message: error.message }, { status: 502 });
}

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId, memberId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can resend invitations.");

  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  if (typeof id !== "string" || !id) {
    return Response.json({ error: "bad_request", message: "id is required." }, { status: 400 });
  }

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
  if (invitation.status !== "pending") {
    return Response.json(
      { error: "not_pending", message: "Only a pending invitation can be resent." },
      { status: 409 },
    );
  }

  let origin: string;
  try {
    origin = getAppUrl();
  } catch (error) {
    return serverError(
      error instanceof AppUrlConfigError ? error.message : "Application URL is not configured.",
    );
  }

  const { data: existingAuthUsers, error: listError } = await db.auth.admin.listUsers();
  if (listError) return serverError(listError.message);
  const existingUser = existingAuthUsers?.users.find(
    (u) => (u.email ?? "").toLowerCase() === invitation.email.toLowerCase(),
  );

  if (existingUser) {
    const { error: resendError } = await db.auth.resetPasswordForEmail(invitation.email, {
      redirectTo: `${origin}/invite/accept`,
    });
    if (resendError) {
      return resendFailure(resendError);
    }
    await logTeamEvent(db, {
      workspaceId,
      actorMemberId: memberId,
      targetEmail: invitation.email as string,
      action: "invitation_resent",
      result: "success",
    });
    return Response.json({ resent: true });
  }

  const { error: inviteError } = await db.auth.admin.inviteUserByEmail(invitation.email, {
    redirectTo: `${origin}/invite/accept`,
  });
  if (inviteError) {
    return resendFailure(inviteError);
  }
  await logTeamEvent(db, {
    workspaceId,
    actorMemberId: memberId,
    targetEmail: invitation.email as string,
    action: "invitation_resent",
    result: "success",
  });
  return Response.json({ resent: true });
}
