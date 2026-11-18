// POST /api/team/invitations surfaces a distinct rate_limited response when
// Supabase Auth's email-send quota is hit, instead of the generic
// invite_failed — on both the fresh-invite and reactivation paths. See
// src/lib/team/invites.ts's isEmailRateLimited() and the route's own header
// comment for why those are two different Supabase Auth calls.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
const getServiceSupabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase }));
vi.mock("@/lib/app-url", () => ({
  getAppUrl: () => "https://fairway-crm-one.vercel.app",
  AppUrlConfigError: class AppUrlConfigError extends Error {},
}));

import { POST as inviteMembers } from "@/app/api/team/invitations/route";

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

function request(body: unknown) {
  return new Request("http://test/api/team/invitations", { method: "POST", body: JSON.stringify(body) });
}

const RATE_LIMIT_ERROR = { message: "Email rate limit exceeded", code: "over_email_send_rate_limit" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/invitations — email rate limiting", () => {
  it("returns rate_limited (not invite_failed) and rolls back the row when a fresh invite hits the quota", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationInsert = chain({
      data: { id: "inv-1", email: "new@fairway.test", role: "sales_rep", status: "pending" },
      error: null,
    });
    const deleteChain = chain({ data: null, error: null });
    const from = vi.fn().mockReturnValueOnce(invitationInsert).mockReturnValueOnce(deleteChain);
    const inviteUserByEmail = vi.fn(async () => ({ data: null, error: RATE_LIMIT_ERROR }));
    getServiceSupabase.mockReturnValue({
      auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })), inviteUserByEmail } },
      from,
    });

    const response = await inviteMembers(request({ email: "new@fairway.test", role: "sales_rep" }));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("rate_limited");
    // Rolled back so a later retry doesn't collide with the pending-unique index.
    expect(deleteChain.delete).toHaveBeenCalled();
  });

  it("returns rate_limited on the reactivation (resetPasswordForEmail) path too", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const memberLookup = chain({ data: { is_active: false }, error: null });
    const invitationInsert = chain({
      data: { id: "inv-2", email: "jane@fairway.test", role: "admin", status: "pending" },
      error: null,
    });
    const deleteChain = chain({ data: null, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(memberLookup)
      .mockReturnValueOnce(invitationInsert)
      .mockReturnValueOnce(deleteChain);
    getServiceSupabase.mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: { users: [{ id: "removed-uid", email: "jane@fairway.test" }] },
            error: null,
          })),
          updateUserById: vi.fn(async () => ({ data: {}, error: null })),
          inviteUserByEmail: vi.fn(),
        },
        resetPasswordForEmail: vi.fn(async () => ({ data: null, error: RATE_LIMIT_ERROR })),
      },
      from,
    });

    const response = await inviteMembers(request({ email: "jane@fairway.test", role: "admin" }));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("rate_limited");
  });

  it("still returns invite_failed (502) for a non-rate-limit send failure", async () => {
    getServerSupabase.mockResolvedValue(serverClient("owner"));
    const invitationInsert = chain({
      data: { id: "inv-3", email: "broken@fairway.test", role: "sales_rep", status: "pending" },
      error: null,
    });
    const deleteChain = chain({ data: null, error: null });
    const from = vi.fn().mockReturnValueOnce(invitationInsert).mockReturnValueOnce(deleteChain);
    const inviteUserByEmail = vi.fn(async () => ({ data: null, error: { message: "SMTP down" } }));
    getServiceSupabase.mockReturnValue({
      auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })), inviteUserByEmail } },
      from,
    });

    const response = await inviteMembers(request({ email: "broken@fairway.test", role: "sales_rep" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("invite_failed");
  });
});
