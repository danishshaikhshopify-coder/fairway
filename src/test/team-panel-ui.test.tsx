// React DOM tests for Settings → Team: the Remove-member action's
// confirmation dialog, authorization-driven visibility, the roster visibly
// reflecting a successful removal, and the Removed Members re-invite action
// that follows it. Only sonner and the Supabase client factory are mocked;
// fetch is stubbed per test.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase/client", () => ({
  isLiveMode: () => true,
}));

import { toast } from "sonner";
import { TeamPanel } from "@/components/crm/team-panel";

const OWNER = {
  id: "member-owner",
  email: "owner@fairway.test",
  fullName: "Owner Person",
  role: "owner",
  isActive: true,
  removed: false,
  removedAt: null,
  banned: false,
  receivesReminders: false,
  gmailConnected: false,
  gmailEmail: null,
};

const BASE_PARTNER = {
  id: "member-partner",
  email: "jane@fairway.test",
  fullName: "Jane Partner",
  role: "admin",
  isActive: true,
  removed: false,
  removedAt: null,
  banned: false,
  receivesReminders: false,
  gmailConnected: false,
  gmailEmail: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

// Mirrors what the real route pair does: a successful remove is reflected on
// the NEXT GET — this is the exact thing regressing when the roster looks
// unchanged after clicking Remove.
function installFetch(removeImpl?: () => Response) {
  let partner = { ...BASE_PARTNER };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/team/members" && !init?.method) {
      return jsonResponse({ members: [OWNER, partner] });
    }
    if (url === "/api/team/invitations" && !init?.method) {
      return jsonResponse({ invitations: [] });
    }
    if (url === "/api/team/members/remove" && init?.method === "POST") {
      if (removeImpl) return removeImpl();
      partner = { ...partner, isActive: false, removed: true, banned: true };
      return jsonResponse({ removed: true });
    }
    throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Team panel — remove member", () => {
  it("offers Remove for a partner but never for the owner", async () => {
    installFetch();
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");
    const rows = screen.getAllByRole("row");
    const ownerRow = rows.find((r) => within(r).queryByText("Owner Person"));
    const partnerRow = rows.find((r) => within(r).queryByText("Jane Partner"));
    expect(ownerRow && within(ownerRow).queryByRole("button", { name: /Remove/ })).toBeFalsy();
    expect(partnerRow && within(partnerRow).getByRole("button", { name: /Remove/ })).toBeTruthy();
  });

  it("shows the member's name and email before removing, and does nothing on cancel", async () => {
    const fetchMock = installFetch();
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Jane Partner/)).toBeTruthy();
    expect(within(dialog).getByText(/jane@fairway\.test/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/team/members/remove",
      expect.anything(),
    );
  });

  it("removes on confirm, refreshes the roster, and reports success", async () => {
    const fetchMock = installFetch();
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");
    const callsBeforeRemoval = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/team/members/remove",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "member-partner" }) }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // GET /api/team/members and /api/team/invitations ran again after removal.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRemoval + 1));

    // The roster must visibly reflect the removal without a manual refresh:
    // the member moves out of the active table into Removed Members, and
    // Remove can't be clicked again (Re-invite replaces it there instead).
    await waitFor(() => expect(screen.getByText("Removed members")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Re-invite/ })).toBeTruthy();
  });

  it("reports an error and leaves the roster alone when removal fails", async () => {
    installFetch(() => jsonResponse({ error: "forbidden", message: "Only the owner can remove team members." }, 403));
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("Jane Partner")).toBeTruthy();
  });
});

