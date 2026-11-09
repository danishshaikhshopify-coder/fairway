// Revoke a pending invitation. If the invite already fired
// handle_new_user() (Supabase creates the auth user at invite time, not
// when the partner clicks the link — see the parent route's comment),
// deactivating their membership too undoes that in one step.

import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can revoke invitations.");

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

  const { error: updateError } = await db
    .from("invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) return serverError(updateError.message);

  // If handle_new_user() already admitted them (invite emails create the
  // auth user immediately), pull their membership too.
  const { data: authUsers } = await db.auth.admin.listUsers();
  const matchingUser = authUsers?.users.find(
    (u) => (u.email ?? "").toLowerCase() === (invitation.email as string).toLowerCase(),
  );
  if (matchingUser) {
    await db
      .from("workspace_members")
      .update({ is_active: false })
      .eq("workspace_id", workspaceId)
      .eq("user_id", matchingUser.id);
  }

  return Response.json({ revoked: true });
}
