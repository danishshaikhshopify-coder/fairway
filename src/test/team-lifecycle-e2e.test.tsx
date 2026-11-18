// A genuine end-to-end test of the Team Management lifecycle: it chains the
// REAL route handlers (invite, resend, revoke, remove, complete, delete,
// members GET) against ONE stateful in-memory fake that persists row state
// across calls — unlike the per-route unit tests elsewhere in this suite,
// which hand each route a fresh, static, single-call mock. That's the only
// way to actually exercise a multi-step lifecycle (invite -> remove ->
// re-invite -> accept -> ...) rather than assert on each step in isolation.
//
// The fake models the real schema behavior that matters here, confirmed
// against the B7 migration SQL (supabase/migrations/20261109010000_b7_*):
// admin.inviteUserByEmail() synchronously fires handle_new_user(), which
// creates the workspace_members row AND flips the invitation to 'accepted'
// in the same transaction — a brand-new invite is therefore never
// observably "pending" to the owner. resetPasswordForEmail() (the
// reactivation path, used for a REMOVED member) does neither, which is why
// "Pending Invitations" is only ever populated by a reactivation re-invite
// in the current architecture. This file documents that as a finding
// rather than papering over it.
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
import { GET as listMembers } from "@/app/api/team/members/route";
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
          // Simulate handle_new_user(): admits into whichever pending invite
          // matches this email (global, not workspace-scoped — see B7 SQL),
          // creating workspace_members and flipping the invite in one step.
          const invite = state.tables.invitations
            .filter((r) => String(r.email).toLowerCase() === email.toLowerCase() && r.status === "pending")
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          if (invite) {
            state.tables.workspace_members.push({
              id: `workspace_members-${state.tables.workspace_members.length + 1}`,
              user_id: id,
              workspace_id: invite.workspace_id,
              role: invite.role,
              is_active: true,
              removed_at: null,
              profiles: null,
              created_at: nextTimestamp(state),
            });
            invite.status = "accepted";
            invite.accepted_at = nextTimestamp(state);
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

describe("Team Management — 15-step lifecycle (real route handlers, stateful fake)", () => {
  let state: State;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    state = {
      tables: { workspace_members: [], invitations: [], gmail_connections: [], profiles: [] },
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

  it("runs invite -> pending -> resend -> cancel -> remove -> reactivate -> cross-workspace -> delete -> rate-limit", async () => {
    // --- Step 1: invite a new member --------------------------------------
    asUser("u-owner-1");
    const inviteRes = await createInvitation(req({ email: "bob@fairway.test", role: "sales_rep" }));
    expect(inviteRes.status).toBe(200);

    // --- Step 2: "verify pending invitation appears" ----------------------
    // FINDING: it does not, for a brand-new invite. admin.inviteUserByEmail()
    // fires handle_new_user() synchronously, which both admits bob into
    // workspace_members (is_active=true) AND flips the invitation row to
    // 'accepted' in the same transaction — before this response is even
    // sent. There is no observable "pending" window for a first-time invite
    // in the current schema; "pending" only exists for a reactivation
    // re-invite (see Step 9-10 below). Assert what actually happens instead.
    let invitations = (await (await listInvitations()).json()).invitations as Row[];
    const bobInvite = invitations.find((i) => i.email === "bob@fairway.test");
    expect(bobInvite?.status).toBe("accepted");
    let members = (await (await listMembers()).json()).members as Row[];
    let bob = members.find((m) => m.email === "bob@fairway.test");
    expect(bob?.isActive).toBe(true);
    expect(bob?.role).toBe("sales_rep");
    expect(bob?.removed).toBe(false);
    const bobMemberId = bob!.id as string;
    const bobUserId = state.authUsers.find((u) => u.email === "bob@fairway.test")!.id;

    // --- Step 6: remove the active member ---------------------------------
    const removeRes = await removeMember(req({ id: bobMemberId }));
    expect(removeRes.status).toBe(200);
    expect((await removeRes.json()).removed).toBe(true);

    // --- Step 7: verify access revoked --------------------------------------
    asUser(bobUserId);
    const bobActorAfterRemove = await listMembers(); // requireActor() runs inside; bob has no API route of his own to call pre-reactivation, so exercise requireActor() via a route he'd hit: members GET requires an actor too.
    expect(bobActorAfterRemove.status).toBe(403);
    expect((await bobActorAfterRemove.json()).error).toBe("no_workspace");

    // --- Step 8: verify appears in Removed Members --------------------------
    asUser("u-owner-1");
    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test");
    expect(bob?.isActive).toBe(false);
    expect(bob?.removed).toBe(true);
    expect(bob?.banned).toBe(true);

    // --- Step 9: re-invite with a different role (reactivation path) -------
    const reinviteRes = await createInvitation(req({ email: "bob@fairway.test", role: "admin" }));
    expect(reinviteRes.status).toBe(200);

    // --- Step 10: verify it is a genuinely pending invitation ----------------
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    const reactivationInvite = invitations.find((i) => i.email === "bob@fairway.test" && i.status === "pending");
    expect(reactivationInvite).toBeTruthy();
    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test");
    expect(bob?.isActive).toBe(false); // role takes effect only once Step 11 runs — see complete/route.ts.

    // --- Step 3: resend this (genuinely pending) invitation ------------------
    const resendRes = await resendInvitation(req({ id: reactivationInvite!.id }));
    expect(resendRes.status).toBe(200);
    expect((await resendRes.json()).resent).toBe(true);

    // --- Step 11: complete password reset + acceptance ------------------------
    asUser(bobUserId);
    const completeRes = await completeInvitation();
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).reactivated).toBe(true);

    // --- Step 12: verify active with the new, correct role ---------------------
    asUser("u-owner-1");
    members = (await (await listMembers()).json()).members as Row[];
    bob = members.find((m) => m.email === "bob@fairway.test");
    expect(bob?.isActive).toBe(true);
    expect(bob?.role).toBe("admin");
    expect(bob?.removed).toBe(false);
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    expect(invitations.find((i) => i.id === reactivationInvite!.id)?.status).toBe("accepted");

    // --- Step 13: cross-workspace isolation -------------------------------------
    // owner2 (ws-2) must not see bob at all, and cannot act on his membership
    // row even by id — it belongs to ws-1, requireActor() scopes owner2 to ws-2.
    asUser("u-owner-2");
    const ws2Members = (await (await listMembers()).json()).members as Row[];
    expect(ws2Members.some((m) => m.email === "bob@fairway.test")).toBe(false);
    const crossTenantRemove = await removeMember(req({ id: bobMemberId }));
    expect(crossTenantRemove.status).toBe(404);
    expect((await crossTenantRemove.json()).error).toBe("not_found");

    // --- Step 4 + 5: cancel a pending invitation; verify it disappears and the
    // old link (completeInvitation) can no longer reactivate from it ------------
    asUser("u-owner-1");
    await removeMember(req({ id: bobMemberId })); // remove bob again to generate a second, genuinely-pending reactivation invite
    const secondReinvite = await createInvitation(req({ email: "bob@fairway.test", role: "sales_rep" }));
    expect(secondReinvite.status).toBe(200);
    invitations = (await (await listInvitations()).json()).invitations as Row[];
    const pendingAgain = invitations.find((i) => i.email === "bob@fairway.test" && i.status === "pending");
    expect(pendingAgain).toBeTruthy();

    const cancelRes = await revokeInvitation(req({ id: pendingAgain!.id }));
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).revoked).toBe(true);

    invitations = (await (await listInvitations()).json()).invitations as Row[];
    expect(invitations.find((i) => i.id === pendingAgain!.id)?.status).toBe("revoked");
    expect(invitations.some((i) => i.email === "bob@fairway.test" && i.status === "pending")).toBe(false);

    asUser(bobUserId);
    const oldLinkAttempt = await completeInvitation();
    expect((await oldLinkAttempt.json()).reactivated).toBe(false); // the revoked invite can no longer admit him — the "old link" is dead.

    // A cancelled invitation must not be resendable either.
    asUser("u-owner-1");
    const resendCancelled = await resendInvitation(req({ id: pendingAgain!.id }));
    expect(resendCancelled.status).toBe(409);
    expect((await resendCancelled.json()).error).toBe("not_pending");

    // --- Permanent deletion -----------------------------------------------------
    // bob is currently removed (not active) from the remove-again above —
    // required precondition for members/delete.
    asUser("u-owner-1");
    state.accessLog = [];
    const deleteRes = await deleteMember(req({ id: bobMemberId, confirm: true }));
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.deleted).toBe(true);
    expect(deleteBody.authDeleted).toBe(true); // bob has no other workspace membership.
    expect(deleteBody.otherWorkspaceMemberships).toBe(false);
    // Step 14 (historical data preserved): the FK-level guarantee
    // (every business table references workspace_members(id) ON DELETE SET
    // NULL, confirmed separately by reading every migration's FK clauses)
    // is outside what this fake can model — it has no leads/tasks tables.
    // What IS verifiable here, at the application layer, is that permanent
    // deletion touches only workspace_members (+ the auth user) and nothing
    // else, which is the scoping that makes that FK guarantee reachable at
    // all: a route that also wrote to other tables could bypass it. Checked
    // before the next listMembers() call, which itself legitimately touches
    // gmail_connections/profiles and would otherwise pollute this log.
    expect(state.accessLog.every((a) => a.table === "workspace_members")).toBe(true);
    members = (await (await listMembers()).json()).members as Row[];
    expect(members.some((m) => m.id === bobMemberId)).toBe(false);
    expect(state.authUsers.some((u) => u.id === bobUserId)).toBe(false);

    // Deleting a member who holds ANOTHER workspace's membership must leave
    // the auth account alone (it would silently kill that other access).
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
    expect(deleteErinBody.deleted).toBe(true);
    expect(deleteErinBody.authDeleted).toBe(false);
    expect(deleteErinBody.otherWorkspaceMemberships).toBe(true);
    expect(state.authUsers.some((u) => u.id === "u-erin")).toBe(true);

    // --- Step 15: rate-limit / API-failure behavior -----------------------------
    state.rateLimited = true;
    const invitationsBefore = state.tables.invitations.length;
    const rateLimitedInvite = await createInvitation(req({ email: "dave@fairway.test", role: "viewer" }));
    expect(rateLimitedInvite.status).toBe(429);
    expect((await rateLimitedInvite.json()).error).toBe("rate_limited");
    // The invitation row the route inserted before the rate-limited Auth
    // call must have been rolled back — no orphaned invitation left behind.
    expect(state.tables.invitations.length).toBe(invitationsBefore);
    expect(state.authUsers.some((u) => u.email === "dave@fairway.test")).toBe(false);

    state.rateLimited = false;
    const retryInvite = await createInvitation(req({ email: "dave@fairway.test", role: "viewer" }));
    expect(retryInvite.status).toBe(200);
  });
});
