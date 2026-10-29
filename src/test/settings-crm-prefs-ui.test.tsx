// React DOM tests for Settings → CRM preferences: load saved values after
// mount, and persist edits to localStorage on save. Only sonner and
// next-themes are mocked — the real page, tabs, and store are rendered.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

import { toast } from "sonner";
import SettingsPage from "@/app/settings/page";

const KEY = "fairway.prefs.v1";

function crmPanel(): HTMLElement {
  fireEvent.click(screen.getByRole("tab", { name: "CRM" }));
  return screen.getByRole("tabpanel");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("Settings → CRM preferences", () => {
  it("starts at the documented defaults when nothing is saved", () => {
    render(<SettingsPage />);
    const panel = crmPanel();

    const days = within(panel).getByLabelText(
      "Default follow-up window (days)",
    ) as HTMLInputElement;
    expect(days.value).toBe("3");
    expect(panel.textContent).toContain("A. Rivera");
    expect(panel.textContent).toContain("USD");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("persists edits to localStorage and confirms with a toast", () => {
    render(<SettingsPage />);
    const panel = crmPanel();

    fireEvent.change(
      within(panel).getByLabelText("Default follow-up window (days)"),
      { target: { value: "10" } },
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Save changes" }),
    );

    expect(toast.success).toHaveBeenCalledWith(
      "CRM preferences saved in this browser.",
    );
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}")).toEqual({
      defaultOwner: "A. Rivera",
      followUpDays: 10,
      currency: "USD",
    });
  });

  it("shows previously saved preferences when reopened", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        defaultOwner: "J. Chen",
        followUpDays: 14,
        currency: "CAD",
      }),
    );

    render(<SettingsPage />);
    const panel = crmPanel();

    // Loaded one tick after hydration (avoids a prerender mismatch).
    await waitFor(() =>
      expect(
        within(panel).getByLabelText("Default follow-up window (days)"),
      ).toHaveProperty("value", "14"),
    );
    expect(panel.textContent).toContain("J. Chen");
    expect(panel.textContent).toContain("CAD");
  });
});
