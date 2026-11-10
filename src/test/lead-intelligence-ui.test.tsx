// React DOM tests for /lead-intelligence — real page + store, demo-mode mock
// leads (isolated fixture data; no live Supabase client is ever constructed
// in this environment). Covers the populated state (multiple leads, varied
// fit scores, qualifications) and the selection/detail transition — the
// Phase 4A QA gap for this page.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrmProvider } from "@/lib/crm-store";
import LeadIntelligencePage from "@/app/lead-intelligence/page";

function renderPage() {
  return render(
    <CrmProvider>
      <LeadIntelligencePage />
    </CrmProvider>,
  );
}

describe("Lead intelligence page", () => {
  it("renders the populated demo fixture sorted by fit score, highest first", () => {
    renderPage();
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(12);
    // Highest fit score (91) sorts first.
    expect(within(rows[0]).getByText("Apex Indoor Golf")).toBeTruthy();
    // Varied qualifications are all present in the populated list.
    expect(screen.getAllByText("Qualified").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disqualified").length).toBeGreaterThan(0);
  });

  it("shows the top lead's detail panel selected by default", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Apex Indoor Golf" }),
    ).toBeTruthy();
    expect(screen.getByText("91/100")).toBeTruthy();
  });

  it("clicking a row transitions the detail panel to that lead", () => {
    renderPage();
    fireEvent.click(screen.getByText("Baja Golf Studio"));

    expect(
      screen.getByRole("heading", { name: "Baja Golf Studio" }),
    ).toBeTruthy();
    // Fit score (71) and lead score (72) differ, proving the right fields moved.
    expect(screen.getByText("71/100")).toBeTruthy();
    expect(
      screen.getByText(
        "First discovery call: confirm install volume and garage constraints.",
      ),
    ).toBeTruthy();
    // The previous selection's detail content is gone, not just supplemented.
    expect(screen.queryByText("91/100")).toBeNull();
  });
});
