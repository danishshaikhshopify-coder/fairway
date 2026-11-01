// Manual "Sync Now" — dry_run previews the plan, apply writes it. Both modes
// require owner/admin (this can bulk-create/update CRM records).

import { badRequest, canConfigure, forbidden, readJson, requireActor, serverError } from "@/lib/api/auth";
import { configFromRow } from "@/lib/integrations/sheets/connection";
import { sheetsConfigured } from "@/lib/integrations/sheets/google";
import { runSheetSync } from "@/lib/integrations/sheets/sync";

export async function POST(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, role, memberId } = result.actor;
  if (!canConfigure(role)) return forbidden("Only an owner or admin can run a sync.");

  const body = await readJson<{ mode?: string }>(request);
  const mode = body?.mode === "apply" ? "apply" : body?.mode === "dry_run" ? "dry_run" : null;
  if (!mode) return badRequest('mode must be "dry_run" or "apply".');

  if (!sheetsConfigured()) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Google Sheets credentials are not set on the server. Set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY, then share the spreadsheet with that service account as Viewer.",
      },
      { status: 503 },
    );
  }

  const { data: connectionRow, error: connectionError } = await db
    .from("integration_connections")
    .select("id, config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google_sheets")
    .maybeSingle();
  if (connectionError) return serverError(connectionError.message);

  const config = connectionRow ? configFromRow((connectionRow as Record<string, unknown>).config) : null;

  try {
    const report = await runSheetSync({
      db,
      workspaceId,
      actorMemberId: memberId,
      mode,
      triggeredBy: "manual",
      connectionId: connectionRow ? String((connectionRow as Record<string, unknown>).id) : null,
      config: config ? { spreadsheetId: config.spreadsheetId, tab: config.tab } : undefined,
      columnMap: config?.columnMap,
    });
    return Response.json({ report });
  } catch (error) {
    return serverError(error instanceof Error ? error.message : String(error));
  }
}
