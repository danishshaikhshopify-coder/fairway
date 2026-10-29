"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Plus, RotateCcw, Trash2 } from "lucide-react";
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

export default function TasksPage() {
  const { tasks, toggleTask, addTask, removeTask, companies, contacts, leads } =
    useCrm();
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

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<TaskForm>(emptyTaskForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    return {
      open: open.length,
      done: tasks.length - open.length,
      overdue: open.filter((t) => isOverdue(t.dueDate, today)).length,
    };
  }, [tasks, today]);

  const filtered = useMemo(() => {
    return tasks
      .filter((task) => {
        if (statusFilter === "open" && task.done) return false;
        if (statusFilter === "done" && !task.done) return false;
        if (priorityFilter !== ALL && task.priority !== priorityFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
  }, [tasks, statusFilter, priorityFilter]);

  const filtersActive = statusFilter !== ALL || priorityFilter !== ALL;

  function resetFilters() {
    setStatusFilter(ALL);
    setPriorityFilter(ALL);
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
        description={`${counts.open} open · ${counts.overdue} overdue · ${counts.done} completed`}
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
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((task) => {
                const overdue = !task.done && isOverdue(task.dueDate, today);
                return (
                  <li
                    key={task.id}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <Checkbox
                      checked={task.done}
                      aria-label={`Mark "${task.title}" as ${
                        task.done ? "open" : "complete"
                      }`}
                      className="mt-0.5"
                      onCheckedChange={() => {
                        toggleTask(task.id);
                        toast.success(
                          task.done
                            ? `"${task.title}" reopened.`
                            : `"${task.title}" completed.`,
                        );
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          task.done && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-xs",
                          overdue
                            ? "font-medium text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {task.relatedTo} · due {formatDate(task.dueDate)}
                        {overdue ? " · overdue" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {TASK_TYPE_LABELS[task.type]}
                      </span>
                      <PriorityBadge priority={task.priority} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete "${task.title}"`}
                        onClick={() => setDeleteTarget(task)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
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
    </div>
  );
}
