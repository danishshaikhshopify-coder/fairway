// React DOM tests for /invite/accept. The real page is rendered; only the
// Supabase client factory and next/navigation are mocked.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  updateUser: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/supabase/client", () => ({
  isLiveMode: () => true,
  getSupabase: () => ({ auth }),
}));

import AcceptInvitePage from "@/app/invite/accept/page";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/invite/accept");
});

describe("Invite accept page", () => {
  it("shows a generic message when the link carries no token at all", async () => {
    render(<AcceptInvitePage />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "This invite link is missing or has expired.",
      ),
    );
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("surfaces Supabase's own error_description instead of the generic message", async () => {
    window.history.replaceState({}, "", "/invite/accept#error=access_denied&error_description=Email+link+is+invalid+or+has+expired");
    render(<AcceptInvitePage />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Email link is invalid or has expired",
      ),
    );
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("establishes a session from an implicit #access_token= callback via setSession (no PKCE verifier needed)", async () => {
    window.history.replaceState(
      {},
      "",
      "/invite/accept#access_token=at-1&refresh_token=rt-1&expires_in=3600&token_type=bearer&type=invite",
    );
    auth.setSession.mockResolvedValue({ error: null });
    render(<AcceptInvitePage />);
    await waitFor(() =>
      expect(auth.setSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" }),
    );
    expect(await screen.findByLabelText(/^New password/)).toBeTruthy();
  });

  it("shows the setSession error when the implicit callback's tokens are rejected", async () => {
    window.history.replaceState(
      {},
      "",
      "/invite/accept#access_token=at-1&refresh_token=rt-1&expires_in=3600&token_type=bearer&type=invite",
    );
    auth.setSession.mockResolvedValue({ error: { message: "Invalid Refresh Token" } });
    render(<AcceptInvitePage />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Invalid Refresh Token"),
    );
  });

  it("establishes a session from a ?token_hash= callback via verifyOtp", async () => {
    window.history.replaceState({}, "", "/invite/accept?token_hash=th-1&type=invite");
    auth.verifyOtp.mockResolvedValue({ error: null });
    render(<AcceptInvitePage />);
    await waitFor(() =>
      expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "th-1", type: "invite" }),
    );
    expect(await screen.findByLabelText(/^New password/)).toBeTruthy();
  });

  it("exchanges a ?code= link for a session and shows the password form", async () => {
    window.history.replaceState({}, "", "/invite/accept?code=abc123");
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    render(<AcceptInvitePage />);
    await waitFor(() => expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByLabelText(/^New password/)).toBeTruthy();
  });

  it("shows the exchange error when the code is invalid", async () => {
    window.history.replaceState({}, "", "/invite/accept?code=bad");
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "Invalid flow state" } });
    render(<AcceptInvitePage />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Invalid flow state"),
    );
  });

  it("sets a password and continues into the app", async () => {
    window.history.replaceState({}, "", "/invite/accept?code=abc123");
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    render(<AcceptInvitePage />);
    const passwordInput = await screen.findByLabelText(/^New password/);
    fireEvent.change(passwordInput, { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    await waitFor(() =>
      expect(auth.updateUser).toHaveBeenCalledWith({ password: "secret1" }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});
