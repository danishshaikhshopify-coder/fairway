// Route-level tests for POST /api/team/invitations/approve and .../reject:
// owner-only authorization, status/409 guard, cross-workspace isolation
// (404), and the actual membership/ban/invitation effects of each. Both
// Supabase client factories are faked; no live database or network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));
vi.mock("@/lib/team/audit", () => ({ logTeamEvent: vi.fn(async () => undefined) }));

import { POST as approveMember } from "@/app/api/team/invitations/approve/route";
import { POST as rejectMember } from "@/app/api/team/invitations/reject/route";

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

function serverClient(role: string) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "owner-uid", email: "owner@fairway.test" } },
        error: null,
      })),
    },
    from: vi.fn(() => chain({ data: { id: "owner-member", workspace_id: "ws-1", role }, error: null })),
  };
}

function request(id: string) {
  return new Request("http://test/api/team/invitations/approve", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/invitations/approve", () => {
  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await approveMember(request("inv-1"));
    expect(response.status).toBe(403);
  });

  it("404s when the invitation does not belong to the caller's workspace", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }));
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await approveMember(request("inv-1"));
    expect(response.status).toBe(404);
  });

  it("409s when the invitation is not awaiting approval", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "inv-1", email: "jane@fairway.test", role: "admin", status: "pending" }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from, auth: { admin: {} } });

    const response = await approveMember(request("inv-1"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("not_awaiting_approval");
  });

  it("activates the membership with the invitation's role, lifts the ban, and marks the invitation accepted", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", role: "admin", status: "awaiting_approval" },
      error: null,
    });
    const memberLookup = chain({ data: { id: "member-2" }, error: null });
    const activateUpdate = chain({ data: null, error: null });
    const acceptUpdate = chain({ data: null, error: null });
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "jane-uid", email: "jane@fairway.test" }] },
      error: null,
    }));
    const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
    const from = vi
      .fn()
      .mockReturnValueOnce(invitationLookup)
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(activateUpdate)
      .mockReturnValueOnce(acceptUpdate);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { listUsers, updateUserById } } });

    const response = await approveMember(request("inv-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approved: true });

    expect(activateUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true, role: "admin", removed_at: null }),
    );
    expect(activateUpdate.eq).toHaveBeenCalledWith("id", "member-2");
    expect(updateUserById).toHaveBeenCalledWith("jane-uid", { ban_duration: "none" });
    expect(acceptUpdate.update).toHaveBeenCalledWith({ status: "accepted" });
  });
});

describe("POST /api/team/invitations/reject", () => {
  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await rejectMember(request("inv-1"));
    expect(response.status).toBe(403);
  });

  it("404s for an invitation in a different workspace", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }));
    getServiceSupabase.mockReturnValue({ from });

    const response = await rejectMember(request("inv-1"));
    expect(response.status).toBe(404);
  });

  it("409s when the invitation is not awaiting approval", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "inv-1", email: "jane@fairway.test", status: "accepted" }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from });

    const response = await rejectMember(request("inv-1"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("not_awaiting_approval");
  });

  it("marks the invitation rejected, stamps removed_at on the member, and never touches the ban", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", status: "awaiting_approval" },
      error: null,
    });
    const memberLookup = chain({ data: { id: "member-2" }, error: null });
    const removeUpdate = chain({ data: null, error: null });
    const rejectUpdate = chain({ data: null, error: null });
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "jane-uid", email: "jane@fairway.test" }] },
      error: null,
    }));
    const updateUserById = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(invitationLookup)
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(removeUpdate)
      .mockReturnValueOnce(rejectUpdate);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { listUsers, updateUserById } } });

    const response = await rejectMember(request("inv-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rejected: true });

    expect(removeUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ removed_at: expect.any(String) }),
    );
    expect(removeUpdate.eq).toHaveBeenCalledWith("id", "member-2");
    expect(rejectUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", rejected_at: expect.any(String) }),
    );
    expect(from).toHaveBeenCalledTimes(4);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
