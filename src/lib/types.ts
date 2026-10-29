// Shared domain types + option constants for the Fairway CRM frontend.
// Everything here is mock/demo shaped: no backend, no database, no auth.

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost";

/** Stages shown on the pipeline board (lost leads are filtered out). */
export type PipelineStage = Exclude<LeadStatus, "lost">;

export type LeadSource =
  | "Website"
  | "Referral"
  | "Trade show"
  | "Cold call"
  | "Partner"
  | "Social";

export type BusinessType = "Seller" | "Installer" | "Both";

export type Country = "USA" | "Canada" | "Mexico";

export type Priority = "low" | "medium" | "high";

export type ActivityType = "call" | "email" | "meeting" | "note" | "follow-up";

export type TaskType = "call" | "email" | "meeting" | "follow-up" | "admin";

export type Qualification =
  | "Qualified"
  | "Needs review"
  | "Pending"
  | "Disqualified";

export interface Lead {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  /** Lead score 0-100 (mock, clearly labelled in the UI). */
  score: number;
  /** Business-fit score 0-100 (mock). */
  fitScore: number;
  businessType: BusinessType;
  /** Estimated deal value in USD (mock). */
  value: number;
  owner: string;
  lastContact: string;
  nextFollowUp: string;
  /** Evidence / source notes for the score (mock). */
  evidence: string;
  /** Evidence of weak follow-up or lead management (mock). */
  followUpEvidence: string;
  qualification: Qualification;
  recommendedAction: string;
}

export interface Company {
  id: string;
  name: string;
  businessType: BusinessType;
  city: string;
  region: string;
  country: Country;
  website: string;
  email: string;
  phone: string;
  fitScore: number;
  owner: string;
  notes: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  owner: string;
}

export interface Task {
  id: string;
  title: string;
  dueDate: string;
  priority: Priority;
  type: TaskType;
  done: boolean;
  relatedTo: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  date: string;
  owner: string;
  relatedTo: string;
}

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
];

export const PIPELINE_STAGES: PipelineStage[] = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
];

export const LEAD_SOURCES: LeadSource[] = [
  "Website",
  "Referral",
  "Trade show",
  "Cold call",
  "Partner",
  "Social",
];

export const BUSINESS_TYPES: BusinessType[] = ["Seller", "Installer", "Both"];

export const COUNTRIES: Country[] = ["USA", "Canada", "Mexico"];

export const PRIORITIES: Priority[] = ["low", "medium", "high"];

export const ACTIVITY_TYPES: ActivityType[] = [
  "call",
  "email",
  "meeting",
  "note",
  "follow-up",
];

export const TASK_TYPES: TaskType[] = [
  "call",
  "email",
  "meeting",
  "follow-up",
  "admin",
];

export const QUALIFICATIONS: Qualification[] = [
  "Qualified",
  "Needs review",
  "Pending",
  "Disqualified",
];

/**
 * Settings → Notifications switches (decision §5.3: stored as 4 typed
 * boolean columns on profiles — `new_lead_alerts`, `daily_digest`,
 * `overdue_reminders`, `weekly_report` — not jsonb).
 */
export interface NotificationPrefs {
  newLeadAlerts: boolean;
  dailyDigest: boolean;
  overdueReminders: boolean;
  weeklyReport: boolean;
}

/** Matches the UI's shipped defaults and the columns' SQL defaults. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newLeadAlerts: true,
  dailyDigest: true,
  overdueReminders: true,
  weeklyReport: false,
};

export const OWNERS = ["A. Rivera", "J. Chen", "M. Thompson", "C. Navarro"];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const PIPELINE_LABELS: Record<PipelineStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
};
