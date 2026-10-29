// React DOM tests for the Add-lead form on the Leads page. The form is
// rendered through the real page + store; only sonner and next/link are mocked.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { plusDaysIso } from "@/lib/format";

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

function openDialog(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Add lead" }));
  return screen.getByRole("dialog");
}

function fill(dialog: HTMLElement, label: RegExp, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Add lead" }));
}

function fillValidRequiredFields(dialog: HTMLElement) {
  fill(dialog, /company/i, "Ridgeview Golf");
  fill(dialog, /contact/i, "Tina Alvarez");
  fill(dialog, /email/i, "tina@ridgeview.example");
  fill(dialog, /estimated value/i, "31000");
  fill(dialog, /^next follow-up/i, "2026-11-20");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Preferences must start at their defaults (another test may have saved).
  window.localStorage.clear();
});

describe("Add-lead form", () => {
  it("empty submit flags every required field and shows an error toast", () => {
    renderPage();
    const dialog = openDialog();

    // The follow-up date is prefilled from the default follow-up window (3
    // days); clear it to reach the genuinely empty form.
    const dateField = within(dialog).getByLabelText(
      /^next follow-up/i,
    ) as HTMLInputElement;
    expect(dateField.value).toBe(plusDaysIso(3));
    fireEvent.change(dateField, { target: { value: "" } });

    submit(dialog);

    const alerts = within(dialog)
      .getAllByRole("alert")
      .map((node) => node.textContent);
    expect(alerts).toHaveLength(5);
    expect(alerts).toContain("Company is required.");
    expect(alerts).toContain("Contact name is required.");
    expect(alerts).toContain("Email is required.");
    expect(alerts).toContain("Enter an estimated value in USD.");
    expect(alerts).toContain("Pick a follow-up date.");
    expect(toast.error).toHaveBeenCalledWith(
      "Fix the highlighted fields before adding the lead.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("rejects an invalid email and does not create a lead", () => {
    renderPage();
    const dialog = openDialog();

    fill(dialog, /company/i, "Ridgeview Golf");
    fill(dialog, /contact/i, "Tina Alvarez");
    fill(dialog, /email/i, "not-an-email");
    fill(dialog, /estimated value/i, "31000");
    fill(dialog, /^next follow-up/i, "2026-11-20");
    submit(dialog);

    expect(
      within(dialog).getByText("Enter a valid email address."),
    ).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryAllByText("Ridgeview Golf")).toHaveLength(0);
  });

  it("rejects a negative value and an out-of-range score", () => {
    renderPage();
    const dialog = openDialog();

    fillValidRequiredFields(dialog);
    fill(dialog, /estimated value/i, "-5");
    const details = within(dialog)
      .getByText(/scoring/i)
      .closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    details.open = true;
    fill(dialog, /lead score/i, "150");
    submit(dialog);

    expect(
      within(dialog).getByText("Enter an estimated value in USD."),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Use a score between 0 and 100."),
    ).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("clears a field's error immediately while the user corrects it", () => {
    renderPage();
    const dialog = openDialog();

    submit(dialog); // all five errors appear
    expect(within(dialog).getByText("Company is required.")).toBeTruthy();

    fill(dialog, /company/i, "Ridgeview Golf");
    // The company error disappears on the very first keystroke...
    expect(within(dialog).queryByText("Company is required.")).toBeNull();
    // ...while the untouched fields keep theirs.
    expect(within(dialog).getByText("Contact name is required.")).toBeTruthy();
    expect(within(dialog).getByText("Email is required.")).toBeTruthy();

    // An invalid value shows its error; correcting it clears that too.
    fill(dialog, /estimated value/i, "abc");
    submit(dialog);
    expect(
      within(dialog).getByText("Enter an estimated value in USD."),
    ).toBeTruthy();
    fill(dialog, /estimated value/i, "25000");
    expect(
      within(dialog).queryByText("Enter an estimated value in USD."),
    ).toBeNull();
  });

  it("prefills owner and follow-up date from saved CRM preferences", () => {
    window.localStorage.setItem(
      "fairway.prefs.v1",
      JSON.stringify({
        defaultOwner: "J. Chen",
        followUpDays: 14,
        currency: "USD",
      }),
    );
    renderPage();
    const dialog = openDialog();

    expect(
      (within(dialog).getByLabelText(/^next follow-up/i) as HTMLInputElement)
        .value,
    ).toBe(plusDaysIso(14));
    expect(
      within(dialog).getByLabelText(/^owner/i).textContent,
    ).toContain("J. Chen");
  });

  it("submits a valid lead, closes the dialog, updates the list, and toasts", () => {
    renderPage();
    const dialog = openDialog();

    fillValidRequiredFields(dialog);
    submit(dialog);

    expect(toast.success).toHaveBeenCalledWith("Lead added for Ridgeview Golf.");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The page-level lead count grows from the 12 seeded leads to 13.
    expect(screen.getByText(/13 in total/)).toBeTruthy();
    // The new lead (default score 50) sorts to a later page, so find it the
    // way a user would: via search.
    fireEvent.change(screen.getByLabelText("Search leads"), {
      target: { value: "Ridgeview" },
    });
    expect(screen.getAllByText("Ridgeview Golf").length).toBeGreaterThan(0);
  });
});
