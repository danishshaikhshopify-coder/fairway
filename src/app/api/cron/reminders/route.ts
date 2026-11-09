// Scheduled reminder digest — called by an external scheduler, never by a
// signed-in user (same shared-secret pattern as /api/cron/google-sheets-sync).
//
// For each workspace, sends one digest email (overdue tasks, leads due for
// follow-up, and today's meetings) to every member who (a) is active,
// (b) the owner has opted in via daily_digest + overdue_reminders — see
// POST /api/team/members, which is the only way those flags get set for
// someone other than themselves — and (c) has a connected Gmail address to
// receive it at (requirement: "partners receive notifications at their own
// connected email addresses"). The email is sent FROM the workspace OWNER's
// connected Gmail (the one account with a real reason to send system mail),
// never from the recipient's own account.

import { getServiceSupabase } from "@/lib/supabase/server";
import { sendEmail, GmailApiError } from "@/lib/integrations/gmail/api";
import { getValidAccessToken, GmailOAuthError } from "@/lib/integrations/gmail/oauth";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

interface DigestContent {
  overdueTasks: { title: string; dueDate: string | null }[];
  followUpLeads: { companyName: string; nextFollowUp: string | null }[];
  meetingsToday: { title: string; dueDate: string | null }[];
}

function renderDigest(content: DigestContent): string {
  const lines: string[] = ["Your Fairway CRM reminders:", ""];
  if (content.overdueTasks.length) {
    lines.push("Overdue tasks:");
    for (const t of content.overdueTasks) lines.push(`  - ${t.title} (due ${t.dueDate ?? "—"})`);
    lines.push("");
  }
  if (content.followUpLeads.length) {
    lines.push("Leads due for follow-up:");
    for (const l of content.followUpLeads) {
      lines.push(`  - ${l.companyName} (follow up by ${l.nextFollowUp ?? "—"})`);
    }
    lines.push("");
  }
  if (content.meetingsToday.length) {
    lines.push("Meetings today:");
    for (const m of content.meetingsToday) lines.push(`  - ${m.title}`);
    lines.push("");
  }
  if (!content.overdueTasks.length && !content.followUpLeads.length && !content.meetingsToday.length) {
    lines.push("Nothing overdue — you're all caught up.");
  }
  return lines.join("\n");
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = getServiceSupabase();
  if (!db) return Response.json({ error: "supabase_not_configured", sent: 0 }, { status: 200 });

  const today = new Date().toISOString().slice(0, 10);

  const { data: workspaces, error: wsError } = await db.from("workspaces").select("id");
  if (wsError) return Response.json({ error: wsError.message, sent: 0 }, { status: 500 });

  const results: { workspaceId: string; recipient: string; status: string; error?: string }[] = [];

  for (const workspace of workspaces ?? []) {
    const workspaceId = workspace.id as string;

    const { data: owner } = await db
      .from("workspace_members")
      .select("id, gmail:gmail_connections(access_token, refresh_token, token_expires_at, id)")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .maybeSingle();
    const ownerConnection = (owner as { gmail?: unknown[] } | null)?.gmail;
    const ownerGmail = Array.isArray(ownerConnection) ? ownerConnection[0] : ownerConnection;
    if (!ownerGmail) continue; // no sender available for this workspace

    const { data: recipients } = await db
      .from("workspace_members")
      .select("id, user_id, profiles!workspace_members_user_id_fkey(daily_digest, overdue_reminders)")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);
    const { data: gmailRows } = await db
      .from("gmail_connections")
      .select("member_id, email")
      .eq("workspace_id", workspaceId);
    const emailByMember = new Map((gmailRows ?? []).map((r) => [r.member_id as string, r.email as string]));

    const optedIn = (recipients ?? []).filter((r) => {
      const prefs = (r as { profiles?: { daily_digest?: boolean; overdue_reminders?: boolean } }).profiles;
      return prefs?.daily_digest && prefs?.overdue_reminders && emailByMember.has(r.id as string);
    });
    if (optedIn.length === 0) continue;

    const [{ data: overdueTasks }, { data: followUpLeads }, { data: meetingsToday }] = await Promise.all([
      db
        .from("tasks")
        .select("title, due_date")
        .eq("workspace_id", workspaceId)
        .eq("is_done", false)
        .lt("due_date", today),
      db
        .from("leads")
        .select("company_name, next_follow_up")
        .eq("workspace_id", workspaceId)
        .not("status", "in", "(won,lost)")
        .lte("next_follow_up", today)
        .not("next_follow_up", "is", null),
      db
        .from("tasks")
        .select("title, due_date")
        .eq("workspace_id", workspaceId)
        .eq("type", "meeting")
        .eq("is_done", false)
        .eq("due_date", today),
    ]);

    const content: DigestContent = {
      overdueTasks: (overdueTasks ?? []).map((t) => ({ title: t.title as string, dueDate: t.due_date as string })),
      followUpLeads: (followUpLeads ?? []).map((l) => ({
        companyName: l.company_name as string,
        nextFollowUp: l.next_follow_up as string,
      })),
      meetingsToday: (meetingsToday ?? []).map((m) => ({ title: m.title as string, dueDate: m.due_date as string })),
    };
    const body = renderDigest(content);

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(db, ownerGmail as { id: string; access_token: string | null; refresh_token: string | null; token_expires_at: string | null });
    } catch (error) {
      results.push({
        workspaceId,
        recipient: "*",
        status: "failed",
        error: error instanceof GmailOAuthError ? error.message : "Could not get a valid sender token.",
      });
      continue;
    }

    for (const recipient of optedIn) {
      const to = emailByMember.get(recipient.id as string);
      if (!to) continue;
      try {
        await sendEmail(accessToken, {
          to,
          subject: "Your Fairway CRM reminders",
          body,
        });
        results.push({ workspaceId, recipient: to, status: "sent" });
      } catch (error) {
        results.push({
          workspaceId,
          recipient: to,
          status: "failed",
          error: error instanceof GmailApiError ? error.message : String(error),
        });
      }
    }
  }

  return Response.json({ sent: results.filter((r) => r.status === "sent").length, results });
}
