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
    expect(screen.getByText("Password must be at least 6 characters.")).toBeTruthy();
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

  it("switches to sign-up and sends the full name as metadata", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Full name/), {
      target: { value: "  Ada Lovelace " },
    });
    fillCredentials("ada@example.com", "secret1");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "secret1",
        options: { data: { full_name: "Ada Lovelace" } },
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("falls back to sign-in when signup returns no session", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.change(screen.getByLabelText(/^Full name/), {
      target: { value: "Ada Lovelace" },
    });
    fillCredentials("ada@example.com", "secret1");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(screen.getByText("Check your inbox to confirm your address, then sign in.")).toBeTruthy(),
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
