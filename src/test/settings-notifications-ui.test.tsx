// React DOM tests for Settings → Notifications: live mode hydrates from and
// saves to the profiles columns (decision §5.3); demo mode keeps the
// demo-only rule. Only sonner, next-themes, the auth context, and the
// Supabase client/repository are mocked — the real page renders.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

const supa = vi.hoisted(() => ({
  live: true as boolean,
  userId: "user-1" as string | null,
  loadNotificationPrefs: vi.fn(),
  saveNotificationPrefs: vi.fn(),
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
  loadNotificationPrefs: (...args: unknown[]) => supa.loadNotificationPrefs(...args),
  saveNotificationPrefs: (...args: unknown[]) => supa.saveNotificationPrefs(...args),
}));

import { toast } from "sonner";
import SettingsPage from "@/app/settings/page";

function notifPanel(): HTMLElement {
  fireEvent.click(screen.getByRole("tab", { name: "Notifications" }));
  return screen.getByRole("tabpanel");
}

function switch_(panel: HTMLElement, name: string): HTMLElement {
  return within(panel).getByRole("switch", { name: new RegExp(name, "i") });
}

beforeEach(() => {
  vi.clearAllMocks();
  supa.live = true;
  supa.userId = "user-1";
  supa.loadNotificationPrefs.mockResolvedValue({
    newLeadAlerts: true,
    dailyDigest: true,
    overdueReminders: true,
    weeklyReport: false,
  });
  supa.saveNotificationPrefs.mockResolvedValue(undefined);
});

describe("Settings → Notifications (live mode)", () => {
  it("hydrates the switches from the profiles columns", async () => {
    supa.loadNotificationPrefs.mockResolvedValue({
      newLeadAlerts: false,
      dailyDigest: true,
      overdueReminders: true,
      weeklyReport: true,
    });

    render(<SettingsPage />);
    const panel = notifPanel();

    await waitFor(() =>
      expect(supa.loadNotificationPrefs).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
      ),
    );
    await waitFor(() => {
      expect(switch_(panel, "New lead alerts").getAttribute("aria-checked")).toBe("false");
      expect(switch_(panel, "Weekly pipeline report").getAttribute("aria-checked")).toBe("true");
    });
  });

  it("saves edited switches to the profiles columns", async () => {
    render(<SettingsPage />);
    const panel = notifPanel();

    fireEvent.click(switch_(panel, "Weekly pipeline report"));
    fireEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(supa.saveNotificationPrefs).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.objectContaining({ weeklyReport: true }),
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Notification preferences saved.",
      ),
    );
  });

  it("surfaces a failed save instead of claiming success", async () => {
    supa.saveNotificationPrefs.mockRejectedValue(new Error("network down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SettingsPage />);
    const panel = notifPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not save notification preferences. Try again.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never claims persistence when there is no session", async () => {
    supa.userId = null;
    supa.live = false;

    render(<SettingsPage />);
    const panel = notifPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining("demo only"),
      ),
    );
    expect(supa.saveNotificationPrefs).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
