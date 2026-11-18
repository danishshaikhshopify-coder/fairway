// Route-level tests for POST /api/team/invitations/resend: owner-only,
// only a pending invitation can be resent, and resending never creates a
// second invitations row — it only re-triggers the Supabase email.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));
vi.mock("@/lib/app-url", () => ({
  getAppUrl: () => "https://fairway-crm-one.vercel.app",
  AppUrlConfigError: class AppUrlConfigError extends Error {},
}));

import { POST as resendInvite } from "@/app/api/team/invitations/resend/route";

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
  return new Request("http://test/api/team/invitations/resend", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/invitations/resend", () => {
  it("refuses a non-owner caller before touching the service client", async () => {
    getServerSupabase.mockResolvedValue(serverClient("sales_rep"));
    getServiceSupabase.mockReturnValue(undefined);

    const response = await resendInvite(request("inv-1"));
    expect(response.status).toBe(403);
  });

  it("404s when the invitation does not exist in this workspace", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }));
    getServiceSupabase.mockReturnValue({ from });

    const response = await resendInvite(request("missing"));
    expect(response.status).toBe(404);
  });

  it("refuses to resend an invitation that is no longer pending", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const from = vi.fn().mockReturnValueOnce(
      chain({ data: { id: "inv-1", email: "jane@fairway.test", status: "accepted" }, error: null }),
    );
    getServiceSupabase.mockReturnValue({ from });

    const response = await resendInvite(request("inv-1"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("not_pending");
  });

  it("resends via resetPasswordForEmail when the invitee's auth account already exists", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", status: "pending" },
      error: null,
    });
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "jane-uid", email: "jane@fairway.test" }] },
      error: null,
    }));
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    const inviteUserByEmail = vi.fn();
    const from = vi.fn().mockReturnValueOnce(invitationLookup);
    getServiceSupabase.mockReturnValue({
      from,
      auth: { admin: { listUsers, inviteUserByEmail }, resetPasswordForEmail },
    });

    const response = await resendInvite(request("inv-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ resent: true });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "jane@fairway.test",
      expect.objectContaining({ redirectTo: expect.stringContaining("/invite/accept") }),
    );
    // Never touches invitations again — no second row, no duplicate.
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("falls back to inviteUserByEmail when no auth account exists yet", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-2", email: "new@fairway.test", status: "pending" },
      error: null,
    });
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const inviteUserByEmail = vi.fn(async () => ({ data: {}, error: null }));
    const from = vi.fn().mockReturnValueOnce(invitationLookup);
    getServiceSupabase.mockReturnValue({
      from,
      auth: { admin: { listUsers, inviteUserByEmail } },
    });

    const response = await resendInvite(request("inv-2"));
    expect(response.status).toBe(200);
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      "new@fairway.test",
      expect.objectContaining({ redirectTo: expect.stringContaining("/invite/accept") }),
    );
  });

  it("surfaces a clear error when the resend call itself fails", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationLookup = chain({
      data: { id: "inv-1", email: "jane@fairway.test", status: "pending" },
      error: null,
    });
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: "jane-uid", email: "jane@fairway.test" }] },
      error: null,
    }));
    const resetPasswordForEmail = vi.fn(async () => ({ data: null, error: { message: "rate limited" } }));
    const from = vi.fn().mockReturnValueOnce(invitationLookup);
    getServiceSupabase.mockReturnValue({
      from,
      auth: { admin: { listUsers, inviteUserByEmail: vi.fn() }, resetPasswordForEmail },
    });

    const response = await resendInvite(request("inv-1"));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("resend_failed");
  });
});
