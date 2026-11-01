// Sync history — any workspace member may read it (same as the Settings page
// showing who ran what and when). No write endpoint: only the server writes
// these rows (see sheet_sync_runs RLS policies).

import { requireActor, serverError } from "@/lib/api/auth";
import { runFromRow } from "@/lib/integrations/sheets/connection";

export async function GET(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId } = result.actor;

  const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, Math.round(limitParam))) : 20;

  const { data, error } = await db
    .from("sheet_sync_runs")
    .select(
      "id, mode, triggered_by, status, sheet_title, total_rows, companies_created, companies_updated, contacts_created, contacts_updated, leads_created, leads_updated, skipped_rows, invalid_rows, error_summary, started_at, finished_at",
    )
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return serverError(error.message);

  return Response.json({
    runs: (data ?? []).map((row) => runFromRow(row as Record<string, unknown>)),
  });
}
