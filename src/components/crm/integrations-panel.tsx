"use client";

// Settings → Integrations. Google Sheets is fully wired to the sync API
// routes. Gmail has a real OAuth connect/disconnect flow (see
// src/lib/integrations/gmail/oauth.ts) but no send/receive yet — that needs
// a connected mailbox to test against. Instagram/LinkedIn are blocked by
// the platforms themselves; see each card's description.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Mail, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isLiveMode } from "@/lib/supabase/client";
import type { SheetsConnection, SheetsRunSummary } from "@/lib/integrations/sheets/connection";

interface ConnectionResponse {
  connection: SheetsConnection | null;
  credentialsConfigured: boolean;
  defaults: { spreadsheetId: string; tab: string };
}

interface SyncReportCounts {
  totalRows: number;
  companies: { create: number; update: number; skip: number };
  contacts: { create: number; update: number; skip: number };
  leads: { create: number; update: number; skip: number };
  skippedRows: number;
  invalidRows: number;
  duplicateRows: number;
}

interface SyncReport {
  runId: string;
  mode: "dry_run" | "apply";
  status: "completed" | "partial" | "failed";
  spreadsheetTitle: string;
  tab: string;
  counts: SyncReportCounts;
  invalid: { line: number; errors: string[] }[];
  duplicates: { line: number; reason: string }[];
  errors: { line: number; message: string }[];
  errorSummary: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Request failed (${response.status}).`);
  }
  return body;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "never") return <Badge variant="outline">Never synced</Badge>;
  if (status === "ok" || status === "completed") return <Badge>OK</Badge>;
  if (status === "partial") return <Badge variant="secondary">Partial</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

function CountRow({ counts }: { counts: SyncReportCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(
        [
          ["Companies", counts.companies],
          ["Contacts", counts.contacts],
          ["Leads", counts.leads],
        ] as const
      ).map(([label, c]) => (
        <div key={label} className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm">
            <span className="font-medium text-foreground">{c.create}</span> new ·{" "}
            <span className="font-medium text-foreground">{c.update}</span> update ·{" "}
            <span className="text-muted-foreground">{c.skip}</span> skip
          </p>
        </div>
      ))}
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground">Rows</p>
        <p className="text-sm">
          <span className="font-medium text-foreground">{counts.totalRows}</span> total ·{" "}
          <span className="text-muted-foreground">{counts.invalidRows}</span> invalid ·{" "}
          <span className="text-muted-foreground">{counts.duplicateRows}</span> dup
        </p>
      </div>
    </div>
  );
}

function GoogleSheetsCard() {
  const live = isLiveMode();
  const [loading, setLoading] = useState(live);
  const [credentialsConfigured, setCredentialsConfigured] = useState(false);
  const [defaults, setDefaults] = useState({ spreadsheetId: "", tab: "" });
  const [connection, setConnection] = useState<SheetsConnection | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [tab, setTab] = useState("");
  const [autoSync, setAutoSync] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("360");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<"dry_run" | "apply" | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [runs, setRuns] = useState<SheetsRunSummary[]>([]);

  async function loadConnection() {
    setLoading(true);
    try {
      const data = await api<ConnectionResponse>("/api/integrations/google-sheets/connection");
      setCredentialsConfigured(data.credentialsConfigured);
      setDefaults(data.defaults);
      setConnection(data.connection);
      setSpreadsheetId(data.connection?.config.spreadsheetId ?? data.defaults.spreadsheetId);
      setTab(data.connection?.config.tab ?? data.defaults.tab);
      setAutoSync(data.connection?.autoSync ?? false);
      setIntervalMinutes(String(data.connection?.syncIntervalMinutes ?? 360));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the connection.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRuns() {
    try {
      const data = await api<{ runs: SheetsRunSummary[] }>(
        "/api/integrations/google-sheets/runs?limit=10",
      );
      setRuns(data.runs);
    } catch {
      // Non-fatal: history is secondary to the connection form.
    }
  }

  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(() => {
      loadConnection();
      loadRuns();
    }, 0);
    return () => clearTimeout(timer);
  }, [live]);

  async function saveConnection() {
    setSaving(true);
    try {
      const data = await api<{ connection: SheetsConnection }>(
        "/api/integrations/google-sheets/connection",
        {
          method: "PUT",
          body: JSON.stringify({
            spreadsheetId,
            tab,
            autoSync,
            syncIntervalMinutes: Number(intervalMinutes) || 360,
          }),
        },
      );
      setConnection(data.connection);
      toast.success("Google Sheets connection saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the connection.");
    } finally {
      setSaving(false);
    }
  }

  async function runSync(mode: "dry_run" | "apply") {
    setRunning(mode);
    try {
      const data = await api<{ report: SyncReport }>("/api/integrations/google-sheets/sync", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      setReport(data.report);
      if (mode === "apply") {
        toast.success(
          `Import applied: ${data.report.counts.companies.create + data.report.counts.contacts.create + data.report.counts.leads.create} new record(s), ${data.report.counts.companies.update + data.report.counts.contacts.update + data.report.counts.leads.update} updated.`,
        );
        loadRuns();
        loadConnection();
      } else {
        toast.info("Dry-run complete — review the plan before applying it.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setRunning(null);
    }
  }

  if (!live) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Google Sheets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect to live mode (Supabase configured) to set up the Google Sheets sync.
            This runs entirely server-side — no spreadsheet data reaches the browser until
            you review a dry-run report here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Google Sheets</CardTitle>
          {connection ? <StatusBadge status={connection.lastStatus} /> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {!credentialsConfigured ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
              <p>
                Server credentials are not set. An owner/admin must set{" "}
                <code className="rounded bg-muted px-1">GOOGLE_SHEETS_CLIENT_EMAIL</code> and{" "}
                <code className="rounded bg-muted px-1">GOOGLE_SHEETS_PRIVATE_KEY</code> (a Google
                Cloud service account with the Sheets API enabled), then share the spreadsheet with
                that service account as Viewer. The form below can still be saved, but sync will
                fail until credentials are set.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sheets-id">Spreadsheet (URL or id)</Label>
              <Input
                id="sheets-id"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder={defaults.spreadsheetId}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sheets-tab">Tab name</Label>
              <Input
                id="sheets-tab"
                value={tab}
                onChange={(e) => setTab(e.target.value)}
                placeholder={defaults.tab}
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="sheets-autosync">Automatic sync</Label>
              <p className="text-xs text-muted-foreground">
                Applies on a schedule (needs a cron job pointed at the sync endpoint — see setup
                notes).
              </p>
            </div>
            <Switch
              id="sheets-autosync"
              checked={autoSync}
              onCheckedChange={(checked) => setAutoSync(Boolean(checked))}
              disabled={loading}
            />
          </div>

          {autoSync ? (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="sheets-interval">Sync interval (minutes)</Label>
              <Input
                id="sheets-interval"
                type="number"
                min={15}
                max={10080}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value)}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={saveConnection} disabled={saving || loading}>
              Save connection
            </Button>
            <Button
              variant="outline"
              onClick={() => runSync("dry_run")}
              disabled={running !== null || loading}
            >
              <RefreshCw aria-hidden="true" className={running === "dry_run" ? "animate-spin" : ""} />
              Preview sync (dry run)
            </Button>
            {report && report.mode === "dry_run" && report.status !== "failed" ? (
              <Button onClick={() => setConfirmApply(true)} disabled={running !== null}>
                Apply this import
              </Button>
            ) : null}
          </div>

          {connection?.lastError ? (
            <p className="text-sm text-destructive">Last run error: {connection.lastError}</p>
          ) : null}

          {report ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {report.mode === "apply" ? "Last applied import" : "Dry-run preview"} —{" "}
                  {report.spreadsheetTitle || "Google Sheet"} / {report.tab}
                </p>
                <StatusBadge status={report.status} />
              </div>
              <CountRow counts={report.counts} />
              {report.invalid.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {report.invalid.length} row(s) could not be imported (missing company name, etc.).
                </p>
              ) : null}
              {report.errorSummary ? (
                <p className="text-sm text-destructive">{report.errorSummary}</p>
              ) : null}
            </div>
          ) : null}

          {runs.length > 0 ? (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">Sync history</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Created / updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(run.startedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">{run.mode === "apply" ? "Apply" : "Dry run"}</TableCell>
                        <TableCell className="text-sm capitalize">{run.triggeredBy}</TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                          {run.companiesCreated + run.contactsCreated + run.leadsCreated} new /{" "}
                          {run.companiesUpdated + run.contactsUpdated + run.leadsUpdated} updated
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmApply}
        onOpenChange={setConfirmApply}
        title="Apply this import?"
        description={
          report
            ? `This writes ${report.counts.companies.create + report.counts.contacts.create + report.counts.leads.create} new and ${report.counts.companies.update + report.counts.contacts.update + report.counts.leads.update} updated record(s) to the CRM. Blank spreadsheet cells never overwrite existing values. This cannot be bulk-undone.`
            : ""
        }
        confirmLabel="Apply import"
        onConfirm={() => runSync("apply")}
      />
    </>
  );
}

interface GmailConnectionResponse {
  oauthConfigured: boolean;
  connected: boolean;
  email: string | null;
  scopes: string | null;
  lastError: string | null;
}

function GmailCard() {
  const live = isLiveMode();
  const [loading, setLoading] = useState(live);
  const [status, setStatus] = useState<GmailConnectionResponse | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await api<GmailConnectionResponse>("/api/integrations/gmail/connection");
      setStatus(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Gmail status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!live) return;
    const gmailError = new URLSearchParams(window.location.search).get("gmailError");
    const timer = setTimeout(() => {
      setRedirectUri(`${window.location.origin}/api/integrations/gmail/callback`);
      load();
      if (gmailError) {
        toast.error(gmailError);
        const url = new URL(window.location.href);
        url.searchParams.delete("gmailError");
        window.history.replaceState({}, "", url.toString());
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [live]);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api("/api/integrations/gmail/connection", { method: "DELETE" });
      toast.success("Gmail disconnected.");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect Gmail.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function syncInbox() {
    setSyncing(true);
    try {
      const result = await api<{ scanned: number; logged: number; message?: string }>(
        "/api/integrations/gmail/sync",
        { method: "POST" },
      );
      toast.success(
        result.message ?? `Scanned ${result.scanned} message(s), logged ${result.logged} new.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync inbox.");
    } finally {
      setSyncing(false);
    }
  }

  if (!live) {
    return (
      <PlaceholderIntegrationCard
        title="Gmail"
        status="Setup required"
        description="Connect to live mode (Supabase configured) to connect a Gmail mailbox."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Gmail</CardTitle>
        {status ? (
          <Badge variant={status.connected ? "default" : "outline"}>
            {status.connected ? "Connected" : status.oauthConfigured ? "Not connected" : "Setup required"}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {status && !status.oauthConfigured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <div className="space-y-1">
              <p>
                Server OAuth credentials are not set. Create an OAuth 2.0 Web client in Google Cloud
                Console (Gmail API enabled), then set{" "}
                <code className="rounded bg-muted px-1">GMAIL_OAUTH_CLIENT_ID</code> and{" "}
                <code className="rounded bg-muted px-1">GMAIL_OAUTH_CLIENT_SECRET</code> on the server.
              </p>
              <p>
                Authorized redirect URI:{" "}
                <code className="rounded bg-muted px-1 break-all">{redirectUri}</code>
              </p>
              <p>
                Scopes requested: <code className="rounded bg-muted px-1">gmail.readonly</code>,{" "}
                <code className="rounded bg-muted px-1">gmail.send</code>. These are sensitive scopes —
                Google requires app verification (a CASA security assessment) before any account
                outside your own test users can connect in production.
              </p>
            </div>
          </div>
        ) : null}

        {status?.connected ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">
              Connected as <span className="font-medium text-foreground">{status.email}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={syncInbox} disabled={syncing || loading}>
                <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
                Sync inbox
              </Button>
              <Button variant="outline" onClick={disconnect} disabled={disconnecting || loading}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : status?.oauthConfigured ? (
          <a href="/api/integrations/gmail/authorize" className={buttonVariants({})}>
            Connect your Gmail
          </a>
        ) : null}

        {status?.lastError ? (
          <p className="text-sm text-destructive">Last error: {status.lastError}</p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Sending (from a lead or contact) and &ldquo;Sync inbox&rdquo; above both use this connection. Inbox
          sync matches senders/recipients against known lead/contact emails and logs each new
          message as an activity — a re-sync never double-logs the same message.
        </p>
      </CardContent>
    </Card>
  );
}

function PlaceholderIntegrationCard({
  title,
  status,
  description,
}: {
  title: string;
  status: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge variant="outline">{status}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <GoogleSheetsCard />
      <GmailCard />
      <PlaceholderIntegrationCard
        title="Instagram"
        status="Blocked"
        description="Instagram's Messaging API only reaches people who messaged your business first, and requires a Meta app in App Review plus a linked Instagram professional account. There is no API for a CRM to start new Instagram DMs from here."
      />
      <PlaceholderIntegrationCard
        title="LinkedIn"
        status="Blocked"
        description="LinkedIn does not offer a public messaging API to third-party apps at all — only a small set of approved partners (e.g. certain ATS/CRM partners) can send LinkedIn messages programmatically. This cannot be built without LinkedIn accepting Fairway CRM into that partner program."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Mail aria-hidden="true" className="size-4" /> Email activity on leads
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Manual notes/activities are already logged on each lead today (Activities page). Once
            Gmail is connected, its messages would log here the same way, tagged with the
            provider&apos;s message id so a re-sync never double-logs the same email.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
