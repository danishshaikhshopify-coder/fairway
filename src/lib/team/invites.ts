// Pure validation for the invite-only team-access API routes. No Supabase,
// no Next — importable from `node --test` like the Sheets model module.

export type InvitableRole = "admin" | "sales_rep" | "viewer";

const INVITABLE_ROLES: InvitableRole[] = ["admin", "sales_rep", "viewer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface InviteInput {
  email: string;
  role: InvitableRole;
}

/** Lowercased, trimmed — the identity invitations/profiles match on. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateInviteInput(body: unknown): ValidationResult<InviteInput> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const email = normaliseEmail(typeof input.email === "string" ? input.email : "");
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const role = typeof input.role === "string" ? input.role : "sales_rep";
  if (!INVITABLE_ROLES.includes(role as InvitableRole)) {
    return { ok: false, error: `Role must be one of: ${INVITABLE_ROLES.join(", ")}.` };
  }
  return { ok: true, value: { email, role: role as InvitableRole } };
}

export interface MemberPatchInput {
  role?: InvitableRole;
  isActive?: boolean;
  receivesReminders?: boolean;
}

export function validateMemberPatch(body: unknown): ValidationResult<MemberPatchInput> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const patch: MemberPatchInput = {};

  if (input.role !== undefined) {
    if (!INVITABLE_ROLES.includes(input.role as InvitableRole)) {
      return { ok: false, error: `Role must be one of: ${INVITABLE_ROLES.join(", ")}.` };
    }
    patch.role = input.role as InvitableRole;
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") {
      return { ok: false, error: "isActive must be a boolean." };
    }
    patch.isActive = input.isActive;
  }
  if (input.receivesReminders !== undefined) {
    if (typeof input.receivesReminders !== "boolean") {
      return { ok: false, error: "receivesReminders must be a boolean." };
    }
    patch.receivesReminders = input.receivesReminders;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update." };
  }
  return { ok: true, value: patch };
}

/**
 * Whether the caller (already confirmed to be the workspace owner by
 * canManageTeam()) may remove this target member. The owner can never be
 * removed, and a caller can never remove themselves — even an owner.
 */
export function canRemoveMember(
  target: { id: string; role: string },
  actingMemberId: string,
): ValidationResult<true> {
  if (target.role === "owner") {
    return { ok: false, error: "The owner cannot be removed." };
  }
  if (target.id === actingMemberId) {
    return { ok: false, error: "You cannot remove yourself." };
  }
  return { ok: true, value: true };
}
