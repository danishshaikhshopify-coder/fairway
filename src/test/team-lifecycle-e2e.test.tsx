// A genuine end-to-end test of the Team Management lifecycle, now including
// the owner-approval gate: it chains the REAL route handlers (invite,
// resend, revoke, complete, approve, reject, remove, delete, members GET,
// invitations GET, the unauthenticated status lookup) against ONE stateful
// in-memory fake that persists row state across calls — unlike the
// per-route unit tests elsewhere in this suite, which hand each route a
// fresh, static, single-call mock.
//
// The fake models the NEW schema behavior (B10 migration): admin.
// inviteUserByEmail() still fires handle_new_user() synchronously, but that
// trigger now creates the workspace_members row INACTIVE and never touches
// the invitation's status — a brand-new invite is therefore genuinely
// "pending" until the invitee actually completes password setup (POST
// .../complete), at which point the invitation becomes "awaiting_approval"
// and the auth account is banned. Nothing becomes active until the owner
// explicitly approves (POST .../approve) — confirmed with the user to apply
// identically to a brand-new invite and to reactivating a removed member.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));
vi.mock("@/lib/app-url", () => ({
  getAppUrl: () => "https://fairway-crm-one.vercel.app",
  AppUrlConfigError: class AppUrlConfigError extends Error {},
}));

import { POST as createInvitation, GET as listInvitations } from "@/app/api/team/invitations/route";
import { POST as resendInvitation } from "@/app/api/team/invitations/resend/route";
import { POST as revokeInvitation } from "@/app/api/team/invitations/revoke/route";
import { POST as completeInvitation } from "@/app/api/team/invitations/complete/route";
import { POST as approveInvitation } from "@/app/api/team/invitations/approve/route";
import { POST as rejectInvitation } from "@/app/api/team/invitations/reject/route";
import { POST as invitationStatus } from "@/app/api/team/invitations/status/route";
import { GET as listMembers, POST as patchMember } from "@/app/api/team/members/route";
import { POST as removeMember } from "@/app/api/team/members/remove/route";
import { POST as deleteMember } from "@/app/api/team/members/delete/route";

type Row = Record<string, unknown>;

interface AuthUser {
  id: string;
  email: string;
  banned_until: string | null;
}

interface State {
  tables: Record<string, Row[]>;
  authUsers: AuthUser[];
  currentUserId: string | null;
  rateLimited: boolean;
  clock: number;
  accessLog: { table: string; mode: string }[];
}

function nextTimestamp(state: State): string {
  return new Date(2026, 0, 1, 0, 0, 0, state.clock++).toISOString();
}

function isBanned(u: AuthUser): boolean {
  return Boolean(u.banned_until) && new Date(u.banned_until!) > new Date();
}

function makeQueryBuilder(table: string, state: State) {
  if (!state.tables[table]) state.tables[table] = [];
  const filters: Array<(r: Row) => boolean> = [];
  let mode: "select" | "insert" | "update" | "delete" = "select";
  let insertValue: Row | null = null;
  let updateValue: Row | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;

  const matched = (): Row[] => {
    let rows = state.tables[table];
    for (const f of filters) rows = rows.filter(f);
    if (orderCol) {
      const col = orderCol;
      rows = [...rows].sort((a, b) => {
        const av = String(a[col]);
        const bv = String(b[col]);
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return orderAsc ? cmp : -cmp;
      });
    }
    if (limitN != null) rows = rows.slice(0, limitN);
    return rows;
  };

  const exec = (): { data: unknown; error: unknown } => {
    state.accessLog.push({ table, mode });
    if (mode === "insert") {
      const value = insertValue ?? {};
      if (table === "invitations" && value.status !== "revoked") {
        const dup = state.tables.invitations.find(
          (r) =>
            r.workspace_id === value.workspace_id &&
            String(r.email).toLowerCase() === String(value.email).toLowerCase() &&
            r.status === "pending",
        );
        if (dup) return { data: null, error: { code: "23505", message: "duplicate pending invite" } };
      }
      const row: Row = {
        status: "pending",
        accepted_at: null,
        revoked_at: null,
        rejected_at: null,
        removed_at: null,
        is_active: true,
        profiles: null,
        ...value,
        id: `${table}-${state.tables[table].length + 1}`,
        created_at: nextTimestamp(state),
      };
      state.tables[table].push(row);
      return { data: row, error: null };
    }
    if (mode === "update") {
      const rows = matched();
      for (const row of rows) Object.assign(row, updateValue);
      return { data: rows, error: null };
    }
    if (mode === "delete") {
      const rows = matched();
      state.tables[table] = state.tables[table].filter((r) => !rows.includes(r));
      return { data: rows, error: null };
    }
    return { data: matched(), error: null };
  };

  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    neq(col: string, val: unknown) {
      filters.push((r) => r[col] !== val);
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col;
      orderAsc = opts?.ascending !== false;
      return builder;
    },
    limit(n: number) {
      limitN = n;
      return builder;
    },
    insert(value: Row) {
      mode = "insert";
      insertValue = value;
      return builder;
    },
    update(value: Row) {
      mode = "update";
      updateValue = value;
      return builder;
    },
    delete() {
      mode = "delete";
      return builder;
    },
    async maybeSingle() {
      const result = exec();
      const arr = Array.isArray(result.data) ? (result.data as Row[]) : [result.data as Row];
      return { data: arr[0] ?? null, error: result.error };
    },
    async single() {
      const result = exec();
      const arr = Array.isArray(result.data) ? (result.data as Row[]) : [result.data as Row];
      return { data: arr[0] ?? null, error: result.error };
    },
    then(resolve: (v: { data: unknown; error: unknown }) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(exec()).then(resolve, reject);
    },
  };
  return builder;
}

