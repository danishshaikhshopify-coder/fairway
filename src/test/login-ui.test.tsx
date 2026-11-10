// React DOM tests for /login. The real page is rendered; only the Supabase
// client factory and next/navigation are mocked.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/login",
}));

vi.mock("@/lib/supabase/client", () => ({
  isLiveMode: () => true,
  getSupabase: () => ({ auth }),
}));

import LoginPage from "@/app/login/page";

// Labels carry a required asterisk inside the <label>, so match by prefix.
function emailInput() {
  return screen.getByLabelText(/^Email/);
}
function passwordInput() {
  return screen.getByLabelText(/^Password/);
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(emailInput(), { target: { value: email } });
  fireEvent.change(passwordInput(), { target: { value: password } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/login");
});

describe("Login page", () => {
  it("starts in sign-in mode", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Full name/)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("blocks submission and explains each invalid field", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(emailInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("signs in with trimmed values and returns to ?next=", async () => {
    window.history.replaceState({}, "", "/login?next=%2Fpipeline");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillCredentials("  user@example.com ", "secret1");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret1",
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/pipeline"));
  });

  it("refuses an off-site ?next= value", async () => {
    window.history.replaceState({}, "", "/login?next=//evil.example");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillCredentials("user@example.com", "secret1");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("shows the server's auth error instead of navigating", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    render(<LoginPage />);
    fillCredentials("user@example.com", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Incorrect email or password.",
      ),
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  // Fairway CRM is invite-only (Phase 2): the page never offers a self-serve
  // "create account" path. auth.signUp stays a mock on the client only so an
  // unexpected call is still observable — nothing here exercises it.
  it("never offers a sign-up path: invite-only notice only, no Create account control", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Create your account" })).toBeNull();
    expect(
      screen.getByText("Fairway CRM is invite-only. Ask your admin for an invite."),
    ).toBeTruthy();
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});
