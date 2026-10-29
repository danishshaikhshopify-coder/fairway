// React DOM tests for lead duplicate detection, editing, and deletion on the
// Leads page — real page + store; only sonner and next/link are mocked.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: ComponentProps<"a">) =>
      React.createElement("a", { href: String(href), ...rest }, children),
  };
});

import { toast } from "sonner";
import { CrmProvider } from "@/lib/crm-store";
import LeadsPage from "@/app/leads/page";

function renderPage() {
  return render(
    <CrmProvider>
      <LeadsPage />
    </CrmProvider>,
  );
}

function fill(dialog: HTMLElement, label: RegExp, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

/** Find a lead's row menu the way a user does, then open "View details". */
function openFirstDetailSheet() {
  const menus = screen.getAllByRole("button", { name: /^Actions for / });
  fireEvent.click(menus[0]);
  fireEvent.click(screen.getByRole("menuitem", { name: "View details" }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Duplicate detection", () => {
  it("rejects a lead with the same email AND company as an existing lead", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add lead" }));
    const dialog = screen.getByRole("dialog");

    fill(dialog, /company/i, "Apex Indoor Golf");
    fill(dialog, /contact/i, "Impostor Person");
    fill(dialog, /email/i, "MARCUS@apexindoor.example"); // case-insensitive
    fill(dialog, /estimated value/i, "1000");
    fill(dialog, /^next follow-up/i, "2026-11-20");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add lead" }));

    expect(toast.error).toHaveBeenCalledWith(
      "Possible duplicate — Apex Indoor Golf already has a lead with this email.",
    );
    expect(
      within(dialog).getByText(
        "A lead for Apex Indoor Golf with this email already exists.",
      ),
    ).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("allows the same email under a different company (multiple deals)", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add lead" }));
    const dialog = screen.getByRole("dialog");

    fill(dialog, /company/i, "Apex Indoor Golf Annex");
    fill(dialog, /contact/i, "Marcus Hale");
    fill(dialog, /email/i, "marcus@apexindoor.example");
    fill(dialog, /estimated value/i, "10000");
    fill(dialog, /^next follow-up/i, "2026-11-20");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add lead" }));

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Lead added for Apex Indoor Golf Annex.",
    );
  });
});

describe("Editing a lead", () => {
  it("opens the edit dialog prefilled, saves changes, and toasts", () => {
    renderPage();
    const sheet = openFirstDetailSheet();

    fireEvent.click(within(sheet).getByRole("button", { name: /edit lead/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit lead" })).toBeTruthy();
    // Prefilled from the existing lead (Apex Indoor Golf = seeded ld-1).
    expect(
      within(dialog).getByLabelText(/company/i) as HTMLInputElement,
    ).toHaveProperty("value", "Apex Indoor Golf");

    fill(dialog, /estimated value/i, "99000");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(toast.success).toHaveBeenCalledWith("Lead updated for Apex Indoor Golf.");
    expect(toast.error).not.toHaveBeenCalled();
    // The edit dialog closes; the detail sheet stays open (it is the context
    // the edit was started from) and now shows the updated value — as does
    // the row behind it, hence getAllByText.
    expect(screen.queryByRole("heading", { name: "Edit lead" })).toBeNull();
    expect(screen.getAllByText("$99,000").length).toBeGreaterThan(0);
  });

  it("closing the dialog with Cancel leaves edit mode (next open is Add)", () => {
    renderPage();
    const sheet = openFirstDetailSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: /edit lead/i }));

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("heading", { name: "Edit lead" })).toBeNull();

    // Close the (modal) sheet so the page header is reachable again.
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add lead" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", { name: "Add lead" }),
    ).toBeTruthy();
  });
});

describe("Deleting a lead", () => {
  it("requires confirmation, then removes the lead and toasts", () => {
    renderPage();
    const sheet = openFirstDetailSheet();

    fireEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog");
    expect(
      within(confirm).getByRole("heading", { name: "Delete lead?" }),
    ).toBeTruthy();

    fireEvent.click(
      within(confirm).getByRole("button", { name: "Delete" }),
    );

    expect(toast.success).toHaveBeenCalledWith("Lead deleted for Apex Indoor Golf.");
    expect(screen.queryByRole("dialog")).toBeNull();

    // The deleted lead's contact (Marcus Hale, ld-1) no longer appears; the
    // other Apex lead (ld-9, Andre Bishop) legitimately remains.
    expect(screen.queryAllByText("Marcus Hale")).toHaveLength(0);
    expect(screen.getAllByText("Apex Indoor Golf").length).toBeGreaterThan(0);
  });

  it("cancel keeps the lead", () => {
    renderPage();
    const sheet = openFirstDetailSheet();

    fireEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(toast.success).not.toHaveBeenCalled();
    // Sheet is still open with the lead present.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
