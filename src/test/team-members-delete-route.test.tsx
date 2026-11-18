// Route-level tests for POST /api/team/members/delete: owner-only
// authorization, confirm-required, owner/self/not-removed guards, the
// workspace_members row actually being deleted, and the cross-workspace
// guard that skips deleting the auth.users row when the person still
// belongs to another workspace. Both Supabase client factories are faked;
// no live database or network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));
vi.mock("@/lib/team/audit", () => ({ logTeamEvent: vi.fn(async () => undefined) }));

import { POST as deleteMember } from "@/app/api/team/members/delete/route";

function chain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order", "limit", "insert", "update", "delete"]) {
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

function request(id: string, confirm: unknown = true) {
  return new Request("http://test/api/team/members/delete", {
    method: "POST",
    body: JSON.stringify({ id, confirm }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/members/delete", () => {
  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await deleteMember(request("member-2"));
    expect(response.status).toBe(403);
  });

  it("requires confirm: true", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    getServiceSupabase.mockReturnValue({ from: vi.fn() });

    const response = await deleteMember(request("member-2", false));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("confirm");
  });

  it("refuses to delete the owner", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "member-owner-2", user_id: "u2", role: "owner", removed_at: "2026-01-01" }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await deleteMember(request("member-owner-2"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toContain("owner cannot be deleted");
  });

  it("refuses a caller deleting their own membership", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner", "actor-member"));
    const from = vi.fn().mockReturnValueOnce(
      chain({
        data: { id: "actor-member", user_id: "actor-uid", role: "admin", removed_at: "2026-01-01" },
        error: null,
      }),
    );
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await deleteMember(request("actor-member"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.message).toContain("cannot delete yourself");
  });

  it("refuses to delete a member who was never removed first", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "member-2", user_id: "user-2", role: "sales_rep", removed_at: null }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await deleteMember(request("member-2"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("not_removed");
  });

  it("404s when the member is not found in the caller's workspace", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }));
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await deleteMember(request("member-2"));
    expect(response.status).toBe(404);
  });

  it("deletes the member row and the auth account when no other workspace membership exists", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const memberLookup = chain({
      data: { id: "member-2", user_id: "user-2", role: "sales_rep", removed_at: "2026-01-01" },
      error: null,
    });
    const otherMembershipsLookup = chain({ data: [], error: null });
    const deleteChain = chain({ data: null, error: null });
    const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
    const from = vi
      .fn()
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(otherMembershipsLookup)
      .mockReturnValueOnce(deleteChain);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { deleteUser } } });

    const response = await deleteMember(request("member-2"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: true, authDeleted: true, otherWorkspaceMemberships: false });

    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "member-2");
    expect(deleteUser).toHaveBeenCalledWith("user-2");
  });

  it("deletes only this workspace's row, and leaves the auth account alone, when another workspace membership exists", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const memberLookup = chain({
      data: { id: "member-2", user_id: "user-2", role: "sales_rep", removed_at: "2026-01-01" },
      error: null,
    });
    const otherMembershipsLookup = chain({ data: [{ id: "member-elsewhere" }], error: null });
    const deleteChain = chain({ data: null, error: null });
    const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
    const from = vi
      .fn()
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(otherMembershipsLookup)
      .mockReturnValueOnce(deleteChain);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { deleteUser } } });

    const response = await deleteMember(request("member-2"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: true, authDeleted: false, otherWorkspaceMemberships: true });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("still reports success when the best-effort auth deletion fails", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const memberLookup = chain({
      data: { id: "member-2", user_id: "user-2", role: "sales_rep", removed_at: "2026-01-01" },
      error: null,
    });
    const otherMembershipsLookup = chain({ data: [], error: null });
    const deleteChain = chain({ data: null, error: null });
    const deleteUser = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const from = vi
      .fn()
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(otherMembershipsLookup)
      .mockReturnValueOnce(deleteChain);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { deleteUser } } });

    const response = await deleteMember(request("member-2"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: true, authDeleted: false, otherWorkspaceMemberships: false });
  });
});