function makeDb(state: State) {
  return {
    auth: {
      getUser: async () => {
        const u = state.authUsers.find((x) => x.id === state.currentUserId);
        return u
          ? { data: { user: { id: u.id, email: u.email } }, error: null }
          : { data: { user: null }, error: { message: "no session" } };
      },
      resetPasswordForEmail: async () => {
        if (state.rateLimited) {
          return { data: null, error: { code: "over_email_send_rate_limit", message: "rate limited", status: 429 } };
        }
        return { data: {}, error: null };
      },
      admin: {
        listUsers: async () => ({
          data: { users: state.authUsers.map((u) => ({ id: u.id, email: u.email, banned_until: u.banned_until })) },
          error: null,
        }),
        inviteUserByEmail: async (email: string) => {
          if (state.rateLimited) {
            return { data: null, error: { code: "over_email_send_rate_limit", message: "rate limited", status: 429 } };
          }
          const id = `auth-${state.authUsers.length + 1}`;
          const user: AuthUser = { id, email, banned_until: null };
          state.authUsers.push(user);
          // Simulate the NEW handle_new_user() (B10): admits into whichever
          // pending invite matches this email, creating workspace_members
          // INACTIVE and leaving the invitation's status untouched (still
          // 'pending') — nothing becomes active until an explicit approval.
          const invite = state.tables.invitations
            .filter((r) => String(r.email).toLowerCase() === email.toLowerCase() && r.status === "pending")
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          if (invite) {
            state.tables.workspace_members.push({
              id: `workspace_members-${state.tables.workspace_members.length + 1}`,
              user_id: id,
              workspace_id: invite.workspace_id,
              role: invite.role,
              is_active: false,
              removed_at: null,
              profiles: null,
              created_at: nextTimestamp(state),
            });
          }
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string, patch: { password?: string; ban_duration?: string }) => {
          const u = state.authUsers.find((x) => x.id === id);
          if (!u) return { data: null, error: { message: "auth user not found" } };
          if (patch.ban_duration === "none") u.banned_until = null;
          else if (patch.ban_duration) u.banned_until = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100).toISOString();
          return { data: { user: u }, error: null };
        },
        deleteUser: async (id: string) => {
          state.authUsers = state.authUsers.filter((u) => u.id !== id);
          return { data: null, error: null };
        },
      },
    },
    from: (table: string) => makeQueryBuilder(table, state),
  };
}

