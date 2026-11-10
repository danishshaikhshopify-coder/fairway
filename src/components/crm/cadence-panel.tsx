"use client";

// Settings -> Follow-ups. "Admin can configure follow-up intervals and
// channels" (owner/admin only) maps to the canEdit flag GET returns — see
// canConfigure() in src/app/api/settings/cadence/route.ts. A non-admin
// member sees the cadence read-only, same read-only-on-403 pattern as
// TeamPanel's isOwner flag, just driven by an explicit field instead of a
// second request succeeding or failing.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isLiveMode } from "@/lib/supabase/client";
import { CHANNELS, type CadenceStepConfig, type Channel } from "@/lib/cadence/engine";

const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  call: "Call",
};

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

export function CadencePanel() {
  const live = isLiveMode();
  const [loading, setLoading] = useState(live);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [steps, setSteps] = useState<CadenceStepConfig[]>([]);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ steps: CadenceStepConfig[]; canEdit: boolean }>("/api/settings/cadence");
      setSteps(data.steps);
      setCanEdit(data.canEdit);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the follow-up cadence.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [live]);

  function addStep() {
    const nextNumber = steps.length ? Math.max(...steps.map((s) => s.stepNumber)) + 1 : 1;
    setSteps((prev) => [...prev, { stepNumber: nextNumber, intervalDays: 3, channel: "email" }]);
  }

  function removeStep(stepNumber: number) {
    setSteps((prev) => prev.filter((s) => s.stepNumber !== stepNumber));
  }

  function updateStep(stepNumber: number, patch: Partial<CadenceStepConfig>) {
    setSteps((prev) => prev.map((s) => (s.stepNumber === stepNumber ? { ...s, ...patch } : s)));
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings/cadence", { method: "PUT", body: JSON.stringify({ steps }) });
      toast.success("Follow-up cadence saved.");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the cadence.");
    } finally {
      setSaving(false);
    }
  }

  if (!live) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Follow-ups</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect to live mode (Supabase configured) to configure the follow-up cadence.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const totalDays = sorted.reduce((sum, s) => sum + s.intervalDays, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-up cadence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Each step generates a task that reminds you to follow up — the CRM never contacts a lead
          for you. Completing a step&apos;s task schedules the next one automatically.
          {!canEdit ? " Only an owner or admin can change this." : null}
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step</TableHead>
              <TableHead>Days after previous step</TableHead>
              <TableHead>Channel</TableHead>
              {canEdit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((step) => (
              <TableRow key={step.stepNumber}>
                <TableCell>{step.stepNumber}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={step.intervalDays}
                      onChange={(e) =>
                        updateStep(step.stepNumber, { intervalDays: Number(e.target.value) || 1 })
                      }
                    />
                  ) : (
                    step.intervalDays
                  )}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      value={step.channel}
                      onValueChange={(v) => updateStep(step.stepNumber, { channel: v as Channel })}
                    >
                      <SelectTrigger className="w-36">{CHANNEL_LABEL[step.channel]}</SelectTrigger>
                      <SelectContent>
                        {CHANNELS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CHANNEL_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    CHANNEL_LABEL[step.channel]
                  )}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => removeStep(step.stepNumber)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {!loading && sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 4 : 3} className="text-center text-sm text-muted-foreground">
                  No follow-up steps configured.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {sorted.length > 0 ? (
          <p className="text-xs text-muted-foreground">Full cadence spans {totalDays} days.</p>
        ) : null}

        {canEdit ? (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="outline" onClick={addStep}>
              <Plus className="size-4" aria-hidden="true" />
              Add step
            </Button>
            <Button onClick={save} disabled={saving}>
              Save changes
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
