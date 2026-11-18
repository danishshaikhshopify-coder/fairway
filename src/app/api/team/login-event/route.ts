// Intentionally UNAUTHENTICATED and best-effort: the login page fires this
// after every sign-in attempt (success, failure, or blocked-pending-
// approval) for the audit log, since login itself happens via the browser's
// direct signInWithPassword() call and never passes through our own API.
// This must never visibly affect login — any failure here is swallowed and
// it always reports success back to the caller.

import { getServiceSupabase } from "@/lib/supabase/server";
import { logTeamEvent, type TeamAuditAction } from "@/lib/team/audit";

const VALID_OUTCOMES: TeamAuditAction[] = ["login_success", "login_failure", "login_blocked_pending_approval"];

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const email = body && typeof body === "object" ? (body as Record<string, unknown>).email : null;
    const outcome = body && typeof body === "object" ? (body as Record<string, unknown>).outcome : null;
    if (typeof email !== "string" || !email || !VALID_OUTCOMES.includes(outcome as TeamAuditAction)) {
      return Response.json({ logged: true });
    }

    const db = getServiceSupabase();
    if (!db) return Response.json({ logged: true });

    const { data: authUsers } = await db.auth.admin.listUsers();
    const user = authUsers?.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (!user) return Response.json({ logged: true });

    const { data: member } = await db
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!member) return Response.json({ logged: true });

    await logTeamEvent(db, {
      workspaceId: member.workspace_id as string,
      targetEmail: email,
      targetUserId: user.id,
      action: outcome as TeamAuditAction,
      result: outcome === "login_success" ? "success" : "failure",
    });
  } catch {
    // Best-effort only — never let an audit-logging failure affect login.
  }
  return Response.json({ logged: true });
}
