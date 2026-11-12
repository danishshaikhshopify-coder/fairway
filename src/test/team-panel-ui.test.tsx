// React DOM tests for Settings → Team: the Remove-member action's
// confirmation dialog, authorization-driven visibility, and the
// success/error paths after confirming. Only sonner and the Supabase client
// factory are mocked; fetch is stubbed per test.
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
      partner = { ...partner, isActive: false, banned: true };
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
    // a "Removed" badge replaces the toggle, and Remove can't be clicked again.
    await waitFor(() => expect(screen.getByText("Removed")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("never offers Remove again for an already-removed member", async () => {
    installFetch();
    const removedMember = { ...BASE_PARTNER, isActive: false, banned: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/team/members" && !init?.method) {
          return jsonResponse({ members: [OWNER, removedMember] });
        }
        if (url === "/api/team/invitations" && !init?.method) {
          return jsonResponse({ invitations: [] });
        }
        throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
      }),
    );
    render(<TeamPanel />);
    await screen.findByText("Jane Partner");
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
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
