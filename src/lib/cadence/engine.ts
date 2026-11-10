// Pure follow-up cadence math: no DB, no fetch, no React. Everything here is
// unit-testable directly (tests/cadence-engine.test.ts) and is the single
// source of truth for "what's the next step, and when is it due" — both the
// cron (src/app/api/cron/follow-ups) and the complete-task route
// (src/app/api/tasks/complete) call into this, so the schedule can never
// drift between "a new lead's first step" and "the step after completion".

export type Channel = "email" | "linkedin" | "whatsapp" | "call";

export const CHANNELS: Channel[] = ["email", "linkedin", "whatsapp", "call"];

export interface CadenceStepConfig {
  stepNumber: number;
  intervalDays: number;
  channel: Channel;
}

export interface NextStepResult {
  stepNumber: number;
  dueDate: string;
  channel: Channel;
}

/** Adds calendar days to a "YYYY-MM-DD" date-only string. Pure, UTC-based so it never shifts with the server's local timezone. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Given the configured steps, how far a lead has already progressed
 * (0 = no step generated yet), and the anchor date its next interval counts
 * from, returns the next step to generate — or null when the cadence is
 * exhausted (no step configured after the current one).
 */
export function computeNextStep(
  steps: CadenceStepConfig[],
  currentStep: number,
  anchorDate: string,
): NextStepResult | null {
  if (!anchorDate) return null;
  const next = steps.find((s) => s.stepNumber === currentStep + 1);
  if (!next) return null;
  return {
    stepNumber: next.stepNumber,
    dueDate: addDaysIso(anchorDate, next.intervalDays),
    channel: next.channel,
  };
}

/** A lead stops generating follow-ups once paused, or once the deal is closed. */
export function isEligibleForCadence(lead: {
  status: string;
  cadencePaused: boolean;
}): boolean {
  return !lead.cadencePaused && lead.status !== "won" && lead.status !== "lost";
}

/** Validates the admin's Settings form payload before it touches the DB. */
export function validateCadenceSteps(input: unknown): CadenceStepConfig[] | null {
  if (!Array.isArray(input)) return null;
  const steps: CadenceStepConfig[] = [];
  const seen = new Set<number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const stepNumber = Number(r.stepNumber);
    const intervalDays = Number(r.intervalDays);
    const channel = String(r.channel ?? "");
    if (!Number.isInteger(stepNumber) || stepNumber < 1) return null;
    if (!Number.isInteger(intervalDays) || intervalDays < 1) return null;
    if (!CHANNELS.includes(channel as Channel)) return null;
    if (seen.has(stepNumber)) return null;
    seen.add(stepNumber);
    steps.push({ stepNumber, intervalDays, channel: channel as Channel });
  }
  return steps.sort((a, b) => a.stepNumber - b.stepNumber);
}
