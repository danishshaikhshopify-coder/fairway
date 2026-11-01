// Gmail connection status — each member reads/deletes ONLY their own row
// (see the b4 migration: unlike Google Sheets this is a personal credential,
// not workspace-shared config).

import { requireActor, serverError } from "@/lib/api/auth";
import { gmailOAuthConfigured } from "@/lib/integrations/gmail/oauth";

interface GmailConnectionRow {
  email: string | null;
  scopes: string | null;
  connected_at: string | null;
  last_error: string | null;
}

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, memberId } = result.actor;

  const { data, error } = await db
    .from("gmail_connections")
    .select("email, scopes, connected_at, last_error")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) return serverError(error.message);

  const row = data as GmailConnectionRow | null;
  return Response.json({
    oauthConfigured: gmailOAuthConfigured(),
    connected: Boolean(row?.connected_at),
    email: row?.email ?? null,
    scopes: row?.scopes ?? null,
    lastError: row?.last_error ?? null,
  });
}

export async function DELETE(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, memberId } = result.actor;

  const { error } = await db.from("gmail_connections").delete().eq("member_id", memberId);
  if (error) return serverError(error.message);

  return Response.json({ disconnected: true });
}
