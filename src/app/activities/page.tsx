"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { FormField } from "@/components/crm/form-field";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { EmptyState } from "@/components/crm/empty-state";
import { ActivityTypeBadge } from "@/components/crm/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { formatDateTime } from "@/lib/format";
import {
  ACTIVITY_TYPES,
  OWNERS,
  type Activity,
  type ActivityType,
} from "@/lib/types";

const ALL = "all";

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  "follow-up": "Follow-up",
};

const emptyActivityForm = {
  type: "call" as ActivityType,
  subject: "",
  relatedTo: "",
  owner: OWNERS[0],
  date: "",
};

type ActivityForm = typeof emptyActivityForm;

function validateActivityForm(form: ActivityForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.subject.trim()) errors.subject = "Subject is required.";
  if (!form.relatedTo.trim()) errors.relatedTo = "Add a company or lead name.";
  if (!form.date) errors.date = "Pick a date and time.";
  return errors;
}

export default function ActivitiesPage() {
  const { activities, addActivity, removeActivity, companies, contacts, leads } =
    useCrm();

  // Suggestions for the "Related to" free-text field: real record names.
  const recordNames = useMemo(
    () =>
      [...new Set([
        ...companies.map((c) => c.name),
        ...contacts.map((c) => c.name),
        ...leads.map((l) => l.company),
      ])].sort((a, b) => a.localeCompare(b)),
    [companies, contacts, leads],
  );

  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<ActivityForm>(emptyActivityForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activities
      .filter((activity) => {
        if (typeFilter !== ALL && activity.type !== typeFilter) return false;
        if (!query) return true;
        return (
          activity.subject.toLowerCase().includes(query) ||
          activity.relatedTo.toLowerCase().includes(query) ||
          activity.owner.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [activities, typeFilter, search]);

  const filtersActive = typeFilter !== ALL || search.trim() !== "";

  function resetFilters() {
    setTypeFilter(ALL);
    setSearch("");
  }

  function setField<K extends keyof ActivityForm>(key: K, value: ActivityForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validateActivityForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted fields before logging the activity.");
      return;
    }
    const activity: Omit<Activity, "id"> = {
      type: form.type,
      subject: form.subject.trim(),
      relatedTo: form.relatedTo.trim(),
      owner: form.owner,
      date: form.date,
    };
    addActivity(activity);
    setForm({ ...emptyActivityForm, owner: form.owner });
    setErrors({});
    setAddOpen(false);
    toast.success("Activity logged.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activities"
        description={`${filtered.length} of ${activities.length} activities`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            Log activity
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-48 flex-1">
              <Input
                aria-label="Search activities"
                placeholder="Search subject, company or owner…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(String(v))}
            >
              <SelectTrigger className="w-36" aria-label="Filter by type">
                {typeFilter === ALL
                  ? "All types"
                  : ACTIVITY_LABELS[typeFilter as ActivityType]}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {ACTIVITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ACTIVITY_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button variant="ghost" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={
                filtersActive ? "No activity matches your filters" : "No activity yet"
              }
              description={
                filtersActive
                  ? "Try clearing the filters, or log a new activity."
                  : "Log calls, emails and meetings to keep the timeline current."
              }
              action={
                filtersActive ? (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus aria-hidden="true" />
                    Log activity
                  </Button>
                )
              }
            />
          ) : (
            <ol className="space-y-0">
              {filtered.map((activity) => (
                <li
                  key={activity.id}
                  className="relative flex gap-4 border-l border-border pb-5 pl-5 last:pb-0"
                >
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-primary ring-4 ring-background"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ActivityTypeBadge type={activity.type} />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(activity.date)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium">{activity.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {activity.relatedTo} · {activity.owner}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete activity "${activity.subject}"`}
                    onClick={() => setDeleteTarget(activity)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log activity</DialogTitle>
            <DialogDescription>
              Adds a demo activity to this browser session.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <FormField label="Type" required>
              {(p) => (
                <Select
                  value={form.type}
                  onValueChange={(v) => setField("type", v as ActivityType)}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Type">
                    {ACTIVITY_LABELS[form.type]}
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ACTIVITY_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Subject" required error={errors.subject}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Discovery call — 22 min, asked about financing"
                  value={form.subject}
                  onChange={(e) => setField("subject", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Related to" required error={errors.relatedTo}>
              {(p) => (
                <>
                  <Input
                    {...p}
                    placeholder="Company, contact or lead name"
                    list="activity-related-options"
                    value={form.relatedTo}
                    onChange={(e) => setField("relatedTo", e.target.value)}
                  />
                  <datalist id="activity-related-options">
                    {recordNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField label="Date and time" required error={errors.date}>
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  value={form.date}
                  onChange={(e) => setField("date", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Owner" required>
              {(p) => (
                <Select
                  value={form.owner}
                  onValueChange={(v) => setField("owner", String(v))}
                >
                  <SelectTrigger className="w-full" {...p} aria-label="Owner">
                    {form.owner}
                  </SelectTrigger>
                  <SelectContent>
                    {OWNERS.map((owner) => (
                      <SelectItem key={owner} value={owner}>
                        {owner}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Log activity</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete activity?"
        description={
          deleteTarget
            ? `"${deleteTarget.subject}" will be removed from this browser session. This cannot be undone.`
            : ""
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          removeActivity(deleteTarget.id);
          toast.success(`Activity deleted: ${deleteTarget.subject}.`);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