describe("Team Management — owner-approval lifecycle (real route handlers, stateful fake)", () => {
  let state: State;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    state = {
      tables: { workspace_members: [], invitations: [], gmail_connections: [], profiles: [], team_audit_log: [] },
      authUsers: [],
      currentUserId: null,
      rateLimited: false,
      clock: 0,
      accessLog: [],
    };
    db = makeDb(state);
    getServerSupabase.mockImplementation(() => Promise.resolve(db));
    getServiceSupabase.mockImplementation(() => db);

    state.authUsers.push({ id: "u-owner-1", email: "owner1@fairway.test", banned_until: null });
    state.authUsers.push({ id: "u-owner-2", email: "owner2@fairway.test", banned_until: null });
    state.tables.workspace_members.push({
      id: "mem-owner-1",
      user_id: "u-owner-1",
      workspace_id: "ws-1",
      role: "owner",
      is_active: true,
      removed_at: null,
      profiles: null,
      created_at: nextTimestamp(state),
    });
    state.tables.workspace_members.push({
      id: "mem-owner-2",
      user_id: "u-owner-2",
      workspace_id: "ws-2",
      role: "owner",
      is_active: true,
      removed_at: null,
      profiles: null,
      created_at: nextTimestamp(state),
    });
  });

  const asUser = (id: string) => {
    state.currentUserId = id;
  };
  const req = (body: unknown) => new Request("https://fairway-crm-one.vercel.app/api", { method: "POST", body: JSON.stringify(body) });

  it("gates every path to active membership behind an explicit owner approval", async () => {
    // ===== Bob: invite -> pending -> accept -> awaiting approval -> blocked -> approved =====
    asUser("u-owner-1");
    const inviteRes = await createInvitation(req({ email: "bob@fairway.test", role: "sales_rep" }));
    expect(inviteRes.status).toBe(200);

    // A brand-new invite IS genuinely pending now (B10 fixes the old
    // instant-admit trigger) — the owner sees it in both lists correctly.
    let invitations = (await (await listInvitations()).json()).invitations as Row[];
    let bobInvite = invitations.find((i) => i.email === "bob@fairway.test")!;
    expect(bobInvite.status).toBe("pending");
    let members = (await (await listMembers()).json()).members as Row[];
    let bob = members.find((m) => m.email === "bob@fairway.test")!;
    expect(bob.isActive).toBe(false);
    expect(bob.removed).toBe(false);
    const bobMemberId = bob.id as string;
    const bobUserId = state.authUsers.find((u) => u.email === "bob@fairway.test")!.id;

    // Bob opens the accept link and sets a password.
    asUser(bobUserId);
    const completeRes = await completeInvitation();
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).status).toBe("awaiting_approval");

    asUser("u-owner-1");
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    bobInvite = invitations.find((i) => i.email === "bob@fairway.test")!;
    expect(bobInvite.status).toBe("awaiting_approval");
    expect(bobInvite.accepted_at).toBeTruthy();
    const bobAuth = () => state.authUsers.find((u) => u.id === bobUserId)!;
    expect(isBanned(bobAuth())).toBe(true); // login-blocking enforcement: the auth provider itself refuses him, not just RLS.

    // Direct API access blocked while awaiting approval.
    asUser(bobUserId);
    const blockedApi = await listMembers();
    expect(blockedApi.status).toBe(403);
    expect((await blockedApi.json()).error).toBe("no_workspace");

    // The login page's status lookup (unauthenticated) confirms the reason.
    const statusWhilePending = await invitationStatus(req({ email: "bob@fairway.test" }));
    expect((await statusWhilePending.json())).toEqual({ awaitingApproval: true });

    // Cross-workspace: owner2 cannot see bob, and cannot approve/reject his invitation.
    asUser("u-owner-2");
    const ws2Members = (await (await listMembers()).json()).members as Row[];
    expect(ws2Members.some((m) => m.email === "bob@fairway.test")).toBe(false);
    const crossTenantApprove = await approveInvitation(req({ id: bobInvite.id }));
    expect(crossTenantApprove.status).toBe(404);
    expect((await crossTenantApprove.json()).error).toBe("not_found");

    // Owner1 approves — the ONLY thing that activates access.
    asUser("u-owner-1");
    const approveRes = await approveInvitation(req({ id: bobInvite.id }));
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json()).approved).toBe(true);

    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test")!;
    expect(bob.isActive).toBe(true);
    expect(bob.role).toBe("sales_rep");
    expect(isBanned(bobAuth())).toBe(false); // ban lifted on approval.
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    expect(invitations.find((i) => i.id === bobInvite.id)?.status).toBe("accepted");

    const statusAfterApproval = await invitationStatus(req({ email: "bob@fairway.test" }));
    expect((await statusAfterApproval.json())).toEqual({ awaitingApproval: false });

    // Bob can now actually use the API — the strongest proof access is restored.
    asUser(bobUserId);
    const nowAllowed = await listMembers();
    expect(nowAllowed.status).toBe(200);

    // Role change (audit coverage) + removal.
    asUser("u-owner-1");
    const patchRes = await patchMember(req({ id: bobMemberId, role: "viewer" }));
    expect(patchRes.status).toBe(200);
    await removeMember(req({ id: bobMemberId }));
    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test")!;
    expect(bob.isActive).toBe(false);
    expect(bob.removed).toBe(true);

    // ===== Reactivation goes through the SAME approval gate (confirmed decision) =====
    const reinviteRes = await createInvitation(req({ email: "bob@fairway.test", role: "admin" }));
    expect(reinviteRes.status).toBe(200);
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    const reactivationInvite = invitations.find((i) => i.email === "bob@fairway.test" && i.status === "pending")!;
    expect(reactivationInvite).toBeTruthy();
    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test")!;
    expect(bob.isActive).toBe(false); // still inactive — reactivation alone grants nothing.

    asUser(bobUserId);
    const reCompleteRes = await completeInvitation();
    expect((await reCompleteRes.json()).status).toBe("awaiting_approval");
    expect(isBanned(bobAuth())).toBe(true);

    asUser("u-owner-1");
    const reApproveRes = await approveInvitation(req({ id: reactivationInvite.id }));
    expect((await reApproveRes.json()).approved).toBe(true);
    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test")!;
    expect(bob.isActive).toBe(true);
    expect(bob.role).toBe("admin"); // the owner's freshly chosen role, applied only now.
    expect(bob.removed).toBe(false);

    // Permanent deletion, scoped correctly (reused from Round 2 — unaffected by this round's change).
    await removeMember(req({ id: bobMemberId }));
    state.accessLog = [];
    const deleteRes = await deleteMember(req({ id: bobMemberId, confirm: true }));
    expect((await deleteRes.json()).deleted).toBe(true);
    // Only workspace_members (the actual deletion) and the audit-log write
    // itself touch anything — never a business table, which is what keeps
    // the FK ON DELETE SET NULL guarantee (verified separately against the
    // migration SQL) reachable at all.
    expect(state.accessLog.every((a) => a.table === "workspace_members" || a.table === "team_audit_log")).toBe(true);

    // ===== Carol: resend + cancel of a genuinely pending invite, and the old link going dead =====
    const carolInvite1 = await createInvitation(req({ email: "carol@fairway.test", role: "viewer" }));
    expect(carolInvite1.status).toBe(200);
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    let carolInvite = invitations.find((i) => i.email === "carol@fairway.test" && i.status === "pending")!;
    const carolUserId = state.authUsers.find((u) => u.email === "carol@fairway.test")!.id;

    const resendRes = await resendInvitation(req({ id: carolInvite.id }));
    expect((await resendRes.json()).resent).toBe(true);

    const cancelRes = await revokeInvitation(req({ id: carolInvite.id }));
    expect((await cancelRes.json()).revoked).toBe(true);
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    expect(invitations.find((i) => i.id === carolInvite.id)?.status).toBe("revoked");

    // The old link is dead: completing against a cancelled invitation does nothing.
    asUser(carolUserId);
    const deadLinkRes = await completeInvitation();
    expect((await deadLinkRes.json()).status).toBe("none");

    // Cancelled invitations can't be resent either.
    asUser("u-owner-1");
    const resendCancelled = await resendInvitation(req({ id: carolInvite.id }));
    expect(resendCancelled.status).toBe(409);
    expect((await resendCancelled.json()).error).toBe("not_pending");

    // ===== Carol, round 2: owner REJECTS this time =====
    const carolInvite2 = await createInvitation(req({ email: "carol@fairway.test", role: "viewer" }));
    expect(carolInvite2.status).toBe(200);
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    carolInvite = invitations.find((i) => i.email === "carol@fairway.test" && i.status === "pending")!;

    asUser(carolUserId);
    const carolComplete = await completeInvitation();
    expect((await carolComplete.json()).status).toBe("awaiting_approval");
    const carolAuth = () => state.authUsers.find((u) => u.id === carolUserId)!;
    expect(isBanned(carolAuth())).toBe(true);

    asUser("u-owner-1");
    const rejectRes = await rejectInvitation(req({ id: carolInvite.id }));
    expect(rejectRes.status).toBe(200);
    expect((await rejectRes.json()).rejected).toBe(true);

    invitations = (await (await listInvitations()).json()).invitations as Row[];
    const rejected = invitations.find((i) => i.id === carolInvite.id)!;
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejected_at).toBeTruthy();

    // Rejected: still cannot log in (still banned) or reach any API.
    expect(isBanned(carolAuth())).toBe(true);
    const carolStatusAfterReject = await invitationStatus(req({ email: "carol@fairway.test" }));
    expect((await carolStatusAfterReject.json())).toEqual({ awaitingApproval: false }); // not "awaiting" anymore — but still banned, so login still fails.
    asUser(carolUserId);
    const carolApiAfterReject = await listMembers();
    expect(carolApiAfterReject.status).toBe(403);

    // The B10-round gap is now closed: reject() stamps removed_at on
    // Carol's workspace_members row, so she lands in Removed Members (not
    // lost between the Active/Removed/Approval buckets, which is what
    // happened before this fix — is_active=false and removed_at=null match
    // nothing) and can be permanently deleted exactly like anyone else
    // removed, with no separate "rejected" lifecycle needed.
    asUser("u-owner-1");
    const membersAfterReject = (await (await listMembers()).json()).members as Row[];
    const carolMember = membersAfterReject.find((m) => m.email === "carol@fairway.test")!;
    expect(carolMember.removed).toBe(true);
    const deleteCarol = await deleteMember(req({ id: carolMember.id as string, confirm: true }));
    expect(deleteCarol.status).toBe(200);
    expect((await deleteCarol.json()).deleted).toBe(true);

    // ===== Permanent deletion of a member with another active workspace membership =====
    asUser("u-owner-1");
    state.authUsers.push({ id: "u-erin", email: "erin@fairway.test", banned_until: null });
    state.tables.workspace_members.push({
      id: "mem-erin-ws1",
      user_id: "u-erin",
      workspace_id: "ws-1",
      role: "sales_rep",
      is_active: false,
      removed_at: nextTimestamp(state),
      profiles: null,
      created_at: nextTimestamp(state),
    });
    state.tables.workspace_members.push({
      id: "mem-erin-ws2",
      user_id: "u-erin",
      workspace_id: "ws-2",
      role: "viewer",
      is_active: true,
      removed_at: null,
      profiles: null,
      created_at: nextTimestamp(state),
    });
    const deleteErin = await deleteMember(req({ id: "mem-erin-ws1", confirm: true }));
    const deleteErinBody = await deleteErin.json();
    expect(deleteErinBody.authDeleted).toBe(false);
    expect(deleteErinBody.otherWorkspaceMemberships).toBe(true);
    expect(state.authUsers.some((u) => u.id === "u-erin")).toBe(true);

    // ===== Rate-limit / API-failure behavior =====
    state.rateLimited = true;
    const invitationsBefore = state.tables.invitations.length;
    const rateLimitedInvite = await createInvitation(req({ email: "dave@fairway.test", role: "viewer" }));
    expect(rateLimitedInvite.status).toBe(429);
    expect(state.tables.invitations.length).toBe(invitationsBefore); // rolled back, nothing orphaned.
    expect(state.authUsers.some((u) => u.email === "dave@fairway.test")).toBe(false);
    state.rateLimited = false;
    expect((await createInvitation(req({ email: "dave@fairway.test", role: "viewer" }))).status).toBe(200);

    // ===== Audit log contains every expected event =====
    const actions = new Set((state.tables.team_audit_log).map((r) => r.action));
    for (const expected of [
      "invitation_created",
      "invitation_accepted",
      "member_approved",
      "member_rejected",
      "role_changed",
      "member_removed",
      "member_permanently_deleted",
      "invitation_resent",
      "invitation_cancelled",
    ]) {
      expect(actions.has(expected)).toBe(true);
    }
  });
});
