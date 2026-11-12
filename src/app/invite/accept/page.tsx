"use client";

// /invite/accept — where a Supabase invite email's link lands. By the time
// handle_new_user() ran (at invite time, not here — see
// POST /api/team/invitations), the partner already has a workspace_members
// row; all that is left is turning the one-time invite link into a real
// session and letting them set a password. Reachable signed-out (see
// isPublicPath() in lib/supabase/auth.ts) and rendered bare (see app-shell).

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/crm/form-field";
import { Input } from "@/components/ui/input";
import { getSupabase, isLiveMode } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 6;

type Stage = "exchanging" | "ready" | "error";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("exchanging");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLiveMode()) {
      router.replace("/");
      return;
    }
    const db = getSupabase();
    if (!db) return;

    // Supabase reports a bad/reused/expired link via `error_description`, on
    // either the query string or the hash (implicit-flow redirects use the
    // hash). Surface that instead of guessing, so a Dashboard allow-list
    // mismatch doesn't look identical to a genuinely expired token.
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const linkError = search.get("error_description") ?? hash.get("error_description");
    if (linkError) {
      setTimeout(() => {
        setStage("error");
        setError(linkError);
      }, 0);
      return;
    }

    // This page is reached only by an admin-generated invite link — never by
    // a flow this browser itself started — so there is never a PKCE code
    // verifier sitting in storage here. The shared client's *automatic*
    // hash/code detection assumes one might exist and is pinned to
    // flowType "pkce" (createBrowserClient forces this, unconditionally);
    // it actively rejects an implicit `#access_token=` callback as a
    // flow-type mismatch instead of just ignoring it, discarding a perfectly
    // valid token. So this page reads the callback itself and calls the
    // token-establishing methods directly: setSession() and verifyOtp() need
    // no verifier at all, unlike the automatic path — confirmed against the
    // installed @supabase/auth-js in src/test/supabase-invite-callback-flows.test.tsx.
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (accessToken && refreshToken) {
      db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: sessionError }) => {
        if (sessionError) {
          setStage("error");
          setError(sessionError.message);
          return;
        }
        window.history.replaceState(null, "", window.location.pathname);
        setStage("ready");
      });
      return;
    }

    const tokenHash = search.get("token_hash") ?? hash.get("token_hash");
    if (tokenHash) {
      db.auth.verifyOtp({ token_hash: tokenHash, type: "invite" }).then(({ error: verifyError }) => {
        if (verifyError) {
          setStage("error");
          setError(verifyError.message);
          return;
        }
        window.history.replaceState(null, "", window.location.pathname);
        setStage("ready");
      });
      return;
    }

    const code = search.get("code");
    if (!code) {
      setTimeout(() => {
        setStage("error");
        setError("This invite link is missing or has expired.");
      }, 0);
      return;
    }
    db.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) {
        setStage("error");
        setError(exchangeError.message);
        return;
      }
      setStage("ready");
    });
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    const db = getSupabase();
    if (!db) return;
    setBusy(true);
    try {
      const { error: updateError } = await db.auth.updateUser({ password });
      if (updateError) {
        setFieldError(updateError.message);
        return;
      }
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="justify-items-center gap-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Welcome to Fairway CRM</h1>
          <p className="text-sm text-muted-foreground">
            Set a password to finish joining the workspace.
          </p>
        </CardHeader>
        <CardContent>
          {stage === "exchanging" ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Confirming your invite…
            </div>
          ) : null}

          {stage === "error" ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error ?? "This invite link is no longer valid."} Ask your admin to send a new one.
            </div>
          ) : null}

          {stage === "ready" ? (
            <form onSubmit={onSubmit} noValidate className="grid gap-4">
              {fieldError ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {fieldError}
                </div>
              ) : null}
              <FormField label="New password" required error={undefined}>
                {(props) => (
                  <Input
                    {...props}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                )}
              </FormField>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                {busy ? "Please wait" : "Set password and continue"}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
