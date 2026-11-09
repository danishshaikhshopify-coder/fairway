"use client";

// /login — sign in only. Rendered bare (no CRM chrome, no CRM data): AppShell
// returns early for this path.
//
// Fairway CRM is invite-only (Phase 2): there is no self-serve "create
// account" here, and the server enforces that independently of this UI —
// handle_new_user() rejects any signup with no matching pending invitation
// (see the B7 migration), so removing the form is a UX courtesy, not the
// actual security boundary. A partner's account is created when the owner
// invites them (Settings -> Team); they arrive here already having set a
// password via the emailed link (see /invite/accept).
//
// Live mode only. In demo mode there are no accounts, so the page bounces
// straight back to the mock CRM instead of offering a form that cannot work.

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/crm/form-field";
import { Input } from "@/components/ui/input";
import { getSupabase, isLiveMode } from "@/lib/supabase/client";

type FieldErrors = Partial<Record<"email" | "password", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!EMAIL_RE.test(email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (password.length < 1) {
    errors.password = "Enter your password.";
  }
  return errors;
}

/** GoTrue messages are written for developers; translate the common ones. */
function authErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "user_already_exists":
      return "An account with this email already exists.";
    case "email_not_confirmed":
      return "Confirm your email address, then sign in.";
    case "weak_password":
      return "Choose a stronger password.";
    case "rate_limit_exceeded":
    case "overdue_rate_limit":
      return "Too many attempts. Wait a moment and try again.";
    case "signup_disabled":
      return "Sign-ups are turned off on this project.";
    default:
      return error.message || "Something went wrong. Try again.";
  }
}

/**
 * Where to go after a successful sign-in. Read from the URL at submit time (so
 * the statically prerendered page needs no Suspense boundary for
 * useSearchParams), and only same-origin app paths are accepted — never
 * `//host` or a scheme — so it cannot be turned into an open redirect.
 */
function safeReturnPath(): string {
  const raw = new URLSearchParams(window.location.search).get("next");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Demo mode has no accounts: bounce straight back to the mock CRM.
  useEffect(() => {
    if (!isLiveMode()) router.replace("/");
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(email, password);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    const db = getSupabase();
    if (!db) {
      setFormError(
        "Live mode is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
      return;
    }

    setBusy(true);
    try {
      const { error } = await db.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setFormError(authErrorMessage(error));
        return;
      }
      // The cookie is already written; the proxy lets the next request
      // through and AuthProvider picks the session up on navigation.
      router.replace(safeReturnPath());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="justify-items-center gap-2 text-center">
          <Image
            src="/brand/emblem-64.png"
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-xl"
            priority
          />
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to Fairway CRM to pick up your pipeline.
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            {formError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </div>
            ) : null}

            <FormField label="Email" required error={errors.email}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@company.com"
                />
              )}
            </FormField>

            <FormField label="Password" required error={errors.password}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              )}
            </FormField>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {busy ? "Please wait" : "Sign in"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Fairway CRM is invite-only. Ask your admin for an invite.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
