// React DOM regression: live mode must never render the fabricated mock rows.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const supa = vi.hoisted(() => ({
  live: true as boolean,
  userId: "user-1" as string | null,
  loadWorkspaceContext: vi.fn(),
  loadLeads: vi.fn(),
  loadCompanies: vi.fn(),
  loadContacts: vi.fn(),
  loadTasks: vi.fn(),
  loadActivities: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    live: supa.live,
    ready: true,
    session: supa.userId ? { user: { id: supa.userId } } : null,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  isLiveMode: () => supa.live,
  getSupabase: () => ({}) as unknown,
}));

vi.mock("@/lib/supabase/repository", () => ({
  loadWorkspaceContext: (...args: unknown[]) => supa.loadWorkspaceContext(...args),
  loadLeads: (...args: unknown[]) => supa.loadLeads(...args),
  loadCompanies: (...args: unknown[]) => supa.loadCompanies(...args),
  loadContacts: (...args: unknown[]) => supa.loadContacts(...args),
  loadTasks: (...args: unknown[]) => supa.loadTasks(...args),
  loadActivities: (...args: unknown[]) => supa.loadActivities(...args),
}));

import { CrmProvider } from "@/lib/crm-store";
import CompaniesPage from "@/app/companies/page";
import LeadsPage from "@/app/leads/page";

const MOCK_NAMES = [
  "Apex Indoor Golf",
  "Fairway Golf Solutions",
  "Northshore Golf Labs",
  "Sierra Green Golf",
  "Marcus Hale",
  "A. Rivera",
  "J. Chen",
  "M. Thompson",
  "C. Navarro",
];

beforeEach(() => {
  vi.clearAllMocks();
  supa.live = true;
  supa.userId = "user-1";
  supa.loadWorkspaceContext.mockResolvedValue({
    workspaceId: "ws-1",
    directory: { membersByName: new Map(), sourcesByName: new Map() },
  });
  supa.loadLeads.mockResolvedValue([]);
  supa.loadCompanies.mockResolvedValue([]);
  supa.loadContacts.mockResolvedValue([]);
  supa.loadTasks.mockResolvedValue([]);
  supa.loadActivities.mockResolvedValue([]);
});

describe("live mode never renders mock CRM rows", () => {
  it("shows no mock companies on first render (loading state)", () => {
    render(<CrmProvider><CompaniesPage /></CrmProvider>);
    for (const name of MOCK_NAMES) {
      expect(screen.queryByText(name)).toBeNull();
    }
  });

  it("shows no mock companies after hydration", async () => {
    render(<CrmProvider><CompaniesPage /></CrmProvider>);
    await waitFor(() => expect(supa.loadCompanies).toHaveBeenCalled());
    for (const name of MOCK_NAMES) {
      expect(screen.queryByText(name)).toBeNull();
    }
  });

  it("leaves the CRM empty when hydration fails", async () => {
    supa.loadCompanies.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<CrmProvider><CompaniesPage /></CrmProvider>);
    await waitFor(() => expect(supa.loadCompanies).toHaveBeenCalled());
    for (const name of MOCK_NAMES) {
      expect(screen.queryByText(name)).toBeNull();
    }
    spy.mockRestore();
  });

  it("shows no mock leads after hydration", async () => {
    render(<CrmProvider><LeadsPage /></CrmProvider>);
    await waitFor(() => expect(supa.loadLeads).toHaveBeenCalled());
    for (const name of MOCK_NAMES) {
      expect(screen.queryByText(name)).toBeNull();
    }
  });
});