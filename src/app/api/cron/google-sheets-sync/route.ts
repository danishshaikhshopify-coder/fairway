// Scheduled sync entry point — called by an external scheduler (Vercel Cron,
// Supabase pg_cron, or any cron host), never by a signed-in user. Auth is a
// shared secret, not a session: set CRON_SECRET on the server and configure
// the scheduler to send `Authorization: Bearer <CRON_SECRET>` (this is what
// Vercel Cron does automatically when CRON_SECRET is set as an env var).
//
// For every workspace with Google Sheets auto-sync enabled whose interval has
// elapsed, runs an APPLY (not a preview — that is the point of "automatic").
// Each run is still written to sheet_sync_runs for audit/rollback visibility,
// and the same blank-never-overwrites / stable-sync_key safety in sync.ts
// applies here exactly as it does to a manual run.

import { getServiceSupabase } from "@/lib/supabase/server";
import { configFromRow } from "@/lib/integrations/sheets/connection";
import { sheetsConfigured } from "@/lib/integrations/sheets/google";
import { runSheetSync } from "@/lib/integrations/sheets/sync";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!sheetsConfigured()) {
    return Response.json({ error: "not_configured", ran: 0 }, { status: 200 });
  }

  const db = getServiceSupabase();
  if (!db) {
    return Response.json({ error: "supabase_not_configured", ran: 0 }, { status: 200 });
  }

  const { data: connections, error } = await db
    .from("integration_connections")
    .select("id, workspace_id, config, auto_sync, sync_interval_minutes, last_synced_at, is_enabled")
    .eq("provider", "google_sheets")
    .eq("is_enabled", true)
    .eq("auto_sync", true);
  if (error) {
    return Response.json({ error: error.message, ran: 0 }, { status: 500 });
  }

  const now = Date.now();
  const due = (connections ?? []).filter((row) => {
    const lastSyncedAt = (row as Record<string, unknown>).last_synced_at as string | null;
    if (!lastSyncedAt) return true;
    const intervalMs = Number((row as Record<string, unknown>).sync_interval_minutes ?? 360) * 60_000;
    return now - new Date(lastSyncedAt).getTime() >= intervalMs;
  });

  const results: { workspaceId: string; status: string; error?: string }[] = [];
  for (const row of due) {
    const r = row as Record<string, unknown>;
    const workspaceId = String(r.workspace_id);
    const config = configFromRow(r.config);
    try {
      const report = await runSheetSync({
        db,
        workspaceId,
        actorMemberId: null,
        mode: "apply",
        triggeredBy: "scheduled",
        connectionId: String(r.id),
        config: { spreadsheetId: config.spreadsheetId, tab: config.tab },
        columnMap: config.columnMap,
      });
      results.push({ workspaceId, status: report.status });
    } catch (syncError) {
      results.push({
        workspaceId,
        status: "failed",
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }
  }

  return Response.json({ ran: results.length, results });
}
