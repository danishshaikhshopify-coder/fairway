// Team roster. Any workspace member can read it (co-members already see
// each other via workspace_members_select RLS); only the owner can change a
// role, deactivate someone, or toggle who receives reminder emails — see
// canManageTeam() and the POST handler below.
//
// profiles.daily_digest/overdue_reminders are normally self-service-only
// (profiles_update RLS: id = auth.uid()), so toggling them for a PARTNER
// goes through the service role here, after the owner check, exactly like
// every other cross-member write in this codebase.

import { canManageTeam, forbidden, requireActor, serverError } from "@/lib/api/auth";
import { getServiceSupabase } from "@/lib/supabase/server";
import { validateMemberPatch } from "@/lib/team/invites";

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  profiles: { full_name: string; daily_digest: boolean; overdue_reminders: boolean } | null;
}

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId } = result.actor;

  const { data, error } = await db
    .from("workspace_members")
    .select(
      "id, user_id, role, is_active, created_at, profiles!workspace_members_user_id_fkey(full_name, daily_digest, overdue_reminders)",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) return serverError(error.message);

  // gmail_connections RLS is deliberately self-only (it stores OAuth tokens),
  // so a teammate's row is invisible through the caller's own RLS-scoped
  // `db` client. The roster needs only the non-sensitive connected_at/email
  // columns to show Gmail status, so read those through the service client
  // instead — never the tokens — the same pattern listUsers() already uses
  // just below for cross-member email lookup.
  const service = getServiceSupabase();
  const { data: authUsers } = service ? await service.auth.admin.listUsers() : { data: null };
  const { data: gmailRows } = service
    ? await service
        .from("gmail_connections")
        .select("member_id, email, connected_at")
        .eq("workspace_id", workspaceId)
    : { data: null };
  const gmailByMember = new Map(
    (gmailRows ?? []).map((row) => [row.member_id as string, row as Record<string, unknown>]),
  );

  const members = (data as unknown as MemberRow[]).map((row) => {
    const authUser = authUsers?.users.find((u) => u.id === row.user_id);
    const gmail = gmailByMember.get(row.id);
    // Remove (POST /api/team/members/remove) bans the Supabase Auth account on
    // top of deactivating; a plain Deactivate toggle never sets banned_until.
    // Surfacing it lets the UI tell "removed" apart from "just deactivated".
    const banned = Boolean(authUser?.banned_until) && new Date(authUser!.banned_until!) > new Date();
    return {
      id: row.id,
      email: authUser?.email ?? null,
      fullName: row.profiles?.full_name ?? "",
      role: row.role,
      isActive: row.is_active,
      banned,
      receivesReminders: Boolean(row.profiles?.daily_digest && row.profiles?.overdue_reminders),
      gmailConnected: Boolean(gmail?.connected_at),
      gmailEmail: (gmail?.email as string) ?? null,
      createdAt: row.created_at,
    };
  });

  return Response.json({ members });
}

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { role, workspaceId } = result.actor;
  if (!canManageTeam(role)) return forbidden("Only the owner can manage team members.");

  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : null;
  if (typeof id !== "string" || !id) {
    return Response.json({ error: "bad_request", message: "id is required." }, { status: 400 });
  }
  const validated = validateMemberPatch(body);
  if (!validated.ok) return Response.json({ error: "bad_request", message: validated.error }, { status: 400 });
  const patch = validated.value;

  const db = getServiceSupabase();
  if (!db) return serverError("Service role is not configured.");

  const { data: member, error: fetchError } = await db
    .from("workspace_members")
    .select("id, user_id, role")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (fetchError) return serverError(fetchError.message);
  if (!member) {
    return Response.json({ error: "not_found", message: "Member not found." }, { status: 404 });
  }
  if (member.role === "owner") {
    return Response.json(
      { error: "forbidden", message: "The owner's own access cannot be changed here." },
      { status: 403 },
    );
  }

  if (patch.role !== undefined || patch.isActive !== undefined) {
    const memberPatch: Record<string, unknown> = {};
    if (patch.role !== undefined) memberPatch.role = patch.role;
    if (patch.isActive !== undefined) memberPatch.is_active = patch.isActive;
    const { error } = await db.from("workspace_members").update(memberPatch).eq("id", id);
    if (error) return serverError(error.message);
  }

  if (patch.receivesReminders !== undefined) {
    const { error } = await db
      .from("profiles")
      .update({
        daily_digest: patch.receivesReminders,
        overdue_reminders: patch.receivesReminders,
      })
      .eq("id", member.user_id);
    if (error) return serverError(error.message);
  }

  return Response.json({ updated: true });
}
