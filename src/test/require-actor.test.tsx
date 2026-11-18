// Unit test for requireActor(): a deactivated/removed caller must never
// resolve an actor from a stale workspace_members row, even if their Auth
// account was never banned (removal treats banning as best-effort — see
// src/app/api/team/members/remove/route.ts). Without this, the caller keeps
// their old role on every requireActor()-gated route indefinitely.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSupabase = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase, getServiceSupabase: vi.fn() }));

import { requireActor } from "@/lib/api/auth";

function chain(result: { data: unknown; error: unknown }) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    node[method] = vi.fn(() => node);
  }
  node.maybeSingle = vi.fn(async () => result);
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireActor", () => {
  it("filters the workspace_members lookup by is_active=true, so a removed/deactivated caller never resolves an actor", async () => {
    const memberChain = chain({ data: null, error: null });
    getServerSupabase.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "removed-uid" } }, error: null })) },
      from: vi.fn(() => memberChain),
    });

    const result = await requireActor();
    expect(result.response?.status).toBe(403);
    const body = await result.response!.json();
    expect(body.error).toBe("no_workspace");

    // Proves the gap is actually closed at the query level, not just by
    // coincidence of the fixture: the lookup must constrain on is_active.
    expect((memberChain.eq as unknown as { mock: { calls: unknown[][] } }).mock.calls).toContainEqual([
      "is_active",
      true,
    ]);
  });
});
