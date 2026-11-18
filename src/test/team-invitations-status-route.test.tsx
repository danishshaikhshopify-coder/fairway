// Route-level tests for POST /api/team/invitations/status — intentionally
// unauthenticated. Must return true only for a genuinely awaiting_approval
// invitation, and must never return any field beyond that one boolean (it
// cannot become a richer enumeration oracle than the login page's own
// already-proven-password/banned-account failure).
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServiceSupabase = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabase }));

import { POST as checkStatus } from "@/app/api/team/invitations/status/route";

function chain(result: { data: unknown; error: unknown }) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) node[method] = vi.fn(() => node);
  node.maybeSingle = vi.fn(async () => result);
  return node;
}

function request(email: unknown) {
  return new Request("http://test/api/team/invitations/status", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/team/invitations/status", () => {
  it("400s when email is missing", async () => {
    getServiceSupabase.mockReturnValue({ from: vi.fn() });
    const response = await checkStatus(request(undefined));
    expect(response.status).toBe(400);
  });

  it("returns awaitingApproval: true, and ONLY that key, for a matching awaiting_approval row", async () => {
    const from = vi.fn(() => chain({ data: { id: "inv-1" }, error: null }));
    getServiceSupabase.mockReturnValue({ from });

    const response = await checkStatus(request("jane@fairway.test"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ awaitingApproval: true });
    expect(Object.keys(body)).toEqual(["awaitingApproval"]);
  });

  it.each(["no invitation at all", "pending", "accepted", "revoked", "rejected"])(
    "returns false for %s",
    async () => {
      const from = vi.fn(() => chain({ data: null, error: null }));
      getServiceSupabase.mockReturnValue({ from });

      const response = await checkStatus(request("someone@fairway.test"));
      const body = await response.json();
      expect(body).toEqual({ awaitingApproval: false });
    },
  );
});
