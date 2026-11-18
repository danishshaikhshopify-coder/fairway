// Route-level tests for POST /api/team/members/remove: owner-only
// authorization, self/owner-target guards, and that a successful removal
// sets is_active=false + removed_at and bans the Supabase Auth account.
// Both Supabase client factories are faked; no live database or network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));

import { POST as removeMember } from "@/app/api/team/members/remove/route";

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

function serverClient(role: string, memberId = "actor-member") {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "actor-uid", email: "owner@fairway.test" } },
        error: null,
      })),
    },
    from: vi.fn(() => chain({ data: { id: memberId, workspace_id: "ws-1", role }, error: null })),
  };
}

function request(id: string) {
  return new Request("http://test/api/team/members/remove", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/members/remove", () => {
  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await removeMember(request("member-2"));
    expect(response.status).toBe(403);
  });

  it("refuses to remove the owner", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "member-owner-2", user_id: "u2", role: "owner" }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await removeMember(request("member-owner-2"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toContain("owner cannot be removed");
  });

  it("refuses a caller removing their own membership", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner", "actor-member"));
    // Target row shares the caller's own member id but isn't flagged owner,
    // isolating the self-removal guard from the owner-role guard.
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "actor-member", user_id: "actor-uid", role: "admin" }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await removeMember(request("actor-member"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toContain("cannot remove yourself");
  });

  it("removes a partner: sets is_active=false and removed_at, and bans the auth account", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const memberLookup = chain({
      data: { id: "member-2", user_id: "user-2", role: "sales_rep" },
      error: null,
    });
    const updateChain = chain({ data: null, error: null });
    const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
    const from = vi.fn().mockReturnValueOnce(memberLookup).mockReturnValueOnce(updateChain);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { updateUserById } } });

    const response = await removeMember(request("member-2"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ removed: true, authBanned: true });

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false, removed_at: expect.any(String) }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", "member-2");
    expect(updateUserById).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({ ban_duration: expect.any(String) }),
    );
  });

  it("still reports success when banning fails (is_active already blocks data access)", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const memberLookup = chain({
      data: { id: "member-2", user_id: "user-2", role: "sales_rep" },
      error: null,
    });
    const updateChain = chain({ data: null, error: null });
    const updateUserById = vi.fn(async () => ({ data: null, error: { message: "ban failed" } }));
    const from = vi.fn().mockReturnValueOnce(memberLookup).mockReturnValueOnce(updateChain);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { updateUserById } } });

    const response = await removeMember(request("member-2"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ removed: true, authBanned: false });
  });
});