describe("Team panel — team overview", () => {
  it("shows active, pending and removed counts as summary cards", async () => {
    const removedMember = {
      ...BASE_PARTNER,
      id: "member-removed",
      email: "exited@fairway.test",
      fullName: "Exited Partner",
      isActive: false,
      removed: true,
      removedAt: "2026-11-10T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/team/members" && !init?.method) {
        return jsonResponse({ members: [OWNER, BASE_PARTNER, removedMember] });
      }
      if (url === "/api/team/invitations" && !init?.method) {
        return jsonResponse({
          invitations: [
            { id: "inv-1", email: "new@fairway.test", role: "viewer", status: "pending", created_at: new Date().toISOString() },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");

    const overview = screen.getByRole("region", { name: "Team overview" });
    expect(within(overview).getByText("Active")).toBeTruthy();
    expect(within(overview).getByText("Pending")).toBeTruthy();
    expect(within(overview).getByText("Removed")).toBeTruthy();
    // Active = OWNER + Jane (removedMember is excluded), Pending = 1.
    expect(within(overview).getByText("2")).toBeTruthy();
    expect(within(overview).getAllByText("1")).toHaveLength(2); // pending + removed
  });
});

describe("Team panel — removed members / re-invite", () => {
  const REMOVED_MEMBER = {
    ...BASE_PARTNER,
    isActive: false,
    removed: true,
    removedAt: "2026-11-10T00:00:00.000Z",
  };

  function installRemovedFetch(reinviteImpl?: () => Response, pendingInvitations: unknown[] = []) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/team/members" && !init?.method) {
        return jsonResponse({ members: [OWNER, REMOVED_MEMBER] });
      }
      if (url === "/api/team/invitations" && !init?.method) {
        return jsonResponse({ invitations: pendingInvitations });
      }
      if (url === "/api/team/invitations" && init?.method === "POST") {
        if (reinviteImpl) return reinviteImpl();
        return jsonResponse({ invitation: { id: "inv-1", email: "jane@fairway.test", role: "sales_rep" } });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("never offers Remove again for an already-removed member, and hides them from the active table", async () => {
    installRemovedFetch();
    render(<TeamPanel />);
    await screen.findByText("Removed members");
    expect(screen.queryByRole("button", { name: /^Remove$/ })).toBeNull();
    // Only one "Jane Partner" row exists — in Removed Members, not the active table.
    expect(screen.getAllByText("Jane Partner")).toHaveLength(1);
  });

  it("re-invites with the role chosen in the Removed Members row, not any old role", async () => {
    const fetchMock = installRemovedFetch();
    render(<TeamPanel />);
    await screen.findByText("Removed members");

    fireEvent.click(screen.getByRole("button", { name: /Re-invite/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/team/invitations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "jane@fairway.test", role: "sales_rep" }),
        }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("shows 'Invitation sent' instead of a Re-invite button once a pending invitation exists", async () => {
    installRemovedFetch(undefined, [
      { id: "inv-1", email: "jane@fairway.test", role: "sales_rep", status: "pending", created_at: new Date().toISOString() },
    ]);
    render(<TeamPanel />);
    await screen.findByText("Removed members");
    expect(screen.getByText("Invitation sent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Re-invite/ })).toBeNull();
  });

  it("reports an error and keeps the member in Removed Members when re-inviting fails", async () => {
    installRemovedFetch(() =>
      jsonResponse({ error: "already_invited", message: "There is already a pending invitation for this email." }, 409),
    );
    render(<TeamPanel />);
    await screen.findByText("Removed members");

    fireEvent.click(screen.getByRole("button", { name: /Re-invite/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("Removed members")).toBeTruthy();
  });

  it("shows the member's previous role and removal date as historical info, not an editable field", async () => {
    installRemovedFetch();
    render(<TeamPanel />);
    await screen.findByText("Removed members");
    // Previous role (Admin, from BASE_PARTNER's role) renders as a read-only badge.
    expect(screen.getByText("Admin")).toBeTruthy();
    // Removed date comes from removedAt, formatted.
    expect(screen.getByText(new Date("2026-11-10T00:00:00.000Z").toLocaleDateString())).toBeTruthy();
  });
});

describe("Team panel — removed members empty state", () => {
  it("shows a useful empty state instead of nothing when there are no removed members", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/team/members" && !init?.method) {
        return jsonResponse({ members: [OWNER, BASE_PARTNER] });
      }
      if (url === "/api/team/invitations" && !init?.method) {
        return jsonResponse({ invitations: [] });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");
    expect(screen.getByText("No removed members")).toBeTruthy();
  });
});

describe("Team panel — loading and error states", () => {
  it("shows a loading state instead of a misleading empty state while the roster is still fetching", async () => {
    let resolveMembers!: (value: Response) => void;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/team/members" && !init?.method) {
        return new Promise<Response>((resolve) => {
          resolveMembers = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamPanel />);

    // Still loading: must not claim "No members yet" before we actually know that.
    await waitFor(() => expect(screen.getByText(/Loading members/)).toBeTruthy());
    expect(screen.queryByText("No members yet.")).toBeNull();

    resolveMembers(jsonResponse({ members: [OWNER] }));
    await waitFor(() => expect(screen.queryByText(/Loading members/)).toBeNull());
  });

  it("shows a persistent error (not just a toast) when loading the roster fails, instead of claiming it's empty", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/team/members" && !init?.method) {
        return jsonResponse({ error: "server_error", message: "Database unavailable." }, 500);
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamPanel />);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The error must stay on screen after the toast would have dismissed —
    // an empty roster and a failed load must never look identical.
    expect(await screen.findByText("Database unavailable.")).toBeTruthy();
    expect(screen.queryByText("No members yet.")).toBeNull();
  });
});

describe("Team panel — pending invitations", () => {
  function installPendingFetch(opts: {
    invitations?: unknown[];
    resendImpl?: () => Response;
    revokeImpl?: () => Response;
  } = {}) {
    const invitations = opts.invitations ?? [
      { id: "inv-1", email: "new@fairway.test", role: "viewer", status: "pending", created_at: new Date().toISOString() },
    ];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/team/members" && !init?.method) {
        return jsonResponse({ members: [OWNER, BASE_PARTNER] });
      }
      if (url === "/api/team/invitations" && !init?.method) {
        return jsonResponse({ invitations });
      }
      if (url === "/api/team/invitations/resend" && init?.method === "POST") {
        return opts.resendImpl ? opts.resendImpl() : jsonResponse({ resent: true });
      }
      if (url === "/api/team/invitations/revoke" && init?.method === "POST") {
        return opts.revokeImpl ? opts.revokeImpl() : jsonResponse({ revoked: true });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows a useful empty state when there are no pending invitations", async () => {
    installPendingFetch({ invitations: [] });
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");
    expect(screen.getByText("No pending invitations")).toBeTruthy();
  });

  it("resends the invite email without creating a duplicate invitation", async () => {
    const fetchMock = installPendingFetch();
    render(<TeamPanel />);
    await screen.findByText("new@fairway.test");

    fireEvent.click(screen.getByRole("button", { name: /Resend/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/team/invitations/resend",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "inv-1" }) }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("cancels (revokes) a pending invitation", async () => {
    const fetchMock = installPendingFetch();
    render(<TeamPanel />);
    await screen.findByText("new@fairway.test");

    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/team/invitations/revoke",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "inv-1" }) }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("reports an error and keeps the invitation listed when resend fails", async () => {
    installPendingFetch({
      resendImpl: () => jsonResponse({ error: "resend_failed", message: "Could not resend." }, 502),
    });
    render(<TeamPanel />);
    await screen.findByText("new@fairway.test");

    fireEvent.click(screen.getByRole("button", { name: /Resend/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("new@fairway.test")).toBeTruthy();
  });
});
