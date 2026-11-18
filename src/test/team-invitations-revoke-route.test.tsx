// Route-level tests for POST /api/team/invitations/revoke: owner-only, and
// only a PENDING invitation can be revoked — revoking an already-accepted
// one must never reach the deactivation side effect below (that would
// silently deactivate a now-active member outside the real Remove flow).
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));

import { POST as revokeInvite } from "@/app/api/team/invitations/revoke/route";

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

function request(id: string) {
  return new Request("http://test/api/team/invitations/revoke", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/invitations/revoke", () => {
  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await revokeInvite(request("inv-1"));
    expect(response.status).toBe(403);
  });

  it("404s when the invitation does not exist in this workspace", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }));
    getServiceSupabase.mockReturnValue({ from });

    const response = await revokeInvite(request("missing"));
    expect(response.status).toBe(404);
  });

  it("refuses to revoke an invitation that was already accepted, and never deactivates the member", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", status: "accepted" },
      error: null,
    });
    const listUsers = vi.fn();
    const from = vi.fn().mockReturnValueOnce(invitationLookup);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { listUsers } } });

    const response = await revokeInvite(request("inv-1"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("not_pending");
    // Never even looks up auth users to deactivate a member once the status
    // guard rejects the request.
    expect(listUsers).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("refuses to re-revoke an already-revoked invitation", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", status: "revoked" },
      error: null,
    });
    const from = vi.fn().mockReturnValueOnce(invitationLookup);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { listUsers: vi.fn() } } });

    const response = await revokeInvite(request("inv-1"));
    expect(response.status).toBe(409);
  });

  it("revokes a pending invitation and deactivates the matching member created by handle_new_user()", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", status: "pending" },
      error: null,
    });
    const invitationUpdate = chain({ data: null, error: null });
    const memberUpdate = chain({ data: null, error: null });
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "jane-uid", email: "jane@fairway.test" }] },
      error: null,
    }));
    const from = vi
      .fn()
      .mockReturnValueOnce(invitationLookup)
      .mockReturnValueOnce(invitationUpdate)
      .mockReturnValueOnce(memberUpdate);
    getServiceSupabase.mockReturnValue({ from, auth: { admin: { listUsers } } });

    const response = await revokeInvite(request("inv-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ revoked: true });
    expect(invitationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked" }),
    );
    expect(memberUpdate.update).toHaveBeenCalledWith({ is_active: false });
  });
});
