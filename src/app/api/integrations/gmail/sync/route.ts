// Pull recently received mail, match it to known leads/contacts by email
// address, and log each unseen message as an inbound 'email' activity. Idempotent
// via activities.provider_message_id (see the B7 migration's unique index) —
// re-running this never double-logs the same message for the same member.

import { requireActor, serverError } from "@/lib/api/auth";
import { extractEmailAddress, getMessage, GmailApiError, listMessageIds } from "@/lib/integrations/gmail/api";
import { getValidAccessToken, GmailOAuthError } from "@/lib/integrations/gmail/oauth";

const MAX_MESSAGES = 50;

export async function POST(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, memberId } = result.actor;

  const { data: connection, error: connectionError } = await db
    .from("gmail_connections")
    .select("id, access_token, refresh_token, token_expires_at")
    .eq("member_id", memberId)
    .maybeSingle();
  if (connectionError) return serverError(connectionError.message);
  if (!connection) {
    return Response.json(
      { error: "not_connected", message: "Connect your Gmail account in Settings first." },
      { status: 503 },
    );
  }

  const [{ data: contacts }, { data: leads }] = await Promise.all([
    db.from("contacts").select("id, company_id, email").eq("workspace_id", workspaceId),
    db.from("leads").select("id, company_id, email").eq("workspace_id", workspaceId),
  ]);

  const contactByEmail = new Map(
    (contacts ?? [])
      .filter((c) => c.email)
      .map((c) => [String(c.email).toLowerCase(), c as { id: string; company_id: string | null }]),
  );
  const leadByEmail = new Map(
    (leads ?? [])
      .filter((l) => l.email)
      .map((l) => [String(l.email).toLowerCase(), l as { id: string; company_id: string | null }]),
  );

  if (contactByEmail.size === 0 && leadByEmail.size === 0) {
    return Response.json({ scanned: 0, logged: 0, message: "No lead/contact emails to match against yet." });
  }

  try {
    const accessToken = await getValidAccessToken(db, connection);
    const ids = await listMessageIds(accessToken, "newer_than:30d", MAX_MESSAGES);

    const { data: alreadyLogged } = await db
      .from("activities")
      .select("provider_message_id")
      .eq("workspace_id", workspaceId)
      .eq("owner_id", memberId)
      .not("provider_message_id", "is", null);
    const seen = new Set((alreadyLogged ?? []).map((r) => r.provider_message_id as string));

    let logged = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      const message = await getMessage(accessToken, id);
      const from = extractEmailAddress(message.from);
      const to = extractEmailAddress(message.to);

      const contact = contactByEmail.get(from) ?? contactByEmail.get(to);
      const lead = leadByEmail.get(from) ?? leadByEmail.get(to);
      if (!contact && !lead) continue;

      const { error: insertError } = await db.from("activities").insert({
        workspace_id: workspaceId,
        type: "email",
        subject: message.subject || "(no subject)",
        body: message.body,
        lead_id: lead?.id ?? null,
        contact_id: contact?.id ?? null,
        company_id: contact?.company_id ?? lead?.company_id ?? null,
        owner_id: memberId,
        direction: "inbound",
        provider_message_id: message.id,
        occurred_at: message.date ? new Date(message.date).toISOString() : new Date().toISOString(),
      });
      // A concurrent sync winning the unique-index race is not an error.
      if (!insertError) logged += 1;
    }

    return Response.json({ scanned: ids.length, logged });
  } catch (error) {
    if (error instanceof GmailOAuthError || error instanceof GmailApiError) {
      return Response.json({ error: error.code, message: error.message }, { status: 502 });
    }
    return serverError(error instanceof Error ? error.message : String(error));
  }
}
