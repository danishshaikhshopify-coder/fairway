// Small formatting helpers shared by every page.

export function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${value.toLocaleString("en-US")}`;
}

export function formatFullCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** "2026-10-18" -> "Oct 18, 2026" */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "2026-10-18 14:30" -> "Oct 18, 2026, 2:30 PM" */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalIso(now: Date): string {
  // Local date, not UTC: `toISOString()` runs a day ahead of the user from the
  // evening onwards in every timezone this app supports, which flipped
  // follow-ups to "overdue" hours early and stamped tomorrow on lastContact.
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export function todayIso(): string {
  return toLocalIso(new Date());
}

/** Today plus `days` calendar days, as a local date-only ISO string. */
export function plusDaysIso(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return toLocalIso(now);
}

/** True when a date-only ISO string is before `today` ("" disables the check). */
export function isOverdue(iso: string, today: string): boolean {
  return today !== "" && iso !== "" && iso < today;
}
