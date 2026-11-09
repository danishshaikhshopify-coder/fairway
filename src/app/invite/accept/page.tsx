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

    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      // Supabase's older (implicit) invite links land with #access_token=...
      // instead of ?code=; the client picks that session up on its own.
      db.auth.getSession().then(({ data }) => {
        setStage(data.session ? "ready" : "error");
        if (!data.session) setError("This invite link is missing or has expired.");
      });
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
