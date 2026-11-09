// Send a real email through the signed-in member's own connected Gmail
// account, then log it as an 'email' activity (outbound) linked to the
// lead/contact/company it was sent about, if one was given.

import { badRequest, requireActor, serverError } from "@/lib/api/auth";
import { sendEmail, GmailApiError } from "@/lib/integrations/gmail/api";
import { getValidAccessToken, GmailOAuthError } from "@/lib/integrations/gmail/oauth";

interface SendBody {
  to?: string;
  subject?: string;
  body?: string;
  leadId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, memberId } = result.actor;

  const payload = (await request.json().catch(() => null)) as SendBody | null;
  const to = payload?.to?.trim() ?? "";
  const subject = payload?.subject?.trim() ?? "";
  const body = payload?.body ?? "";
  if (!EMAIL_RE.test(to)) return badRequest("A valid recipient email is required.");
  if (!subject) return badRequest("Subject is required.");
  if (!body.trim()) return badRequest("Email body is required.");

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

  try {
    const accessToken = await getValidAccessToken(db, connection);
    const sent = await sendEmail(accessToken, { to, subject, body });

    const { error: activityError } = await db.from("activities").insert({
      workspace_id: workspaceId,
      type: "email",
      subject,
      body,
      lead_id: payload?.leadId ?? null,
      contact_id: payload?.contactId ?? null,
      company_id: payload?.companyId ?? null,
      owner_id: memberId,
      direction: "outbound",
      provider_message_id: sent.id,
    });
    if (activityError) return serverError(activityError.message);

    return Response.json({ sent: true, messageId: sent.id });
  } catch (error) {
    if (error instanceof GmailOAuthError || error instanceof GmailApiError) {
      return Response.json({ error: error.code, message: error.message }, { status: 502 });
    }
    return serverError(error instanceof Error ? error.message : String(error));
  }
}
