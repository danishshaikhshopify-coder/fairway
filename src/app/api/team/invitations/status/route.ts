// Intentionally UNAUTHENTICATED: the login page calls this, with no session,
// right after Supabase Auth has already rejected a sign-in attempt as
// banned — i.e. the caller already proved they have the right password for
// this email. This only resolves WHY that account is banned (so the login
// page can show "awaiting workspace owner approval" instead of a generic
// message), never anything else — no workspace, role, or name is returned,
// so it carries no more information than the failed login attempt already
// revealed, and every other reason for a ban (e.g. a removed member) gets
// the same `false` as an email with no invitation at all.

import { getServiceSupabase } from "@/lib/supabase/server";
import { badRequest, serverError } from "@/lib/api/auth";
import { normaliseEmail } from "@/lib/team/invites";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const email = body && typeof body === "object" ? (body as Record<string, unknown>).email : null;
  if (typeof email !== "string" || !email) return badRequest("email is required.");

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data, error } = await db
    .from("invitations")
    .select("id")
    .eq("email", normaliseEmail(email))
    .eq("status", "awaiting_approval")
    .maybeSingle();
  if (error) return serverError(error.message);

  return Response.json({ awaitingApproval: Boolean(data) });
}
