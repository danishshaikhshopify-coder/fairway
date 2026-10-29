import type { BusinessType, Lead, LeadSource } from "./types";

/** Field values of the Add-lead form, all kept as strings until submit. */
export interface LeadForm {
  company: string;
  contact: string;
  email: string;
  phone: string;
  source: LeadSource;
  businessType: BusinessType;
  value: string;
  score: string;
  fitScore: string;
  owner: string;
  nextFollowUp: string;
}

/**
 * A duplicate lead is the same contact email AND the same company (case- and
 * whitespace-insensitive). Email alone is not enough: one contact can
 * legitimately hold several deals (leads are deals — see the B1 plan §5.6).
 */
export function findDuplicateLead<
  T extends Pick<Lead, "email" | "company">,
>(leads: T[], form: Pick<LeadForm, "email" | "company">): T | undefined {
  const email = form.email.trim().toLowerCase();
  const company = form.company.trim().toLowerCase();
  if (!email || !company) return undefined;
  return leads.find(
    (l) =>
      l.email.trim().toLowerCase() === email &&
      l.company.trim().toLowerCase() === company,
  );
}

export function validateLeadForm(form: LeadForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.company.trim()) errors.company = "Company is required.";
  if (!form.contact.trim()) errors.contact = "Contact name is required.";
  if (!form.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  const value = Number(form.value);
  if (!form.value.trim() || !Number.isFinite(value) || value < 0) {
    errors.value = "Enter an estimated value in USD.";
  }
  for (const field of ["score", "fitScore"] as const) {
    const n = Number(form[field]);
    if (form[field].trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
      errors[field] = "Use a score between 0 and 100.";
    }
  }
  if (!form.nextFollowUp) errors.nextFollowUp = "Pick a follow-up date.";
  return errors;
}
