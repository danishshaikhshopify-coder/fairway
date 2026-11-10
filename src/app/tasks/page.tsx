"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Plus, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PriorityBadge } from "@/components/crm/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { useOpenFromQuery } from "@/lib/use-open-from-query";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { formatDate, isOverdue } from "@/lib/format";
import {
  PRIORITIES,
  TASK_TYPES,
  type Priority,
  type Task,
  type TaskType,
} from "@/lib/types";

const ALL = "all";

const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  "follow-up": "Follow-up",
  admin: "Admin",
};

const emptyTaskForm = {
  title: "",
  relatedTo: "",
  dueDate: "",
  priority: "medium" as Priority,
  type: "follow-up" as TaskType,
};

type TaskForm = typeof emptyTaskForm;

function validateTaskForm(form: TaskForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.title.trim()) errors.title = "Task title is required.";
  if (!form.relatedTo.trim()) errors.relatedTo = "Add a company or lead name.";
  if (!form.dueDate) errors.dueDate = "Pick a due date.";
  return errors;
}

const BUCKETS = ["all", "today", "upcoming", "overdue"] as const;
type Bucket = (typeof BUCKETS)[number];

const BUCKET_LABELS: Record<Bucket, string> = {
  all: "All",
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
};

interface TaskRowProps {
  task: Task;
  today: string;
  onToggle: (task: Task) => void;
  onReschedule: (task: Task) => void;
  onCancel: (task: Task) => void;
  onDelete: (task: Task) => void;
}

