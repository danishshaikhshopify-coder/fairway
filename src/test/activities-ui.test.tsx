// React DOM tests for /activities — real page + store, demo-mode mock
// activities (isolated fixture data; no live Supabase client is ever
// constructed in this environment). Covers the populated state (multiple
// activity types, long subjects, timestamps), search, type filter, and
// deletion — the Phase 4A QA gap for this page.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CrmProvider } from "@/lib/crm-store";
import ActivitiesPage from "@/app/activities/page";

function renderPage() {
  return render(
    <CrmProvider>
      <ActivitiesPage />
    </CrmProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Activities page", () => {
  it("renders the populated demo fixture: multiple types, long subjects, timestamps", () => {
    renderPage();
    expect(screen.getByText("12 of 12 activities")).toBeTruthy();
    // A long subject renders in full, not truncated to emptiness.
    expect(
      screen.getByText("Discovery call — 22 min, asked about financing"),
    ).toBeTruthy();
    // Multiple distinct activity types are present in the populated list.
    expect(screen.getAllByText("Call").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Email").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Meeting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Note").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Follow-up").length).toBeGreaterThan(0);
  });

  it("search narrows by subject, company, or owner", () => {
    renderPage();
    const search = screen.getByLabelText("Search activities");
    fireEvent.change(search, { target: { value: "Sierra Green" } });
    expect(screen.getByText(/\d+ of 12 activities/)).toBeTruthy();
    expect(
      screen.getByText("Prospect asked for a Spanish-language catalog"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Discovery call — 22 min, asked about financing"),
    ).toBeNull();
  });

  it("the type filter narrows to one activity type", () => {
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: "Filter by type" }));
    const option = screen.getByRole("option", { name: "Meeting" });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(screen.getByText("2 of 12 activities")).toBeTruthy();
    expect(screen.queryByText("Call")).toBeNull();
  });

  it("an unmatched search shows the filtered empty state with a clear-filters action", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Search activities"), {
      target: { value: "no such activity exists" },
    });
    expect(screen.getByText("No activity matches your filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("12 of 12 activities")).toBeTruthy();
  });

  it("deleting an activity removes it after confirmation", () => {
    renderPage();
    const subject = "Discovery call — 22 min, asked about financing";
    fireEvent.click(screen.getByRole("button", { name: `Delete activity "${subject}"` }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(screen.getByText("11 of 11 activities")).toBeTruthy();
    expect(screen.queryByText(subject)).toBeNull();
  });
});
