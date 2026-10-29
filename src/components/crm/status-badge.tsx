import { Badge } from "@/components/ui/badge";
import type {
  ActivityType,
  BusinessType,
  LeadStatus,
  Priority,
  Qualification,
} from "@/lib/types";
import { LEAD_STATUS_LABELS } from "@/lib/types";

const STATUS_CLASSES: Record<LeadStatus, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-transparent",
  contacted:
    "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-transparent",
  qualified:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent",
  proposal:
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-transparent",
  won: "bg-primary/15 text-primary border-transparent",
  lost: "bg-muted text-muted-foreground border-transparent",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY_CLASSES: Record<Priority, string> = {
  high: "bg-destructive/15 text-destructive border-transparent",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-transparent",
  low: "bg-muted text-muted-foreground border-transparent",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="outline" className={PRIORITY_CLASSES[priority]}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
  "follow-up": "Follow-up",
};

export function ActivityTypeBadge({ type }: { type: ActivityType }) {
  return <Badge variant="secondary">{ACTIVITY_LABELS[type]}</Badge>;
}

export function BusinessTypeBadge({ type }: { type: BusinessType }) {
  return <Badge variant="outline">{type}</Badge>;
}

const QUALIFICATION_CLASSES: Record<Qualification, string> = {
  Qualified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "Needs review":
    "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Pending: "bg-muted text-muted-foreground",
  Disqualified: "bg-destructive/15 text-destructive",
};

export function QualificationBadge({
  qualification,
}: {
  qualification: Qualification;
}) {
  return (
    <Badge variant="outline" className={QUALIFICATION_CLASSES[qualification]}>
      {qualification}
    </Badge>
  );
}