/** One task row, shared by every section/flat-list render site below. */
function TaskRow({ task, today, onToggle, onReschedule, onCancel, onDelete }: TaskRowProps) {
  const cancelled = Boolean(task.cancelledAt);
  const overdue = !task.done && !cancelled && isOverdue(task.dueDate, today);
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <Checkbox
        checked={task.done}
        disabled={cancelled}
        aria-label={`Mark "${task.title}" as ${task.done ? "open" : "complete"}`}
        className="mt-0.5"
        onCheckedChange={() => onToggle(task)}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            (task.done || cancelled) && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {task.relatedTo} · due {formatDate(task.dueDate)}
          {cancelled ? " · cancelled" : overdue ? " · overdue" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {TASK_TYPE_LABELS[task.type]}
        </span>
        <PriorityBadge priority={task.priority} />
        {!task.done && !cancelled ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Reschedule "${task.title}"`}
              onClick={() => onReschedule(task)}
            >
              <CalendarClock aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Cancel "${task.title}"`}
              onClick={() => onCancel(task)}
            >
              <XCircle aria-hidden="true" />
            </Button>
          </>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete "${task.title}"`}
          onClick={() => onDelete(task)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

interface TaskSection {
  key: string;
  label: string;
  tasks: Task[];
}

/** Groups tasks into named sections for the "all" bucket view — every task
 * lands in exactly one section, so nothing is dropped from view. */
function groupIntoSections(tasks: Task[], today: string): TaskSection[] {
  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const upcoming: Task[] = [];
  const completed: Task[] = [];
  const cancelled: Task[] = [];
  for (const task of tasks) {
    if (task.done) completed.push(task);
    else if (task.cancelledAt) cancelled.push(task);
    else if (isOverdue(task.dueDate, today)) overdue.push(task);
    else if (task.dueDate === today) dueToday.push(task);
    else upcoming.push(task);
  }
  return [
    { key: "overdue", label: "Overdue", tasks: overdue },
    { key: "today", label: "Today", tasks: dueToday },
    { key: "upcoming", label: "Upcoming", tasks: upcoming },
    { key: "completed", label: "Completed", tasks: completed },
    { key: "cancelled", label: "Cancelled", tasks: cancelled },
  ].filter((section) => section.tasks.length > 0);
}

export default function TasksPage() {
  const {
    tasks,
    toggleTask,
    addTask,
    removeTask,
    rescheduleTask,
    cancelTask,
    companies,
    contacts,
    leads,
  } = useCrm();
  const today = useToday();

  // Suggestions for the "Related to" free-text field: real record names,
  // still allowing free text (B1 links records by FK, but this is demo mode).
  const recordNames = useMemo(
    () =>
      [...new Set([
        ...companies.map((c) => c.name),
        ...contacts.map((c) => c.name),
        ...leads.map((l) => l.company),
      ])].sort((a, b) => a.localeCompare(b)),
    [companies, contacts, leads],
  );

  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL);
  const [bucketFilter, setBucketFilter] = useState<Bucket>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<TaskForm>(emptyTaskForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Task | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Task | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

  // Command palette "New task" (/tasks?new=1).
  useOpenFromQuery("new", () => setAddOpen(true));

  const counts = useMemo(() => {
    const open = tasks.filter((t) => !t.done && !t.cancelledAt);
    return {
      open: open.length,
      done: tasks.filter((t) => t.done).length,
      today: open.filter((t) => t.dueDate === today).length,
      upcoming: open.filter((t) => t.dueDate > today).length,
      overdue: open.filter((t) => isOverdue(t.dueDate, today)).length,
    };
  }, [tasks, today]);

  function matchesBucket(task: Task): boolean {
    if (bucketFilter === "all") return true;
    if (task.done || task.cancelledAt) return false;
    if (bucketFilter === "today") return task.dueDate === today;
    if (bucketFilter === "upcoming") return task.dueDate > today;
    return isOverdue(task.dueDate, today);
  }

  const filtered = useMemo(() => {
    return tasks
      .filter((task) => {
        if (statusFilter === "open" && task.done) return false;
        if (statusFilter === "done" && !task.done) return false;
        if (priorityFilter !== ALL && task.priority !== priorityFilter) return false;
        if (!matchesBucket(task)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesBucket closes over bucketFilter/today, listed below
  }, [tasks, statusFilter, priorityFilter, bucketFilter, today]);

  const filtersActive = statusFilter !== ALL || priorityFilter !== ALL || bucketFilter !== "all";

  function resetFilters() {
    setStatusFilter(ALL);
    setPriorityFilter(ALL);
    setBucketFilter("all");
  }

  function handleToggle(task: Task) {
    toggleTask(task.id);
    toast.success(task.done ? `"${task.title}" reopened.` : `"${task.title}" completed.`);
  }

  function openReschedule(task: Task) {
    setRescheduleDate(task.dueDate);
    setRescheduleTarget(task);
  }

  function setField<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
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
    const nextErrors = validateTaskForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted fields before adding the task.");
      return;
    }
    const task: Omit<Task, "id"> = {
      title: form.title.trim(),
      relatedTo: form.relatedTo.trim(),
      dueDate: form.dueDate,
      priority: form.priority,
      type: form.type,
      done: false,
      cancelledAt: null,
    };
    addTask(task);
    setForm(emptyTaskForm);
    setErrors({});
    setAddOpen(false);
    toast.success("Task added.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description={`${counts.today} today · ${counts.upcoming} upcoming · ${counts.overdue} overdue · ${counts.done} completed`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" />
            Add task
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={bucketFilter}
              onValueChange={(v) => setBucketFilter(v as Bucket)}
            >
              <SelectTrigger className="w-36" aria-label="Filter by due date">
                {BUCKET_LABELS[bucketFilter]}
              </SelectTrigger>
              <SelectContent>
                {BUCKETS.map((bucket) => (
                  <SelectItem key={bucket} value={bucket}>
                    {BUCKET_LABELS[bucket]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(String(v))}
            >
              <SelectTrigger className="w-36" aria-label="Filter by status">
                {statusFilter === ALL
                  ? "All tasks"
                  : statusFilter === "open"
                    ? "Open only"
                    : "Completed only"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All tasks</SelectItem>
                <SelectItem value="open">Open only</SelectItem>
                <SelectItem value="done">Completed only</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={priorityFilter}
              onValueChange={(v) => setPriorityFilter(String(v))}
            >
              <SelectTrigger className="w-36" aria-label="Filter by priority">
                {priorityFilter === ALL
                  ? "All priorities"
                  : PRIORITY_LABELS[priorityFilter as Priority]}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All priorities</SelectItem>
                {PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
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
              icon={CheckCircle2}
              title={filtersActive ? "No tasks match your filters" : "No tasks yet"}
              description={
                filtersActive
                  ? "Try clearing the filters."
                  : "Add a task to start tracking follow-ups."
              }
              action={
                filtersActive ? (
                  <Button variant="outline" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setAddOpen(true)}>
                    <Plus aria-hidden="true" />
                    Add task
                  </Button>
                )
              }
            />
          ) : bucketFilter === "all" ? (
            <div className="space-y-5">
              {groupIntoSections(filtered, today).map((section) => (
                <div key={section.key}>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {section.label} ({section.tasks.length})
                  </h3>
                  <ul className="divide-y divide-border">
                    {section.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        today={today}
                        onToggle={handleToggle}
                        onReschedule={openReschedule}
                        onCancel={setCancelTarget}
                        onDelete={setDeleteTarget}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  onToggle={handleToggle}
                  onReschedule={openReschedule}
                  onCancel={setCancelTarget}
                  onDelete={setDeleteTarget}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add task</DialogTitle>
            <DialogDescription>
              Adds a demo task to this browser session.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <FormField label="Title" required error={errors.title}>
              {(p) => (
                <Input
                  {...p}
                  placeholder="Send financing one-pager"
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Related to" required error={errors.relatedTo}>
              {(p) => (
                <>
                  <Input
                    {...p}
                    placeholder="Company, contact or lead name"
                    list="task-related-options"
                    value={form.relatedTo}
                    onChange={(e) => setField("relatedTo", e.target.value)}
                  />
                  <datalist id="task-related-options">
                    {recordNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField label="Due date" required error={errors.dueDate}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setField("dueDate", e.target.value)}
                />
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Priority" required>
                {(p) => (
                  <Select
                    value={form.priority}
                    onValueChange={(v) => setField("priority", v as Priority)}
                  >
                    <SelectTrigger className="w-full" {...p} aria-label="Priority">
                      {PRIORITY_LABELS[form.priority]}
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Type" required>
                {(p) => (
                  <Select
                    value={form.type}
                    onValueChange={(v) => setField("type", v as TaskType)}
                  >
                    <SelectTrigger className="w-full" {...p} aria-label="Type">
                      {TASK_TYPE_LABELS[form.type]}
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {TASK_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add task</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete task?"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" will be removed from this browser session. This cannot be undone.`
            : ""
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          removeTask(deleteTarget.id);
          toast.success(`Task deleted: ${deleteTarget.title}.`);
          setDeleteTarget(null);
        }}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Cancel task?"
        description={
          cancelTarget
            ? `"${cancelTarget.title}" will be marked cancelled and kept for your records. It will not be regenerated.`
            : ""
        }
        confirmLabel="Cancel task"
        onConfirm={() => {
          if (!cancelTarget) return;
          cancelTask(cancelTarget.id);
          toast.success(`"${cancelTarget.title}" cancelled.`);
          setCancelTarget(null);
        }}
      />

      <Dialog
        open={rescheduleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRescheduleTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule task</DialogTitle>
            <DialogDescription>
              {rescheduleTarget ? `Pick a new due date for "${rescheduleTarget.title}".` : ""}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="date"
            value={rescheduleDate}
            onChange={(e) => setRescheduleDate(e.target.value)}
            aria-label="New due date"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rescheduleTarget || !rescheduleDate) return;
                rescheduleTask(rescheduleTarget.id, rescheduleDate);
                toast.success(`"${rescheduleTarget.title}" rescheduled to ${formatDate(rescheduleDate)}.`);
                setRescheduleTarget(null);
              }}
              disabled={!rescheduleDate}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
