// Unit test for the team_audit_log write helper (B10). No live database.
import { describe, expect, it, vi } from "vitest";
import { logTeamEvent } from "@/lib/team/audit";

// Same chain() helper shape already used by team-reactivation-routes.test.tsx
// etc: a terminal method resolves to `result`; the chain is also awaitable
// directly via `then` for calls that never terminate explicitly.
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

describe("logTeamEvent", () => {
  it("inserts the full mapped payload, defaulting result to success", async () => {
    const node = chain({ data: null, error: null });
    const db = { from: vi.fn(() => node) };

    await logTeamEvent(db as never, {
      workspaceId: "ws-1",
      actorMemberId: "mem-1",
      targetEmail: "bob@fairway.test",
      targetUserId: "user-1",
      action: "member_approved",
      previousValue: { isActive: false },
      newValue: { isActive: true },
    });

    expect(db.from).toHaveBeenCalledWith("team_audit_log");
    expect(node.insert).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      actor_member_id: "mem-1",
      target_email: "bob@fairway.test",
      target_user_id: "user-1",
      action: "member_approved",
      previous_value: { isActive: false },
      new_value: { isActive: true },
      result: "success",
    });
  });

  it("defaults optional fields to null and honors an explicit failure result", async () => {
    const node = chain({ data: null, error: null });
    const db = { from: vi.fn(() => node) };

    await logTeamEvent(db as never, {
      workspaceId: "ws-1",
      action: "login_failure",
      result: "failure",
    });

    expect(node.insert).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      actor_member_id: null,
      target_email: null,
      target_user_id: null,
      action: "login_failure",
      previous_value: null,
      new_value: null,
      result: "failure",
    });
  });

  it("logs an insert error to the console but never throws", async () => {
    const node = chain({ data: null, error: { message: "boom" } });
    const db = { from: vi.fn(() => node) };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logTeamEvent(db as never, { workspaceId: "ws-1", action: "invitation_created" }),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("boom"));

    consoleError.mockRestore();
  });
});
