// Google Sheets connection config — read by every member, written by
// owner/admin only. Never returns credentials (they are not stored here).

import {
  badRequest,
  canConfigure,
  forbidden,
  readJson,
  requireActor,
  serverError,
} from "@/lib/api/auth";
import {
  connectionFromRow,
  validateConnectionInput,
  type SheetsConnection,
} from "@/lib/integrations/sheets/connection";
import { DEFAULT_SPREADSHEET_ID, DEFAULT_TAB } from "@/lib/integrations/sheets/model";
import { sheetsConfigured } from "@/lib/integrations/sheets/google";

export async function GET(): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId } = result.actor;

  const { data, error } = await db
    .from("integration_connections")
    .select(
      "id, is_enabled, config, auto_sync, sync_interval_minutes, last_synced_at, last_status, last_error",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", "google_sheets")
    .maybeSingle();
  if (error) return serverError(error.message);

  const connection: SheetsConnection | null = data
    ? connectionFromRow(data as Record<string, unknown>)
    : null;

  return Response.json({
    connection,
    credentialsConfigured: sheetsConfigured(),
    defaults: { spreadsheetId: DEFAULT_SPREADSHEET_ID, tab: DEFAULT_TAB },
  });
}

export async function PUT(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, role, memberId } = result.actor;
  if (!canConfigure(role)) return forbidden("Only an owner or admin can change this connection.");

  const body = await readJson(request);
  const validated = validateConnectionInput(body);
  if (!validated.ok) return badRequest(validated.error);
  const input = validated.value;

  const { data, error } = await db
    .from("integration_connections")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "google_sheets",
        is_enabled: true,
        config: {
          spreadsheetId: input.spreadsheetId,
          tab: input.tab,
          columnMap: input.columnMap,
        },
        auto_sync: input.autoSync,
        sync_interval_minutes: input.syncIntervalMinutes,
        created_by: memberId,
      },
      { onConflict: "workspace_id,provider" },
    )
    .select(
      "id, is_enabled, config, auto_sync, sync_interval_minutes, last_synced_at, last_status, last_error",
    )
    .single();
  if (error) return serverError(error.message);

  return Response.json({ connection: connectionFromRow(data as Record<string, unknown>) });
}
