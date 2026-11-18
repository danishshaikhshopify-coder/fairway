// Route-level tests for the remove -> re-invite -> accept lifecycle:
// POST /api/team/invitations' reactivation branch (re-inviting a removed
// member instead of rejecting them) and POST /api/team/invitations/complete
// (what actually restores access once they finish fresh authentication).
// Both Supabase client factories are faked; no live database or network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));
vi.mock("@/lib/app-url", () => ({
  getAppUrl: () => "https://fairway-crm-one.vercel.app",
  AppUrlConfigError: class AppUrlConfigError extends Error {},
}));
vi.mock("@/lib/team/audit", () => ({ logTeamEvent: vi.fn(async () => undefined) }));

import { POST as inviteMembers } from "@/app/api/team/invitations/route";
import { POST as completeInvite } from "@/app/api/team/invitations/complete/route";

// A terminal method (maybeSingle/single) resolves to `result`; the chain is
// also awaitable directly (`then`) for calls the route never terminates
// explicitly, e.g. `await db.from(...).update(...).eq(...)`.
function chain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete"]) {
    node[method] = vi.fn(() => node);
  }
  node.maybeSingle = vi.fn(async () => result);
  node.single = vi.fn(async () => result);
  node.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return node;
}

function serverClient(role: string) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "actor-uid", email: "owner@fairway.test" } },
        error: null,
      })),
    },
    from: vi.fn(() => chain({ data: { id: "actor-member", workspace_id: "ws-1", role }, error: null })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/invitations — re-inviting a removed member", () => {
  it("reactivates instead of rejecting: no inviteUserByEmail, old password killed, ban lifted", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "removed-uid", email: "jane@fairway.test" }] },
      error: null,
    }));
    const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    const inviteUserByEmail = vi.fn();
    const memberLookup = chain({ data: { is_active: false }, error: null });
    const invitationInsert = chain({
      data: { id: "inv-1", email: "jane@fairway.test", role: "admin", status: "pending" },
      error: null,
    });
    const from = vi.fn().mockReturnValueOnce(memberLookup).mockReturnValueOnce(invitationInsert);
    getServiceSupabase.mockReturnValue({
      auth: { admin: { listUsers, updateUserById, inviteUserByEmail }, resetPasswordForEmail },
      from,
    });

    const response = await inviteMembers(
      new Request("http://test/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: "jane@fairway.test", role: "admin" }),
      }),
    );
    expect(response.status).toBe(200);

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateUserById).toHaveBeenCalledWith(
      "removed-uid",
      expect.objectContaining({ ban_duration: "none", password: expect.any(String) }),
    );
    // No one is ever given this value, and it is not the account's old one.
    const call = updateUserById.mock.calls[0] as unknown as [string, { password: string }];
    expect(call[1].password.length).toBeGreaterThan(20);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "jane@fairway.test",
      expect.objectContaining({ redirectTo: expect.stringContaining("/invite/accept") }),
    );
    // Reuses the existing invitation row; never a second workspace_members insert.
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("still rejects re-inviting someone who is currently an active member", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(chain({ data: { is_active: true }, error: null }));
    getServiceSupabase.mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: { users: [{ id: "active-uid", email: "active@fairway.test" }] },
            error: null,
          })),
        },
      },
      from,
    });

    const response = await inviteMembers(
      new Request("http://test/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: "active@fairway.test", role: "admin" }),
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toContain("already a member");
  });

  it("rejects a duplicate pending invitation with a clear message", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: null, error: { code: "23505", message: "duplicate key" } }),
    );
    getServiceSupabase.mockReturnValue({
      auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })) } },
      from,
    });

    const response = await inviteMembers(
      new Request("http://test/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: "new@fairway.test", role: "sales_rep" }),
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("already_invited");
  });

  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await inviteMembers(
      new Request("http://test/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: "whoever@fairway.test", role: "admin" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/team/invitations/complete — finishing a reactivation", () => {
  it("rejects an unauthenticated caller", async () => {
    getServerSupabase.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    });
    const response = await completeInvite();
    expect(response.status).toBe(401);
  });

  it("is a safe no-op when there is no pending invitation", async () => {
    getServerSupabase.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "new-uid", email: "brandnew@fairway.test" } },
          error: null,
        })),
      },
    });
    const from = vi.fn().mockReturnValueOnce(chain({ data: [], error: null }));
    getServiceSupabase.mockReturnValue({ from });

    const response = await completeInvite();
    const body = await response.json();
    expect(body).toEqual({ status: "none" });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("marks the invitation awaiting_approval and bans the account, without activating membership (owner approval required — see ../approve/route.ts)", async () => {
    getServerSupabase.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "removed-uid", email: "jane@fairway.test" } },
          error: null,
        })),
      },
    });
    const invitationLookup = chain({
      data: [{ id: "inv-1", workspace_id: "ws-1", role: "admin" }],
      error: null,
    });
    const memberLookup = chain({ data: { id: "member-1", is_active: false }, error: null });
    const invitationUpdate = chain({ data: null, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(invitationLookup)
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(invitationUpdate);
    const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { updateUserById } } });

    const response = await completeInvite();
    const body = await response.json();
    expect(body).toEqual({ status: "awaiting_approval" });

    expect(invitationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "awaiting_approval" }),
    );
    expect(invitationUpdate.eq).toHaveBeenCalledWith("id", "inv-1");
    expect(updateUserById).toHaveBeenCalledWith("removed-uid", { ban_duration: "876000h" });
  });

  it("picks the pending invitation matching the deactivated workspace, not just the most recent one", async () => {
    // Same email holds a live pending invite in two workspaces at once —
    // the per-workspace uniqueness constraint allows this. The most recent
    // one (ws-2) is for a workspace where this user has no membership yet;
    // the older one (ws-1) is the actual match this call must find.
    getServerSupabase.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "removed-uid", email: "jane@fairway.test" } },
          error: null,
        })),
      },
    });
    const invitationLookup = chain({
      data: [
        { id: "inv-newer", workspace_id: "ws-2", role: "viewer" },
        { id: "inv-older", workspace_id: "ws-1", role: "admin" },
      ],
      error: null,
    });
    const memberLookupWs2 = chain({ data: null, error: null });
    const memberLookupWs1 = chain({ data: { id: "member-1", is_active: false }, error: null });
    const invitationUpdate = chain({ data: null, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(invitationLookup)
      .mockReturnValueOnce(memberLookupWs2)
      .mockReturnValueOnce(memberLookupWs1)
      .mockReturnValueOnce(invitationUpdate);
    const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { updateUserById } } });

    const response = await completeInvite();
    const body = await response.json();
    expect(body).toEqual({ status: "awaiting_approval" });
    expect(invitationUpdate.eq).toHaveBeenCalledWith("id", "inv-older");
  });

  it("does not touch someone who is already an active member", async () => {
    getServerSupabase.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "active-uid", email: "active@fairway.test" } },
          error: null,
        })),
      },
    });
    const invitationLookup = chain({
      data: [{ id: "inv-2", workspace_id: "ws-1", role: "admin" }],
      error: null,
    });
    const memberLookup = chain({ data: { id: "member-2", is_active: true }, error: null });
    const from = vi.fn().mockReturnValueOnce(invitationLookup).mockReturnValueOnce(memberLookup);
    getServiceSupabase.mockReturnValue({ from });

    const response = await completeInvite();
    const body = await response.json();
    expect(body).toEqual({ status: "none" });
    expect(from).toHaveBeenCalledTimes(2);
  });
});
